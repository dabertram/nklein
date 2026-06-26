import type { z } from "zod";

/**
 * Shared JSONL parsing helper (anti-patterns #5 / architecture #8).
 *
 * Splits a JSONL string into validated records of type `T`. The behaviour is:
 *  - Blank lines → skipped silently (as before).
 *  - JSON-unparseable lines → skipped + diagnostic emitted (as before).
 *  - JSON-parseable but schema-invalid lines → skipped + diagnostic emitted (NEW: surfaces structural bugs
 *    instead of silently trusting a mis-shaped object as `T`).
 *  - Valid lines → included in the returned array.
 *
 * The helper is intentionally ADDITIVE: it does NOT change the accept/reject behaviour for records that pass
 * validation — the caller receives identical results for all structurally-valid data that existed before this
 * helper was introduced.
 */
export function parseValidatedJsonl<T>(content: string, schema: z.ZodType<T>, context: string): T[] {
	const results: T[] = [];
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			// Skip a malformed line rather than failing the whole read (unchanged behaviour).
			process.stderr.write(`[jsonl-store] ${context}: skipping unparseable line: ${trimmed.slice(0, 120)}\n`);
			continue;
		}
		const result = schema.safeParse(parsed);
		if (!result.success) {
			// NEW: surface schema-invalid records instead of silently trusting them.
			process.stderr.write(
				`[jsonl-store] ${context}: skipping schema-invalid record: ${result.error.message.slice(0, 240)}\n`,
			);
			continue;
		}
		results.push(result.data);
	}
	return results;
}
