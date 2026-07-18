/**
 * Effectful guarded model runner (todo §5.AF / §5.AB — the 2026-06-29 load-handover). The ONLY place a model load
 * actually happens. It enforces the user's hard guardrails: **one model resident at a time** (unload every non-pinned
 * model before loading the target), **context = 40000**, and **always headroom-checked** before the load (so a load can
 * never freeze the machine). The `lms` invocations are injected (`LmsRunner`) so the orchestration is fully unit-testable
 * with a fake — no `lms` spawn in tests; the live wiring passes a real `spawn`-backed runner.
 *
 * Selection (which model / size cap) is the caller's (the model-lab sweep); this runner just makes the load SAFE.
 */

import { fetchLmsLinkDevices } from "./lms-link-status";
import {
	buildLmsLoadArgs,
	buildLmsUnloadArgs,
	type LmsLoadOptions,
	MIN_CONTEXT_WINDOW_TOKENS,
	parseLmsPs,
	type ResidentModel,
} from "./lms-model-control";
import type { LmStudioRestModelClient } from "./lmstudio-rest-model-client";
import { planSharedSlotLoadContextLength } from "./load-context-plan";
import {
	assessModelSuitability,
	DEFAULT_MODEL_SUITABILITY_POLICY,
	type ModelSuitabilityPolicy,
	type ModelSuitabilityVerdict,
} from "./model-capability-catalog";
import { decideModelLoad, resolveRamBudgetBytesFromEnv } from "./model-load-headroom";

/** Injected `lms` CLI runner — `run(["load", id, …])` → its stdout + exit code. */
export type LmsRunner = (args: readonly string[]) => Promise<{ stdout: string; exitCode: number }>;

const GiB = 1024 ** 3;
/** Conservative candidate-size assumption when the real on-disk size isn't supplied (≈ the ≤14B cap's footprint). */
const DEFAULT_CANDIDATE_SIZE_BYTES = 16 * GiB;
const DEFAULT_CONTEXT_LENGTH = 40_000;

/** Embedding models are tiny + persistent infra — never auto-unloaded by the one-at-a-time rule. */
function isEmbeddingModel(identifier: string): boolean {
	return identifier.toLowerCase().includes("embed");
}

/** List the currently-resident models (via `lms ps`). */
export async function listResidentModels(run: LmsRunner): Promise<ResidentModel[]> {
	const { stdout } = await run(["ps"]);
	return parseLmsPs(stdout);
}

export interface LoadExclusiveInput {
	/** The model to make the sole resident LLM. */
	modelId: string;
	/** Host RAM in bytes (e.g. `os.totalmem()`). */
	totalRamBytes: number;
	/**
	 * OPTIONAL user-declared RAM budget cap in bytes (§5.AB — "use ≤100 GB of my 128"). When set, the headroom guard plans
	 * against `min(totalRamBytes, userBudgetBytes)`. Omit ⇒ detected RAM stands. Resolve from config/env via
	 * {@link resolveRamBudgetBytesFromEnv} at the caller.
	 */
	userBudgetBytes?: number;
	/** Context window to load with (default 40000; floored to ≥32k + capped to capability by the planner). */
	contextLength?: number;
	/** The model's max context capability (caps `contextLength`). */
	maxContextLength?: number;
	/**
	 * OPT-IN context right-sizing (§5.AQ-G — the #1 VRAM lever). When set (together with `maxContextLength`), the load
	 * context is computed by `planLoadContextLength` — fit the task, never below the ≥32k floor, capped at the model max
	 * — instead of `contextLength`/the 40k default, so a small task doesn't load a 262k window and waste ~GBs of KV cache.
	 * Inert when omitted: existing callers keep the fixed-context behavior unchanged.
	 */
	taskNeededTokens?: number;
	/**
	 * F12.68 — sessions that will run CONCURRENTLY on this instance. The engine's context is a SHARED budget across
	 * parallel slots (llama.cpp `--ctx-size` / `-np` semantics), so the right-sized load context is multiplied by this
	 * so each slot still gets its full per-session window. Default 1 (no change to single-session behavior).
	 */
	concurrentSlots?: number;
	/** Candidate on-disk size in bytes (from `lms ls`); a conservative default is used when omitted. */
	candidateSizeBytes?: number;
	/** Identifiers to NEVER unload (the user's pinned set; embeddings are auto-kept regardless). */
	pinnedIdentifiers?: readonly string[];
	/** RAM fraction to keep free (default 0.25 — the freeze-avoidance reserve). */
	reserveFraction?: number;
	/**
	 * §5.AL model-capability gate. The active suitability policy (global default, optionally project-overridden).
	 * A `reject` verdict REFUSES the load (no unload, no spawn) so a known-unsuitable model never wastes a run; a
	 * `warn`/`unknown` proceeds but the caveat is carried on the result. Defaults to the shipped warn-and-reject
	 * policy. Pass `{ onUnsuitable: "warn", onUnknown: "warn" }` (or "allow") to relax it.
	 */
	suitabilityPolicy?: ModelSuitabilityPolicy;
	/**
	 * The LM Link device the target loads on (its `lms ps`/`lms ls` DEVICE — "Local"/"desktop"/"laptop"). When
	 * set, the one-at-a-time unload is SCOPED to this device: residents on OTHER linked machines are left untouched
	 * (todo §5.AB per-machine concurrency — a workstation load must never evict a model the user is running on the laptop). When
	 * omitted, the legacy machine-union behavior is kept (unload every non-pinned, non-embedding resident).
	 */
	targetDevice?: string;
	/**
	 * The LM Link device identifier to make preferred while loading. LM Studio's `lms load -y` resolves duplicate model
	 * keys on the preferred linked device; this id is restored after the load attempt when the previous preferred id is
	 * observable. Pair with `targetDevice` (friendly DEVICE label) for scoped unloads and pass the target machine's own
	 * RAM as `totalRamBytes` so headroom is evaluated per machine.
	 */
	targetDeviceIdentifier?: string;
	/**
	 * GPU offload for the load (see {@link LmsLoadOptions.gpu}); default "max". A 0..1 ratio partially offloads — the
	 * lever for a small-VRAM linked box (e.g. the laptop's 8 GB dGPU) where a bigger model must spill to system RAM.
	 */
	gpu?: LmsLoadOptions["gpu"];
}

