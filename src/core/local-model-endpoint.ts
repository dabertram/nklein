/**
 * The default local model-server endpoint (todo §5.U — consolidates a magic URL that was hardcoded ~8x across the
 * codebase, alongside an existing but under-used `DEFAULT_LOCAL_CHAT_BASE_URL`). This is LM Studio's OpenAI-compatible
 * API on the loopback default port, used as the fallback base URL whenever no provider/endpoint is configured (worker
 * launch residency, reviewer + speculative-mirror model selection, chat). One named source of truth so the default
 * can't drift between call sites.
 *
 * NOTE: this is the `127.0.0.1` form. A handful of other call sites still hardcode the `localhost:1234/v1` form; whether
 * to unify `localhost` and `127.0.0.1` (they differ in DNS-vs-direct-IP resolution) is a separate config decision, not
 * folded in here.
 */
export const DEFAULT_LOCAL_MODEL_BASE_URL = "http://127.0.0.1:1234/v1";
