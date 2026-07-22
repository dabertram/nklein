import { describe, expect, it } from "vitest";
import { handleGetFleetStatus, parseShellKind } from "../../../src/trpc/runtime-api/fleet-status";

describe("handleGetFleetStatus (§5.AX)", () => {
	it("assembles machine + warmth maps keyed by served model id", async () => {
		const status = await handleGetFleetStatus({
			getMachineMap: async () =>
				new Map([
					["qwop4b-a", "Local"],
					["coder-gpu", "davidlegion5pro"],
				]),
			getWarmthLedger: () => new Map([["qwop4b-a", { shellKey: `worker\u0000/proj\u0000qwop4b-a`, at: 1_000 }]]),
		});
		expect(status.machineByModelId).toEqual({ "qwop4b-a": "Local", "coder-gpu": "davidlegion5pro" });
		expect(status.warmthByModelId).toEqual({ "qwop4b-a": { kind: "worker", at: 1_000 } });
		expect(status.resources).toBeNull();
	});

	it("fails soft to empty maps (no lms feed / no loaded service)", async () => {
		const status = await handleGetFleetStatus({
			getMachineMap: async () => {
				throw new Error("lms unavailable");
			},
			getWarmthLedger: () => null,
		});
		expect(status).toEqual({ machineByModelId: {}, warmthByModelId: {}, resources: null });
	});

	it("fails only the resource branch when its best-effort sampler throws", async () => {
		const status = await handleGetFleetStatus({
			getMachineMap: async () => new Map([["model", "m5max"]]),
			getWarmthLedger: () => null,
			getResources: async () => {
				throw new Error("statfs unavailable");
			},
		});
		expect(status).toEqual({ machineByModelId: { model: "m5max" }, warmthByModelId: {}, resources: null });
	});

	it("parseShellKind splits on the NUL separator (and tolerates a bare kind)", () => {
		expect(parseShellKind(`review\u0000/w\u0000m`)).toBe("review");
		expect(parseShellKind("worker")).toBe("worker");
	});
});
