import { describe, expect, it } from "vitest";
import { planRequestEconomy } from "../../../src/core/request-economy-plan";

const base = {
	mode: "balance" as const,
	availableContextTokens: 64_000,
	systemPromptTokens: 2000,
	taskPromptTokens: 1000,
	expectedWorkingTokens: 5000,
	maxContextLength: 262_144,
	minContextFloor: 32_000,
	taskKind: "code" as const,
	flashAttention: true,
};

describe("planRequestEconomy", () => {
	it("composes the economy decisions for a standard coding request", () => {
		const plan = planRequestEconomy({ ...base, task: { taskText: "add a unit test for the parser" } });
		expect(plan.complexity).toBe("standard");
		// 64k window → cap "full"; standard complexity need → "balanced"; min(full, balanced)=balanced; balance mode unchanged.
		expect(plan.sysPromptLevel).toBe("balanced");
		// (2000+1000+5000)*1.5 = 12000 need → floored to 32000 load context (not the 262k max).
		expect(plan.estimatedContextNeed).toBe(12000);
		expect(plan.loadContextLength).toBe(32_000);
		// code task → strict sampler; flash attention on → q8 KV.
		expect(plan.sampler).toBe("tool_strict");
		expect(plan.kvCacheQuant).toBe("q8");
	});

	it("a novel/ambiguous task earns a deeper level and sizes up its load context", () => {
		const plan = planRequestEconomy({
			...base,
			availableContextTokens: 200_000,
			expectedWorkingTokens: 90_000,
			taskKind: "reasoning",
			task: { ambiguous: true },
		});
		expect(plan.complexity).toBe("novel");
		// 200k window → cap "max"; novel need → "max"; balance unchanged → "max".
		expect(plan.sysPromptLevel).toBe("max");
		expect(plan.loadContextLength).toBeGreaterThan(32_000);
		expect(plan.loadContextLength).toBeLessThan(262_144);
		expect(plan.sampler).toBe("balanced");
	});

	it("a small window forces a lean level even for a complex task (window caps the level)", () => {
		const plan = planRequestEconomy({
			...base,
			availableContextTokens: 6000, // < 8000 → the window caps the level at "lean" (strict-< thresholds)
			task: { taskText: "refactor the session module end-to-end" },
			flashAttention: false,
		});
		expect(plan.complexity).toBe("complex");
		// 8000 window → cap "lean"; complex need "full"; min → "lean".
		expect(plan.sysPromptLevel).toBe("lean");
		// no flash attention → no KV quant.
		expect(plan.kvCacheQuant).toBe("none");
	});
});
