import { describe, expect, it } from "vitest";
import {
	assessRosterFit,
	primaryAssignmentsByMachine,
	ROSTER_M,
	ROSTER_Q,
	resolveSwarmRoster,
	SWARM_ROSTERS,
	USER_MACHINE_BUDGETS_GB,
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

describe("assessRosterFit", () => {
	it("both rosters FIT the user's hardware budgets (validates the GPT fit analysis programmatically)", () => {
		expect(assessRosterFit(ROSTER_Q).fits).toBe(true);
		expect(assessRosterFit(ROSTER_M).fits).toBe(true);
		// legion's binding 8 GB VRAM: Roster Q's 7B (4.7) clears 8×0.9=7.2; Roster M's 3B (2) clears easily.
		const qLegion = assessRosterFit(ROSTER_Q).machines.find((m) => m.machine === "legion");
		expect(qLegion?.fits).toBe(true);
		expect(qLegion?.budgetGb).toBe(USER_MACHINE_BUDGETS_GB.legion);
	});

	it("flags a machine that overcommits its budget", () => {
		// A 14B (~9 GB) does NOT fit the legion's 8 GB VRAM — the classic over-commit GPT warned about.
		const tooBig = {
			id: "x",
			label: "x",
			assignments: [
				{
					machine: "legion",
					role: "worker" as const,
					model: "Qwen/Qwen2.5-Coder-14B-Instruct-GGUF",
					quant: "Q4_K_M",
					approxSizeGb: 9,
					note: "14B on 8 GB VRAM = overcommit",
				},
			],
		};
		const fit = assessRosterFit(tooBig);
		expect(fit.fits).toBe(false);
		expect(fit.machines[0]?.fits).toBe(false);
	});

	it("treats an unknown machine as zero budget (surfaces typos rather than silently passing)", () => {
		const roster = {
			id: "y",
			label: "y",
			assignments: [
				{ machine: "mystery", role: "worker" as const, model: "m", quant: "Q4_K_M", approxSizeGb: 1, note: "" },
			],
		};
		expect(assessRosterFit(roster).fits).toBe(false);
	});
});
