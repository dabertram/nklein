/**
 * F12.67 Merkle file-hash tree — PURE core.
 *
 * Cursor's indexing trick: hash files into a Merkle tree and re-process ONLY the branches whose hash changed
 * (7.9s → 0.5s time-to-first-query). !Klein's repo-map cache today is keyed on personalization text alone — any
 * rebuild re-scans and re-parses EVERY file even when one changed. This core is the diff engine: per-file content
 * hashes roll up into per-directory hashes and a root hash; comparing two snapshots yields the minimal changed set
 * (identical root = nothing to do; identical dir = skip its whole subtree). Hashing is FNV-1a over child hashes —
 * dependency-free, deterministic, cheap; the caller supplies per-file content hashes however it likes.
 */

export interface FileHashEntry {
	/** Workspace-relative path with `/` separators. */
	readonly path: string;
	/** Content hash of the file (any stable string form). */
	readonly hash: string;
}

export interface FileHashTree {
	readonly rootHash: string;
	/** Directory → rolled-up hash ("" = the root directory). Deterministic across entry order. */
	readonly dirHashes: ReadonlyMap<string, string>;
	readonly fileHashes: ReadonlyMap<string, string>;
}

function fnv1a(text: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

function parentDir(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash === -1 ? "" : path.slice(0, slash);
}

/** Build the tree: file hashes roll up through every ancestor directory to a single root hash. */
export function buildFileHashTree(entries: readonly FileHashEntry[]): FileHashTree {
	const fileHashes = new Map<string, string>();
	for (const entry of entries) {
		fileHashes.set(entry.path, entry.hash);
	}
	// Deterministic: accumulate `path:hash` lines per directory in sorted path order, then hash each dir's block
	// bottom-up (a dir's block includes its subdirs' hashes, so a deep change bubbles to the root).
	const filesByDir = new Map<string, string[]>();
	for (const path of [...fileHashes.keys()].sort()) {
		const dir = parentDir(path);
		const lines = filesByDir.get(dir) ?? [];
		lines.push(`${path}:${fileHashes.get(path)}`);
		filesByDir.set(dir, lines);
	}
	const allDirs = new Set<string>([""]);
	for (const dir of filesByDir.keys()) {
		let current = dir;
		while (current !== "") {
			allDirs.add(current);
			current = parentDir(current);
		}
	}
	const dirHashes = new Map<string, string>();
	const depthOf = (dir: string) => (dir === "" ? 0 : dir.split("/").length);
	const dirsDeepestFirst = [...allDirs].sort((a, b) => depthOf(b) - depthOf(a) || a.localeCompare(b));
	for (const dir of dirsDeepestFirst) {
		const ownFiles = filesByDir.get(dir) ?? [];
		const childDirs = dirsDeepestFirst
			.filter((candidate) => candidate !== "" && parentDir(candidate) === dir)
			.sort()
			.map((child) => `${child}/:${dirHashes.get(child)}`);
		dirHashes.set(dir, fnv1a([...ownFiles, ...childDirs].join("\n")));
	}
	return { rootHash: dirHashes.get("") ?? fnv1a(""), dirHashes, fileHashes };
}

export interface FileTreeDiff {
	/** Nothing changed at all — the caller can reuse everything. */
	readonly identical: boolean;
	/** Files added or content-changed in `next` (the re-process set). */
	readonly changedFiles: readonly string[];
	/** Files present in `prev` but gone in `next`. */
	readonly removedFiles: readonly string[];
	/** Fraction of `next`'s files that are unchanged (the reuse win, 0-1; 1 when next is empty). */
	readonly unchangedShare: number;
}

/** Diff two snapshots into the minimal re-process set. Root-hash equality short-circuits to `identical`. */
export function diffFileHashTrees(prev: FileHashTree, next: FileHashTree): FileTreeDiff {
	if (prev.rootHash === next.rootHash) {
		return { identical: true, changedFiles: [], removedFiles: [], unchangedShare: 1 };
	}
	const changedFiles: string[] = [];
	for (const [path, hash] of next.fileHashes) {
		if (prev.fileHashes.get(path) !== hash) {
			changedFiles.push(path);
		}
	}
	const removedFiles: string[] = [];
	for (const path of prev.fileHashes.keys()) {
		if (!next.fileHashes.has(path)) {
			removedFiles.push(path);
		}
	}
	changedFiles.sort();
	removedFiles.sort();
	const total = next.fileHashes.size;
	return {
		identical: false,
		changedFiles,
		removedFiles,
		unchangedShare: total === 0 ? 1 : (total - changedFiles.length) / total,
	};
}
