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
			sessionRole: "worker",
		});
		expect(decision.enforce).toBe(true);
		expect(decision.enforce && decision.keepNames).toHaveLength(7);
	});

	it("refuses under the cap — there is nothing to trim", () => {
		const decision = decideToolGateEnforcement({
			offeredCount: 7,
			verdict: { selected: tools(7), arbitrary: false },
			sessionRole: "worker",
		});
		expect(decision).toEqual({ enforce: false, reason: "under_cap" });
	});

	it("refuses an ARBITRARY selection — dropping tools blindly is not the gate choosing", () => {
		// Any A/B delta produced by an arbitrary trim would be noise credited to the mechanism.
		const decision = decideToolGateEnforcement({
			offeredCount: 28,
			verdict: { selected: tools(7), arbitrary: true },
			sessionRole: "worker",
		});
		expect(decision).toEqual({ enforce: false, reason: "arbitrary_selection" });
	});

	it("refuses an EMPTY selection rather than offering the model nothing", () => {
		const decision = decideToolGateEnforcement({
			offeredCount: 28,
			verdict: { selected: [], arbitrary: false },
			sessionRole: "worker",
		});
		expect(decision).toEqual({ enforce: false, reason: "empty_selection" });
	});

	it("refuses when the selection would not shrink anything", () => {
		const decision = decideToolGateEnforcement({
			offeredCount: 28,
			verdict: { selected: tools(28), arbitrary: false },
			sessionRole: "worker",
		});
		expect(decision).toEqual({ enforce: false, reason: "selection_not_smaller" });
	});

	it("enforces ONLY a worker session — the real role, after three proxies failed", () => {
		// Round 3 proved tool-presence is not a role signal: decompose_project is offered in ordinary ACT
		// catalogs, so a "planning marker" exemption swallowed every session and enforcement measured nothing.
		const worker = decideToolGateEnforcement({
			offeredCount: 28,
			verdict: { selected: tools(7), arbitrary: false },
			sessionRole: "worker",
		});
		expect(worker.enforce).toBe(true);
	});

	it("refuses every NON-worker role by name, so the A/B can count them", () => {
		for (const role of ["architect", "reviewer", "planner"]) {
			const decision = decideToolGateEnforcement({
				offeredCount: 28,
				verdict: { selected: tools(7), arbitrary: false },
				sessionRole: role,
			});
			expect(decision, role).toEqual({ enforce: false, reason: "non_worker_role" });
		}
	});

	it("refuses an UNKNOWN role rather than narrowing on a guess", () => {
		// An unattributed session must not be narrowed; the refusal is its own reason so a run where role
		// registration silently broke shows up as role_unknown counts, not as mysterious non-enforcement.
		for (const role of [null, undefined, ""]) {
			const decision = decideToolGateEnforcement({
				offeredCount: 28,
				verdict: { selected: tools(7), arbitrary: false },
				sessionRole: role,
			});
			expect(decision).toEqual({ enforce: false, reason: "role_unknown" });
		}
	});
});
