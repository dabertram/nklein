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
 * ── AND OWNERSHIP IS NOT ENOUGH (caught the same evening, before this had run once in anger) ──
 * A conflicted merge is deliberately HELD OPEN while the merge-resolution agent works in it — up to its 30-minute
 * deadline — and during that window the mark names the live MERGE_HEAD and the base is legitimately unclean. An
 * ownership-only rule would therefore abort the agent's own workspace out from under it and call that a recovery.
 * "Ours" and "abandoned" are different claims: the first is about who started it, the second about whether anyone
 * is still working on it, and only the pair together license destroying state.
 *
 * Age is the second half. A merge younger than the resolution window may still be someone's live work, so it is
 * left alone; one older than it has outlived every mechanism that could still be tending it. That does mean an
 * abandoned merge wedges the base for the length of the window — which is the honest price of not being able to
 * distinguish "abandoned" from "being worked on" without a heartbeat, and is finite where the old behaviour was not.
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
	/** Now, injected. */
	readonly now: number;
	/** How long a merge may legitimately stay open before it counts as abandoned. */
	readonly abandonedAfterMs?: number;
}

/**
 * The merge-resolution agent's own deadline is 30 minutes (`nklein-merge-resolution`), so a merge is not abandoned
 * until comfortably past it. 45 minutes leaves room for the agent's own wind-down without leaving the base wedged
 * for an hour.
 */
export const DEFAULT_MERGE_ABANDONED_AFTER_MS = 45 * 60 * 1000;

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
	const abandonedAfterMs = input.abandonedAfterMs ?? DEFAULT_MERGE_ABANDONED_AFTER_MS;
	const ageMs = input.now - input.mark.startedAt;
	if (ageMs < abandonedAfterMs) {
		// Ours, but possibly still being worked: a conflicted merge is held open for the resolution agent, and
		// aborting inside that window destroys the agent's workspace and calls it a recovery.
		return {
			action: "leave",
			reason: `this merge is ours but only ${Math.round(ageMs / 60_000)} min old — inside the ${Math.round(abandonedAfterMs / 60_000)}-minute resolution window, so it may still be being worked on`,
		};
	}
	return {
		action: "abort",
		reason: `abandoned delivery merge of ${input.mark.mergeHead.slice(0, 12)} for card ${input.mark.taskId}, open for ${Math.round(ageMs / 60_000)} min with nothing tending it — aborting so deliveries can resume from a clean base`,
	};
}
