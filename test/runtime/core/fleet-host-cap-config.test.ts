import { describe, expect, it } from "vitest";
import { formatFleetHostCapConfig, resolveFleetHostCapConfig } from "../../../src/core/fleet-host-cap-config";
import type { LmsLinkDevices } from "../../../src/core/lms-link-status";

function devices(): LmsLinkDevices {
	return {
		localMachineName: "m5max",
		localDeviceIdentifier: "579028ee71c8d9e9c7cfe92572e6a445",
		preferredDeviceIdentifier: "2d30f46d0371d004b1758e6df7790a03",
		namesByDeviceId: new Map([
			["2d30f46d0371d004b1758e6df7790a03", "m4mini"],
			["040891f3ad9352c2ec9389aba79cd022", "legion5pro"],
		]),
	};
}

describe("resolveFleetHostCapConfig", () => {
	it("maps friendly LM-Link host names onto runtime host ids", () => {
		const result = resolveFleetHostCapConfig("m5max=2,m4mini=1;legion5pro:1", devices());

		expect(result.issues).toEqual([]);
		expect(result.perHost).toEqual({
			local: 2,
			"2d30f46d0371d004b1758e6df7790a03": 1,
			"040891f3ad9352c2ec9389aba79cd022": 1,
		});
	});

	it("accepts device ids and unambiguous prefixes", () => {
		const result = resolveFleetHostCapConfig("579028ee71c8=2,040891f3=1", devices());

		expect(result.issues).toEqual([]);
		expect(result.perHost).toEqual({
			local: 2,
			"040891f3ad9352c2ec9389aba79cd022": 1,
		});
	});

	it("reports malformed entries instead of guessing", () => {
		const result = resolveFleetHostCapConfig("m5max,unknown=2,m4mini=0,legion5pro=1", devices());

		expect(result.perHost).toEqual({
			"040891f3ad9352c2ec9389aba79cd022": 1,
		});
		expect(result.issues).toEqual([
			{ entry: "m5max", reason: "expected host=cap or host:cap" },
			{ entry: "unknown=2", reason: 'unknown host "unknown"' },
			{ entry: "m4mini=0", reason: "cap must be an integer from 1 to 256" },
		]);
	});

	it("reports duplicate host caps after alias resolution", () => {
		const result = resolveFleetHostCapConfig("m5max=2,local=1", devices());

		expect(result.perHost).toEqual({ local: 2 });
		expect(result.issues).toEqual([{ entry: "local=1", reason: 'duplicate cap for host "local"' }]);
	});
});

describe("formatFleetHostCapConfig", () => {
	it("prints user-facing host names when available", () => {
		const text = formatFleetHostCapConfig(
			{
				local: 2,
				"2d30f46d0371d004b1758e6df7790a03": 1,
			},
			devices(),
		);

		expect(text).toBe("m5max (local)=2, m4mini (2d30f46d)=1");
	});
});
