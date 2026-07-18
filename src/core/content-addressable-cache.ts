import { fnv1aContentHash } from "./merkle-file-tree";

/**
 * F12.32 — content-addressable caching for tool results + model responses (the determinism-BOUNDING half;
 * aimock remains the record/replay layer for simulated runs).
 *
 * LLM agents are non-deterministic run-to-run (float non-associativity + batch-dependent kernels mean even
 * temp=0 isn't reproducible). The fix is not eliminating that but bounding it: key a cache by a CANONICAL hash
 * of everything that determines the output — for a tool, (name, args, workspace-context fingerprint); for a
 * model call, (model, messages, tools, sampling params) — and reuse the recorded result on an exact hit.
 * Reuse cuts inference spend and smooths tail latency, and an exact-input hit is by construction at least as
 * correct as a fresh non-deterministic sample.
 *
 * This module is the PURE core: canonical JSON serialization (stable key order, so semantically-equal inputs
 * hash equal), the shared repo FNV-1a content hash (fast, sufficient for cache keying — not security),
 * a bounded LRU store, the two key builders, and the read-only tool cacheability policy. The effectful seam
 * wire (consult-before-execute at the tool boundary / model-call seam) is opt-in and lives with the runtime.
 */

/** Serialize with OBJECT KEYS SORTED at every level so semantically-equal inputs produce identical bytes. */
export function canonicalJson(value: unknown): string {
	return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sortValue);
	}
	if (value !== null && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return Object.fromEntries(entries.map(([k, v]) => [k, sortValue(v)]));
	}
	return value;
}

/** Content hash for cache keys — the proven repo-wide FNV-1a (shared with the F12.67 Merkle tree). */
export const contentHash = fnv1aContentHash;

/** Key a TOOL result: the tool, its full args, and a fingerprint of the workspace context the tool reads. */
export function computeToolResultCacheKey(input: {
	toolName: string;
	args: unknown;
	/** Hash of the content the tool depends on (file content hashes, repo-map root hash…); "" = no context. */
	contextFingerprint: string;
}): string {
	return `tool:${input.toolName}:${contentHash(canonicalJson(input.args))}:${input.contextFingerprint}`;
}

/** Key a MODEL response: model + full messages + tools + the sampling params that shape the output. */
export function computeModelResponseCacheKey(input: {
	modelId: string;
	messages: unknown;
	tools?: unknown;
	params?: { temperature?: number; top_p?: number; max_tokens?: number; tool_choice?: unknown };
}): string {
	const body = canonicalJson({
		messages: input.messages,
		tools: input.tools ?? null,
		params: input.params ?? null,
	});
	return `model:${input.modelId}:${contentHash(body)}`;
}

/**
 * Read-only tools whose results are safe to reuse when the CONTEXT FINGERPRINT matches (they neither mutate
 * state nor depend on hidden inputs the fingerprint can't capture). Mutating/executing tools (write/edit/
 * run_commands) and board mutations are NEVER cacheable — a run_commands may be idempotent but the cache
 * cannot know, so the policy fails closed.
 */
export const CACHEABLE_READ_TOOLS: ReadonlySet<string> = new Set([
	"read_files",
	"read_large_file",
	"get_file_size",
	"list_files",
	"find_files",
	"search_code",
	"search_codebase",
	"repo_map",
	"ast_search",
	"ego_graph",
]);

export function isToolResultCacheable(toolName: string): boolean {
	return CACHEABLE_READ_TOOLS.has(toolName);
}

export interface ContentAddressableCacheStats {
	hits: number;
	misses: number;
	evictions: number;
	size: number;
}

/**
 * Bounded LRU keyed by the content-addressed key. Insertion refreshes recency; capacity evicts the least
 * recently USED entry. Pure data structure — no clocks, no IO — so replay/tests stay deterministic.
 */
export class ContentAddressableCache<TValue> {
	private readonly entries = new Map<string, TValue>();
	private hits = 0;
	private misses = 0;
	private evictions = 0;

	constructor(private readonly capacity: number) {
		if (!Number.isFinite(capacity) || capacity < 1) {
			throw new Error(`ContentAddressableCache capacity must be >= 1 (got ${capacity})`);
		}
	}

	get(key: string): TValue | undefined {
		if (!this.entries.has(key)) {
			this.misses += 1;
			return undefined;
		}
		const value = this.entries.get(key) as TValue;
		// Refresh recency: Map preserves insertion order, so re-insert moves the key to the back.
		this.entries.delete(key);
		this.entries.set(key, value);
		this.hits += 1;
		return value;
	}

	set(key: string, value: TValue): void {
		if (this.entries.has(key)) {
			this.entries.delete(key);
		} else if (this.entries.size >= this.capacity) {
			const oldest = this.entries.keys().next().value;
			if (oldest !== undefined) {
				this.entries.delete(oldest);
				this.evictions += 1;
			}
		}
		this.entries.set(key, value);
	}

	stats(): ContentAddressableCacheStats {
		return { hits: this.hits, misses: this.misses, evictions: this.evictions, size: this.entries.size };
	}
}
