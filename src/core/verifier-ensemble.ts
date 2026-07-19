/**
 * F12.97 (ensemble half) — combine INDEPENDENT verifier verdicts into one acceptance decision. PURE core.
 *
 * "No single verifier is safe" is the finding: execution tests miss invariant violations, property checks miss
 * intent, a rubric judge is fooled by fluent prose, and a shortcut monitor only sees the diff. So the decision
 * belongs to an ensemble — and, critically, to an ensemble that DISTINGUISHES the kinds of evidence rather than
 * averaging them.
 *
 * The rules, in order:
 *  1. A failed BLOCKING verifier (the executed tests) rejects outright — no advisory chorus can outvote a red run.
 *  2. Otherwise, ADVISORY verifiers that flag (shortcut monitor, diff minimality, property checks, a judge) do not
 *     silently pass: two or more concerns escalate to human review, one is surfaced with the delivery.
 *  3. Missing verifiers reduce CONFIDENCE and are named — an ensemble of one is reported as such, never dressed
 *     up as agreement.
 *
 * Honesty stance: this never converts absence of evidence into approval. `accept` means the blocking verifier
 * passed AND nothing advisory objected; anything else says exactly what is unresolved.
 */

export type VerifierKind =
	| "execution_tests"
	| "property_checks"
	| "rubric_judge"
	| "shortcut_monitor"
	| "diff_minimality";

export type VerifierOutcome = "pass" | "fail" | "unavailable";

export interface VerifierVerdict {
	readonly kind: VerifierKind;
	readonly outcome: VerifierOutcome;
	/** Why — carried into the ensemble reason so a human sees the actual objection, not a score. */
	readonly detail?: string;
}

/** Only the executed tests can BLOCK on their own; everything else is advisory evidence. */
const BLOCKING: ReadonlySet<VerifierKind> = new Set<VerifierKind>(["execution_tests"]);

export type EnsembleDecision = "accept" | "reject" | "needs_review";

export interface EnsembleResult {
	readonly decision: EnsembleDecision;
	/** Verifiers that actually ran (outcome !== "unavailable"). */
	readonly participating: readonly VerifierKind[];
	/** Verifiers that objected. */
	readonly objecting: readonly VerifierKind[];
	/** Verifiers that could not run — named so absent evidence is never read as agreement. */
	readonly missing: readonly VerifierKind[];
	readonly reason: string;
}

/**
 * Combine verifier verdicts. Deterministic and order-independent: the same set of verdicts always yields the
 * same decision, so the acceptance path stays replayable (§5.AF).
 */
export function combineVerifierVerdicts(verdicts: readonly VerifierVerdict[]): EnsembleResult {
	const participating = verdicts.filter((verdict) => verdict.outcome !== "unavailable").map((v) => v.kind);
	const missing = verdicts.filter((verdict) => verdict.outcome === "unavailable").map((v) => v.kind);
	const failed = verdicts.filter((verdict) => verdict.outcome === "fail");
	const objecting = failed.map((verdict) => verdict.kind);

	const blockingFailure = failed.find((verdict) => BLOCKING.has(verdict.kind));
	if (blockingFailure) {
		return {
			decision: "reject",
			participating,
			objecting,
			missing,
			reason: `${blockingFailure.kind} failed${blockingFailure.detail ? `: ${blockingFailure.detail}` : ""} — a red verification cannot be outvoted by advisory checks.`,
		};
	}
	if (participating.length === 0) {
		return {
			decision: "needs_review",
			participating,
			objecting,
			missing,
			reason: "no verifier could run — absence of evidence is not approval.",
		};
	}
	if (failed.length >= 2) {
		return {
			decision: "needs_review",
			participating,
			objecting,
			missing,
			reason: `${failed.length} independent checks objected (${failed
				.map((verdict) => `${verdict.kind}${verdict.detail ? `: ${verdict.detail}` : ""}`)
				.join("; ")}) — converging concerns warrant a human look.`,
		};
	}
	if (failed.length === 1) {
		const only = failed[0];
		return {
			decision: "needs_review",
			participating,
			objecting,
			missing,
			reason: `${only?.kind} objected${only?.detail ? `: ${only.detail}` : ""} — surfaced with the delivery rather than auto-accepted.`,
		};
	}
	const confidence =
		missing.length === 0
			? "every configured verifier agreed"
			: `${participating.length} verifier(s) agreed; ${missing.join(", ")} could not run`;
	return {
		decision: "accept",
		participating,
		objecting,
		missing,
		reason: `${confidence}.`,
	};
}
