import { lstat, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { RuntimeBoardCard, RuntimeBoardColumnId, RuntimeBoardData } from "../core/api-contract";
import type { WorkPackage } from "../core/work-package-dispatch";
import { integrationMergeOrder } from "../core/work-package-integration-order";
import { runGit as defaultRunGit, type RunGitOptions } from "./git-utils";
import { resolveTaskResultBranchCommit as defaultResolveTaskResultBranchCommit } from "./task-result-branches";

export type TaskWorktreeAutoMergeColumn = Extract<RuntimeBoardColumnId, "review" | "completed">;

export interface TaskWorktreeAutoMergeCandidate {
	task: RuntimeBoardCard;
	columnId: TaskWorktreeAutoMergeColumn;
	boardIndex: number;
}

export interface TaskWorktreeAutoMergeSuccess {
	type: "merged" | "skipped";
	taskId: string;
	headCommit: string;
	reason: string;
	/** §5.AK Phase B: set when a merge conflict was resolved by the `::merge` agent instead of aborting. */
	resolvedByAgent?: boolean;
}

export interface TaskWorktreeAutoMergeConflict {
	type: "conflict";
	taskId: string;
	headCommit: string;
	conflictedPaths: string[];
	message: string;
}

export interface TaskWorktreeAutoMergeBlocked {
	type: "blocked";
	taskId: string | null;
	reason: string;
}

export type TaskWorktreeAutoMergeStep =
	| TaskWorktreeAutoMergeSuccess
	| TaskWorktreeAutoMergeConflict
	| TaskWorktreeAutoMergeBlocked;

export interface TaskWorktreeAutoMergeResult {
	ok: boolean;
	steps: TaskWorktreeAutoMergeStep[];
	mergedTaskIds: string[];
	skippedTaskIds: string[];
	blocked?: TaskWorktreeAutoMergeBlocked;
	conflict?: TaskWorktreeAutoMergeConflict;
}

type RunGit = (cwd: string, args: string[], options?: RunGitOptions) => ReturnType<typeof defaultRunGit>;
type ResolveTaskResultBranchCommit = typeof defaultResolveTaskResultBranchCommit;

/** One conflicted file's agent-resolved contents (repo-relative path, full file content). */
export interface TaskWorktreeAutoMergeResolvedFile {
	path: string;
	content: string;
}

/**
 * §5.AK Phase B: the merge-conflict RESOLUTION AGENT seam. Called while the host merge is STILL in its
 * conflicted state (before any abort) with the conflicting task + paths; resolves to the agent-resolved
 * contents of every conflicted file, or null to fall back to today's abort-and-surface. Implementations run
 * the bounded `::merge` sandbox session — this module only applies the returned contents deterministically.
 */
export type TaskWorktreeAutoMergeConflictResolver = (input: {
	taskId: string;
	headCommit: string;
	conflictedPaths: string[];
}) => Promise<{ resolvedFiles: TaskWorktreeAutoMergeResolvedFile[] } | null>;

/**
 * Conflict-marker heuristic for agent-resolved contents: any line starting with the 7-character ours/theirs
 * (or diff3 base) markers means the "resolution" still contains a conflict hunk. `=======` is deliberately
 * NOT matched alone — it legitimately appears in Markdown setext headings and comment rules.
 */
const LEFTOVER_CONFLICT_MARKER_PATTERN = /^(?:<{7}|>{7}|\|{7})(?: |$)/mu;

const defaultWriteResolvedFile = async (absolutePath: string, content: string): Promise<void> => {
	await writeFile(absolutePath, content, "utf8");
};

/** What the host filesystem holds at a resolved-file target path (lstat, so symlinks are NOT followed). */
export type TaskWorktreeAutoMergeHostPathKind = "file" | "absent" | "other";

const defaultInspectResolvedFilePath = async (absolutePath: string): Promise<TaskWorktreeAutoMergeHostPathKind> => {
	try {
		const stats = await lstat(absolutePath);
		return stats.isFile() ? "file" : "other";
	} catch (error) {
		return (error as NodeJS.ErrnoException | null)?.code === "ENOENT" ? "absent" : "other";
	}
};

/** True when `git rev-parse -q --verify MERGE_HEAD` confirms the host repo is still mid-merge. */
async function isMergeInProgress(runGit: RunGit, repoPath: string): Promise<boolean> {
	const mergeHead = await runGit(repoPath, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]);
	return mergeHead.ok;
}

