type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : null;
}

/** Detect a failure embedded inside an SDK tool-result envelope that omitted top-level `is_error`. */
export function containsStructuredToolFailure(value: unknown, depth = 0): boolean {
	if (depth > 8 || value === null || value === undefined) return false;
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return false;
		try {
			return containsStructuredToolFailure(JSON.parse(trimmed), depth + 1);
		} catch {
			return false;
		}
	}
	if (Array.isArray(value)) return value.some((entry) => containsStructuredToolFailure(entry, depth + 1));
	const record = asRecord(value);
	if (!record) return false;
	if (record.success === false || record.ok === false || record.is_error === true || record.isError === true) {
		return true;
	}
	return Object.values(record).some((entry) => containsStructuredToolFailure(entry, depth + 1));
}

export function isEffectiveToolResultError(isTransportError: boolean, content: unknown): boolean {
	return isTransportError || containsStructuredToolFailure(content);
}
