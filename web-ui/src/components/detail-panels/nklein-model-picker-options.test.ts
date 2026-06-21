import { describe, expect, it } from "vitest";

import {
	buildNKleinAgentModelPickerOptions,
	buildNKleinSelectedModelButtonText,
	formatNKleinReasoningEffortLabel,
	formatNKleinSelectedModelButtonText,
	getNKleinReasoningEnabledModelIds,
	NKLEIN_RECOMMENDED_MODEL_IDS,
	resolveNKleinModelDisplayName,
} from "@/components/detail-panels/nklein-model-picker-options";
import type { RuntimeNKleinProviderModel } from "@/runtime/types";

function createModel(id: string, name: string): RuntimeNKleinProviderModel {
	return { id, name };
}

describe("buildNKleinAgentModelPickerOptions", () => {
	it("does not pin cloud recommendations for any provider", () => {
		const models: RuntimeNKleinProviderModel[] = [
			createModel("openai/gpt-5.5", "GPT-5.5"),
			createModel("openai/gpt-5.2", "GPT-5.2"),
			createModel("anthropic/claude-opus-4.7", "Claude Opus 4.7"),
			createModel("anthropic/claude-sonnet-4.6", "Claude Sonnet 4.6"),
			createModel("deepseek/deepseek-v4-pro", "DeepSeek V4 Pro"),
		];

		const result = buildNKleinAgentModelPickerOptions("nklein", models);

		expect(result.options.map((option) => option.value)).toEqual(models.map((model) => model.id));
		expect(NKLEIN_RECOMMENDED_MODEL_IDS).toEqual([]);
		expect(result.recommendedModelIds).toEqual([]);
		expect(result.shouldPinSelectedModelToTop).toBe(true);
	});

	it("keeps original ordering for non-nklein providers", () => {
		const models: RuntimeNKleinProviderModel[] = [
			createModel("model-a", "Model A"),
			createModel("model-b", "Model B"),
		];

		const result = buildNKleinAgentModelPickerOptions("openrouter", models);

		expect(result.options.map((option) => option.value)).toEqual(["model-a", "model-b"]);
		expect(result.recommendedModelIds).toEqual([]);
		expect(result.shouldPinSelectedModelToTop).toBe(true);
	});
});

describe("nklein model labels", () => {
	it("formats reasoning effort labels for display", () => {
		expect(formatNKleinReasoningEffortLabel("")).toBe("Default");
		expect(formatNKleinReasoningEffortLabel("xhigh")).toBe("Extra high");
	});

	it("appends non-default reasoning effort to the selected model label", () => {
		expect(
			formatNKleinSelectedModelButtonText({
				modelName: "GPT-5.4",
				reasoningEffort: "high",
				showReasoningEffort: true,
			}),
		).toBe("GPT-5.4 (High)");
	});

	it("omits reasoning effort when it is not shown", () => {
		expect(
			formatNKleinSelectedModelButtonText({
				modelName: "GPT-5.4",
				reasoningEffort: "high",
				showReasoningEffort: false,
			}),
		).toBe("GPT-5.4");
	});

	it("formats raw provider-qualified fallback model ids for compact card labels", () => {
		expect(resolveNKleinModelDisplayName("openai/gpt-5.5")).toBe("GPT-5.5");
		expect(resolveNKleinModelDisplayName("anthropic/claude-sonnet-4.6")).toBe("Claude Sonnet 4.6");
	});

	it("returns model IDs that support reasoning effort", () => {
		const models: RuntimeNKleinProviderModel[] = [
			{ id: "model-a", name: "Model A", supportsReasoningEffort: true },
			{ id: "model-b", name: "Model B", supportsReasoningEffort: false },
			{ id: "model-c", name: "Model C", supportsReasoningEffort: true },
		];

		expect(getNKleinReasoningEnabledModelIds(models)).toEqual(["model-a", "model-c"]);
	});

	it("builds selected model button text with loading and reasoning metadata", () => {
		expect(
			buildNKleinSelectedModelButtonText({
				modelOptions: [
					{ value: "openai/gpt-5.4", label: "GPT-5.4" },
					{ value: "openai/gpt-5.3-codex", label: "GPT-5.3 Codex" },
				],
				selectedModelId: "openai/gpt-5.4",
				reasoningEffort: "high",
				showReasoningEffort: true,
			}),
		).toBe("GPT-5.4 (High)");

		expect(
			buildNKleinSelectedModelButtonText({
				modelOptions: [],
				selectedModelId: "",
				showReasoningEffort: false,
				isModelLoading: true,
			}),
		).toBe("Loading models...");
	});

	it("resolves known model IDs to display names", () => {
		expect(resolveNKleinModelDisplayName("llama-3.1-8b")).toBe("llama-3.1-8b");
		expect(resolveNKleinModelDisplayName("openai/unknown-model")).toBe("openai/unknown-model");
	});
});
