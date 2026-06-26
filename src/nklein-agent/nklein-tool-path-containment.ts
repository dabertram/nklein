import { realpath as defaultRealpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Defense-in-depth workspace containment for the NKlein agent file tools (security finding §5.Y #4).
 *
 * The Docker sandbox proxy is the primary containment boundary for normal task sessions (the agent only ever
 * perceives `/workspaces/<taskId>` and tool calls run inside the container). But the *shared* file tools
 * (`write_file(s)`, `edit_file`, `read_large_file`) and the approval policy resolve absolute paths directly, so a
 * host-cwd session (home/chat), a restart, or a future/fallback integration that uses them outside the sandbox is
 * NOT itself confined. This helper makes containment intrinsic to the tools: a target is allowed iff it resolves
 * within the tool's workspace root.
 *
 * The single root every caller passes is the **workspace root the tool/approval was constructed with** — the
 * agent-perceived cwd. That is the correct legitimate root in every call path:
 *   - In-container task tool: the root is the in-container `/workspaces/<taskId>`, so a `/workspaces/<taskId>/foo`
 *     absolute path resolves *within* the root and stays allowed (the sandbox dir IS the root).
 *   - Home/chat host-cwd session: the root is the host project cwd, so host-absolute paths within it stay allowed.
 *   - Approval policy: constructed with the host workspace root; for a sandboxed task the agent uses container
 *     paths, so callers pass `sandboxTaskId` and we treat `/workspaces/<taskId>` as an additional allowed root.
 *
 * Only genuine escapes are newly rejected: a host-absolute path *outside* the root, `..` traversal past the root,
 * and (via realpath) symlink escapes. Errors are workspace-relative and never echo a host path.
 */

export interface ToolPathContainmentOptions {
	/**
	 * When set, the sandbox container workspace dir (`/workspaces/<taskId>`) is treated as an additional allowed
	 * root. Used by the approval policy, which is constructed with the HOST workspace root but sees the agent's
	 * CONTAINER paths for a Docker-isolated task. Pass the deterministic container workdir; see
	 * `buildAgentSandboxWorkdir`.
	 */
	sandboxWorkdir?: string | null;
}

export interface ContainmentSuccess {
	ok: true;
	/** The absolute on-disk path to operate on (lexically resolved within the matched root). */
	absolutePath: string;
	/** The normalized root-relative path, for non-leaky agent-facing copy. */
	relativePath: string;
	/** The allowed root the path resolved within (the workspace root or the sandbox workdir). */
	matchedRoot: string;
}

export interface ContainmentFailure {
	ok: false;
	/** A workspace-relative, non-leaky reason suitable for returning to the agent. */
	message: string;
}

export type ContainmentResult = ContainmentSuccess | ContainmentFailure;

function normalizeRoot(root: string): string {
	return resolve(root);
}

/** Is `candidate` equal to or a descendant of `root` (both already absolute+resolved)? */
function isWithin(root: string, candidate: string): boolean {
	if (candidate === root) {
		return true;
	}
	const rel = relative(root, candidate);
	return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Lexically resolve `rawPath` against the allowed roots and confine it. This is the load-bearing, synchronous
 * guard: a workspace-relative path is resolved against the primary root; an absolute path is accepted only if it
 * lands within one of the allowed roots (primary root + optional sandbox workdir). `..` traversal that escapes is
 * rejected. No filesystem access — safe for writes to not-yet-existing files.
 */
export function confineToolPath(
	workspaceRoot: string,
	rawPath: string,
	options: ToolPathContainmentOptions = {},
): ContainmentResult {
	const requested = rawPath.trim();
	if (!requested) {
		return { ok: false, message: "Provide a non-empty path within the workspace." };
	}

	const primaryRoot = normalizeRoot(workspaceRoot);
	const roots: string[] = [primaryRoot];
	const sandboxWorkdir = options.sandboxWorkdir?.trim();
	if (sandboxWorkdir) {
		const resolvedSandbox = normalizeRoot(sandboxWorkdir);
		if (!roots.includes(resolvedSandbox)) {
			roots.push(resolvedSandbox);
		}
	}

	if (isAbsolute(requested)) {
		const resolvedAbsolute = resolve(requested);
		for (const root of roots) {
			if (isWithin(root, resolvedAbsolute)) {
				const rel = relative(root, resolvedAbsolute);
				return {
					ok: true,
					absolutePath: resolvedAbsolute,
					relativePath: rel === "" ? "." : rel,
					matchedRoot: root,
				};
			}
		}
		// Absolute, but inside none of the allowed roots → genuine escape. Do NOT echo the resolved path: a relative
		// form would reveal the workspace depth (the `../` count), and the raw input may itself be a host path. State
		// the escape without a path so nothing about the host layout leaks into the agent's view.
		return {
			ok: false,
			message: "Absolute path is outside the workspace. Use a path relative to the workspace root.",
		};
	}

	// Relative path: resolve against the primary workspace root and confine.
	const resolvedRelative = resolve(primaryRoot, requested);
	if (!isWithin(primaryRoot, resolvedRelative)) {
		return { ok: false, message: `Path escapes the workspace: ${requested}` };
	}
	const rel = relative(primaryRoot, resolvedRelative);
	return {
		ok: true,
		absolutePath: resolvedRelative,
		relativePath: rel === "" ? "." : rel,
		matchedRoot: primaryRoot,
	};
}

/**
 * After the lexical check passes, confirm the REAL on-disk path (symlinks resolved) still resolves within the
 * matched root. Closes the symlink-escape hole: a workspace symlink pointing outside the root passes the lexical
 * check but its real path lands outside. Mirrors the proven pattern in `chat-workspace-tools.ts`.
 *
 * The target may not exist yet (a new file from `write_file`), so we walk up to the nearest existing ancestor and
 * confine that — a symlinked parent that escapes the matched root is rejected; a new file inside a real workspace
 * directory is allowed. Returns `{ ok: true }` when safe, or a non-leaky failure.
 */
export async function assertRealToolPathWithinRoot(
	matchedRoot: string,
	absolutePath: string,
	relativePath: string,
	realpathFn: (path: string) => Promise<string> = defaultRealpath,
): Promise<{ ok: true } | { ok: false; message: string }> {
	let realRoot: string;
	try {
		realRoot = await realpathFn(matchedRoot);
	} catch {
		// The root itself does not exist on disk (e.g. an in-container path being validated host-side, or a not-yet
		// materialized workspace). The lexical confinement above already guaranteed containment; without a real root
		// to compare against there is no symlink check to perform, so do not reject a lexically-safe path.
		return { ok: true };
	}
	const rootPrefix = realRoot.endsWith(sep) ? realRoot : `${realRoot}${sep}`;
	const isUnderRealRoot = (candidate: string): boolean => candidate === realRoot || candidate.startsWith(rootPrefix);

	let candidate = absolutePath;
	for (;;) {
		try {
			const real = await realpathFn(candidate);
			if (!isUnderRealRoot(real)) {
				return { ok: false, message: `Path escapes the workspace: ${relativePath}` };
			}
			return { ok: true };
		} catch {
			const parent = dirname(candidate);
			if (parent === candidate) {
				// Reached the filesystem root with nothing existing. The lexical check already confined the path; with
				// no existing ancestor there is no symlink to escape through, so allow it (a brand-new tree).
				return { ok: true };
			}
			candidate = parent;
		}
	}
}
