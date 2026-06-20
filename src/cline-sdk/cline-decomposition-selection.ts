import { assessClinePlanTaskGraphQuality } from "./cline-decomposition-graph-quality";
import { validateClinePlanTaskGraph } from "./cline-decomposition-tool";
import type { ClinePlanTaskGraph } from "./cline-plan-artifacts";

/**
 * Best-of-N decomposition selection (self-consistency for planning; arXiv:2203.11171).
 *
 * A weak/local model produces higher-quality plans if it generates several candidates and the *best* is kept,
 * rather than trusting its first attempt. !Klein already owns an objective judge — the sizing contract
 * (`validateClinePlanTaskGraph`) and dependency-coherence checks (`assessClinePlanTaskGraphQuality`) — so it
 * can score candidates without a stronger model: reject graphs that fail sizing/reference validation, then
 * rank the rest by (fewest coherence violations → fewest warnings → healthier dependency density → more
 * independently reviewable tasks).
 *
 * The selector is pure/unit-tested; `generateBestOfNPlanTaskGraph` takes the generator as an injected function
 * so the N-sampling loop is testable without a live model and can be wired to `LocalLlmClient.generateStructured`.
 */

export interface PlanCandidateScore {
	index: number;
	/** Passed sizing/reference validation (could still have coherence warnings/violations). */
	parseable: boolean;
	violations: number;
	warnings: number;
	taskCount: number;
	dependencyCount: number;
	dependencyDensity: number;
	score: number;
	error?: string;
}

export interface SelectBestPlanResult {
	bestIndex: number | null;
	best: ClinePlanTaskGraph | null;
	scores: PlanCandidateScore[];
}

function scoreCandidate(candidate: ClinePlanTaskGraph, index: number): PlanCandidateScore {
	try {
		// Do not throw on coherence here; we want to *rank* by violation count, not hard-fail a candidate.
		const validation = validateClinePlanTaskGraph({ taskGraph: candidate, enforceGraphQuality: false });
		const quality = validation.quality;
		const cappedDensity = Math.min(quality.dependencyDensity, 2);
		const score =
			1000 -
			quality.violations.length * 100 -
			quality.warnings.length * 5 +
			cappedDensity * 10 +
			quality.taskCount * 0.1;
		return {
			index,
			parseable: true,
			violations: quality.violations.length,
			warnings: quality.warnings.length,
			taskCount: quality.taskCount,
			dependencyCount: quality.dependencyCount,
			dependencyDensity: quality.dependencyDensity,
			score,
		};
	} catch (error) {
		// Sizing/reference failure: disqualify but keep the assessment for transparency.
		const assessment = safeAssess(candidate);
		return {
			index,
			parseable: false,
			violations: assessment.violations.length,
			warnings: assessment.warnings.length,
			taskCount: assessment.taskCount,
			dependencyCount: assessment.dependencyCount,
			dependencyDensity: assessment.dependencyDensity,
			score: Number.NEGATIVE_INFINITY,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

function safeAssess(candidate: ClinePlanTaskGraph) {
	try {
		return assessClinePlanTaskGraphQuality(candidate);
	} catch {
		return {
			violations: [],
			warnings: [],
			taskCount: 0,
			dependencyCount: 0,
			dependencyDensity: 0,
			isolatedTaskIds: [],
		};
	}
}

export function selectBestClinePlanTaskGraph(candidates: readonly ClinePlanTaskGraph[]): SelectBestPlanResult {
	const scores = candidates.map((candidate, index) => scoreCandidate(candidate, index));
	let bestIndex: number | null = null;
	let bestScore = Number.NEGATIVE_INFINITY;
	for (const candidateScore of scores) {
		if (candidateScore.parseable && candidateScore.score > bestScore) {
			bestScore = candidateScore.score;
			bestIndex = candidateScore.index;
		}
	}
	return {
		bestIndex,
		best: bestIndex === null ? null : candidates[bestIndex],
		scores,
	};
}

export interface GenerateBestOfNInput {
	/** Number of candidates to sample (clamped to >=1). */
	n: number;
	/** Produces one candidate graph for attempt `attempt` (0-based); may reject by throwing. */
	generate: (attempt: number) => Promise<ClinePlanTaskGraph>;
}

export interface GenerateBestOfNResult extends SelectBestPlanResult {
	attempts: number;
}

export async function generateBestOfNPlanTaskGraph(input: GenerateBestOfNInput): Promise<GenerateBestOfNResult> {
	const n = Math.max(1, Math.floor(input.n));
	const candidates: ClinePlanTaskGraph[] = [];
	for (let attempt = 0; attempt < n; attempt += 1) {
		try {
			candidates.push(await input.generate(attempt));
		} catch {
			// A failed generation attempt is simply not a candidate.
		}
	}
	return { ...selectBestClinePlanTaskGraph(candidates), attempts: candidates.length };
}
