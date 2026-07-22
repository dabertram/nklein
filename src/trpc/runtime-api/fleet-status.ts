/**
 * §5.AX fleet-strip status handler — assembles the two per-model maps the board's fleet block renders:
 * machine names (LM-Link `lms ps` feed, so multi-machine fleets group by real machine instead of a shared
 * endpoint URL) and prompt-shell warmth (the §5.AQ ledger: which shell KIND each model last assembled, and
 * when). Both sources are injected and best-effort: an unavailable `lms ps` or an unloaded session service
 * yields an empty map — the strip degrades to endpoint labels / plain idle rows, never an error.
 */

import type { RuntimeFleetStatusResponse } from "../../core/config-api-contract.js";

/** The warmth ledger surface this handler needs (the service's `getPromptWarmthLedger`). */
export type WarmthLedgerSource = () => ReadonlyMap<string, { shellKey: string; at: number }> | null;

/** Best-effort fleet surfaces: cached residency identity plus on-demand resource telemetry. */
export type MachineMapSource = () => Promise<ReadonlyMap<string, string>>;
export type FleetResourceSource = () => Promise<RuntimeFleetStatusResponse["resources"]>;

/** Shell keys are `kind\u0000workspacePath\u0000modelId` (see buildPromptShellKey). */
const SHELL_KEY_SEPARATOR = "\u0000";

export function parseShellKind(shellKey: string): string {
	const separatorIndex = shellKey.indexOf(SHELL_KEY_SEPARATOR);
	return separatorIndex === -1 ? shellKey : shellKey.slice(0, separatorIndex);
}

export async function handleGetFleetStatus(sources: {
	getMachineMap: MachineMapSource;
	getWarmthLedger: WarmthLedgerSource;
	getResources?: FleetResourceSource;
}): Promise<RuntimeFleetStatusResponse> {
	const machineByModelId: Record<string, string> = {};
	try {
		for (const [modelId, machineId] of await sources.getMachineMap()) {
			machineByModelId[modelId] = machineId;
		}
	} catch {
		// Best-effort: no lms CLI / remote feed ⇒ empty map ⇒ endpoint-label fallback in the strip.
	}
	const warmthByModelId: Record<string, { kind: string; at: number }> = {};
	const ledger = sources.getWarmthLedger();
	if (ledger) {
		for (const [modelId, entry] of ledger) {
			warmthByModelId[modelId] = { kind: parseShellKind(entry.shellKey), at: entry.at };
		}
	}
	let resources: RuntimeFleetStatusResponse["resources"] = null;
	try {
		resources = (await sources.getResources?.()) ?? null;
	} catch {
		// Best-effort: host probes and LM Studio descriptor reads must never break the fleet rail.
	}
	return { machineByModelId, warmthByModelId, resources };
}
