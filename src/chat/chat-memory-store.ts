import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import { parseValidatedJsonl } from "../state/jsonl-store";
import {
	filterChatMemoriesForRecall,
	type MemoryNamespaceDecision,
	type MemoryNamespaceRef,
	resolveMemoryNamespaceDecision,
} from "./chat-memory-retrieval-policy";

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
	/** Identity of the model that produced `embedding`; absent on legacy rows, which therefore recall lexically. */
	embeddingModelId?: string | null;
	/** Owning workspace/project identity. Legacy rows are enriched from their source ChatSession before live recall. */
	namespaceId?: string | null;
	/** User-legible project label used to resolve explicit cross-project queries. */
	namespaceLabel?: string | null;
	/** Explicit reversible knowledge-update links; the old rows remain stored but are withheld from normal recall. */
	supersedesMemoryIds?: string[];
	createdAt: number;
}

export const chatMemorySchema = z.object({
	schemaVersion: z.literal(1),
	id: z.string(),
	sessionId: z.string(),
	shared: z.boolean(),
	text: z.string(),
	embedding: z.array(z.number()).nullable(),
	embeddingModelId: z.string().nullable().optional(),
	namespaceId: z.string().nullable().optional(),
	namespaceLabel: z.string().nullable().optional(),
	supersedesMemoryIds: z.array(z.string()).optional(),
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
	input: {
		sessionId: string;
		text: string;
		shared?: boolean;
		embedding?: number[] | null;
		embeddingModelId?: string | null;
		namespaceId?: string | null;
		namespaceLabel?: string | null;
		supersedesMemoryIds?: readonly string[];
		id?: string;
	},
	options: ChatMemoryStoreOptions = {},
): Promise<ChatMemory> {
	const memory: ChatMemory = {
		schemaVersion: 1,
		id: input.id ?? randomUUID(),
		sessionId: input.sessionId,
		shared: input.shared ?? false,
		text: input.text,
		embedding: input.embedding ?? null,
		embeddingModelId: input.embeddingModelId ?? null,
		namespaceId: input.namespaceId ?? null,
		namespaceLabel: input.namespaceLabel ?? null,
		supersedesMemoryIds: [...(input.supersedesMemoryIds ?? [])],
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
 * F2.9b: delete ONE memory by id — rewrite the append-only log without it. Returns true when a row was removed
 * (false when the id was absent). Rewrites only when something changed, so a no-op delete never rewrites the file.
 */
export async function deleteChatMemory(memoryId: string, options: ChatMemoryStoreOptions = {}): Promise<boolean> {
	const memories = await readChatMemories(options);
	const kept = memories.filter((memory) => memory.id !== memoryId);
	if (kept.length === memories.length) {
		return false;
	}
	const root = options.rootDir ?? DEFAULT_ROOT;
	await mkdir(root, { recursive: true });
	// Audit 2026-08-25 (MEDIUM): a bare full-rewrite loses the ENTIRE memory log on a crash mid-write and races
	// concurrent appends. Write the new contents to a temp file and atomically rename over the log, so a crash
	// leaves either the old complete log or the new one — never a truncated file.
	const logPath = resolveLogPath(options.rootDir);
	const tmpPath = `${logPath}.${process.pid}.${(options.now ?? Date.now)()}.tmp`;
	await writeFile(tmpPath, kept.map((memory) => `${JSON.stringify(memory)}\n`).join(""), "utf8");
	await rename(tmpPath, logPath);
	return true;
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
function haveCompatibleEmbeddings(
	a: { embedding: number[] | null; embeddingModelId?: string | null },
	b: { embedding: number[] | null; embeddingModelId?: string | null },
): a is { embedding: number[]; embeddingModelId: string } {
	return Boolean(
		a.embedding &&
			b.embedding &&
			a.embeddingModelId &&
			b.embeddingModelId &&
			a.embeddingModelId === b.embeddingModelId,
	);
}

function memorySimilarity(
	a: { text: string; embedding: number[] | null; embeddingModelId?: string | null },
	b: { text: string; embedding: number[] | null; embeddingModelId?: string | null },
): number {
	return haveCompatibleEmbeddings(a, b)
		? cosineSimilarity(a.embedding, b.embedding ?? [])
		: lexicalSimilarity(a.text, b.text);
}

export interface ConsolidateChatMemoriesDeps {
	/** Extract candidate long-term memories from a short-term summary (a model call). */
	extract: (summary: string) => Promise<string[]>;
	/** The in-process embedder; when present, dedup uses embedding similarity. */
	embed?: (text: string) => Promise<number[] | null>;
	/** Stable identity for persisted vectors; without it vectors are never compared across records. */
	embeddingModelId?: string;
	/** Near-duplicate threshold (default 0.85) — a candidate at/above this to any kept/existing memory is dropped. */
	similarityThreshold?: number;
}

export interface ConsolidatedChatMemory {
	text: string;
	embedding: number[] | null;
	embeddingModelId: string | null;
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
		const candidate = { text, embedding, embeddingModelId: embedding ? (deps.embeddingModelId ?? null) : null };
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
		...(deps.embeddingModelId ? { embeddingModelId: deps.embeddingModelId } : {}),
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
	/** The query-vector model identity; only same-model stored vectors are eligible for cosine ranking. */
	embeddingModelId?: string;
	/**
	 * Fail closed instead of changing retrieval semantics when an embedding-backed cross-project profile is in use.
	 * A missing query vector or a legacy/different-model memory is then ineligible rather than lexically ranked.
	 */
	requireEmbedding?: boolean;
	/** Precomputed query vector used by the unified composer so one strict preflight governs every widened source. */
	queryEmbedding?: readonly number[] | null;
}

export interface ChatMemoryRecall extends ChatMemory {
	score: number;
}

/** Attach namespace metadata to legacy rows from the durable session that authored them. */
export function enrichChatMemoryNamespaces(
	memories: readonly ChatMemory[],
	sessions: ReadonlyArray<{ id: string; title: string; ownedWorkspaceId: string | null }>,
): ChatMemory[] {
	const bySession = new Map(sessions.map((session) => [session.id, session]));
	return memories.map((memory) => {
		if (memory.namespaceId && memory.namespaceLabel) return memory;
		const source = bySession.get(memory.sessionId);
		if (!source?.ownedWorkspaceId) return memory;
		return {
			...memory,
			namespaceId: memory.namespaceId ?? source.ownedWorkspaceId,
			namespaceLabel: memory.namespaceLabel ?? source.title,
		};
	});
}

/**
 * Rank the session-accessible memories against `query`, returning the top matches (highest score first).
 * Uses cosine similarity when both the query and a memory have embeddings; otherwise lexical token overlap.
 * Zero-score memories are dropped so an unrelated query recalls nothing.
 */
export async function recallChatMemories(
	input: {
		query: string;
		sessionId: string;
		memories: readonly ChatMemory[];
		limit?: number;
		allProjects?: boolean;
		defaultNamespaceId?: string | null;
		namespaceHints?: readonly MemoryNamespaceRef[];
		namespaceDecision?: MemoryNamespaceDecision;
	},
	deps: ChatMemoryRecallDeps = {},
): Promise<ChatMemoryRecall[]> {
	const namespaces = input.namespaceHints ?? [
		...new Map(
			input.memories.flatMap((memory) =>
				memory.namespaceId && memory.namespaceLabel
					? [[memory.namespaceId, { id: memory.namespaceId, label: memory.namespaceLabel }] as const]
					: [],
			),
		).values(),
	];
	const namespaceDecision =
		input.namespaceDecision ??
		resolveMemoryNamespaceDecision({
			query: input.query,
			namespaces,
			defaultNamespaceId: input.defaultNamespaceId,
		});
	const accessible = filterChatMemoriesForRecall({
		memories: input.memories,
		sessionId: input.sessionId,
		allProjects: input.allProjects === true,
		decision: namespaceDecision,
	});
	const retrievalQuery = input.allProjects ? namespaceDecision.retrievalQuery : input.query;
	const queryEmbedding = Object.hasOwn(deps, "queryEmbedding")
		? (deps.queryEmbedding ?? null)
		: deps.embed
			? await deps.embed(retrievalQuery)
			: null;
	if (deps.requireEmbedding && (!queryEmbedding || !deps.embeddingModelId)) {
		return [];
	}
	const scored: ChatMemoryRecall[] = accessible.map((memory) => {
		const compatibleEmbedding = Boolean(
			queryEmbedding &&
				memory.embedding &&
				deps.embeddingModelId &&
				memory.embeddingModelId === deps.embeddingModelId,
		);
		const score = compatibleEmbedding
			? cosineSimilarity(queryEmbedding ?? [], memory.embedding ?? [])
			: deps.requireEmbedding
				? 0
				: lexicalSimilarity(retrievalQuery, memory.text);
		return { ...memory, score };
	});
	const ranked = scored
		.filter((memory) => memory.score > 0)
		.sort((left, right) => right.score - left.score || right.createdAt - left.createdAt);
	const limit = typeof input.limit === "number" ? Math.max(0, input.limit) : ranked.length;
	return ranked.slice(0, limit);
}
