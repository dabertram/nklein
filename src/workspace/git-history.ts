import type {
	RuntimeGitCommit,
	RuntimeGitCommitDiffResponse,
	RuntimeGitLogResponse,
	RuntimeGitRef,
	RuntimeGitRefsResponse,
} from "../core/api-contract";
import {
	parseCommitNameStatusEntries,
	parseCommitNumstatEntries,
	parseCommitPatchEntries,
} from "./git-commit-diff-parsing";
import { runGit } from "./git-utils";

const LOG_FIELD_SEPARATOR = "\x1f";
const LOG_RECORD_SEPARATOR = "\x1e";

const LOG_FORMAT = ["%H", "%h", "%an", "%ae", "%aI", "%s", "%P"].join(LOG_FIELD_SEPARATOR);

type CommitRelation = NonNullable<RuntimeGitCommit["relation"]>;

function parseCommitRecord(record: string): RuntimeGitCommit | null {
	const fields = record.split(LOG_FIELD_SEPARATOR);
	if (fields.length < 7) {
		return null;
	}
	const [hash, shortHash, authorName, authorEmail, dateIso, subject, parentHashes] = fields;
	// A commit with an EMPTY subject is valid (git allows `--allow-empty-message`); only the structural fields
	// (hash/shortHash/date) are required. Dropping empty-subject commits made history + pagination counts
	// inconsistent (git-view P2).
	if (!hash || !shortHash || !authorName || !dateIso) {
		return null;
	}
	return {
		hash,
		shortHash,
		authorName,
		authorEmail: authorEmail ?? "",
		date: dateIso,
		message: subject ?? "",
		parentHashes: (parentHashes ?? "").split(" ").filter(Boolean),
	};
}

export async function getGitLog(options: {
	cwd: string;
	ref?: string | null;
	refs?: string[] | null;
	maxCount?: number;
	skip?: number;
	includeTotalCount?: boolean;
}): Promise<RuntimeGitLogResponse> {
	const { cwd, ref, refs, maxCount = 200, skip = 0, includeTotalCount = true } = options;

	const repoRootResult = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
	if (!repoRootResult.ok || !repoRootResult.stdout) {
		return { ok: false, commits: [], totalCount: 0, error: "No git repository detected." };
	}
	const repoRoot = repoRootResult.stdout;
	const requestedRefs = normalizeRequestedRefs(refs, ref);

	const logArgs = [
		"log",
		"--topo-order",
		"--date-order",
		`--format=${LOG_RECORD_SEPARATOR}${LOG_FORMAT}`,
		`--max-count=${maxCount}`,
		`--skip=${skip}`,
	];

	if (requestedRefs.length > 0) {
		logArgs.push(...requestedRefs);
	}

	const logResult = await runGit(repoRoot, logArgs);
	if (!logResult.ok) {
		return { ok: false, commits: [], totalCount: 0, error: logResult.error ?? "Failed to read git log." };
	}

	const commits: RuntimeGitCommit[] = [];
	const records = logResult.stdout.split(LOG_RECORD_SEPARATOR).filter(Boolean);
	for (const record of records) {
		const commit = parseCommitRecord(record.trim());
		if (commit) {
			commits.push(commit);
		}
	}

	const relationMap = await buildCommitRelationMap(repoRoot, requestedRefs);
	if (relationMap) {
		for (let index = 0; index < commits.length; index += 1) {
			const commit = commits[index];
			if (!commit) {
				continue;
			}
			commits[index] = {
				...commit,
				relation: relationMap.get(commit.hash) ?? "shared",
			};
		}
	}

	// Skip the O(history) `rev-list --count` on background/silent refreshes (git-view P3) — the client retains its
	// last known count on the `-1` sentinel rather than re-counting the whole history on every workspace-state bump.
	if (!includeTotalCount) {
		return { ok: true, commits, totalCount: -1 };
	}

	const countResult = await runGit(repoRoot, [
		"rev-list",
		"--count",
		...(requestedRefs.length > 0 ? requestedRefs : ["HEAD"]),
	]);
	const totalCount = countResult.ok ? Number.parseInt(countResult.stdout, 10) || commits.length : commits.length;

	return { ok: true, commits, totalCount };
}

function parseTrackCounts(trackDescriptor: string | null): { ahead?: number; behind?: number } {
	if (!trackDescriptor) {
		return {};
	}
	const aheadMatch = trackDescriptor.match(/ahead (\d+)/);
	const behindMatch = trackDescriptor.match(/behind (\d+)/);
	const ahead = aheadMatch ? Number.parseInt(aheadMatch[1] ?? "", 10) : Number.NaN;
	const behind = behindMatch ? Number.parseInt(behindMatch[1] ?? "", 10) : Number.NaN;
	return {
		ahead: Number.isFinite(ahead) ? ahead : undefined,
		behind: Number.isFinite(behind) ? behind : undefined,
	};
}

