import { describe, expect, it } from "vitest";
import type { LmsLinkDevices } from "../../../src/core/lms-link-status";
import type { SwarmRoster } from "../../../src/core/swarm-roster";
import {
	parseRosterMachineMapEnv,
	type RosterLoadPlan,
	resolveRosterLoadPlan,
} from "../../../src/core/swarm-roster-load-plan";

const GiB = 1024 ** 3;

const linkDevices: LmsLinkDevices = {
	localMachineName: "m5max",
	localDeviceIdentifier: "m5-id",
	preferredDeviceIdentifier: "m4-id",
	namesByDeviceId: new Map([
		["m4-id", "m4mini"],
		["legion-id", "legion5pro"],
	]),
};

const roster: SwarmRoster = {
	id: "mine",
	label: "My roster",
	assignments: [
		{
			machine: "workstation",
			role: "architect",
			model: "architect-model",
			quant: "Q4_K_M",
			approxSizeGb: 10,
			note: "",
		},
		{
			machine: "desktop",
			role: "worker",
			model: "worker-model",
			quant: "Q4_K_M",
			approxSizeGb: 4,
			note: "",
		},
		{
			machine: "laptop",
			role: "worker",
			model: "laptop-model",
			quant: "Q4_K_M",
			approxSizeGb: 3,
			note: "",
		},
		{
			machine: "laptop",
			role: "general",
			model: "laptop-alt",
			quant: "Q4_K_M",
			approxSizeGb: 3,
			alternate: true,
			note: "",
		},
	],
};

function expectOk(plan: RosterLoadPlan): asserts plan is Extract<RosterLoadPlan, { ok: true }> {
	expect(plan.ok).toBe(true);
}

describe("parseRosterMachineMapEnv", () => {
	it("accepts a JSON object of machine aliases", () => {
		const parsed = parseRosterMachineMapEnv('{"workstation":"m5max","desktop":"m4mini"}');
		expect(parsed.issues).toEqual([]);
		expect(parsed.machineMap).toEqual({ workstation: "m5max", desktop: "m4mini" });
	});

	it("rejects malformed or non-string maps without throwing", () => {
		expect(parseRosterMachineMapEnv("{").issues[0]).toMatch(/JSON object/);
		expect(parseRosterMachineMapEnv("[]").issues[0]).toMatch(/JSON object/);
		expect(parseRosterMachineMapEnv('{"desktop":7}').issues[0]).toMatch(/desktop/);
	});
});

describe("resolveRosterLoadPlan", () => {
	it("fails closed when example machine classes are not mapped to real LM Link devices", () => {
		const plan = resolveRosterLoadPlan({
			roster,
			budgetsGb: { workstation: 128, desktop: 24, laptop: 8 },
			linkDevices,
		});
		expect(plan.ok).toBe(false);
		if (!plan.ok) {
			expect(plan.issues).toHaveLength(3);
			expect(plan.issues[0]).toContain("workstation");
		}
	});

	it("maps abstract roster machines to Local, linked device name, and linked device id", () => {
		const plan = resolveRosterLoadPlan({
			roster,
			budgetsGb: { workstation: 128, desktop: 24, laptop: 8 },
			linkDevices,
			machineMap: { workstation: "m5max", desktop: "m4mini", laptop: "legion-id" },
		});
		expectOk(plan);
		expect(plan.targets).toHaveLength(3);
		expect(plan.targets.map((target) => target.targetDevice)).toEqual(["Local", "m4mini", "legion5pro"]);
		expect(plan.targets.map((target) => target.targetDeviceIdentifier)).toEqual([undefined, "m4-id", "legion-id"]);
		expect(plan.targets.map((target) => target.totalRamBytes)).toEqual([128 * GiB, 24 * GiB, 8 * GiB]);
		expect(plan.targets.map((target) => target.candidateSizeBytes)).toEqual([10 * GiB, 4 * GiB, 3 * GiB]);
		expect(plan.targets.map((target) => target.assignment.model)).toEqual([
			"architect-model",
			"worker-model",
			"laptop-model",
		]);
	});

	it("accepts the local device id and resolved-machine budget keys", () => {
		const plan = resolveRosterLoadPlan({
			roster: {
				...roster,
				assignments: [
					{
						machine: "workstation",
						role: "architect",
						model: "architect-model",
						quant: "Q4_K_M",
						approxSizeGb: 10,
						note: "",
					},
				],
			},
			budgetsGb: { "m5-id": 128 },
			linkDevices,
			machineMap: { workstation: "m5-id" },
		});
		expectOk(plan);
		expect(plan.targets[0]?.targetDevice).toBe("Local");
		expect(plan.targets[0]?.totalRamBytes).toBe(128 * GiB);
	});

	it("requires a positive budget for each primary roster machine", () => {
		const plan = resolveRosterLoadPlan({
			roster,
			budgetsGb: { workstation: 128, desktop: 24 },
			linkDevices,
			machineMap: { workstation: "Local", desktop: "m4mini", laptop: "legion5pro" },
		});
		expect(plan.ok).toBe(false);
		if (!plan.ok) {
			expect(plan.issues).toEqual(['No positive machine budget configured for roster machine "laptop".']);
		}
	});
});
