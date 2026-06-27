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
 * Rank validated candidates best-first (pure): repro-pass, then regression-pass, then checks-pass, then SMALLER diff.
 * A higher rank means a better fix; ties break to the smaller, less-invasive patch.
 */
export function rankCandidateValidations(validations: readonly CandidateValidation[]): CandidateValidation[] {
	const score = (v: CandidateValidation) =>
		(v.reproPass ? 4 : 0) + (v.regressionPass ? 2 : 0) + (v.checksPass ? 1 : 0);
	return [...validations].sort((left, right) => score(right) - score(left) || left.diffSize - right.diffSize);
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
