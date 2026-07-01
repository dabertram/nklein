import { describe, expect, it } from "vitest";
import { LOCAL_MACHINE_ID } from "../../../src/core/lms-ps-json";
import { evaluateMachineConcurrencyGate } from "../../../src/core/machine-concurrency-gate";

// 3-machine map (like the user's LM-Link setup): coder+reasoner local, generals on two remotes.
const MAP = new Map<string, string>([
	["qwopus-27b", LOCAL_MACHINE_ID],
	["coder-14b", LOCAL_MACHINE_ID],
	["gen-9b-m4", "m4mini-hex"],
	["gen-9b-legion", "legion-hex"],
]);

describe("evaluateMachineConcurrencyGate", () => {
	it("counts only the sessions on the TASK's machine (LM-Link machines don't share a pool)", () => {
		const result = evaluateMachineConcurrencyGate({
			taskModelId: "gen-9b-legion",
			runningModelIds: ["qwopus-27b", "coder-14b", "gen-9b-m4"], // all on OTHER machines
			machineByModelId: MAP,
			perMachineCap: 1,
		});
		expect(result).toMatchObject({ allowed: true, machineId: "legion-hex", running: 0, cap: 1 });
	});

	it("holds when the task's machine is at its cap", () => {
		const result = evaluateMachineConcurrencyGate({
			taskModelId: "coder-14b", // local
			runningModelIds: ["qwopus-27b"], // also local ⇒ 1 running on local
			machineByModelId: MAP,
			perMachineCap: 1,
		});
		expect(result).toMatchObject({ allowed: false, machineId: LOCAL_MACHINE_ID, running: 1 });
	});

	it("allows when below the cap; multiple machines are accounted independently", () => {
		const running = ["qwopus-27b", "gen-9b-m4", "gen-9b-legion"]; // 1 local, 1 m4, 1 legion
		expect(
			evaluateMachineConcurrencyGate({
				taskModelId: "coder-14b",
				runningModelIds: running,
				machineByModelId: MAP,
				perMachineCap: 2,
			}).allowed,
		).toBe(true); // local has 1 < 2
		expect(
			evaluateMachineConcurrencyGate({
				taskModelId: "gen-9b-m4",
				runningModelIds: running,
				machineByModelId: MAP,
				perMachineCap: 1,
			}).allowed,
		).toBe(false); // m4 has 1 == 1
	});

	it("treats an unmapped model as the LOCAL host", () => {
		const result = evaluateMachineConcurrencyGate({
			taskModelId: "some-unlisted-model",
			runningModelIds: ["qwopus-27b"], // local
			machineByModelId: MAP,
			perMachineCap: 1,
		});
		expect(result.machineId).toBe(LOCAL_MACHINE_ID);
		expect(result.allowed).toBe(false); // shares the local pool with qwopus
	});

	it("is inert (always allowed) when the cap is <= 0", () => {
		expect(
			evaluateMachineConcurrencyGate({
				taskModelId: "coder-14b",
				runningModelIds: ["qwopus-27b", "coder-14b", "gen-9b-m4"],
				machineByModelId: MAP,
				perMachineCap: 0,
			}).allowed,
		).toBe(true);
	});
});
