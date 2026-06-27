import { describe, expect, it } from "vitest";
import {
	buildKanbanContextPressurePolicy,
	buildKanbanContextSafetyBudgets,
	countKanbanTextTokens,
} from "../../../src/nklein-agent/nklein-context-budgets";

describe("countKanbanTextTokens", () => {
	it("is 0 for empty text and grows with content", () => {
		expect(countKanbanTextTokens("")).toBe(0);
		expect(countKanbanTextTokens("hello world")).toBeGreaterThan(0);
		expect(countKanbanTextTokens("a b c d e f g")).toBeGreaterThan(countKanbanTextTokens("a"));
	});
});

describe("buildKanbanContextSafetyBudgets", () => {
	it("uses the unknown-window fallbacks for null/0/negative input", () => {
		for (const bad of [null, undefined, 0, -100]) {
			const b = buildKanbanContextSafetyBudgets(bad);
			expect(b.contextWindow).toBeNull();
			expect(b.outputReserveTokens).toBe(8_000);
			expect(b.promptOverheadReserveTokens).toBe(12_000);
			expect(b.safeWorkingBudget).toBeNull();
			expect(b.fileChunkTokenBudget).toBe(12_000);
			expect(b.fileChunkContentTokenBudget).toBe(11_000);
			expect(b.fileChunkCharBudget).toBe(48_000);
		}
	});

	it("caps the reserves + file-chunk budget on a very large window", () => {
		const b = buildKanbanContextSafetyBudgets(200_000);
		expect(b.outputReserveTokens).toBe(16_000); // capped
		expect(b.promptOverheadReserveTokens).toBe(24_000); // capped
		expect(b.safeWorkingBudget).toBe(160_000);
		expect(b.fileChunkTokenBudget).toBe(64_000); // capped
		expect(b.fileChunkContentTokenBudget).toBe(63_000);
		expect(b.fileChunkCharBudget).toBe(256_000);
	});

	it("scales proportionally on a mid window (8k)", () => {
		const b = buildKanbanContextSafetyBudgets(8_000);
		expect(b.outputReserveTokens).toBe(800);
		expect(b.promptOverheadReserveTokens).toBe(1_200);
		expect(b.safeWorkingBudget).toBe(6_000);
		expect(b.fileChunkTokenBudget).toBe(3_600); // min(0.5*window, 0.6*safeWorking)
		expect(b.fileChunkContentTokenBudget).toBe(2_600);
	});

	it("floors reserves + chunk budget on a tiny window and truncates a fractional window", () => {
		const b = buildKanbanContextSafetyBudgets(2_000);
		expect(b.outputReserveTokens).toBe(512); // floored
		expect(b.promptOverheadReserveTokens).toBe(1_024); // floored
		expect(b.fileChunkTokenBudget).toBe(512); // floored to MIN
		expect(b.fileChunkContentTokenBudget).toBe(1_000); // floored to MIN content
		expect(buildKanbanContextSafetyBudgets(8_000.9).contextWindow).toBe(8_000); // truncated
	});
});

describe("buildKanbanContextPressurePolicy", () => {
	it("an unknown window sits at the default medium pressure", () => {
		const p = buildKanbanContextPressurePolicy({});
		expect(p.contextWindow).toBeNull();
		expect(p.pressure).toBe("medium");
		expect(p.repoMapTokenBudget).toBe(674);
		expect(p.retrievalResultTokenBudget).toBe(1_755);
		expect(p.compactionTriggerRatio).toBeCloseTo(0.717, 3);
	});

	it("a large window is low pressure with capped budgets and the base compaction ratio", () => {
		const p = buildKanbanContextPressurePolicy({ contextWindow: 200_000 });
		expect(p.pressure).toBe("low");
		expect(p.repoMapTokenBudget).toBe(1_500); // capped
		expect(p.retrievalResultTokenBudget).toBe(4_000); // capped
		expect(p.compactionTriggerRatio).toBeCloseTo(0.78, 3);
	});

	it("a small window is high pressure with floored budgets and an earlier compaction trigger", () => {
		const p = buildKanbanContextPressurePolicy({ contextWindow: 8_000 });
		expect(p.pressure).toBe("high");
		expect(p.repoMapTokenBudget).toBe(250); // floored
		expect(p.retrievalResultTokenBudget).toBe(600); // floored
		expect(p.compactionTriggerRatio).toBeCloseTo(0.6, 3);
	});

	it("a 16k window lands in the medium band", () => {
		expect(buildKanbanContextPressurePolicy({ contextWindow: 16_000 }).pressure).toBe("medium");
	});

	it("slow local prefill drives high pressure even when the window is unknown (max of the two signals)", () => {
		expect(buildKanbanContextPressurePolicy({ wallTimeMsPer1kPromptTokens: 5_000 }).pressure).toBe("high");
	});

	it("always clamps the compaction trigger into [0.55, 0.82]", () => {
		for (const contextWindow of [500, 8_000, 24_000, 200_000, null]) {
			const ratio = buildKanbanContextPressurePolicy({ contextWindow }).compactionTriggerRatio;
			expect(ratio).toBeGreaterThanOrEqual(0.55);
			expect(ratio).toBeLessThanOrEqual(0.82);
		}
	});
});