/**
 * Applies an agent's conflict resolution to the host repo's IN-CONFLICT merge state: overwrite the conflicted
 * files with the resolved contents, `git add` them, verify no leftover conflict marker survived (in-memory scan
 * on the exact written contents), and complete the merge with `git commit --no-edit`. Returns false on ANY
 * doubt — the caller then aborts the merge (when still in progress), which discards these worktree/index
 * changes and restores today's fail-safe exactly.
 *
 * Host-safety guards (adversarial review, 2026-07): every target must resolve INSIDE the repo and must be a
 * regular file or absent on the host (lstat — a symlink/dir/fifo target would make writeFile land somewhere
 * else entirely), and the merge must STILL be in progress (MERGE_HEAD present) immediately before the writes
 * and again immediately before the commit — the multi-minute agent session leaves a window in which another
 * actor (concurrent delivery, operator) can consume or abort the host merge state.
 */
async function tryApplyAgentConflictResolution(input: {
	repoPath: string;
	taskId: string;
	headCommit: string;
	conflictedPaths: string[];
	resolveConflict: TaskWorktreeAutoMergeConflictResolver;
	runGit: RunGit;
	writeResolvedFile: (absolutePath: string, content: string) => Promise<void>;
	inspectResolvedFilePath: (absolutePath: string) => Promise<TaskWorktreeAutoMergeHostPathKind>;
}): Promise<boolean> {
	let resolution: { resolvedFiles: TaskWorktreeAutoMergeResolvedFile[] } | null = null;
	try {
		resolution = await input.resolveConflict({
			taskId: input.taskId,
			headCommit: input.headCommit,
			conflictedPaths: input.conflictedPaths,
		});
	} catch {
		return false;
	}
	if (!resolution) {
		return false;
	}
	const contentByPath = new Map(resolution.resolvedFiles.map((file) => [file.path, file.content]));
	// A partial resolution cannot complete the merge: every conflicted path must be covered, and every covered
	// file must be marker-free. Extra (non-conflicted) paths are ignored — the agent only owns the conflict.
	if (input.conflictedPaths.some((path) => !contentByPath.has(path))) {
		return false;
	}
	if (input.conflictedPaths.some((path) => LEFTOVER_CONFLICT_MARKER_PATTERN.test(contentByPath.get(path) ?? ""))) {
		return false;
	}
	// Pre-write host checks on EVERY target before writing ANY (no partial writes): repo containment
	// (resolve + prefix — a `../` escape must never leave the repo) and regular-file-or-absent (lstat).
	const repoRoot = resolve(input.repoPath);
	const absolutePathByPath = new Map<string, string>();
	try {
		for (const path of input.conflictedPaths) {
			const absolutePath = resolve(repoRoot, path);
			if (!absolutePath.startsWith(`${repoRoot}${sep}`)) {
				return false;
			}
			if ((await input.inspectResolvedFilePath(absolutePath)) === "other") {
				return false;
			}
			absolutePathByPath.set(path, absolutePath);
		}
	} catch {
		return false;
	}
	// The merge must STILL be in progress right before the writes — otherwise the resolution has lost its
	// target state (another delivery/operator consumed it) and writing would only dirty the host.
	if (!(await isMergeInProgress(input.runGit, input.repoPath))) {
		return false;
	}
	try {
		for (const path of input.conflictedPaths) {
			await input.writeResolvedFile(
				absolutePathByPath.get(path) ?? resolve(repoRoot, path),
				contentByPath.get(path) ?? "",
			);
		}
	} catch {
		return false;
	}
	const add = await input.runGit(input.repoPath, ["add", "--", ...input.conflictedPaths]);
	if (!add.ok) {
		return false;
	}
	// Belt-and-braces marker rescan on the EXACT content that was written (byte-identical to the staged files).
	// `git diff --cached --check` is deliberately NOT authoritative here: git flags ANY added line of exactly
	// seven marker characters as "leftover conflict marker" — including a bare `=======`, which legitimately
	// appears as a Markdown setext underline / RST title and which LEFTOVER_CONFLICT_MARKER_PATTERN deliberately
	// allows (see the pattern's doc note). The staged check still runs for its diagnostic output only.
	if (input.conflictedPaths.some((path) => LEFTOVER_CONFLICT_MARKER_PATTERN.test(contentByPath.get(path) ?? ""))) {
		return false;
	}
	await input.runGit(input.repoPath, ["diff", "--cached", "--check", "--", ...input.conflictedPaths]);
	// Re-verify the merge is still in progress immediately before completing it: `git commit --no-edit` without
	// our MERGE_HEAD/MERGE_MSG would either fail (empty message) or — worse — complete a DIFFERENT in-flight
	// merge with these contents. Fail closed instead.
	if (!(await isMergeInProgress(input.runGit, input.repoPath))) {
		return false;
	}
	const commit = await input.runGit(input.repoPath, ["commit", "--no-edit"]);
	return commit.ok;
}

