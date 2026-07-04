/**
 * §5.AK — project a repair-kernel run into a §5.AF ledger record: the observable EVIDENCE of one constrained bugfix
 * run, so the outcome doesn't evaporate into thin air. Captures, per the backlog leaf, the five things worth keeping:
 *   1. the localization candidates the kernel worked from,
 *   2. the patch candidates it generated (per round),
 *   3. the validator results for each candidate,
 *   4. the refinement DELTAS between rounds (did refining actually improve the best candidate, or churn?), and
 *   5. the final ranking rationale (WHY the winning candidate won — gate score, tiebreak evidence, diff size).
 *
 * Pure + deterministic: it consumes an already-captured run trace and returns a record. The effectful append to the
 * durable §5.AF ledger store is the integration-side leaf that consumes this record (kept out so this stays testable).
 */

import {
	type CandidateTiebreaks,
	type CandidateValidation,
	candidateGateScore,
	type RepairCandidate,
	rankCandidateValidations,
} from "./repair-kernel";

/** One round of the kernel's generate→validate→rank loop, exactly as it happened. */
export interface RepairKernelRoundTrace {
	/** 1-based round index (round 1 = first try; > 1 = refinement rounds). */
	round: number;
	/** The candidates generated this round. */
	candidates: readonly RepairCandidate[];
	/** The validation result for each candidate (each carries its own `candidateId`). */
	validations: readonly CandidateValidation[];
	/** The injected tiebreak evidence per candidateId, mirroring what the ranker saw (optional). */
	tiebreaksFor?: (candidateId: string) => CandidateTiebreaks | undefined;
}

/** The full observable trace of one repair-kernel run (the input to the projection). */
export interface RepairKernelRunTrace {
	/** The localization refs the kernel worked from (`file[:symbol|:span]` strings). */
	localization: readonly string[];
	/** Each round that ran, in order. */
	rounds: readonly RepairKernelRoundTrace[];
}

/** Leaf 3 — a per-candidate validator result line, with the composite gate score the ranker used. */
export interface LedgerValidatorResult {
	candidateId: string;
	reproPass: boolean;
	regressionPass: boolean;
	checksPass: boolean;
	diffSize: number;
	/** The composite gate score used for ranking (repro 4 · regression 2 · checks 1); range 0–7. */
	gateScore: number;
}

/** Leaf 4 — the round-over-round refinement delta: did refining improve the best gate score, or spin? */
export interface RefinementDelta {
	round: number;
	/** Best gate score achieved this round (0 when the round produced no validations). */
	bestGateScore: number;
	/** Change in best gate score vs the previous round (round 1 = 0 — no prior to compare against). */
	gateScoreDelta: number;
	/** True when this round's best strictly improved on the prior round — refinement paid off. */
	improved: boolean;
}

/** The projected ledger record — one field per backlog leaf. */
export interface RepairKernelLedgerRecord {
	/** Leaf 1 — the localization candidates the run worked from. */
	localizationCandidates: readonly string[];
	/** Leaf 2 — the patch candidates generated, grouped by round. */
	patchCandidatesByRound: readonly { round: number; candidateIds: readonly string[] }[];
	/** Leaf 3 — the validator results, flattened across every round. */
	validatorResults: readonly LedgerValidatorResult[];
	/** Leaf 4 — the refinement deltas between rounds. */
	refinementDeltas: readonly RefinementDelta[];
	/** Leaf 5 — the final ranking rationale (why the winner won, or why nothing passed). */
	finalRankingRationale: string;
}

/** The best (highest) gate score across a round's validations, or 0 for an empty round. */
function bestGateScoreOfRound(round: RepairKernelRoundTrace): number {
	return round.validations.reduce((max, v) => Math.max(max, candidateGateScore(v)), 0);
}

/** Sum the injected tiebreak evidence for one candidate (mirrors the ranker's tiebreak fold). */
function tiebreakSum(tiebreaks: CandidateTiebreaks | undefined): number {
	if (!tiebreaks) {
		return 0;
	}
	return (tiebreaks.touchedFilePlausibility ?? 0) + (tiebreaks.reviewerEvidence ?? 0) + (tiebreaks.learnedPrior ?? 0);
}

/** A "✓"/"✗" glyph for a boolean gate, for the human-readable rationale. */
function gate(pass: boolean): string {
	return pass ? "✓" : "✗";
}

/**
 * Explain WHY the winning candidate ranked first. The kernel returns `fixed` the moment a round fully passes and stops,
 * so the winner always lives in the LAST round that ran — rank that round with the same rule (gates → tiebreaks → diff)
 * and describe its top candidate.
 */
function buildFinalRankingRationale(trace: RepairKernelRunTrace): string {
	const lastRound = trace.rounds.at(-1);
	if (!lastRound || lastRound.validations.length === 0) {
		return "No candidates were validated; nothing to rank.";
	}
	const winner = rankCandidateValidations(lastRound.validations, lastRound.tiebreaksFor)[0];
	if (!winner) {
		return "No candidates were validated; nothing to rank.";
	}
	const score = candidateGateScore(winner);
	const fullyPasses = winner.reproPass && winner.regressionPass && winner.checksPass;
	const verdict = fullyPasses ? "fully passes" : "is the best partial (no candidate fully passed)";
	const evidence = tiebreakSum(lastRound.tiebreaksFor?.(winner.candidateId));
	const roundsNote = trace.rounds.length > 1 ? ` after ${trace.rounds.length} rounds` : "";
	return (
		`Winner "${winner.candidateId}" ${verdict}${roundsNote}: gate score ${score}/7 ` +
		`(repro ${gate(winner.reproPass)}, regression ${gate(winner.regressionPass)}, checks ${gate(winner.checksPass)}), ` +
		`tiebreak evidence ${evidence}, diff ${winner.diffSize} lines.`
	);
}

/** Project a captured repair-kernel run into its §5.AF ledger record (pure). */
export function summarizeRepairKernelRun(trace: RepairKernelRunTrace): RepairKernelLedgerRecord {
	const patchCandidatesByRound = trace.rounds.map((round) => ({
		round: round.round,
		candidateIds: round.candidates.map((candidate) => candidate.id),
	}));

	const validatorResults: LedgerValidatorResult[] = trace.rounds.flatMap((round) =>
		round.validations.map((v) => ({
			candidateId: v.candidateId,
			reproPass: v.reproPass,
			regressionPass: v.regressionPass,
			checksPass: v.checksPass,
			diffSize: v.diffSize,
			gateScore: candidateGateScore(v),
		})),
	);

	const refinementDeltas: RefinementDelta[] = [];
	let previousBest: number | null = null;
	for (const round of trace.rounds) {
		const bestGateScore = bestGateScoreOfRound(round);
		const gateScoreDelta = previousBest === null ? 0 : bestGateScore - previousBest;
		refinementDeltas.push({
			round: round.round,
			bestGateScore,
			gateScoreDelta,
			improved: previousBest !== null && bestGateScore > previousBest,
		});
		previousBest = bestGateScore;
	}

	return {
		localizationCandidates: [...trace.localization],
		patchCandidatesByRound,
		validatorResults,
		refinementDeltas,
		finalRankingRationale: buildFinalRankingRationale(trace),
	};
}
