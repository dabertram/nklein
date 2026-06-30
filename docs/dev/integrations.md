# Integrations registry

> The single place that tracks **every external thing !Klein integrates** — engines, model hosts, CLIs, MCP servers,
> services. Maintained per the §4A rule ("web-search the ecosystem; integrate properly rather than reinvent"): whenever
> we adopt, evaluate, or drop an integration, **update this table** (name · what · why · status · license · #1 egress
> posture · where it's wired). Keep it honest — `partial`/`evaluating` are first-class statuses, not failures.

## Status legend

`integrated` = wired + in use · `partial` = some pieces built, wiring incomplete · `evaluating` = under assessment, not
adopted · `planned` = decided, not started · `dropped` = evaluated + rejected (say why).

## Registry

| integration | what it is | status | license | #1 / egress | where it's wired |
|---|---|---|:-:|---|---|
| **Cline SDK** | the vendored agent engine (`@cline/*`) — the loop/tools/streaming base | `integrated` | Apache-2.0 | local; cloud code present-but-disabled | `vendor/cline-sdk/` (built from source); §4A "Cline SDK" |
| **LM Studio** | local model host — OpenAI-compat `/v1` + native `/api/v0`,`/api/v1` + the `lms` CLI | `integrated` | proprietary (local app) | local-only (`:1234`, or LAN-linked machines) | `lmstudio-loaded-models.ts`, `lms-model-runner`, the provider service; §5.AN maps the full API surface |
| **llmfit** | LLM fit/speed/quality scorer + ~4757-model HF DB (`fit`/`recommend`/`search`/`info --json`) | `partial` | MIT | local CLI via `uvx` (no install); HF-DB refresh is OUTBOUND → egress-gated | `llmfit-adapter.ts` (parse), `llmfit-runner.ts` (`uvx llmfit`), `model-load-headroom.ts` (fit gate), `llmfit-roster.ts` (roster), `llmfit-capability-prior.ts` (cold-start prior bridge). The decompose path now feeds a **cold-start prior** into `buildLoadedModelRoutingCandidates` so a never-observed loaded model is ranked by its card — but that prior currently comes from the **§5.AL catalog** (`build-decomposition-routing-candidates.ts` `catalogCapabilityPrior`), fast + always-available. **PENDING:** chain llmfit's own score *ahead* of the catalog in that resolver (needs cached llmfit output, not a per-decompose subprocess) + the roster orchestration (opt-in load control) + **catalog-freshness check** (user, 2026-07-01): periodically check whether a newer llmfit model DB is available and let the user trigger the update — the LLM landscape moves fast, so a stale ~4757-model snapshot silently rots. The refresh is OUTBOUND (HF DB) ⇒ **egress-gated + opt-in** per prime-directive #1, never auto-applied; only the *check* + a user-confirmed update |
| **uv / uvx** | Python runner — runs llmfit ephemerally from the uv cache (no permanent install) | `integrated` | Apache-2.0/MIT | local; first run fetches llmfit from PyPI (one-time) | `llmfit-runner.ts` default `{ bin: "uvx", prefixArgs: ["llmfit"] }` |
| **nomic-embed-text v1.5** | local embedding model for the code index | `integrated` | Apache-2.0 | local (served by LM Studio) | the code-embedding provider; `nklein-code-index.ts` |
| **MCP servers (generic)** | user-configured Model-Context-Protocol tool servers the agent can call | `integrated` (host) | per-server | per-server (HTTPS MCP gated by §5.L / the tool-capability manifest) | `nklein-mcp-runtime-service.ts`; the runtime-settings MCP panel |
| **codebase-memory-mcp** | MCP server ([DeusData](https://github.com/DeusData/codebase-memory-mcp)) for codebase memory / symbol localization | `evaluating` | check upstream | local MCP (verify) | candidate **LocalizationProvider backing** — evaluate BEFORE building a custom lookup (todo.md §5.B L1166, §5.U L247) |

## Notes

- **Prime directive #1 (local-only):** an integration's *runtime* path must stay local; any OUTBOUND feature (llmfit's
  HF-DB refresh / leaderboard, an MCP server's network egress, online research §5.AC) is **egress-gated + opt-in**, never
  silently on. Record the posture in the table.
- **"Evaluate before building custom" (§4A):** `codebase-memory-mcp` is the live example — assess it as the localization
  backing before hand-rolling one. Same rule for any future capability: search the ecosystem first.
- **Vendored vs called:** the Cline SDK is *vendored as source* (we build it, patch deliberately — see its `NOTICE.md`
  patch ledger). llmfit/MCP/LM Studio are *called* (CLI/API) — no source in-tree.
