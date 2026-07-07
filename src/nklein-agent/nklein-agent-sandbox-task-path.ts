/**
 * Normalize a task id into a path-safe segment for the in-container sandbox workspace directory,
 * extracted from nklein-agent-sandbox. Pure.
 *
 * Replaces any character outside `[a-zA-Z0-9._-]` with `-`, strips leading dashes, caps the length
 * at 80, and falls back to `"task"` if nothing usable remains — so an arbitrary task id always
 * yields a stable, filesystem-safe, non-empty directory name.
 */
export function normalizeTaskIdForSandboxPath(taskId: string): string {
	return (
		taskId
			.trim()
			.replaceAll(/[^a-zA-Z0-9._-]/g, "-")
			.replace(/^-+/g, "")
			.slice(0, 80) || "task"
	);
}

/**
 * §5.O parse-and-recover for a common weak-model path error. The agent's cwd IS the sandbox workdir
 * `/workspaces/<segment>`, but a model that mistakes its cwd for the repo root emits that workdir path as a RELATIVE
 * tool path (e.g. `workspaces/<segment>/hello.txt` or `./workspaces/<segment>/hello.txt`). The container then resolves
 * it against the cwd and nests the file one level deep, so a write lands at the wrong place (delivery misses it) and a
 * read misses. Strip that unambiguous, task-scoped redundant prefix so the file lands / is read where the model meant.
 *
 * Deliberately narrow + safe: only the exact workdir-segment prefix in its RELATIVE forms is stripped. An ABSOLUTE
 * `/workspaces/<segment>/…` is left untouched (it already resolves correctly), any other path is returned verbatim (a
 * legitimately-nested `workspaces/<segment>/` dir would need a real project subdir named after the ephemeral segment —
 * which does not occur), and a prefix with nothing after it is left as-is (not rewritten to an empty path).
 */
export function stripRedundantSandboxWorkdirPrefix(rawPath: string, taskId: string): string {
	if (typeof rawPath !== "string" || rawPath.length === 0) {
		return rawPath;
	}
	const segment = normalizeTaskIdForSandboxPath(taskId);
	if (!segment) {
		return rawPath;
	}
	const forwardSlashed = rawPath.replaceAll("\\", "/");
	for (const prefix of [`workspaces/${segment}/`, `./workspaces/${segment}/`]) {
		if (forwardSlashed.startsWith(prefix)) {
			const remainder = forwardSlashed.slice(prefix.length);
			return remainder.length > 0 ? remainder : rawPath;
		}
	}
	return rawPath;
}
