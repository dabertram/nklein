import { describe, expect, it } from "vitest";
import { RUNTIME_NKLEIN_DEFAULT_CONTEXT_WINDOW_TOKENS } from "../../../src/core/api-contract";
import { buildKanbanContextSafetyBudgets } from "../../../src/nklein-agent/nklein-context-budgets";
import type { NKleinTaskRoutingDecision } from "../../../src/nklein-agent/nklein-task-router";
import {
	estimateNKleinStartFitBudgetTokens,
	estimateNKleinStartPromptTokens,
	formatNKleinTaskRoutingBlockMessage,
} from "../../../src/nklein-agent/nklein-task-start-guard";

describe("estimateNKleinStartPromptTokens (§5.V coverage)", () => {
	it("is zero for an empty prompt with no title/images", () => {
		expect(estimateNKleinStartPromptTokens({ prompt: "" })).toBe(0);
	});

	it("adds 1000 tokens per image on top of the text estimate", () => {
		const base = estimateNKleinStartPromptTokens({ prompt: "do the thing" });
		expect(estimateNKleinStartPromptTokens({ prompt: "do the thing", images: [{}, {}] })).toBe(base + 2000);
	});

	it("counts the task title in addition to the prompt", () => {
		const withoutTitle = estimateNKleinStartPromptTokens({ prompt: "body" });
		expect(estimateNKleinStartPromptTokens({ prompt: "body", taskTitle: "a descriptive title" })).toBeGreaterThan(
			withoutTitle,
		);
	});
});

describe("estimateNKleinStartFitBudgetTokens (§5.V coverage)", () => {
	it("adds the safety-budget reserves + the min working room to the prompt tokens", () => {
		const budgets = buildKanbanContextSafetyBudgets(32000);
		const expected = 100 + budgets.outputReserveTokens + budgets.promptOverheadReserveTokens + 4000;
		expect(estimateNKleinStartFitBudgetTokens(100, 32000)).toBe(expected);
	});

	it("uses the default context window when none is given", () => {
		expect(estimateNKleinStartFitBudgetTokens(100, null)).toBe(
			estimateNKleinStartFitBudgetTokens(100, RUNTIME_NKLEIN_DEFAULT_CONTEXT_WINDOW_TOKENS),
		);
	});
});

describe("formatNKleinTaskRoutingBlockMessage (§5.V coverage)", () => {
	it("frames a decompose block and includes the reason", () => {
		const msg = formatNKleinTaskRoutingBlockMessage({
			type: "decompose",
			reason: "too broad",
		} as Extract<NKleinTaskRoutingDecision, { type: "decompose" | "escalate" }>);
		expect(msg).toContain("needs decomposition");
		expect(msg).toContain("too broad");
	});

	it("frames an escalate block as needing a stronger model", () => {
		const msg = formatNKleinTaskRoutingBlockMessage({
			type: "escalate",
			reason: "too hard for 4B",
		} as Extract<NKleinTaskRoutingDecision, { type: "decompose" | "escalate" }>);
		expect(msg).toContain("needs a stronger/larger model");
		expect(msg).toContain("too hard for 4B");
	});
});