export interface LoadExclusiveResult {
	loaded: boolean;
	modelId: string;
	/** Identifiers unloaded to honor the one-at-a-time rule. */
	unloaded: string[];
	reason: string;
	/** The §5.AL capability verdict consulted for this load (so the caller can surface a warning even on success). */
	suitability: ModelSuitabilityVerdict;
}

/**
 * Make `modelId` the sole resident LLM, safely: unload every non-pinned, non-embedding model first (one-at-a-time),
 * then — only if the headroom guard approves — load it with the fixed context. Returns what was unloaded + whether the
 * load happened. A refused headroom check returns `loaded:false` with the reason (never loads). Idempotent: if the
 * target is already resident, it still clears the others and reports it resident.
 */
export async function loadModelExclusive(run: LmsRunner, input: LoadExclusiveInput): Promise<LoadExclusiveResult> {
	// §5.AL capability gate FIRST — before any unload/spawn — so a known-unsuitable model never costs us the
	// currently-resident good model nor a wasted load. A `reject` refuses outright; `warn`/`unknown` proceeds with
	// the caveat carried on the result for the caller to surface.
	const suitability = assessModelSuitability(
		input.modelId,
		input.suitabilityPolicy ?? DEFAULT_MODEL_SUITABILITY_POLICY,
	);
	if (suitability.severity === "reject") {
		return {
			loaded: false,
			modelId: input.modelId,
			unloaded: [],
			reason: `Refused by the model-capability gate: ${suitability.reason}`,
			suitability,
		};
	}

	const pinned = new Set(input.pinnedIdentifiers ?? []);
	const resident = await listResidentModels(run);
	const targetAlreadyResident = resident.some((model) => model.identifier === input.modelId);
	let preferredChanged = false;
	let previousPreferredDeviceIdentifier: string | null = null;

	if (!targetAlreadyResident && input.targetDeviceIdentifier) {
		const linkDevices = await fetchLmsLinkDevices(run);
		previousPreferredDeviceIdentifier = linkDevices.preferredDeviceIdentifier;
		if (previousPreferredDeviceIdentifier !== input.targetDeviceIdentifier) {
			const { stdout, exitCode } = await run(["link", "set-preferred-device", input.targetDeviceIdentifier]);
			if (exitCode !== 0) {
				return {
					loaded: false,
					modelId: input.modelId,
					unloaded: [],
					reason: `Failed to set LM Link preferred device ${input.targetDeviceIdentifier}: ${stdout.slice(0, 200)}`,
					suitability,
				};
			}
			preferredChanged = true;
		}
	}

	try {
		const unloaded: string[] = [];
		for (const model of resident) {
			if (model.identifier === input.modelId || pinned.has(model.identifier) || isEmbeddingModel(model.identifier)) {
				continue;
			}
			// Per-machine scoping: with a known target device, only clear residents on the SAME device — never evict a model
			// running on another linked box (a resident whose device is unknown is left alone under scoping, to be safe).
			if (input.targetDevice !== undefined && model.device !== input.targetDevice) {
				continue;
			}
			await run(buildLmsUnloadArgs(model.identifier));
			unloaded.push(model.identifier);
		}

		if (targetAlreadyResident) {
			return {
				loaded: true,
				modelId: input.modelId,
				unloaded,
				reason: "Already resident; cleared other models.",
				suitability,
			};
		}

		// After unload, the only resident bytes left are the kept (pinned + embedding) models.
		const keptResidentBytes = resident
			.filter((model) => pinned.has(model.identifier) || isEmbeddingModel(model.identifier))
			.filter((model) => input.targetDevice === undefined || model.device === input.targetDevice)
			.reduce((total, model) => total + (model.sizeBytes ?? 0), 0);

		const decision = decideModelLoad({
			candidateSizeBytes: input.candidateSizeBytes ?? DEFAULT_CANDIDATE_SIZE_BYTES,
			residentSizeBytes: keptResidentBytes,
			totalRamBytes: input.totalRamBytes,
			// Explicit budget wins; otherwise honor a power-user env cap (NKLEIN_MAX_RAM_BUDGET_GB) so "use ≤N GB" works today.
			userBudgetBytes: input.userBudgetBytes ?? resolveRamBudgetBytesFromEnv(),
			reserveFraction: input.reserveFraction,
		});
		if (!decision.allow) {
			return { loaded: false, modelId: input.modelId, unloaded, reason: decision.reason, suitability };
		}

		// §5.AQ-G context right-sizing: opt-in (taskNeededTokens + maxContextLength) → fit the task within [floor, max];
		// otherwise the existing fixed-context behavior. Inert by default (no existing caller passes taskNeededTokens).
		// F12.68: the engine context is a SHARED budget across parallel slots — multiply the per-session plan by the
		// concurrency this instance will serve, and surface the mis-fit when the model max can't cover slots × floor.
		const slotPlan =
			input.taskNeededTokens !== undefined && input.maxContextLength !== undefined
				? planSharedSlotLoadContextLength({
						taskNeededTokens: input.taskNeededTokens,
						maxContextLength: input.maxContextLength,
						minContextFloor: MIN_CONTEXT_WINDOW_TOKENS,
						concurrentSlots: input.concurrentSlots ?? 1,
					})
				: null;
		const loadContextLength = slotPlan?.contextLength ?? input.contextLength ?? DEFAULT_CONTEXT_LENGTH;
		const argv = buildLmsLoadArgs(input.modelId, {
			contextLength: loadContextLength,
			maxContextLength: input.maxContextLength,
			gpu: input.gpu ?? "max",
		});
		const { stdout, exitCode } = await run(argv);
		// On a successful load, fold any warn/unknown caveat into the reason so the caller sees it without re-querying.
		const slotCaveat =
			slotPlan !== null && slotPlan.perSlotUnderFloor
				? ` [context ${loadContextLength} shared across ${input.concurrentSlots} slot(s) = ${slotPlan.perSlotContextLength}/slot < the ${MIN_CONTEXT_WINDOW_TOKENS} floor — lower this model's concurrency cap to ≤${slotPlan.maxSlotsAtFloor}]`
				: "";
		const caveat =
			(suitability.severity === "ok" ? "" : ` [capability ${suitability.severity}: ${suitability.reason}]`) +
			slotCaveat;
		return {
			loaded: exitCode === 0,
			modelId: input.modelId,
			unloaded,
			reason:
				exitCode === 0
					? `Loaded (${decision.reason})${caveat}`
					: `lms load failed (exit ${exitCode}): ${stdout.slice(0, 200)}`,
			suitability,
		};
	} finally {
		if (preferredChanged && previousPreferredDeviceIdentifier) {
			try {
				await run(["link", "set-preferred-device", previousPreferredDeviceIdentifier]);
			} catch {
				// Best-effort cleanup only: never hide the load/headroom/unload result behind an LM Link restore failure.
			}
		}
	}
}

