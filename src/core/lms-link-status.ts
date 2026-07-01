/**
 * Parse `lms link status --json` — the LM Link device roster: this host's name + every linked PEER's device id → name.
 * `lms ps` identifies the machine serving each model by a hex `deviceIdentifier` (null = local); this maps those hex ids
 * to the friendly names the user set (`m5max`, `m4mini`, `davidlegion5pro`), so the swarm view reads in machine names,
 * not opaque hashes. PURE parser + injectable fetch over the existing {@link LmsRunner}; any failure ⇒ an empty roster.
 */

import type { LmsRunner } from "./lms-model-runner";

export interface LmsLinkDevices {
	/** This host's LM Link device name (the top-level `deviceName`), or null when unavailable. */
	localMachineName: string | null;
	/** Linked PEER device id (hex) → friendly device name. */
	namesByDeviceId: Map<string, string>;
}

interface RawLinkPeer {
	deviceIdentifier?: unknown;
	deviceName?: unknown;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Parse `lms link status --json` into the device roster. A malformed / non-object payload yields an empty roster. */
export function parseLmsLinkDevices(stdout: string): LmsLinkDevices {
	const empty: LmsLinkDevices = { localMachineName: null, namesByDeviceId: new Map() };
	let payload: unknown;
	try {
		payload = JSON.parse(stdout);
	} catch {
		return empty;
	}
	if (!payload || typeof payload !== "object") {
		return empty;
	}
	const obj = payload as { deviceName?: unknown; peers?: unknown };
	const namesByDeviceId = new Map<string, string>();
	for (const raw of Array.isArray(obj.peers) ? obj.peers : []) {
		if (!raw || typeof raw !== "object") {
			continue;
		}
		const peer = raw as RawLinkPeer;
		const id = asString(peer.deviceIdentifier);
		const name = asString(peer.deviceName);
		if (id && name) {
			namesByDeviceId.set(id, name);
		}
	}
	return { localMachineName: asString(obj.deviceName) ?? null, namesByDeviceId };
}

/** Fetch + parse the LM Link device roster via the injectable `lms` runner. Returns an empty roster on any failure. */
export async function fetchLmsLinkDevices(run: LmsRunner): Promise<LmsLinkDevices> {
	try {
		const { stdout } = await run(["link", "status", "--json"]);
		return parseLmsLinkDevices(stdout);
	} catch {
		return { localMachineName: null, namesByDeviceId: new Map() };
	}
}
