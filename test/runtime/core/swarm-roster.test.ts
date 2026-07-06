import { describe, expect, it } from "vitest";
import {
	assessRosterFit,
	EXAMPLE_MACHINE_BUDGETS_GB,
	formatSwarmRosterReport,
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

	it("covers all three example machine classes in both rosters", () => {
		for (const roster of SWARM_ROSTERS) {
			const machines = new Set(roster.assignments.map((a) => a.machine));
			expect(machines).toEqual(new Set(["workstation", "desktop", "laptop"]));
		}
	});

	it("ships no personal host names — only illustrative hardware-class ids", () => {
		// §5.U/release: real machine/host names live in the user's config, never in the shipped example presets.
		const allMachines = SWARM_ROSTERS.flatMap((r) => r.assignments.map((a) => a.machine));
		expect(new Set(allMachines)).toEqual(new Set(["workstation", "desktop", "laptop"]));
	});

	it("Roster M stays smaller than Roster Q on the strongest class (min-size intent)", () => {
		const qBig = ROSTER_Q.assignments.find((a) => a.machine === "workstation");
		const mBig = ROSTER_M.assignments.find((a) => a.machine === "workstation");
		expect(mBig?.approxSizeGb ?? 0).toBeLessThan(qBig?.approxSizeGb ?? 0);
	});
});

describe("resolveSwarmRoster", () => {
	it("resolves by id case-insensitively, null for unknown", () => {
		expect(resolveSwarmRoster("Quality")?.id).toBe("quality");
		expect(resolveSwarmRoster(" minimum ")?.id).toBe("minimum");
		expect(resolveSwarmRoster("nope")).toBeNull();
	});

	it("resolves against a supplied (user-config) roster list", () => {
		const custom = [{ id: "mine", label: "Mine", assignments: ROSTER_Q.assignments }];
		expect(resolveSwarmRoster("mine", custom)?.label).toBe("Mine");
		expect(resolveSwarmRoster("quality", custom)).toBeNull(); // the shipped default is not in the custom list
	});
});

describe("primaryAssignmentsByMachine", () => {
	it("returns one PRIMARY (non-alternate) assignment per machine", () => {
		const primaries = primaryAssignmentsByMachine(ROSTER_Q);
		expect([...primaries.keys()].sort()).toEqual(["desktop", "laptop", "workstation"]);
		// the laptop's primary is the 7B coder, not the alternate Qwen3-8B general profile.
		expect(primaries.get("laptop")?.model).toBe("Qwen/Qwen2.5-Coder-7B-Instruct-GGUF");
		expect(primaries.get("laptop")?.alternate).toBeUndefined();
	});
});

describe("formatSwarmRosterReport", () => {
	it("renders a FITS report with each machine + assignment for a fitting roster", () => {
		const report = formatSwarmRosterReport(ROSTER_Q);
		expect(report).toContain("FITS ✓");
		expect(report).toContain("workstation:");
		expect(report).toContain("laptop:");
		expect(report).toContain("Qwen3-Coder-Next");
		expect(report).toContain("[alt]"); // the laptop's alternate profile is shown
	});

	it("renders OVERCOMMITS for a roster that exceeds a budget", () => {
		const tooBig = {
			id: "x",
			label: "Overcommit roster",
			assignments: [
				{
					machine: "laptop",
					role: "worker" as const,
					model: "big",
					quant: "Q4_K_M",
					approxSizeGb: 99,
					note: "too big",
				},
			],
		};
		expect(formatSwarmRosterReport(tooBig)).toContain("OVERCOMMITS ✗");
	});
});

describe("assessRosterFit", () => {
	it("both example rosters FIT the example hardware budgets", () => {
		expect(assessRosterFit(ROSTER_Q).fits).toBe(true);
		expect(assessRosterFit(ROSTER_M).fits).toBe(true);
		// the laptop's binding 8 GB VRAM: Roster Q's 7B (4.7) clears 8×0.9=7.2; Roster M's 3B (2) clears easily.
		const qLaptop = assessRosterFit(ROSTER_Q).machines.find((m) => m.machine === "laptop");
		expect(qLaptop?.fits).toBe(true);
		expect(qLaptop?.budgetGb).toBe(EXAMPLE_MACHINE_BUDGETS_GB.laptop);
	});

	it("flags a machine that overcommits its budget", () => {
		// A 14B (~9 GB) does NOT fit the laptop's 8 GB VRAM — the classic over-commit.
		const tooBig = {
			id: "x",
			label: "x",
			assignments: [
				{
					machine: "laptop",
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

	it("honors a supplied (user-config) budget map over the example default", () => {
		// A user whose laptop has only 4 GB VRAM: Roster Q's 7B (4.7) no longer fits.
		const tightBudgets = { workstation: 128, desktop: 24, laptop: 4 };
		const fit = assessRosterFit(ROSTER_Q, tightBudgets);
		expect(fit.machines.find((m) => m.machine === "laptop")?.fits).toBe(false);
	});
});
