import { describe, expect, it } from "vitest";
import {
	primaryAssignmentsByMachine,
	ROSTER_M,
	ROSTER_Q,
	resolveSwarmRoster,
	SWARM_ROSTERS,
} from "../../../src/core/swarm-roster";

describe("SWARM_ROSTERS", () => {
	it("exposes Roster Q and Roster M with unique ids", () => {
		expect(SWARM_ROSTERS.map((r) => r.id).sort()).toEqual(["minimum", "quality"]);
	});

	it("every assignment names a machine, role, model, quant, and size", () => {
		for (const roster of SWARM_ROSTERS) {
			for (const a of roster.assignments) {
				expect(a.machine).toBeTruthy();
				expect(a.model).toBeTruthy();
				expect(a.quant).toBeTruthy();
				expect(a.approxSizeGb).toBeGreaterThan(0);
				expect(["architect", "worker", "reviewer", "general"]).toContain(a.role);
			}
		}
	});

	it("covers all three machines in both rosters", () => {
		for (const roster of SWARM_ROSTERS) {
			const machines = new Set(roster.assignments.map((a) => a.machine));
			expect(machines).toEqual(new Set(["m5max", "m4mini", "legion"]));
		}
	});

	it("Roster M stays smaller than Roster Q on the strong machine (min-size intent)", () => {
		const qBig = ROSTER_Q.assignments.find((a) => a.machine === "m5max");
		const mBig = ROSTER_M.assignments.find((a) => a.machine === "m5max");
		expect(mBig?.approxSizeGb ?? 0).toBeLessThan(qBig?.approxSizeGb ?? 0);
	});
});

describe("resolveSwarmRoster", () => {
	it("resolves by id case-insensitively, null for unknown", () => {
		expect(resolveSwarmRoster("Quality")?.id).toBe("quality");
		expect(resolveSwarmRoster(" minimum ")?.id).toBe("minimum");
		expect(resolveSwarmRoster("nope")).toBeNull();
	});
});

describe("primaryAssignmentsByMachine", () => {
	it("returns one PRIMARY (non-alternate) assignment per machine", () => {
		const primaries = primaryAssignmentsByMachine(ROSTER_Q);
		expect([...primaries.keys()].sort()).toEqual(["legion", "m4mini", "m5max"]);
		// legion's primary is the 7B coder, not the alternate Qwen3-8B general profile.
		expect(primaries.get("legion")?.model).toBe("Qwen/Qwen2.5-Coder-7B-Instruct-GGUF");
		expect(primaries.get("legion")?.alternate).toBeUndefined();
	});
});