/**
 * §5.AN REST-transport twin of {@link loadModelExclusive}: identical hard guardrails (capability gate first,
 * one-resident-at-a-time unload, headroom check, ≥32k context floor capped to the model max) over the in-process
 * `/api/v1/models` client instead of `lms` spawns. LOCAL-ONLY by construction — the REST surface has no LM Link
 * device or gpu-offload levers, so remote/GPU loads stay on the CLI path. One honesty gain over the CLI twin: the
 * REST list carries every model's real `size_bytes`, so the headroom check uses the true candidate size instead of
 * the conservative 16 GiB default whenever the caller doesn't supply one.
 */
export interface RestLoadExclusiveInput {
	/** The model KEY to make the sole resident LLM (the `/api/v1/models` `key`). */
	modelId: string;
	/** Host RAM in bytes (e.g. `os.totalmem()`). */
	totalRamBytes: number;
	/** Optional user-declared RAM budget cap in bytes (see {@link LoadExclusiveInput.userBudgetBytes}). */
	userBudgetBytes?: number;
	/** Context window to load with (default 40000; floored to ≥32k, capped to the model's listed max). */
	contextLength?: number;
	/** Model keys to NEVER unload (the user's pinned set; embeddings are auto-kept regardless). */
	pinnedIdentifiers?: readonly string[];
	/** RAM fraction to keep free (default 0.25 — the freeze-avoidance reserve). */
	reserveFraction?: number;
	/** §5.AL capability gate policy (see {@link LoadExclusiveInput.suitabilityPolicy}). */
	suitabilityPolicy?: ModelSuitabilityPolicy;
}

