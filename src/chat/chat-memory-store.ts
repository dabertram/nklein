import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import { parseValidatedJsonl } from "../state/jsonl-store";

/**
 * Long-term chat memory store + recall (todo §5.M). Persisted memories are "woken up" — semantically recalled
 * on associated topics — to keep small models effective across long/resumed sessions within the ≥32k floor.
 *
 * Recall is the pure, testable core (`recallChatMemories`): the embedder is injected, so it ranks by cosine
 * similarity when embeddings are present and **degrades to lexical token overlap** when the embedder is the
 * lexical fallback (or a memory was stored without a vector) — never failing closed. Persistence is an
 * append-only JSONL log (memories only grow; consolidation/pruning is a later §5.M increment).
 *
 * Scope (§5.M): a memory is bound to its originating session and, when `shared`, is also recalled by the
 * other sessions — `session`-isolated by default, opt-in shared-across-sessions.
 */

export interface ChatMemory {
	schemaVersion: 1;
	id: string;
	sessionId: string;
	/** When true, this memory is recalled by *other* sessions too (opt-in shared scope). */
	shared: boolean;
	text: string;
	/** The embedding vector, or null when stored under the lexical fallback (recall degrades accordingly). */
	embedding: number[] | null;
	createdAt: number;
}

export const chatMemorySchema = z.object({
	schemaVersion: z.literal(1),
	id: z.string(),
	sessionId: z.string(),
	shared: z.boolean(),
	text: z.string(),
	embedding: z.array(z.number()).nullable(),
	createdAt: z.number(),
}) satisfies z.ZodType<ChatMemory>;

export interface ChatMemoryStoreOptions {
	rootDir?: string;
	now?: () => number;
}

const DEFAULT_ROOT = join(resolveNkleinRuntimeHomePath(homedir()), "chat-memories");

function resolveLogPath(rootDir?: string): string {
	return join(rootDir ?? DEFAULT_ROOT, "memories.jsonl");
}

export async function appendChatMemory(
	input: { sessionId: string; text: string; shared?: boolean; embedding?: number[] | null; id?: string },
	options: ChatMemoryStoreOptions = {},
): Promise<ChatMemory> {
	const memory: ChatMemory = {
		schemaVersion: 1,
		id: input.id ?? randomUUID(),
		sessionId: input.sessionId,
		shared: input.shared ?? false,
		text: input.text,
		embedding: input.embedding ?? null,
		createdAt: (options.now ?? Date.now)(),
	};
	const root = options.rootDir ?? DEFAULT_ROOT;
	await mkdir(root, { recursive: true });
	await appendFile(resolveLogPath(options.rootDir), `${JSON.stringify(memory)}\n`, "utf8");
	return memory;
}

export async function readChatMemories(options: ChatMemoryStoreOptions = {}): Promise<ChatMemory[]> {
	let raw: string;
	try {
		raw = await readFile(resolveLogPath(options.rootDir), "utf8");
	} catch {
		return [];
	}
	return parseValidatedJsonl(raw, chatMemorySchema, "chat-memory-store");
}

/**
 * Memories a session may recall: its own + any shared. §5.M: with `allProjects` (an `all_projects`-scoped driver
 * session), recall ACROSS all sessions — the driver's durable working memory spans every project it has touched, not
 * just this session's own + shared entries.
 */
export function accessibleChatMemories(
	memories: readonly ChatMemory[],
	sessionId: string,
	options: { allProjects?: boolean } = {},
): ChatMemory[] {
	if (options.allProjects) {
		return [...memories];
	}
	return memories.filter((memory) => memory.shared || memory.sessionId === sessionId);
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
	if (a.length === 0 || a.length !== b.length) {
		return 0;
	}
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		const x = a[i] ?? 0;
		const y = b[i] ?? 0;
		dot += x * y;
		normA += x * x;
		normB += y * y;
	}
	if (normA === 0 || normB === 0) {
		return 0;
	}
	return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function tokenize(text: string): Set<string> {
	return new Set(
		text
			.toLowerCase()
			.split(/[^a-z0-9]+/)
			.filter((token) => token.length > 0),
	);
}

/** Jaccard token overlap — the embedder-free fallback so recall still works under the lexical provider. */
export function lexicalSimilarity(a: string, b: string): number {
	const left = tokenize(a);
	const right = tokenize(b);
	if (left.size === 0 || right.size === 0) {
		return 0;
	}
	let intersection = 0;
	for (const token of left) {
		if (right.has(token)) {
			intersection += 1;
		}
	}
	return intersection / (left.size + right.size - intersection);
}

/** Similarity between two memory texts: cosine when both have embeddings, else lexical token overlap. */
function memorySimilarity(
	a: { text: string; embedding: number[] | null },
	b: { text: string; embedding: number[] | null },
): number {
	return a.embedding && b.embedding ? cosineSimilarity(a.embedding, b.embedding) : lexicalSimilarity(a.text, b.text);
}

