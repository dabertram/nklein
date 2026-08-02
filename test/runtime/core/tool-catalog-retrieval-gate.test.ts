import { describe, expect, it } from "vitest";
import { decideToolGateEnforcement } from "../../../src/core/tool-catalog-retrieval-gate";

/**
 * F12.18b — the ENFORCE arm's per-turn decision (built after P15.3's real-drain verdict said `enforce`).
 *
 * Every refusal errs toward the model seeing MORE tools: withholding the one tool a turn needs is a turn-level
 * failure the paired A/B would mis-attribute to enforcement, while offering too many is only the baseline.
 */
describe("decideToolGateEnforcement", () => {
	const tools = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `tool-${i}`, description: null }));

	it("enforces a real, smaller, non-arbitrary selection", () => {
		const decision = decideToolGateEnforcement({
			offeredCount: 28,
			verdict: { selected: tools(7), arbitrary: false },
		});
		expect(decision.enforce).toBe(true);
		expect(decision.enforce && decision.keepNames).toHaveLength(7);
	});

	it("refuses under the cap — there is nothing to trim", () => {
		const decision = decideToolGateEnforcement({
			offeredCount: 7,
			verdict: { selected: tools(7), arbitrary: false },
		});
		expect(decision).toEqual({ enforce: false, reason: "under_cap" });
	});

	it("refuses an ARBITRARY selection — dropping tools blindly is not the gate choosing", () => {
		// Any A/B delta produced by an arbitrary trim would be noise credited to the mechanism.
		const decision = decideToolGateEnforcement({
			offeredCount: 28,
			verdict: { selected: tools(7), arbitrary: true },
		});
		expect(decision).toEqual({ enforce: false, reason: "arbitrary_selection" });
	});

	it("refuses an EMPTY selection rather than offering the model nothing", () => {
		const decision = decideToolGateEnforcement({ offeredCount: 28, verdict: { selected: [], arbitrary: false } });
		expect(decision).toEqual({ enforce: false, reason: "empty_selection" });
	});

	it("refuses when the selection would not shrink anything", () => {
		const decision = decideToolGateEnforcement({
			offeredCount: 28,
			verdict: { selected: tools(28), arbitrary: false },
		});
		expect(decision).toEqual({ enforce: false, reason: "selection_not_smaller" });
	});
});
