import { describe, expect, it } from "vitest";
import { estimateTaskContextNeed } from "../../../src/core/task-context-estimate";

describe("estimateTaskContextNeed", () => {
	it("sums the parts and applies the default 1.5x headroom (rounded up)", () => {
		// (2000 + 1000 + 5000) * 1.5 = 12000
		expect(
			estimateTaskContextNeed({ systemPromptTokens: 2000, taskPromptTokens: 1000, expectedWorkingTokens: 5000 }),
		).toBe(12000);
	});

	it("honors a custom headroom multiplier and rounds up", () => {
		// (1000 + 0 + 0) * 1.25 = 1250
		expect(
			estimateTaskContextNeed({
				systemPromptTokens: 1000,
				taskPromptTokens: 0,
				expectedWorkingTokens: 0,
				headroomMultiplier: 1.25,
			}),
		).toBe(1250);
	});

	it("falls back to the default multiplier for a non-positive override", () => {
		// 0 multiplier ignored → default 1.5: (100+100+100)*1.5 = 450
		expect(
			estimateTaskContextNeed({
				systemPromptTokens: 100,
				taskPromptTokens: 100,
				expectedWorkingTokens: 100,
				headroomMultiplier: 0,
			}),
		).toBe(450);
	});

	it("clamps negative inputs to zero", () => {
		expect(
			estimateTaskContextNeed({ systemPromptTokens: -500, taskPromptTokens: 1000, expectedWorkingTokens: -100 }),
		).toBe(1500);
	});

	it("returns 0 for an all-empty estimate", () => {
		expect(estimateTaskContextNeed({ systemPromptTokens: 0, taskPromptTokens: 0, expectedWorkingTokens: 0 })).toBe(0);
	});
});
