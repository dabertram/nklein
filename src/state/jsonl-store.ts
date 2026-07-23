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
export interface JsonlParseDiagnostic {
	readonly kind: "unparseable" | "schema_invalid";
	readonly linePreview: string;
	readonly message?: string;
}

export interface ValidatedJsonlResult<T> {
	readonly records: readonly T[];
	readonly diagnostics: readonly JsonlParseDiagnostic[];
}

/** Parse while retaining every tolerant-reader skip as structured evidence. */
export function parseValidatedJsonlWithDiagnostics<T>(content: string, schema: z.ZodType<T>): ValidatedJsonlResult<T> {
	const results: T[] = [];
	const diagnostics: JsonlParseDiagnostic[] = [];
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			diagnostics.push({ kind: "unparseable", linePreview: trimmed.slice(0, 120) });
			continue;
		}
		const result = schema.safeParse(parsed);
		if (!result.success) {
			diagnostics.push({
				kind: "schema_invalid",
				linePreview: trimmed.slice(0, 120),
				message: result.error.message.slice(0, 240),
			});
			continue;
		}
		results.push(result.data);
	}
	return { records: results, diagnostics };
}

export function parseValidatedJsonl<T>(content: string, schema: z.ZodType<T>, context: string): T[] {
	const result = parseValidatedJsonlWithDiagnostics(content, schema);
	for (const diagnostic of result.diagnostics) {
		process.stderr.write(
			diagnostic.kind === "unparseable"
				? `[jsonl-store] ${context}: skipping unparseable line: ${diagnostic.linePreview}\n`
				: `[jsonl-store] ${context}: skipping schema-invalid record: ${diagnostic.message ?? diagnostic.linePreview}\n`,
		);
	}
	return [...result.records];
}
