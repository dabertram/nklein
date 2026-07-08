import { describe, expect, it } from "vitest";
import { type SwarmRoleModelCandidate, selectSwarmRoleModel } from "../../../src/core/role-model-swarm-pick";

const cand = (over: Partial<SwarmRoleModelCandidate> & { modelKey: string }): SwarmRoleModelCandidate => ({
	capability: 80,
	contextWindow: 131072,
	predictedWallTimeMs: 1000,
	isFree: true,
	...over,
});

describe("selectSwarmRoleModel (class gate → instance pick)", () => {
	it("drops a class-ineligible model and picks among the class-eligible pool for the worker", () => {
		const decision = selectSwarmRoleModel({
			role: "worker",
			difficulty: 50,
			requiredContextTokens: 32768,
			candidates: [
				cand({ modelKey: "reasoner", facts: { kind: "reasoning", toolUse: "TOOL_UNSUITABLE" }, capability: 99 }),
				cand({ modelKey: "coder", facts: { kind: "code", toolUse: "TOOL_NATIVE" }, capability: 70 }),
			],
		});
		expect(decision.classEligibleKeys).toEqual(["coder"]); // reasoner gated out despite higher capability
		expect(decision.selection.type).toBe("assign");
		if (decision.selection.type === "assign") {
			expect(decision.selection.modelKey).toBe("coder");
		}
	});

	it("returns no_fit when every candidate is the wrong class for the role", () => {
		const decision = selectSwarmRoleModel({
			role: "worker",
			difficulty: 10,
			requiredContextTokens: 32768,
			candidates: [cand({ modelKey: "r1", facts: { kind: "reasoning", toolUse: "TOOL_UNSUITABLE" } })],
		});
		expect(decision.selection.type).toBe("no_fit");
		if (decision.selection.type === "no_fit") {
			expect(decision.selection.reason).toMatch(/right model class/);
		}
	});

	it("surfaces a no_fit from the instance stage when class-eligible models miss the context floor", () => {
		const decision = selectSwarmRoleModel({
			role: "reviewer",
			difficulty: 20,
			requiredContextTokens: 200000, // larger than the candidate's window
			candidates: [
				cand({
					modelKey: "small-ctx",
					facts: { kind: "reasoning", toolUse: "TOOL_CAPABLE" },
					contextWindow: 32768,
				}),
			],
		});
		expect(decision.classEligibleKeys).toEqual(["small-ctx"]); // class-eligible…
		expect(decision.selection.type).toBe("no_fit"); // …but fails the instance feasibility floor
	});

	it("uses class-fit order as a soft preference before the efficient instance weighting", () => {
		const decision = selectSwarmRoleModel({
			role: "worker",
			difficulty: 30,
			requiredContextTokens: 32768,
			weighting: "efficient",
			candidates: [
				cand({
					modelKey: "generic-instruct",
					facts: { kind: "instruct", toolUse: "TOOL_CAPABLE" },
					capability: 45,
				}),
				cand({ modelKey: "native-coder", facts: { kind: "code", toolUse: "TOOL_NATIVE" }, capability: 80 }),
			],
		});

		expect(decision.classEligibleKeys[0]).toBe("native-coder");
		expect(decision.selection.type).toBe("assign");
		if (decision.selection.type === "assign") {
			expect(decision.selection.modelKey).toBe("native-coder");
		}
	});

	it("ignores a pin that is class-ineligible for the role (never pins a wrong-class model)", () => {
		const decision = selectSwarmRoleModel({
			role: "worker",
			difficulty: 30,
			requiredContextTokens: 32768,
			pinnedModelKey: "reasoner", // wrong class for worker → pin ignored
			candidates: [
				cand({ modelKey: "reasoner", facts: { kind: "reasoning", toolUse: "TOOL_UNSUITABLE" } }),
				cand({ modelKey: "coder", facts: { kind: "code", toolUse: "TOOL_NATIVE" } }),
			],
		});
		expect(decision.selection.type).toBe("assign");
		if (decision.selection.type === "assign") {
			expect(decision.selection.modelKey).toBe("coder");
		}
	});

	it("honors a class-eligible pin even when busy", () => {
		const decision = selectSwarmRoleModel({
			role: "worker",
			difficulty: 30,
			requiredContextTokens: 32768,
			pinnedModelKey: "coder-b",
			candidates: [
				cand({ modelKey: "coder-a", facts: { kind: "code", toolUse: "TOOL_NATIVE" }, isFree: true }),
				cand({ modelKey: "coder-b", facts: { kind: "code", toolUse: "TOOL_NATIVE" }, isFree: false }),
			],
		});
		expect(decision.selection.type).toBe("assign");
		if (decision.selection.type === "assign") {
			expect(decision.selection.modelKey).toBe("coder-b");
			expect(decision.selection.busyFallback).toBe(true);
		}
	});
});
