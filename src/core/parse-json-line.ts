import type { z } from "zod";

/**
 * Parse one JSON line and validate it against a schema, returning the parsed value or null. Tolerant:
 * returns null for malformed JSON (the `JSON.parse` throw is caught) and for schema-invalid data.
 * Extracted from the per-store `parseObservationRecord` copies in the telemetry JSONL readers (§4A).
 */
export function parseJsonLineWithSchema<T>(line: string, schema: z.ZodType<T>): T | null {
	try {
		const parsed = schema.safeParse(JSON.parse(line));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}
