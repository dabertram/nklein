/**
 * Impure companion of `src/core/loaded-host-allowlist.ts`: resolves the `lms ps` machine map (30 s cached) and
 * applies the loaded-host allowlist to a loaded-model descriptor list. Every auto/fallback chooser that draws from
 * `fetchLoadedModelDescriptors` calls this so an operator-idled host (David 2026-09-07: m5max) never receives work
 * through a side door. Explicit pins do not pass through here.
 */

import { createDefaultLmsRunner, fetchLmsPsModelsCached, type LmsPsModel } from "../core/lms-ps-json";
import {
	filterByLoadedHostAllowlist,
	getLoadedHostAllowlist,
	isModelIdAllowedByLoadedHostAllowlist,
} from "../core/loaded-host-allowlist";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import { buildLmStudioMachineByModelId } from "./nklein-lmstudio-host-map";

const LMS_PS_TIMEOUT_MS = 5_000;

async function loadFleet(fleetOverride?: readonly LmsPsModel[]): Promise<readonly LmsPsModel[]> {
	if (fleetOverride) {
		return fleetOverride;
	}
	return await fetchLmsPsModelsCached(createDefaultLmsRunner(LMS_PS_TIMEOUT_MS)).catch(() => [] as LmsPsModel[]);
}

/**
 * Drop descriptors whose host is outside the loaded-host allowlist. No allowlist ⇒ the input is returned as-is
 * without touching `lms ps`. Records one observation per call that excluded something.
 */
export async function excludeDisallowedHostDescriptors<T extends { runtimeId: string; modelKey: string }>(
	descriptors: readonly T[],
	context: { purpose: string; taskId?: string },
	fleetOverride?: readonly LmsPsModel[],
): Promise<T[]> {
	const allowlist = getLoadedHostAllowlist();
	if (allowlist.size === 0 || descriptors.length === 0) {
		return [...descriptors];
	}
	const fleet = await loadFleet(fleetOverride);
	const result = filterByLoadedHostAllowlist(descriptors, {
		allowlist,
		machineIdByModelId: buildLmStudioMachineByModelId(fleet),
		idsOf: (descriptor) => [descriptor.runtimeId, descriptor.modelKey],
	});
	if (result.excluded.length > 0) {
		recordSelfObservation({
			signal: "custom",
			severity: "info",
			message: `${context.purpose}${context.taskId ? ` for ${context.taskId}` : ""} skipped ${result.excluded.length} loaded model(s) on non-allowlisted host(s): ${result.excluded
				.map((entry) => `${entry.id} (${entry.machineId})`)
				.join(", ")}.`,
			...(context.taskId ? { taskId: context.taskId } : {}),
			metadata: { category: "loaded_host_allowlist_excluded", excluded: result.excluded, purpose: context.purpose },
		});
	}
	return result.kept;
}

/** True when `modelId` may be auto-selected under the allowlist (no allowlist ⇒ true; unmapped ⇒ `local`). */
export async function isModelIdOnAllowedHost(modelId: string, fleetOverride?: readonly LmsPsModel[]): Promise<boolean> {
	const allowlist = getLoadedHostAllowlist();
	if (allowlist.size === 0) {
		return true;
	}
	const fleet = await loadFleet(fleetOverride);
	return isModelIdAllowedByLoadedHostAllowlist(modelId, {
		allowlist,
		machineIdByModelId: buildLmStudioMachineByModelId(fleet),
	});
}
