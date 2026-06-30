import type { RuntimeTaskSessionUsage } from "../core/api-contract";
import { normalizeNonNegativeInteger } from "../core/normalize-number";
import { asRecord } from "./nklein-value-guards";

/**
 * Parse a token-usage record off a raw SDK event into the runtime's {@link RuntimeTaskSessionUsage},
 * extracted from nklein-event-adapter.
 *
 * Tolerates the several field-name spellings different SDK surfaces use
 * (inputTokens | promptTokens for input; outputTokens | completionTokens | generatedTokens for
 * output). Returns null unless BOTH an input and an output count are present and non-negative; the
 * cache counts default to 0. Pure (no I/O).
 */
export function readSessionUsage(value: unknown): RuntimeTaskSessionUsage | null {
	const usage = asRecord(value);
	if (!usage) {
		return null;
	}
	const inputTokens =
		normalizeNonNegativeInteger(usage.inputTokens) ?? normalizeNonNegativeInteger(usage.promptTokens);
	const outputTokens =
		normalizeNonNegativeInteger(usage.outputTokens) ??
		normalizeNonNegativeInteger(usage.completionTokens) ??
		normalizeNonNegativeInteger(usage.generatedTokens);
	if (inputTokens === null || outputTokens === null) {
		return null;
	}
	return {
		inputTokens,
		outputTokens,
		cacheReadTokens: normalizeNonNegativeInteger(usage.cacheReadTokens) ?? 0,
		cacheWriteTokens: normalizeNonNegativeInteger(usage.cacheWriteTokens) ?? 0,
	};
}
