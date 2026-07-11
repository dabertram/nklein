/**
 * §5.AB machine-aware load routing — the PURE device selector that keeps a model OFF a linked node it would SWAP.
 *
 * {@link import("./model-load-headroom").decideModelLoad} answers "does X fit in THIS machine's headroom?". A
 * multi-host fleet (m5max 128 GB · m4mini · legion5pro) needs the PRIOR question — "of the linked devices that HAVE
 * this model, which one should it load on so an undersized node doesn't overload?" LM Studio LM-Link JIT resolves a
 * duplicate model key to a device by ITS OWN logic with no RAM awareness, so a 14B at ctx 40000 (weights ~8.3 GB +
 * KV cache) that fits m5max easily gets auto-placed on m4mini and SWAPS → the model process crashes (live-observed
 * 2026-07-11: David saw m4mini swapping; the routed 14B's sessions logged "model has crashed"). This selector picks a
 * device that provably fits BEFORE the load, so the runtime can steer LM-Link's preferred device (or refuse) instead
 * of discovering the overload by crash.
 *
 * Pure + deterministic (no I/O, no clock, no config reads): the caller supplies the candidate devices, their RAM, the
 * per-device resident footprint, and the model's EFFECTIVE footprint (weights + KV-cache at the load context — best
 * sourced from llmfit's per-quant `memoryRequiredGb`, which already accounts for KV; weights-only under-counts and
 * would MISS exactly the m4mini case). Composes {@link decideModelLoad} per device so the 25 % freeze-avoidance
 * reserve is byte-identical to the single-machine guard — this only adds the ACROSS-machine choice on top.
 */

import { kvCacheBytes } from "./kv-cache-size";
import { decideModelLoad } from "./model-load-headroom";

const GiB = 1024 ** 3;
const gib = (bytes: number): string => `${(bytes / GiB).toFixed(1)} GiB`;

/**
 * Conservative default KV-cache architecture for a mid-tier (~14B) model, used ONLY when no llmfit estimate is
 * available. Biased toward the larger mid models (48 layers · 8 GQA KV-heads · 128 head-dim · FP16) so the fallback
 * OVER-counts the KV cache — the SAFE direction for routing (over-counting keeps a model OFF a node it might swap,
 * never the reverse). Refine per-model via llmfit / registry arch params. At ctx 40000 this yields ~7.3 GiB of KV,
 * so a 14B's effective footprint (~8.3 weights + ~7.3 KV ≈ 15.6 GiB) correctly fails a 16 GB node's headroom.
 */
const FALLBACK_KV_ARCH = { numLayers: 48, numKvHeads: 8, headDim: 128, bytesPerParam: 2 } as const;

/**
 * Estimate a model's EFFECTIVE resident footprint (weights + KV-cache at the load context) in bytes — the figure the
 * device selector needs, because weights-alone under-counts and would clear a small node that then swaps once the KV
 * cache fills at context. Prefers llmfit's `memoryRequiredGb` (per-quant / MoE / KV-aware, the accurate source); with
 * no llmfit datum it adds a CONSERVATIVE KV estimate ({@link FALLBACK_KV_ARCH}) to the weights. Pure.
 */
export function estimateEffectiveModelBytes(input: {
	/** Model weights footprint in bytes (from `lms ps`/`lms ls` size). */
	weightsBytes: number;
	/** The context the model is (or will be) loaded at — drives the KV-cache term. */
	contextLength: number;
	/** llmfit's `memoryRequiredGb × GiB` when known — the accurate KV-aware total; takes precedence. */
	llmfitMemoryBytes?: number | null;
}): number {
	const weights = Math.max(0, input.weightsBytes);
	if (input.llmfitMemoryBytes !== undefined && input.llmfitMemoryBytes !== null && input.llmfitMemoryBytes > 0) {
		// llmfit already folds weights + KV at context; never return LESS than the raw weights (defensive floor).
		return Math.max(input.llmfitMemoryBytes, weights);
	}
	return weights + kvCacheBytes({ contextLength: input.contextLength, ...FALLBACK_KV_ARCH });
}

