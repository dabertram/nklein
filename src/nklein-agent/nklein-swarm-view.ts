/**
 * The operator's-eye view of the local model swarm (§5.AB): the currently-loaded models grouped by the MACHINE that
 * serves them (LM Link shares several machines behind one endpoint), each annotated with how the AUTO-SELECTOR sees it —
 * its best-fit affinity tags + cold-start capability prior (the same {@link resolveLoadedModelProfile} the router uses) —
 * plus the live `queued`/`status` from `lms ps`. Lets a user run one command and see exactly which machine holds which
 * model and what role it will gravitate to (a coder machine, a reasoner machine, …). Pure given the `lms ps` rows, so it
 * is unit-testable; the `dev swarm` command supplies the effectful fetch.
 */

import type { LmsPsModel } from "../core/lms-ps-json";
import { LOCAL_MACHINE_ID } from "../core/lms-ps-json";
import type { LoadedModelDescriptor } from "../core/lmstudio-loaded-model-descriptors";
import { resolveLoadedModelProfile } from "./nklein-loaded-model-profile";

export interface SwarmModelView {
	/** The runtime alias you invoke. */
	identifier: string;
	/** The real publisher model key (what the affinity/prior keyed on). */
	modelKey: string;
	isEmbedding: boolean;
	/** The auto-selector's best-fit tags for this model (empty for an embedding / unknown). */
	affinityTags: readonly string[];
	/** The §5.AL cold-start capability prior (null when uncatalogued). */
	capabilityPrior: number | null;
	/** Live server status (`idle` | `loading` | …). */
	status: string | null;
	/** Requests currently queued on this instance. */
	queued: number;
}

export interface SwarmMachineView {
	/** The owning machine — {@link LOCAL_MACHINE_ID} for the local host, else the linked device id. */
	machineId: string;
	models: SwarmModelView[];
}

/** Adapt an `lms ps` row to the descriptor the shared affinity resolver consumes (it fills reasoning via its heuristics). */
function toDescriptor(model: LmsPsModel): LoadedModelDescriptor {
	return {
		runtimeId: model.identifier,
		modelKey: model.modelKey,
		isEmbedding: model.isEmbedding,
		...(model.trainedForToolUse !== null ? { toolUse: model.trainedForToolUse } : {}),
		...(model.contextLength !== null ? { maxContextLength: model.contextLength } : {}),
	};
}

/** Group the loaded models by machine and annotate each with the auto-selector's affinity view. Machine order = first-seen. */
export function buildSwarmMachineView(psModels: readonly LmsPsModel[]): SwarmMachineView[] {
	const byMachine = new Map<string, SwarmModelView[]>();
	for (const model of psModels) {
		const profile = resolveLoadedModelProfile(toDescriptor(model));
		const view: SwarmModelView = {
			identifier: model.identifier,
			modelKey: model.modelKey,
			isEmbedding: model.isEmbedding,
			affinityTags: profile.affinityTags ?? [],
			capabilityPrior: profile.capabilityPrior ?? null,
			status: model.status,
			queued: model.queued,
		};
		const list = byMachine.get(model.machineId);
		if (list) {
			list.push(view);
		} else {
			byMachine.set(model.machineId, [view]);
		}
	}
	return [...byMachine.entries()].map(([machineId, models]) => ({ machineId, models }));
}

/** Render the swarm view as an operator-readable text block. */
export function formatSwarmMachineView(machines: readonly SwarmMachineView[]): string {
	if (machines.length === 0) {
		return "(no models loaded — nothing in the swarm)\n";
	}
	const lines: string[] = [];
	for (const machine of machines) {
		const label = machine.machineId === LOCAL_MACHINE_ID ? "local (this host)" : machine.machineId;
		lines.push(`Machine ${label} — ${machine.models.length} model(s):`);
		for (const model of machine.models) {
			const kind = model.isEmbedding ? "embedding" : model.affinityTags.join(",") || "—";
			const prior = model.capabilityPrior === null ? "  —" : String(model.capabilityPrior).padStart(3);
			lines.push(
				`  ${model.identifier.padEnd(44)} [${kind}]  prior ${prior}  q${model.queued}  ${model.status ?? "?"}`,
			);
		}
	}
	return `${lines.join("\n")}\n`;
}
