/**
 * LM Studio liveness probe (todo §5.AN — the "never assume silence = death" guard, user 2026-06-30).
 *
 * The PREFILL phase emits no stream tokens, so a long cold prefill looks "silent" to !Klein even though the model is
 * actively working. The primary defence is ultra-long timeouts (don't kill a working model — see autonomous-timeout-
 * defaults). This module adds the OPTIONAL, AUTO-DETECTED complement: when the model host exposes LM Studio's native API,
 * we can read whether the model is still RESIDENT and fail FAST on a real death (crash / unload under memory pressure)
 * instead of waiting out the ultra-long timeout. It works LOCAL or over NETWORK — the native URL derives from the model's
 * own `baseUrl` ({@link lmStudioApiV0ModelsUrl}), so wherever !Klein reaches the model it can reach this probe.
 *
 * IMPORTANT — this is a COARSE liveness signal: `/api/v0/models` reports residency (`loaded`/`not-loaded`) but NOT the
 * live `PROCESSINGPROMPT`/`GENERATING` activity that `lms ps` shows (verified 2026-06-30: `state` stays `loaded` through
 * inference). So "resident" means "the model is still loaded" (alive, possibly prefilling) — it does NOT prove it is
 * actively processing THIS request. Use it to fail-fast on `absent`, never to PROLONG a kill (a hung-but-resident model
 * is the ultra-long timeout's job). The richer activity signal is `/api/v1/chat` prompt-processing events — a later step.
 *
 * Pure + injectable fetch ⇒ unit-testable without a live endpoint.
 */

import { lmStudioApiV0ModelsUrl, parseLoadedModelIds } from "./lmstudio-loaded-models";

/**
 * - `resident`     — LM Studio reachable AND the model is in its loaded set (alive; may be prefilling/generating).
 * - `absent`       — LM Studio reachable but the model is NOT loaded → it crashed / was unloaded (memory pressure).
 * - `unobservable` — the host is not LM Studio, or unreachable (plain OpenAI server / llama.cpp / vLLM / down) ⇒ the
 *                    caller CANNOT use this advanced observation and must rely on its timeout (be transparent to the user).
 */
export type ModelLiveness = "resident" | "absent" | "unobservable";

/** Does this payload have LM Studio's native `/api/v0/models` shape (`{ data: [...] }`)? Distinguishes it from a 404 body. */
function isLmStudioModelsPayload(payload: unknown): payload is { data: unknown[] } {
	return typeof payload === "object" && payload !== null && Array.isArray((payload as { data?: unknown }).data);
}

/**
 * Probe whether `modelId` is currently resident on its host's LM Studio native API. Read-only GET, bounded so it can
 * never hang the caller; any failure / non-LM-Studio shape ⇒ `unobservable` (the safe "can't tell" verdict — the caller
 * then falls back to its timeout, never killing on an unconfirmed signal).
 */
export async function probeModelResidency(
	baseUrl: string,
	modelId: string,
	fetchImpl: typeof fetch = fetch,
	timeoutMs = 3_000,
): Promise<ModelLiveness> {
	let payload: unknown;
	try {
		const res = await fetchImpl(lmStudioApiV0ModelsUrl(baseUrl), { signal: AbortSignal.timeout(timeoutMs) });
		if (!res.ok) {
			return "unobservable"; // 404 (not LM Studio) / 5xx — can't observe.
		}
		payload = await res.json();
	} catch {
		return "unobservable"; // unreachable / network error / non-JSON.
	}
	if (!isLmStudioModelsPayload(payload)) {
		return "unobservable"; // reachable but not the LM Studio native shape.
	}
	return parseLoadedModelIds(payload).includes(modelId) ? "resident" : "absent";
}

/**
 * Auto-detect whether the model host exposes the LM Studio native API at all (so the caller can ENABLE the advanced
 * liveness observation when available and be TRANSPARENT that it isn't otherwise). True when a probe returns a definite
 * residency verdict (`resident`/`absent`), false when `unobservable`. (A model id that is genuinely loaded yields
 * `resident`; pass a known-loaded id, e.g. the one being used, for the most reliable detection.)
 */
