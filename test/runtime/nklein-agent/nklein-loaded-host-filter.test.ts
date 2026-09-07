import { afterEach, describe, expect, it, vi } from "vitest";
import type { LmsPsModel } from "../../../src/core/lms-ps-json";
import { resetLoadedHostAllowlistForTests, setLoadedHostAllowlist } from "../../../src/core/loaded-host-allowlist";
import {
	excludeDisallowedHostDescriptors,
	isModelIdOnAllowedHost,
} from "../../../src/nklein-agent/nklein-loaded-host-filter";

vi.mock("../../../src/telemetry/self-observation-sink", () => ({
	recordSelfObservation: vi.fn(),
}));

const LEGION = "040891f3ad9352c2ec9389aba79cd022";
const M4MINI = "2d30f46d0371d004b1758e6df7790a03";

function psModel(identifier: string, modelKey: string, machineId: string): LmsPsModel {
	return {
		identifier,
		modelKey,
		indexedModelIdentifier: null,
		path: null,
		machineId,
		isEmbedding: false,
		status: "idle",
		queued: 0,
		parallel: 1,
	} as LmsPsModel;
}

// What `lms ps --json` reports on the rig: flash-next is local (m5max), the two dirk instances are LM-Link remotes.
const fleet: LmsPsModel[] = [
	psModel("qwen3.8-flash-next", "qwen3.8-flash-next", "local"),
	psModel("dirk-qwen3.8-27b", "dirk-qwen3.8-27b@q6_k", LEGION),
	psModel("dirk-qwen3.8-27b@m4mini", "dirk-qwen3.8-27b@q2_k_xl", M4MINI),
];

const loaded = [
	{ runtimeId: "qwen3.8-flash-next", modelKey: "qwen3.8-flash-next" },
	{ runtimeId: "dirk-qwen3.8-27b", modelKey: "dirk-qwen3.8-27b@q6_k" },
	{ runtimeId: "dirk-qwen3.8-27b@m4mini", modelKey: "dirk-qwen3.8-27b@q2_k_xl" },
];

describe("excludeDisallowedHostDescriptors", () => {
	afterEach(() => resetLoadedHostAllowlistForTests());

	it("is a no-op without an allowlist (and never consults lms ps)", async () => {
		expect(await excludeDisallowedHostDescriptors(loaded, { purpose: "test" })).toEqual(loaded);
	});

	it("drops the idled local host's model for every auto chooser once the allowlist names the remote hosts", async () => {
		setLoadedHostAllowlist([LEGION, M4MINI]);
		const kept = await excludeDisallowedHostDescriptors(
			loaded,
			{ purpose: "reviewer fallback", taskId: "t1" },
			fleet,
		);
		expect(kept.map((d) => d.runtimeId)).toEqual(["dirk-qwen3.8-27b", "dirk-qwen3.8-27b@m4mini"]);
		expect(await isModelIdOnAllowedHost("qwen3.8-flash-next", fleet)).toBe(false);
		expect(await isModelIdOnAllowedHost("dirk-qwen3.8-27b", fleet)).toBe(true);
		// The hard-coded merge/custodian default names flash-next; unmapped ⇒ local ⇒ not allowed either.
		expect(await isModelIdOnAllowedHost("some-unloaded-model", fleet)).toBe(false);
	});

	it("fails closed when the fleet listing is empty (an idled host stays idle even if lms ps is unavailable)", async () => {
		setLoadedHostAllowlist([LEGION]);
		expect(await excludeDisallowedHostDescriptors(loaded, { purpose: "test" }, [])).toEqual([]);
	});
});
