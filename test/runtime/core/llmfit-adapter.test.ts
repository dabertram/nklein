import { describe, expect, it } from "vitest";
import {
	type LlmfitModel,
	llmfitClaimsToolUse,
	llmfitFitClears,
	parseLlmfitModel,
	parseLlmfitRecommend,
	parseLlmfitSystemReport,
} from "../../../src/core/llmfit-adapter";

// Real shapes captured in docs/dev/llmfit-spike.md (2026-06-29).
const recommendJson = {
	models: [
		{
			name: "google/gemma-4-E4B-it",
			best_quant: "mlx-8bit",
			category: "Multimodal",
			capabilities: ["Vision", "Tool Use"],
			capability_ids: ["vision", "tool_use"],
			context_length: 131072,
			effective_context_length: 8192,
			fit_level: "Perfect",
			memory_required_gb: 9.15,
			memory_available_gb: 128.0,
			moe_offloaded_gb: null,
			is_moe: false,
			estimated_tps: 42.2,
			installed: true,
			license: "apache-2.0",
		},
	],
	system: {
		available_ram_gb: 121.35,
		total_ram_gb: 128.0,
		gpu_vram_gb: 128.0,
		gpu_name: "Apple M5 Max",
		backend: "Metal",
		cpu_cores: 18,
		unified_memory: true,
	},
};

describe("parseLlmfitRecommend", () => {
	it("parses the recommend shape: model fields + system", () => {
		const result = parseLlmfitRecommend(recommendJson);
		expect(result.models).toHaveLength(1);
		expect(result.models[0]).toMatchObject({
			name: "google/gemma-4-E4B-it",
			bestQuant: "mlx-8bit",
			fitLevel: "Perfect",
			memoryRequiredGb: 9.15,
			estimatedTps: 42.2,
			isMoe: false,
			installed: true,
			effectiveContextLength: 8192,
			capabilityIds: ["vision", "tool_use"],
			license: "apache-2.0",
		});
		expect(result.system).toMatchObject({ gpuVramGb: 128.0, backend: "Metal", unifiedMemory: true, cpuCores: 18 });
	});

	it("tolerates a bare array of models and drops entries without a name", () => {
		const result = parseLlmfitRecommend([{ name: "a", fit_level: "Good" }, { fit_level: "Perfect" }, "junk"]);
		expect(result.models.map((m) => m.name)).toEqual(["a"]);
		expect(result.system).toBeNull();
	});

	it("is tolerant of garbage / missing fields", () => {
		expect(parseLlmfitRecommend(null).models).toEqual([]);
		expect(parseLlmfitModel({ name: "m" })).toMatchObject({ name: "m", fitLevel: null, estimatedTps: null });
		expect(parseLlmfitModel({})).toBeNull();
	});
});

describe("parseLlmfitSystemReport", () => {
	it("reads { system: {...} } and a bare system object", () => {
		expect(parseLlmfitSystemReport({ system: recommendJson.system })?.gpuVramGb).toBe(128.0);
		expect(parseLlmfitSystemReport(recommendJson.system)?.cpuCores).toBe(18);
		expect(parseLlmfitSystemReport(null)).toBeNull();
	});
});

describe("llmfit verdict helpers", () => {
	const model = (over: Partial<LlmfitModel>): LlmfitModel => ({
		name: "m",
		bestQuant: null,
		fitLevel: null,
		memoryRequiredGb: null,
		memoryAvailableGb: null,
		estimatedTps: null,
		isMoe: false,
		moeOffloadedGb: null,
		installed: false,
		contextLength: null,
		effectiveContextLength: null,
		capabilityIds: [],
		license: null,
		...over,
	});

	it("llmfitFitClears: Perfect/Good clear; Marginal/Too Tight/unknown do not", () => {
		expect(llmfitFitClears(model({ fitLevel: "Perfect" }))).toBe(true);
		expect(llmfitFitClears(model({ fitLevel: "Good" }))).toBe(true);
		expect(llmfitFitClears(model({ fitLevel: "Marginal" }))).toBe(false);
		expect(llmfitFitClears(model({ fitLevel: "Too Tight" }))).toBe(false);
		expect(llmfitFitClears(model({ fitLevel: null }))).toBe(false); // conservative on missing data
	});

	it("llmfitClaimsToolUse: reads the capability tag (a pre-filter, not the §5.AL verdict)", () => {
		expect(llmfitClaimsToolUse(model({ capabilityIds: ["vision", "tool_use"] }))).toBe(true);
		expect(llmfitClaimsToolUse(model({ capabilityIds: ["vision"] }))).toBe(false);
	});
});

describe("buildLlmfitArgs (per-pool simulation)", () => {
	it("puts --json + machine/context overrides BEFORE the subcommand", async () => {
		const { buildLlmfitArgs } = await import("../../../src/core/llmfit-adapter");
		expect(buildLlmfitArgs("recommend")).toEqual(["--json", "recommend"]);
		expect(
			buildLlmfitArgs("recommend", { machine: { vram: "8G", ram: "32G", cpuCores: 16 }, maxContext: 8192 }),
		).toEqual([
			"--json",
			"--memory",
			"8G",
			"--ram",
			"32G",
			"--cpu-cores",
			"16",
			"--max-context",
			"8192",
			"recommend",
		]);
	});
});

describe("llmfitRecommend / llmfitSystem (injected runner)", () => {
	it("runs recommend with the pool envelope and parses the output", async () => {
		const { llmfitRecommend } = await import("../../../src/core/llmfit-adapter");
		let seenArgs: readonly string[] = [];
		const run = async (args: readonly string[]) => {
			seenArgs = args;
			return { stdout: JSON.stringify(recommendJson), exitCode: 0 };
		};
		const result = await llmfitRecommend(run, { machine: { vram: "8G" }, maxContext: 8192 });
		expect(seenArgs).toEqual(["--json", "--memory", "8G", "--max-context", "8192", "recommend"]);
		expect(result.models[0]?.name).toBe("google/gemma-4-E4B-it");
	});

	it("returns empty on a non-zero exit or unparseable stdout", async () => {
		const { llmfitRecommend, llmfitSystem } = await import("../../../src/core/llmfit-adapter");
		expect(await llmfitRecommend(async () => ({ stdout: "", exitCode: 1 }))).toEqual({ models: [], system: null });
		expect(await llmfitRecommend(async () => ({ stdout: "not json", exitCode: 0 }))).toEqual({
			models: [],
			system: null,
		});
		expect(await llmfitSystem(async () => ({ stdout: "boom", exitCode: 0 }))).toBeNull();
	});
});
