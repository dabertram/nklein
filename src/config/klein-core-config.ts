/**
 * Feature flag + endpoint for the !Klein Python core sidecar (`core-py`).
 *
 * Phase 0/1 of the polyglot migration: the Python core is opt-in via `NKLEIN_CORE_PY` and defaults OFF, so the
 * TS runtime behaves exactly as today until a deployment enables it. When enabled, structured-generation
 * callers route through `KleinCoreClient` (with the existing `LocalLlmClient` as fallback).
 */

export interface KleinCorePyConfig {
	enabled: boolean;
	sidecarUrl: string;
}

const DEFAULT_SIDECAR_URL = "http://127.0.0.1:3585";

function isTruthyEnv(value: string | undefined): boolean {
	if (!value) {
		return false;
	}
	const normalized = value.trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

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
		return { reachable: response.ok, sidecarUrl: config.sidecarUrl };
	} catch {
		return { reachable: false, sidecarUrl: config.sidecarUrl };
	} finally {
		clearTimeout(timeout);
	}
}