/**
 * Resolve a per-device RAM map (friendly LM-Link device name → bytes) from `NKLEIN_DEVICE_RAM_GB` — a power-user
 * fleet-tuning knob usable TODAY, ahead of a Settings field (mirrors {@link import("./model-load-headroom").resolveRamBudgetBytesFromEnv}).
 * Format: comma-separated `name:GB` pairs, e.g. `"Local:128,m4mini:16,legion5pro:24"`. Whitespace-tolerant; a malformed
 * or non-positive entry is SKIPPED (fail-open — a bad entry never fabricates a false RAM figure). Unset/empty ⇒ `{}`,
 * which disengages the device selector so the runtime keeps its current LM-Link JIT placement (byte-identical). Pure
 * over the injected env.
 */
export function resolveDeviceRamBytesFromEnv(env: NodeJS.ProcessEnv = process.env): Record<string, number> {
	const raw = env.NKLEIN_DEVICE_RAM_GB;
	if (raw === undefined || raw.trim().length === 0) {
		return {};
	}
	const map: Record<string, number> = {};
	for (const pair of raw.split(",")) {
		// Split on the LAST colon so a device name is tolerant of stray colons; the tail must be a positive GB number.
		const idx = pair.lastIndexOf(":");
		if (idx <= 0) {
			continue;
		}
		const name = pair.slice(0, idx).trim();
		const gb = Number.parseFloat(pair.slice(idx + 1).trim());
		if (name.length === 0 || !Number.isFinite(gb) || gb <= 0) {
			continue;
		}
		map[name] = Math.round(gb * GiB);
	}
	return map;
}

/**
 * Alias a `"Local"`/`"local"` RAM-map key to the ACTUAL local LM-Link device name. Guards a real trap (live-found
 * 2026-07-12): `lms ls` shows the local host as `"Local"`, but its LM-Link device NAME (the routing key) is the real
 * hostname (e.g. `m5max`). A user who writes `Local:128` would otherwise leave the big farm UNMAPPED — excluded from
 * candidates — and models would route to a smaller mapped box. This copies the `"Local"` value onto the real local
 * name (when that isn't already keyed), so both spellings work. Pure; returns the map unchanged when there's nothing
 * to alias.
 */
export function applyLocalDeviceAlias(
	deviceRamBytes: Record<string, number>,
	localMachineName: string | null | undefined,
): Record<string, number> {
	if (!localMachineName || deviceRamBytes[localMachineName] !== undefined) {
		return deviceRamBytes;
	}
	const localKey = Object.keys(deviceRamBytes).find((key) => key.toLowerCase() === "local");
	if (localKey === undefined) {
		return deviceRamBytes;
	}
	return { ...deviceRamBytes, [localMachineName]: deviceRamBytes[localKey] };
}

/** One linked device that HAS the model available and is a placement candidate. */
export interface DeviceLoadCandidate {
	/** Friendly LM-Link device name (the `lms ps`/`lms ls` DEVICE — e.g. "Local", "m4mini") — the config RAM-map key. */
	deviceName: string;
	/** LM-Link device identifier (hex) when known — echoed back so the caller can set it as the preferred device. */
	deviceIdentifier?: string;
	/** Total host RAM in bytes for THIS device (from the per-device RAM map; unified RAM/VRAM pool on a Mac). */
	totalRamBytes: number;
	/** Sum of currently-resident model bytes on THIS device (its own `lms ps`), in bytes. */
	residentSizeBytes: number;
}

export interface DeviceLoadRoutingInput {
	/**
	 * The model's EFFECTIVE footprint to place, in bytes — weights PLUS the KV-cache at the load context. Prefer
	 * llmfit's `memoryRequiredGb × GiB` (KV-aware); a weights-only figure under-counts and can wrongly clear a small
	 * node. A non-positive value makes every device refuse (cannot prove headroom).
	 */
	candidateSizeBytes: number;
	/** The linked devices that HAVE the model (already filtered to those that can serve it). Empty ⇒ no placement. */
	candidates: readonly DeviceLoadCandidate[];
	/** Reserve fraction forwarded to {@link decideModelLoad} (default 0.25 — the freeze-avoidance buffer). */
	reserveFraction?: number;
	/** Optional per-device user RAM budget cap in bytes, forwarded to {@link decideModelLoad}. */
	userBudgetBytes?: number;
}

