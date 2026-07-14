/**
 * Unified-diff added-line extractor (pure) — parses a `git diff` (unified format) into the ADDED lines per file, the
 * exact input {@link assessDeliveryQuality} + the ported diff scanners want (they must inspect only what a card ADDED,
 * never pre-existing code). Keeping this pure + string-only lets the effectful delivery seam stay a thin `git diff …`
 * → parse → assess pipeline.
 *
 * Handles the standard unified diff: `diff --git a/… b/…` file headers, `+++ b/<path>` new-path lines, `@@` hunks, and
 * `+`-prefixed added content (excluding the `+++` header). Renames/deletes with no added content yield an empty list;
 * `/dev/null` targets (pure deletions) are skipped. Binary-file stanzas contribute nothing.
 */

export interface DiffAddedLinesFile {
	readonly path: string;
	readonly addedLines: readonly string[];
}

/** Strip a leading `a/` or `b/` (git's default diff prefixes) from a diff path. */
function stripDiffPrefix(rawPath: string): string {
	return rawPath.replace(/^[ab]\//, "");
}

/**
 * Parse a unified diff into per-file added lines. The current file is keyed off the most recent `+++ b/<path>` header
 * (falling back to the `diff --git` b-path), so added lines always attach to the destination file.
 */
export function parseAddedLinesFromUnifiedDiff(patch: string): DiffAddedLinesFile[] {
	const byPath = new Map<string, string[]>();
	let currentPath: string | null = null;
	let pendingGitBPath: string | null = null;

	const ensure = (path: string): string[] => {
		const existing = byPath.get(path);
		if (existing) {
			return existing;
		}
		const created: string[] = [];
		byPath.set(path, created);
		return created;
	};

	for (const rawLine of patch.replace(/\r\n/g, "\n").split("\n")) {
		if (rawLine.startsWith("diff --git ")) {
			// `diff --git a/x b/y` — remember the b-path as a fallback for files that show no `+++` (e.g. mode-only).
			const match = rawLine.match(/ b\/(\S+)$/);
			pendingGitBPath = match ? match[1] : null;
			currentPath = null;
			continue;
		}
		if (rawLine.startsWith("+++ ")) {
			const target = rawLine.slice(4).trim();
			currentPath = target === "/dev/null" ? null : stripDiffPrefix(target);
			pendingGitBPath = null;
			continue;
		}
		if (rawLine.startsWith("--- ") || rawLine.startsWith("@@") || rawLine.startsWith("index ")) {
			continue;
		}
		// An added content line (but not the `+++` header, handled above).
		if (rawLine.startsWith("+")) {
			const path = currentPath ?? pendingGitBPath;
			if (path) {
				ensure(path).push(rawLine.slice(1));
			}
		}
	}

	return [...byPath.entries()].map(([path, addedLines]) => ({ path, addedLines }));
}
