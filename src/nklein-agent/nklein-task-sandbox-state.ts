import type { TaskResultBranch } from "../workspace/task-result-branches";

/**
 * Per-task git-sandbox state, extracted from InMemoryNKleinTaskSessionService to shrink the
 * monolith. Pure in-memory bookkeeping with explicit accessors — every method mirrors the
 * exact inline Map/Set op it replaced, so the extraction is behavior-preserving.
 *
 * It owns four task-keyed collections:
 *  - the project repo path each sandboxed task was prepared against,
 *  - the base ref that repo path was prepared at (resolved to a concrete commit or "HEAD"),
 *  - the set of review tasks whose result patch is mid-finalization (a re-entrancy guard), and
 *  - the most recently captured result branch per task.
 *
 * Note: the result-branch map is written but never read by the service today (kept for parity
 * with the pre-extraction behavior); it is a candidate for removal in a separate change.
 */
export class TaskSandboxStateStore {
	private readonly repoPathByTaskId = new Map<string, string>();
	private readonly baseRefByTaskId = new Map<string, string>();
	private readonly finalizingReviewTaskIds = new Set<string>();
	private readonly resultBranchByTaskId = new Map<string, TaskResultBranch>();

	/** Records the repo path and (already-resolved) base ref a task's sandbox was prepared against. */
	setSandbox(taskId: string, repoPath: string, baseRef: string): void {
		this.repoPathByTaskId.set(taskId, repoPath);
		this.baseRefByTaskId.set(taskId, baseRef);
	}

	getRepoPath(taskId: string): string | undefined {
		return this.repoPathByTaskId.get(taskId);
	}

	getBaseRef(taskId: string): string | undefined {
		return this.baseRefByTaskId.get(taskId);
	}

	/** True only when both the repo path and base ref are known for the task. */
	hasSandbox(taskId: string): boolean {
		return this.repoPathByTaskId.has(taskId) && this.baseRefByTaskId.has(taskId);
	}

	/** Forgets the repo-path/base-ref pair. The finalizing guard is cleared separately via {@link unmarkFinalizing}. */
	deleteSandbox(taskId: string): void {
		this.repoPathByTaskId.delete(taskId);
		this.baseRefByTaskId.delete(taskId);
	}

	markFinalizing(taskId: string): void {
		this.finalizingReviewTaskIds.add(taskId);
	}

	isFinalizing(taskId: string): boolean {
		return this.finalizingReviewTaskIds.has(taskId);
	}

	unmarkFinalizing(taskId: string): void {
		this.finalizingReviewTaskIds.delete(taskId);
	}

	/** The captured result branch for a task this run, when finalize captured one (W1.1b stall-signature check). */
	getResultBranch(taskId: string): TaskResultBranch | null {
		return this.resultBranchByTaskId.get(taskId) ?? null;
	}

	setResultBranch(taskId: string, branch: TaskResultBranch): void {
		this.resultBranchByTaskId.set(taskId, branch);
	}

	/** Drops all per-task sandbox state (used on full service disposal). */
	clear(): void {
		this.repoPathByTaskId.clear();
		this.baseRefByTaskId.clear();
		this.finalizingReviewTaskIds.clear();
		this.resultBranchByTaskId.clear();
	}
}