function collectCandidateTasks(input: {
	board: RuntimeBoardData;
	columns: readonly TaskWorktreeAutoMergeColumn[];
	taskIds?: readonly string[];
}): TaskWorktreeAutoMergeCandidate[] {
	const allowedColumns = new Set<RuntimeBoardColumnId>(input.columns);
	const allowedTaskIds = input.taskIds ? new Set(input.taskIds.map((taskId) => taskId.trim()).filter(Boolean)) : null;
	const candidates: TaskWorktreeAutoMergeCandidate[] = [];
	let boardIndex = 0;
	for (const column of input.board.columns) {
		for (const task of column.cards) {
			if (allowedColumns.has(column.id) && (!allowedTaskIds || allowedTaskIds.has(task.id))) {
				candidates.push({
					task,
					columnId: column.id as TaskWorktreeAutoMergeColumn,
					boardIndex,
				});
			}
			boardIndex += 1;
		}
	}
	return candidates;
}

export function orderTaskWorktreeAutoMergeCandidates(
	board: RuntimeBoardData,
	candidates: readonly TaskWorktreeAutoMergeCandidate[],
): TaskWorktreeAutoMergeCandidate[] {
	const candidateByTaskId = new Map(candidates.map((candidate) => [candidate.task.id, candidate]));
	const inboundCounts = new Map(candidates.map((candidate) => [candidate.task.id, 0]));
	const dependentsByPrerequisiteTaskId = new Map<string, string[]>();
	for (const dependency of board.dependencies) {
		if (!candidateByTaskId.has(dependency.fromTaskId) || !candidateByTaskId.has(dependency.toTaskId)) {
			continue;
		}
		inboundCounts.set(dependency.fromTaskId, (inboundCounts.get(dependency.fromTaskId) ?? 0) + 1);
		const dependents = dependentsByPrerequisiteTaskId.get(dependency.toTaskId) ?? [];
		dependents.push(dependency.fromTaskId);
		dependentsByPrerequisiteTaskId.set(dependency.toTaskId, dependents);
	}

	// §5.AK Phase C: among cards that become mergeable at the SAME time (no dependency edge between them —
	// newly common now that file-overlap parallelism defaults to "allow", so independent cards can complete with
	// SHARED write scopes), prefer the conflict-minimizing merge order the integration-order core computes from
	// their declared write scopes (filesLikelyTouched). This only REORDERS simultaneously-ready cards; the
	// dependency topo-sort structure and every git operation below are untouched. When no scopes overlap the
	// integration order equals input order, so board order is the deterministic fallback (byBoardOrder second key).
	const integrationRank = (() => {
		const packages: WorkPackage[] = candidates.map((candidate) => ({
			id: candidate.task.id,
			writeScope: candidate.task.filesLikelyTouched ?? [],
			dependsOn: board.dependencies
				.filter((dependency) => dependency.fromTaskId === candidate.task.id)
				.map((dependency) => dependency.toTaskId),
		}));
		const order = integrationMergeOrder(packages);
		return new Map(order.map((id, index) => [id, index]));
	})();
	const byBoardOrder = (left: string, right: string) => {
		const rankDelta = (integrationRank.get(left) ?? 0) - (integrationRank.get(right) ?? 0);
		if (rankDelta !== 0) {
			return rankDelta;
		}
		return (candidateByTaskId.get(left)?.boardIndex ?? 0) - (candidateByTaskId.get(right)?.boardIndex ?? 0);
	};
	const readyTaskIds = [...inboundCounts.entries()]
		.filter(([, count]) => count === 0)
		.map(([taskId]) => taskId)
		.sort(byBoardOrder);
	const ordered: TaskWorktreeAutoMergeCandidate[] = [];
	while (readyTaskIds.length > 0) {
		const taskId = readyTaskIds.shift();
		if (!taskId) {
			continue;
		}
		const candidate = candidateByTaskId.get(taskId);
		if (!candidate) {
			continue;
		}
		ordered.push(candidate);
		for (const dependentTaskId of dependentsByPrerequisiteTaskId.get(taskId) ?? []) {
			const nextCount = (inboundCounts.get(dependentTaskId) ?? 0) - 1;
			inboundCounts.set(dependentTaskId, nextCount);
			if (nextCount === 0) {
				readyTaskIds.push(dependentTaskId);
				readyTaskIds.sort(byBoardOrder);
			}
		}
	}
	if (ordered.length === candidates.length) {
		return ordered;
	}
	const orderedTaskIds = new Set(ordered.map((candidate) => candidate.task.id));
	return [
		...ordered,
		...candidates
			.filter((candidate) => !orderedTaskIds.has(candidate.task.id))
			.sort((left, right) => left.boardIndex - right.boardIndex),
	];
}

