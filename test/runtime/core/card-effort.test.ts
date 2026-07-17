import { describe, expect, it } from "vitest";
import { assessEffortBudget, type CardEffortRun, computeCardEffort } from "../../../src/core/card-effort";

function run(overrides: Partial<CardEffortRun> & { taskId: string }): CardEffortRun {
	return {
		startedAt: 1_000,
		endedAt: 61_000,
		promptTokens: 800,
		completionTokens: 200,
		totalTokens: 1_000,
		modelId: "m-a",
		...overrides,
	};
}

describe("computeCardEffort (F12.58)", () => {
	it("folds runs per card, most expensive first, with a board rollup", () => {
		const rollup = computeCardEffort([
			run({ taskId: "cheap" }),
			run({ taskId: "pricey", totalTokens: 5_000, promptTokens: 4_000, completionTokens: 1_000 }),
			run({ taskId: "pricey", totalTokens: 3_000, promptTokens: 2_500, completionTokens: 500, modelId: "m-b" }),
		]);
		expect(rollup.cards.map((card) => card.taskId)).toEqual(["pricey", "cheap"]);
		expect(rollup.cards[0]).toMatchObject({ runs: 2, totalTokens: 8_000, wallMs: 120_000, models: ["m-a", "m-b"] });
		expect(rollup.boardTotalTokens).toBe(9_000);
	});

	it("counts untracked runs honestly and falls back to prompt+completion when total is absent", () => {
		const rollup = computeCardEffort([
			run({ taskId: "t", totalTokens: null }),
			run({ taskId: "t", totalTokens: null, promptTokens: null, completionTokens: null }),
		]);
		expect(rollup.cards[0]?.totalTokens).toBe(1_000);
		expect(rollup.cards[0]?.untrackedRuns).toBe(1);
		expect(rollup.boardUntrackedRuns).toBe(1);
	});

	it("assesses the soft cap in advisory tiers", () => {
		expect(assessEffortBudget({ totalTokens: 100 }, 1_000).tier).toBe("within");
		expect(assessEffortBudget({ totalTokens: 800 }, 1_000).tier).toBe("approaching");
		expect(assessEffortBudget({ totalTokens: 1_200 }, 1_000).tier).toBe("over");
		expect(assessEffortBudget({ totalTokens: 999 }, 0).tier).toBe("within");
	});
});
