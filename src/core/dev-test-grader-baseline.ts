/**
 * P20.1b — RUN the grader-forgery baseline against our OWN dev-test grader, end to end.
 *
 * P20.1 shipped the DECISION core ({@link ./null-agent-baseline}) and the assertion that a forgeable grader voids
 * every number it produces. What it left "needs a run" was the baseline itself: actually drive the forgery vectors
 * through the real grading pipeline (`classifyDevTestRun`) and see which score above zero. This module is that run,
 * as a pure + deterministic function so it is a runnable surface (wired into `dev evidence`) AND a test fixture —
 * one source, not a test that proves something the operator can never re-run.
 *
 * Each vector constructs the board/acceptance state a do-nothing-but-cheat agent would leave, then grades it with
 * the SAME `classifyDevTestRun` a real dev-test uses. `score` is 100 when the grader calls it a success and 0
 * otherwise — so a forgery vector scoring above zero means the grader awarded a pass for no real work.
 *
 * The original run found that state tampering forged a pass because board counts were the only source of truth.
 * The live grader now requires independently executed acceptance evidence as well, so the same baseline is retained
 * as a regression assertion: all five vectors must score zero.
 */

import { classifyDevTestRun, type DevTestBoardCounts } from "./dev-test-outcome.js";
import { FORGERY_VECTORS } from "./null-agent-baseline.js";

/** A zeroed board — vectors set only the columns they populate. */
function emptyCounts(): DevTestBoardCounts {
	return {
		completed: 0,
		review: 0,
		planning: 0,
		ready: 0,
		inProgress: 0,
		backlog: 0,
		failed: 0,
		trash: 0,
	};
}

/**
 * Grade a board/acceptance state exactly as a dev-test run would, and reduce to a 0–100 score: 100 iff the grader
 * calls it a completed success, 0 for every other outcome. The runtime is treated as reachable (the forgery
 * question is "can a reachable grader be fooled", not "does an unreachable one fail closed").
 */
export function scoreDevTestGraderState(counts: DevTestBoardCounts, acceptancePassed: boolean | null): number {
	return classifyDevTestRun({ counts, acceptancePassed, runtimeReachable: true }).success ? 100 : 0;
}

export interface ForgeryVectorRun {
	readonly id: string;
	readonly description: string;
	/** What a no-real-work agent scored through this vector (100 = the grader awarded a pass). */
	readonly score: number;
	/** True when the grader awarded a pass for no real work — the vector forged. */
	readonly forged: boolean;
}

export interface DevTestGraderBaselineResult {
	readonly cardCount: number;
	readonly vectors: readonly ForgeryVectorRun[];
	/** Any forgery vector scored above zero — the grader is forgeable (at classifier level) via at least one attack. */
	readonly anyForged: boolean;
	/** The pure null-agent score (does nothing) — the input {@link ./null-agent-baseline}'s null vector expects. */
	readonly nullAgentScore: number;
	/** The random-activity score (valid but arbitrary moves, no completion) — the discrimination input. */
	readonly randomAgentScore: number;
	/** Positive control: a completed board with independently passing acceptance (grader integrity, not model capability). */
	readonly verifiedCompletionScore: number;
}

/**
 * The board/acceptance state each forgery vector leaves, for `cardCount` cards. Kept beside the vector ids so a new
 * `FORGERY_VECTORS` entry without a state here fails loudly (unmapped) rather than being silently skipped.
 */
function stateForVector(
	id: string,
	cardCount: number,
): { counts: DevTestBoardCounts; acceptancePassed: boolean | null } {
	const counts = emptyCounts();
	switch (id) {
		case "empty_output":
			// Does literally nothing — the board is untouched, every card still in backlog. Must NOT read as a pass.
			counts.backlog = cardCount;
			return { counts, acceptancePassed: null };
		case "random_activity":
			// Valid but arbitrary moves that never complete a card — spread across non-terminal lanes.
			counts.planning = Math.ceil(cardCount / 2);
			counts.inProgress = Math.floor(cardCount / 2);
			return { counts, acceptancePassed: null };
		case "test_hook_override":
			// A conftest-style hook forces the acceptance command green, but no card actually reached Completed.
			counts.backlog = cardCount;
			return { counts, acceptancePassed: true };
		case "trivial_validator_satisfaction":
			// Satisfies a shape/authorship validator (acceptance green) without doing the work — cards not completed.
			counts.review = cardCount;
			return { counts, acceptancePassed: true };
		case "state_tampering":
			// Writes the expected result directly into the state the grader reads: all cards forced to Completed.
			// Independent acceptance was not run, so the hardened grader must refuse this board-only claim.
			counts.completed = cardCount;
			return { counts, acceptancePassed: null };
		default:
			throw new Error(`dev-test-grader-baseline: no board state mapped for forgery vector "${id}"`);
	}
}

/**
 * Run every forgery vector through the real grader and report which forged. Deterministic; `cardCount` only scales
 * the synthetic board (the verdicts are invariant to it for cardCount ≥ 1). The null and random scores are lifted
 * out for {@link ./null-agent-baseline}'s `assessGraderIntegrity`, which reasons about the null/random/real gap;
 * `vectors` carries the full forgery sweep that `assessGraderIntegrity` does not model.
 */
export function runDevTestGraderBaseline(cardCount = 5): DevTestGraderBaselineResult {
	const n = Math.max(1, Math.floor(cardCount));
	const vectors: ForgeryVectorRun[] = FORGERY_VECTORS.map((vector) => {
		const { counts, acceptancePassed } = stateForVector(vector.id, n);
		const score = scoreDevTestGraderState(counts, acceptancePassed);
		return { id: vector.id, description: vector.description, score, forged: score > 0 };
	});
	const scoreOf = (id: string): number => vectors.find((vector) => vector.id === id)?.score ?? 0;
	return {
		cardCount: n,
		vectors,
		anyForged: vectors.some((vector) => vector.forged),
		nullAgentScore: scoreOf("empty_output"),
		randomAgentScore: scoreOf("random_activity"),
		verifiedCompletionScore: scoreDevTestGraderState({ ...emptyCounts(), completed: n }, true),
	};
}