export async function loadModelExclusiveViaRest(
	client: LmStudioRestModelClient,
	input: RestLoadExclusiveInput,
): Promise<LoadExclusiveResult> {
	// §5.AL capability gate FIRST — same as the CLI twin: a known-unsuitable model never costs the resident one.
	const suitability = assessModelSuitability(
		input.modelId,
		input.suitabilityPolicy ?? DEFAULT_MODEL_SUITABILITY_POLICY,
	);
	if (suitability.severity === "reject") {
		return {
			loaded: false,
			modelId: input.modelId,
			unloaded: [],
			reason: `Refused by the model-capability gate: ${suitability.reason}`,
			suitability,
		};
	}

	const listed = await client.listModels();
	if (!listed.ok) {
		return {
			loaded: false,
			modelId: input.modelId,
			unloaded: [],
			reason: `LM Studio REST list failed (${listed.error.type}): ${listed.error.message}`,
			suitability,
		};
	}
	const pinned = new Set(input.pinnedIdentifiers ?? []);
	const resident = listed.value.filter((model) => model.loadedInstanceIds.length > 0);
	const target = listed.value.find((model) => model.key === input.modelId);
	const targetAlreadyResident = resident.some((model) => model.key === input.modelId);

	const unloaded: string[] = [];
	for (const model of resident) {
		if (model.key === input.modelId || pinned.has(model.key) || isEmbeddingModel(model.key)) {
			continue;
		}
		for (const instanceId of model.loadedInstanceIds) {
			const result = await client.unloadModel({ instanceId });
			if (!result.ok) {
				return {
					loaded: false,
					modelId: input.modelId,
					unloaded,
					reason: `Unload of ${model.key} failed (${result.error.type}): ${result.error.message}`,
					suitability,
				};
			}
		}
		unloaded.push(model.key);
	}

	if (targetAlreadyResident) {
		return {
			loaded: true,
			modelId: input.modelId,
			unloaded,
			reason: "Already resident; cleared other models.",
			suitability,
		};
	}

	const keptResidentBytes = resident
		.filter((model) => pinned.has(model.key) || isEmbeddingModel(model.key))
		.reduce((total, model) => total + (model.sizeBytes ?? 0), 0);
	const decision = decideModelLoad({
		candidateSizeBytes: target?.sizeBytes ?? DEFAULT_CANDIDATE_SIZE_BYTES,
		residentSizeBytes: keptResidentBytes,
		totalRamBytes: input.totalRamBytes,
		userBudgetBytes: input.userBudgetBytes ?? resolveRamBudgetBytesFromEnv(),
		reserveFraction: input.reserveFraction,
	});
	if (!decision.allow) {
		return { loaded: false, modelId: input.modelId, unloaded, reason: decision.reason, suitability };
	}

	// Same context discipline as the CLI argv builder: floor to the ≥32k invariant, cap to the model's capability.
	const floored = Math.max(MIN_CONTEXT_WINDOW_TOKENS, input.contextLength ?? DEFAULT_CONTEXT_LENGTH);
	const contextLength = target?.maxContextLength != null ? Math.min(floored, target.maxContextLength) : floored;
	const loadResult = await client.loadModel({ model: input.modelId, contextLength });
	const caveat = suitability.severity === "ok" ? "" : ` [capability ${suitability.severity}: ${suitability.reason}]`;
	if (!loadResult.ok) {
		return {
			loaded: false,
			modelId: input.modelId,
			unloaded,
			reason: `REST load failed (${loadResult.error.type}): ${loadResult.error.message}`,
			suitability,
		};
	}
	return {
		loaded: true,
		modelId: input.modelId,
		unloaded,
		reason: `Loaded via REST in ${loadResult.value.loadTimeSeconds ?? "?"}s (${decision.reason})${caveat}`,
		suitability,
	};
}
