/**
 * P20.8b — a cheap retry floor that every future scaffold comparison must clear before it can claim value.
 *
 * This core deliberately does not decide that either arm "wins". The small role-eval corpus can establish the
 * baseline and expose paired flips, but it cannot support a general architectural claim. Consumers publish the
 * complete Harness Cards and the raw paired observations so a larger, pre-registered study can build on them.
 */

import { assessCardCompleteness, assessComparability, type HarnessCard } from "./harness-card.js";

export type RetryBaselineArm = "fixed_retry" | "temperature_ramp";

export const RETRY_BASELINE_TEMPERATURES: Readonly<Record<RetryBaselineArm, readonly number[]>> = {
	fixed_retry: [0, 0, 0],
	temperature_ramp: [0, 0.2, 0.4],
};

export interface RetryBaselineObservation {
	readonly taskId: string;
	readonly arm: RetryBaselineArm;
	readonly attempt: number;
	readonly temperature: number;
	readonly score: number | null;
	readonly latencyMs: number;
	/** Null score provenance: transport/provider failure is infrastructure; a returned but unparseable answer is model quality. */
	readonly failureKind: "infra" | "unscorable" | null;
}

export interface RetryBaselineTaskResult {
	readonly taskId: string;
	readonly fixedBestScore: number;
	readonly rampBestScore: number;
	readonly fixedPassed: boolean;
	readonly rampPassed: boolean;
}

export interface RetryBaselineSummary {
	readonly taskCount: number;
	readonly expectedAttempts: number;
	readonly observationCount: number;
	readonly infraErrorCount: number;
	readonly unscorableCount: number;
	readonly fixedPassRate: number;
	readonly rampPassRate: number;
	readonly pairedDelta: number;
	readonly fixedOnlyPasses: number;
	readonly rampOnlyPasses: number;
	readonly comparison: ReturnType<typeof assessComparability>;
	readonly cardsComplete: boolean;
	readonly claim: "descriptive_baseline_only";
	readonly tasks: readonly RetryBaselineTaskResult[];
}

export function buildRetryBaselineCard(
	arm: RetryBaselineArm,
	options: { readonly modelId: string; readonly contextTokens: number; readonly maxTokens: number },
): HarnessCard {
	const temperatures = RETRY_BASELINE_TEMPERATURES[arm];
	return {
		id: `retry-baseline/${arm}/${options.modelId}`,
		execution:
			`LM Studio local OpenAI endpoint; temperature schedule [${temperatures.join(", ")}]; ` +
			`max_tokens ${options.maxTokens}`,
		tool: "the role-eval corpus's declared tool schema; no filesystem or network tools",
		context: `${options.contextTokens}-token resident context; no compaction or retrieval; identical prompt bytes per pair`,
		scheduling:
			"paired by task; three attempts per arm; arm order alternates by task index; one request at a time on one resident model",
		observability: "per-attempt task id, arm, attempt, temperature, deterministic score, latency, and infra failure",
		verification:
			"existing deterministic role-eval scorer; task passes when the best of three scores meets the declared bar",
		governance:
			"local-only; no egress; equal retry budgets; descriptive baseline only, never an architectural win claim",
		retryBudget: temperatures.length - 1,
	};
}

function bestScore(rows: readonly RetryBaselineObservation[]): number {
	return rows.reduce((best, row) => Math.max(best, row.score ?? 0), 0);
}

/** Summarize paired best-of-three outcomes while keeping infrastructure failures separate from model quality. */
export function summarizeRetryBaseline(
	observations: readonly RetryBaselineObservation[],
	options: {
		readonly taskIds: readonly string[];
		readonly passBar: number;
		readonly fixedCard: HarnessCard;
		readonly rampCard: HarnessCard;
	},
): RetryBaselineSummary {
	const tasks = options.taskIds.map((taskId): RetryBaselineTaskResult => {
		const fixedBestScore = bestScore(
			observations.filter((row) => row.taskId === taskId && row.arm === "fixed_retry"),
		);
		const rampBestScore = bestScore(
			observations.filter((row) => row.taskId === taskId && row.arm === "temperature_ramp"),
		);
		return {
			taskId,
			fixedBestScore,
			rampBestScore,
			fixedPassed: fixedBestScore >= options.passBar,
			rampPassed: rampBestScore >= options.passBar,
		};
	});
	const taskCount = tasks.length;
	const fixedPasses = tasks.filter((row) => row.fixedPassed).length;
	const rampPasses = tasks.filter((row) => row.rampPassed).length;
	const fixedPassRate = taskCount === 0 ? 0 : fixedPasses / taskCount;
	const rampPassRate = taskCount === 0 ? 0 : rampPasses / taskCount;
	return {
		taskCount,
		expectedAttempts: taskCount * 2 * RETRY_BASELINE_TEMPERATURES.fixed_retry.length,
		observationCount: observations.length,
		infraErrorCount: observations.filter((row) => row.failureKind === "infra").length,
		unscorableCount: observations.filter((row) => row.failureKind === "unscorable").length,
		fixedPassRate,
		rampPassRate,
		pairedDelta: rampPassRate - fixedPassRate,
		fixedOnlyPasses: tasks.filter((row) => row.fixedPassed && !row.rampPassed).length,
		rampOnlyPasses: tasks.filter((row) => !row.fixedPassed && row.rampPassed).length,
		comparison: assessComparability(options.fixedCard, options.rampCard),
		cardsComplete:
			assessCardCompleteness(options.fixedCard).complete && assessCardCompleteness(options.rampCard).complete,
		claim: "descriptive_baseline_only",
		tasks,
	};
}