export async function isLmStudioHostObservable(
	baseUrl: string,
	modelId: string,
	fetchImpl: typeof fetch = fetch,
	timeoutMs = 3_000,
): Promise<boolean> {
	return (await probeModelResidency(baseUrl, modelId, fetchImpl, timeoutMs)) !== "unobservable";
}

export interface ResidencyAbortPolicy {
	/** Consecutive TRAILING `absent` probes required to conclude the model is gone — ≥2 rides out a transient blip. */
	absentConfirmations: number;
}

/**
 * PURE decision core for the §5.AN "fail-fast on a dead model" heartbeat: given the ordered residency probes taken during
 * an ultra-long wait (oldest → newest), decide whether to ABORT because the model crashed / was unloaded. Deliberately
 * conservative — it aborts ONLY when (a) the model was POSITIVELY observed `resident` at some point (so we're not acting
 * on a host we simply can't observe), AND (b) the last `absentConfirmations` probes are all `absent`. An `unobservable`
 * probe (host briefly unreachable / not LM Studio) is NEVER treated as death: it breaks the trailing-absent run, so a
 * network blip can't trigger a false abort. This never PROLONGS a wait — a hung-but-resident model is the timeout's job.
 */
export function shouldAbortForLostResidency(probes: readonly ModelLiveness[], policy: ResidencyAbortPolicy): boolean {
	const needed = Math.max(1, Math.trunc(policy.absentConfirmations));
	if (!probes.includes("resident")) {
		return false; // never confirmed alive ⇒ don't act on this signal (rely on the timeout)
	}
	let trailingAbsent = 0;
	for (let i = probes.length - 1; i >= 0; i -= 1) {
		if (probes[i] === "absent") {
			trailingAbsent += 1;
		} else {
			break; // a `resident` or `unobservable` probe breaks the run — we can't confirm death
		}
	}
	return trailingAbsent >= needed;
}

export interface ResidencyHeartbeatHandle {
	/** Stop polling (idempotent) — call on session end / stream resume so the heartbeat never outlives its session. */
	stop: () => void;
}

export interface ResidencyHeartbeatOptions {
	/** Probe the model's residency (typically `() => probeModelResidency(baseUrl, modelId)`). */
	probe: () => Promise<ModelLiveness>;
	/** How many consecutive trailing `absent` probes confirm death (see {@link shouldAbortForLostResidency}). */
	policy: ResidencyAbortPolicy;
	/** Poll interval (ms). */
	intervalMs: number;
	/** Fired ONCE when death is confirmed — the caller aborts the session (fail-fast). Polling stops itself first. */
	onModelLost: () => void;
	/** Injectable timers so the loop is unit-testable without wall-clock waits. */
	setIntervalFn?: (callback: () => void, ms: number) => ReturnType<typeof setInterval>;
	clearIntervalFn?: (handle: ReturnType<typeof setInterval>) => void;
}

/**
 * The §5.AN residency HEARTBEAT: poll {@link ResidencyHeartbeatOptions.probe} on an interval and, once
 * {@link shouldAbortForLostResidency} confirms the model crashed/unloaded, fire `onModelLost` ONCE (the caller aborts the
 * session — fail-fast instead of waiting out the ultra-long timeout). Effectful (timers), but the timers are injectable
 * so it is fully unit-testable. A probe that throws is treated as `unobservable` (never a false death — see the decision
 * core). `stop()` is idempotent; the loop halts itself before firing `onModelLost`.
 */
export function startResidencyHeartbeat(options: ResidencyHeartbeatOptions): ResidencyHeartbeatHandle {
	const probes: ModelLiveness[] = [];
	const setIntervalFn = options.setIntervalFn ?? setInterval;
	const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
	let active = true;
	const timer = setIntervalFn(() => {
		void tick();
	}, options.intervalMs);
	const halt = (): void => {
		if (active) {
			active = false;
			clearIntervalFn(timer);
		}
	};
	async function tick(): Promise<void> {
		if (!active) {
			return;
		}
		let result: ModelLiveness;
		try {
			result = await options.probe();
		} catch {
			result = "unobservable"; // a failed probe never counts as death
		}
		if (!active) {
			return; // stopped while awaiting the probe
		}
		probes.push(result);
		if (shouldAbortForLostResidency(probes, options.policy)) {
			halt();
			options.onModelLost();
		}
	}
	return { stop: halt };
}
