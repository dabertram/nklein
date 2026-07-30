import { describe, expect, it } from "vitest";
import { isTaskResultBranchRef, TASK_RESULT_BRANCH_PREFIX } from "../../../src/core/task-result-branch-naming";

/**
 * P21.4a — the predicate that stops a card being based on a SIBLING CARD'S DELIVERABLE.
 *
 * The incident this guards against (published postmortem, another project): 14 tasks marked complete, absent from
 * `main`, 9 lost — because a task was squash-merged onto a sibling task's branch it had inherited as its parent.
 * The work looked delivered and never reached the trunk.
 *
 * A false NEGATIVE here reopens exactly that hole. A false POSITIVE refuses a legitimate base branch and blocks
 * delivery loudly — recoverable. So the tests below lean on the boundaries, which is where a prefix check fails.
 */
describe("isTaskResultBranchRef", () => {
	it("recognises a result branch by its SHORT name", () => {
		expect(isTaskResultBranchRef(`${TASK_RESULT_BRANCH_PREFIX}/card-a-0123456789`)).toBe(true);
	});

	it("recognises the SAME branch fully-qualified — the spelling git plumbing reports", () => {
		// `baseRef` is stored short while git reports `refs/heads/...`. Matching only one spelling would leave the
		// hole open through the other, which is the kind of half-fix that reads as done.
		expect(isTaskResultBranchRef(`refs/heads/${TASK_RESULT_BRANCH_PREFIX}/card-a-0123456789`)).toBe(true);
	});

	it("does NOT flag ordinary base branches", () => {
		for (const ref of ["main", "master", "develop", "feature/login", "refs/heads/main"]) {
			expect(isTaskResultBranchRef(ref), `${ref} is a legitimate base and must stay usable`).toBe(false);
		}
	});

	it("matches on a path SEGMENT, so a similarly-named branch is not caught", () => {
		// A plain `startsWith("nklein/tasks")` would swallow these and refuse legitimate branches.
		for (const ref of ["nklein/tasks-of-mine", "nklein/tasksomething", "nklein/task"]) {
			expect(isTaskResultBranchRef(ref), `${ref} is not inside the result namespace`).toBe(false);
		}
		// The namespace root itself is not a card's deliverable either, but it is not a usable branch name; it is
		// accepted as a match so nothing can slip through on the boundary.
		expect(isTaskResultBranchRef(TASK_RESULT_BRANCH_PREFIX)).toBe(true);
	});

	it("does not flag OTHER nklein-internal namespaces — the check is deliberately narrow", () => {
		// Scoped to result branches because that is the one namespace unambiguously owned by another card.
		// Widening it to all of `nklein/` risks refusing a base branch someone legitimately uses.
		for (const ref of ["nklein/agent-sandbox", "nklein/result"]) {
			expect(isTaskResultBranchRef(ref)).toBe(false);
		}
	});

	it("treats empty/whitespace/nullish as NOT a result branch", () => {
		// Emptiness is a separate error with its own message; this predicate must not swallow it.
		for (const ref of ["", "   ", null, undefined]) {
			expect(isTaskResultBranchRef(ref)).toBe(false);
		}
	});

	it("ignores surrounding whitespace rather than letting it bypass the check", () => {
		expect(isTaskResultBranchRef(`  ${TASK_RESULT_BRANCH_PREFIX}/card-a-0123456789  `)).toBe(true);
	});
});
