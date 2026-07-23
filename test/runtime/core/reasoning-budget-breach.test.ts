import { describe, expect, it } from "vitest";
import {
	applyReasoningForcedOffEvent,
	createReasoningBudgetTracker,
	DEFAULT_REASONING_BUDGET_TOKENS,
	estimateReasoningTokensFromChars,
	REASONING_BUDGET_BREACH_NUDGE,
	REASONING_FORCED_OFF_CLEAR,
	reasoningBudgetRecovery,
} from "../../../src/core/reasoning-budget-breach";

describe("reasoning-budget breach (adopted from little-coder's thinking-budget; docs/attributions.md)", () => {
	it("keeps little-coder's chars→tokens approximation (ceil(chars/3.5)) for comparability", () => {
		expect(estimateReasoningTokensFromChars(0)).toBe(0);
		expect(estimateReasoningTokensFromChars(7)).toBe(2);
		expect(estimateReasoningTokensFromChars(3.5 * 4096)).toBe(4096);
		expect(estimateReasoningTokensFromChars(-10)).toBe(0);
	});

	it("fires exactly ONCE, on the delta that crosses the budget, and stays breached after", () => {
		const tracker = createReasoningBudgetTracker(10);
		expect(tracker.addReasoningDelta(17)).toBe(false); // ceil(17/3.5)=5 ≤ 10
		expect(tracker.addReasoningDelta(17)).toBe(false); // 34 chars ⇒ 10 tokens, not > budget yet
		expect(tracker.addReasoningDelta(4)).toBe(true); // 38 chars ⇒ 11 tokens > 10 — the breach
		expect(tracker.breached()).toBe(true);
		expect(tracker.addReasoningDelta(1000)).toBe(false); // never fires twice
		expect(tracker.spentTokens()).toBeGreaterThan(10);
	});

	it("ignores empty/negative deltas and defaults to little-coder's 4096-token budget", () => {
		const tracker = createReasoningBudgetTracker();
		expect(tracker.addReasoningDelta(0)).toBe(false);
		expect(tracker.addReasoningDelta(-5)).toBe(false);
		expect(tracker.spentTokens()).toBe(0);
		expect(DEFAULT_REASONING_BUDGET_TOKENS).toBe(4096);
	});

	it("recovery = abort the turn + disable thinking + the commit-now nudge (never 'think harder')", () => {
		const recovery = reasoningBudgetRecovery();
		expect(recovery.abortTurn).toBe(true);
		expect(recovery.disableThinking).toBe(true);
		expect(recovery.nudge).toBe(REASONING_BUDGET_BREACH_NUDGE);
		expect(recovery.nudge).toMatch(/Commit to an implementation NOW/);
	});

	it("forced-off latches on breach, captures the prior level ONCE, and releases only on user input or session start", () => {
		let state = REASONING_FORCED_OFF_CLEAR;
		state = applyReasoningForcedOffEvent(state, { kind: "breach", activeLevel: "high" });
		expect(state).toEqual({ forcedOff: true, priorLevel: "high" });
		// A repeat breach inside the forced-off window must NOT overwrite the captured level with "off".
		state = applyReasoningForcedOffEvent(state, { kind: "breach", activeLevel: null });
		expect(state.priorLevel).toBe("high");
		state = applyReasoningForcedOffEvent(state, { kind: "genuine_user_input" });
		expect(state).toEqual(REASONING_FORCED_OFF_CLEAR);
		const fresh = applyReasoningForcedOffEvent(
			applyReasoningForcedOffEvent(REASONING_FORCED_OFF_CLEAR, { kind: "breach", activeLevel: null }),
			{ kind: "session_start" },
		);
		expect(fresh).toEqual(REASONING_FORCED_OFF_CLEAR);
	});
});