export interface ConsolidateChatMemoriesDeps {
	/** Extract candidate long-term memories from a short-term summary (a model call). */
	extract: (summary: string) => Promise<string[]>;
	/** The in-process embedder; when present, dedup uses embedding similarity. */
	embed?: (text: string) => Promise<number[] | null>;
	/** Near-duplicate threshold (default 0.85) — a candidate at/above this to any kept/existing memory is dropped. */
	similarityThreshold?: number;
}

export interface ConsolidatedChatMemory {
	text: string;
	embedding: number[] | null;
}

/**
 * Consolidate short→long (todo §5.M): extract candidate memories from a session's rolling summary and keep only
 * the genuinely new ones — dropping any that near-duplicate an already-accessible memory or an earlier candidate
 * in this batch. Returns the texts (+ embeddings, when the embedder is present) to persist via `appendChatMemory`.
 */
export async function proposeConsolidatedMemories(
	input: { sessionId: string; summary: string; existingMemories: readonly ChatMemory[] },
	deps: ConsolidateChatMemoriesDeps,
): Promise<ConsolidatedChatMemory[]> {
	const threshold = deps.similarityThreshold ?? 0.85;
	const existing = accessibleChatMemories(input.existingMemories, input.sessionId);
	const candidates = (await deps.extract(input.summary)).map((text) => text.trim()).filter((text) => text.length > 0);
	const kept: ConsolidatedChatMemory[] = [];
	for (const text of candidates) {
		const embedding = deps.embed ? await deps.embed(text) : null;
		const candidate = { text, embedding };
		const isDuplicate = [...existing, ...kept].some((other) => memorySimilarity(candidate, other) >= threshold);
		if (!isDuplicate) {
			kept.push(candidate);
		}
	}
	return kept;
}

export interface WriteConsolidatedMemoriesDeps extends ConsolidateChatMemoriesDeps {
	/** Persist one kept memory (the runtime supplies `appendChatMemory`). */
	persist: (memory: ConsolidatedChatMemory) => Promise<void>;
}

/**
 * The §5.M short→long WRITE path (todo §5.M): extract candidate memories from a session's rolling summary, keep only
 * the genuinely-new ones ({@link proposeConsolidatedMemories}), and persist each via the injected sink. Returns the
 * kept memories (for logging/tests). Pure orchestration — the extractor + embedder + persist sink are all injected,
 * so the runtime wires `deps.extract` (a model call), the in-process embedder, and `appendChatMemory`. Best-effort is
 * the CALLER's concern: this surfaces an extractor/persist rejection so the caller can swallow it off the turn path.
 */
export async function writeConsolidatedMemories(
	input: { sessionId: string; summary: string; existingMemories: readonly ChatMemory[] },
	deps: WriteConsolidatedMemoriesDeps,
): Promise<ConsolidatedChatMemory[]> {
	const proposed = await proposeConsolidatedMemories(input, {
		extract: deps.extract,
		...(deps.embed ? { embed: deps.embed } : {}),
		...(deps.similarityThreshold !== undefined ? { similarityThreshold: deps.similarityThreshold } : {}),
	});
	for (const memory of proposed) {
		await deps.persist(memory);
	}
	return proposed;
}

export interface ChatMemoryRecallDeps {
	/** The in-process embedder; returns null when unavailable so recall falls back to lexical overlap. */
	embed?: (text: string) => Promise<number[] | null>;
}

export interface ChatMemoryRecall extends ChatMemory {
	score: number;
}

/**
 * Rank the session-accessible memories against `query`, returning the top matches (highest score first).
 * Uses cosine similarity when both the query and a memory have embeddings; otherwise lexical token overlap.
 * Zero-score memories are dropped so an unrelated query recalls nothing.
 */
export async function recallChatMemories(
	input: { query: string; sessionId: string; memories: readonly ChatMemory[]; limit?: number; allProjects?: boolean },
	deps: ChatMemoryRecallDeps = {},
): Promise<ChatMemoryRecall[]> {
	const accessible = accessibleChatMemories(input.memories, input.sessionId, {
		...(input.allProjects ? { allProjects: true } : {}),
	});
	const queryEmbedding = deps.embed ? await deps.embed(input.query) : null;
	const scored: ChatMemoryRecall[] = accessible.map((memory) => {
		const score =
			queryEmbedding && memory.embedding
				? cosineSimilarity(queryEmbedding, memory.embedding)
				: lexicalSimilarity(input.query, memory.text);
		return { ...memory, score };
	});
	const ranked = scored
		.filter((memory) => memory.score > 0)
		.sort((left, right) => right.score - left.score || right.createdAt - left.createdAt);
	const limit = typeof input.limit === "number" ? Math.max(0, input.limit) : ranked.length;
	return ranked.slice(0, limit);
}
