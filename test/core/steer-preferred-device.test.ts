import { describe, expect, it } from "vitest";
import type { LmsLinkDevices } from "../../src/core/lms-link-status";
import {
	buildLinkedDeviceList,
	type SteerPreferredDeviceDeps,
	steerPreferredDeviceForModel,
} from "../../src/core/steer-preferred-device";

const GiB = 1024 ** 3;
const gb = (n: number): number => n * GiB;

// A three-host fleet: Local (m5max, the local host) + two linked peers.
const linkRoster = (preferredDeviceIdentifier: string | null): LmsLinkDevices => ({
	localMachineName: "Local",
	localDeviceIdentifier: "id-local",
	preferredDeviceIdentifier,
	namesByDeviceId: new Map([
		["id-mini", "m4mini"],
		["id-legion", "legion5pro"],
	]),
});

const sizes = new Map<string, number>([["qwen/qwen2.5-coder-14b", gb(8.33)]]);

interface Recording {
	deps: SteerPreferredDeviceDeps;
	linkFetches: () => number;
	setCalls: () => string[];
}

function recordingDeps(overrides: Partial<SteerPreferredDeviceDeps> & { preferred?: string | null } = {}): Recording {
	let linkFetches = 0;
	const setCalls: string[] = [];
	const deps: SteerPreferredDeviceDeps = {
		env: { NKLEIN_DEVICE_RAM_GB: "Local:128,m4mini:16,legion5pro:24" },
		fetchLinkDevices: async () => {
			linkFetches += 1;
			return linkRoster(overrides.preferred ?? "id-mini");
		},
		listModelSizes: async () => sizes,
		setPreferredDevice: async (id) => {
			setCalls.push(id);
		},
		...overrides,
	};
	return { deps, linkFetches: () => linkFetches, setCalls: () => setCalls };
}

describe("buildLinkedDeviceList", () => {
	it("flattens the local host + peers into name/id pairs, deduped", () => {
		const list = buildLinkedDeviceList(linkRoster("id-local"));
		expect(list).toEqual([
			{ deviceName: "Local", deviceIdentifier: "id-local" },
			{ deviceName: "m4mini", deviceIdentifier: "id-mini" },
			{ deviceName: "legion5pro", deviceIdentifier: "id-legion" },
		]);
	});

	it("omits the local host when its name/id are unavailable", () => {
		const list = buildLinkedDeviceList({
			localMachineName: null,
			localDeviceIdentifier: null,
			preferredDeviceIdentifier: null,
			namesByDeviceId: new Map([["id-mini", "m4mini"]]),
		});
		expect(list).toEqual([{ deviceName: "m4mini", deviceIdentifier: "id-mini" }]);
	});
});

describe("steerPreferredDeviceForModel", () => {
	it("steers a 14B off a preferred m4mini onto Local and issues set-preferred-device (the fix)", async () => {
		const rec = recordingDeps({ preferred: "id-mini" });
		const steering = await steerPreferredDeviceForModel(
			{ modelId: "qwen/qwen2.5-coder-14b", contextLength: 40_000 },
			rec.deps,
		);
		expect(steering.action).toBe("set_preferred");
		if (steering.action === "set_preferred") {
			expect(steering.deviceName).toBe("Local");
		}
		expect(rec.setCalls()).toEqual(["id-local"]);
	});

	it("is a no-op (no set call) when Local is already the preferred device", async () => {
		const rec = recordingDeps({ preferred: "id-local" });
		const steering = await steerPreferredDeviceForModel(
			{ modelId: "qwen/qwen2.5-coder-14b", contextLength: 40_000 },
			rec.deps,
		);
		expect(steering.action).toBe("already_preferred");
		expect(rec.setCalls()).toEqual([]);
	});

	it("skips WITHOUT any fleet I/O when NKLEIN_DEVICE_RAM_GB is unset (byte-identical, zero cost)", async () => {
		const rec = recordingDeps({ env: {} });
		const steering = await steerPreferredDeviceForModel(
			{ modelId: "qwen/qwen2.5-coder-14b", contextLength: 40_000 },
			rec.deps,
		);
		expect(steering.action).toBe("skip");
		expect(rec.linkFetches()).toBe(0); // gate short-circuits before touching the fleet
		expect(rec.setCalls()).toEqual([]);
	});

	it("skips when the model's weights size is unknown (cannot prove headroom)", async () => {
		const rec = recordingDeps({ listModelSizes: async () => new Map() });
		const steering = await steerPreferredDeviceForModel(
			{ modelId: "qwen/qwen2.5-coder-14b", contextLength: 40_000 },
			rec.deps,
		);
		expect(steering.action).toBe("skip");
		expect(rec.setCalls()).toEqual([]);
	});

	it("skips on an empty model id", async () => {
		const rec = recordingDeps();
		const steering = await steerPreferredDeviceForModel({ modelId: "  ", contextLength: 40_000 }, rec.deps);
		expect(steering.action).toBe("skip");
		expect(rec.linkFetches()).toBe(0);
	});

	it("fails open (skip, never throws) when a fleet read throws", async () => {
		const rec = recordingDeps({
			fetchLinkDevices: async () => {
				throw new Error("lms link status failed");
			},
		});
		const steering = await steerPreferredDeviceForModel(
			{ modelId: "qwen/qwen2.5-coder-14b", contextLength: 40_000 },
			rec.deps,
		);
		expect(steering.action).toBe("skip");
		expect(steering.reason).toMatch(/failed/i);
	});

	it("fails open when the set-preferred-device write itself throws", async () => {
		const rec = recordingDeps({
			preferred: "id-mini",
			setPreferredDevice: async () => {
				throw new Error("set-preferred-device failed");
			},
		});
		const steering = await steerPreferredDeviceForModel(
			{ modelId: "qwen/qwen2.5-coder-14b", contextLength: 40_000 },
			rec.deps,
		);
		expect(steering.action).toBe("skip"); // the write error degrades to skip, dispatch continues
	});

	it("prefers the llmfit KV-aware footprint when supplied", async () => {
		// A small-weights model whose llmfit footprint (with KV) is large enough to be pushed off m4mini onto Local.
		const rec = recordingDeps({
			preferred: "id-mini",
			listModelSizes: async () => new Map([["tiny", gb(3)]]),
			llmfitMemoryBytes: (id) => (id === "tiny" ? gb(15) : null),
		});
		const steering = await steerPreferredDeviceForModel({ modelId: "tiny", contextLength: 40_000 }, rec.deps);
		expect(steering.action).toBe("set_preferred");
		if (steering.action === "set_preferred") {
			expect(steering.deviceName).toBe("Local");
		}
	});
});
