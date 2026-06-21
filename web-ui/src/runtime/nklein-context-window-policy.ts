import type { RuntimeNKleinProviderModel } from "@/runtime/types";

export const NKLEIN_MIN_CONTEXT_WINDOW_TOKENS = 32_000;
export const LM_STUDIO_PROVIDER_ID = "lmstudio";

export function isLmStudioProviderId(providerId: string | null | undefined): boolean {
	return providerId?.trim().toLowerCase() === LM_STUDIO_PROVIDER_ID;
}

export function formatNKleinContextWindowTokens(value: number): string {
	return value.toLocaleString();
}

export function findNKleinProviderModel(
	models: readonly RuntimeNKleinProviderModel[],
	modelId: string | null | undefined,
): RuntimeNKleinProviderModel | null {
	const trimmedModelId = modelId?.trim();
	if (!trimmedModelId) {
		return null;
	}
	return models.find((model) => model.id === trimmedModelId) ?? null;
}

export function isNKleinModelContextWindowAccepted(model: RuntimeNKleinProviderModel | null): boolean {
	return (
		typeof model?.contextWindow === "number" &&
		Number.isFinite(model.contextWindow) &&
		model.contextWindow >= NKLEIN_MIN_CONTEXT_WINDOW_TOKENS
	);
}

export function formatNKleinModelContextWindowLabel(model: RuntimeNKleinProviderModel): string {
	const contextWindow = model.contextWindow;
	const baseLabel = model.name.trim() || model.id;
	if (typeof contextWindow !== "number" || !Number.isFinite(contextWindow) || contextWindow <= 0) {
		return `${baseLabel} (context unknown)`;
	}
	const contextLabel = `${formatNKleinContextWindowTokens(contextWindow)} ctx`;
	return contextWindow >= NKLEIN_MIN_CONTEXT_WINDOW_TOKENS
		? `${baseLabel} (${contextLabel})`
		: `${baseLabel} (${contextLabel}, below ${formatNKleinContextWindowTokens(NKLEIN_MIN_CONTEXT_WINDOW_TOKENS)})`;
}

export function getNKleinModelContextWindowWarning(input: {
	model: RuntimeNKleinProviderModel | null;
	modelId: string | null | undefined;
	label?: string;
}): string | null {
	const modelId = input.modelId?.trim();
	if (!modelId) {
		return null;
	}
	const label = input.label?.trim() || "Selected model";
	const required = formatNKleinContextWindowTokens(NKLEIN_MIN_CONTEXT_WINDOW_TOKENS);
	if (!input.model) {
		return `${label} has no loaded context-window metadata. !Klein requires at least ${required} context tokens before activation.`;
	}
	const contextWindow = input.model.contextWindow;
	if (typeof contextWindow !== "number" || !Number.isFinite(contextWindow) || contextWindow <= 0) {
		return `${label} does not report a context window. !Klein requires at least ${required} context tokens before activation.`;
	}
	if (contextWindow < NKLEIN_MIN_CONTEXT_WINDOW_TOKENS) {
		return `${label} reports ${formatNKleinContextWindowTokens(contextWindow)} context tokens. !Klein requires at least ${required} before activation.`;
	}
	return null;
}
