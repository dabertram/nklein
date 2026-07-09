import { describe, expect, it } from "vitest";
import type { LmsPsModel } from "../../../src/core/lms-ps-json";
import { LOCAL_MACHINE_ID } from "../../../src/core/lms-ps-json";
import { buildSwarmMachineView, formatSwarmMachineView } from "../../../src/nklein-agent/nklein-swarm-view";

function psModel(input: Partial<LmsPsModel> & { identifier: string; machineId: string }): LmsPsModel {
	return {
		modelKey: input.identifier,
		isEmbedding: false,
		status: "idle",
		queued: 0,
		parallel: null,
		trainedForToolUse: true,
		contextLength: 40000,
		...input,
	};
}

// Fabricated, uncatalogued names ⇒ affinity comes purely from card facts + name heuristics (catalog-independent).
const MODELS: LmsPsModel[] = [
	psModel({ identifier: "zzz-qwopus-27b", machineId: LOCAL_MACHINE_ID }), // opus ⇒ reasoning
	psModel({ identifier: "zzz-coder-9b", machineId: LOCAL_MACHINE_ID }), // coder ⇒ code
	psModel({ identifier: "zzz-general-8b", machineId: "dev-legion", queued: 3 }), // tool-trained general
	psModel({ identifier: "embed-1", machineId: "dev-legion", isEmbedding: true, trainedForToolUse: false }),
];

describe("buildSwarmMachineView", () => {
	it("groups loaded models by machine and annotates each with the auto-selector's affinity", () => {
		const view = buildSwarmMachineView(MODELS);
		expect(view.map((m) => m.machineId)).toEqual([LOCAL_MACHINE_ID, "dev-legion"]); // first-seen order

		const local = view.find((m) => m.machineId === LOCAL_MACHINE_ID);
		expect(local?.models.map((x) => x.identifier)).toEqual(["zzz-qwopus-27b", "zzz-coder-9b"]);
		expect(local?.models[0]?.affinityTags).toContain("reasoning"); // opus heuristic
		expect(local?.models[1]?.affinityTags).toContain("code"); // coder name

		const legion = view.find((m) => m.machineId === "dev-legion");
		expect(legion?.models[0]?.queued).toBe(3);
		const embed = legion?.models.find((x) => x.isEmbedding);
		expect(embed?.affinityTags).toEqual([]); // an embedding carries no work affinity
	});
});

describe("formatSwarmMachineView", () => {
	it("renders a per-machine operator block naming the local host + affinity", () => {
		const text = formatSwarmMachineView(buildSwarmMachineView(MODELS));
		expect(text).toContain("Machine local (this host) — 2 model(s):");
		expect(text).toContain("Machine dev-legion — 2 model(s):");
		expect(text).toContain("zzz-coder-9b");
		expect(text).toMatch(/zzz-general-8b.*q3/); // queue depth surfaced
	});

	it("handles an empty swarm", () => {
		expect(formatSwarmMachineView([])).toContain("no models loaded");
	});
});
