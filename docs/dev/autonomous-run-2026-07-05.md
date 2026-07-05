# Autonomous run — 2026-07-05 (multi-day, David away)

Living log of the autonomous grind + **the collected items that need David's guidance** (the `/goal`'s "collect everything that really needs my guidance"). Update as the run continues.

## Shipped this run (all green, gate at ~7279 tests, ~150 commits)

- **MCP guidance arc (fully done + live-validated):** audited per-model gating of the 3 MCPs; made **codebase-memory** live (baked the pinned static binary into the sandbox image + the "prefer the code-graph over grep" nudge); implemented **basic-memory** across per-project + global scopes with the **strong-model `memory_audit`** (the verification the architecture was missing) — fit profile, scoping/keying, provenance frontmatter + provenance-weighted recall, default-OFF opt-in gate; **rebuilt the sandbox image + validated all 3 servers speak MCP offline** (`verify-sandbox-mcp.mts`).
- **~20 pure-core leaves** (build→test→commit→cross-off): turn-budget allocator, memory governance (+ namespaced scope, opt-in access-all, why-recalled), Ochiai spectrum fault-localization, `ModelPool` + per-pool headroom, calibrated-confidence scorer, learned rounds-budget, deterministic per-family scorers, fitness-table schema + failing-LLM-list projection, reasoning-control policy, focus-chain nudge, richer work-package card schema, repair-controller decision ladder, repair-kernel ledger + N-candidate parser + generate-N-patches prompt.
- **backlog: 461 → ~441 open.**
- **Adversarial bug-hunt sweep on this run's new code (find → refute → fix):** 5 confirmed, concrete defects found + fixed green (2 false positives correctly filtered): repair-kernel discarded a better partial from a later refine round (kept only the first) + the ledger rationale then named the wrong winner; three fail-safe-contract violations (`clampTokens`/`scorePassingCode` leaked NaN; `scoreValidDag` desynced Kahn's count on duplicate node ids). All with regression tests. A second focused sweep over the remaining edited modules is in flight.

## Where the boundary is (verified by 2 code scans + wide sampling)

The **cleanly-completable pure-core leaves are worked through**, and there are **no already-done-but-unmarked leaves** (todo.md is well-maintained). The remaining ~441 tasks are predominantly: runtime **integration/wiring**, **UI/React**, **live-model runs** (canonical-model tests, sweeps, measurements), **persistence/storage**, **web/egress**, or **design decisions**. Continuing autonomously on the safe tiers: flag-gated default-OFF integration + adversarial bug-hunt sweeps on the new code.

## ★ Needs David's guidance / greenlight (unblocks the most work)

1. **Egress greenlight.** A large cluster (§5.AC online-retrieval loop, §5.M/§5.AC freshness→online-refetch, §5.AB runtime online model research, the web-search tool the model can drive) is gated on an explicit egress greenlight + policy. All the pure decision cores are built; they're dark until you authorize outbound. → *Decision: greenlight egress (scoped how?) or keep dark.*
2. **basic-memory: enable + finish the runtime wiring.** Cores + image are done + validated offline. Owed (needs a live run to validate, so left for a go-ahead): inject the RW mounts at container-create + seed `config.json`, wire the idle `memory_audit` dispatch loop. → *Decision: enable `NKLEIN_BASIC_MEMORY` + let me do the mount/dispatch wiring against a live run?*
3. **Live-fleet validation tasks.** Many leaves are "test across phi/deepseek/qwen canonical models", "measure cold-load/index time", "re-verify across the §5.Z roster" — they need models loaded on the 3 machines. I can drive these (you authorized load/unload) but want a nod on which to run + confirmation I won't collide with your hands-on use. → *Decision: which live sweeps to run, and when the machines are free.*
4. **Design decision — retrieval layering (§5.V L1476):** keep lexical always-on + make dense opt-in? Depends on recall@k numbers that need a labeled query set to produce. → *Decision: provide/point at a labeled set, or approve the lexical-default leaning.*
5. **UI work** (chat focus-chain surface, Settings panels, fitness-table browser) — needs product/UX calls + is React work I've been treating as lower-priority for autonomous grinding. → *Decision: want me to take on UI slices autonomously, or hold?*
6. **The four memory layers (§5.M L2055):** the working/episodic/procedural layers are pure projections I can build; the **semantic** layer ("extract facts/preferences from episodes") needs an extraction approach (LLM pass vs heuristic). → *Decision: how should semantic extraction work?*

## Env note

No idle-scheduler fires here — timers (ScheduleWakeup/cron) don't auto-restart between turns; the session Stop-hook is what keeps the grind going. Continuation depends on the harness re-invoking on stop.


## Update 2026-07-05 (later): basic-memory cluster DONE + validated live

Wired end-to-end (all flag-gated `NKLEIN_BASIC_MEMORY`, default OFF = byte-identical): per-project RW writable mounts at container-create + `basic-memory project add` config seed + the per-task MCP exec-env (CONFIG_DIR/MCP_PROJECT) applied only to the basic-memory `docker exec`. **Validated LIVE end-to-end** (real `--network none` container → seed → MCP `write_note` → note persisted to the host per-project store). Live validation caught a real bug: the RW `--mount` used an invalid `readwrite` field docker rejects (unit test had asserted the buggy string) — fixed. Remaining for the full feature: the idle `memory_audit` dispatch (the trust layer; all its pure pieces are built) + a real in-runtime task run with the flag on.


## Update 2026-07-05 (later): egress cluster mapped + safety floor LIVE-validated

