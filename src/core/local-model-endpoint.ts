/**
 * The default local model-server endpoint (todo §5.U — consolidates a magic URL that was hardcoded ~8x across the
 * codebase, alongside an existing but under-used `DEFAULT_LOCAL_CHAT_BASE_URL`). This is LM Studio's OpenAI-compatible
 * API on the loopback default port, used as the fallback base URL whenever no provider/endpoint is configured (worker
 * launch residency, reviewer + speculative-mirror model selection, chat). One named source of truth so the default
 * can't drift between call sites.
 *
 * This is the `127.0.0.1` (direct-IP) form. Per David's 2026-07-07 decision, the former `localhost:1234/v1` fallbacks
 * (runtime-api, local-advisor-completion, dev) were unified onto this constant — one loopback default everywhere. The
 * remaining `http://localhost:1234` mentions are a different shape (no `/v1`: the dev CLI's `--endpoint` base + doc
 * examples) and are intentionally left.
 */
export const DEFAULT_LOCAL_MODEL_BASE_URL = "http://127.0.0.1:1234/v1";

/**
 * The default base URL, HERMETICITY-AWARE (N10 follow-up, 2026-07-26). A simulated/nightly runtime exports
 * `NKLEIN_NIGHTLY_MODEL_GATEWAY_URL` (the in-process aimock origin); until now that env was only N4 hermetic
 * EVIDENCE, not an actual override — so every "no configured endpoint → default gateway" fallback (reviewer
 * resolution, loaded-model views, advisor completions) silently consulted the REAL LM Studio gateway from inside a
 * supposedly hermetic run (live-found: a sim cell's rescue reviewer resolved to the real loaded `qwen/qwen3-8b`
 * via `loaded_fallback`). Every runtime network fallback must resolve through this function; the bare constant
 * remains only as the production default it resolves to.
 */
export function resolveDefaultLocalModelBaseUrl(): string {
	return process.env.NKLEIN_NIGHTLY_MODEL_GATEWAY_URL?.trim() || DEFAULT_LOCAL_MODEL_BASE_URL;
}
