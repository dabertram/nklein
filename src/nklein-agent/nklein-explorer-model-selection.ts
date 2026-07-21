/** F11.2j: choose a cheaper resident explorer without loading, unloading, or weakening the 32k floor. */

import { fetchLoadedModelDescriptors, type LoadedModelDescriptor } from "../core/lmstudio-loaded-model-descriptors";
import { lookupModelCapability } from "../core/model-capability-catalog";
import { NKLEIN_MIN_CONTEXT_WINDOW_TOKENS } from "./nklein-context-window-policy";
import type { NKleinTaskRestartLaunchConfig } from "./nklein-launch-config";

const BYTES_PER_GIB = 1024 ** 3;
/** FastContext's useful explorer tier is around 4B; sub-~2 GiB residents are not trusted with a multi-tool search chain. */
const MIN_EXPLORER_FOOTPRINT_GIB = 1.5;
/**
 * Exact identities that passed the production-shaped explorer contract (bounded multi-tool search followed by
 * `submit_citations`). Generic tool-use metadata is necessary but not sufficient: Phi advertised/catalogued tool use
 * yet repeatedly invented paths or malformed this role's submission in the 2026-07-21 fleet gate.
 */
const EXPLORER_ROLE_VALIDATED_MODEL_KEYS = new Set(["qwopus3.5-9b-coder-mtp"]);

export interface ExplorerModelPick {
	readonly runtimeId: string;
	readonly modelKey: string;
	readonly footprintGiB: number;
	readonly contextWindow: number;
}

function footprintGiB(descriptor: LoadedModelDescriptor): number | null {
	if (descriptor.sizeBytes !== undefined) {
		return descriptor.sizeBytes / BYTES_PER_GIB;
	}
	const catalog = lookupModelCapability(descriptor.modelKey) ?? lookupModelCapability(descriptor.runtimeId);
	return catalog?.sizeGb !== undefined && Number.isFinite(catalog.sizeGb) && catalog.sizeGb > 0
		? catalog.sizeGb
		: null;
}

function isEmpiricallyToolCapable(descriptor: LoadedModelDescriptor): boolean {
	const catalog = lookupModelCapability(descriptor.modelKey) ?? lookupModelCapability(descriptor.runtimeId);
	if (catalog?.toolUse === "TOOL_CAPABLE") {
		return true;
	}
	if (catalog?.toolUse === "TOOL_UNSUITABLE") {
		return false;
	}
	return descriptor.toolUse === true;
}

function isExplorerRoleValidated(descriptor: LoadedModelDescriptor): boolean {
	return [descriptor.modelKey, descriptor.runtimeId].some((identity) =>
		EXPLORER_ROLE_VALIDATED_MODEL_KEYS.has(identity.trim().toLowerCase()),
	);
}

/**
 * Select the smallest distinct loaded model that has passed the exact explorer-role gate, is empirically tool-capable,
 * meets the context floor, and is truly cheaper than the current worker. Unknown size/capability/context or an
 * unvalidated identity means abstain, never guess.
 */
export function selectSmallerExplorerModel(
	descriptors: readonly LoadedModelDescriptor[],
	workerModelId: string,
): ExplorerModelPick | null {
	const worker = descriptors.find(
		(descriptor) => descriptor.runtimeId === workerModelId || descriptor.modelKey === workerModelId,
	);
	const workerFootprint = worker ? footprintGiB(worker) : null;
	if (workerFootprint === null) {
		return null;
	}
	const candidates = descriptors.flatMap((descriptor): ExplorerModelPick[] => {
		const contextWindow = descriptor.loadedContextLength ?? descriptor.maxContextLength;
		if (
			descriptor.isEmbedding ||
			descriptor.runtimeId === worker?.runtimeId ||
			contextWindow === undefined ||
			contextWindow < NKLEIN_MIN_CONTEXT_WINDOW_TOKENS ||
			!isExplorerRoleValidated(descriptor) ||
			!isEmpiricallyToolCapable(descriptor)
		) {
			return [];
		}
		const footprint = footprintGiB(descriptor);
		if (footprint === null || footprint < MIN_EXPLORER_FOOTPRINT_GIB || footprint >= workerFootprint) {
			return [];
		}
		return [
			{
				runtimeId: descriptor.runtimeId,
				modelKey: descriptor.modelKey,
				footprintGiB: footprint,
				contextWindow,
			},
		];
	});
	candidates.sort(
		(left, right) => left.footprintGiB - right.footprintGiB || left.runtimeId.localeCompare(right.runtimeId),
	);
	return candidates[0] ?? null;
}

/** Effectful resident-only wrapper. Endpoint failure or no safe cheaper candidate returns the worker config unchanged. */
export async function resolveExplorerLaunchConfig(
	workerLaunch: NKleinTaskRestartLaunchConfig,
	fetchImpl: typeof fetch = fetch,
): Promise<NKleinTaskRestartLaunchConfig> {
	const baseUrl = workerLaunch.baseUrl?.trim();
	if (!baseUrl || !workerLaunch.modelId) {
		return workerLaunch;
	}
	const descriptors = await fetchLoadedModelDescriptors(baseUrl, fetchImpl).catch(() => []);
	const pick = selectSmallerExplorerModel(descriptors, workerLaunch.modelId);
	if (!pick) {
		return workerLaunch;
	}
	return {
		...workerLaunch,
		modelId: pick.runtimeId,
		contextWindow: Math.min(workerLaunch.contextWindow ?? pick.contextWindow, pick.contextWindow),
	};
}