Investigated the egress cluster end-to-end. It is **three distinct pieces**, not one:

1. **Host-side retrieval/web-search/browse egress — BUILT, wired, gated, dormant.** The sandbox stays `--network none`; the model drives `web_search`/`browse_url` *tools* that the HOST executes (gated), returning results. Wired in BOTH surfaces: chat (`chat-agent-tool-deps-resolver.ts:106,116`) + the SWARM retrieval loop (`nklein-task-session-service.ts:932-942`, via `browserFetchAdapter(buildSsrfGuardedPageFetcher())`). Triple-gated OFF by default: `web_search` needs `browserEnabled && egressEnabled && searchBackendUrl` (defaults `false`/`null`); `browse_url` is a per-session opt-in + host-command confirm gate + SSRF guard. **Nothing "hinders" it — it's DONE + dormant. Enabling = a config decision (real outbound from your machine), which is yours.**
2. **Egress SAFETY floor — LIVE-validated this run.** `decideEgressPolicy` + `checkHostForSsrf` block loopback/LAN/link-local/IPv6-mapped/cloud-metadata (45 deny tests). Added a **live** proof-of-block (`chat-browser-guarded-fetcher-live.test.ts`): a genuinely-reachable loopback server serving a secret + the REAL node DNS resolver (via the `localhost` hostname → the `dnsLookup`/"reject if ANY resolved IP is private" branch the literal-IP unit test can't reach) → the guard refuses before the secret is ever retrieved. Loopback-only, no external egress. This is the piece that makes egress *safe to enable*.
3. **Sandbox-direct-network egress proxy (L1544-1547) — NOT built; a design question, not blind work.** Letting the sandbox CONTAINER reach the net (filtered by a per-role allowlist) needs a real filtering forward-proxy + policy-keyed pools. `resolveAgentSandboxNetworkArgs` deliberately **fails closed** today (`allowlist` → `--network none`) rather than lie. This is **largely obviated by piece #1** (the host fetches for the agent, so the sandbox never needs direct net) and involves real outbound + an infra decision.

**→ Decision owed:** (a) enable host-side egress (`egressEnabled` + a `searchBackendUrl`)? and (b) do we want the L1546 sandbox-direct-network proxy at all, or stay host-side-only (keep `--network none`)? I recommend host-side-only — it's built, safe, and needs no proxy.


## Update 2026-07-05 (later): SWARM-loop cluster boundary re-confirmed + new-code sweep CLEAN

- **SWARM recovery-ladder cluster = deliberate frontier, not a blind grind (re-confirmed vs §4A ground truth).** Re-derived from the SDK contract: `afterModel → AgentStopControl` (stop/observe only) and `beforeModel → AgentBeforeModelResult` (can re-frame the next request's messages) — but neither can force a re-invoke on a text-but-no-tool-call turn, which the SDK loop treats as terminal. §4A L416 ("SEAM CLARIFIED") already documents this: the SDK task path has NO turn-retry hook, so the SWARM ladder needs "session-level re-send wrapping or an SDK change." The CHAT path already fires all rungs inline + has the truncation ladder flag-gated (`NKLEIN_CHAT_ADAPTIVE_TRUNCATION`). So the todo.md leaves that say "wire into the afterModel hook" are mis-framed — the genuine remainder is the SWARM re-send wrapper, which needs truncation-inducing-model validation (brain27 at a low budget reproduces it; phi-4/deepseek are the canonical cases, not loaded). Left as a deliberate piece per rule #3, not blind-wired.
- **Adversarial sweep of THIS run's new integration code — CLEAN.** Re-read the basic-memory `startContainer` wiring (mount↔plan mapping unique-by-key; host dirs mkdir'd before bind; `docker run` fails loud; seed `docker exec [-e…] CONTAINER argv` ordering valid) and the exec-env scoping (`server.id === "basic-memory" ? env : undefined` — applied to ONLY basic-memory, no leak). No residual defect; the sole real bug (invalid `readwrite` mount) was already caught by the live e2e + fixed. Validation-first worked: the real bug surfaced live, the static pass confirms no leftover.


## Update 2026-07-05 (later): EGRESS ENABLED LIVE (David greenlit) — guidance item #1 RESOLVED

David chose "enable egress live now." Done + validated end-to-end:
- **Reproducible SearXNG backend** committed at `docker/searxng/` (compose + settings; `use_default_settings:true` + JSON format on; binds `127.0.0.1:18888` only). `docker compose -f docker/searxng/docker-compose.yml up -d`.
- **Config flipped ON**: `~/.nklein/config.json` → `retrievalEgressEnabled:true` + `retrievalSearchBackendUrl:"http://localhost:18888"` (the user's machine config; NOT in the repo). To revert: set the flag false or delete the file.
- **LIVE-VALIDATED**: the REAL `createSearxngWebSearchClient` → the live SearXNG → real internet: 8 real results (`anthropic.com/claude/opus`), fail-closed gates hold (egress-off ⇒ `blocked_by_egress` with no request; null backend ⇒ `no_backend`). Reproducible: `npx tsx scripts/verify-egress-live.mts`.
- browse_url shares the host-side SSRF-guarded fetcher (live proof-of-block already added this run).

So the §5.AC online-retrieval path is now LIVE (not dark). Guidance item #1 (egress greenlight) above is RESOLVED — egress is on, host-side, SSRF-safe, with a reproducible backend. The sandbox itself stays `--network none` (L1546 sandbox-direct-network proxy remains unneeded / a separate design Q; David didn't pick it).
