/**
 * Cache-aware prompt layout (todo §5.AQ item D) — the PURE guard that keeps the system-prompt PREFIX byte-stable so
 * local runtimes (llama.cpp / LM Studio / MLX) actually reuse their prefix KV cache.
 *
 * Those runtimes match on EXACT byte-equality of the token prefix: one volatile byte high in the prompt (a date, a
 * clock time, a UUID, a session id) changes the prefix and forces a FULL re-prefill every turn. This is not theoretical
 * — the openclaw #19892 outage was exactly this: a `"Current time: …"` line in the system prompt invalidated the cache
 * every turn and took a 40k-token context from ~5s to ~200s. So all volatile content MUST live in the SUFFIX, after the
 * stable system + tool-definition block (which is reused verbatim turn after turn).
 *
 * This module is the layout GUARD: {@link detectVolatilePrefixContent} scans a would-be prefix for content that defeats
 * caching, so prompt assembly can move it to the suffix (or a lint can warn). It is pure + deterministic — it never
 * reads the clock and performs no I/O. The cache-HEALTH probe + adaptation (item E) and the per-request inference levers
 * (item H) live elsewhere; this is only the byte-stable-prefix guard.
 */

/** The categories of cache-defeating volatile content this guard recognises. */
export type VolatileKind =
	| "iso_date"
	| "clock_time"
	| "uuid"
	| "epoch_timestamp"
	| "relative_time_word"
	| "explicit_now_label"
	| "session_or_request_id";

/** One piece of volatile content found in a prefix (would-be cache-invalidating). */
export interface VolatileFinding {
	kind: VolatileKind;
	/** The exact substring that matched (for the warning message). */
	match: string;
	/** Character offset of the match within the scanned text. */
	index: number;
	/** Why this defeats prefix caching. */
	reason: string;
}

interface VolatilePattern {
	kind: VolatileKind;
	regex: RegExp;
	reason: string;
}

// Ordered, non-overlapping-enough patterns. Each carries the global flag so we can collect EVERY occurrence. Kept
// deliberately conservative (precise shapes, not loose words) to avoid false positives on legitimately-stable prose.
const VOLATILE_PATTERNS: readonly VolatilePattern[] = [
	{
		kind: "explicit_now_label",
		regex: /\b(?:current|today'?s)\s+(?:date|time|timestamp)\b|\btoday\s+is\b|\bthe\s+(?:current\s+)?(?:date|time)\s+is\b/gi,
		reason: "an explicit current-date/time label changes every run and invalidates the cached prefix",
	},
	{
		kind: "uuid",
		regex: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
		reason: "a UUID is per-run/per-session and breaks exact-prefix cache matching",
	},
	{
		kind: "epoch_timestamp",
		regex: /\b1[0-9]{12}\b/g,
		reason: "a millisecond epoch timestamp changes every call and invalidates the cached prefix",
	},
	{
		kind: "iso_date",
		regex: /\b\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\b/g,
		reason: "an ISO date changes daily and invalidates the cached prefix",
	},
	{
		kind: "clock_time",
		regex: /\b(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\b/g,
		reason: "a clock time changes every minute/second and invalidates the cached prefix",
	},
	{
		kind: "session_or_request_id",
		regex: /\b(?:session|request|conversation|trace|run)[ _-]?id\b/gi,
		reason: "a session/request id is per-run and breaks exact-prefix cache matching",
	},
	{
		kind: "relative_time_word",
		regex: /\b(?:right now|as of now|at this moment|currently)\b/gi,
		reason: "a relative-time phrase implies live volatile content in the stable prefix",
	},
];

/**
 * Scan a would-be STABLE PREFIX (system prompt + tool definitions) for volatile content that would defeat prefix
 * caching. Returns every finding, sorted by position (ties broken by detection-pattern order). Empty when the prefix is
 * cache-stable. Pure — does not read the clock.
 */
export function detectVolatilePrefixContent(prefix: string): VolatileFinding[] {
	const findings: VolatileFinding[] = [];
	for (const pattern of VOLATILE_PATTERNS) {
		// Fresh lastIndex each call (the regex literals are module-level + global).
		pattern.regex.lastIndex = 0;
		for (const match of prefix.matchAll(pattern.regex)) {
			findings.push({
				kind: pattern.kind,
				match: match[0],
				index: match.index ?? 0,
				reason: pattern.reason,
			});
		}
	}
	findings.sort((a, b) => a.index - b.index);
	return findings;
}

/** True when the prefix contains any cache-defeating volatile content (a cheap boolean form of the detector). */
export function hasVolatilePrefixContent(prefix: string): boolean {
	return detectVolatilePrefixContent(prefix).length > 0;
}

/**
 * Whether two prefixes are cache-equivalent: local runtimes reuse the KV cache only on EXACT byte-equality, so this is
 * deliberately strict `===`. Names the contract a caller checks across turns ("did my stable prefix change?").
 */
export function prefixesAreCacheEquivalent(a: string, b: string): boolean {
	return a === b;
}

/**
 * Compose a cache-aware prompt: the byte-stable `stablePrefix` first (reused verbatim every turn), then all volatile
 * content (`volatileSuffix`: date, retrieved docs, task, turns) AFTER it. Pure string assembly — it does NOT move
 * content for you; pair it with {@link detectVolatilePrefixContent} to ensure nothing volatile is in `stablePrefix`.
 */
export function assembleCacheAwarePrompt(input: { stablePrefix: string; volatileSuffix?: string }): string {
	const suffix = input.volatileSuffix?.trim();
	if (!suffix) {
		return input.stablePrefix;
	}
	return `${input.stablePrefix}\n\n${suffix}`;
}
