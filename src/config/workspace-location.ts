import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Safe-location policy for project workspaces that !Klein CREATES (dev-test fixtures, scaffolds, clones).
 *
 * Hard invariant (user directive, 2026-06-25): a created workspace must NEVER live below !Klein's own parent
 * folder. Seeding fixtures there pollutes the !Klein checkout and its sibling repos / git worktrees — a real
 * incident happened where a dev-test scaffold `git init`+committed into the dev repo's own branch (it even flipped
 * `core.bare`). Created workspaces go to a **user-configured path** (global setting / `NKLEIN_DEV_WORKSPACE_DIR`)
 * or a **home-directory default**, always outside the install subtree.
 *
 * This is purely about workspaces !Klein *creates*. Existing user projects added from anywhere are unaffected.
 */

/** The !Klein install/repo root (this module is `src/config/`, so two levels up). */
function getKleinInstallRoot(): string {
	return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/**
 * The forbidden subtree: !Klein's own PARENT folder. No created workspace may live at or below it — that's where
 * the !Klein checkout (and typically the user's sibling repos) live, so creating there risks polluting them.
 */
export function getForbiddenWorkspaceSubtree(): string {
	return dirname(getKleinInstallRoot());
}

/** Home-directory default base for created workspaces (well outside the install subtree). */
export function getDefaultCreatedWorkspaceBaseDir(): string {
	return join(homedir(), ".nklein", "dev-workspaces");
}

/** True when `child` is the same as, or nested below, `parent`. */
function isAtOrBelow(child: string, parent: string): boolean {
	const rel = relative(resolve(parent), resolve(child));
	return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

/**
 * True when `candidate` is at/below an existing git work tree (i.e. some ancestor dir contains a `.git`).
 *
 * This is the ROBUST, location-independent guard against the dev-test pollution incident: it does NOT depend on
 * where `import.meta.url` resolves (which is fragile — from inside a worktree it points at the worktree, so the
 * `dirname(installRoot)` check only forbids `.claude/worktrees`, not the rest of the repo). A created workspace that
 * is `git init`-ed inside the !Klein repo — or inside any of its `.claude/worktrees/*` checkouts, which share the
 * repo's `.git/config` — corrupts that repo (fixture commits, a flipped `core.bare`). Since the !Klein repo and every
 * worktree IS a git work tree, refusing any candidate inside one makes creation safe wherever the code runs from.
 *
 * Walks up from the candidate (which may not exist yet) to the filesystem root; a `.git` entry (dir for a normal
 * repo, file for a worktree/submodule) marks an enclosing work tree.
 */
export function isPathInsideGitWorkTree(candidate: string): boolean {
	let dir = resolve(candidate);
	while (true) {
		if (existsSync(join(dir, ".git"))) {
			return true;
		}
		const parent = dirname(dir);
		if (parent === dir) {
			return false;
		}
		dir = parent;
	}
}

export interface SafeWorkspaceParentResolution {
	/** The safe parent directory a workspace may be created under. */
	parentDir: string;
	/** True when a requested/configured path was rejected for being below the forbidden subtree. */
	redirected: boolean;
	/** Human-readable reason when redirected (for logging); null otherwise. */
	reason: string | null;
}

/**
 * Resolve a SAFE parent directory for a workspace !Klein is about to create. Preference order:
 *   1. an explicit `requestedParentDir` — honored only if it is NOT below the forbidden subtree;
 *   2. a `configuredBaseDir` (global setting) or `NKLEIN_DEV_WORKSPACE_DIR` — if safe;
 *   3. the home-directory default;
 *   4. the OS temp dir (ultimate fallback, e.g. if the repo itself sits directly in the home dir).
 * A candidate is UNSAFE if it is at/below `getForbiddenWorkspaceSubtree()` OR inside an existing git work tree
 * (`isPathInsideGitWorkTree` — the robust guard that catches the !Klein repo and ALL its `.claude/worktrees/*`
 * checkouts regardless of where this code runs from). Never throws.
 */
export function resolveSafeCreatedWorkspaceParentDir(
	input: { requestedParentDir?: string | null; configuredBaseDir?: string | null } = {},
): SafeWorkspaceParentResolution {
	const forbidden = getForbiddenWorkspaceSubtree();
	// A candidate is UNSAFE if it is at/below !Klein's parent folder OR inside any existing git work tree (the latter
	// is the robust, location-independent guard — it catches the !Klein repo and every `.claude/worktrees/*` checkout
	// no matter where this code runs from, which the `dirname(import.meta.url)` check alone does not).
	const isUnsafe = (candidate: string): boolean =>
		isAtOrBelow(candidate, forbidden) || isPathInsideGitWorkTree(candidate);
	const configured = input.configuredBaseDir?.trim() || process.env.NKLEIN_DEV_WORKSPACE_DIR?.trim() || null;

	// The first safe fallback among configured → home default → tmpdir (tmpdir is the guaranteed non-repo backstop).
	const safeBase =
		[configured, getDefaultCreatedWorkspaceBaseDir(), tmpdir()]
			.filter((candidate): candidate is string => Boolean(candidate))
			.map((candidate) => resolve(candidate))
			.find((candidate) => !isUnsafe(candidate)) ?? resolve(tmpdir());

	const requested = input.requestedParentDir?.trim();
	if (requested) {
		if (isUnsafe(requested)) {
			return {
				parentDir: safeBase,
				redirected: true,
				reason: `Requested workspace parent "${requested}" is unsafe (at/below !Klein's parent folder "${forbidden}", or inside a git work tree); redirected to "${safeBase}" to avoid polluting a repo.`,
			};
		}
		return { parentDir: resolve(requested), redirected: false, reason: null };
	}
	return { parentDir: safeBase, redirected: false, reason: null };
}
