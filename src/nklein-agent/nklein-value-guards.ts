/**
 * Small shared value-guards for the NKlein SDK boundary (todo §5.U "missing shared utility"). Previously `asRecord`
 * was re-defined locally in five `src/nklein-agent/*` modules; this is the single canonical version. It returns the
 * value typed as a plain record only when it is a non-null, non-array object — the strict form (some copies omitted
 * the array guard, but every call site passes JSON object shapes, so the strict form is behaviour-safe and is the
 * correct "is this a record?" check).
 *
 * (`toErrorMessage` is intentionally NOT consolidated here: its copies differ in their fallback string per context.)
 */
export function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
