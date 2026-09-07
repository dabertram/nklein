/**
 * Loaded-host allowlist — the one place that says which LM Studio hosts !Klein may AUTO-select models from.
 *
 * David 2026-09-07: "leave m5max models idle for a while … keep flash-next available on m5max, but idle for nklein".
 * The config field `workerUseAllLoadedHosts` (F2.34) already restricted the WORKER auto-pool to allowlisted lms
 * machine ids, but every other auto/fallback chooser (reviewer loaded-fallback and diverse chooser, main-branch
 * custodian, merge-resolution fallback, explorer downsizing, sibling consults, spec deliberation, decomposition
 * routing candidates) drew from the raw loaded listing — so an idled host kept receiving work through the side
 * doors (live: `reviewer=qwen3.8-flash-next (loaded_fallback)` minutes after the roles were re-pointed).
 *
 * This module holds the allowlist as a process-level registry (published by the runtime config resolver on every
 * load/reload) plus the pure filter every chooser applies. Semantics, identical to the worker auto-pool:
 *  - empty allowlist ⇒ no restriction (every host);
 *  - a model maps to its machine through the `lms ps` alias map; an UNMAPPED model counts as `local` — so with an
 *    allowlist that omits `local`, unknown/unlisted models are excluded (fail-closed: an idled host stays idle even
 *    when the fleet listing is stale or unavailable);
 *  - explicit pins never pass through these choosers, so a model David names in a role still runs where he put it.
 */

import { LOCAL_MACHINE_ID } from "./lms-ps-json";

let currentAllowlist: ReadonlySet<string> = new Set();

/** Normalize + publish the allowlist (called by the runtime config resolver on every load). Returns the clean list. */
export function setLoadedHostAllowlist(hosts: readonly unknown[] | null | undefined): string[] {
	const clean = Array.isArray(hosts)
		? [
				...new Set(hosts.filter((host): host is string => typeof host === "string").map((host) => host.trim())),
			].filter((host) => host.length > 0)
		: [];
	currentAllowlist = new Set(clean);
	return clean;
}

/** The current allowlist (empty = unrestricted). */
export function getLoadedHostAllowlist(): ReadonlySet<string> {
	return currentAllowlist;
}

/** Test seam. */
export function resetLoadedHostAllowlistForTests(): void {
	currentAllowlist = new Set();
}

export interface LoadedHostFilterInput<T> {
	allowlist: ReadonlySet<string>;
	/** Runtime model id / model key / path alias → lms machine id (see `buildLmStudioMachineByModelId`). */
	machineIdByModelId: ReadonlyMap<string, string>;
	/** Every id the item is known by; the first mapped one decides its machine. */
	idsOf: (item: T) => readonly (string | null | undefined)[];
}

export interface LoadedHostFilterResult<T> {
	kept: T[];
	excluded: { id: string; machineId: string }[];
}

/** Resolve an item's machine id: first mapped alias wins; unmapped ⇒ `local`. */
export function resolveMachineIdForIds(
	ids: readonly (string | null | undefined)[],
	machineIdByModelId: ReadonlyMap<string, string>,
): string {
	for (const id of ids) {
		const key = id?.trim();
		if (!key) {
			continue;
		}
		const machine = machineIdByModelId.get(key);
		if (machine) {
			return machine;
		}
	}
	return LOCAL_MACHINE_ID;
}

/** Keep only items whose machine is allowlisted (empty allowlist keeps everything). Pure. */
export function filterByLoadedHostAllowlist<T>(
	items: readonly T[],
	input: LoadedHostFilterInput<T>,
): LoadedHostFilterResult<T> {
	if (input.allowlist.size === 0 || items.length === 0) {
		return { kept: [...items], excluded: [] };
	}
	const kept: T[] = [];
	const excluded: { id: string; machineId: string }[] = [];
	for (const item of items) {
		const ids = input.idsOf(item);
		const machineId = resolveMachineIdForIds(ids, input.machineIdByModelId);
		if (input.allowlist.has(machineId)) {
			kept.push(item);
		} else {
			excluded.push({ id: ids.find((id) => !!id?.trim())?.trim() ?? "?", machineId });
		}
	}
	return { kept, excluded };
}

/** True when a single model id may be auto-selected under the allowlist (empty allowlist ⇒ true). */
export function isModelIdAllowedByLoadedHostAllowlist(
	modelId: string,
	input: { allowlist: ReadonlySet<string>; machineIdByModelId: ReadonlyMap<string, string> },
): boolean {
	if (input.allowlist.size === 0) {
		return true;
	}
	return input.allowlist.has(resolveMachineIdForIds([modelId], input.machineIdByModelId));
}
