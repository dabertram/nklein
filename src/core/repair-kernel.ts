/**
 * The deterministic repair kernel (§5.B) — the constrained bugfix pipeline that keeps a small model from WANDERING.
 * Instead of giving the model general agency over a bug, the HARNESS owns the orchestration and hands the model only
 * narrow generative subtasks: **reproduce → localize → generate N candidate patches → validate → rank → refine**. This
 * module is the pure orchestrator: every effectful step (run the repro, localize, generate, validate) is INJECTED, so
 * the control flow — phase gating, N-candidate ranking, the refine loop, and always terminating with the best result —
 * is deterministic + fully testable. The runtime wiring (real tools behind each step) layers on top later.
 *
 * Phase gating (the small-model thesis): localization cannot edit; generation sees the chosen context; validation runs
 * the commands + returns structured results. Ranking prefers a candidate that passes the repro + the regression suite,
 * then clean type/lint checks, then a smaller diff (§5.B/§3 fold-in criteria).
 */

/** A candidate fix the generation step proposes (the model's narrow generative subtask). */
export interface RepairCandidate {
	id: string;
	/** Opaque patch payload (a unified diff / edit set) the validation step applies + checks. */
	patch: string;
	/** Files the candidate touches — feeds the touched-file-plausibility rank tiebreak. */
	touchedFiles?: readonly string[];
}

/** The structured result of validating one candidate (the validation phase sees commands + structured failures). */
export interface CandidateValidation {
	candidateId: string;
	/** The reproduction test now PASSES (the bug is fixed). */
	reproPass: boolean;
	/** The existing regression suite still passes (no new breakage). */
	regressionPass: boolean;
	/** Typecheck + lint are clean. */
	checksPass: boolean;
	/** Lines changed (smaller is preferred, all else equal). */
	diffSize: number;
}

/**
 * The RAW, structured gate outputs the validator captures for one candidate — the repro test's after-apply result,
 * a count of regression / typecheck / lint failures, and the diff size. {@link aggregateCandidateValidation} folds
 * these into the boolean {@link CandidateValidation} the ranker consumes (the effectful runners that RUN the gates and
 * produce these numbers are the validator's other, integration-side leaves).
 */
export interface RawValidationGates {
	candidateId: string;
	/** The reproduction test PASSED after applying the candidate (the bug is fixed). */
	reproPassAfter: boolean;
	/** Number of regression-suite tests that failed (0 ⇒ no new breakage). */
	regressionFailures: number;
	/** Number of typecheck failures (0 ⇒ clean). */
	typecheckFailures: number;
	/** Number of lint failures (0 ⇒ clean). */
	lintFailures: number;
	/** Lines changed by the candidate. */
	diffSize: number;
}

/** Fold the raw structured gate outputs into the boolean {@link CandidateValidation} the ranker consumes. Pure. */
export function aggregateCandidateValidation(gates: RawValidationGates): CandidateValidation {
	return {
		candidateId: gates.candidateId,
		reproPass: gates.reproPassAfter === true,
		regressionPass: Math.max(0, gates.regressionFailures) === 0,
		checksPass: Math.max(0, gates.typecheckFailures) === 0 && Math.max(0, gates.lintFailures) === 0,
		diffSize: Math.max(0, gates.diffSize),
	};
}

export interface RepairKernelDeps {
	/** Establish a fail-before reproduction (a first-class artifact). Returns whether the bug reproduces. */
	reproduce: () => Promise<boolean>;
	/** Localize the fault (AST/symbol/call-graph; CANNOT edit). Returns candidate locations (file:symbol refs). */
	localize: () => Promise<readonly string[]>;
	/** Generate up to N candidate patches from the localization (the model's narrow subtask). */
	generateCandidates: (locations: readonly string[], count: number) => Promise<readonly RepairCandidate[]>;
	/** Validate one candidate (apply + run repro + regression + checks), returning structured results. */
	validate: (candidate: RepairCandidate) => Promise<CandidateValidation>;
}

export interface RepairKernelConfig {
	/** How many candidate patches to generate per round (default 3). */
	candidateCount: number;
	/** How many refine rounds to attempt if no candidate fully passes (default 1). */
	refineRounds: number;
}

export const DEFAULT_REPAIR_KERNEL_CONFIG: RepairKernelConfig = { candidateCount: 3, refineRounds: 1 };

