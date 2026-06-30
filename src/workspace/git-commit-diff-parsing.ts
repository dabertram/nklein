/**
 * Pure parsers for git's per-commit diff output formats, extracted from git-history. Each takes the
 * raw stdout of a `git show`/`git diff` invocation and returns structured entries. No I/O, so they
 * are behavior-preserving and unit-testable.
 */

export interface CommitDiffStatEntry {
	path: string;
	previousPath?: string;
	additions: number;
	deletions: number;
}

/**
 * Parse `--name-status -z` output (NUL-separated): each entry is a status code then its path(s).
 * `R<score>` is a rename (previousPath + path), `A`/`D`/other map to added/deleted/modified.
 */
export function parseCommitNameStatusEntries(output: string): Array<{
	path: string;
	previousPath?: string;
	status: "modified" | "added" | "deleted" | "renamed";
}> {
	const tokens = output.split("\0").filter(Boolean);
	const entries: Array<{
		path: string;
		previousPath?: string;
		status: "modified" | "added" | "deleted" | "renamed";
	}> = [];

	for (let index = 0; index < tokens.length; index += 1) {
		const statusCode = tokens[index];
		if (!statusCode) {
			continue;
		}
		const kind = statusCode.charAt(0);
		if (kind === "R") {
			const previousPath = tokens[index + 1];
			const path = tokens[index + 2];
			if (previousPath && path) {
				entries.push({
					path,
					previousPath,
					status: "renamed",
				});
			}
			index += 2;
			continue;
		}
		const path = tokens[index + 1];
		if (!path) {
			continue;
		}
		entries.push({
			path,
			status: kind === "A" ? "added" : kind === "D" ? "deleted" : "modified",
		});
		index += 1;
	}

	return entries;
}

/**
 * Parse `--numstat -z` output (NUL-separated): `additions\tdeletions\tpath` per file, with `-` for
 * binary files (counted as 0) and a trailing-tab form for renames (path + previousPath follow).
 */
export function parseCommitNumstatEntries(output: string): CommitDiffStatEntry[] {
	const tokens = output.split("\0").filter(Boolean);
	const entries: CommitDiffStatEntry[] = [];

	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (!token) {
			continue;
		}
		const simpleMatch = token.match(/^([-\d]+)\t([-\d]+)\t(.+)$/);
		if (simpleMatch) {
			const additions = simpleMatch[1] === "-" ? 0 : Number.parseInt(simpleMatch[1] ?? "", 10);
			const deletions = simpleMatch[2] === "-" ? 0 : Number.parseInt(simpleMatch[2] ?? "", 10);
			const path = simpleMatch[3];
			if (path) {
				entries.push({
					path,
					additions: Number.isFinite(additions) ? additions : 0,
					deletions: Number.isFinite(deletions) ? deletions : 0,
				});
			}
			continue;
		}

		const renameMatch = token.match(/^([-\d]+)\t([-\d]+)\t$/);
		if (!renameMatch) {
			continue;
		}
		const previousPath = tokens[index + 1];
		const path = tokens[index + 2];
		const additions = renameMatch[1] === "-" ? 0 : Number.parseInt(renameMatch[1] ?? "", 10);
		const deletions = renameMatch[2] === "-" ? 0 : Number.parseInt(renameMatch[2] ?? "", 10);
		if (previousPath && path) {
			entries.push({
				path,
				previousPath,
				additions: Number.isFinite(additions) ? additions : 0,
				deletions: Number.isFinite(deletions) ? deletions : 0,
			});
		}
		index += 2;
	}

	return entries;
}

/**
 * Split unified-diff patch output into per-file segments on the `diff --git` header, returning each
 * file's path (and previousPath when it differs) plus its full patch text.
 */
export function parseCommitPatchEntries(output: string): Array<{
	path: string;
	previousPath?: string;
	patch: string;
}> {
	const patchSegments = output.split(/^diff --git /m);
	const entries: Array<{
		path: string;
		previousPath?: string;
		patch: string;
	}> = [];

	for (const segment of patchSegments) {
		if (!segment.trim()) {
			continue;
		}
		const fullPatch = `diff --git ${segment}`;
		const headerMatch = fullPatch.match(/^diff --git a\/(.+) b\/(.+)$/m);
		if (!headerMatch?.[1] || !headerMatch[2]) {
			continue;
		}
		const previousPath = headerMatch[1];
		const path = headerMatch[2];
		entries.push({
			path,
			previousPath: previousPath !== path ? previousPath : undefined,
			patch: fullPatch,
		});
	}

	return entries;
}
