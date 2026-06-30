/**
 * Pure value/text summarizers extracted from nklein-context-focus-policy. They turn arbitrary tool
 * inputs and message text into short, single-line summaries for focus briefs and compacted previews.
 * No SDK or policy coupling, so they are behavior-preserving relative to their inline definitions.
 */

/** Summarize an arbitrary value as a string: strings/numbers/booleans verbatim, null/undefined → "", else JSON (with a String() fallback). */
export function summarizeValue(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (value === null || value === undefined) {
		return "";
	}
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

/**
 * Summarize a `read_files`-style tool input as a comma-separated `path:start-end` list (missing
 * bounds shown as `?`), de-duplicated. Reads the `files`/`file_paths`/`paths` keys (array or single)
 * and the input object itself; falls back to {@link summarizeValue} when nothing path-like is found.
 */
export function summarizeReadFileInput(input: Record<string, unknown>): string {
	const appendRequest = (request: unknown, summaries: string[]): void => {
		if (typeof request === "string") {
			const trimmed = request.trim();
			if (trimmed) {
				summaries.push(trimmed);
			}
			return;
		}
		if (!request || typeof request !== "object") {
			return;
		}
		const record = request as Record<string, unknown>;
		const path = typeof record.path === "string" ? record.path.trim() : "";
		if (!path) {
			return;
		}
		const start = summarizeValue(record.start_line).trim();
		const end = summarizeValue(record.end_line).trim();
		summaries.push(start || end ? `${path}:${start || "?"}-${end || "?"}` : path);
	};

	const summaries: string[] = [];
	for (const key of ["files", "file_paths", "paths"] as const) {
		const value = input[key];
		if (Array.isArray(value)) {
			for (const item of value) {
				appendRequest(item, summaries);
			}
		} else {
			appendRequest(value, summaries);
		}
	}
	appendRequest(input, summaries);

	const uniqueSummaries = Array.from(new Set(summaries));
	if (uniqueSummaries.length > 0) {
		return uniqueSummaries.join(", ");
	}
	return summarizeValue(input);
}

/** Collapse whitespace, trim, and cap text at `maxChars` (appending `...` when truncated); empty text → `"empty"`. */
export function summarizeText(text: string, maxChars: number): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (!normalized) {
		return "empty";
	}
	return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars)}...`;
}
