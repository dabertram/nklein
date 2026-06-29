import { describe, expect, it } from "vitest";
import { parseLmStudioRequestStats, renderLmStudioRequestStats } from "../../../src/core/lmstudio-request-stats";

describe("parseLmStudioRequestStats", () => {
	it("extracts /api/v0 stats, converting ttft + generation_time from seconds to ms", () => {
		const stats = parseLmStudioRequestStats({
			stats: {
				tokens_per_second: 111.67,
				time_to_first_token: 0.136,
				generation_time: 0.144,
				stop_reason: "eosFound",
			},
			model_info: { arch: "qwen3", quant: "4bit", context_length: 40000 },
		});
		expect(stats.tokensPerSecond).toBeCloseTo(111.67);
		expect(stats.ttftMs).toBe(136);
		expect(stats.generationTimeMs).toBe(144);
		expect(stats.stopReason).toBe("eosFound");
		expect(stats).toMatchObject({ arch: "qwen3", quant: "4bit", contextLength: 40000 });
	});

	it("returns all-null fields when stats are absent (e.g. the OpenAI /v1 empty-stats response)", () => {
		expect(parseLmStudioRequestStats({ stats: {} })).toEqual({
			tokensPerSecond: null,
			ttftMs: null,
			generationTimeMs: null,
			stopReason: null,
			arch: null,
			quant: null,
			contextLength: null,
		});
		expect(parseLmStudioRequestStats(null).tokensPerSecond).toBeNull();
	});
});

describe("renderLmStudioRequestStats", () => {
	it("renders a one-line summary, with n/a fallbacks", () => {
		const line = renderLmStudioRequestStats("qwen/qwen3-8b", {
			tokensPerSecond: 111.67,
			ttftMs: 136,
			generationTimeMs: 144,
			stopReason: "eosFound",
			arch: "qwen3",
			quant: "4bit",
			contextLength: 40000,
		});
		expect(line).toContain("111.7 tok/s");
		expect(line).toContain("136ms ttft");
		expect(line).toContain("eosFound");
		expect(line).toContain("qwen3 · 4bit · ctx 40000");
		expect(renderLmStudioRequestStats("m", parseLmStudioRequestStats({}))).toContain("tok/s n/a");
	});
});
