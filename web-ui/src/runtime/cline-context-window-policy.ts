import type { RuntimeClineProviderModel } from "@/runtime/types";

export const CLINE_MIN_CONTEXT_WINDOW_TOKENS = 32_000;
export const LM_STUDIO_PROVIDER_ID = "lmstudio";

export function isLmStudioProviderId(providerId: string | null | undefined): boolean {
	return providerId?.trim().toLowerCase() === LM_STUDIO_PROVIDER_ID;
}

export function formatClineContextWindowTokens(value: number): string {
	return value.toLocaleString();
}

export function findClineProviderModel(
	models: readonly RuntimeClineProviderModel[],
	modelId: string | null | undefined,
): RuntimeClineProviderModel | null {
	const trimmedModelId = modelId?.trim();
	if (!trimmedModelId) {
		return null;
	}
	return models.find((model) => model.id === trimmedModelId) ?? null;
}

export function isClineModelContextWindowAccepted(model: RuntimeClineProviderModel | null): boolean {
	return (
		typeof model?.contextWindow === "number" &&
		Number.isFinite(model.contextWindow) &&
		model.contextWindow >= CLINE_MIN_CONTEXT_WINDOW_TOKENS
	);
}

export function formatClineModelContextWindowLabel(model: RuntimeClineProviderModel): string {
	const contextWindow = model.contextWindow;
	const baseLabel = model.name.trim() || model.id;
	if (typeof contextWindow !== "number" || !Number.isFinite(contextWindow) || contextWindow <= 0) {
		return `${baseLabel} (context unknown)`;
	}
	const contextLabel = `${formatClineContextWindowTokens(contextWindow)} ctx`;
	return contextWindow >= CLINE_MIN_CONTEXT_WINDOW_TOKENS
		? `${baseLabel} (${contextLabel})`
		: `${baseLabel} (${contextLabel}, below ${formatClineContextWindowTokens(CLINE_MIN_CONTEXT_WINDOW_TOKENS)})`;
}

export function getClineModelContextWindowWarning(input: {
	model: RuntimeClineProviderModel | null;
	modelId: string | null | undefined;
	label?: string;
}): string | null {
	const modelId = input.modelId?.trim();
	if (!modelId) {
		return null;
	}
	const label = input.label?.trim() || "Selected model";
	const required = formatClineContextWindowTokens(CLINE_MIN_CONTEXT_WINDOW_TOKENS);
	if (!input.model) {
		return `${label} has no loaded context-window metadata. !Klein requires at least ${required} context tokens before activation.`;
	}
	const contextWindow = input.model.contextWindow;
	if (typeof contextWindow !== "number" || !Number.isFinite(contextWindow) || contextWindow <= 0) {
		return `${label} does not report a context window. !Klein requires at least ${required} context tokens before activation.`;
	}
	if (contextWindow < CLINE_MIN_CONTEXT_WINDOW_TOKENS) {
		return `${label} reports ${formatClineContextWindowTokens(contextWindow)} context tokens. !Klein requires at least ${required} before activation.`;
	}
	return null;
}
