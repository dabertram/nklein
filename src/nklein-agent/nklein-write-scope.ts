// Pure path-scope normalization for the tool-approval write gate (extracted from nklein-runtime-setup.ts,
// §5.U). Maps a raw tool path into a workspace-relative comparison key — stripping matching quotes, the host
// workspace prefix, and a Docker sandbox `/workspaces/<taskId>/` prefix, collapsing `./` and leading slashes —
// so the approval layer can compare an agent's target against the declared filesLikelyTouched scope regardless
// of which root the path was expressed in. `..` escapes survive normalization so the caller can reject them.

function trimMatchingQuotes(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length < 2) {
		return trimmed;
	}
	const first = trimmed.at(0);
	const last = trimmed.at(-1);
	if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
		return trimmed.slice(1, -1).trim();
	}
	return trimmed;
}

/** Normalize a raw tool path to a workspace-relative key (host + sandbox prefixes stripped, `./`/leading `/` removed). */
export function normalizeScopePath(rawPath: string, workspacePath: string, taskId?: string | null): string {
	let path = trimMatchingQuotes(rawPath).replaceAll("\\", "/").replace(/\/+/gu, "/");
	const workspacePrefix = workspacePath.replaceAll("\\", "/").replace(/\/+/gu, "/").replace(/\/+$/u, "");
	if (workspacePrefix && path.startsWith(`${workspacePrefix}/`)) {
		path = path.slice(workspacePrefix.length + 1);
	}
	const normalizedTaskId = taskId?.trim();
	if (normalizedTaskId) {
		const sandboxPrefix = `/workspaces/${normalizedTaskId}/`;
		if (path.startsWith(sandboxPrefix)) {
			path = path.slice(sandboxPrefix.length);
		}
	}
	while (path.startsWith("./")) {
		path = path.slice(2);
	}
	while (path.startsWith("/")) {
		path = path.slice(1);
	}
	return path.replace(/\/+$/u, "");
}

/** Build the set of allowed workspace-relative write targets from the declared filesLikelyTouched, dropping `..` escapes. */
export function normalizeWriteScope(
	workspacePath: string,
	taskId: string | null | undefined,
	filesLikelyTouched: readonly string[] | null | undefined,
): Set<string> {
	const scope = new Set<string>();
	for (const filePath of filesLikelyTouched ?? []) {
		const normalized = normalizeScopePath(filePath, workspacePath, taskId);
		if (normalized && normalized !== ".." && !normalized.startsWith("../")) {
			scope.add(normalized);
		}
	}
	return scope;
}