/** A candidate that was considered but rejected, with the headroom reason (for observability / the audit trail). */
export interface RejectedDevice {
	deviceName: string;
	reason: string;
}

export type DeviceLoadRoutingDecision =
	| {
			/** At least one device fits; `deviceName`/`deviceIdentifier` is the chosen placement (most free headroom). */
			fits: true;
			deviceName: string;
			deviceIdentifier?: string;
			/** Free bytes on the chosen device AFTER the load. */
			freeBytesAfter: number;
			reason: string;
			/** Fitting alternatives, best-headroom first EXCLUDING the chosen device — the caller's failover order. */
			alternatives: readonly DeviceLoadCandidate[];
			/** Devices that could not fit, with their refusal reason. */
			rejected: readonly RejectedDevice[];
	  }
	| {
			/** No candidate device can hold the model without risking a swap/overload. */
			fits: false;
			reason: string;
			rejected: readonly RejectedDevice[];
	  };

/**
 * Choose the linked device to load a model on so it does not overload an undersized node. Evaluates
 * {@link decideModelLoad} per candidate and, among those that FIT, picks the one with the MOST free RAM after the load
 * (the safest placement, farthest from swap). Ties break by declaration order (stable). When NO device fits, refuses
 * with `fits:false` so the caller can queue / unload / escalate rather than let LM-Link drop the model on a node that
 * swaps.
 *
 * "Most free headroom" is a deliberately simple, swap-avoiding default; a throughput-farm-aware "smallest sufficient
 * device, reserve the big farm for big models" policy (§5.AB fleet routing, todo ~L834) is a future refinement layered
 * on the same per-device verdicts.
 */
export function selectDeviceForModelLoad(input: DeviceLoadRoutingInput): DeviceLoadRoutingDecision {
	const reserveFraction = input.reserveFraction ?? 0.25;
	const rejected: RejectedDevice[] = [];
	const fitting: { candidate: DeviceLoadCandidate; freeBytesAfter: number; reason: string }[] = [];

	for (const candidate of input.candidates) {
		const decision = decideModelLoad({
			candidateSizeBytes: input.candidateSizeBytes,
			residentSizeBytes: candidate.residentSizeBytes,
			totalRamBytes: candidate.totalRamBytes,
			reserveFraction,
			...(input.userBudgetBytes !== undefined ? { userBudgetBytes: input.userBudgetBytes } : {}),
		});
		if (decision.allow) {
			fitting.push({ candidate, freeBytesAfter: decision.freeBytesAfter, reason: decision.reason });
		} else {
			rejected.push({ deviceName: candidate.deviceName, reason: decision.reason });
		}
	}

	if (fitting.length === 0) {
		const detail =
			input.candidates.length === 0 ? "no candidate devices" : rejected.map((r) => r.deviceName).join(", ");
		return {
			fits: false,
			reason: `No linked device can hold this ${gib(input.candidateSizeBytes)} model without overloading (${detail}).`,
			rejected,
		};
	}

	// Most free headroom first; ties keep declaration order (findIndex is stable over the input candidates).
	fitting.sort((a, b) => {
		if (b.freeBytesAfter !== a.freeBytesAfter) {
			return b.freeBytesAfter - a.freeBytesAfter;
		}
		return input.candidates.indexOf(a.candidate) - input.candidates.indexOf(b.candidate);
	});
	const [chosen, ...rest] = fitting;

	return {
		fits: true,
		deviceName: chosen.candidate.deviceName,
		...(chosen.candidate.deviceIdentifier !== undefined
			? { deviceIdentifier: chosen.candidate.deviceIdentifier }
			: {}),
		freeBytesAfter: chosen.freeBytesAfter,
		reason: `Load on "${chosen.candidate.deviceName}" — ${gib(chosen.freeBytesAfter)} free after (most headroom of ${fitting.length} fitting device(s)).`,
		alternatives: rest.map((entry) => entry.candidate),
		rejected,
	};
}

