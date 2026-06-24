import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";

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
	const memories: ChatMemory[] = [];
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		try {
			memories.push(JSON.parse(trimmed) as ChatMemory);
		} catch {
			// Skip a malformed line rather than failing the whole read.
		}
	}
	return memories;
}

/** Memories a session may recall: its own + any shared. */
export function accessibleChatMemories(memories: readonly ChatMemory[], sessionId: string): ChatMemory[] {
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
	input: { query: string; sessionId: string; memories: readonly ChatMemory[]; limit?: number },
	deps: ChatMemoryRecallDeps = {},
): Promise<ChatMemoryRecall[]> {
	const accessible = accessibleChatMemories(input.memories, input.sessionId);
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
