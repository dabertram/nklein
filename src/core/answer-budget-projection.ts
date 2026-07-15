/**
 * F4.10 — project observed answer sizes (output tokens) per model from the §5.Q model-performance observations, so
 * `learnAnswerBudget` can derive a learned budget from real evidence (mount / prompt-assembly cap). Each observation
 * that recorded token usage contributes its `outputTokens` to its model's sample list; observations without usage or a
 * model id are skipped. PURE + deterministic.
 */

export interface AnswerSizeObservation {
	modelId: string | null;
	usage: { outputTokens: number } | null;
}

/** Group observed output-token counts by model id (skipping observations lacking usage or a model). */
export function buildAnswerSizesByModel(observations: readonly AnswerSizeObservation[]): Map<string, number[]> {
	const byModel = new Map<string, number[]>();
	for (const observation of observations) {
		if (observation.modelId === null || observation.usage === null) {
			continue;
		}
		const list = byModel.get(observation.modelId) ?? [];
		list.push(observation.usage.outputTokens);
		byModel.set(observation.modelId, list);
	}
	return byModel;
}
