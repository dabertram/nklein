import { describe, expect, it, vi } from "vitest";
import type { LoadedModelDescriptor } from "../../../src/core/lmstudio-loaded-model-descriptors";
import {
	readSpecDeliberationCompletionText,
	runSpecDeliberation,
	selectSpecDeliberationModels,
} from "../../../src/nklein-agent/nklein-spec-deliberation-runner";

const primary = {
	providerId: "lmstudio",
	modelId: "qwen-primary",
	modelKey: "qwen/qwen3.6-35b-a3b",
	baseUrl: "http://localhost:1234/v1",
	contextWindow: 32_768,
};

function descriptor(
	runtimeId: string,
	modelKey: string,
	overrides: Partial<LoadedModelDescriptor> = {},
): LoadedModelDescriptor {
	return {
		runtimeId,
		modelKey,
		isEmbedding: false,
		loadedContextLength: 32_768,
		...overrides,
	};
}

const ambiguousSpec = "Build a rate limiter. Admins are exempt. Store limits and make it fast.";

describe("selectSpecDeliberationModels", () => {
	it("keeps the routed model first and selects at most one >=32k model from each known family", () => {
		const selected = selectSpecDeliberationModels({
			primary,
			loaded: [
				descriptor("qwen-primary", "qwen/qwen3.6-35b-a3b"),
				descriptor("qwen-sibling", "qwen/qwen3.5-9b"),
				descriptor("mistral", "mistralai/mistral-small-3.2", { reasoning: true }),
				descriptor("llama", "meta-llama/llama-3.3-70b"),
				descriptor("tiny-context", "google/gemma-3-27b", { loadedContextLength: 16_384 }),
				descriptor("embedding", "nomic/embed-text-v1.5", { isEmbedding: true }),
			],
		});

		expect(selected.map((model) => model.modelId)).toEqual(["qwen-primary", "mistral", "llama"]);
		expect(selected.map((model) => model.family)).toEqual(["qwen", "mistral", "llama"]);
	});

	it("never treats unknown model ids as independent families", () => {
		const selected = selectSpecDeliberationModels({
			primary: { ...primary, modelId: "custom-a", modelKey: "custom-a" },
			loaded: [descriptor("custom-a", "custom-a"), descriptor("custom-b", "custom-b")],
		});
		expect(selected).toHaveLength(1);
		expect(selected[0]?.family).toBe("unknown");
	});
});

describe("readSpecDeliberationCompletionText", () => {
	it("prefers ordinary answer content", () => {
		expect(
			readSpecDeliberationCompletionText({
				content: "NO_AMBIGUITY",
				raw: { choices: [{ message: { reasoning_content: "discarded" } }] },
			}),
		).toBe("NO_AMBIGUITY");
	});

	it("recovers a reasoning-only local-model reply instead of silently disabling deliberation", () => {
		expect(
			readSpecDeliberationCompletionText({
				content: "",
				raw: {
					choices: [{ message: { reasoning_content: "AMBIGUITY: limit window | READINGS: fixed // sliding" } }],
				},
			}),
		).toContain("AMBIGUITY: limit window");
	});
});

describe("runSpecDeliberation", () => {
	it("does not spend model turns on a clear, low-difficulty specification", async () => {
		const runTurn = vi.fn();
		const result = await runSpecDeliberation({
			specText:
				"Implement src/add.ts exporting add(a: number, b: number): number. Return a + b. Acceptance: npm test passes.",
			difficulty: 0.1,
			primary,
			loaded: [descriptor("qwen-primary", primary.modelKey)],
			runTurn,
		});
		expect(result).toBeNull();
		expect(runTurn).not.toHaveBeenCalled();
	});

	it("fans out across distinct families and injects only the existing one-question discipline", async () => {
		const runTurn = vi.fn(async ({ stance }: { stance: { id: string } }) =>
			stance.id === "pessimist"
				? "AMBIGUITY: rate limit window | READINGS: fixed window // sliding window"
				: stance.id === "user_advocate"
					? "AMBIGUITY: admin identity | READINGS: token role // source IP"
					: "NO_AMBIGUITY",
		);
		const result = await runSpecDeliberation({
			specText: ambiguousSpec,
			difficulty: 0.8,
			primary,
			loaded: [
				descriptor("qwen-primary", primary.modelKey),
				descriptor("mistral", "mistralai/mistral-small-3.2"),
				descriptor("llama", "meta-llama/llama-3.3-70b"),
			],
			runTurn,
		});

		expect(result?.mode).toBe("cross_family");
		expect(runTurn).toHaveBeenCalledTimes(3);
		expect(result?.deliberation.disagreements).toHaveLength(2);
		expect(result?.guidance.join("\n")).toContain("ask EXACTLY ONE unresolved question per turn");
		expect(result?.guidance.join("\n")).toContain("raised by:");
	});

	it("labels the three-stance fallback honestly when only one family is available", async () => {
		const runTurn = vi.fn(async () => "AMBIGUITY: limit scope | READINGS: per user // per tenant");
		const result = await runSpecDeliberation({
			specText: ambiguousSpec,
			difficulty: 0.8,
			primary,
			loaded: [descriptor("qwen-primary", primary.modelKey)],
			runTurn,
		});

		expect(result?.mode).toBe("single_model_stances");
		expect(runTurn).toHaveBeenCalledTimes(3);
		expect(result?.deliberation.agreementCaveat).toContain("ONE model wearing different hats");
	});

	it("fails closed when cross-family staffing loses independent completions", async () => {
		const result = await runSpecDeliberation({
			specText: ambiguousSpec,
			difficulty: 0.8,
			primary,
			loaded: [descriptor("qwen-primary", primary.modelKey), descriptor("mistral", "mistralai/mistral-small-3.2")],
			runTurn: async ({ model }) =>
				model.family === "qwen" ? "AMBIGUITY: limit scope | READINGS: user // tenant" : null,
		});
		expect(result).toBeNull();
	});
});
