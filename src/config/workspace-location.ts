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
 * Any candidate that resolves at/below `getForbiddenWorkspaceSubtree()` is skipped. Never throws.
 */
export function resolveSafeCreatedWorkspaceParentDir(
	input: { requestedParentDir?: string | null; configuredBaseDir?: string | null } = {},
): SafeWorkspaceParentResolution {
	const forbidden = getForbiddenWorkspaceSubtree();
	const configured = input.configuredBaseDir?.trim() || process.env.NKLEIN_DEV_WORKSPACE_DIR?.trim() || null;

	// The first safe fallback among configured → home default → tmpdir.
	const safeBase = [configured, getDefaultCreatedWorkspaceBaseDir(), tmpdir()]
		.filter((candidate): candidate is string => Boolean(candidate))
		.map((candidate) => resolve(candidate))
		.find((candidate) => !isAtOrBelow(candidate, forbidden)) as string;

	const requested = input.requestedParentDir?.trim();
	if (requested) {
		if (isAtOrBelow(requested, forbidden)) {
			return {
				parentDir: safeBase,
				redirected: true,
				reason: `Requested workspace parent "${requested}" is at/below !Klein's parent folder "${forbidden}"; redirected to "${safeBase}" to avoid polluting the install.`,
			};
		}
		return { parentDir: resolve(requested), redirected: false, reason: null };
	}
	return { parentDir: safeBase, redirected: false, reason: null };
}