export async function getGitRefs(cwd: string): Promise<RuntimeGitRefsResponse> {
	const repoRootResult = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
	if (!repoRootResult.ok || !repoRootResult.stdout) {
		return { ok: false, refs: [], error: "No git repository detected." };
	}
	const repoRoot = repoRootResult.stdout;

	const [headResult, branchResult, headRefResult] = await Promise.all([
		runGit(repoRoot, ["rev-parse", "HEAD"]),
		runGit(repoRoot, [
			"for-each-ref",
			"--format=%(refname)\x1f%(refname:short)\x1f%(objectname)\x1f%(upstream:short)\x1f%(upstream:track)",
			"refs/heads/",
			"refs/remotes/",
		]),
		runGit(repoRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
	]);

	const headCommit = headResult.ok ? headResult.stdout : null;
	const currentBranch = headRefResult.ok ? headRefResult.stdout : null;
	const isDetached = !headRefResult.ok;
	if (!headResult.ok) {
		return { ok: false, refs: [], error: headResult.error ?? "Failed to resolve HEAD." };
	}
	if (!branchResult.ok) {
		return { ok: false, refs: [], error: branchResult.error ?? "Failed to read git refs." };
	}

	const refs: RuntimeGitRef[] = [];

	if (isDetached && headCommit) {
		refs.push({
			name: headCommit.slice(0, 7),
			type: "detached",
			hash: headCommit,
			isHead: true,
		});
	}

	interface BranchEntry {
		fullName: string;
		name: string;
		type: "branch" | "remote";
		hash: string;
		upstream: string | null;
		ahead?: number;
		behind?: number;
	}

	const branches: BranchEntry[] = [];
	if (branchResult.ok && branchResult.stdout) {
		for (const line of branchResult.stdout.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}
			const parts = trimmed.split("\x1f");
			const fullName = parts[0];
			const name = parts[1];
			const hash = parts[2];
			const upstream = parts[3] || null;
			const trackDescriptor = parts[4] || null;
			if (!fullName || !name || !hash) {
				continue;
			}
			if (fullName.endsWith("/HEAD")) {
				continue;
			}
			const type = fullName.startsWith("refs/remotes/") ? "remote" : "branch";
			branches.push({
				fullName,
				name,
				type,
				hash,
				upstream,
				...parseTrackCounts(type === "branch" ? trackDescriptor : null),
			});
		}
	}

	for (let i = 0; i < branches.length; i++) {
		const branch = branches[i];
		if (!branch) {
			continue;
		}
		refs.push({
			name: branch.name,
			type: branch.type,
			hash: branch.hash,
			isHead: branch.type === "branch" && branch.name === currentBranch,
			upstreamName: branch.type === "branch" ? (branch.upstream ?? undefined) : undefined,
			ahead: branch.ahead,
			behind: branch.behind,
		});
	}

	return { ok: true, refs };
}

function normalizeRequestedRefs(refs: string[] | null | undefined, fallbackRef?: string | null): string[] {
	const candidates = refs && refs.length > 0 ? refs : fallbackRef ? [fallbackRef] : [];
	return Array.from(new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean)));
}

async function buildCommitRelationMap(repoRoot: string, refs: string[]): Promise<Map<string, CommitRelation> | null> {
	if (refs.length !== 2) {
		return null;
	}

	const [selectedRef, upstreamRef] = refs;
	if (!selectedRef || !upstreamRef) {
		return null;
	}

	const [selectedOnlyResult, upstreamOnlyResult] = await Promise.all([
		runGit(repoRoot, ["rev-list", selectedRef, "--not", upstreamRef]),
		runGit(repoRoot, ["rev-list", upstreamRef, "--not", selectedRef]),
	]);

	if (!selectedOnlyResult.ok || !upstreamOnlyResult.ok) {
		return null;
	}

	const relationMap = new Map<string, CommitRelation>();
	for (const hash of selectedOnlyResult.stdout.split("\n")) {
		const trimmedHash = hash.trim();
		if (trimmedHash) {
			relationMap.set(trimmedHash, "selected");
		}
	}
	for (const hash of upstreamOnlyResult.stdout.split("\n")) {
		const trimmedHash = hash.trim();
		if (trimmedHash) {
			relationMap.set(trimmedHash, "upstream");
		}
	}
	return relationMap;
}

export interface CommitDiffFile {
	path: string;
	previousPath?: string;
	status: "modified" | "added" | "deleted" | "renamed";
	additions: number;
	deletions: number;
	patch: string;
}

