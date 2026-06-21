import { buildNKleinAdvisorRequest, type NKleinAdvisorRequest } from "./nklein-advisor";
import { getDefaultNKleinModelRegistry, type NKleinModelRegistrySnapshot } from "./nklein-model-registry";

export function summarizeNKleinModelRegistryForResearch(snapshot: NKleinModelRegistrySnapshot): string {
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

export async function buildNKleinModelFreshnessAdvisorRequest(
	options: { getSnapshot?: () => Promise<NKleinModelRegistrySnapshot> } = {},
): Promise<NKleinAdvisorRequest> {
	const snapshot = await (options.getSnapshot ?? (() => getDefaultNKleinModelRegistry().getSnapshot()))();
	return buildNKleinAdvisorRequest("model_freshness", {
		modelRegistrySummary: summarizeNKleinModelRegistryForResearch(snapshot),
		userQuestion:
			"Check whether any connected role/model should be replaced by a newer comparable model. Do not auto-apply changes.",
	});
}
