import { describe, expect, it } from "vitest";
import {
	CONTEXT_BUDGET_SEND_RESERVE_TOKENS,
	planContextBudget,
} from "../../../src/nklein-agent/nklein-context-budget-plan";

describe("planContextBudget", () => {
	it("is ok for a short prompt with empty history in a large window", () => {
		const plan = planContextBudget({ messages: [], prompt: "hi", contextWindow: 100_000 });
		expect(plan.outcome).toBe("ok");
		expect(plan.compactedMessages).toEqual([]);
		expect(plan.nextPromptTokens).toBeGreaterThan(0);
		// projected = compacted history + prompt + the response reserve.
		expect(plan.projectedTokens).toBe(
			plan.compactedHistoryTokens + plan.nextPromptTokens + CONTEXT_BUDGET_SEND_RESERVE_TOKENS,
		);
	});

	it("blocks when the prompt alone overflows the window after the send reserve", () => {
		// A window smaller than the response reserve can never fit any prompt.
		const plan = planContextBudget({ messages: [], prompt: "hi", contextWindow: 1000 });
		expect(plan.outcome).toBe("blocked");
		expect(plan.promptAloneOverflows).toBe(true);
	});

	it("treats a null/absent message history as empty", () => {
		const plan = planContextBudget({ messages: null, prompt: "hi", contextWindow: 100_000 });
		expect(plan.originalHistoryTokens).toBe(0);
		expect(plan.compactedMessages).toEqual([]);
	});
});
