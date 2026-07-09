/**
 * "Only use ALREADY-LOADED models — never trigger a load" (user directive, 2026-06-28). Requesting an inference for a
 * model LM Studio hasn't loaded makes it auto-load that model (consuming RAM/VRAM, risking an out-of-resources freeze) —
 * which is the USER's call, not ours. This module reads LM Studio's enhanced `/api/v0/models` (which carries a per-model
 * `state` of `loaded` | `not-loaded`) so callers can restrict themselves to the resident set: the verify harnesses
 * **refuse** to run against a non-loaded model, and the runtime's model selection should likewise only pick loaded ones.
 *
 * Pure parser + injectable fetch so it's testable without a live endpoint. Checking availability is fine; loading is not.
 */

import type { LmsPsModel } from "./lms-ps-json";
import { modelDiscoveryCacheTtlMs } from "./model-discovery-throttle";

interface LmStudioApiV0Model {
	id?: unknown;
	state?: unknown;
}

/** Extract the ids of models whose `state` is `loaded` from an `/api/v0/models` payload (tolerant of shape). */
export function parseLoadedModelIds(payload: unknown): string[] {
	const data = Array.isArray(payload)
		? payload
		: payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
			? ((payload as { data: unknown[] }).data ?? [])
			: [];
	const ids: string[] = [];
	for (const entry of data) {
		if (entry && typeof entry === "object") {
			const model = entry as LmStudioApiV0Model;
			if (model.state === "loaded" && typeof model.id === "string" && model.id.length > 0) {
				ids.push(model.id);
			}
		}
	}
	return ids;
}

function addLoadedModelId(ids: Set<string>, value: string | null | undefined): void {
	const id = value?.trim();
	if (id) {
		ids.add(id);
	}
}

/**
 * LM Studio's REST `/api/v0/models` endpoint is the normal no-load guard source, but LM-Link resident models can be
 * visible only through `lms ps --json`. Treat every addressable `lms ps` identity as resident evidence so configured
 * role/pool models on linked hosts are not filtered out while still never triggering a load.
 */
export function loadedModelIdsFromLmsPsModels(models: readonly LmsPsModel[]): string[] {
	const ids = new Set<string>();
	for (const model of models) {
		addLoadedModelId(ids, model.identifier);
		addLoadedModelId(ids, model.modelKey);
		addLoadedModelId(ids, model.indexedModelIdentifier);
		addLoadedModelId(ids, model.path);
	}
	return [...ids];
}

export function mergeLoadedModelIds(...sources: readonly (readonly string[])[]): string[] {
	const ids = new Set<string>();
	for (const source of sources) {
		for (const value of source) {
			addLoadedModelId(ids, value);
		}
	}
	return [...ids];
}

/** Map an OpenAI-style base URL (`http://host:port/v1`) to LM Studio's enhanced `/api/v0/models` URL. */
export function lmStudioApiV0ModelsUrl(baseUrl: string): string {
	const root = baseUrl.trim().replace(/\/+$/u, "").replace(/\/v1$/u, "");
	return `${root}/api/v0/models`;
}

/**
 * Fetch the ids of currently LOADED (resident) models from LM Studio. Returns `[]` on any failure (caller decides how to
 * treat "unknown" — the harness treats it as "can't confirm loaded" and refuses). Never triggers a load (read-only GET).
 */
export async function fetchLoadedModelIds(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
	try {
		// Bounded so it can never hang a hot path (e.g. task start) on an unreachable endpoint.
		const res = await fetchImpl(lmStudioApiV0ModelsUrl(baseUrl), {
			signal: AbortSignal.timeout(3_000),
		});
		if (!res.ok) {
			return [];
		}
		return parseLoadedModelIds(await res.json());
	} catch {
		return [];
	}
}

// Shared TTL cache for the loaded-set, keyed by endpoint URL — so a hot path that residency-checks repeatedly (a
// multi-card run starting/retrying many cards) polls `/api/v0/models` at most ~once per window instead of per call.
// The 2026-06-28 hammering throttle covered the chat/roster `/models` discovery but NOT this residency path (added
// later for the no-load enforcement) — this closes that gap. Disabled (TTL 0) under the test runner, like the others.
const loadedIdsCache = new Map<string, { ids: string[]; at: number }>();

/**
 * TTL-cached {@link fetchLoadedModelIds} — same result, but reuses a recent fetch within the shared
 * `modelDiscoveryCacheTtlMs` window so repeated residency checks don't hammer `/api/v0/models`. Use this on hot paths
 * (task-start fan-out, role pools); a one-shot check can call `fetchLoadedModelIds` directly.
 */
export async function fetchLoadedModelIdsCached(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
	const ttl = modelDiscoveryCacheTtlMs();
	if (ttl <= 0) {
		return fetchLoadedModelIds(baseUrl, fetchImpl);
	}
	const key = lmStudioApiV0ModelsUrl(baseUrl);
	const now = Date.now();
	const hit = loadedIdsCache.get(key);
	if (hit && now - hit.at < ttl) {
		return hit.ids;
	}
	const ids = await fetchLoadedModelIds(baseUrl, fetchImpl);
	loadedIdsCache.set(key, { ids, at: now });
	return ids;
}

/**
 * Decide whether to BLOCK using `modelId` because it isn't resident — pure + lenient: block ONLY when we positively know
 * the loaded set and it lacks the model (an empty/unknown loaded set ⇒ allow, so a missing endpoint never wedges things).
 */
export function shouldBlockUnloadedModel(modelId: string, loadedIds: readonly string[]): boolean {
	return loadedIds.length > 0 && !loadedIds.includes(modelId);
}

/**
 * Throw unless `modelId` is currently loaded — the "do not load models" guard for the verify harnesses. The error names
 * the loaded set so the operator can pick one (or load the wanted model themselves).
 */
export async function assertModelLoaded(
	baseUrl: string,
	modelId: string,
	fetchImpl: typeof fetch = fetch,
): Promise<void> {
	const loaded = await fetchLoadedModelIds(baseUrl, fetchImpl);
	if (!loaded.includes(modelId)) {
		throw new Error(
			`Model "${modelId}" is not loaded in LM Studio (loaded: ${loaded.join(", ") || "none"}). ` +
				"This harness does NOT load models (that's the user's call) — load it in LM Studio first, or target an already-loaded model.",
		);
	}
}
