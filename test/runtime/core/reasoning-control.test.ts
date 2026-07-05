import { describe, expect, it } from "vitest";
import { decideReasoningControl } from "../../../src/core/reasoning-control";

describe("decideReasoningControl", () => {
	it("disables thinking for simple/execution turns on non-hard tasks", () => {
		expect(decideReasoningControl("execution", "easy").enableThinking).toBe(false);
		expect(decideReasoningControl("simple", "medium").enableThinking).toBe(false);
	});

	it("keeps reasoning for hard tasks even on execution turns", () => {
		const d = decideReasoningControl("execution", "hard");
		expect(d.enableThinking).toBe(true);
		expect(d.reason).toContain("Hard task");
	});

	it("keeps reasoning for deliberative turns (planning/review/chat) on non-hard tasks", () => {
		expect(decideReasoningControl("planning", "easy").enableThinking).toBe(true);
		expect(decideReasoningControl("review", "medium").enableThinking).toBe(true);
		expect(decideReasoningControl("chat", "easy").enableThinking).toBe(true);
	});

	it("gives a reason mentioning the truncation/overhead rationale when disabling", () => {
		expect(decideReasoningControl("simple", "easy").reason).toMatch(/truncation|overhead|latency/i);
	});
});
