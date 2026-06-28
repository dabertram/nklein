/**
 * "Only use ALREADY-LOADED models — never trigger a load" (user directive, 2026-06-28). Requesting an inference for a
 * model LM Studio hasn't loaded makes it auto-load that model (consuming RAM/VRAM, risking an out-of-resources freeze) —
 * which is the USER's call, not ours. This module reads LM Studio's enhanced `/api/v0/models` (which carries a per-model
 * `state` of `loaded` | `not-loaded`) so callers can restrict themselves to the resident set: the verify harnesses
 * **refuse** to run against a non-loaded model, and the runtime's model selection should likewise only pick loaded ones.
 *
 * Pure parser + injectable fetch so it's testable without a live endpoint. Checking availability is fine; loading is not.
 */

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
		const res = await fetchImpl(lmStudioApiV0ModelsUrl(baseUrl));
		if (!res.ok) {
			return [];
		}
		return parseLoadedModelIds(await res.json());
	} catch {
		return [];
	}
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
