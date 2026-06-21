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
	return {
		enabled: isTruthyEnv(env.NKLEIN_CORE_PY),
		sidecarUrl: env.NKLEIN_CORE_PY_URL?.trim() || DEFAULT_SIDECAR_URL,
	};
}
