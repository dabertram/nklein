import { homedir } from "node:os";
import { resolve } from "node:path";
import { isPathWithinRoot } from "./path-sandbox";

/**
 * Remote-mode path confinement helpers.
 *
 * When !Klein is started with `--host` (non-loopback bind) an authenticated
 * remote user should not be able to browse the entire host filesystem or
 * create/add projects anywhere. These helpers define the allowed-roots set
 * and enforce it at the API boundary.
 *
 * In local/loopback mode these helpers are never called — full access is
 * preserved as before.
 */

/**
 * Compute the ordered list of allowed filesystem roots for remote-mode
 * browsing and project creation.
 *
 * Roots (in priority order):
 *   1. The user's home directory   — `homedir()`
 *   2. The configured workspace base dir (global setting / env var), if any
 *   3. Any additional explicitly-configured roots
 *
 * All paths are normalised with `resolve()` so we get canonical absolute
 * paths without trailing separators.
 */
export function resolveRemoteBrowseRoots(options: {
	configuredWorkspaceBaseDir?: string | null;
	extraAllowedRoots?: readonly string[];
}): string[] {
	const roots: string[] = [resolve(homedir())];

	const configured = options.configuredWorkspaceBaseDir?.trim();
	if (configured) {
		const r = resolve(configured);
		if (!roots.includes(r)) {
			roots.push(r);
		}
	}

	for (const extra of options.extraAllowedRoots ?? []) {
		const r = resolve(extra.trim());
		if (r && !roots.includes(r)) {
			roots.push(r);
		}
	}

	return roots;
}

/**
 * The result of confining a path to the allowed roots.
 *
 * When `allowed` is true, `matchedRoot` is the first allowed root that
 * contains the candidate path.  When `allowed` is false, the candidate
 * falls outside every allowed root.
 */
export type ConfineResult = { allowed: true; matchedRoot: string } | { allowed: false; matchedRoot: null };

/**
 * Check whether `candidatePath` is within at least one of the
 * `allowedRoots`.
 *
 * - An exact match (candidate === root) is allowed.
 * - A nested path is allowed.
 * - A sibling-prefix attack like `/home/user2` does NOT match the root
 *   `/home/user` because `isPathWithinRoot` uses `relative()` which emits
 *   `"../user2"` in that case.
 * - Symlinks / `..` traversal cannot escape because we `resolve()` both
 *   sides before comparison.
 */
export function confineToAllowedRoots(candidatePath: string, allowedRoots: readonly string[]): ConfineResult {
	const resolved = resolve(candidatePath);
	for (const root of allowedRoots) {
		if (isPathWithinRoot(resolve(root), resolved)) {
			return { allowed: true, matchedRoot: resolve(root) };
		}
	}
	return { allowed: false, matchedRoot: null };
}