function parseNullSeparatedPaths(output: string): string[] {
	return output
		.split("\0")
		.map((path) => path.trim())
		.filter((path) => path.length > 0);
}

export async function mergeTaskWorktreesInDependencyOrder(input: {
	repoPath: string;
	board: RuntimeBoardData;
	columns: readonly TaskWorktreeAutoMergeColumn[];
	taskIds?: readonly string[];
	runGit?: RunGit;
	resolveTaskResultBranchCommit?: ResolveTaskResultBranchCommit;
	/** §5.AK Phase B: optional merge-conflict resolution agent; absent ⇒ today's abort-and-surface. */
	resolveConflict?: TaskWorktreeAutoMergeConflictResolver;
	/** Test seam for the resolved-content writes; defaults to fs writeFile. */
	writeResolvedFile?: (absolutePath: string, content: string) => Promise<void>;
	/** Test seam for the pre-write host-path type check; defaults to fs lstat (regular file / absent / other). */
	inspectResolvedFilePath?: (absolutePath: string) => Promise<TaskWorktreeAutoMergeHostPathKind>;
}): Promise<TaskWorktreeAutoMergeResult> {
	const runGit = input.runGit ?? defaultRunGit;
	const resolveTaskResultBranchCommit = input.resolveTaskResultBranchCommit ?? defaultResolveTaskResultBranchCommit;
	const steps: TaskWorktreeAutoMergeStep[] = [];
	const mergedTaskIds: string[] = [];
	const skippedTaskIds: string[] = [];
	const status = await runGit(input.repoPath, ["status", "--porcelain", "--", ".", ":(exclude).nklein/nklein"]);
	if (!status.ok || status.stdout.trim()) {
		const blocked: TaskWorktreeAutoMergeBlocked = {
			type: "blocked",
			taskId: null,
			reason: status.ok
				? "Base workspace has uncommitted changes; merge task results from a clean base."
				: (status.error ?? "Could not read base workspace status."),
		};
		return { ok: false, steps: [blocked], mergedTaskIds, skippedTaskIds, blocked };
	}

	const candidates = orderTaskWorktreeAutoMergeCandidates(
		input.board,
		collectCandidateTasks({
			board: input.board,
			columns: input.columns,
			taskIds: input.taskIds,
		}),
	);
	for (const candidate of candidates) {
		const task = candidate.task;
		const branch = await runGit(input.repoPath, ["branch", "--show-current"]);
		if (!branch.ok || branch.stdout.trim() !== task.baseRef) {
			const blocked: TaskWorktreeAutoMergeBlocked = {
				type: "blocked",
				taskId: task.id,
				reason: `Base workspace must be checked out on "${task.baseRef}" before merging task "${task.id}".`,
			};
			steps.push(blocked);
			return { ok: false, steps, mergedTaskIds, skippedTaskIds, blocked };
		}

		// A task's deliverable is its `nklein/tasks/<task>` result branch (the worktree subsystem is retired,
		// §5.A). With no result branch there is nothing host-visible to merge, so skip the task rather than
		// reaching into a (now-nonexistent) host worktree.
		const headCommit = await resolveTaskResultBranchCommit({
			repoPath: input.repoPath,
			taskId: task.id,
			runGit,
		});
		if (!headCommit) {
			const skipped: TaskWorktreeAutoMergeSuccess = {
				type: "skipped",
				taskId: task.id,
				headCommit: "",
				reason: "no task result branch to merge.",
			};
			steps.push(skipped);
			skippedTaskIds.push(task.id);
			continue;
		}
		const alreadyMerged = await runGit(input.repoPath, ["merge-base", "--is-ancestor", headCommit, "HEAD"]);
		if (alreadyMerged.ok) {
			const skipped: TaskWorktreeAutoMergeSuccess = {
				type: "skipped",
				taskId: task.id,
				headCommit,
				reason: "task result HEAD is already merged into the base workspace.",
			};
			steps.push(skipped);
			skippedTaskIds.push(task.id);
			continue;
		}

		const merge = await runGit(input.repoPath, ["merge", "--no-ff", "--no-edit", headCommit]);
		if (!merge.ok) {
			const conflicted = await runGit(input.repoPath, ["diff", "--name-only", "--diff-filter=U", "-z"], {
				trimStdout: false,
			});
			const conflictedPaths = conflicted.ok ? parseNullSeparatedPaths(conflicted.stdout) : [];
			// §5.AK Phase B: hand the STILL-CONFLICTED merge state to the resolution agent before aborting. A
			// successful application completes the merge commit in place; ANY other outcome (null, error, partial
			// coverage, leftover markers, failed commit) falls through to the abort below — today's fail-safe.
			if (input.resolveConflict && conflictedPaths.length > 0) {
				const applied = await tryApplyAgentConflictResolution({
					repoPath: input.repoPath,
					taskId: task.id,
					headCommit,
					conflictedPaths,
					resolveConflict: input.resolveConflict,
					runGit,
					writeResolvedFile: input.writeResolvedFile ?? defaultWriteResolvedFile,
					inspectResolvedFilePath: input.inspectResolvedFilePath ?? defaultInspectResolvedFilePath,
				});
				if (applied) {
					const merged: TaskWorktreeAutoMergeSuccess = {
						type: "merged",
						taskId: task.id,
						headCommit,
						reason:
							"merge conflict resolved by the merge agent; task result HEAD merged into the base workspace.",
						resolvedByAgent: true,
					};
					steps.push(merged);
					mergedTaskIds.push(task.id);
					continue;
				}
			}
			// Fail-safe abort — but only when the merge is actually still in progress (the resolution window is
			// minutes long; another actor may already have consumed/aborted it, and `merge --abort` would then
			// stomp on THAT actor's state). A FAILED abort leaves the host needing operator attention, so its
			// outcome is checked and surfaced loudly in the conflict message — never thrown.
			let abortWarning = "";
			if (await isMergeInProgress(runGit, input.repoPath)) {
				const abort = await runGit(input.repoPath, ["merge", "--abort"]);
				if (!abort.ok) {
					const statusAfterFailedAbort = await runGit(input.repoPath, ["status", "--porcelain"]);
					const statusHead = statusAfterFailedAbort.stdout.split("\n").slice(0, 10).join("\n").trim();
					abortWarning =
						` WARNING: \`git merge --abort\` FAILED (${abort.stderr || abort.error || "unknown error"}) — ` +
						`the base workspace may need manual cleanup. git status --porcelain (head):\n${statusHead || "(empty)"}`;
				}
			}
			const conflict: TaskWorktreeAutoMergeConflict = {
				type: "conflict",
				taskId: task.id,
				headCommit,
				conflictedPaths,
				message: (merge.stderr || merge.error || `Merge conflict while merging task "${task.id}".`) + abortWarning,
			};
			steps.push(conflict);
			return { ok: false, steps, mergedTaskIds, skippedTaskIds, conflict };
		}
		const merged: TaskWorktreeAutoMergeSuccess = {
			type: "merged",
			taskId: task.id,
			headCommit,
			reason: "task result HEAD merged into the base workspace.",
		};
		steps.push(merged);
		mergedTaskIds.push(task.id);
	}

	return {
		ok: true,
		steps,
		mergedTaskIds,
		skippedTaskIds,
	};
}
