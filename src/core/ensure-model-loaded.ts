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

import { probeLocalGpuCeiling } from "./apple-silicon-probe";
import {
	applyLocalDeviceAlias,
	buildEffectiveCandidate,
	buildLinkedDeviceList,
	estimateEffectiveModelBytes,
	resolveDeviceRamBytes,
	selectDeviceForModelLoad,
} from "./device-load-routing";
import type { LmsLinkDevices } from "./lms-link-status";
import { MIN_CONTEXT_WINDOW_TOKENS } from "./lms-model-control";
import { planLoadContextLength } from "./load-context-plan";

export interface EnsureModelLoadFacts {
	sizeBytes: number | null;
	maxContextLength: number | null;
}

/** The concrete load the adapter hands to the guarded loader (a subset of `LoadExclusiveInput`). */
export interface EnsureLoadRequest {
	modelId: string;
	candidateSizeBytes: number;
	totalRamBytes: number;
	contextLength: number;
	/** Raw task need used to derive `contextLength`; retained so the guarded loader can verify/recompute the plan. */
	taskNeededTokens: number;
	/** Catalog-advertised ceiling used to derive `contextLength`. */
	maxContextLength: number;
	targetDevice: string;
	targetDeviceIdentifier: string;
}

/** Injected fleet accessors — the live seam supplies LM Studio-backed implementations; tests supply fakes. */
export interface EnsureModelLoadedDeps {
	/** Read the LM-Link roster (names, ids, current preferred device). */
	fetchLinkDevices: () => Promise<LmsLinkDevices>;
	/** Model key → load-planning facts from the REST catalog. Missing/invalid facts make admission fail closed. */
	listModelFacts: () => Promise<ReadonlyMap<string, EnsureModelLoadFacts>>;
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
 * Load `modelId` on the linked device that best fits it. The production path derives one context window from the
 * task need and catalog maximum, then uses that exact value for both weights+KV placement and the guarded load.
 * Returns `{loaded:true, deviceName}` on success; `{loaded:false, reason}` when disabled, sized unknown, no device
 * fits, or the load fails/erred — so the caller can fall back to blocking with a clear reason. Never throws.
 */
export async function ensureModelLoadedOnFittingDevice(
	input: { modelId: string; taskNeededTokens: number },
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
		const [link, factsByModel] = await Promise.all([deps.fetchLinkDevices(), deps.listModelFacts()]);
		const deviceRamBytes = applyLocalDeviceAlias(rawDeviceRamBytes, link.localMachineName);
		const facts = factsByModel.get(modelId);
		const weightsBytes = facts?.sizeBytes;
		if (weightsBytes == null || !(weightsBytes > 0)) {
			return { loaded: false, reason: `Weights size unknown for "${modelId}" — cannot judge headroom.` };
		}
		const maxContextLength = facts?.maxContextLength;
		if (maxContextLength == null || !Number.isFinite(maxContextLength) || !(maxContextLength > 0)) {
			return { loaded: false, reason: `Maximum context unknown for "${modelId}" — cannot plan a safe load.` };
		}
		const contextLength = planLoadContextLength({
			taskNeededTokens: input.taskNeededTokens,
			maxContextLength,
			minContextFloor: MIN_CONTEXT_WINDOW_TOKENS,
		});
		const candidateSizeBytes = estimateEffectiveModelBytes({
			weightsBytes,
			contextLength,
			llmfitMemoryBytes: deps.llmfitMemoryBytes?.(modelId) ?? null,
		});
		// F12.75: probe the LOCAL device's GPU-wireable ceiling once. On Apple Silicon macOS caps GPU-wireable
		// memory at ~75% of physical RAM, so the configured RAM map OVERSTATES what a model can occupy there (the
		// m4mini swap-crash). Local-only by necessity — a remote node's sysctls are unreadable over LM-Link, and
		// assuming they run the default cap would be right often and catastrophically wrong on a tuned node.
		// A null probe (non-Mac, or any failure) leaves every candidate exactly as it was before this existed.
		const localCeiling = await probeLocalGpuCeiling().catch(() => null);
		// Target devices start empty for the fit check: loadModelExclusive clears the one-at-a-time resident first.
		const candidates = buildLinkedDeviceList(link)
			.map((device) =>
				buildEffectiveCandidate(
					device,
					deviceRamBytes[device.deviceName],
					0,
					localCeiling !== null &&
						device.deviceIdentifier !== undefined &&
						device.deviceIdentifier === link.localDeviceIdentifier
						? localCeiling.usableBytes
						: undefined,
				),
			)
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
			contextLength,
			taskNeededTokens: input.taskNeededTokens,
			maxContextLength,
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
