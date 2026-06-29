import { describe, expect, it } from "vitest";
import { type SwarmRouteCandidate, selectSwarmRouteForTask } from "../../../src/core/model-swarm-route";

const cand = (over: Partial<SwarmRouteCandidate> & { modelKey: string; poolId: string }): SwarmRouteCandidate => ({
	capability: 80,
	contextWindow: 131072,
	predictedWallTimeMs: 1000,
	isFree: true,
	facts: { kind: "code", toolUse: "TOOL_NATIVE" },
	...over,
});

// A worker swarm across 3 machines: m4mini (small 7B), legion (mid), m5 (strong big coder).
const roster = (over: { m4?: Partial<SwarmRouteCandidate>; m5?: Partial<SwarmRouteCandidate> } = {}) => [
	cand({ modelKey: "coder-7b", poolId: "m4mini", capability: 45, ...over.m4 }),
	cand({ modelKey: "coder-14b", poolId: "legion", capability: 65 }),
	cand({ modelKey: "coder-next", poolId: "m5max", capability: 95, ...over.m5 }),
];

describe("selectSwarmRouteForTask (pool → model)", () => {
	it("routes an EASY worker card to the small machine and picks its model", () => {
		const decision = selectSwarmRouteForTask({
			role: "worker",
			difficulty: 40,
			requiredContextTokens: 32768,
			candidates: roster(),
			poolFreeSlots: { m4mini: 1, legion: 1, m5max: 1 },
		});
		expect(decision.poolId).toBe("m4mini");
		expect(decision.model?.selection.type).toBe("assign");
		if (decision.model?.selection.type === "assign") {
			expect(decision.model.selection.modelKey).toBe("coder-7b");
		}
	});

	it("routes a HARD card to the strong machine (only it clears the tier)", () => {
		const decision = selectSwarmRouteForTask({
			role: "worker",
			difficulty: 90,
			requiredContextTokens: 32768,
			candidates: roster(),
			poolFreeSlots: { m4mini: 1, legion: 1, m5max: 1 },
		});
		expect(decision.poolId).toBe("m5max");
	});

	it("skips a full small pool and routes the easy card to the next free machine", () => {
		const decision = selectSwarmRouteForTask({
			role: "worker",
			difficulty: 40,
			requiredContextTokens: 32768,
			candidates: roster(),
			poolFreeSlots: { m4mini: 0, legion: 1, m5max: 1 }, // m4mini full
		});
		expect(decision.poolId).toBe("legion");
	});

	it("a tool-UNSUITABLE model does not make its machine count for the worker role", () => {
		// m4mini hosts only a tool-unsuitable reasoning model → it must not be the worker pool even for an easy card.
		const decision = selectSwarmRouteForTask({
			role: "worker",
			difficulty: 40,
			requiredContextTokens: 32768,
			candidates: roster({ m4: { facts: { kind: "reasoning", toolUse: "TOOL_UNSUITABLE" }, capability: 99 } }),
			poolFreeSlots: { m4mini: 1, legion: 1, m5max: 1 },
		});
		expect(decision.poolId).toBe("legion"); // m4mini's only model is class-ineligible → smallest ELIGIBLE pool
	});

	it("returns no_capacity (model null) when every capable machine is full", () => {
		const decision = selectSwarmRouteForTask({
			role: "worker",
			difficulty: 40,
			requiredContextTokens: 32768,
			candidates: roster(),
			poolFreeSlots: { m4mini: 0, legion: 0, m5max: 0 },
		});
		expect(decision.pool.type).toBe("no_capacity");
		expect(decision.model).toBeNull();
		expect(decision.poolId).toBeNull();
	});
});
