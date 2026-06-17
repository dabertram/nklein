import { buildClineAdvisorRequest, type ClineAdvisorRequest } from "./cline-advisor";
import { type ClineModelRegistrySnapshot, getDefaultClineModelRegistry } from "./cline-model-registry";

export function summarizeClineModelRegistryForResearch(snapshot: ClineModelRegistrySnapshot): string {
	const entries = Object.values(snapshot.models).sort((left, right) => right.updatedAt - left.updatedAt);
	if (entries.length === 0) {
		return "No model registry entries recorded yet.";
	}
	return entries
		.map((entry) => {
			const contextWindow = entry.contextWindow.effective
				? `${entry.contextWindow.effective.toLocaleString()} tokens`
				: "unknown context";
			const capability = `${entry.capability.effectiveScore}/100 capability`;
			const speed = entry.speed.wallTimeMsPer1kPromptTokensEwma
				? `${Math.round(entry.speed.wallTimeMsPer1kPromptTokensEwma)}ms per 1k prompt tokens`
				: "unknown prompt speed";
			const endpoint = entry.constraints.sharedEndpointId ?? entry.endpoint ?? "default endpoint";
			return `- ${entry.providerId}:${entry.modelId} (${contextWindow}, ${capability}, ${speed}, endpoint ${endpoint})`;
		})
		.join("\n");
}

export async function buildClineModelFreshnessAdvisorRequest(
	options: { getSnapshot?: () => Promise<ClineModelRegistrySnapshot> } = {},
): Promise<ClineAdvisorRequest> {
	const snapshot = await (options.getSnapshot ?? (() => getDefaultClineModelRegistry().getSnapshot()))();
	return buildClineAdvisorRequest("model_freshness", {
		modelRegistrySummary: summarizeClineModelRegistryForResearch(snapshot),
		userQuestion:
			"Check whether any connected role/model should be replaced by a newer comparable model. Do not auto-apply changes.",
	});
}
