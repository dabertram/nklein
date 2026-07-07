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
