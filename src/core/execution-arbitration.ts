/**
 * F12.4 execution-based candidate arbitration — PURE core.
 *
 * !Klein's §5.AW best-of-N review picks between Candidate A (primary) and Candidate B (speculative) by REVIEWER
 * JUDGMENT alone; research (TEX, 2602.04254) shows an EXECUTION signal — run the acceptance check on each candidate,
 * rank by results — adds real discrimination (~+7.4pts). This core folds the two candidates' acceptance runs into an
 * arbitration verdict: a decisive execution difference names the winner (and the seed can say so); a tie or missing
 * runs defers to the reviewer, honestly labeled. The sandbox RUNS are the caller's; this is the decision math.
 */

export interface CandidateExecutionRun {
	/** Whether an acceptance command existed and ran for this candidate; null = never ran. */
	readonly passed: boolean | null;
	/** Optional finer signal when available (e.g. failing-test count); lower is better. Null when unknown. */
	readonly failureCount: number | null;
}

export interface ExecutionArbitration {
	/** "a" | "b" when execution is decisive; null = execution cannot separate them (reviewer decides). */
	readonly winner: "a" | "b" | null;
	readonly decisive: boolean;
	/** Prompt-ready sentence for the A/B review seed (always present — a tie is worth telling the reviewer too). */
	readonly note: string;
}

/**
 * Arbitrate by execution. Decision ladder: pass/fail split wins outright; both failed but one fails FEWER tests wins
 * weakly (still decisive — code closer to green is the better base); both passed / both equal / anything unknown =
 * not decisive, the reviewer's judgment stands.
 */
export function arbitrateByExecution(a: CandidateExecutionRun, b: CandidateExecutionRun): ExecutionArbitration {
	if (a.passed === true && b.passed === false) {
		return {
			winner: "a",
			decisive: true,
			note: "Execution signal: Candidate A PASSES the acceptance check, Candidate B fails — prefer A unless the reviewer finds A defective in a way the check misses.",
		};
	}
	if (b.passed === true && a.passed === false) {
		return {
			winner: "b",
			decisive: true,
			note: "Execution signal: Candidate B PASSES the acceptance check, Candidate A fails — prefer B unless the reviewer finds B defective in a way the check misses.",
		};
	}
	if (a.passed === false && b.passed === false && a.failureCount !== null && b.failureCount !== null) {
		if (a.failureCount !== b.failureCount) {
			const winner = a.failureCount < b.failureCount ? "a" : "b";
			return {
				winner,
				decisive: true,
				note: `Execution signal: both candidates fail, but Candidate ${winner.toUpperCase()} fails fewer checks (${Math.min(a.failureCount, b.failureCount)} vs ${Math.max(a.failureCount, b.failureCount)}) — it is the closer-to-green base.`,
			};
		}
	}
	if (a.passed === true && b.passed === true) {
		return {
			winner: null,
			decisive: false,
			note: "Execution signal: BOTH candidates pass the acceptance check — judge on quality, scope fit, and maintainability.",
		};
	}
	return {
		winner: null,
		decisive: false,
		note: "Execution signal: inconclusive (a check did not run for at least one candidate) — judge on the diffs alone.",
	};
}
