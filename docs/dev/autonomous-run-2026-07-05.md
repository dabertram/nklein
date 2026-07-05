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


## Update 2026-07-05 (later): adversarial bug-hunt sweep on new + newly-LIVE code — 4 defects fixed, all live-validated

Fanned out 3 parallel adversarial hunters (find→refute) over the session's new/newly-live code. Results:
- **basic-memory wiring — 1 HIGH, CONFIRMED + FIXED + LIVE-VALIDATED.** Per-project stores used FIXED container paths (`/nklein/basic-memory/{notes,config}`, no workspace segment), but the ONE shared sandbox container mounts every registered project at once ⇒ two projects → duplicate `--mount` dst → `docker run` fails ("Duplicate mount point") → outage for ALL tasks. My single-project live e2e missed it (exactly the multi-project race David flagged). Fix: workspace-hash the per-project container paths + dedup the shared-global mount by dst in `startContainer`. Validated LIVE before/after with real docker: old style crashes, new style starts (5 unique mounts from 6 raw). Commits `0bacc394`.
- **egress/SSRF — 2 real holes FIXED + LIVE-VALIDATED, both in the guard shared by browse_url + retrieval + nklein-browse.** (1) The IPv6 blocklist omitted IPv4-EMBEDDING ranges (NAT64 `64:ff9b::/96`, 6to4, Teredo) — `[64:ff9b::a9fe:a9fe]` reached 169.254.169.254 metadata; now blocked fail-closed (`293274f6`). (2) The guard only checked the TOP-LEVEL URL — subresource requests, redirect-to-internal (fired the GET before the post-hoc check), and DNS-rebinding slipped through; added a `page.route` per-request SSRF interceptor for the guarded contexts, validated live with real Chromium (raw reaches loopback hits=1; intercepting aborts before the request, hits=0) (`e492df47`). **RESIDUAL (tracked):** the last resolve→connect micro-TOCTOU is not closed — needs IP pinning (Playwright can't easily pin per-request); the interceptor shrinks the window from seconds to microseconds + closes the subresource/redirect holes entirely.
- **truncation-classification vein — CLEAN** (no confirmed defects; the centralized classifier + budget math are sound; one non-reachable defensive NaN gap noted only).

Full gate green after all fixes: 647 files / 7312 tests / tsc 0. Validation-first + adversarial sweep worked: the collision + SSRF holes were caught by the sweep, not the unit tests (which asserted single-project / literal-IP happy paths).


## Update 2026-07-05 (later): egress END-TO-END with LIVE models across the fleet — flagship feature proven

Live-fleet sweep (the machines David freed) validated the newly-enabled egress with REAL models driving it — not just the client harness. `scripts/verify-egress-model-e2e.mts` offers a loaded model the real `web_search` tool, and asserts the full loop: model EMITS a web_search call → its query runs against the live SearXNG → real results fed back → model answers using them. Passed on **3 models across 2 machines + 2 sizes**: `brain27` (27B, local), `coder-gpu` (4B, legion), `qwop4b-a` (4B fable, local) — each emitted the call (finish=tool_calls), got 8 real results, and returned the correct real URL (`anthropic.com/claude/opus`). So egress works with the SMALL local models that are !Klein's whole point, not just a capable model. Fleet untouched (inference calls to already-loaded models only; no load/unload). Reproducible: `NKLEIN_E2E_MODEL=<id> npx tsx scripts/verify-egress-model-e2e.mts`.

**Session sequence COMPLETE** (David's order: egress-live → UI-notes → swarm-recovery → bug-sweep → live-fleet): egress enabled + validated 3 ways (client, SSRF floor, model-e2e); UI parked for Fable; swarm-recovery classification shipped + vendored milestone scoped; bug-sweep found+fixed+live-validated 4 defects (2 HIGH); live-fleet egress proven across the fleet.


## Update 2026-07-05 (evening grind — David away until tomorrow, wants a big part of the backlog finished)

David: "keep going, i will be back again tomorrow and expect you to finish a big part of the backlog." Plus earlier: work the backlog / use models when needed / **UI now allowed if logged for a Fable revisit** (`docs/dev/ui-work-fable-revisit.md`) / broader sweeps only AFTER direct tasks.

**Backlog leaves completed this grind (all green, gate ~7349 tests, tsc 0, web-ui tsc 0):**
- **§5.AA ModelBehaviorProfile persistence store** — event-sourced append-JSONL (`model-behavior-profile-store.ts`), + **fed at the task-outcome seam** (coarse success/failure → successRate/retry-budget). Store now has a live producer.
- **§5.AB fitness cluster — COMPLETE**: storage layer + schema migrations (`fitness-table-store.ts`) → read-side ranking projection (`rankFitnessCandidatesForCell` + store adapter) → write-side fold (`recordFitnessOutcome`/`emptyFitnessRow`) → **write-side WIRED** (`deriveTaskFitnessRecord` + serialized `recordTaskFitnessOutcome` at the completion seam, concurrency-safe, 20-way test). Schema+read+write+wiring all done.
- **§5.M** real BPE token estimator into the chat lean-window split (was length/4 placeholder).
- **§5.L** agent web-research tool + curated-MCP tools gated by the per-role capability ruleset (centralized `isSandboxMcpEnabled` helper vs guard-drift).
- **§5.AI** test-driven-mode delivery-gate CORE (`decideTestDrivenDelivery` + `isLikelyTestFile`) — wiring is a control-flow change in the completion path, left for a careful fresh pass (risky at marathon depth).

**UI (logged in ui-work-fable-revisit.md):** egress toggle + SearXNG backend URL, curated-MCP + capability-broker toggles, **fixed the web-ui typecheck** (8 stale fixtures missing sandboxMaxConcurrentExec → 0 errors).

**Frontier:** the remaining direct leaves are coupled integrations (loop-level read/update hooks, control-flow gates, scheduler consumption, chat-scope features) or medium multi-file features (config promotions, session fields) or milestones (durable-scheduler, SWARM-recovery vendored change). Completing them = focused per-feature work, not quick leaves. Open: ~429.


## Update 2026-07-05 (evening): validation hunt on THIS session's new code — 2 real defects fixed

Ran 3 parallel adversarial hunters over the session's new integration code (a focused validation of MY work, not a broad sweep — appropriate now the clean direct-leaves are worked through + David returns tomorrow). Result:
- **Fitness write path — 1 HIGH, fixed:** `foldMean` divided the rolling mean by total `sampleCount`, not the CONTRIBUTING count — so attempts reporting a null metric (e.g. a session with no valid startedAt/updatedAt → null wallTime) skewed `meanWallTimeMs` (1000,null,null,3000 → 1500 not 2000), mis-ranking a faster model below a slower one in the live tie-break. Fixed with per-metric contributing counts (additive schema migration) + a regression test. Serialized-write, migration, key-derivation all refuted CLEAN.
- **Seam wiring — 1 HIGH, fixed:** the task-outcome seam fired on EVERY summary re-emit (terminal summaries re-fire on salvage-rebound/resume/review rounds), double-folding a single run's outcome into BOTH the fitness + behavior stores (the sibling model-performance store dedups on read via a stable id; mine fold on write). Fixed with a bounded per-run dedup guard (taskId+startedAt) so each run records once. Oldest-first behavior-fold ordering + best-effort error handling refuted CLEAN.
- **Tool-gating + test-driven vein — CLEAN** (no defects): fail-closed gating confirmed, no guard-drift across the 3 MCP sites, live re-apply fires, `isLikelyTestFile` correct against 37 adversarial names.

Full gate green after fixes: 651 files / 7350 tests / tsc 0. Validation-first caught what the unit tests (which asserted the happy path) missed — same lesson as the earlier basic-memory `readwrite` bug.


## Update 2026-07-05 (evening): heaviest-first milestone pass — 1 durable piece DONE, SWARM-recovery inc-1 DONE, 2 env blockers COLLECTED

David: "go for the hardest least quick win tasks .. do the heavy work now" + /goal "heaviest to lightest, autonomous, collect interaction-required tasks + do others first".

**Heavy work COMPLETED + validated here (no env blocker):**
- **§5.AF at-most-once durable leases** (commit `2ff56b47`) — wired the built-but-dark `keyDurableLeaseActions` + `dedupeSchedulerEventsByIdempotencyKey` end-to-end (controller stamps lease log entries over the pre-apply job identity → ledger mapper carries the key → `readDurableSchedulerLog` dedups a crash-re-appended lease before replay). Additive/identity-optional ⇒ byte-identical, +4 tests, 66 existing durable tests unchanged. A real §5.AF #8 milestone piece.
- **§5.AA SWARM-recovery increment 1** (commit `921278e2`) — the recovery-ladder `AgentModel` wrapper (`createRecoveryLadderModel`): buffers a base turn, on a stalled no-tool-call turn re-invokes with a reframed request + REPLACES the events (bounded), verbatim replay otherwise. Injected policy ⇒ 6 unit tests. Decorates the config-builder's pre-built model — no bridge reimplementation. De-risked the milestone from "deep vendored rewrite" to "a `wrapModel` hook + this wrapper".

**★ COLLECTED — the two heaviest milestones are ENVIRONMENT-BLOCKED here (need David / a different host):**
1. **SWARM-recovery increments 2-3 need `bun`.** The vendored `wrapModel` hook requires rebuilding `vendor/cline-sdk/packages/core` (build = `bun run ./bun.mts && bun tsc`); **`bun` is not installed** on this host, and raw-`npx tsc` bypass is too fragile for the load-bearing engine. → *Install `bun` (or provide a pre-built vendored dist), then I land the hook + wire flag-gated `NKLEIN_SWARM_RECOVERY` + brain27-validate. Increment 1 is ready to plug in.*
2. **Durable-scheduler DEFAULT-ON needs a bigger Docker VM.** The bounce-race + acceptance-sandbox-prep fixes can't be validated at the current **7.7 GiB Docker VM** (sandbox OOM), and the notes are explicit this critical hot path must not be fixed blind. → *A Docker-healthy host (bigger VM / lighter fleet) unblocks the default-on validation.* The scheduler is well-validated + opt-in meanwhile.

Doing other (non-blocked) backlog tasks next per the /goal.

## Collected blocker — §5.AF/§5.AA strategy-effectiveness learning is NOT-RIPE (2026-07-05)

The scout ranked "wire collected rung outcomes into retry-policy feedback loop" as completable-here, but a code
check disproves it. The pure core is done (`strategy-effectiveness-ledger.ts`: `recordStrategyOutcome`,
`strategyEffectiveness`, `orderLadderByEffectiveness`) and `agent-ledger-projections.inferAttemptStrategy` already
maps an attempt's levers → `RetryStrategy`. **But the observation stream it needs does not exist yet:**

- The attempt ledger has exactly TWO emitters, both TERMINAL: `buildTerminalAttemptEvent` (one per task) and
  `buildChatAttemptEvent` (one per chat session, `attemptId = flow:sessionId:endedAt`). Neither is per-rung.
- Consequently `parentAttemptId` and `promptStrategy` are ALWAYS null (never set by either writer). There is no
  rung→(remedied-failure, recovered?) chain to fold: `recordStrategyOutcome` would see an empty stream.

**Prerequisite (hot-path):** the chat retry ladder (`createChatAgentModel` in `chat-local-llm-adapter.ts`) must
emit a per-rung `attempt` event that sets `parentAttemptId` (the rung it retried) + `promptStrategy` (the lever) +
its own `outcome`. Only then can `buildStrategyEffectivenessFromLedger(events, modelId)` project effectiveness and
`orderLadderByEffectiveness` reorder the live ladder. Both the emit and the consume are load-bearing chat-recovery
changes — do them together with a live chat-e2e validation, not as a blind pure projection over absent data.
