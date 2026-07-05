import { describe, expect, it } from "vitest";
import { applyTurnThinkingControl, resolveTurnThinkingControl } from "../../../src/core/turn-thinking-directive";

// qwen/qwen3-8b has the live-verified /no_think switch; qwen2.5-coder-14b is non-reasoning (no switch).
const SWITCHABLE = "qwen/qwen3-8b";
const NO_SWITCH = "qwen2.5-coder-14b";

describe("resolveTurnThinkingControl", () => {
	it("disables thinking on a simple/execution turn for a switchable model", () => {
		expect(resolveTurnThinkingControl(SWITCHABLE, "execution", "easy").disableThinking).toBe(true);
		expect(resolveTurnThinkingControl(SWITCHABLE, "simple", "medium").disableThinking).toBe(true);
	});

	it("keeps thinking for a hard task or a deliberative turn", () => {
		expect(resolveTurnThinkingControl(SWITCHABLE, "execution", "hard").disableThinking).toBe(false);
		expect(resolveTurnThinkingControl(SWITCHABLE, "planning", "easy").disableThinking).toBe(false);
	});

	it("is a no-op for a model with no controllable switch (nothing to toggle)", () => {
		const r = resolveTurnThinkingControl(NO_SWITCH, "execution", "easy");
		expect(r.disableThinking).toBe(false);
		expect(r.reason).toMatch(/no controllable thinking switch/i);
	});
});

describe("applyTurnThinkingControl", () => {
	it("appends the model's disable token when the policy disables thinking", () => {
		const out = applyTurnThinkingControl("do the thing", SWITCHABLE, "execution", "easy");
		expect(out).toContain("/no_think");
		expect(out).toContain("do the thing");
	});

	it("leaves the prompt unchanged when thinking is kept", () => {
		expect(applyTurnThinkingControl("plan it", SWITCHABLE, "planning", "easy")).toBe("plan it");
	});

	it("leaves the prompt unchanged for a non-switchable model", () => {
		expect(applyTurnThinkingControl("do it", NO_SWITCH, "execution", "easy")).toBe("do it");
	});
});