/** A linked LM-Link device (friendly name + optional hex identifier), as read from `lms link status`. */
export interface LinkedDeviceInfo {
	deviceName: string;
	deviceIdentifier?: string;
}

/**
 * The steering action the caller should take before dispatching a model request. `set_preferred` ⇒ run
 * `lms link set-preferred-device <deviceIdentifier>` so LM-Link's JIT lands the model on a fitting node; `no_fit` ⇒
 * warn (no device can hold it); `already_preferred`/`skip` ⇒ do nothing (byte-identical to today).
 */
export type PreferredDeviceSteering =
	| { action: "set_preferred"; deviceName: string; deviceIdentifier: string; reason: string }
	| { action: "already_preferred"; deviceName: string; reason: string }
	| { action: "no_fit"; reason: string; rejected: readonly RejectedDevice[] }
	| { action: "skip"; reason: string };

/**
 * Plan whether — and to which device — to steer LM-Link's preferred device before a model request, so the JIT load
 * lands on a node that fits instead of an undersized one that swaps. PURE: the caller supplies the configured per-device
 * RAM map (from {@link resolveDeviceRamBytesFromEnv}), the linked-device roster + current preferred id (from
 * `lms link status`), the per-device resident footprint (from `lms ps`), and the model's effective footprint (from
 * {@link estimateEffectiveModelBytes}). Only devices WITH a configured RAM entry are judged — an unmapped device is left
 * to LM-Link (we can't prove its headroom). An empty map ⇒ `skip` ⇒ the runtime keeps today's behavior.
 */
export function planPreferredDeviceSteering(input: {
	deviceRamBytes: Record<string, number>;
	linkedDevices: readonly LinkedDeviceInfo[];
	residentBytesByDevice?: Record<string, number>;
	currentPreferredDeviceId?: string | null;
	effectiveModelBytes: number;
	reserveFraction?: number;
}): PreferredDeviceSteering {
	if (Object.keys(input.deviceRamBytes).length === 0) {
		return { action: "skip", reason: "No NKLEIN_DEVICE_RAM_GB map configured — device steering disabled." };
	}
	const candidates: DeviceLoadCandidate[] = [];
	for (const device of input.linkedDevices) {
		const ram = input.deviceRamBytes[device.deviceName];
		if (ram === undefined || ram <= 0) {
			continue; // No configured RAM for this device — can't judge its headroom; leave it to LM-Link.
		}
		candidates.push({
			deviceName: device.deviceName,
			...(device.deviceIdentifier !== undefined ? { deviceIdentifier: device.deviceIdentifier } : {}),
			totalRamBytes: ram,
			residentSizeBytes: Math.max(0, input.residentBytesByDevice?.[device.deviceName] ?? 0),
		});
	}
	if (candidates.length === 0) {
		return { action: "skip", reason: "No linked device has a configured RAM entry — nothing to steer." };
	}
	const decision = selectDeviceForModelLoad({
		candidateSizeBytes: input.effectiveModelBytes,
		candidates,
		...(input.reserveFraction !== undefined ? { reserveFraction: input.reserveFraction } : {}),
	});
	if (!decision.fits) {
		return { action: "no_fit", reason: decision.reason, rejected: decision.rejected };
	}
	if (decision.deviceIdentifier === undefined) {
		// A device was chosen but carries no LM-Link identifier, so it can't be set as the preferred device.
		return {
			action: "skip",
			reason: `Best-fit device "${decision.deviceName}" has no LM-Link identifier to steer to.`,
		};
	}
	if (input.currentPreferredDeviceId && input.currentPreferredDeviceId === decision.deviceIdentifier) {
		return {
			action: "already_preferred",
			deviceName: decision.deviceName,
			reason: `Preferred device is already the best fit ("${decision.deviceName}").`,
		};
	}
	return {
		action: "set_preferred",
		deviceName: decision.deviceName,
		deviceIdentifier: decision.deviceIdentifier,
		reason: decision.reason,
	};
}
