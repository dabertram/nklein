/**
 * The single throttle policy for live `/models` catalog discovery (todo §4A; 2026-06-28 hammering incident).
 *
 * Both discovery paths — the roster (`nklein-provider-service.ts`) and the chat model-resolver (`local-chat-model.ts`)
 * — TTL-cache their `/models` lookups so the local catalog endpoint (LM Studio `/api/v0/models`) is polled at most
 * ~once per window, not per caller-invocation. This module owns the ONE knob so the two sites can't drift: the env
 * override `NKLEIN_MODEL_DISCOVERY_CACHE_TTL_MS` (`0` disables), a 30 s default, and a disable-under-test-runner rule
 * (so per-test fetch mocks aren't shadowed by a shared cache).
 */

const DEFAULT_MODEL_DISCOVERY_CACHE_TTL_MS = 30_000;

/** Resolve the model-discovery cache TTL (ms). `0` ⇒ caching disabled. */
export function modelDiscoveryCacheTtlMs(): number {
	const raw = Number(process.env.NKLEIN_MODEL_DISCOVERY_CACHE_TTL_MS);
	if (Number.isFinite(raw) && raw >= 0) {
		return Math.trunc(raw);
	}
	if (process.env.VITEST || process.env.NODE_ENV === "test") {
		return 0;
	}
	return DEFAULT_MODEL_DISCOVERY_CACHE_TTL_MS;
}
