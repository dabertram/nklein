/**
 * F12.7 KV-cache prefix-volatility audit — PURE core.
 *
 * A single-token change early in the prompt invalidates the KV cache from that point on — the classic culprit is a
 * timestamp in the system prompt, and at long agentic contexts the throughput collapse is up to 10×. !Klein already
 * assembles a cache-stable prefix (F4.40); this audit is the guard that KEEPS it stable: given a prompt prefix, it
 * flags every volatile-content class (timestamps/dates, UUIDs/hex ids, counters, durations) with its char offset —
 * the EARLIER the leak, the larger the cache loss, so findings are ordered by position. Pure + deterministic; run it
 * over the live builders' output in tests/CI or via a dev command.
 */

export interface PrefixVolatilityFinding {
	/** Volatility class that matched. */
	readonly kind: "timestamp" | "date" | "uuid" | "hex_id" | "counter" | "duration";
	/** The matched text (clipped to 40 chars). */
	readonly sample: string;
	/** Char offset into the prefix — everything AFTER this offset loses cache reuse when the value changes. */
	readonly offset: number;
	/** Fraction of the prefix that survives the invalidation (offset / length) — lower = worse. */
	readonly cacheSurvivalFraction: number;
}

const VOLATILE_PATTERNS: readonly { kind: PrefixVolatilityFinding["kind"]; pattern: RegExp }[] = [
	// Epoch runs are range-checked (review-found: any 9-13 digit constant — a byte budget, a phone number —
	// read as a "timestamp leak"). Epoch seconds are 10 digits starting 1-2 (2001→2096); epoch ms = same + 3.
	{ kind: "timestamp", pattern: /\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?\b|\b[12]\d{9}(?:\d{3})?\b/g },
	{ kind: "date", pattern: /\b\d{4}-\d{2}-\d{2}\b|\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+\d{1,2}\b/g },
	{ kind: "uuid", pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi },
	{ kind: "hex_id", pattern: /\b[0-9a-f]{16,64}\b/gi },
	{ kind: "counter", pattern: /\b(?:attempt|retry|round|iteration|run)\s*[#:]?\s*\d+\b/gi },
	{ kind: "duration", pattern: /\b\d+(?:\.\d+)?\s?(?:ms|s|sec|seconds|min|minutes)\s+(?:elapsed|remaining|ago)\b/gi },
];

/**
 * Audit a prompt prefix (system prompt + any content meant to be cache-stable) for volatile tokens. Zero findings =
 * the prefix is cache-safe. Findings sorted by offset (earliest = most cache lost). An empty prefix is trivially safe.
 */
export function auditPromptPrefixVolatility(prefix: string): PrefixVolatilityFinding[] {
	const findings: PrefixVolatilityFinding[] = [];
	const length = Math.max(1, prefix.length);
	for (const { kind, pattern } of VOLATILE_PATTERNS) {
		const scanner = new RegExp(pattern.source, pattern.flags);
		for (const match of prefix.matchAll(scanner)) {
			if (match.index === undefined) {
				continue;
			}
			findings.push({
				kind,
				sample: match[0].slice(0, 40),
				offset: match.index,
				cacheSurvivalFraction: match.index / length,
			});
		}
	}
	findings.sort((a, b) => a.offset - b.offset);
	return findings;
}
