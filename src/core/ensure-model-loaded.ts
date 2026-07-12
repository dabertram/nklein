/**
 * §5.AB machine-aware AUTONOMOUS LOAD — the effectful adapter that LOADS a task's model onto a linked device that FITS,
 * so !Klein can run a not-yet-resident model WITHOUT dropping it on an undersized node that swaps (the m4mini 14B
 * crash). David chose this (2026-07-12) over dispatch-time preferred-device steering after live tests proved the latter
 * inert: LM Studio JIT is OFF and LM-Link serves a model from wherever it's already loaded, so placement is decided at
 * LOAD time — the fix must LOAD, not steer at dispatch.
 *
 * Composes the pure toolkit ({@link selectDeviceForModelLoad} device pick) with the guarded loader
 * {@link import("./lms-model-runner").loadModelExclusive} — which does the §5.AL capability gate, the one-at-a-time
 * unload scoped to the target device, the headroom check, and the preferred-device set→load→restore. This adapter only
 * decides WHICH device and hands off.
 *
 * OPT-IN + fail-safe: gated on `NKLEIN_DEVICE_RAM_GB` (unset ⇒ no-op ⇒ the caller keeps its current "model not loaded"
 * block, byte-identical). Any error, missing size, or no-fit degrades to `{loaded:false}` so the caller falls back to
 * its normal handling — an autonomous load must NEVER be load-bearing for whether the dispatch path stays safe.
 */

import {
	applyLocalDeviceAlias,
	buildEffectiveCandidate,
	buildLinkedDeviceList,
	estimateEffectiveModelBytes,
	resolveDeviceRamBytes,
	selectDeviceForModelLoad,
} from "./device-load-routing";
import type { LmsLinkDevices } from "./lms-link-status";

/** The concrete load the adapter hands to the guarded loader (a subset of `LoadExclusiveInput`). */
export interface EnsureLoadRequest {
	modelId: string;
	candidateSizeBytes: number;
	totalRamBytes: number;
	contextLength: number;
	targetDevice: string;
	targetDeviceIdentifier: string;
}

/** Injected fleet accessors — the live seam supplies LM Studio-backed implementations; tests supply fakes. */
export interface EnsureModelLoadedDeps {
	/** Read the LM-Link roster (names, ids, current preferred device). */
	fetchLinkDevices: () => Promise<LmsLinkDevices>;
	/** Map of model key → on-disk WEIGHTS size in bytes (e.g. from the REST `listModels` `size_bytes`). */
	listModelSizes: () => Promise<ReadonlyMap<string, number>>;
	/** Perform the guarded exclusive load on the chosen device — wraps `loadModelExclusive(run, …)`. */
	loadExclusive: (request: EnsureLoadRequest) => Promise<{ loaded: boolean; reason: string }>;
	/** Optional llmfit KV-aware footprint (bytes) for a model key — preferred over the weights+KV estimate. */
	llmfitMemoryBytes?: (modelId: string) => number | null;
	/** Injectable env for the gate (defaults to process.env). */
	env?: NodeJS.ProcessEnv;
	/** Persisted Settings value (`config.deviceRamGb`); used when the env var is unset (env wins). */
	configuredDeviceRamGb?: string | null;
}

export type EnsureModelLoadedResult =
	| { loaded: true; deviceName: string; reason: string }
	| { loaded: false; reason: string };

/**
 * Load `modelId` on the linked device that best fits it (weights + KV at `contextLength`), via the guarded loader.
 * Returns `{loaded:true, deviceName}` on success; `{loaded:false, reason}` when disabled, sized unknown, no device
 * fits, or the load fails/erred — so the caller can fall back to blocking with a clear reason. Never throws.
 */
export async function ensureModelLoadedOnFittingDevice(
	input: { modelId: string; contextLength: number },
	deps: EnsureModelLoadedDeps,
): Promise<EnsureModelLoadedResult> {
	const rawDeviceRamBytes = resolveDeviceRamBytes({
		env: deps.env,
		configuredDeviceRamGb: deps.configuredDeviceRamGb,
	});
	if (Object.keys(rawDeviceRamBytes).length === 0) {
		return {
			loaded: false,
			reason: "No per-device RAM budget (NKLEIN_DEVICE_RAM_GB / Settings) — autonomous load disabled.",
		};
	}
	const modelId = input.modelId.trim();
	if (modelId.length === 0) {
		return { loaded: false, reason: "No model id to load." };
	}
	try {
		const [link, sizes] = await Promise.all([deps.fetchLinkDevices(), deps.listModelSizes()]);
		const deviceRamBytes = applyLocalDeviceAlias(rawDeviceRamBytes, link.localMachineName);
		const weightsBytes = sizes.get(modelId);
		if (weightsBytes === undefined || !(weightsBytes > 0)) {
			return { loaded: false, reason: `Weights size unknown for "${modelId}" — cannot judge headroom.` };
		}
		const candidateSizeBytes = estimateEffectiveModelBytes({
			weightsBytes,
			contextLength: input.contextLength,
			llmfitMemoryBytes: deps.llmfitMemoryBytes?.(modelId) ?? null,
		});
		// Target devices start empty for the fit check: loadModelExclusive clears the one-at-a-time resident first.
		const candidates = buildLinkedDeviceList(link)
			.map((device) => buildEffectiveCandidate(device, deviceRamBytes[device.deviceName], 0))
			.filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);
		const decision = selectDeviceForModelLoad({ candidateSizeBytes, candidates });
		if (!decision.fits) {
			return { loaded: false, reason: decision.reason };
		}
		if (decision.deviceIdentifier === undefined) {
			return { loaded: false, reason: `Best-fit device "${decision.deviceName}" has no LM-Link identifier.` };
		}
		const result = await deps.loadExclusive({
			modelId,
			candidateSizeBytes,
			totalRamBytes: deviceRamBytes[decision.deviceName],
			contextLength: input.contextLength,
			targetDevice: decision.deviceName,
			targetDeviceIdentifier: decision.deviceIdentifier,
		});
		return result.loaded
			? { loaded: true, deviceName: decision.deviceName, reason: result.reason }
			: { loaded: false, reason: result.reason };
	} catch (error) {
		return { loaded: false, reason: `Autonomous load skipped (error): ${String(error)}` };
	}
}
