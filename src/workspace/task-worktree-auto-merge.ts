import type { RuntimeBoardCard, RuntimeBoardColumnId, RuntimeBoardData } from "../core/api-contract";
import { runGit as defaultRunGit, type RunGitOptions } from "./git-utils";
import { resolveTaskResultBranchCommit as defaultResolveTaskResultBranchCommit } from "./task-result-branches";
import { resolveTaskCwd as defaultResolveTaskCwd } from "./task-worktree";

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
type ResolveTaskCwd = typeof defaultResolveTaskCwd;
type ResolveTaskResultBranchCommit = typeof defaultResolveTaskResultBranchCommit;

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

	const byBoardOrder = (left: string, right: string) =>
		(candidateByTaskId.get(left)?.boardIndex ?? 0) - (candidateByTaskId.get(right)?.boardIndex ?? 0);
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
	resolveTaskCwd?: ResolveTaskCwd;
	resolveTaskResultBranchCommit?: ResolveTaskResultBranchCommit;
}): Promise<TaskWorktreeAutoMergeResult> {
	const runGit = input.runGit ?? defaultRunGit;
	const resolveTaskCwd = input.resolveTaskCwd ?? defaultResolveTaskCwd;
	const resolveTaskResultBranchCommit = input.resolveTaskResultBranchCommit ?? defaultResolveTaskResultBranchCommit;
	const steps: TaskWorktreeAutoMergeStep[] = [];
	const mergedTaskIds: string[] = [];
	const skippedTaskIds: string[] = [];
	const status = await runGit(input.repoPath, ["status", "--porcelain"]);
	if (!status.ok || status.stdout.trim()) {
		const blocked: TaskWorktreeAutoMergeBlocked = {
			type: "blocked",
			taskId: null,
			reason: status.ok
				? "Base worktree has uncommitted changes; merge task worktrees from a clean base."
				: (status.error ?? "Could not read base worktree status."),
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
				reason: `Base worktree must be checked out on "${task.baseRef}" before merging task "${task.id}".`,
			};
			steps.push(blocked);
			return { ok: false, steps, mergedTaskIds, skippedTaskIds, blocked };
		}

		const resultBranchCommit = await resolveTaskResultBranchCommit({
			repoPath: input.repoPath,
			taskId: task.id,
			runGit,
		});
		let headCommit: string;
		if (resultBranchCommit) {
			headCommit = resultBranchCommit;
		} else {
			const worktreePath = await resolveTaskCwd({
				cwd: input.repoPath,
				taskId: task.id,
				baseRef: task.baseRef,
				ensure: false,
			}).catch((error: unknown) => {
				throw new Error(error instanceof Error ? error.message : String(error));
			});
			const head = await runGit(worktreePath, ["rev-parse", "--verify", "HEAD"]);
			if (!head.ok || !head.stdout.trim()) {
				const blocked: TaskWorktreeAutoMergeBlocked = {
					type: "blocked",
					taskId: task.id,
					reason: head.error ?? `Could not resolve HEAD for task "${task.id}".`,
				};
				steps.push(blocked);
				return { ok: false, steps, mergedTaskIds, skippedTaskIds, blocked };
			}
			headCommit = head.stdout.trim();
		}
		const alreadyMerged = await runGit(input.repoPath, ["merge-base", "--is-ancestor", headCommit, "HEAD"]);
		if (alreadyMerged.ok) {
			const skipped: TaskWorktreeAutoMergeSuccess = {
				type: "skipped",
				taskId: task.id,
				headCommit,
				reason: "task worktree HEAD is already merged into the base worktree.",
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
			await runGit(input.repoPath, ["merge", "--abort"]);
			const conflict: TaskWorktreeAutoMergeConflict = {
				type: "conflict",
				taskId: task.id,
				headCommit,
				conflictedPaths: conflicted.ok ? parseNullSeparatedPaths(conflicted.stdout) : [],
				message: merge.stderr || merge.error || `Merge conflict while merging task "${task.id}".`,
			};
			steps.push(conflict);
			return { ok: false, steps, mergedTaskIds, skippedTaskIds, conflict };
		}
		const merged: TaskWorktreeAutoMergeSuccess = {
			type: "merged",
			taskId: task.id,
			headCommit,
			reason: "task worktree HEAD merged into the base worktree.",
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
