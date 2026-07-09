import type { LmsPsModel } from "../core/lms-ps-json";
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

	const machineByModelId = new Map<string, string>();
	for (const model of models) {
		const aliases = new Set([
			model.identifier,
			model.modelKey,
			model.indexedModelIdentifier ?? undefined,
			model.path ?? undefined,
		]);
		for (const alias of aliases) {
			const modelId = alias?.trim();
			if (!modelId) {
				continue;
			}
			addAlias(machineByModelId, modelId, model.machineId);
			for (const providerId of providerIds) {
				for (const endpoint of endpoints) {
					addAlias(
						machineByModelId,
						buildNKleinModelRegistryKey({
							providerId,
							modelId,
							endpoint,
						}),
						model.machineId,
					);
				}
			}
		}
	}
	return machineByModelId;
}
