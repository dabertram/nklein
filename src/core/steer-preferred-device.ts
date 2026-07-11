/**
 * §5.AB machine-aware load routing — the EFFECTFUL adapter that steers LM-Link's preferred device before a model
 * request so the JIT load lands on a node that FITS instead of an undersized one that swaps (the m4mini crash,
 * 2026-07-11). The pure decision lives in {@link import("./device-load-routing")}; this thin adapter feeds it the live
 * fleet state and, on a `set_preferred` verdict, issues the one steering primitive LM Studio exposes —
 * `lms link set-preferred-device <id>`.
 *
 * OPT-IN + fail-open by construction:
 *  - GATED on `NKLEIN_DEVICE_RAM_GB` (via {@link resolveDeviceRamBytesFromEnv}). Unset ⇒ returns `skip` IMMEDIATELY
 *    with NO fleet I/O, so a runtime that hasn't enabled the feature pays nothing and behaves byte-identically.
 *  - Every fleet read/write goes through injected deps and is wrapped so ANY failure degrades to `skip` (never blocks
 *    or breaks a dispatch — a routing hint must never be load-bearing for whether a card can start).
 *
 * Deps are injected so the decision path is unit-testable without a live LM Studio (see the tests). The live seam
 * wires the real deps (`fetchLmsLinkDevices`, the REST `listModels` sizes, and the `lms link set-preferred-device`
 * runner).
 *
 * KNOWN v1 LIMITATIONS (documented, not bugs): (a) the preferred device is GLOBAL LM Studio state, so highly
 * concurrent card-starts steering different models could race — bounded in practice by the one-model-at-a-time
 * guardrail; (b) it fetches link status + sizes per gated dispatch (opt-in overhead). Both are acceptable for the
 * initial rollout and called out for the follow-up.
 */

import {
	estimateEffectiveModelBytes,
	type LinkedDeviceInfo,
	type PreferredDeviceSteering,
	planPreferredDeviceSteering,
	resolveDeviceRamBytesFromEnv,
} from "./device-load-routing";
import type { LmsLinkDevices } from "./lms-link-status";

/** Injected fleet accessors — the live seam supplies LM Studio-backed implementations; tests supply fakes. */
export interface SteerPreferredDeviceDeps {
	/** Read the LM-Link roster (names, ids, current preferred device). */
	fetchLinkDevices: () => Promise<LmsLinkDevices>;
	/** Map of model key → on-disk WEIGHTS size in bytes (e.g. from the REST `listModels` `size_bytes`). */
	listModelSizes: () => Promise<ReadonlyMap<string, number>>;
	/** Issue `lms link set-preferred-device <deviceIdentifier>`. */
	setPreferredDevice: (deviceIdentifier: string) => Promise<void>;
	/** Optional llmfit KV-aware footprint (bytes) for a model key — preferred over the weights+KV estimate when known. */
	llmfitMemoryBytes?: (modelId: string) => number | null;
	/** Injectable env for the gate (defaults to process.env). */
	env?: NodeJS.ProcessEnv;
}

/** Flatten an {@link LmsLinkDevices} roster (local host + peers) into the selector's `LinkedDeviceInfo[]`. */
export function buildLinkedDeviceList(link: LmsLinkDevices): LinkedDeviceInfo[] {
	const devices: LinkedDeviceInfo[] = [];
	const seen = new Set<string>();
	if (link.localMachineName && link.localDeviceIdentifier) {
		devices.push({ deviceName: link.localMachineName, deviceIdentifier: link.localDeviceIdentifier });
		seen.add(link.localDeviceIdentifier);
	}
	for (const [deviceId, deviceName] of link.namesByDeviceId) {
		if (seen.has(deviceId)) {
			continue;
		}
		devices.push({ deviceName, deviceIdentifier: deviceId });
		seen.add(deviceId);
	}
	return devices;
}

/**
 * Steer LM-Link's preferred device for the given model before its request, so the JIT load fits. Returns the
 * {@link PreferredDeviceSteering} verdict (for logging). Never throws — any error or missing datum degrades to `skip`.
 */
export async function steerPreferredDeviceForModel(
	input: { modelId: string; contextLength: number },
	deps: SteerPreferredDeviceDeps,
): Promise<PreferredDeviceSteering> {
	const deviceRamBytes = resolveDeviceRamBytesFromEnv(deps.env);
	if (Object.keys(deviceRamBytes).length === 0) {
		// Feature disabled ⇒ no fleet I/O, byte-identical behavior.
		return { action: "skip", reason: "NKLEIN_DEVICE_RAM_GB not set — device steering disabled." };
	}
	const modelId = input.modelId.trim();
	if (modelId.length === 0) {
		return { action: "skip", reason: "No model id to steer." };
	}
	try {
		const [link, sizes] = await Promise.all([deps.fetchLinkDevices(), deps.listModelSizes()]);
		const weightsBytes = sizes.get(modelId);
		if (weightsBytes === undefined || !(weightsBytes > 0)) {
			return { action: "skip", reason: `Weights size unknown for "${modelId}" — cannot judge headroom.` };
		}
		const effectiveModelBytes = estimateEffectiveModelBytes({
			weightsBytes,
			contextLength: input.contextLength,
			llmfitMemoryBytes: deps.llmfitMemoryBytes?.(modelId) ?? null,
		});
		// One-model-at-a-time guardrail ⇒ treat each device as effectively empty; the primary reject (a 14B on a 16 GB
		// node) holds regardless of resident, and per-device resident sizes aren't cheaply available at the seam.
		const steering = planPreferredDeviceSteering({
			deviceRamBytes,
			linkedDevices: buildLinkedDeviceList(link),
			currentPreferredDeviceId: link.preferredDeviceIdentifier,
			effectiveModelBytes,
		});
		if (steering.action === "set_preferred") {
			await deps.setPreferredDevice(steering.deviceIdentifier);
		}
		return steering;
	} catch (error) {
		return { action: "skip", reason: `Device steering skipped (fleet read/write failed): ${String(error)}` };
	}
}
