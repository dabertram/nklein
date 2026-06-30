import { parseReadFileRequests } from "./nklein-read-file-request";

/**
 * Read-files request fingerprinting, extracted from nklein-session-runtime.
 *
 * The agent's repeated-tool-call guard needs to know when two `read_files` approval requests target
 * the SAME set of file ranges. {@link buildReadFilesTargetKeys} parses an unknown tool input into
 * the per-target keys (path + a `path:start:end` range key + a full-file flag, dropping blank
 * paths), and {@link buildReadFilesRequestFingerprint} reduces those to an order-independent
 * fingerprint string (sorted range keys joined by newlines, or null for an empty request). Pure.
 */
export interface ReadFilesTargetKey {
	path: string;
	rangeKey: string;
	fullFile: boolean;
}

export function buildReadFilesTargetKeys(input: unknown): ReadFilesTargetKey[] {
	return parseReadFileRequests(input)
		.map((request) => {
			const path = request.path.trim();
			if (!path) {
				return null;
			}
			const startLine = typeof request.startLine === "number" ? request.startLine : null;
			const endLine = typeof request.endLine === "number" ? request.endLine : null;
			const fullFile = startLine === null && endLine === null;
			return {
				path,
				rangeKey: `${path}:${startLine ?? ""}:${endLine ?? ""}`,
				fullFile,
			};
		})
		.filter((key): key is ReadFilesTargetKey => key !== null);
}

export function buildReadFilesRequestFingerprint(keys: ReadFilesTargetKey[]): string | null {
	if (keys.length === 0) {
		return null;
	}
	return [...keys]
		.map((key) => key.rangeKey)
		.sort((left, right) => left.localeCompare(right))
		.join("\n");
}
