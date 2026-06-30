/**
 * The `read_files` request shape and its tolerant parser, extracted from nklein-large-file-workflow.
 * Pure — it normalizes the many input dialects small models emit into a flat {@link ReadFileRequest}
 * list, so it is behavior-preserving relative to its inline definition.
 */

export interface ReadFileRequest {
	path: string;
	startLine: number | null;
	endLine: number | null;
}

/** Coerce a value to a finite, truncated integer, or null when it is not a finite number. */
function asNumber(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return null;
	}
	return Math.trunc(value);
}

/**
 * Parse the many shapes a `read_files` tool call can carry into a flat list of requests: a bare path
 * string, an array of paths/objects, an object with a `files`/`file_paths`/`paths` array (or single
 * value), or a single `{ path, start_line, end_line }` record. Blank/path-less entries are dropped.
 */
export function parseReadFileRequests(input: unknown): ReadFileRequest[] {
	const toRequest = (value: unknown): ReadFileRequest | null => {
		if (typeof value === "string") {
			const path = value.trim();
			return path ? { path, startLine: null, endLine: null } : null;
		}
		if (!value || typeof value !== "object") {
			return null;
		}
		const record = value as Record<string, unknown>;
		const path = typeof record.path === "string" ? record.path.trim() : "";
		return path
			? {
					path,
					startLine: asNumber(record.start_line),
					endLine: asNumber(record.end_line),
				}
			: null;
	};

	if (typeof input === "string") {
		const request = toRequest(input);
		return request ? [request] : [];
	}
	if (Array.isArray(input)) {
		return input.map(toRequest).filter((request): request is ReadFileRequest => request !== null);
	}
	if (!input || typeof input !== "object") {
		return [];
	}
	const record = input as Record<string, unknown>;
	for (const key of ["files", "file_paths", "paths"] as const) {
		const value = record[key];
		if (Array.isArray(value)) {
			return value.map(toRequest).filter((request): request is ReadFileRequest => request !== null);
		}
		if (value !== undefined) {
			const request = toRequest(value);
			return request ? [request] : [];
		}
	}
	const request = toRequest(record);
	return request ? [request] : [];
}
