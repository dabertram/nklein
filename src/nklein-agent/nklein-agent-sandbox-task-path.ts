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
