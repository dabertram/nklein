/**
 * Decide whether a base workspace's dirt is an ABANDONED delivery merge that !Klein must clean up.
 *
 * ── WHY ──
 * Live 2026-09-08, project 38. A delivery merge conflicted at 18:44:29 — the same minute the responder agent died
 * and the runtime was thrashing a stop/restart loop — and the fail-safe `git merge --abort` never ran: the async
 * work around it was interrupted. The base workspace was left mid-merge with `UU tests/manifest.json`, and from
 * that moment EVERY later delivery refused with "Base workspace has uncommitted changes; merge task results from
 * a clean base." Correct, and useless: it names the symptom, not the cause, and nothing anywhere cleans it up. One
 * interrupted merge wedges the project permanently, with the board still green and cards still delivering into a
 * merge that can never happen.
 *
 * The fix must never destroy a person's work, so ownership is PROVEN rather than assumed. Before merging, the
 * merger writes a mark naming the exact commit it is about to merge. Debris is ours to clear only when a merge is
 * in progress AND the mark names that same MERGE_HEAD. A merge with no mark, or a mark for a different commit, is
 * someone else's and is left strictly alone — the operator's own `git merge` in the base workspace is exactly the
 * case that must survive this.
 *
 * Pure so the ownership rules are testable without staging an interrupted merge.
 */

export interface InFlightMergeMark {
	/** The commit the merger was merging when it wrote this mark. */
	readonly mergeHead: string;
	/** The card whose result was being merged — for the recovery message, never for the decision. */
	readonly taskId: string;
	readonly startedAt: number;
}

export interface AbandonedMergeInputs {
	/** `MERGE_HEAD` if a merge is in progress in the base workspace, else null. */
	readonly mergeHead: string | null;
	/** The mark the merger last wrote, if any. */
	readonly mark: InFlightMergeMark | null;
}

export interface AbandonedMergeDecision {
	readonly action: "abort" | "leave";
	readonly reason: string;
}

/** Git's porcelain codes for an unmerged path — the shape of conflict debris. */
const UNMERGED_CODES: ReadonlySet<string> = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

export function isUnmergedStatusLine(line: string): boolean {
	return UNMERGED_CODES.has(line.slice(0, 2));
}

export function decideAbandonedMergeRecovery(input: AbandonedMergeInputs): AbandonedMergeDecision {
	if (!input.mergeHead) {
		// Dirt with no merge in progress is a working tree someone changed. Not ours, and not a merge to abort.
		return { action: "leave", reason: "no merge is in progress — the dirt is not abandoned merge debris" };
	}
	if (!input.mark) {
		return {
			action: "leave",
			reason:
				"a merge is in progress that !Klein did not start (no in-flight mark) — never abort someone else's merge",
		};
	}
	if (input.mark.mergeHead !== input.mergeHead) {
		return {
			action: "leave",
			reason: `the in-flight mark names ${input.mark.mergeHead.slice(0, 12)} but MERGE_HEAD is ${input.mergeHead.slice(0, 12)} — a different merge, so not ours to abort`,
		};
	}
	return {
		action: "abort",
		reason: `abandoned delivery merge of ${input.mark.mergeHead.slice(0, 12)} for card ${input.mark.taskId} — aborting it so deliveries can resume from a clean base`,
	};
}
