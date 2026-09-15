import { type LmsPsModel, LOCAL_MACHINE_ID } from "../core/lms-ps-json";
import { normalizeEndpoint, normalizeProviderId } from "../core/model-identity";
import { buildNKleinModelRegistryKey } from "./nklein-model-registry-key";

export interface BuildLmStudioMachineMapOptions {
	providerIds?: readonly (string | null | undefined)[];
	endpoints?: readonly (string | null | undefined)[];
}

function addAlias(map: Map<string, string>, alias: string | null | undefined, machineId: string): void {
	const key = alias?.trim();
	if (key) {
		map.set(key, machineId);
	}
}

/**
 * Build the runtime model id -> LM Studio host map used by per-host caps.
 *
 * `lms ps` reports the invokable alias (`identifier`) and often a more stable publisher key/path. !Klein surfaces may
 * hold any of those, or the canonical `provider:model:endpoint` registry key after stable-routing rewrites. A host-cap
 * lookup must understand all of them; otherwise a linked-machine model misses the map and falls back to `local`, which
 * falsely serializes unrelated hosts.
 */
export function buildLmStudioMachineByModelId(
	models: readonly LmsPsModel[],
	options: BuildLmStudioMachineMapOptions = {},
): Map<string, string> {
	const inputProviderIds = options.providerIds ?? [];
	const inputEndpoints = options.endpoints ?? [];
	const providerIds = [
		...new Set(
			[
				"lmstudio",
				...inputProviderIds
					.map((providerId) => providerId?.trim())
					.filter((providerId): providerId is string => !!providerId)
					.map((providerId) => normalizeProviderId(providerId)),
			].filter((providerId) => providerId !== "unknown"),
		),
	];
	const endpoints = [
		...new Set(
			[null, ...inputEndpoints, ...inputEndpoints.map((endpoint) => normalizeEndpoint(endpoint ?? null))]
				.map((endpoint) => endpoint?.trim() || null)
				.map((endpoint) => endpoint ?? "default"),
		),
	].map((endpoint) => (endpoint === "default" ? null : endpoint));

	// Alias precedence (2026-09-15, finding 9 of the SWE-bench campaign): the SAME model loaded locally AND over LM
	// Link shares its model key/path, and `lms ps` lists the linked copy after the local one — a last-writer map sent
	// the bare key to the LINKED machine, so a local arm's pinned worker ran on the Legion and the `local` allowlist
	// excluded the local instance as "legion". Rule: an instance's own `identifier` (unique per instance) claims its
	// alias exclusively; secondary aliases (model key, indexed id, path) only fill unclaimed keys, and when two
	// machines contend for one the LOCAL instance wins — a bare key names what `lms` serves locally.
	const claimedByIdentifier = new Map<string, string>();
	for (const model of models) {
		const identifier = model.identifier?.trim();
		if (identifier) {
			claimedByIdentifier.set(identifier, model.machineId);
		}
	}
	const secondary = new Map<string, string>();
	for (const model of models) {
		for (const alias of [model.modelKey, model.indexedModelIdentifier ?? undefined, model.path ?? undefined]) {
			const key = alias?.trim();
			if (!key || claimedByIdentifier.has(key)) {
				continue;
			}
			const existing = secondary.get(key);
			if (existing === undefined || (existing !== LOCAL_MACHINE_ID && model.machineId === LOCAL_MACHINE_ID)) {
				secondary.set(key, model.machineId);
			}
		}
	}
	const machineByModelId = new Map<string, string>();
	for (const [modelId, machineId] of [...secondary, ...claimedByIdentifier]) {
		addAlias(machineByModelId, modelId, machineId);
		for (const providerId of providerIds) {
			for (const endpoint of endpoints) {
				addAlias(machineByModelId, buildNKleinModelRegistryKey({ providerId, modelId, endpoint }), machineId);
			}
		}
	}
	return machineByModelId;
}
