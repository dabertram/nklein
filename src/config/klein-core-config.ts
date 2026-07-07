/**
 * Feature flag + endpoint for the !Klein Python core sidecar (`core-py`).
 *
 * The Python core defaults **ON (opt-out via `NKLEIN_CORE_PY=0`)**: when reachable, structured-generation /
 * embedding callers route through `KleinCoreClient`, and every caller falls back instantly to the in-process
 * `LocalLlmClient` path on any error (an absent localhost sidecar is an immediate ECONNREFUSED). The runtime
 * **auto-starts** the sidecar on boot (see `src/server/klein-core-sidecar.ts`, todo §5.H), so the default actually
 * delivers without the user launching it by hand.
 */

import { isTruthyEnv } from "../core/env-flag";

export interface KleinCorePyConfig {
	enabled: boolean;
	sidecarUrl: string;
}

const DEFAULT_SIDECAR_URL = "http://127.0.0.1:3585";

export function resolveKleinCorePyConfig(env: NodeJS.ProcessEnv = process.env): KleinCorePyConfig {
	const raw = env.NKLEIN_CORE_PY;
	return {
		// Default ON (opt-out): the sidecar is used when reachable, and every structured-generation / embedding
		// caller falls back instantly to the in-process path on any error — an absent localhost sidecar is an
		// immediate ECONNREFUSED, not a timeout. Set NKLEIN_CORE_PY=0/false to force it off. (Follow-up: a hung —
		// reachable-but-slow — sidecar waits the request timeout before falling back; a startup /health gate would
		// harden that edge.)
		enabled: raw === undefined ? true : isTruthyEnv(raw),
		sidecarUrl: env.NKLEIN_CORE_PY_URL?.trim() || DEFAULT_SIDECAR_URL,
	};
}

export interface KleinCorePyHealth {
	reachable: boolean;
	sidecarUrl: string;
	/** GGUF embedding models resident in the core right now (absolute paths; [] until an index batch loads one). */
	loadedModels: string[];
}

/**
 * Probe the Python core sidecar's `GET /health` with a short timeout so Settings (and a future startup gate)
 * can show whether the core is actually up. Never throws — an unreachable sidecar resolves to `reachable: false`.
 */
export async function probeKleinCorePyHealth(input?: {
	config?: KleinCorePyConfig;
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
}): Promise<KleinCorePyHealth> {
	const config = input?.config ?? resolveKleinCorePyConfig();
	const fetchImpl = input?.fetchImpl ?? fetch;
	const url = `${config.sidecarUrl.replace(/\/+$/u, "")}/health`;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), input?.timeoutMs ?? 1_500);
	try {
		const response = await fetchImpl(url, { signal: controller.signal });
		// Best-effort body parse: the core reports its resident embedding models as `loaded_models` (older cores /
		// malformed bodies simply yield [] — reachability never depends on the body shape).
		let loadedModels: string[] = [];
		if (response.ok) {
			try {
				const body = (await response.json()) as { loaded_models?: unknown };
				if (Array.isArray(body.loaded_models)) {
					loadedModels = body.loaded_models.filter((entry): entry is string => typeof entry === "string");
				}
			} catch {
				// non-JSON body — keep [] (reachable is still what the status code says).
			}
		}
		return { reachable: response.ok, sidecarUrl: config.sidecarUrl, loadedModels };
	} catch {
		return { reachable: false, sidecarUrl: config.sidecarUrl, loadedModels: [] };
	} finally {
		clearTimeout(timeout);
	}
}
