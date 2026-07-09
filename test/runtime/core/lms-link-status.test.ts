import { describe, expect, it } from "vitest";
import { fetchLmsLinkDevices, parseLmsLinkDevices } from "../../../src/core/lms-link-status";

// Shaped after real `lms link status --json`.
const STDOUT = JSON.stringify({
	status: "online",
	issues: [],
	peers: [
		{ deviceIdentifier: "040891f3ad9352c2ec9389aba79cd022", deviceName: "davidlegion5pro", status: "connected" },
		{ deviceIdentifier: "2d30f46d0371d004b1758e6df7790a03", deviceName: "m4mini", status: "connected" },
	],
	deviceIdentifier: "579028ee71c8d9e9c7cfe92572e6a445",
	deviceName: "m5max",
	preferredDeviceIdentifier: "2d30f46d0371d004b1758e6df7790a03",
});

describe("parseLmsLinkDevices", () => {
	it("maps the local host name + each peer device id → name", () => {
		const devices = parseLmsLinkDevices(STDOUT);
		expect(devices.localMachineName).toBe("m5max");
		expect(devices.preferredDeviceIdentifier).toBe("2d30f46d0371d004b1758e6df7790a03");
		expect(devices.namesByDeviceId.get("040891f3ad9352c2ec9389aba79cd022")).toBe("davidlegion5pro");
		expect(devices.namesByDeviceId.get("2d30f46d0371d004b1758e6df7790a03")).toBe("m4mini");
		expect(devices.namesByDeviceId.size).toBe(2);
	});

	it("returns an empty roster on malformed / non-object payloads", () => {
		expect(parseLmsLinkDevices("not json").localMachineName).toBeNull();
		expect(parseLmsLinkDevices(JSON.stringify([])).namesByDeviceId.size).toBe(0);
		// peers with missing id/name are skipped
		expect(
			parseLmsLinkDevices(JSON.stringify({ peers: [{ deviceName: "x" }, { deviceIdentifier: "y" }] }))
				.namesByDeviceId.size,
		).toBe(0);
	});
});

describe("fetchLmsLinkDevices", () => {
	it("parses the runner stdout and yields an empty roster on failure", async () => {
		const devices = await fetchLmsLinkDevices(async () => ({ stdout: STDOUT, exitCode: 0 }));
		expect(devices.localMachineName).toBe("m5max");
		const failed = await fetchLmsLinkDevices(async () => {
			throw new Error("no lms");
		});
		expect(failed.localMachineName).toBeNull();
	});
});
