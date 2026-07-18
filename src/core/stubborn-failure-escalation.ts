import type { AgentLedgerEvent } from "./agent-attempt-ledger";
/**
 * F3.29 — automatic stubborn-failure escalation (pure). When a card keeps failing, the orchestrator tries bounded
 * ALTERNATIVES (different models, different approaches/rungs). This core answers the terminal question: have the
 * bounded alternatives been EXHAUSTED? — and if so, which attempt produced the best partial artifact to PRESERVE, and
 * what evidence report should accompany the park. It composes over the attempt history the ledger already records;
 * the effectful caller (the redrive ladder) consumes the verdict to park with a complete report instead of grinding.
 *
 * Pure + deterministic. "Best partial" = the highest-quality attempt even among failures (a 0.7 partial beats a 0.1
 * one), so parking preserves the most-complete work rather than the last (often-degraded) attempt.
 */

export interface EscalationAttempt {
	readonly attemptId: string;
	readonly modelId: string;
	/** The strategy/rung label (e.g. "simplify", "cross_model_bounce", "self_consistency"). */
	readonly approach: string;
	readonly outcome: "success" | "failure";
	/** 0..1 quality of the (partial) result; null when unscored (treated as 0 for ranking). */
	readonly qualityScore: number | null;
	/** A ref to the produced artifact (result branch/commit), or null if none was produced. */
	readonly artifactRef: string | null;
}

export interface StubbornFailureConfig {
	/** Exhaust after this many DISTINCT models have been tried. Default 3. */
	readonly maxDistinctModels: number;
	/** Exhaust after this many DISTINCT approaches have been tried. Default 3. */
	readonly maxDistinctApproaches: number;
	/** Hard cap on total attempts regardless of diversity. Default 6. */
	readonly maxTotalAttempts: number;
}

export const DEFAULT_STUBBORN_FAILURE_CONFIG: StubbornFailureConfig = {
	maxDistinctModels: 3,
	maxDistinctApproaches: 3,
	maxTotalAttempts: 6,
};

export type StubbornFailureStatus = "succeeded" | "keep_trying" | "exhausted";

export interface StubbornFailureVerdict {
	readonly status: StubbornFailureStatus;
	/** Remaining room before exhaustion (0 when that dimension is spent). */
	readonly remaining: { readonly models: number; readonly approaches: number; readonly attempts: number };
	/** The best partial artifact to preserve on park (highest quality, tiebreak: has an artifact). Null when none. */
	readonly bestPartial: EscalationAttempt | null;
	/** A structured, human-readable evidence report — empty until `exhausted`. */
	readonly evidenceReport: string;
}

function qualityOf(attempt: EscalationAttempt): number {
	return typeof attempt.qualityScore === "number" ? attempt.qualityScore : 0;
}

/** Pick the best partial: highest quality, then one that produced an artifact, then earliest (stable). */
function pickBestPartial(attempts: readonly EscalationAttempt[]): EscalationAttempt | null {
	let best: EscalationAttempt | null = null;
	for (const attempt of attempts) {
		if (best === null) {
			best = attempt;
			continue;
		}
		const q = qualityOf(attempt);
		const bq = qualityOf(best);
		if (q > bq || (q === bq && attempt.artifactRef !== null && best.artifactRef === null)) {
			best = attempt;
		}
	}
	return best;
}

function buildEvidenceReport(input: {
	attempts: readonly EscalationAttempt[];
	distinctModels: number;
	distinctApproaches: number;
	best: EscalationAttempt | null;
}): string {
	const lines: string[] = [
		`Stubborn failure: ${input.attempts.length} attempt(s) across ${input.distinctModels} model(s) and ${input.distinctApproaches} approach(es), none succeeded.`,
	];
	if (input.best && input.best.artifactRef) {
		lines.push(
			`Best partial preserved: ${input.best.modelId} via "${input.best.approach}" (quality ${qualityOf(input.best).toFixed(2)}) at ${input.best.artifactRef}.`,
		);
	} else {
		lines.push("No usable partial artifact was produced.");
	}
	lines.push("Parking for human attention — bounded model/approach alternatives are exhausted.");
	return lines.join("\n");
}

/** Build the assessment input from a task's real ledger attempts (shared by the dev CLI and the live consult). */
export function escalationAttemptsFromLedgerEvents(
	events: readonly AgentLedgerEvent[],
	taskId: string,
): EscalationAttempt[] {
	return events
		.filter((e): e is Extract<AgentLedgerEvent, { kind: "attempt" }> => e.kind === "attempt" && e.taskId === taskId)
		.map((a) => ({
			attemptId: a.attemptId,
			modelId: a.modelId,
			approach: a.promptStrategy ?? "default",
			outcome: a.outcome === "success" ? ("success" as const) : ("failure" as const),
			qualityScore: a.qualityScore,
			artifactRef: a.artifacts?.resultBranch ?? null,
		}));
}

export function assessStubbornFailure(
	attempts: readonly EscalationAttempt[],
	config: StubbornFailureConfig = DEFAULT_STUBBORN_FAILURE_CONFIG,
): StubbornFailureVerdict {
	const remaining = { models: config.maxDistinctModels, approaches: config.maxDistinctApproaches, attempts: 0 };
	const empty: StubbornFailureVerdict = { status: "keep_trying", remaining, bestPartial: null, evidenceReport: "" };
	if (attempts.length === 0) {
		return empty;
	}
	if (attempts.some((attempt) => attempt.outcome === "success")) {
		return { ...empty, status: "succeeded", bestPartial: pickBestPartial(attempts) };
	}

	const distinctModels = new Set(attempts.map((a) => a.modelId)).size;
	const distinctApproaches = new Set(attempts.map((a) => a.approach)).size;
	const remainingModels = Math.max(0, config.maxDistinctModels - distinctModels);
	const remainingApproaches = Math.max(0, config.maxDistinctApproaches - distinctApproaches);
	const remainingAttempts = Math.max(0, config.maxTotalAttempts - attempts.length);

	// Exhausted when the total cap is hit, OR both diversity dimensions are spent (no fresh model AND no fresh approach).
	const exhausted =
		attempts.length >= config.maxTotalAttempts ||
		(distinctModels >= config.maxDistinctModels && distinctApproaches >= config.maxDistinctApproaches);

	const bestPartial = pickBestPartial(attempts);
	return {
		status: exhausted ? "exhausted" : "keep_trying",
		remaining: { models: remainingModels, approaches: remainingApproaches, attempts: remainingAttempts },
		bestPartial,
		evidenceReport: exhausted
			? buildEvidenceReport({ attempts, distinctModels, distinctApproaches, best: bestPartial })
			: "",
	};
}
