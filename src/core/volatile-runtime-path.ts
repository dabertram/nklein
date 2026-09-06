/**
 * Volatile-path preflight (factory outage 2026-09-06). The v31 drain root had been created with `mktemp -d`, i.e.
 * under macOS's per-user temp folder (`/var/folders/<x>/<y>/T`). `com.apple.bsd.dirhelper` sweeps that folder every
 * day at 03:35 (`CLEAN_FILES_OLDER_THAN_DAYS=3`) and deleted every runtime-home file untouched for three days: the
 * provider selection, `providers.json`, the workspace index, the board replica id, old session directories, the
 * oldest telemetry day. From 03:41 on, every worker start refused "No native !Klein provider is configured" while the
 * watchdog livelocked around the bounced card — nine hours of a silent factory.
 *
 * This is the pure classifier behind two guards: the CLI warns at boot when the runtime home is volatile, and
 * workspace registration records an observation when a repo path is. Neither blocks — a throwaway fixture project
 * under the temp dir is legitimate — but the operator gets told BEFORE the sweep, not after.
 */

export type VolatilePathSweeper = "macos_dirhelper" | "tmp_cleaner" | "os_tmpdir";

export interface VolatilePathVerdict {
	path: string;
	sweeper: VolatilePathSweeper;
	detail: string;
}

export interface ClassifyVolatilePathOptions {
	/** `os.tmpdir()` of the running process. */
	tmpdir: string;
	/** `process.platform` of the running process. */
	platform: NodeJS.Platform;
}

/** macOS per-user temporary items: `/var/folders/<2 chars>/<hash>/T/…` (dirhelper's sweep root). */
const MACOS_USER_TEMP_FOLDER = /^\/var\/folders\/[^/]+\/[^/]+\/T(?:\/|$)/;

function normalizePath(path: string): string {
	let normalized = path.trim().replace(/\\/g, "/");
	// macOS: /private/var and /private/tmp are the real locations behind /var and /tmp.
	if (normalized.startsWith("/private/")) {
		normalized = normalized.slice("/private".length);
	}
	if (normalized.length > 1) {
		normalized = normalized.replace(/\/+$/, "");
	}
	return normalized;
}

function isUnder(path: string, root: string): boolean {
	if (!root || root === "/") {
		return false;
	}
	return path === root || path.startsWith(`${root}/`);
}

/** The sweeper that will prune `path` on a schedule, or null when the path is durable as far as we can tell. */
export function classifyVolatilePath(path: string, options: ClassifyVolatilePathOptions): VolatilePathVerdict | null {
	const normalized = normalizePath(path);
	if (!normalized) {
		return null;
	}
	if (options.platform === "darwin" && MACOS_USER_TEMP_FOLDER.test(normalized)) {
		return {
			path,
			sweeper: "macos_dirhelper",
			detail:
				"macOS dirhelper sweeps the per-user temp folder daily at 03:35 and deletes files untouched for 3 days",
		};
	}
	if (isUnder(normalized, "/tmp")) {
		return {
			path,
			sweeper: "tmp_cleaner",
			detail:
				options.platform === "darwin"
					? "macOS tmp_cleaner deletes /tmp files untouched for 3 days (daily at 00:00)"
					: "the OS temp janitor (systemd-tmpfiles or equivalent) prunes /tmp on a schedule",
		};
	}
	const tmp = normalizePath(options.tmpdir);
	if (tmp && isUnder(normalized, tmp)) {
		return {
			path,
			sweeper: "os_tmpdir",
			detail: `the path sits under the OS temp directory (${options.tmpdir}), which is pruned on a schedule`,
		};
	}
	return null;
}

/** One operator-facing line: what is volatile, who sweeps it, and what to do. */
export function formatVolatilePathWarning(verdict: VolatilePathVerdict, role: string): string {
	return (
		`${role} ${verdict.path} lives in a temp folder the OS sweeps: ${verdict.detail}. ` +
		"Files not touched for 3 days (provider selection, workspace index, replica id, session state) vanish — " +
		"move it to a durable location (for example under the user home) before running unattended."
	);
}
