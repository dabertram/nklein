/**
 * F4.12 — pure glue + read-side for truncation diagnostics: build a {@link StoredTruncationObservation} from a
 * completion's usage + planned budgets via {@link classifyOutputTruncation}, and summarize a batch of observations into a
 * per-model breakdown with a concrete remediation ("raise reasoning reserve" vs "raise answer budget" vs "provider
 * ceiling"). PURE + deterministic; no I/O.
 */

import { type StoredTruncationObservation, TRUNCATION_CAUSES } from "../state/truncation-observation-store.js";
import { classifyOutputTruncation } from "./output-truncation-classification.js";

export interface BuildTruncationObservationInput {
	readonly modelId: string;
	readonly surface: string;
	readonly role: string;
	readonly hitLengthLimit: boolean;
	readonly reasoningTokens: number;
	readonly answerTokens: number;
	readonly reasoningBudget: number;
	readonly answerBudget: number;
}

/**
 * Classify a completion and, when it truncated, produce the observation to record. Returns null for a completion that
 * stopped naturally (nothing to record) — so a caller can `const obs = build(...); if (obs) append([obs])`.
 */
export function buildTruncationObservation(input: BuildTruncationObservationInput): StoredTruncationObservation | null {
	const verdict = classifyOutputTruncation({
		hitLengthLimit: input.hitLengthLimit,
		reasoningTokens: input.reasoningTokens,
		answerTokens: input.answerTokens,
		reasoningBudget: input.reasoningBudget,
		answerBudget: input.answerBudget,
	});
	if (!verdict.truncated || verdict.cause === "none") {
		return null;
	}
	return {
		modelId: input.modelId,
		surface: input.surface,
		role: input.role,
		cause: verdict.cause,
		reasoningTokens: input.reasoningTokens,
		answerTokens: input.answerTokens,
		reasoningBudget: input.reasoningBudget,
		answerBudget: input.answerBudget,
	};
}

export interface TruncationModelSummary {
	readonly modelId: string;
	readonly total: number;
	readonly byCause: Record<(typeof TRUNCATION_CAUSES)[number], number>;
	/** The most frequent cause (ties broken by the fixed cause order). */
	readonly dominantCause: (typeof TRUNCATION_CAUSES)[number];
	/** The remediation implied by the dominant cause. */
	readonly recommendation: string;
}

const REMEDIATION: Record<(typeof TRUNCATION_CAUSES)[number], string> = {
	reasoning_starved_answer: "raise the reasoning reserve or retry non-reasoning for this model",
	answer_budget: "raise the answer budget for this model",
	total_ceiling: "hitting the provider/context ceiling — reduce prompt size or use a larger-context model",
};

/** Summarize truncation observations per model, worst-first (most truncations), with a remediation per model. */
export function summarizeTruncationDiagnostics(
	observations: readonly StoredTruncationObservation[],
): TruncationModelSummary[] {
	const byModel = new Map<string, Record<(typeof TRUNCATION_CAUSES)[number], number>>();
	for (const obs of observations) {
		const counts = byModel.get(obs.modelId) ?? { reasoning_starved_answer: 0, answer_budget: 0, total_ceiling: 0 };
		counts[obs.cause] += 1;
		byModel.set(obs.modelId, counts);
	}
	const summaries: TruncationModelSummary[] = [];
	for (const [modelId, byCause] of byModel) {
		const total = TRUNCATION_CAUSES.reduce((sum, cause) => sum + byCause[cause], 0);
		// Dominant cause: highest count, ties broken by the fixed TRUNCATION_CAUSES order (reasoning-starved first).
		const dominantCause = [...TRUNCATION_CAUSES].reduce((best, cause) =>
			byCause[cause] > byCause[best] ? cause : best,
		);
		summaries.push({ modelId, total, byCause, dominantCause, recommendation: REMEDIATION[dominantCause] });
	}
	return summaries.sort((a, b) => b.total - a.total || a.modelId.localeCompare(b.modelId));
}
