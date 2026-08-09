/**
 * P18.4b — resolve `hasCapturedWork` for the off-track remedy, and say how it was resolved.
 *
 * `decideOffTrackRemedy` takes a plain boolean, and the two answers lead to opposite actions: `true` parks the
 * card (preserving a diff a human can salvage), `false` restarts it (discarding the conversation). P18.4 named
 * `false` as the dangerous default for exactly that reason.
 *
 * ── WHY UNKNOWN RESOLVES TO `true` HERE, WHILE UNKNOWN DEPTH ABSTAINS ──
 * `card-depth-basis.ts` refuses to pick a bucket when depth is unknown, because BOTH defaults are expensive
 * there — one manufactures a permission, the other a requirement. This is not that case. The costs are plainly
 * asymmetric:
 *
 *   wrongly `false` → a restart destroys a real diff. Irreversible, and it is the user's work.
 *   wrongly `true`  → a park surfaces a card with nothing to save. Costs a human's attention, not their work.
 *
 * So an unreadable probe resolves to `true` and is LABELLED `assumed_safe`. Consistency of shape matters less
 * than getting each asymmetry right, and the label is what stops the assumption from reading as an observation:
 * "parked because we could not check" and "parked because there is a diff" are different facts, and only one of
 * them is about the card.
 */

export type CapturedWorkBasis =
	/** The result-branch probe answered — the value is what the repo says. */
	| "observed"
	/** The probe could not answer, and the value is the non-destructive assumption. */
	| "assumed_safe";

export interface CapturedWorkSignal {
	readonly hasCapturedWork: boolean;
	readonly basis: CapturedWorkBasis;
	/** Why — in the terms a remedy log should record, so a park is attributable. */
	readonly detail: string;
}

/** The shape `probeTaskResultBranchCommit` returns; taken structurally so this core stays free of git. */
export type ResultBranchProbeLike =
	| { readonly status: "found"; readonly commit: string }
	| { readonly status: "missing"; readonly commit: null }
	| { readonly status: "error"; readonly commit: null; readonly message: string };

/** Fold a result-branch probe into the remedy's `hasCapturedWork` signal. */
export function foldCapturedWorkProbe(probe: ResultBranchProbeLike | null): CapturedWorkSignal {
	if (probe === null) {
		return {
			hasCapturedWork: true,
			basis: "assumed_safe",
			detail:
				"no result-branch probe was run — assuming the card has work worth preserving rather than risking a restart that discards it",
		};
	}

	if (probe.status === "found") {
		return {
			hasCapturedWork: true,
			basis: "observed",
			detail: `the card has a result branch at ${probe.commit} — reviewable work a restart would destroy`,
		};
	}

	if (probe.status === "missing") {
		// The only path to `false`, and it requires a probe that positively answered "there is no branch".
		return {
			hasCapturedWork: false,
			basis: "observed",
			detail: "the card has no result branch — there is no captured work a restart would destroy",
		};
	}

	return {
		hasCapturedWork: true,
		basis: "assumed_safe",
		detail: `the result-branch probe failed (${probe.message}) — assuming the card has work worth preserving, because a wrong 'no' discards a diff and a wrong 'yes' only asks a human to look`,
	};
}