export type RepairOutcome =
	| { status: "fixed"; candidate: RepairCandidate; validation: CandidateValidation; rounds: number }
	| { status: "cannot_reproduce" }
	| { status: "no_candidate"; rounds: number }
	| {
			status: "no_candidate_passed";
			best: { candidate: RepairCandidate; validation: CandidateValidation };
			rounds: number;
	  };

/** A candidate fully passes when the bug is fixed (repro) AND nothing regressed AND checks are clean. */
function fullyPasses(validation: CandidateValidation): boolean {
	return validation.reproPass && validation.regressionPass && validation.checksPass;
}

/**
 * Injectable per-candidate rank tiebreaks (§5.AK): softer evidence that only matters AFTER the hard gate score, but
 * BEFORE the smaller-diff fallback. The SOURCES are computed by the caller and injected (so the ranker stays pure):
 * fault-localization overlap for touched-file plausibility, the second-opinion reviewer's signal, and the learned
 * prior from the §5.AF ledger. Higher is better; all default to 0 (absent ⇒ the ranker is byte-identical to before).
 */
export interface CandidateTiebreaks {
	/** How plausible the candidate's touched files are for this bug (e.g. overlap with the localized fault set). */
	touchedFilePlausibility?: number;
	/** The reviewer-evidence signal (a second opinion favoring this candidate). */
	reviewerEvidence?: number;
	/** The learned prior from the §5.AF ledger (this shape/model historically succeeded on similar work). */
	learnedPrior?: number;
}

/**
 * Rank validated candidates best-first (pure): hard gates first (repro-pass, then regression-pass, then checks-pass),
 * then the injectable evidence tiebreaks (higher = better), then the SMALLER diff. A higher rank means a better fix.
 * `tiebreaksFor` is optional — absent ⇒ the classic gate-then-diff order, byte-identical to before.
 */
export function rankCandidateValidations(
	validations: readonly CandidateValidation[],
	tiebreaksFor?: (candidateId: string) => CandidateTiebreaks | undefined,
): CandidateValidation[] {
	const gateScore = (v: CandidateValidation) =>
		(v.reproPass ? 4 : 0) + (v.regressionPass ? 2 : 0) + (v.checksPass ? 1 : 0);
	const tiebreakScore = (v: CandidateValidation): number => {
		const t = tiebreaksFor?.(v.candidateId) ?? {};
		return (t.touchedFilePlausibility ?? 0) + (t.reviewerEvidence ?? 0) + (t.learnedPrior ?? 0);
	};
	return [...validations].sort(
		(left, right) =>
			gateScore(right) - gateScore(left) ||
			tiebreakScore(right) - tiebreakScore(left) ||
			left.diffSize - right.diffSize,
	);
}

/**
 * Drive the repair pipeline. Returns `fixed` with the best fully-passing candidate, or — when none fully passes after
 * the refine rounds — `no_candidate_passed` with the best partial (so the caller can surface real progress, not a dead
 * end). `cannot_reproduce` short-circuits (you can't deterministically fix what you can't reproduce).
 */
export async function runRepairKernel(
	deps: RepairKernelDeps,
	config: RepairKernelConfig = DEFAULT_REPAIR_KERNEL_CONFIG,
): Promise<RepairOutcome> {
	if (!(await deps.reproduce())) {
		return { status: "cannot_reproduce" };
	}
	const locations = await deps.localize();
	const candidateCount = Math.max(1, Math.trunc(config.candidateCount));
	const totalRounds = 1 + Math.max(0, Math.trunc(config.refineRounds));
	let bestPartial: { candidate: RepairCandidate; validation: CandidateValidation } | null = null;
	let roundsRun = 0;

	for (let round = 0; round < totalRounds; round += 1) {
		roundsRun = round + 1;
		const candidates = await deps.generateCandidates(locations, candidateCount);
		if (candidates.length === 0) {
			continue;
		}
		const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
		const validations = await Promise.all(candidates.map((candidate) => deps.validate(candidate)));
		const ranked = rankCandidateValidations(validations);
		const top = ranked[0];
		if (top) {
			const candidate = byId.get(top.candidateId);
			if (candidate) {
				if (fullyPasses(top)) {
					return { status: "fixed", candidate, validation: top, rounds: roundsRun };
				}
				if (bestPartial === null) {
					bestPartial = { candidate, validation: top };
				}
			}
		}
	}

	if (bestPartial === null) {
		return { status: "no_candidate", rounds: roundsRun };
	}
	return { status: "no_candidate_passed", best: bestPartial, rounds: roundsRun };
}
