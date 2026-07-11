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

import { decideModelLoad } from "./model-load-headroom";

const GiB = 1024 ** 3;
const gib = (bytes: number): string => `${(bytes / GiB).toFixed(1)} GiB`;

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
