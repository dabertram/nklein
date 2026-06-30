/**
 * Pure summarizers for read-file tool inputs, extracted from nklein-tool-call-display. They turn the
 * many `read_file(s)` argument shapes (a bare path, an array, or an object with path/file_path/
 * filePath + optional start/end lines, plus `file_paths`/`files` collections) into a de-duplicated
 * list of `path` / `path:start-end` display summaries. No display-module coupling.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Append a single read-file argument's summary (a path, or `path:start-end` when line bounds are present). */
function appendReadFileSummary(summaries: string[], value: unknown): void {
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed.length > 0) {
			summaries.push(trimmed);
		}
		return;
	}

	if (!isRecord(value)) {
		return;
	}

	const path =
		typeof value.path === "string"
			? value.path.trim()
			: typeof value.file_path === "string"
				? value.file_path.trim()
				: typeof value.filePath === "string"
					? value.filePath.trim()
					: "";
	if (path.length === 0) {
		return;
	}

	const startLine = Number.isInteger(value.start_line) ? Number(value.start_line) : null;
	const endLine = Number.isInteger(value.end_line) ? Number(value.end_line) : null;

	if (startLine === null && endLine === null) {
		summaries.push(path);
		return;
	}

	const start = startLine ?? 1;
	const end = endLine ?? "EOF";
	summaries.push(`${path}:${start}-${end}`);
}

/**
 * Extract the de-duplicated read-file summaries from a `read_file(s)` tool input in any of its shapes:
 * a bare path string, an array of arguments, or an object (its own path fields plus `file_paths` and
 * `files` collections, each string or array).
 */
export function extractReadFileSummaries(input: unknown): string[] {
	const summaries: string[] = [];

	if (typeof input === "string") {
		appendReadFileSummary(summaries, input);
		return Array.from(new Set(summaries));
	}

	if (Array.isArray(input)) {
		for (const value of input) {
			appendReadFileSummary(summaries, value);
		}
		return Array.from(new Set(summaries));
	}

	if (!isRecord(input)) {
		return summaries;
	}

	appendReadFileSummary(summaries, input);

	const filePaths = input.file_paths;
	if (typeof filePaths === "string") {
		appendReadFileSummary(summaries, filePaths);
	} else if (Array.isArray(filePaths)) {
		for (const value of filePaths) {
			appendReadFileSummary(summaries, value);
		}
	}

	const files = input.files;
	if (Array.isArray(files)) {
		for (const value of files) {
			appendReadFileSummary(summaries, value);
		}
	} else if (files !== undefined) {
		appendReadFileSummary(summaries, files);
	}

	return Array.from(new Set(summaries));
}
