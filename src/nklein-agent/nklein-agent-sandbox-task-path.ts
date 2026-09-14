import { createHash } from "node:crypto";

/**
 * Normalize a task id into a path-safe segment for the in-container sandbox workspace directory,
 * extracted from nklein-agent-sandbox. Pure.
 *
 * Replaces any character outside `[a-zA-Z0-9._-]` with `-`, strips leading dashes, bounds the length
 * at 80, and falls back to `"task"` if nothing usable remains — so an arbitrary task id always
 * yields a stable, filesystem-safe, non-empty directory name.
 *
 * ── IT MUST BE INJECTIVE, AND A BARE TRUNCATION IS NOT (live 2026-09-11, project 50) ──
 * The workspace directory came from this segment while the workspace's OWNER UID comes from a hash of the FULL
 * task id (`createAgentSandboxTaskUid`). A plain `.slice(0, 80)` therefore mapped every id sharing its first 80
 * characters onto ONE 0700 directory owned by whichever card prepared first — and the others, running as their
 * own uid, hit EACCES on absolutely everything: `read_files`, `list_files` (0 entries for the root),
 * `get_file_size`, `search_codebase` (30s timeout) and even `spawn /bin/bash`, because the cwd itself is
 * unreadable. Total failure with no distinct error, which is how one dead card took 28 of a shift's 40 requests.
 *
 * The decomposer's ids are `<plan-slug>-<task-slug>`, and a long plan slug leaves only a few characters of the
 * task slug inside the bound. The real incident: three cards of one plan —
 * `…-not-testable-discrimination-and-completeness-pass` (112 chars), `…-discount-threshold-and-rate` (103) and
 * `…-discount-cap` (88) — all became `confirm-r-01-r-05-…-not-testable-disc`. A sweep of the drain's recorded
 * boards found 21 ids past the bound, so this was a standing hazard, not a one-off.
 *
 * An over-long id now keeps a readable prefix and ends in a digest of the WHOLE id, so distinct ids stay
 * distinct while the segment stays inside the bound. Ids within the bound are untouched — existing workspaces
 * and every path assertion that depends on them are unaffected.
 */
const MAX_SANDBOX_PATH_SEGMENT = 80;
const SANDBOX_PATH_DIGEST_LENGTH = 8;

export function normalizeTaskIdForSandboxPath(taskId: string): string {
	const sanitized = taskId
		.trim()
		.replaceAll(/[^a-zA-Z0-9._-]/g, "-")
		.replace(/^-+/g, "");
	if (sanitized.length <= MAX_SANDBOX_PATH_SEGMENT) {
		return sanitized || "task";
	}
	// Hash the RAW id, the same input the uid derives from, so two ids that sanitize alike still separate.
	const digest = createHash("sha256").update(taskId).digest("hex").slice(0, SANDBOX_PATH_DIGEST_LENGTH);
	const prefix = sanitized.slice(0, MAX_SANDBOX_PATH_SEGMENT - SANDBOX_PATH_DIGEST_LENGTH - 1).replace(/-+$/g, "");
	return `${prefix}-${digest}`;
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
