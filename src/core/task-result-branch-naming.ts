/**
 * The TASK RESULT BRANCH namespace — the pure naming knowledge, in core so both the board mutations (pure) and the
 * git-facing workspace layer can share ONE definition without breaking layering (no `src/core` file imports from
 * `src/workspace`, and this must not be the first).
 *
 * ── WHY THE PREDICATE EXISTS (P21.4a, 2026-07-30) ──
 * Another project published a postmortem after marking 14 tasks complete that were absent from `main`, losing 9 of
 * them. Root cause: a task was squash-merged onto a SIBLING task's branch that it had inherited as its parent. The
 * work looked delivered and never reached the trunk.
 *
 * !Klein had the same hole, verified end to end before this landed:
 *   1. card creation validated `baseRef` for NON-EMPTINESS only (`task-board-mutations.ts`);
 *   2. `baseRef` is taken verbatim from the host's current branch;
 *   3. branch detection lists ALL of `refs/heads` unfiltered (`workspace-git-detection.ts`), so a `nklein/tasks/*`
 *      result branch is offered like any other branch and can be checked out;
 *   4. the auto-merge guard compared the checkout against `task.baseRef` — which verifies CONSISTENCY, not
 *      LEGITIMACY.
 * With the host sitting on card A's result branch, card B is created with `baseRef = nklein/tasks/card-a-<hash>`,
 * the guard PASSES, and card B merges onto card A. Card B is marked completed, its dependents cascade, and nothing
 * lands on the base. That is the published incident, reproduced.
 */

/** Branch namespace for a card's deliverable: `nklein/tasks/<slug>-<hash>`. */
export const TASK_RESULT_BRANCH_PREFIX = "nklein/tasks";

/**
 * Is this ref another card's DELIVERABLE rather than a real base branch?
 *
 * Accepts both the short name (`nklein/tasks/x`) and the fully-qualified ref (`refs/heads/nklein/tasks/x`):
 * `baseRef` is stored short while git plumbing reports qualified, and matching only one spelling would leave the
 * hole open through the other.
 *
 * Scoped deliberately to the RESULT-branch namespace rather than all of `nklein/`. This is the one namespace that
 * is unambiguously a sibling card's output; rejecting the whole prefix risks refusing a legitimate base branch.
 */
export function isTaskResultBranchRef(ref: string | null | undefined): boolean {
	const normalized = ref?.trim().replace(/^refs\/heads\//u, "");
	if (!normalized) {
		return false;
	}
	// The trailing slash makes this a SEGMENT match: `nklein/tasks/x` matches, a branch merely named
	// `nklein/tasks-of-mine` does not.
	return `${normalized}/`.startsWith(`${TASK_RESULT_BRANCH_PREFIX}/`);
}
