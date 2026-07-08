import { describe, expect, it } from "vitest";
import type { EnforcedReasoningDecision } from "../../../src/core/enforced-reasoning-gate";
import { runEnforcedReasoningLoop } from "../../../src/core/enforced-reasoning-loop";

function decision(kind: EnforcedReasoningDecision["kind"], rounds = 2): EnforcedReasoningDecision {
	return { enforce: kind !== "none", kind, rounds, reason: "test" };
}

describe("runEnforcedReasoningLoop (§5.AD — the gate's three kinds over injected completions)", () => {
	it("no-enforce passes the draft through untouched", async () => {
		const result = await runEnforcedReasoningLoop({
			task: "t",
			draft: "d",
			decision: decision("none"),
			deps: { completeSelf: async () => "never called" },
		});
		expect(result).toEqual({ finalDraft: "d", roundsRun: 0, trace: [] });
	});

	it("self_bounce: a revise verdict drives one revision, an ok verdict stops early", async () => {
		const calls: string[] = [];
		const result = await runEnforcedReasoningLoop({
			task: "Implement the parser",
			draft: "v1",
			decision: decision("self_bounce_varied", 3),
			deps: {
				completeSelf: async ({ system, user }) => {
					calls.push(system ? "critique" : "revise");
					if (system) {
						// Round 0 critique says revise; round 1 critique (over v2) says ok.
						return user.includes("v2") ? "Looks good.\nVERDICT: ok" : "1. Broken.\nVERDICT: revise";
					}
					return "v2";
				},
			},
		});
		expect(result.finalDraft).toBe("v2");
		expect(result.roundsRun).toBe(2);
		expect(calls).toEqual(["critique", "revise", "critique"]);
		expect(result.trace[0]).toContain("skeptical_reviewer): revise");
		expect(result.trace[1]).toContain("test_verifier): ok");
	});

	it("cross_model_carry: the stronger peer's REPAIRED section replaces the draft; no peer keeps it", async () => {
		const carried = await runEnforcedReasoningLoop({
			task: "t",
			draft: "weak draft",
			decision: decision("cross_model_carry", 1),
			deps: {
				completeSelf: async () => "unused",
				completeStronger: async () => "FINDINGS:\n1. Wrong.\n\nREPAIRED:\nstrong draft",
			},
			draftModelId: "small-9b",
		});
		expect(carried.finalDraft).toBe("strong draft");
		const noPeer = await runEnforcedReasoningLoop({
			task: "t",
			draft: "weak draft",
			decision: decision("cross_model_carry", 1),
			deps: { completeSelf: async () => "unused" },
		});
		expect(noPeer.finalDraft).toBe("weak draft");
	});

	it("self_consistency: majority vote over the draft + fresh samples; a throwing sample votes over what exists", async () => {
		let call = 0;
		const result = await runEnforcedReasoningLoop({
			task: "t",
			draft: "answer-A",
			decision: decision("self_consistency", 1),
			deps: {
				completeSelf: async () => {
					call += 1;
					if (call === 2) {
						throw new Error("down");
					}
					return "answer-A ";
				},
			},
			consistencySamples: 3,
		});
		expect(result.finalDraft.trim()).toBe("answer-A");
		expect(result.trace[0]).toContain("agreement");
	});
});