export async function getCommitDiff(options: {
	cwd: string;
	commitHash: string;
}): Promise<RuntimeGitCommitDiffResponse> {
	const { cwd, commitHash } = options;

	const repoRootResult = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
	if (!repoRootResult.ok || !repoRootResult.stdout) {
		return { ok: false, commitHash, files: [], error: "No git repository detected." };
	}
	const repoRoot = repoRootResult.stdout;

	// Verify the commit actually resolves first. Otherwise an invalid/unknown hash just makes the diff-tree/show calls
	// below come back empty, and the caller sees a misleading "No changes" instead of a real error (git-view P1).
	const resolved = await runGit(repoRoot, ["rev-parse", "--verify", "--quiet", `${commitHash}^{commit}`]);
	if (!resolved.ok || !resolved.stdout) {
		return {
			ok: false,
			commitHash,
			files: [],
			error: `Commit ${commitHash} could not be resolved in this repository.`,
		};
	}

	// Merge commits show NOTHING from a plain diff-tree/show (the combined diff is empty by default), which made the UI
	// render a merge as "No changes" (git-view P2). Detect a merge (≥2 parents) and diff it against its FIRST parent
	// (`--first-parent -m` for diff-tree, `--first-parent` for show) — the change the merge brought to the mainline.
	// Non-merge commits keep `--root` so the initial commit still diffs against the empty tree.
	const parentsResult = await runGit(repoRoot, ["rev-list", "--parents", "-n", "1", commitHash]);
	const parentCount = parentsResult.ok
		? Math.max(0, parentsResult.stdout.trim().split(/\s+/).filter(Boolean).length - 1)
		: 1;
	const isMerge = parentCount >= 2;
	const diffTreeScopeFlags = isMerge ? ["--first-parent", "-m"] : ["--root"];
	const showScopeFlags = isMerge ? ["--first-parent"] : [];

	const [nameStatusResult, numstatResult, diffResult] = await Promise.all([
		runGit(repoRoot, [
			"diff-tree",
			...diffTreeScopeFlags,
			"--no-commit-id",
			"-r",
			"-M",
			"--name-status",
			"-z",
			commitHash,
		]),
		runGit(repoRoot, [
			"diff-tree",
			...diffTreeScopeFlags,
			"--no-commit-id",
			"-r",
			"-M",
			"--numstat",
			"-z",
			commitHash,
		]),
		runGit(
			repoRoot,
			[
				"show",
				"--format=",
				...showScopeFlags,
				"--find-renames",
				"--patch",
				"--diff-algorithm=histogram",
				commitHash,
			],
			{ trimStdout: false },
		),
	]);

	const filesByKey = new Map<string, RuntimeGitCommitDiffResponse["files"][number]>();
	const getEntryKey = (path: string, previousPath?: string): string =>
		previousPath ? `${previousPath}\0${path}` : path;

	const nameStatusEntries = nameStatusResult.ok ? parseCommitNameStatusEntries(nameStatusResult.stdout) : [];
	for (const entry of nameStatusEntries) {
		filesByKey.set(getEntryKey(entry.path, entry.previousPath), {
			path: entry.path,
			previousPath: entry.previousPath,
			status: entry.status,
			additions: 0,
			deletions: 0,
			patch: "",
		});
	}

	const numstatEntries = numstatResult.ok ? parseCommitNumstatEntries(numstatResult.stdout) : [];
	for (const entry of numstatEntries) {
		const key = getEntryKey(entry.path, entry.previousPath);
		const existing = filesByKey.get(key);
		if (existing) {
			existing.additions = entry.additions;
			existing.deletions = entry.deletions;
			continue;
		}
		filesByKey.set(key, {
			path: entry.path,
			previousPath: entry.previousPath,
			status: entry.previousPath ? "renamed" : "modified",
			additions: entry.additions,
			deletions: entry.deletions,
			patch: "",
		});
	}

	const patchEntries = diffResult.ok ? parseCommitPatchEntries(diffResult.stdout) : [];
	for (const entry of patchEntries) {
		const key = getEntryKey(entry.path, entry.previousPath);
		const existing = filesByKey.get(key);
		if (existing) {
			existing.patch = entry.patch;
			continue;
		}
		filesByKey.set(key, {
			path: entry.path,
			previousPath: entry.previousPath,
			status: entry.previousPath ? "renamed" : "modified",
			additions: 0,
			deletions: 0,
			patch: entry.patch,
		});
	}

	const files: RuntimeGitCommitDiffResponse["files"] = [];
	for (const file of filesByKey.values()) {
		files.push(file);
	}

	files.sort((a, b) => a.path.localeCompare(b.path));

	return { ok: true, commitHash, files };
}
