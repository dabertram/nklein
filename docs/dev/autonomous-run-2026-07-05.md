# Autonomous run — 2026-07-05 (multi-day, David away)

Living log of the autonomous grind + **the collected items that need David's guidance** (the `/goal`'s "collect everything that really needs my guidance"). Update as the run continues.

## ★ DECISIONS OWED (David) — consolidated 2026-07-05, RESOLVED same day

David reviewed all seven via AskUserQuestion. Decisions 1-2 applied (code + tests flipped, gate green); 3 deferred;
4/5/6 approved to build now (see below for progress).

> **🔥 CPU-SPIKE INVESTIGATION (2026-07-06, David-requested) — RESOLVED.** David reported occasional CPU spikes on the M5.
> Root cause: **8 orphaned `cli.ts --no-open` runtime servers** accumulated over 2–4 days, all reparented to launchd
> (PPID 1), launched from the pre-rename `GIT/kanban` path (now deleted on disk), each holding a listening port + 700–890 MB
> RSS (~4.1 GB total) and still firing the runtime's periodic timers (board-liveness 30s / speculative-mirror 45s /
> opportunistic-idle 60s / retry-sweep / durable-scheduler). Overlapping tick bursts across 8 servers = the "occasional
> spikes" (idle between ticks — low accumulated cputime confirmed it's periodic, not a hot loop). Leak mechanism: they were
> spawned with `--require test/integration/shutdown-ipc-hook.cjs`, which only reacted to the explicit `kanban.shutdown` IPC
> message; when a parent test/dev process died abnormally the message never arrived and the child lingered.
> **Actions:** (1) killed all 8 orphans + their esbuild/tsx helpers (SIGTERM was ignored — graceful shutdown wedged — needed
> SIGKILL; freed ~4.1 GB + 8 ports, machine calm). (2) Hardened the hook (David chose disconnect + hard-exit fallback):
> `process.on("disconnect")` self-terminates the child on parent death (every spawn uses `stdio:[...,"ipc"]` so `disconnect`
> always fires), plus an unref'd hard-exit fallback timer (`KANBAN_SHUTDOWN_HARD_EXIT_MS`, default 5s) for the wedged-graceful
> case. +3 tests. Commit a6c4b0f6. **Note for David:** the fix prevents FUTURE leaks from the test/contract harness spawns;
> if dev/grind server starts use a different launcher, worth confirming they also carry the hook (or a ppid-watchdog) — I
> offered that as an option and it's available if the leak recurs.

> **🔥 CPU-SPIKE FOLLOW-UP (2026-07-06, David re-checked) — all good.** David still saw occasional spikes. Re-investigated:
> the original 8 orphaned runtimes are gone and have NOT recurred (the hardened shutdown hook held). Found + killed ONE more
> stale orphan of the same class — a pre-rename `core-py` backend (`klein_core --port 3585`) running from the deleted
> `GIT/kanban` path, orphaned to launchd for 7 days. The remaining spikes are (a) the grind's OWN gate runs (tsc + the full
> 7822-test vitest suite across 18 cores + biome, sometimes 2–3×/iteration) — the expected verification cost — and (b) unrelated
> macOS/Claude-app AV daemons (avconferenced ~29%, VTEncoderXPCService ~15%, WindowServer, kernel_task thermal). David's call:
> **all good, keep the current gate cadence** (max safety margin). No nklein-leaked processes remain driving CPU.

> **⚠ PROCESS FINDING (2026-07-06, slice 53 verification) — for David.** A full `test:fast` run at the tail caught a RED
> guard test that had been shipped on the branch: `nklein-local-only-policy.test.ts` ("cloud-provider literals confined to
> documented boundary files") was failing because the earlier §5.U extraction commit **d494ddf7** (nklein-managed-provider-credentials)
> moved the `openai-codex` managed-provider literal into a new file without registering it in the policy allowlist. Since
> `test:precommit` === `test:fast` (the full `test/runtime` + `test/utilities` suite, which INCLUDES this test), that commit's
> pre-commit gate should have blocked it — so d494ddf7 must have **bypassed the hook** (`--no-verify`) or the hook didn't fire.
> Fixed forward in commit 28081179 (registered the file as a documented boundary — invariant preserved, not weakened). **Worth a
> spot-check that other autonomous slices this run didn't also bypass the gate.** My own slices 45–53 each ran tsc + the relevant
> suite explicitly and I confirmed the full fast suite green (7801 passing) at this tail before stopping.

1. **✅ RESOLVED — fill-only.** `defaultAcceptanceCommand` now fills in only when a task omits its own
   `acceptanceCommand`; the task's own command always wins. Flipped `normalizeTaskAcceptanceCommand` +
   the 2 deliberate tests that asserted override (`plan-task-validation-graph.test.ts`,
   `nklein-decomposition-tool.test.ts:1485`) + restored the bug-hunt regression test. Gate green.
2. **✅ RESOLVED — guard it.** `addTaskDependency`/`canAddTaskDependency` now reject an edge that would close a
   dependency cycle (`wouldCreateDependencyCycle` wired in, reason `would_create_cycle`, message added to
   `getLinkFailureMessage`). Flipped the deliberate "two waiting tasks keep the reverse as a distinct link" test to
   assert rejection instead + added an `addTaskDependency`-level cycle/shortcut test. Gate green.
3. **Deferred (David's call).** §5.AF ledger forward-compat (`jsonl-store` drops a forward-incompatible terminal event
   before the SB#3 fail-safe sees it) — not worth designing against with only one schema version live. Revisit when a
   breaking ledger event change is actually proposed.
4. **Approved — build now.** §5.AL runtime-verdict per-run precision (stamp a per-run id on `model_stalled`
   self-observations so the stall numerator dedups per-run).
5. **Approved — build now.** §5.AF strategy-effectiveness per-rung `attempt` emission in the chat retry ladder (the
   hot-path change the not-ripe learning core needs to have real data to fold).
6. **Approved — build now.** §5.AE skill-fragment dynamics-level threading (`buildSessionSkillFragments` should resolve
   at the user's `effectiveSkillDynamicsLevel`, not always `fully_dynamic`).
7. **Environment blockers (not decisions — just gates, unaffected).** SWARM-recovery increments 2-3 need `bun` (vendored
   SDK build tool, not installed); durable-scheduler default-on needs a Docker VM larger than 7.7 GiB to validate.

---

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

## Decompose/routing bug-hunt (2026-07-05) — 4 fixed, 1 collected for a product decision

A find→adversarial-verify workflow over the decomposition/routing spine confirmed 6 findings (5 unique). Verified each
against the code myself; fixed 4 (unit-tested, full suite green 7395), and COLLECTED 1 as a product decision:

**FIXED:**
1. `plan-artifact-apply.ts` — `fallbackPreview` (preview WITH routing candidates) ran OUTSIDE the apply try/catch, so a
   card infeasible for EVERY loaded model threw the feasibility guard and failed the WHOLE decompose. Now degrades to a
   candidate-less "model selected at start" preview via the new `previewNKleinPlanTaskGraphWithFallback` helper.
3. `plan-task-board-apply.ts` — an EMPTY task graph created no cards yet still moved the source planning card to
   `completed` (silent work loss). Now guarded on `producedCards` (taskIdByPlanTaskId non-empty).
4. `plan-task-validation.ts` — a task `id` with surrounding whitespace (valid per `z.string().min(1)`) was NOT trimmed,
   but its dependents' `dependsOn` WAS, so `validateTaskGraphReferences` bogus-rejected a legit edge as "unknown task".
   Now the id is trimmed to match.
5. `nklein-task-router.ts` — `compareCandidates` returned `NaN` (`Infinity - Infinity`) when both candidates lacked a
   costRank/wall-time (the auto-discovered decomposition candidates never set costRank), making Array.sort
   engine/insertion-order dependent → non-deterministic model pick. Now guards `leftCost !== rightCost` before subtracting.

**COLLECTED — USER DECISION NEEDED (bug #2, contract ambiguity):** In `normalizeTaskAcceptanceCommand`, a non-null
`defaultAcceptanceCommand` currently OVERRIDES a task's own `acceptanceCommand` (`default ?? task`). BUT the tool-schema
doc AND `plan-task-schemas` both describe it as FILL-ONLY ("applied to tasks that OMIT acceptanceCommand" / "falls back to
defaultAcceptanceCommand"). The bug-hunt flagged the override as a defect (a coarse global default silently discards a
card's precise per-card objective check, e.g. `grep -q storage src/storage.ts` → `npm test`). However, TWO deliberate
tests assert the override (incl. nklein-decomposition-tool.test.ts:1485, which sets up exactly that scenario and expects
the default to win), so it is NOT a clear mechanical mistake. **Question for the user:** should `defaultAcceptanceCommand`
be FILL-ONLY (honor a card's own command, default only fills gaps — matches the docs, preserves per-card checks) or
OVERRIDE (current + tested behavior)? Left as-is (override) pending the decision; inline note added at the code site.

## Selection/fitness/learning bug-hunt (2026-07-05) — 6 unique defects fixed (7 confirmed findings, 1 dup)

A find→adversarial-verify workflow over the model-selection/fitness/learning cluster (~3465 LOC) confirmed 8 findings
(7 unique). Verified each against the code myself; ALL 6 fixed (the 2 runtime-verdict bugs share a root), regression
tests in test/runtime/core/selection-fitness-bugfixes.test.ts (7 tests), full suite 7406 green.

1. **runtime-model-verdict — chronic staller mis-judged TOOL_CAPABLE (HIGH).** Root cause: self-observation events
   NEVER carry a runId (no emitter sets it), so the deduped `stalledRunIds` is structurally empty; via the CLI path
   (which supplies ledger runs → runIds.size>0) `stalledCount` collapsed to 0 → stallRate 0 → a model that stalls every
   turn reads TOOL_CAPABLE. Fixed: count runId-less stalls (`stallEventsWithoutRunId`) alongside the deduped distinct
   stalled runs, capped at sampleCount. PRESERVES the per-run dedup when runIds ARE present (the L62 test).
2. **runtime-model-verdict — capable model mis-judged TOOL_UNSUITABLE (denominator).** The `runIds.size>0 ? … :
   ourEvents.length` fallback treated the FAILURE-event count as a run count (clean runs emit nothing), inflating the
   stall rate to ~100% at the start-task-session call site (which passes no `runs`). Fixed: `sampleCount = runIds.size`
   only — with no run-id evidence there is no honest denominator ⇒ UNKNOWN (safe: 1.0× multiplier, no false penalty).
3. **model-behavior-profile.learnedQualityEffectiveBudget** could return a budget ABOVE the degradation point (the
   `good`/`degraded` scalars ratchet independently + can cross); dropped `good` from the degraded-branch max.
4. **model-swarm-route.tierByPool** scored a pool's capability WITHOUT a context check → routed to a context-infeasible
   pool → within-pool no_fit blocked the task; now only context-feasible models count toward a pool's tier.
5. **fitness-projections.rankFitnessCandidatesForCell** — the wall-time tiebreak was `Infinity − Infinity = NaN` when
   two tied rows both lacked a wall time (the SAME NaN-comparator class as the router bug); added a `!==` guard + a
   stable modelKey final tiebreak.
6. **fitness-table-schema.foldMean** discarded a forward-migrated historical mean (v0 rows have a mean but *-Samples=0);
   now treats the existing mean as ≥1 prior sample and blends. **model-fitness.selectModelForTask** got a deterministic
   modelId tiebreak (was caller-order-dependent on equal fitness).

**COLLECTED — wiring follow-up (to make the runtime-verdict feature actually WORK, not just be safe):** the pure core is
now correct, but (a) the self-observation emitter (`recordObservationWithModel`, nklein-task-session-service) should
stamp the current runId/taskId on `model_stalled` etc. so per-run dedup works; and (b) start-task-session.ts:~457 should
pass the ledger `runs` (the total-run denominator) to `assessRuntimeModelVerdict`. Until both land, the start-task-session
runtime-verdict multiplier is a safe no-op (UNKNOWN → 1.0×) rather than the prior harmful false TOOL_UNSUITABLE penalty.

## Durable-scheduler/ledger reliability bug-hunt (2026-07-05) — 4 fixed, 1 collected

A find→adversarial-verify workflow over the §5.AF durable/ledger reliability spine (~5200 LOC) confirmed 5 findings.
Verified each against the code myself; 4 fixed (regression tests in test/runtime/core/durable-reliability-bugfixes.test.ts,
7 tests), full suite 7413 green. The verifier UPGRADED two from medium→high on the reachability analysis.

**FIXED:**
1. **durable-run-controller.reportCompletion — accepted a report on a NON-leased job (HIGH).** The guard rejected only
   terminal (succeeded/failed) jobs, so a late/duplicate `failed`/`interrupted` summary for a card a transient-retry had
   already returned to `ready` was applied AGAIN — double-burning an attempt, or PARKING a card that holds no lease and
   is mid-redispatch (freezing it + its dependents; the extra `completed` event is unkeyed so it replays). Now requires
   `job.state === 'leased'` (at-most-once per lease; a first report always arrives while leased).
2. **durable-scheduler.decideDurableSchedulerActions — `input.now` unguarded for finiteness (HIGH).** `x > NaN` is
   always false, so a non-finite `now` (bad ports.now() / corrupted recorded-now on replay) both mass-reclaimed EVERY
   live lease AND leased every ready job ignoring backoff, in one tick. maxAttempts/durations were already NaN-guarded;
   `now` was the gap (the sibling ready-order module already guards its own). Fail-safe: with an invalid clock, make no
   TIME-based decision (skip reclaim + leasing); the dependency fail/unblock steps don't read the clock and still run.
3. **durable-scheduler.renewDurableLease — non-monotonic (heartbeat could SHORTEN a live lease).** A backward clock step
   (NTP/suspend-resume) made `now + leaseDurationMs` earlier than the current expiry, so a heartbeat (which means the
   worker is ALIVE) shortened the lease → the next tick reclaimed a still-working card. Now `Math.max(current, proposed)`
   + ignores a non-finite proposed expiry.
4. **agent-ledger-selectors.latestRunState — not order-independent on equal recordedAt.** The "resume exactly where it
   was" projection used `>=` with no tiebreak, so two same-millisecond transitions resolved to whichever appeared last
   in the (unstable, cross-file-merged) array order. Added a stable eventId tiebreak.

**COLLECTED — forward-compat hardening (bug: jsonl-store drops a schema-invalid terminal event).** `parseValidatedJsonl`
silently skips a record that fails the ledger zod schema — which DEFEATS the SB#3 fail-safe in `readDurableSchedulerLog`
(that fail-safe folds an unparseable-DETAIL `completed` event to `failed` rather than dropping it, but it only ever runs
on events that ALREADY passed the store validation). A forward-incompatible terminal `completed` event (a future writer
bumps schemaVersion or adds a required field) is therefore dropped BEFORE the fail-safe → the job reverts to `leased` on
boot-replay → re-runs finished work. NOT fixed because it is (a) speculative — unreachable in the current single-schema-
version system, only a rolling-upgrade concern; and (b) a genuine design decision on the forward-compat strategy (a
forward-tolerant envelope schema vs. a raw-jsonl read path for the scheduler family so SB#3 can see envelope-invalid
terminal events). Owed: pick a forward-compat strategy for the §5.AF ledger before a v2 event shape ships.

## §5.AV wouldCreateDependencyCycle predicate + a COLLECTED design decision (2026-07-05)

While investigating the todo §5.AV note ("add wouldCreateDependencyCycle"), found that `addTaskDependency`
(task-board-mutations) has NO cycle guard — it rejects missing/same/duplicate/trash/non-backlog edges but not one that
CLOSES a dependency cycle. Since a cycle deadlocks the board (every card on it waits on another, none is a startable
root — exactly what the decompose path's `breakDependencyCycles` repairs), a manual/tool dependency-add (which has no
repair net) can wedge the board.

SHIPPED the pure predicate `wouldCreateDependencyCycle(board, fromTaskId, toTaskId)` (reachability over the depends-on
edges: adding from→to closes a cycle iff `to` already transitively depends on `from`; a self-edge is a trivial cycle).
3 unit tests.

**COLLECTED — DECISION OWED (did NOT wire the guard into addTaskDependency):** a DELIBERATE existing test
(task-board-mutations.test.ts:460 "two waiting tasks keep the reverse as a distinct link") asserts that for two WAITING
(backlog/planning) cards, after A depends on B the REVERSE link B depends on A is a genuinely-different, ALLOWED link —
which is a 2-cycle. Wiring the guard would reject that, changing a deliberately-tested behavior. Same class as the
`defaultAcceptanceCommand` decision: a doc/deadlock-correctness view vs. a deliberate test. **Question for David:** should
`addTaskDependency` reject cycle-closing edges (the predicate is ready to gate it) — accepting that the "reverse link
between two waiting tasks" case becomes disallowed — or does the planning-phase design intend to tolerate those cycles
(and is the board's cycle-repair supposed to cover the manual path too)? Recommendation: guard it (a deadlock is never
desirable; the 2-waiting reverse-link is a footgun), but confirm since it flips a deliberate test.

## Model-robustness/retry bug-hunt (2026-07-05) — 5 defects fixed

A find→adversarial-verify workflow over the §5.AA/§5.AN model-robustness cluster (tool-call parsing/repair, loop/
truncation detection, retry ladder) confirmed 5 unique findings. Verified each; all fixed with regression tests
(test/runtime/nklein-agent/model-robustness-bugfixes.test.ts, 7 tests), full suite 7423 green. Three DROP a valid tool
call the model actually delivered — the worst class for a weak-model swarm.

1. **nklein-tool-argument-repair.repairCommon — apostrophes in a double-quoted value corrupted the JSON, dropping the
   call.** The single→double-quote regex `/'([^'"\\]*)'/` isn't string-aware: on `"don't break the 'build' step"` it
   paired the apostrophe after `don` with the quote before `build`. Replaced with a string-state scanner that only
   converts single-quoted runs OUTSIDE double-quoted strings; in-string apostrophes are left alone.
2. **nklein-narrated-tool-call.parseGemmaToolCodeCalls — a `tool_code` inside an argument truncated the call.** The
   region boundary was a string-UNAWARE search for the next `tool_code` marker, so `run_command(command="grep tool_code
   .")` was cut mid-string and dropped. Rewrote to scan the full text and let the string-aware `extractBalancedParens`
   end each call; a `consumedUpTo` cursor skips markers inside an already-parsed call (wrapper unwrapping preserved).
3. **tool-argument-repair — a required field absent from `properties` was dropped as unknown.** Valid JSON Schema lets
   `required` name a field with no `properties` entry ("must be present, any value"); it was dropped, then the call was
   judged dispatchable WITHOUT its required value. Now a required-but-unschematized field passes through.
4. **tool-argument-repair.tryCoerce — hex/octal/binary/scientific strings were coerced to numbers.** `Number("0x10")`
   is 16, fabricating a value from a string the model likely didn't mean as a number. Restricted to a plain-decimal
   regex `/^-?\d+(\.\d+)?$/`.
5. **nklein-response-loop-detection — reported a MULTIPLE of the true loop period + under-counted repeats + over-kept
   salvage.** `minUnitLen` is only a detection floor; now the detected unit is reduced to its smallest divisor-length
   period so telemetry gets the real cycle + exact repeats and salvage collapses to exactly one occurrence.

## Context/prompt-assembly bug-hunt (2026-07-05) — 6 defects fixed + loop-stall mechanism fixed

STALL FIX: the autonomous loop kept parking on one-shot ScheduleWakeups while a ~9.5-min background sweep ran (David had
to nudge "stalled"/"keep going"). Switched to a RECURRING cron (CronCreate every 2 min, idle-only, prompt <<autonomous-
loop>>) per [[loop-mechanism-use-recurring-cron]] — this reliably re-invokes the loop so it no longer parks. Stop using
ScheduleWakeup one-shots for loop continuation.

A find→adversarial-verify workflow over the §5.AD/§5.AC context/prompt-assembly cluster confirmed 6 findings. Verified
each; all fixed with regression tests (test/runtime/nklein-agent/context-assembly-bugfixes.test.ts, 4 tests for the
clear+exported ones), full suite 7427 green.

1. **context-compaction.planCompaction dropped/summarized the MOST-RECENT message** when it alone exceeded
   keepRecentTokens (the recency loop broke before admitting it) — losing the live turn/tool result the model must act on
   next (the module's own core invariant). Now always keeps the last message verbatim (mirrors splitChatContextWindow).
2. **nklein-context-overflow-compaction fallback cut onto an orphaned tool_result** — it trimmed to the first `user`
   message, which is often a tool_result-only message whose tool_use was dropped in the first half → provider HTTP 400,
   defeating the overflow recovery. Now snaps to a real turn-start (added isToolResultOnlyUserMessage; returns null when
   none exists — a safe no-op the caller already handles). Mirrors the SDK's isTurnStartMessage guard.
3. **retrieval-freshness.judgeRetrievedFreshness rounded sub-day ages to whole days** → any source <12h read `current`
   under a realtime band, collapsing it. Now compares the FRACTIONAL age (matches the sibling isKnowledgeStale).
4. **retrieval-synthesis-adapter.parseSynthesisClaims used indexOf('[')..lastIndexOf(']')** → a prose bracket before the
   array (a markdown [link]) broke the slice → JSON.parse threw → ALL cited claims silently discarded. Replaced with a
   string/nesting-aware balanced-bracket scan that returns the first `[...]` parsing to an array.
5. **retrieval-loop-driver duplicate-id hits wasted a fetch slot** — a last-wins byId Map + one ranked entry per hit put
   the same hit twice in toFetch, starving a distinct hit under maxFetchPerQuery. Now dedups by id before the slice.
6. **retrieval-synthesis-adapter.evidenceExcerpt could exceed MAX_EVIDENCE_CHARS** (4 non-merging ~400-char spans) —
   now caps the joined spans, keeping the synthesis prompt bounded.

## Skill-resolver/capability bug-hunt (2026-07-05) — 2 fixed, 1 collected

A find→adversarial-verify workflow over the §5.AE/§5.AN skill-resolver/capability/api-profile cluster confirmed 3
findings. Fixed the 2 impactful ones (regression tests; 7432 green); collected the LOW one.

1. **skill-registry.skillRelevance matched keywords by RAW SUBSTRING** (`text.includes(keyword)`) → a short registry
   keyword over-matched inside a larger word: 'search'→'searchindex', 'online'→'OnlineStatus', 'add'→'address',
   'file'→'profiler', 'test'→'attest'. So a pure CODING card scored web_retrieval ≥0.6 and got web_search/browse_url
   tools + temporal/freshness/online fragments it never needed + a `web` affinity tag biasing model routing. Now matches
   on WORD boundaries (\b), mirroring the sibling temporal-awareness discipline.
2. **Role matching was case-sensitive + exact** against the free-form LLM `suggestedRole` — 'Worker'/'Architect' (or any
   non-lowercase) silently scored 0, losing the 1.0 role→bundle guarantee AND its affinity-tag routing signal (both in
   skill-registry.skillRelevance AND skill-resolver.defaultBundleForRole). Now normalized (trim+lowercase) at both sites.

**COLLECTED (LOW): nklein-session-skill-fragments.buildSessionSkillFragments resolves skills at fully_dynamic**, never
threading the user's effectiveSkillDynamicsLevel, so the session prompt's fragment set diverges from the routing path
(which honors the level). Fixing it needs the session service (nklein-task-session-service:2119) to thread the level from
the scoped runtime config — but the service does NOT currently access that config at the fragment seam (unlike
start-task-session, which reads scopedRuntimeConfig.effectiveSkillDynamicsLevel). That plumbing is disproportionate to a
LOW divergence that only affects users who set a non-default (static/assigned) skill-dynamics level; owed as a bounded
wiring follow-up.

---

## 2026-07-06 — resumption after the repo rename (kanban → nklein); grind re-armed

Session died mid-work during the repo rename. Recovered: all 409 local commits pushed to the renamed remote
`feat/nklein-upcoming` (was `feat/kanban-reliability-context-upgrade`), local+remote in sync, `worktree-agent-*`
branches dropped (proved fully merged). David set the **current-phase scope** → todo.md §5.0.6: drive to
FEATURE-COMPLETE; extended sweeps (§5.AO/§5.Z + broad live measurement) + the §5.AX visual overhaul deferred to
polishing.md; UI = FUNCTIONAL slices now, visual polish with Fable later; egress greenlit (host-side). Continuation is a
recurring idle-only cron (every 2 min) that re-enters via goal.md.

### Actionable-boundary re-confirmation (a full scan this iteration, not idle)
Scanned the top ready wiring candidates to find the highest-leverage clean increment. Confirmed the 2026-07-05 finding
holds: **the clean, deterministic, actionable-without-David pure-core leaves are worked through.** Specifics found:
- **§5.M modality gate (`resolveChatModalities`, todo L1967)** — the pure core is dark (ZERO non-test callers), but the
  chat contract is text-only (`runtimeChatMessageSchema.content: z.string()`, `sendMessage.message: z.string()`); there
  is no attachment/image field to gate. Wiring it is NOT a small leaf — it depends on first plumbing multimodal input
  end-to-end (contract + provider + UI). Not iteration-sized; leave until multimodal input is a funded feature.
- **§5.L capability broker at the swarm seam (todo L1620)** — the shared gate `decideCapabilityBrokerGate`
  (capability-broker-gate.ts) exists and is *explicitly built for both seams* ("one broker, both seams"), but only the
  chat executor calls it. Two swarm sub-paths: (a) the **sandbox executors** (`createAgentSandboxToolExecutors` in
  nklein-agent-sandbox.ts: bash/readFile/search/editor/applyPatch; webFetch disabled) are workspace-scoped with NO
  web/MCP taint and touch NO protected sink → wiring the broker there is a structural **no-op** (skip; would be dead
  code). (b) the **host-side retrieval seam** (`buildRetrievalExtraTools` ~nklein-task-session-service.ts:917 →
  `createNKleinResearchTool`) DOES bear real egress + ingests untrusted web content and is confirmed **not
  broker-gated** — this is the true keystone.

### ✗ PRE-SCOPE RETRACTED (next iteration read the seam deeper) — swarm broker is NOT a clean wiring; DEFERRED
The 2026-07-06-morning pre-scope above was wrong on the semantics. Reading the actual dispatch seams corrected it:
- The sandbox tools run in a SEPARATE process (`agent-sandbox/tool-runner.ts`, a `process.argv` CLI inside the
  `--network none` container) — not a single host-side executor wrapper like chat's `createGatedChatToolExecutor`.
  There is no clean "one wrapper, all swarm tools" seam; the host `research` tool and the in-container tools dispatch
  through different paths.
- **The fatal semantic bug in the pre-scope:** `research` is an egress-**READ** (fetch info IN), not an
  egress-**exfiltrate** (send data OUT). If it both SOURCES `["web"]` taint AND counts as a protected egress SINK, the
  SECOND `research` call in a session self-DENIES — breaking legitimate multi-step research (research → reason →
  research). This is exactly the "distinct egress-read manifest so benign multi-page browsing doesn't self-block" item
  the §5.L L1604 note already flagged as OWED. So a naive mirror of the chat path would ship a self-blocking bug.
- **And there is no exfiltration sink on the swarm path today** — the only egress is `research`/browse (both READS);
  nothing sends data OUT. The genuine exfil risk (tainted content → a tool that transmits) arrives with the swarm MCP
  tool seam (§5.AR), which isn't wired. So the broker's swarm value is LOW until (a) an egress-read/exfil manifest
  distinction exists AND (b) a real swarm exfil sink (MCP) exists.
- **DEFERRED (correct call):** don't wire the swarm broker now. It needs the manifest read/exfil-direction refinement
  (a real design piece, not mechanical) and a consumer (swarm MCP) that doesn't exist yet. Reconsider when §5.AR lands
  the swarm MCP seam. The chat-path broker (already live) covers the surface that has a real exfil sink today (browse →
  run_command). Recorded so no future iteration re-attempts the naive wiring.

### Actionable lane going forward (this iteration's conclusion)
With the pure-leaf supply drained and the flagged wiring keystones either no-ops, David-blocked (egress URL, MCP), or
design-dependent, the productive actionable-without-David lane is **functional UI slices** (David greenlit "functional UI
now"). Pivoting there.

### Highest-leverage David unblock (unchanged, still owed)
A **SearXNG backend URL** turns the entire online-retrieval cluster (the research tool + this broker's live path) from
dormant to live. Egress is code-complete incl. the Settings toggle; only the backend URL + the toggle flip remain, both
David's. `browse_url`-style direct fetch works without a backend; `web_search`/`research` need it.

### ✓ SHIPPED this iteration (e45ec04a) — §5.AT item 4: clarifyingQuestionPending sourced
Correcting the "pivot to UI" conclusion above: found a real, deterministic, non-UI increment. The board→chat feedback
**bridge is already built + wired live** (via `createBoardChatFeedbackWiring` → `createRuntimeStateHub({observeNKleinSummary})`,
cli.ts:420) — todo.md §5.AT item 4 was stale `[ ]`. Its highest-value gap (the DEAD ASK overrides) was mostly already
sourced (`deliveryGateHeld` via reviewReason "attention"; `noProgressOrLoop`/`approachingBudgetCeiling`/`heartbeatLost`
via §5.AG `assessRunAttention`). The one genuinely-dead ASK, **`clarifyingQuestionPending`**, is now sourced: derived
from the dedicated `latestHookActivity.notificationType === "user_attention"` marker the event-adapter stamps for
`ask_followup_question`/`plan_mode_respond` (state→awaiting_review, reviewReason "hook"). Folded conditionally
(byte-identical when no question). The live bridge now surfaces "card X is asking you something · respond" as a
`needs_input` ASK that breaks quiet mode. `awaitingHostActionAck` deliberately left false (sandboxed cards have no host
actions — a chat-path concept). 2 wiring tests; full fast suite green; todo §5.AT item 4 marked done + CHANGELOG.
**Lesson:** todo.md `[ ]` markers can be stale for built-but-unreconciled work — read the actual code before trusting the
checkbox (this is the SECOND stale-status find, after the bridge itself).

### ★ NEXT (next iteration) — §5.AT items 5–8, then §5.AU
Item 4 is done. **Item 5 (Seam-3 live UI)** is the natural next: a hub `chat_message_appended` event (mirror the existing
`task_chat_message`) + a client refetch of `chat.getTranscript` in `use-chat-data.ts`, so a server-pushed system message
(the ASKs this bridge now emits) actually appears without waiting for the user's next turn or the 2.5s poll. This is a
functional UI slice (David greenlit) — verify with root+web tsc, web vitest, web:build. Then items 6 (user
controls/verbosity/mute + `get_board_status` pull tool), 7 (optional local-summarizer digest rewrite), 8 (record in
integrations.md). NOTE: re-read the code first — check what `use-chat-data.ts` + the hub already do before assuming a gap.

### ✓ SHIPPED (2026-07-06, same session) — §5.AT item 5 reconciled + item 6 pull-tool (fdc8dd1d)
The "re-read first" note paid off (THIRD stale-status find):
- **Item 5 (Seam-3 live UI) — FUNCTIONALLY MET, not owed.** `use-chat-data.ts:82-100` ALREADY polls the selected
  transcript every 4s specifically for the bridge's server-pushed messages (explicit §5.AT/§5.AU comment, paused during a
  streaming turn). So a pushed ASK surfaces in the OPEN sidebar without a user turn — the functional requirement is met.
  The hub `chat_message_appended` event is only a latency optimization (≤4s → instant) the original design explicitly
  deferred → moved to polishing scope. Did NOT build it (would be gold-plating per §5.0.6). Marked item 5 `[x]`.
- **Item 6 pull-tool — SHIPPED.** `get_board_status` chat tool (`createBoardReadTools`): composes
  `summarizeWorkspaceBoardHealth` → `buildBoardChatDigest({items:[], boardHealth})` → the "Board: N need you · …" rollup
  line (same renderer as the push path). Auto-offered via the resolver's board-toolset spread (no resolver edit needed —
  the set is spread wholesale). Injectable `loadBoardHealth` dep; 4 tests; safe-degrade with no path leak. Full fast suite
  green. Item 6 marked `[~]`.

### ★ NEXT — §5.AT item 6 remainder, then item 8, then §5.AU
Item 6 still owes: **per-session verbosity/mute/quiet config** — the bridge reads `verbosity`/`quiet` from `OwningChatRef`
but the wiring hardcodes `normal`/`false` (board-chat-feedback-wiring.ts:116); needs a config field + persistence
(precedent `readyForReviewNotificationsEnabled`) + a Settings toggle (functional UI slice). Push/desktop escalation needs
`PushNotification` infra (check what exists first). **Item 8** (record the bridge in docs/dev/integrations.md + it's
already in CHANGELOG) is a quick doc close-out. Then **§5.AU** (streams/addressing) — check its item states before
assuming, per the now-thrice-confirmed stale-checkbox lesson. Keep preferring: read the real code, ship the smallest
green functional slice, reconcile todo.md as you go.

### ✓ SHIPPED (2026-07-06) — §5.AT item 6 per-session MUTE, end-to-end (63e61263 backend, 8936dac0 UI)
A full-stack functional feature this iteration:
- **Backend/runtime (63e61263):** `feedbackMuted` persisted per-session field (mirrors `browserEnabled` through
  contract → chat-service → chat-session-store → replay, back-compat default false), settable via `updateSession`,
  honored LIVE by the board→chat bridge. Key correctness call: the wiring's `resolveOwningChat` now caches only the
  owning session id and RE-READS the session each resolve — caching the whole `OwningChatRef` would have pinned `muted`
  at its first-seen value so a toggle never took effect until restart. `muted` → `decideBoardChatFeedback` suppresses
  every tier. 3 tests.
- **UI (8936dac0):** a 🔔/🔕 "Mute board updates" toggle in `chat-sidebar.tsx`, shown only for a chat that owns a
  workspace. Web gate green (web tsc + 883 vitest + build).
- **Bonus — a PRE-EXISTING stale web test fixed:** running the web suite for the UI slice surfaced
  `board-state.test.ts` asserting a backlog↔backlog reverse link adds both ways, but the 2026-07-05 cycle guard rejects
  the reverse edge (`would_create_cycle`) — the root test was flipped then, this web copy was missed. Fixed (§4A: never
  waive a surfaced failure). **Lesson:** the web-ui vitest suite (not run by the root pre-commit) can harbor stale twins
  of core tests — run `npm --prefix web-ui run test` when touching web-ui, and it may surface unrelated pre-existing rot.

### ★ NEXT — §5.AT item 8 (quick), then §5.AU
Item 6's core (mute) is functional end-to-end; the remainder (verbosity/quiet selectors, push escalation) is refinement —
lower priority than net-new feature-completeness. **Item 8**: record the board→chat bridge in
`docs/dev/integrations.md` (CHANGELOG already done) — a quick close-out. Then **§5.AU** (streams/addressing above cards +
multi-level chat addressing) — READ its item states first (the stale-checkbox lesson is now confirmed 4×). Prefer:
read real code → smallest green functional slice → reconcile todo.md. When touching web-ui, run the web gate
(web tsc + vitest + build) manually — the root pre-commit does not.

### ✓ SHIPPED (2026-07-06) — §5.AU get_streams pull tool + 3 stale-checkbox reconciles (5c738340)
Reading the code first (now the 5th confirmation of the lesson) turned a docs task into a feature:
- **Item 8 (integrations.md) was a MISMATCH, not owed work:** that registry is by charter for EXTERNAL integrations;
  the board→chat bridge is internal → closed as done (documented in §5.AT + CHANGELOG), not force-fit.
- **§5.AU item 6 (relay) was STALE `[ ]`:** `send_to_card` is built + wired (`createCardRelayTools`). Marked `[~]` —
  only `send_to_stream` remains.
- **Shipped `get_streams`** (item 10's lean-read half): a `sandbox_read` chat tool = new `summarizeWorkspaceBoardStreams`
  adapter (per-card signals from session+column, mirrors `summarizeWorkspaceBoardHealth`) → `summarizeBoardStreams` (done
  core) → new pure `renderBoardStreamsSummary` ("Streams (N): title · health · done/total · running"). Auto-offered via
  the resolver board-toolset spread; injectable `loadBoardStreams`; 6 tests; full fast suite green. This is the third
  `get_*` read tool composing a done operator core (get_board, get_board_status, get_streams — a clean, repeatable
  pattern).

### ★ NEXT — §5.AU remaining (feature-complete the streams/addressing epic)
Owed, roughly in value order: **item 9 second-half** (the chat FRONT DOOR relay — a targeted message actually routes
through `send_to_card`/mailbox per item 6, not just context injection; + the needs_clarify candidate-picker; + the rung-5
LLM disambiguator) — this is runtime/chat wiring composing built cores. **item 10 UI-proper** (the stream-overview
surface, the "talking to X" composer chip + breadcrumb, the stream→DAG→card drill) — functional UI slices (greenlit;
run the web gate). **`send_to_stream`** (item 6 remainder). Item 7 (optional local-summarizer digest rewrite) is
explicitly OPTIONAL — skip until the rest is done. READ each item's real state first. When §5.AU is drained, the
next epics are §5.AF durable scheduler / §5.AG operator UX / the §5.AR MCP wiring — but many of those need David's
inputs (egress URL for the online cluster, a Docker VM ≥ the 7.7 GiB the durable-scheduler validation needs).

### ✓ SHIPPED (2026-07-06) — §5.AU send_to_stream, item 6 complete (c7984158)
`send_to_stream`: broadcast one message to a stream's cards — deliver live to running members, queue the rest to their
mailboxes, never start a card. Composes the existing `deliverLive`/`queueMailbox` deps (no send_to_card refactor — a
stream broadcast is a simpler "guidance to all" semantic than the per-card WORK/CONSULT split), membership off
`card.streamId`, auto-offered via the resolver relay-set spread. 3 tests; full fast suite green. Also confirmed the
"talking to X" chip is already built (item 10 note corrected).

### ★ §5.AU is now feature-complete for its CORES + TOOLS — what's left is meatier
Done: all cores/schema/write-path/mailbox/session-state (items 1–5,7), both relay tools (item 6), the feedback bridge
(item 8), get_streams + the focus chip (item 10 partial), the front-door FIRST half (item 9). **The remaining two pieces
are NOT clean compose-a-core slices** (the pattern that produced the last 5 features):
- **item 9 second-half** — direct front-door RELAY (deterministic relay of an @card message instead of note-injection +
  model-called send_to_card) is a genuine UX BEHAVIOR change (relay-and-confirm vs answer-with-context) + the WORK/CONSULT
  nuance; the current note+tool path already works for a capable model, so this is robustness for weak models. Worth a
  David sanity-check on the intended UX before building. The candidate-picker + rung-5 LLM disambiguator need a model call.
- **item 10 stream-overview SURFACE** — a real functional-UI investment: needs a new tRPC endpoint returning
  `summarizeWorkspaceBoardStreams` (the board-independent chat client has no per-card session signals to roll up
  client-side) + a new panel component + the drill navigation. Meaty but greenlit; the biggest remaining §5.AU value.

### ★ NEXT — pick ONE: the stream-overview surface (meaty UI, high value), OR pivot epics
If continuing §5.AU: build the stream-overview surface = (1) a `chat.getBoardStreams`-style tRPC read composing
`summarizeWorkspaceBoardStreams`, (2) a panel in the chat sidebar listing each stream (title · health · progress ·
frontier) with click-to-focus, (3) the "N pending notes" mailbox indicator. Run the web gate. Otherwise the honest
alternative: §5.AU's clean-slice supply is drained (like the broader backlog was at iteration 2) — the highest-leverage
moves now increasingly need David (the SearXNG URL unblocks the whole §5.AC/§5.AB online cluster; a bigger Docker VM
unblocks §5.AF durable-scheduler live validation; a UX nod unblocks item 9). Surface these and let David steer.

### ✓ SHIPPED (2026-07-06) — §5.AU stream-overview surface, end-to-end (f0b85af9 backend, 0855fdf7 UI)
The meatiest slice of the run — a full multi-layer feature, both commits green:
- **Backend:** `chat.getBoardStreams` tRPC read (contract DTO + runtime-api → `summarizeWorkspaceBoardStreams` → the pure
  `toStreamOverviewRows` projection + the router query + the RuntimeApi interface). Empty on no-workspace/error. 2 projection tests.
- **UI:** `StreamOverviewPanel` in the chat sidebar (shown for a workspace-owning session) — one row per stream
  (health badge · title · done/total · running), 5s refresh, hidden when no streams. 3 component tests; full web gate green.
- **Real bug fixed in passing:** the panel's inline `queryFn` re-fired `useTrpcQuery`'s fetch effect every render (the
  effect keys on queryFn identity) — a refetch loop that surfaced as a test timeout. Memoized it with `useCallback`.
  NOTE for later: other `useTrpcQuery` callers (e.g. `use-chat-data.ts`) pass inline queryFns too — worth a sweep to
  confirm they don't refetch-storm (they may be saved only by the request-id race guard + infrequent renders).

### ★ §5.AU is now FEATURE-COMPLETE for its functional surface
Done end-to-end: addressing resolver, both relay tools (send_to_card + send_to_stream), the feedback bridge with live ASK
sourcing + mute (backend+UI), get_board_status/get_streams tools, the focus chip, AND the stream-overview surface. What
remains is genuinely lower-value or design-gated:
- **item 9 second-half** — direct front-door RELAY is a UX BEHAVIOR change (needs a David nod); the note+tool path already
  works for a capable model. The candidate-picker + rung-5 disambiguator need a model call.
- **item 10 drill** — stream→graph→card→thread navigation + click-to-focus + the mailbox "N pending" indicator. Lower value.
- **item 7** — the OPTIONAL local-summarizer digest rewrite. Explicitly optional.

### ★ NEXT — the honest read: the clean functional-slice supply across the ACTIVE epics is thinning
Six iterations shipped five+ features by finding compose-a-core slices; §5.AU is now drained of them. The remaining
high-value work is increasingly **David-gated**: (a) the **SearXNG URL** lights up the entire §5.AC/§5.AB/§5.M online
cluster (all cores built, dormant); (b) a **Docker VM > 7.7 GiB** lets §5.AF durable-scheduler default-on be validated
live; (c) a **UX nod on item 9** unblocks the deterministic front-door relay. A next iteration CAN still do the item 10
drill or hunt clean slices in §5.AG (operator UX) / §5.W (settings surfacing) — but they should be weighed against just
surfacing the three David-unblocks, since those open far more. If a scan finds no clean actionable-without-David slice,
say so plainly per the loop contract rather than manufacturing low-value motion.

### ✓ SHIPPED (2026-07-06) — a real refetch-loop bug fix (52c03bf7)
Followed up last commit's finding (the stream-panel test timed out under an inline `queryFn`): swept ALL `useTrpcQuery`
callers. **`use-chat-data.ts` was the LONE caller passing inline queryFns** (sessions + transcript) — every other caller
(git-history ×3, nklein-agent-chat-panel, use-runtime-config/project-config/workspace-changes) already memoizes with
`useCallback`. Since the fetch effect keys on queryFn identity, the chat sidebar's data hook re-fired the effect every
render → an unbounded refetch loop (sessions + the open transcript) whenever the sidebar was open. Fixed: memoized both
(transcript on `[client, selectedSessionId]` so it still reloads on session switch) + documented the stable-queryFn
contract on `UseTrpcQueryOptions` so it can't recur. Web gate green (tsc + 886 vitest + biome). No use-chat-data test
existed to catch it; the mechanism is now pinned by the stream-panel test + the contract doc.

### ★ NEXT — the David-gated frontier is real; remaining solo work is refinement or bug-hunt
This iteration was a genuine bug fix (not manufactured). The honest state stands: §5.AU's functional surface is complete,
and the high-value remaining work needs David (SearXNG URL / bigger Docker VM / item-9 UX nod). A next iteration's options,
in rough value order: (1) a LIGHT adversarial bug-hunt on this run's new §5.AU code (send_to_stream / get_streams / the
stream panel / the mute wiring) — the refetch-loop find shows this pays off, and a light self-review of just-shipped code
is in-scope (not the deferred extended sweeps); (2) the item-10 refinements (click-to-focus, mailbox "N pending") —
functional UI, lower value; (3) scan §5.AG / §5.W for a clean slice. If none surfaces real value, surface the three
David-unblocks and stop rather than pad. Prefer (1) — verifying our own recent work is the highest-confidence use of a
solo iteration.

### ✓ DONE (2026-07-06) — option (1) bug-hunt of this run's §5.AU code: 1 real bug found + fixed (831a8a0a)
Adversarially reviewed everything shipped this run. **One real bug:** `send_to_stream` resolved member cards by
flattening ALL columns including `trash` — a trashed card keeps its streamId (moveTaskToColumn doesn't clear it), so a
broadcast would queue notes on discarded cards + inflate the count. Fixed (skip trash, mirroring
summarizeWorkspaceBoardStreams) + a regression test; caught pre-release. **The rest checked out SOUND:** the mute re-read
(`getChatSession` normalizes `feedbackMuted` for old records → safe), `clarifyingQuestionPending` (mutually exclusive with
`deliveryGateHeld` via reviewReason; conditional fold stays byte-identical), the stream panel (active-workspace data
source is consistent with every other chat board tool + resolveMessageTargetIndex; the refetch-loop already fixed),
`get_streams`/`summarizeWorkspaceBoardStreams` (excludes trash; ungrouped excludes trash). No other defects.

---

## ★★ CONSOLIDATED STATE FOR DAVID (as of 2026-07-06, after the autonomous run) ★★

**What this multi-day run shipped (all green, on `feat/nklein-upcoming`, ~20 commits):** the §5.AU streams/addressing +
§5.AT board→chat epics are now FEATURE-COMPLETE end-to-end — the board→chat feedback bridge with live ASK sourcing
(incl. the "card is asking you a question" ASK), per-session **mute** (persisted + honored live + a UI toggle), the
`get_board_status` + `get_streams` + `send_to_stream` chat tools, and the **stream-overview UI panel** (a new
`chat.getBoardStreams` endpoint + a live-refreshing sidebar panel). Plus 2 real bug fixes found by self-review (a
chat-sidebar refetch loop; the send_to_stream trash broadcast) and continuous todo.md/CHANGELOG reconciliation (several
stale checkboxes corrected — the bridge, the focus chip, item 6/10 were all further along than marked).

**The 3 things that need YOU (each unlocks far more than any remaining solo slice):**
1. **A SearXNG backend URL** — the entire §5.AC/§5.AB/§5.M online-retrieval cluster is BUILT + wired + gated, dormant.
   Set `retrievalEgressEnabled` + the URL in Settings (a `docker/searxng/` backend is included) to light it up.
2. **A Docker VM > 7.7 GiB** — needed to validate the §5.AF durable scheduler default-on live.
3. **A UX nod on §5.AU item 9** — should an `@card`-addressed chat message RELAY-and-confirm (deterministic) or keep the
   current answer-with-context (model calls send_to_card)? The current path works for a capable model; the deterministic
   version is robustness for weak models but changes the chat UX.

**What remains actionable WITHOUT you (lower value):** §5.AU item-10 refinements (stream drill-down, click-to-focus,
mailbox "N pending" indicator); item-7 optional local-summarizer; scanning §5.AG/§5.W for clean slices. All the deferred
extended sweeps + the §5.AX visual overhaul remain in polishing.md for the post-implementation phase (with Fable).

**Loop status:** the high-confidence solo-work surface (compose-a-core feature slices + self-review of new code) is worked
through. Continuing yields diminishing returns until one of the 3 unblocks above. The recurring cron will keep the loop
alive; the next iterations should do a real lower-value slice IF one has genuine value, else say so plainly and idle
rather than pad — per the loop contract.

### ✓ SHIPPED (2026-07-06) — §5.AU item-10 click-to-focus (207e2d0f)
A genuine (if smaller) functional-UI slice: clicking a stream row in the overview panel appends its `@stream:<id>` handle
(the resolver's rung-1 syntax, same as the @-mention popover) to the composer draft + focuses it, so the next message
addresses that stream. `StreamOverviewPanel` gains an optional `onSelectStream` (rows are buttons when provided); ChatPanel's
`selectStream` does the append-with-separator + focus. 1 panel click test; full web gate green (887 vitest + build). The
stream overview is now interactive, not just informational.

### ★ NEXT — the remaining item-10 pieces are the last low-value slices; then it's David's move
§5.AU item 10 now has: get_streams · the overview surface · the focus chip · click-to-focus — all shipped. **Only two
pieces remain, both genuinely lower value / higher cost:**
- **Stream drill-down** (click a stream → its decomposition graph → a card → its thread, reusing `decomposition-graph-view`
  /`card-detail-view`). This is a REAL feature but a bigger navigation build in the chat context — the biggest remaining
  §5.AU piece by effort. Do it only as a committed multi-step slice, not a rushed tail.
- **Mailbox "N pending" indicator.** `countPendingCardMailbox` exists but summing it per-stream on every 5s poll = N file
  reads/poll (a perf cost for marginal value). Needs an endpoint change + a batched count. Low value / real cost — skip
  unless David wants it.
After these, the honest conclusion holds: **the actionable-without-David surface with genuine value is essentially
exhausted.** A next iteration should either commit to the drill-down (if worth the build) or STOP and surface the 3
David-unblocks per the loop contract — NOT keep dripping ever-smaller slices. Nine+ iterations have taken §5.AU/§5.AT from
"cores built, dark" to a fully feature-complete, interactive, self-reviewed epic; that is a clean stopping point pending
David's input.

### ⏸ LOOP PAUSED (2026-07-06) — actionable-without-David work exhausted; cron deleted to stop wasteful re-firing
Confirmed the exhaustion rigorously this iteration (not just re-asserted): scanned **§5.W settings-surfacing** — EVERY
config field is already exposed in `runtime-settings-dialog.tsx` (all 12 `*Enabled` booleans + concurrency/model-roles/
auto-review overrides + the skill-dynamics default & override; `effectiveSkillDynamicsLevel` is a derived read-only value,
not a missing control) → no gap. **§5.AG** = big self-improvement-quarantine safety infra or live-model work, no clean
slice. Combined with §5.AU being feature-complete, there is no remaining actionable-without-David slice with genuine value
(the drill-down is a big build whose priority is itself a David design call; the mailbox indicator is low-value/high-cost).

**Action taken:** DELETED the recurring cron (`597b046a`). Re-firing every 2 min to re-confirm "nothing high-value to do"
is exactly the token-wasteful padding the loop contract warns against. The loop is **instantly re-armable** — David can
provide any of the 3 unblocks, say "continue" / "build the drill-down", or point at a specific area, and a fresh session
re-enters via goal.md. All work is committed + pushed to `feat/nklein-upcoming`; the tree is green. See the CONSOLIDATED
STATE FOR DAVID section above for the full picture + the 3 unblocks.

### ▶ RESUMED (2026-07-06, David engaged) — 2 unblocks answered + item 9 relay-and-confirm SHIPPED
David answered the 3 unblocks: **(1) SearXNG** — run the bundled `docker/searxng/` (`docker compose -f
docker/searxng/docker-compose.yml up -d`), URL `http://localhost:18888`, set `retrievalSearchBackendUrl` + enable egress
in Settings. **(2) Docker VM** — David correctly pushed back; the >7.7 GiB was overstated. The 1-container + exec-cap
design works; the scheduler is validated + opt-in; default-on validation is low-priority + tunable (lower the exec-cap
for a small VM), NOT a real blocker. DROPPED it from the "needs you" list. **(3) item 9 relay-and-confirm — greenlit +
BUILT (3 commits, green + pushed):** extracted `applyCardMessageRelay` (shared relay path) → `chat-service`
`relayAddressedMessage` option (relay a card/answer-addressed message + confirm, skip the model turn; null ⇒ model turn)
→ `runtime-api` provides it from the active workspace's board + task-session + mailbox deps. A goal message still runs
the model; an @card message relays. 2 tests + the existing 31.

**Follow-ups noticed (small):** (a) the relayed message keeps its `@card:<id> ` handle prefix — the card agent sees the
handle noise; strip the leading handle before delivery for a clean message. (b) STREAM relay from the front door (needs
send_to_stream's broadcast extracted like applyCardMessageRelay). (c) needs_clarify candidate-picker + rung-5
disambiguator. (d) live-verify the relay in the running app (a hot-path change; deterministic tests cover the logic).
The loop stays interactive (David is engaged); cron NOT re-armed.

### ▶ 2026-07-06 (David: "1 turn on / 2 go on / rearm the loop")
1. **EGRESS TURNED ON — LIVE + VERIFIED.** `~/.nklein/config.json` already had `retrievalEgressEnabled:true` +
   `retrievalSearchBackendUrl:http://localhost:18888`. Launched Docker Desktop, brought up the bundled SearXNG
   (`docker compose -f docker/searxng/docker-compose.yml up -d` → container `nklein-searxng` Up on 127.0.0.1:18888),
   and CONFIRMED live results (`/search?q=…&format=json` → 6 real hits: claude.ai, anthropic.com, …). The
   §5.AC/§5.AB/§5.M online-retrieval cluster is now UNBLOCKED + running. (NOTE: SearXNG must be re-`up`'d after a Docker
   restart; `docker compose … down` to stop.)
2. **"go on" — shipped item-9 follow-up (a): handle-strip (8ec78461).** Pure `stripAddressingHandle` (word-boundary-aware
   so `user@host` is safe; focus-resolved messages pass through) — the card's agent now receives "use bcrypt" instead of
   "@card:card-1 use bcrypt"; the chat transcript keeps the user's original. 5 tests. Remaining item-9 follow-ups: stream
   relay from the front door, needs_clarify candidate-picker, rung-5 disambiguator, live-verify.
3. **RE-ARMED the loop** — recurring cron `e0042a87` (every 2 min, session-only, 7-day expiry); its prompt notes egress
   is live + the item-9 follow-ups. The autonomous grind resumes.

### ▶ 2026-07-06 (loop resumed) — item-9 stream relay + egress live-validated
- **§5.AU item 9 STREAM relay from the front door DONE (de30b26f):** extracted `applyStreamMessageBroadcast` (shared
  broadcast path, mirrors applyCardMessageRelay; send_to_stream now delegates — 31 tests unchanged) + `relayAddressedMessage`
  dispatches `stream` targets to it. An @stream-addressed chat message now broadcasts to the epic's cards (deliver
  live / queue) + confirms, no model turn; both card + stream relays handle-strip. **Item 9's core is complete:** card
  relay + stream relay + handle-strip all shipped. Remaining: needs_clarify candidate-picker + rung-5 disambiguator only.
- **EGRESS LIVE-VALIDATED end-to-end (`scripts/verify-egress-live.mts`):** real client → the running SearXNG → real
  internet = 8 results ("Claude Opus \ Anthropic" …); egress-OFF ⇒ `blocked_by_egress`, null-backend ⇒ `no_backend`
  (fail-closed gates hold); title+url mapping correct. `EGRESS LIVE-VALIDATED ✓`. The online-retrieval SEARCH path is
  confirmed working live. (Fuller end-to-end — a live model driving the `research` LOOP search→rank→fetch→synthesize — is
  a heavier live-run, not done here; the search client + gates are proven.)

### ★ NEXT — item-9 candidate-picker (a clean 3-layer slice for a fresh iteration)
The needs_clarify candidate-picker: when addressing is ambiguous (>1 slug/ASK match), surface the target's `candidates`
to the USER as clickable chips (reusing the stream-click → @handle-insert pattern) instead of the model guessing/asking.
= contract (add `clarifyCandidates` to the sendMessage response) + chat-service (needs_clarify ⇒ return a deterministic
clarify prompt + candidates, skip the model turn) + a UI picker in the chat composer. Then the rung-5 LLM disambiguator
(a model call — lower priority). After those, item 9 is fully done and §5.AU is complete end to end.

### ▶ 2026-07-06 (loop resumed) — needs_clarify candidate-picker SHIPPED (f8b13073)
Built the picker end-to-end, all 3 layers, full gate green (root fast + web tsc + 887 vitest + build):
- **Contract:** `runtimeChatClarifyCandidateSchema` + `clarifyCandidates` on the sendMessage response AND the `done` event.
- **chat-service:** needs_clarify (>1 slug/ASK match) ⇒ post a deterministic "Which did you mean? (labels)" + return the
  candidates, NO model turn. 1 test (duplicate-title cards ⇒ `@slug` ⇒ candidates, model never runs).
- **Wiring:** runtime-api.sendChatMessage forwards `clarifyCandidates` (+ fixed a latent `targetLabel` drop) → chat-router
  `done` event → `use-chat-data` captures it + exposes `clarifyCandidates`/`dismissClarify`.
- **UI:** the composer renders a `chat-clarify-picker` — one chip per candidate; click inserts its `@card:`/`@stream:`
  handle into the draft + dismisses, so the re-send resolves unambiguously (reuses the stream-click pattern).

**§5.AU item 9 is now feature-complete for the interactive path:** card relay + stream relay + handle-strip + picker all
shipped. The ONLY remaining piece is the **rung-5 LLM disambiguator** — and it's genuinely low-value now: the picker
surfaces candidates to the USER (deterministic, user-in-control), so an LLM guess is only relevant in a HEADLESS/autonomous
context with no user to click. Needs a model call; leave it unless a headless-disambiguation need arises. **§5.AU/§5.AT are
now essentially complete end to end** (feedback bridge + mute + relay + streams + picker), and the online-retrieval cluster
is live + search-validated. The high-value backlog that's actionable-without-David is, again, essentially worked through.

### ▶ 2026-07-06 (loop resumed) — ★ ONLINE-RETRIEVAL CLUSTER VALIDATED END-TO-END WITH A LIVE MODEL
Ran `scripts/verify-egress-model-e2e.mts` against the loaded **gpt-oss-120b** + the live SearXNG. The WHOLE egress feature
is proven: the model **emitted a `web_search` tool call** (finish=tool_calls) → its query hit live SearXNG → **8 real
results** → the model **used them** in its answer (correctly returned `https://www.anthropic.com/claude/opus`). This is
`model → tool-call → egress → real results → answer` working live — the §5.AC/§5.AB/§5.M cluster is no longer just "built +
dormant", it's **built + LIVE + validated end-to-end**. (Loaded set: gpt-oss-120b + coder-gpu; SearXNG up on :18888.)

**Newly UNBLOCKED by live egress (now exercisable, previously egress-gated + dark):** the swarm `research` tool +
freshness→online-refetch (§5.M/§5.AC), online model research (§5.AB), and the **llmfit catalog-freshness check** (§5.AL /
integrations.md — periodically check HF for a newer model DB + user-triggered update; the one clearly-scoped owed slice
egress unblocks). These are BUILD items (not just validation), the freshness-check being the most bounded.

**Milestone:** the two biggest things David unblocked this run (item-9 UX + egress) are both DONE — item 9 feature-complete,
egress live + E2E-validated. The high-value actionable-without-David surface is again worked through; the remaining
egress-enabled items are real BUILD slices (catalog-freshness check being the cleanest) a next iteration can take, else
surface to David.

### ⏸ LOOP PAUSED (2026-07-06) — boundary re-confirmed rigorously; cron `e0042a87` deleted
Scanned the egress-enabled surface to be sure before stopping: the freshness/retrieval/online-research cores
(`isKnowledgeStale`, `judgeRetrievedFreshness`, the retrieval loop, `buildNKleinModelFreshnessAdvisorRequest`) are ALL
already wired to the hot path — live egress just makes them work (now E2E-validated). No dark core to light up. The two
nominally-remaining items don't survive scrutiny:
- **rung-5 LLM disambiguator** — would be a DARK CORE with no consumer (the interactive needs_clarify path uses the
  deterministic picker just shipped; no headless caller uses addressing). Building it = the exact "built-not-running"
  anti-pattern §5.0.5 warns against. Skip until a headless-addressing consumer exists.
- **llmfit catalog-freshness check** — research-dependent (needs llmfit's internal DB-version mechanism + the HF dataset)
  on a `partial`, off-by-default integration. Not a clean slice; David-priority + a research spike.

**Conclusion:** no high-value slice remains actionable without David. Paused the cron (re-firing every 2 min to
re-confirm this burns tokens — the anti-pattern the loop contract warns against). Instantly re-armable. **The next move is
a product-DIRECTION call** (what's the next big capability to build) — the feature-complete backlog for the current phase
is essentially drained; the deferred work (extended sweeps, §5.AX visual overhaul, architecture refactor, comprehensive
coverage) all lives in polishing.md for the post-implementation phase, per §5.0.6. All work committed + pushed to
`feat/nklein-upcoming`; tree green.

### ▶ POLISHING PHASE STARTED (2026-07-06, David: "start polishing and rearm loop")
Recorded the phase transition (todo §5.0.7): Opus takes code-quality/coverage/verification (§5.U refactor, §5.V, §5.Z,
§5.AZ); the §5.AX visual overhaul is for a FABLE session. Re-armed the cron (`4e9ebe88`, polishing prompt). **First
§5.U slice shipped (3bff404c):** the flagship monolith is `nklein-task-session-service.ts` at **4944 lines**. Extracted
the pure byte-stability-critical core of `assembleSessionSystemPrompt` → `buildSessionSystemPrompt`
(`nklein-session-system-prompt.ts`, ~50 lines): the churn-ordered fragment build + skill-dedup + assembly (§5.AQ shells).
The method delegates + keeps only the stateful warmth-ledger bookkeeping. Behavior-preserving; the previously-UNTESTED
§5.AQ ordering/dedup logic now has 6 unit tests. Full gate green.

**§5.U decomposition plan (for the grind):** the file is ~90% the `InMemoryNKleinTaskSessionService` CLASS (~4400 lines).
The class is heavily instance-stateful, so the pattern is: (1) extract PURE sub-computations embedded in methods →
tested pure modules (like this one — assembleSessionSystemPrompt, resolveTaskModelIdentity/resolveProviderIdForTask,
buildRetrievalExtraTools's gate logic are candidates); (2) once the pure logic is out, do the harder responsibility-split
(review-loop, plan-critique, speculative-mirror, mailbox as collaborator modules owning their sub-state). Each slice
behavior-preserving + test-gated + one commit. Also targets: runtime-server.ts (2527), nklein-provider-service.ts (1651).
Migrate §5.U/§5.V progress notes to polishing.md as the grind proceeds.

### ▶ §5.U slice 2 (2026-07-06, bae64aa4) — extracted nklein-launch-config
Moved the launch-config concept out of the monolith into `nklein-launch-config.ts` (53 lines): the two types
(`NKleinTaskLaunchConfigOverrides` + `NKleinTaskRestartLaunchConfig`) + the pure `normalizeLaunchConfig` (the subtle
`Object.hasOwn` present-vs-absent field normalization from `cacheLaunchConfig`). Service + acceptance-auto-repair import
from the new module; `cacheLaunchConfig` delegates + keeps only its store writes. Behavior-preserving; the
leave-unchanged-vs-clear-on-restart contract now has 6 unit tests (incl. the present-but-undefined `?? null` edge). Full
gate green. **Progress:** nklein-task-session-service.ts 4944 → 4893 lines; two cohesive concepts (prompt assembly, launch
config) now live in focused, tested modules. Pattern holds — keep pulling pure sub-computations before the harder
responsibility-split. Next candidates: `buildRetrievalExtraTools`'s egress-gate decision, the `resolvePersistedLaunchConfig`
merge logic, the plan-critique/review-loop budget helpers.

### ▶ §5.U slice 3 (2026-07-06, b55aa498) — extracted shouldAttachRetrievalTools (the fail-closed egress gate)
Pulled `buildRetrievalExtraTools`'s 4-condition attach gate (synthetic-session ⇒ no egress · egress literally `true` ·
§5.L role gate · a search backend configured) into the pure `shouldAttachRetrievalTools`
(`nklein-retrieval-tools-gate.ts`). Method delegates + builds the tool only on `true`. Behavior-preserving (byte-identical
to the return-`[]` guards); this **security-relevant** gate now has 5 unit tests. Full gate green. **Progress:**
nklein-task-session-service.ts now **4886 lines** (from 4944); THREE cohesive concepts extracted + tested this run
(prompt assembly, launch config, retrieval-tools gate). Next: `resolvePersistedLaunchConfig` merge logic, the
plan-critique / review-loop budget helpers, then the harder responsibility-split (review-loop/plan-critique/mailbox as
collaborators). Then runtime-server.ts (2527) + nklein-provider-service.ts (1651).

### ▶ §5.U slice 4 (2026-07-06, b684bff3) — extracted nklein-provider-settings-summary
Pivoted to `nklein-provider-service.ts` (1651 lines) — which, unlike the class-heavy task-session-service, is mostly PURE
module-level functions (much cleaner cut seams). Extracted the cohesive "SDK settings → `RuntimeNKleinProviderSettings`
summary" mapper cluster (`toProviderSettingsSummary` + `createEmptyProviderSettingsSummary` + `toRuntimeReasoningEffort`)
into its own module — all deps are shared-module imports (credential-helpers / id-classification), so no ripple. Service
imports them back + dropped the now-unused `SdkReasoningEffort` alias + 2 credential-helper imports. Behavior-preserving;
the projection (trimming, reasoning mapping, and the security property "report credential PRESENCE, never the values") now
has 6 unit tests. Full gate green. **Progress:** provider-service 1651 → 1601. **Run total: 4 §5.U slices, ~24 new unit
tests, 4 focused modules extracted** (session-system-prompt, launch-config, retrieval-tools-gate, provider-settings-summary).
provider-service has MANY more pure clusters (LiteLLM/LM Studio model-list discovery, provider-selection persistence,
remote-config parsing) — the cleanest ongoing target. Next.

### ▶ §5.U slice 5 (2026-07-06, 4c710789) — extracted nklein-litellm-model-list
Continued on provider-service. Moved the cohesive LiteLLM `/models` protocol cluster — the response schema, the candidate
pathnames + their derived types, and the pure header/item-id/roster-merge helpers (`hasAuthorizationHeader`,
`resolveLiteLlmModelListHeaders`, `resolveLiteLlmModelListItemId`, `appendMissingModels`) — into its own module. All deps
are shared-module imports, so no ripple; the two fetchers stay in the service and import the helpers back.
Behavior-preserving; +9 unit tests (case-insensitive auth-header detection, Bearer injection without clobbering,
`/model/info` vs `/models` id resolution, dedup-backfill merge). Full gate green. **Progress:** provider-service 1601 → 1576.
**Run total: 5 §5.U slices, ~33 new unit tests, 5 focused modules extracted.** Next candidate: the LM Studio + generic
`discoverModelsFromEndpoint` fetchers are I/O-bound (harder), but `resolveModelListSettings` (catalog base-URL resolution)
is nearly pure and testable — a good next cut once its `listSdkProviderCatalog` dep is injectable.

### ▶ §5.U slice 6 (2026-07-06, d494ddf7) — extracted nklein-managed-provider-credentials
Moved the cohesive managed-provider (nklein / oca / openai-codex) credential-resolution cluster — the
`MANAGED_PROVIDER_ENV_KEYS` table, `readEnvApiKey`, `resolveManagedProviderEnvApiKey`, and
`resolveManagedProviderLaunchApiKey` (the oauth→settings→env precedence + the "sign in from Settings" error) — into its
own module. All deps are shared-module imports, so no ripple; the service imports the launch-key resolver back and drops
the now-unused `formatManagedProviderDisplayName` import. Behavior-preserving; +8 unit tests (env trim/blank, the
oauth>settings>env precedence, both error branches with/without an env-var hint). Full gate green. **Progress:**
provider-service 1576 → 1535 (down 116 from the 1651 run-start). **Run total: 6 §5.U slices, ~41 new unit tests, 6 focused
modules extracted.** Remaining provider-service clusters: provider-selection persistence (file I/O, ~4 fns), remote-config
parsing, and `resolveModelListSettings`. After that, runtime-server.ts (2527) is the next monolith.

### ▶ §5.U slice 7 (2026-07-06, 14815baa) — extracted nklein-provider-selection-store
Moved the provider-selection persistence cluster — `KANBAN_PROVIDER_SELECTION_SCHEMA` + `getKanbanProviderSelectionPath`
(env override / runtime-home path) + `readKanbanSelectedProviderId` (tolerant read) + `writeKanbanSelectedProviderId`
(mkdir -p + write) — into its own module. The service imports the read/write pair back; biome then dropped the
now-unused `node:fs` / `node:os` / `node:path` / `runtime-paths` imports from the service (a nice knock-on: the
persistence concern was the service's only remaining direct filesystem dependency). Behavior-preserving; +6 unit tests
over a temp file via the `KANBAN_NKLEIN_PROVIDER_SELECTION_PATH` override (round-trip + dir creation, trimmed-lowercase
normalization, missing / malformed / blank ⇒ null). Full gate green. **Progress:** provider-service 1535 → 1502
(down 149 from the 1651 run-start). **Run total: 7 §5.U slices, ~47 new unit tests, 7 focused modules extracted.**
Remaining pure-ish provider-service clusters: remote-config parsing (`parseNKleinRemoteConfigValue` + schema) and
`resolveModelListSettings` (needs `listSdkProviderCatalog` injected to test). Then runtime-server.ts (2527).

### ▶ §5.U slice 8 (2026-07-06, 5c3f122b) — extracted bounded-dedup-set from runtime-server
First cut into runtime-server.ts (2527). The terminal-outcome dedup was a module-global `Set` + a cap constant + a free
`rememberRecordedTerminalRun()` function — mutable process-global state living in the server module. Generalized it into a
reusable `createBoundedDedupSet(capacity)` factory (insertion-ordered, FIFO-evicting, `has`/`remember`/`size`), so
runtime-server just holds an instance and no longer owns the eviction logic or a bare global `Set`. Behavior-preserving
(same 5000 cap, same fold-once-per-run semantics at the §5.AA/§5.AB call site); +5 unit tests (membership, idempotent
remember, FIFO eviction, Set re-insert ordering, capacity guard). Full gate green. **Progress:** runtime-server 2527 →
2518 (modest lines, but the mutable global is gone and the eviction rule is now deterministically tested). **Run total:
8 §5.U slices, ~52 new unit tests, 8 focused modules extracted** (session-system-prompt, launch-config,
retrieval-tools-gate, provider-settings-summary, litellm-model-list, managed-provider-credentials,
provider-selection-store, bounded-dedup-set). Next runtime-server candidates: `retryWorkspaceStateLock` (+ its backoff
schedule; a general retry-on-lock-error util used in 4 places) and `resolveReviewSandboxResult` / `isEmptySandboxPatchSummary`
(sandbox-result polling). The bulk of runtime-server is the ~2300-line `createRuntimeServer` closure — inner pure helpers
there are the deeper target once the free-function seams are exhausted.

### ▶ §5.U slice 9 (2026-07-06, a67982d5) — extracted workspace-state-lock-retry from runtime-server
Second cut into runtime-server. Moved `retryWorkspaceStateLock` + its backoff schedule into a dedicated module, adding an
injectable `sleep` (defaults to real `setTimeout`) so the retry control flow is testable without real timers or real lock
contention. The service imports it back (4 call sites) and biome dropped the now-unused `isWorkspaceStateLockError`
import. Behavior-preserving (same schedule; "retry only lock errors, propagate everything else, rethrow after exhaustion");
+4 unit tests (first-try success = no sleeps, retry-then-recover along the schedule, immediate non-lock propagation,
rethrow after exhaustion). Full gate green. **Progress:** runtime-server 2518 → 2496.

### ▶ §5.U slice 10 (2026-07-06, c0a77e70) — extracted review-sandbox-result from runtime-server
Third cut into runtime-server. Moved the review sandbox-result probe (`resolveReviewSandboxResult` +
`isEmptySandboxPatchSummary` + its poll schedule) into a dedicated module, converting the two I/O probes (session-summary
read + result-branch lookup) and the sleep into an injected `ReviewSandboxResultProbe` — so the poll-until-or-give-up
loop is deterministically testable without real timers, git, or a live service. Call site passes
`{ getSummary: (id) => service.getSummary(id), resolveResultCommit: resolveTaskResultBranchCommit }`. Behavior-preserving
(same immediate-first-pass, same empty_patch / result_branch / unknown outcomes, same schedule); +5 unit tests (predicate
+ all four loop outcomes incl. poll-until-appears with counted sleeps). Full gate green. **Progress:** runtime-server
2496 → 2468. Also migrated a §5.U section into `polishing.md` (per the phase directive) with the live tally + next targets.

### ▶ §5.U slice 11 (2026-07-06, 12eb29e6) — extracted nklein-model-list-settings
Back on provider-service. Moved `resolveModelListSettings` (the "which settings do we call the model-list endpoint
with?" resolver — prefer caller settings when they already point at the right provider with a base URL, else fill the base
URL from the SDK provider catalog) into its own module, injecting the catalog lister so its branching is testable without
the real SDK. Both fetchers pass `listSdkProviderCatalog`. Behavior-preserving; +7 unit tests (all six branches +
catalog-rejects-is-empty tolerance). Full gate green. **Progress:** provider-service 1502 → 1472.

### ▶ §5.U slice 12 (2026-07-06, 36bde787) — extracted nklein-kanban-access-policy
Last clean pure seam in provider-service. Moved the kanban-access policy — the remote-config schema/type/parser plus a new
pure `computeKanbanEnabled()` capturing the enterprise-gating decision that was an inline boolean at the call site (kanban
open by default; gated shut only for an enterprise customer whose remote config doesn't explicitly set `kanbanEnabled:true`)
— into its own module. Behavior-preserving; +7 unit tests (parse: valid / unknown-field / malformed / wrong-type;
computeKanbanEnabled: the full truth table). Full gate green. **Progress:** provider-service 1472 → 1463.

### ▶ CLEAN-SEAM EXHAUSTION FINDING (2026-07-06, after slice 12) — the easy §5.U work is done; what's left is the hard split
Surveyed all four largest files after slice 12. **The safe, behavior-preserving pure-function seams are now exhausted:**
- `nklein-provider-service.ts` (**1463**): remaining functions are I/O-bound and coupled to the `createNKleinProviderService`
  factory (the fetchers, `loadProviderModels*`, `refreshManagedOauthSettings`) — not clean pure lifts.
- `runtime-server.ts` (**2468**): the only top-level function left is the ~2300-line `createRuntimeServer` closure itself.
- `nklein-session-runtime.ts` (**1487**): its pure functions (`buildNKleinContextCompactionConfig`,
  `readKanbanLaunchConfigFromSessionRecord`, `doesNKleinToolInvalidateRepoMap`) are ALREADY well-tested in
  `test/runtime/nklein-agent/nklein-session-runtime.test.ts` — moving them is low-value churn with cross-file (and type-cycle)
  ripple; the rest is the `InMemoryNKleinSessionRuntime` class.
- `nklein-task-session-service.ts` (**4886**): ~90% one class (`InMemoryNKleinTaskSessionService`), only 2 top-level functions.
**What remains is the responsibility-split** — extracting collaborator classes (review-loop / plan-critique / mailbox) from
the task-session-service class, and decomposing the `createRuntimeServer` closure. That is a multi-commit, higher-risk
undertaking (mutable state to thread through DI, larger blast radius) that should be started with a FRESH context budget so
behavior-preservation and the "never weaken a test" rule stay reliable — NOT continued at the tail of this long session. This
is the recommended entry point for the next Opus polishing iteration.

### ▶ §5.U slice 13 (2026-07-06, c349bdbf) — extracted nklein-mcp-oauth-settings-store + CORRECTION to the exhaustion finding
**The "clean-seam exhaustion" finding above was too narrow — it only surveyed the big-3 + session-runtime.** The
NEXT TIER of large files (mcp-runtime-service 949, workspace-state 1046, agent-sandbox 1090, projects-api 1001,
task-board-mutations 764, dev.ts 1230) has plenty of clean cohesive seams — and some are UNTESTED, so extracting them
is §5.U (monolith reduction) AND §5.V (coverage) at once. That's the productive vein; the risky big-3 class-splits can wait.
Slice 13 proves it: moved the cohesive **MCP OAuth settings store** out of `nklein-mcp-runtime-service.ts` — the
oauthServerState/settings schemas + types, path resolution (env override / sibling of the MCP settings file), the
normalize / isEmpty / parse (validate + path-scoped errors) / atomic-locked write / transactional `updateOauthServerState`
(read→apply→normalize→prune→write), and `hasAccessToken`. The service imports the pieces back; biome dropped the now-unused
`node:fs` / `node:path` / `resolveMcpSettingsPath` imports. Behavior-preserving (existing mcp-runtime-service test still
green); this cluster was **previously untested** and now has +12 unit tests over a temp file. Full gate green.
**Progress:** mcp-runtime-service 949 → **843**.

### ▶ §5.U slice 14 (2026-07-06, 0730f224) — extracted nklein-mcp-transport-factory
Second cut into mcp-runtime-service. Moved the MCP transport/registration construction — `toMcpRegistration`,
`createTransport` (stdio/sse/streamableHttp), `isAuthCapableTransport` guard, `formatLocalMcpExecutionDisabledWarning` +
the disabled message, and the `SdkTransport`/`AuthCapableTransport` type aliases — into its own module. The service imports
them back; biome dropped the now-unused SDK transport-class imports. Behavior-preserving (existing test still green); was
previously UNTESTED, now +7 unit tests. Full gate green. **Progress:** mcp-runtime-service 843 → **777** (−172 from 949).

### ▶ §5.U slice 15 (2026-07-06, df61b6af) — extracted nklein-agent-sandbox-predicates
Into agent-sandbox.ts (1090). Moved the four PURE, cycle-free predicates — `isContainerMissingError`, `escapeRegExp`,
`isAgentSandboxWorkspaceVolumeName`, and the `isAgentSandboxExecResult` structural guard — into their own module; the two
error-BUILDING helpers (`toSandboxUnavailableError` / `assertSandboxExecOk`, which construct the sandbox error classes)
stay with the service, which imports the predicates back. The `AgentSandboxExecResult` dep is `import type` only, so the
new module has NO runtime edge back to the service — no import cycle (the deliberate split line: pure predicates out,
error-factories stay). Behavior-preserving (56-test agent-sandbox suite still green); previously UNTESTED, now +4 unit
tests (12 assertions). **Progress:** agent-sandbox 1090 → **1071**.
Coverage-landscape note from this iteration's survey: `task-board-mutations.ts` (764) is ALREADY fully tested; the
large-file cursor helpers are entangled with a heavy `LargeFileState` fixture + a partly-tested sibling; the agent-sandbox
error CLASSES have wider importer ripple (task-session-helpers + 5 test files) so re-homing them is a separate, larger slice.

### ▶ §5.U slice 16 (2026-07-06, d3e728d7) — extracted nklein-event-adapter-tool-activity
Into event-adapter.ts (806). Moved the three pure tool-activity classifiers — `getRetainedNKleinToolActivity`,
`isReviewableAbortedToolCompletion` (aborted turn ended on a mutating tool result?), and `isRecoverableToolCallFailure`
(the SDK "tool call(s) failed" marker) — into their own module. Deps come from the lower-level `nklein-session-state`
(no cycle); the adapter imports the trio back. Behavior-preserving (47-test event-adapter suite still green); these sit on
a critical path (SDK events → session summaries) and were previously UNTESTED, now +3 tests (11 assertions).
**Progress:** event-adapter 806 → **768**.

### ▶ §5.U slice 17 (2026-07-06, 1a6051a4) — FIRST cut into the flagship: lifted shouldCaptureReviewCheckpoint
First reduction of `nklein-task-session-service.ts` (4886) this run. `shouldCaptureReviewCheckpoint` was a PURE private
method (reads only its two summary args + `isHomeAgentSessionId` — no `this`), and its final condition was a byte-for-byte
copy of the entering-awaiting-review transition that the sibling `shouldFinalizeSandboxReview` already delegates to
`isEnteringAwaitingReview`. Moved it into the existing `src/core/task-session-guards.ts` next to that helper, reusing it
(transition rule no longer duplicated); the service imports + calls it as a free function. Behavior-preserving (with `next`
already non-null, the copied condition IS `isEnteringAwaitingReview(prev, next)`); previously UNTESTED, now +5 tests in the
guards suite. **Progress:** task-session-service 4886 → **4873**. **Pattern for the flagship:** lift PURE private methods
(no `this`) into the core guard/helper modules + test — safe, and it de-duplicates. `normalizeEffectiveContextWindow` is
just `Math.trunc` (not worth it) and the neighboring context-window resolvers touch `this` stores (not pure); the bigger
reduction still needs the collaborator responsibility-split.

### ▶ §5.U slice 18 (2026-07-06, 4416365c) — extracted nklein-mcp-oauth-callback
Third cut into mcp-runtime-service. Moved the MCP OAuth callback-URL protocol — the callback path + requestId param
consts, `buildMcpOauthCallbackUrl`, and `createOauthClientMetadata` — into their own module, and replaced the handler's
inline path-check + requestId-parse with two pure reads (`matchesMcpOauthCallbackPath` + `readMcpOauthCallbackRequestId`)
so the handler's registry logic no longer inlines the URL protocol. Behavior-preserving (the reader's
`get(param)?.trim() || null` is identical under the `if (!requestId)` guard; existing test still green); previously
UNTESTED, now +7 tests. **Progress:** mcp-runtime-service 777 → **762** (−187 from 949).

### ▶ §5.U slice 19 (2026-07-06, ee02578e) — extracted nklein-large-file-workflow-helpers
Into large-file-workflow.ts (781). Moved the five pure stateless helpers — `sanitizePathSegment`, `filterToolsByName`,
`hasSynthesisText`, `formatOutputHeader`, `createRailMessage` — into their own module; the workflow imports them back (the
staying `formatStitchingAreaContent` now imports `formatOutputHeader` from there). biome dropped the now-unused
AgentMessage / AgentToolDefinition type imports. Behavior-preserving (12-test workflow suite still green); previously
UNTESTED, now +10 tests. **Progress:** large-file-workflow 781 → **740**.

### ▶ §5.U slice 20 (2026-07-06, d60ac262) — lifted readRequestBody + getRemoteIp out of the createRuntimeServer closure
Fourth cut into runtime-server.ts, and the FIRST into the ~2300-line `createRuntimeServer` closure itself (not just its
module-level helpers). `readRequestBody` + `getRemoteIp` were inner closures that captured NO server state (they use only
their `req` arg), so they lifted cleanly to a new `runtime-server-http` module; the closure imports them back.
Behavior-preserving (identical bodies, 4 KiB default cap preserved); previously UNTESTED, now +6 tests over a PassThrough
stream. **Establishes the pattern for chipping at the big closure: lift state-free inner helpers out.** **Progress:**
runtime-server 2468 → **2451**.

### ▶ §5.V slice 21 (2026-07-06, f934cabd) — coverage for untested api-validation request parsers
Pivot to pure §5.V coverage now that the safe pure-LIFT vein in the big files is largely mined. A coverage-gap scan
(exported fns never named in any test) surfaced `src/core/api-validation.ts` — ~44 tRPC boundary parsers, MANY untested
despite real post-schema logic (trim + emptiness + normalization, deliberately STRICTER than the Zod schema: a whitespace
value passes the schema but is rejected by the parser's `.trim()` check). Locked four — `parseCommandRunRequest`,
`parseTaskChatSendRequest`, `parseNKleinModelContextWindowOverrideRequest`, `parseWorktreeDeleteRequest` — with +12
characterization tests. NO source change → zero refactor risk, pure safety-net hardening on untrusted input. **New §5.V
vein: ~40 more api-validation parsers with real logic remain uncovered** — a steady low-risk coverage backlog.

### ▶ §5.V slices 22–23 (2026-07-06, 3f25c62b + 7d9dafe3) — api-validation parser coverage, batches 2 & 3
Continued the api-validation coverage backlog (pure tests, NO source change). Batch 2 (+13 tests): the six taskId-only
trimmers (each keeps its distinct blank-taskId error message), `parseTaskSessionInputRequest` (trims taskId but PRESERVES
text + appendNewline — text is NOT trimmed), and the URLSearchParams pair `parseTaskWorkspaceInfoRequest` (requires both
taskId + baseRef) + `parseOptionalTaskWorkspaceInfoRequest` (null when no taskId; a baseRef without taskId is rejected).
Batch 3 (+7 tests): `parseNKleinProviderModelsRequest`, `parseNKleinModelRegistryRemoveRequest`,
`parseNKleinModelMaxConcurrentRequestsRequest` (trim/normalize/blank-reject), and the two passthroughs
`parseDirectoryListRequest` + `parseNKleinAccountSwitchRequest`. **~20 of 44 api-validation parsers now covered; ~24 remain.**

### ▶ §5.V slices 24–25 (2026-07-06, 1e3944e5 + c5e8992e) — api-validation coverage, batches 4 & 5
Batch 4 (+11 tests): `parseProjectRemoveRequest`, `parseTaskContextImportRequest` (source-enum + target trim),
`parseProtectedTestApprovalGrantRequest` (trims taskId AND all four nested approval fields), `parseNKleinEndpointModelDiscoveryRequest`
(baseUrl trim, optional apiKey/modelsSourceUrl/timeoutMs → null), `parseShellSessionStartRequest` (trim taskId/baseRef,
preserve cols/rows, reject a defined-but-blank workspaceTaskId), `parseWorkspaceChangesRequest` (URLSearchParams pair).
Batch 5 (+6 tests): `parseNKleinMcpOAuthRequest`, `parseNKleinOauthLoginRequest` + `parseNKleinDeviceAuthCompleteRequest`
(the baseUrl "trim → null" normalization), `parseSelfImprovementProjectRequest` (optional payload → undefined). No source
change. **~30 of 44 api-validation parsers now covered; the ~14 remaining are mostly large passthrough schemas
(provider-settings-save, config-save, workspace-state-save, update-provider) or pure passthroughs (advisor/dogfood).**

### ▶ §5.V slice 26 (2026-07-06, 618d1efd) — api-validation coverage batch 6 (backlog COMPLETE)
+8 tests for the heaviest-normalization parsers: `parseNKleinUpdateProviderRequest` (providerId slugify, empty-header
filtering, model trim+dedup, headers:null passthrough), `parseNKleinProviderSettingsSaveRequest` (nested aws/gcp blank→null),
`parseTerminalWsClientMessage` (the one parser that returns NULL tolerantly instead of throwing), + the last two simple
trimmers. **api-validation §5.V backlog DONE: ~35/44 parsers characterized; the remaining ~5 (advisor build/send, dogfood,
config-save, workspace-state-save) are PURE schema passthroughs with no post-schema logic — intentionally left (a test would
only re-assert Zod).** Net: every api-validation parser that does anything beyond `schema.parse` is now covered.

### ▶ §5.V slice 27 (2026-07-06, 1940b6b7) — closed runtime-config-normalizers coverage gaps
New vein (recorded last iteration). `runtime-config-normalizers.ts` was mostly tested but had 7 genuine gaps — all now
characterized (+9 tests): `readLegacyDeveloperModeEnabled` + `normalizeDeveloperModeEnabled` (new-flag → legacy →
debug-env fallback precedence, env branch made deterministic by clearing NKLEIN_DEBUG/KANBAN_DEBUG/etc.),
`resolveProfileTimeoutDefaults` (cloud≡local non-null, custom all-null), `areAgentRulesetsEqual`,
`normalizeModelSuitabilityPolicy` + `areModelSuitabilityPoliciesEqual`, `normalizeSkillDynamicsLevel`. No source change.

### ▶ §5.V slice 28 (2026-07-06, 0f49f03c) — speculative/retrieval resolver normalizers + severity guard
Next scanned offenders. +6 tests over 6 pure functions from three modules: `normalizeSpeculativeBestOfNEnabled` (default-ON:
only explicit false disables), `normalizeSpeculativeMaxConcurrentSpecs` + `normalizeSpeculativeMaxSpecsPerRun` (keep-valid /
clamp-to-cap / default-on-invalid), `normalizeRetrievalEgressEnabled` (**FAIL-CLOSED**: only a strict boolean true enables
egress — a security-relevant property now locked), `normalizeRetrievalSearchBackendUrl` (trim / blank+non-string → default,
asserted relative to the default so it's not brittle), and `isSelfObservationSeverity` (four-literal enum guard). No source change.

### ▶ §5.V slice 29 (2026-07-06, 8a0bd1cc) — server helper coverage (normalizeRequestPath + getAllowedHostHeaders)
+5 tests: `normalizeRequestPath` (root → /index.html, query-string strip, percent-decode, plain passthrough — the
static-serve path normalization) and `getAllowedHostHeaders` (host allow-list: every entry is host:<runtime-port>; loopback
hosts allowed on a local bind). Left the I/O-bound `handleHttpRequest` (its pure sub-decisions evaluateHost/evaluateCors
are already tested) and the fs-probing `getWebUiDir`. No source change.

### ▶ §5.V slices 30–31 (2026-07-06, fb182551 + 40f62da1) — SECURITY coverage: passcode rate-limiter + windows-cmd escaping
Slice 30 (+6 tests): the passcode-auth rate-limiter (5 attempts → 30s lockout) was untested — locked the fresh-IP allow,
the attempt countdown, lockout after the 5th failure, `clearRateLimit` reset, the auto-unlock after the window (fake
timers), and `revokeAndRegeneratePasscode` (fresh passcode + clears lockouts); unique IP per test so the module-global map
doesn't leak. Slice 31 (+5 tests): windows-cmd launch — `resolveWindowsComSpec` (case-insensitive/trimmed, cmd.exe
fallback) and `buildWindowsCmdArgs{Array,CommandLine}` (the `/d /s /c` wrapping, the two forms kept consistent, and the
injection-safety property that a cmd meta char `&` is caret-escaped to `^&`). No source change.

### ▶ §5.V slices 32–33 (2026-07-06, f50ce449 + dac8e296) — plan-gap prompt builders + context-window-policy helpers
Slice 32 (+8 tests): the plan-gap / merge-integration card prompt builders (pure string composition, themselves a §5.U
extraction from the oversized task.ts) — `buildIntegrationCardPrompt` (bulleted paths vs no-paths fallback),
`buildPlanGapIntegrationCardPrompt`, `buildPlanGapDecisionCardPrompt` (contradiction vs missing-decision label by kind),
`buildPlanGapScopeCardPrompt` (evidence-appended-only-when-present, blank-description defaults). Slice 33 (+3 tests): the
context-window-policy helpers — `isNKleinContextWindowPolicyError` (instanceof guard), `normalizeNKleinContextWindow`
(Math.trunc / null on non-positive/non-finite/non-number), `formatNKleinContextWindowTokens` (locale-grouped, asserted via
delegation so it isn't locale-brittle). No source change.

### ▶ §5.V slices 34–35 (2026-07-06, 5bce61c3 + 9b8894ac) — plan-task-routing resolvers + task-start-guard helpers
Slice 34 (+7 tests): the two pure routing settings resolvers — `resolveTaskRoleSettings` (selectedRole overrides
task.suggestedRole; null/blank role → undefined; trimmed; absent role-settings → undefined; the conditional field-spread
that DROPS falsy strings but KEEPS a zero numeric timeout) and `resolveTaskModelSettings` (no candidate → role-only; a
candidate overrides provider/model while carrying the role's other fields). Slice 35 (+7 tests): the task-start-guard
helpers — `estimateNKleinStartPromptTokens` (+1000/image, title counted; relative asserts), `estimateNKleinStartFitBudgetTokens`
(prompt + safety-budget reserves + 4k min room, exact via buildKanbanContextSafetyBudgets; null → default window), and
`formatNKleinTaskRoutingBlockMessage` (decompose vs escalate framing). No source change.

### ▶ §5.V slices 36–37 (2026-07-06, 763de1e5 + 1cd4d0cf) — runtime-endpoint origins + session-state helpers (batch 1)
Slice 36 (+3 tests): the http/ws origin builders `getKanbanRuntimeOrigin` / `getKanbanRuntimeWsOrigin` — asserted relative
to the underlying getters (host/port/isHttps) + the https↔wss scheme-mapping cross-check; left the singleton TLS getter
and the global-dispatcher installer. Slice 37 (+6 tests): started the big `nklein-session-state.ts` vein (17 untested
exports) with the clearly-pure ones — `isNKleinUserAttentionTool` (the ask_followup/plan_mode_respond set),
`canReturnToRunning` (attention/hook/error only), `buildSessionIdPrefix` (normalize → trailing-dash; blank → 'session-'),
`latestAssistantMessageMatches` (last assistant message, trim-compare). No source change. **session-state vein: ~13 more
untested exports remain — mostly entry MUTATORS (append*Chunk, setOrCreate*, start/finishToolCallMessage, clearActiveTurnState)
+ pure clones (cloneSummary/cloneMessage) + builders (createMessage*/createAssistantMessage) — a rich multi-batch target.**

### ▶ §5.V slices 38–39 (2026-07-06, be837b98 + d1183b5a) — nklein-session-state vein COMPLETE (batches 2 & 3)
Slice 38 (+7 tests): clones + builders — `cloneSummary`/`cloneMessage` (deep-clone verified by mutating the clone and
asserting the original is untouched; null nested stays null), `createMessage`/`createMessageWithMeta` (task-prefixed id,
images cloned/undefined-when-empty, meta), and the `createAssistantMessage`/`createReasoningMessage` mutators. Slice 39
(+8 tests): the remaining entry mutators — `appendAssistantChunk` (create-then-APPEND) vs `setOrCreateAssistantMessage`
(null-without-active; REPLACE not append), the reasoning equivalents (reasoning_delta vs reasoning_end meta), the full
tool-call lifecycle (`startToolCallMessage` records msg-id+input by toolCallId → `finishToolCallMessage` updates IN PLACE
and clears the maps; orphan finish creates fresh), and `clearActiveTurnState`. **All 17 nklein-session-state untested
exports now covered (batches 1–3, +19 tests).** No source change.

### ▶ §5.V slices 40–41 (2026-07-06, d7051eab + b63a2b39) — provider-model-parsing mappers + operator-board-health
Slice 40 (+5 tests): `toRuntimeProviderModel` (name trim → id fallback, type only when present, falsy support flags
dropped) and `toLmStudioModels` (v0 item → single model; non-object/no-id → empty; v1 EXPANDS loaded_instances into
per-instance models with the instance id + config context window; the notable edge that a v1 item with NO loaded
instances → empty). Slice 41 (+2 tests): direct coverage for the lower-level `summarizeBoardHealth` (the tested
`summarizeWorkspaceBoardHealth` wraps it, so it was only transitively covered) — trash-column exclusion + the per-card
resolveOverrides callback. No source change. Left `summarizeWorkspaceBoardStreams` (distinct streams/staleness path).

### ▶ §5.V slice 42 + COVERAGE-SATURATION FINDING (2026-07-06, 2a4cfab0)
Slice 42 (+1 test): `toGlobalRuntimeConfigState` — the global-only projection that must CLEAR every project-scoped field
(projectConfigPath, *Override fields, projectSetupWizardCompletedAt, shortcuts) while preserving the global ones; verified
against a real default state under an isolated temp HOME. Config-isolation correctness; also documents that the projection
re-materializes objects (no shared mutable refs leak between the global view and its source).

**FINDING — high-value §5.V pure-logic coverage is now essentially SATURATED.** A broad scan (export function + export const,
across all of src) shows the remaining untested exports are dominated by `*-api-contract.ts` files — i.e. **Zod schema +
inferred-type declarations** (runtime-config-api-contract 31, nklein-provider-api-contract 27, projects/chat/task contracts,
…). Those are NOT genuine gaps: they're declarations, exercised transitively through the (now fully-covered) api-validation
parsers and every runtime consumer; a direct test would only re-assert Zod. The rest of the tail is trivial path-joins
(getRuntime*ConfigPath), I/O-bound functions (dev-test-project-registry, sentry-node), and vendored SDK-boundary passthroughs.
**Net: over 42 slices this run I've closed every substantial vein of untested PURE LOGIC** — input boundary, core
session-state, security (passcode + cmd escaping), config normalizers/resolvers/projection, routing/prompt/model-parsing/policy.

### ▶ §5.U slice 43 (2026-07-06, 4294bfc6) — reviewer-candidate selection lifted from the flagship (THIRD safe pattern)
A real §5.U cut into `nklein-task-session-service.ts` via a pattern I'd under-used: **lift a PURE sub-computation out of a
stateful method** (the method keeps its IO/orchestration; the pure step moves + gets tested). `pickDiverseReviewerModel`'s
two pure steps — `resolveWorkerRealId` (served alias → real publisher key when loaded) and `buildReviewerCandidates`
(loaded descriptors → reviewer candidates, excluding embeddings + the worker's own model by served alias OR real key) —
moved to `nklein-reviewer-candidate-selection`; the method delegates. Behavior-preserving (identical find/filter/map);
+5 focused unit tests where before they were only exercised end-to-end. task-session-service 4873 → **4859**.
**Correction to the slice-42 "high-value work is David-gated" framing:** this third pattern reopens safe flagship progress —
the big methods contain more pure sub-computations that can be lifted+tested one bounded commit at a time WITHOUT the risky
state-threading of a full collaborator split. Worth a systematic pass over the large methods for these. (The full
responsibility-split of the ~2300-line createRuntimeServer closure + the class still benefits from David's steer.)

### ▶ §5.U slice 44 (2026-07-06, c8d9dcca) — adaptive-retry policy lifted from the flagship + a THIRD-PATTERN CAVEAT
Lifted `maybeAdaptiveBudgetRetry`'s two pure decision steps into `nklein-adaptive-retry-policy`:
`shouldAttemptAdaptiveBudgetRetry` (eligibility gate) + `hasStallEvidence` (a `model_stalled` observation this run, by
signal or metadata.category). Method delegates; a redundant provider/model narrowing guard restores the type narrowing the
old inline check gave (can't trigger — the gate already ensures non-null). Behavior-preserving; +7 tests. **CAVEAT (learned
here):** task-session-service 4859 → **4863 (+4 lines)** — the lifted logic was SMALL, so the object-arg delegation call +
guard slightly OUTWEIGHED the removed inline code. The third pattern reliably adds cohesion + coverage, but it only REDUCES
line count when the lifted computation is CHUNKY relative to its call site (slice 43's reviewer-candidate lift was −14; this
one +4). **For the flagship's "reduce lines" goal, target chunky inline computations; for small ones the win is coverage,
not size.** Real line-reduction at scale still needs the collaborator split (David-gated for boundaries).

### ▶ §5.U slice 45 (2026-07-06, 6a1591f9) — FIRST COLLABORATOR SPLIT: model-residency watcher
The first genuine responsibility-split of the flagship (not a pure-fn lift). Moved the model-residency-watch concern (the
per-task heartbeat-handle Map + begin/stop/on-lost lifecycle) out of the service into a bounded `createModelResidencyWatcher`
collaborator; everything it needs from the service is supplied via a 6-method `ModelResidencyWatcherDeps` interface, so the
concern is self-contained. The service instantiates it once; the 4 call sites became `this.modelResidencyWatcher.begin/stop`;
biome dropped the now-unused liveness imports. **Behavior-preserving — proven by the FULL task-session-service suite +
lmstudio-liveness test (134 tests) still green.** task-session-service 4863 → **4811 (−52)**. +3 focused watcher tests.
**CORRECTION to my earlier "the split needs David's steer" framing:** a collaborator split CAN be done autonomously + safely
when (1) the concern is cohesive with cleanly-separable state (here: a single Map), (2) the deps interface is clear/small,
(3) the existing test suite covers the behavior. This is the TEMPLATE + it unlocks the flagship's real reduction path. Next
candidates with the same shape: timeout scheduling (`timeoutScheduler` + schedule/clear/handle methods), decomposition-stall
nudge (`decompositionStallNudger` + the chat-nudge methods), sandbox-review finalization. David's steer is only needed for
concerns whose state is NOT cleanly separable / whose boundary is genuinely ambiguous.

### ▶ §5.U slices 46–47 (2026-07-06, 4e828018 + 7db68f79) — more collaborator work on the flagship
Slice 46: the decomposition-stall-nudge concern was ALREADY a collaborator (`DecompositionStallNudger`); the service's
three `*DecompositionChatNudge` / `maybeContinueStalledDecomposition` methods were pure pass-through wrappers — removed all
three, pointed their 6 call sites straight at `this.decompositionStallNudger.<same>`, and dropped a stale orphaned §5.AN
residency doc-comment slice 45 left behind. 4811 → 4787. Slice 47: SECOND clean collaborator split — the per-workspace
runtime-setup lease cache (the `Map<workspace, Promise<lease>>` + `ensureRuntimeSetup` de-dup + the dispose release-loop)
→ `createRuntimeSetupLeaseCache({ acquire })`; the 4 callers + dispose delegate. +3 focused tests (concurrent-caller
de-dup, per-workspace separation, disposeAll tolerating a release failure). 4787 → 4768. Both behavior-preserving
(118-test suite green). **task-session-service this run: 4886 → 4768 (−118); 2 clean collaborator splits + wrapper cleanup.**

### ▶ §5.U slice 48 (2026-07-06, 116086bb) — focus-chain store collaborator (third split)
Third clean collaborator split. The per-task focus-chain state (the `taskId → FocusChain` map + apply-step-timing /
summarize / delete / clear, inlined across ~6 sites) → `createFocusChainStore({ now, onUpdated })`. The two update
callbacks collapse to `this.focusChainStore.applyStep(taskId, chain)`; the rest delegate; biome dropped the now-unused
focus-chain helper imports. Behavior-preserving (118-test suite green); +4 focused tests. task-session-service 4768 →
**4762** (small reduction — its pure timing/summary logic was already in `core/focus-chain` helpers, so only the map +
orchestration moved; the win is cohesion + isolated coverage). **3 collaborator splits landed (residency, lease-cache,
focus-chain) — all the single-Map + small-deps shape.**

### ▶ §5.U slice 49 (2026-07-06, c02ff43e) — team-progress pub/sub collaborator (fourth split)
Fourth clean collaborator split. The team-progress pub/sub (listeners Set + subscribe/unsubscribe + the emit that PROJECTS
the raw SDK event before fanning out) → `createTeamProgressEmitter`. `onTeamProgress` delegates to `.subscribe`; the private
`emitTeamProgress` is gone (6 callers → `this.teamProgressEmitter.emit(...)`); dispose `.clear()`s; biome dropped 3 now-unused
imports. Behavior-preserving (118-test suite green). task-session-service 4762 → **4744**. +3 focused tests.
**Survey of the remaining single-collection fields (recorded so future iterations don't re-hunt):** `explicitDecompositionTaskIds`
= a bare membership Set (has/add/delete/clear, NO owned logic) → extracting = pointless indirection; `lastRecordedRunStateByTaskId`
= a 3-use dedup, too small; `adaptiveRetryStateByTaskId` = cross-concern (its method calls sendTaskSessionInput); `timeoutSettingsByTaskId`
= entangled with the timeout scheduler; the warmth ledger (`lastAssembledSystemPromptByModelId`/`lastShellKeyByModelId`) is
cross-cutting (WRITTEN at prompt-assembly, READ at model-selection). **The clean single-Map-with-owned-lifecycle concerns in
task-session-service are now largely mined (4 splits done).** Further big reduction needs either the entangled clusters (David's
boundary steer) or a different file.

### ▶ §5.U slice 51 (2026-07-06, 3537c66b) — TimeoutController: second entangled split (the hardest one)
Executed the timeout-scheduling extraction I'd flagged as the largest/riskiest. `createTimeoutController(deps)` OWNS the
`TaskTimeoutScheduler` + the per-task settings map (the `NKleinTaskTimeoutSettings` type moved here), the stream/
conversation/tool schedule methods (settings-gated; stream skips while a tool is active), and — moved VERBATIM —
`handleTaskTimeout` (on fire: abort + record a diagnosable stall failure). 9 cross-concern touchpoints via
`TimeoutControllerDeps`; the service keeps its thin `clearTaskTimeout(s)` wrappers (clearTaskTimeouts is a cross-concern
teardown) and delegates the timeout part; ~12 call sites rewired. Controller↔service teardown circular ref safe (lazy
arrows). Behavior-preserving (verbatim move; 139 tests green). task-session-service 4637 → **4551 (−86)**.
**Key: the split IMPROVED coverage** — +4 TimeoutController tests including the FIRE path (fake timers) where before it was
only exercised indirectly. Also fixed a latent type bug in the slice-50 park test (`state:"completed"` isn't valid — vitest
doesn't type-check so it slipped; the full tsc caught it). **How I de-risked the hardest split (thinner fire-path net):
verbatim logic move + remove-methods-so-tsc-catches-missed-callers + a new fire-path test.**

### ▶ §5.U slice 50 (2026-07-06, fda084c0) — ParkController: the FIRST entangled-cluster split (biggest reduction)
Executed the fully-scoped (slice-49) pause/park extraction → `createParkController(deps)`: the shared teardown, the two
terminal shapes (operator PAUSE → `paused`, reversible; autonomy-budget PARK → `awaiting_review`/`attention`),
`parkActiveTasksForOperatorPause`, and `enforceAutonomyBudgets`. 11 service touchpoints supplied via `ParkControllerDeps`;
6 call sites rewired (2 pause handlers, applyTurnCheckpoint, guard+watchdog callback wirings). The
parkController↔autonomyBudgetWatchdog circular ref is safe (lazy `this` arrows). Behavior-preserving — 145 tests across
task-session-service / autonomy-budget-watchdog / pause-controller / card-pause suites green; +4 focused ParkController
tests. **task-session-service 4744 → 4637 (−107, biggest single reduction this run).** **CORRECTS the "entangled needs
David's steer" framing:** entangled orchestration splits ARE autonomously doable when the BOUNDARY is clear (the pause/park
concern was unambiguous, even with an 11-dep interface); David's steer is only needed when the boundary ITSELF is ambiguous.
Next entangled candidates via the same recipe: timeout-scheduling, sandbox-review finalization.

### ▶ §5.U INVESTIGATION (2026-07-06, after slice 49) — the clean vein is mined; what's actionable next
Thorough probe of every large file this iteration confirms: the codebase is WELL-FACTORED — the big functions already
delegate their pure logic to helper modules (e.g. session-runtime's 220-line `createKanbanContextFocusExtension` calls
`decideTaskReanchorForRequest`/`reanchorFocusChainMessages`/`recoverNarratedToolCalls`/… — no chunky inline pure block to
lift). runtime-server's remaining state lives in the `createRuntimeServer` CLOSURE (not class fields). So the remaining §5.U
reduction is **moving ORCHESTRATION into collaborators** — the entangled cross-concern clusters:
- **pause/park** (`parkActiveTasksForOperatorPause`, `parkTaskForPause`, `parkTaskForAutonomyBudget`, `resetGuardsForPark`,
  `pushParkSystemMessage`, `enforceAutonomyBudgets`): a CLEAR boundary ("the pause/park concern") but a large deps interface —
  it touches messageRepository (getTaskEntry/listSummaries), emitSummary, emitMessage, clearTaskTimeouts, autonomyBudgetWatchdog,
  repeatedToolCallGuard, pauseController, sessionRuntime.abortTaskSession, recordObservationWithModel + createMessage/clearActiveTurnState.
  Extractable as a `ParkController(deps)` collaborator (~10-method deps), gated by the pause tests. **DONE (slice 50).**
- timeout scheduling (**DONE, slice 51 → TimeoutController**) + sandbox-review finalization (**DONE, slice 52 →
  SandboxReviewFinalizer, the biggest at −286**): similar entangled orchestration, all now extracted.
These WERE actionable without David (the test suite is the safety net) and all three landed green — proving entangled
orchestration splits are autonomously safe whenever the boundary is clear. The obvious cohesive-cluster vein in
task-session-service is now largely mined (4886 → 4265); further reduction gets into finer-grained / more-ambiguous
boundaries that warrant David's steer, or a shift to the other two monoliths.

> **★ §5.Z EGRESS VERIFICATION (2026-07-06, egress LIVE at 127.0.0.1:18888) — the directive's unblocked track, DONE for the
> loaded roster.** Ran the two egress harnesses. Infra (`verify-egress-live.mts`) ✅ all pass (real SearXNG results, fail-closed
> gate fires with no request when egress off, no_backend, contract field mapping). Cross-model e2e
> (`verify-egress-model-e2e.mts`: model → web_search tool-call → live SearXNG → grounded answer) **7/8 PASS across 2B→120B**
> (qwen3-8b, qwen2.5-coder-14b, gemma-4-e2b, phi-4-mini-reasoning, mistral-small-3.2, gpt-oss-120b, nemotron-3-nano-4b). The one
> ⚠️ CANT is **phi-4-reasoning-plus** — reasoning runaway (burns the whole budget on reasoning_content, truncates finish=length
> at ≥6144 tokens, never emits the tool call): a model-quality trait / §5.AA adaptive-retry target, NOT an egress bug. Full
> detail in [cross-model-verification.md](cross-model-verification.md) + polishing.md §5.Z. Commit f627948c.
> **§5.Z §5.AC TEMPORAL-AWARENESS (2026-07-06): harness bug fixed + 7/7 cross-model PASS.** Sweeping the "knows today"
> lighthouse surfaced a HARNESS BUG (`verify-temporal-awareness-live.mts` failed its own assertions on every model — it
> never enabled the off-by-default feature it verifies; the model answered "current year is 2023" from its training
> prior). Fixed (pass `knowsTodayEnabled: true` in the harness deps). Feature confirmed working: 7/7 PASS across 2B→120B
> — every model injects the leading `<current_date>` block and overrides its training prior (places a current-year past
> month correctly in the PAST). Commit 7e92b32f. **Pattern: each §5.Z sweep this run found a real issue** (egress →
> phi-4-reasoning-plus reasoning-runaway data point; temporal → a harness bug) — §5.Z verification is earning its keep.
> **§5.Z CURRENT-ROSTER COVERAGE (2026-07-06) — ALL 6 light flows swept, all healthy:** egress/web_search (7/8, 1
> reasoning-runaway), temporal/knows-today (7/7, +harness fix), chat read_file (3✅/2◑/1⚠️), chat run_command (3✅/1◑), chat
> write_file/confirm-gate (6/6 ✅ — universal, incl. all the ◑/⚠️ models, because it asserts on the durable side-effect+audit
> not reply-echo), chat browse_url (1✅/3⚠️ — tool VERIFIED working; 3/4 incl. gpt-oss-120b return the <title> not the <h1>
> "main heading", a comprehension/ambiguity trait). **Consistent pattern:** capable models (qwen3-8b, qwen2.5-coder-14b,
> gpt-oss-120b) PASS the reply-echo flows; the 2B gemma-4-e2b reliably EXECUTES tools but weak-synthesizes on marker-echo (a
> documented ◑ trait); side-effect/audit-asserted flows (write) pass universally; a few model-specific quirks (mistral
> list_dir on read_file; phi-4-reasoning-plus reasoning-runaway; the browse title/h1 comprehension spread). **Only ONE !Klein
> action across all 6 flows: the temporal harness fix** — the rest are model-quality data points on a healthy feature set.
> The light-flow §5.Z matrix is now comprehensively covered on the current roster; remaining are HEAVY flows (decompose,
> autonomous-run, multi-card, strict-isolation, restart-resume) that need a full runtime boot + workspace (minutes/model).

> **★ §5.U REVIEW-CLUSTER SEAM — EXECUTING (2026-07-06, David-approved, integration-pass-per-commit).** The per-commit
> integration gate is VIABLE + FAST: `swarm-deterministic-pass.integration.test.ts` (mock LLM → decompose → write → review
> approval → acceptance → merge → completed) runs green in ~8s with Docker up. Commits landed, each gated by
> tsc + biome + fast + that integration test: **1/6 AcceptanceVerifier** (thin delegating runner, +5 tests, −18);
> **2/6 pickDiverseReviewerModel** (the shared reviewer/escalation/critique model selector — 3 call sites — de-tangled first,
> +3 tests, −74). task-session-service **4040 → 3922**. **3/6 SecondarySessionHarness** (the shared skeleton, lifted from the review runner —
> the CRUX/riskiest commit: `runBracketed(config, drive)` owns sandbox setup + deadline-bounded runBoundedTurn + always-teardown;
> the review runner rewired onto it with the drive closure; `deadlineMs` threaded to the drive so the nudge-loop guard is
> byte-preserved. +5 characterization tests + the integration gate green — restructure confirmed behavior-preserving). **4/6 PlanCritique**
> onto the (additively generalized) harness: `primaryTaskId` is now OPTIONAL — present ⇒ resolve the delivered tree (review,
> byte-identical); omit ⇒ check out `baseRef` directly (plan-critique/merge/mirror). +1 harness test, integration gate green.
> task-session-service **3922 → 3887**. **REFINED PLAN for the last 2** (they DIVERGE too far for the harness's `void`
> runBoundedTurn — extract STANDALONE, verbatim): **5/6 SpeculativeMirror** (returns `boolean`; own `"settled"|"timeout"`
> runBoundedTurn; multiple cancel-checkpoints + residency re-check + capture) and **6/6 MergeResolution** (own `boolean`+TOCTOU
> runBoundedTurn; a git-merge reproduction/verify before the turn; `mainRef` baseRef). Each a wide-dep verbatim collaborator,
> gated by tsc + biome + fast + swarm-deterministic-pass. So: review + plan-critique share the harness; mirror + merge become
> their own modules (all four out of the monolith). Not rushed (no fast-net; behavior byte-identical).
> **5/6 SpeculativeMirror DONE (David chose full standalone).** Extracted verbatim into
> createSpeculativeMirrorRunner (owns its cancel-flag set; boolean return; own settled/timeout runBoundedTurn; residency
> re-check + workspace-patch capture). Prep: named the big startRuntimeTaskSessionFromLaunchConfig param type into a shared
> `nklein-runtime-session-input` module so a runner can type the injected `startRuntimeSession` dep without a service cycle
> (this also unblocks merge). Shared teardown-forgets are now a service method `forgetSyntheticSessionState`. +5 tests +
> integration gate. task-session-service **3887 → 3722**. **6/6 MergeResolution DONE — ★ SEAM COMPLETE.**
> The biggest+most-intricate runner (~325 lines: git-merge REPRODUCTION in-sandbox → verify the unmerged set matches the host
> conflict EXACTLY → binary/size/text gates → the model turn with a boolean+TOCTOU runBoundedTurn → trust-but-verify → capture)
> extracted verbatim into createMergeResolutionRunner. +8 characterization tests (command-routing exec mock: clean/divergent/
> resolve-e2e/leftover-markers/over-cap/symlink) + the integration gate. task-session-service 3722 → 3392.
> **★ REVIEW-CLUSTER SEAM COMPLETE (6/6): all auxiliary secondary-session runners are out of the monolith** —
> AcceptanceVerifier, pickDiverseReviewerModel, SecondarySessionHarness+review, PlanCritique(on-harness), SpeculativeMirror,
> MergeResolution. **task-session-service 4886 → 3392 across the run (−1494, −31%).** New modules: nklein-acceptance-verifier,
> nklein-reviewer-model-selection, nklein-secondary-session-harness, nklein-speculative-mirror-runner,
> nklein-merge-resolution-runner, nklein-runtime-session-input (shared start-input type). Every commit gated by
> tsc + biome + fast + swarm-deterministic-pass; behavior byte-identical.

### ▶ CONSOLIDATED STATE (2026-07-06, after slice 57) — for David
**Polishing phase, §5.U flagship (deep architecture refactor), THIS Opus session.** All work behavior-preserving +
test-gated, one bounded cluster per commit, pushed to `feat/nklein-upcoming`, tree clean.
- **57 slices this run (35 §5.U extractions + 22 §5.V coverage batches), ~350 new unit tests, zero behavior changes** (the
  pre-commit fast suite gates every commit; extractions delegate). Slices 56–57 diversified to **provider-service 1463 → 1291**
  (−172): CustomProviderManager (custom-provider CRUD) + ModelDiscoveryApi (catalog/models/endpoint-discovery), each with a
  fail-closed-on-cloud security test. task-session-service 4886 → **4040** this run (−846, ~17%) via
  TEN collaborator splits (residency watcher, runtime-setup lease cache, focus-chain store, team-progress emitter, the three
  ENTANGLED clusters: ParkController pause/park + TimeoutController scheduling/firing + SandboxReviewFinalizer sandbox-review
  finalization [biggest, −286], ContextBudgetController context-window resolution + pre-send guard [−87], TaskFailureEmitter
  SDK start/send failure classification + emission [−69], and RetrievalToolsBuilder §5.AC egress tools [−66, extracted WITH a new
  live fail-closed security regression test]) + wrapper cleanup — all proven by the existing suites. Entangled orchestration
  splits are autonomously safe when the boundary is clear. §5.V
  high-value pure-logic coverage is SATURATED
  (see the finding above) — every substantial vein closed: the api-validation parser boundary, runtime-config
  normalizers/resolvers/projection, server path/host + endpoint-origin helpers, two SECURITY modules (passcode rate-limiter
  + windows-cmd escaping), plan-gap prompt builders, context-window-policy helpers, plan-task-routing resolvers,
  task-start-guard helpers, the nklein-session-state core module (all 17 exports), provider-model-parsing, operator-board-health.
- **Actionable WITHOUT David:** (a) §5.V is a low-value tail (Zod schema decls — transitively tested; trivial path-joins;
  I/O fns; SDK passthroughs) — don't pad. (b) **§5.U flagship reduction is UNBLOCKED and autonomous** — slice 45 proved a
  COLLABORATOR SPLIT can be done safely (residency watcher, −52, 134 tests green). Continue splitting the cohesive,
  cleanly-separable concerns (timeout scheduling, decomposition-stall nudge, sandbox-review finalization, …), one bounded +
  test-gated collaborator per commit, plus chunky pure sub-computation lifts. **Benefits from David only for:** concerns whose
  state is NOT cleanly separable / whose module boundary is genuinely ambiguous. §5.Z cross-model verification (needs live
  models driven through flows) and §5.AZ release prep (POST-MATURITY, David-gated) also remain. Vein since slice 13: the NEXT-TIER files (mcp-runtime-service,
  agent-sandbox, event-adapter, large-file-workflow) yield extractions that are §5.U + §5.V at once — the moved clusters
  were UNTESTED. TWO flagship patterns proven: (17) lift PURE private methods (no `this`) into core guard modules; (20) lift
  state-free INNER closures out of the big `createRuntimeServer` / class bodies. **Slice 21 opened a pure-§5.V vein: the ~44
  api-validation tRPC parsers, many untested despite real trim/emptiness logic — a low-risk coverage backlog when lifts run dry.**
- **Monolith progress:** `nklein-provider-service.ts` 1651 → **1073** (12 clusters pulled: settings-summary, litellm-model-list,
  managed-provider-credentials, provider-selection-store, model-list-settings, kanban-access-policy, custom-provider-manager
  [slice 56, +security test], model-discovery-api [slice 57, +tests], provider-settings-writer [slice 58, saveProviderSettings
  −218, David-selected, +6 tests incl. fail-closed] — plus 3 earlier);
  `runtime-server.ts` 2527 → **2451** (bounded-dedup-set, workspace-state-lock-retry, review-sandbox-result, and now
  runtime-server-http lifted from INSIDE the createRuntimeServer closure);
  `nklein-mcp-runtime-service.ts` 949 → **762** (oauth-settings-store, transport-factory, oauth-callback — all were untested);
  `nklein-agent-sandbox.ts` 1090 → **1071** (sandbox-predicates — was untested);
  `nklein-event-adapter.ts` 806 → **768** (tool-activity classifiers — was untested);
  `nklein-large-file-workflow.ts` 781 → **740** (workflow helpers — was untested);
  `nklein-task-session-service.ts` 4886 → **4040** (−846 this run: 10 collaborator splits — residency watcher, runtime-setup
  lease cache, focus-chain store, team-progress emitter, ParkController, TimeoutController, SandboxReviewFinalizer,
  ContextBudgetController, TaskFailureEmitter, RetrievalToolsBuilder — plus the shouldCaptureReviewCheckpoint guard lift +
  wrapper cleanup; the entangled orchestration clusters + context-budget resolver/guard + failure-emitter + retrieval-egress
  builder are now all extracted).
- **PRODUCTIVE VEIN (corrected):** the big-3 pure-fn seams are done, but the NEXT-TIER large files (mcp-runtime-service,
  workspace-state, agent-sandbox, projects-api, task-board-mutations, dev.ts) have clean cohesive seams, several UNTESTED
  → each is §5.U + §5.V at once. Keep mining these before the risky big-3 class-splits.
- **New modules (all under `src/nklein-agent/` unless noted):** nklein-session-system-prompt, nklein-launch-config,
  nklein-retrieval-tools-gate, nklein-provider-settings-summary, nklein-litellm-model-list,
  nklein-managed-provider-credentials, nklein-provider-selection-store, nklein-model-list-settings, nklein-kanban-access-policy,
  nklein-mcp-oauth-settings-store, `src/server/bounded-dedup-set`, `src/server/workspace-state-lock-retry`,
  `src/server/review-sandbox-result`.
- **Next targets (in order):** (1) more next-tier clusters (mcp-runtime-service transport/oauth-provider-context;
  workspace-state path helpers; agent-sandbox pure helpers); (2) the deeper, higher-value work — decomposing the ~2300-line
  `createRuntimeServer` closure and the task-session-service class by responsibility. §5.Z cross-model verification + §5.AZ
  release prep remain open; §5.AX visual overhaul is Fable-only.
- **polishing.md:** §5.U section migrated in (per the phase directive), with the same tally + next targets.

---

### Update (2026-07-06) — review-cluster seam complete + adaptive-budget cluster

- **`nklein-task-session-service.ts` 4040 → 3293** since the last entry. Two arcs:
  - **Review-cluster auxiliary-session seam (6/6)** — the biggest single §5.U reduction. Extracted the review/critique/
    verify/mirror/merge secondary-session machinery: `nklein-acceptance-verifier`, `nklein-reviewer-model-selection`
    (shared by 3 call sites), `nklein-secondary-session-harness` (the `runBracketed` skeleton — sandbox setup + bounded
    turn + always-teardown; runners supply only their `drive` closure), `nklein-runtime-session-input` (shared input-type
    module to break the cycle), `nklein-speculative-mirror-runner` (§5.AW best-of-N mirror, owns its cancel flags), and
    `nklein-merge-resolution-runner` (§5.AK sandbox merge-conflict resolution). Each gated with tsc + biome + fast suite +
    the `swarm-deterministic-pass` integration pass. New tests: 5+3+6+5+8 = 27.
  - **Adaptive-budget/quality-budget cluster** (this commit, `b03a2854`) — `createAdaptiveBudgetController(deps)` owns the
    LEARNED quality-effective budgets (W2.3a, read by ContextBudgetController) + the stall-signature adaptive retry (W1.1b),
    all three state maps/flags. Verbatim move, lazy-arrow deps, 5 characterization tests. 3392 → 3293.
- **Runner heterogeneity established:** review + plan-critique share the harness (void runBoundedTurn); mirror + merge diverge
  (own boolean / settled-timeout runBoundedTurn, cancel-state, git reproduction) → standalone extraction via the named
  `startRuntimeSession` dep-type. The `forgetSyntheticSessionState(taskId)` service helper is now the shared synthetic-session
  teardown reused by harness + mirror + merge.
- **New modules:** nklein-acceptance-verifier, nklein-reviewer-model-selection, nklein-secondary-session-harness,
  nklein-runtime-session-input, nklein-speculative-mirror-runner, nklein-merge-resolution-runner, nklein-adaptive-budget-controller.
- **Next targets:** continue surveying task-session-service (3293) for the next cohesive cluster; the entangled primary-lifecycle
  orchestration is the remaining hard core (module boundary may be genuinely ambiguous — flag for David if so). §5.Z heavy flows
  (need workspace) + §5.AZ release prep (David-gated) remain open.

- **Context-overflow recovery cluster** (`0652a6f7`) — `createContextOverflowController(deps)` owns the reactive
  `recoverAfterOverflow` (retry after a provider context-overflow error) + proactive `compactBeforeOverflow` (pre-send
  compaction guard). Both compacted history then re-drove the task via an IDENTICAL "restart live session / else rebuild
  from launch config / else throw" tail — now a single `restartOrStartWithMessages` helper (DRY win). The onTeamEvent wiring
  stays service-side on the restartTaskSession dep. 6 characterization tests. **task-session-service 3293 → 3157.** Run total:
  4886 → 3157 (−35%).

- **runtime-server: terminal-telemetry recorders lift** (`9e5fc03d`) — lifted the two terminal-summary telemetry closures
  (recordNKleinModelPerformance + recordNKleinKnowledgeToolUsage) + the module-level `recordedTerminalRuns` dedup set out of
  the ~2300-line createRuntimeServer closure into `createRuntimeTerminalTelemetryRecorders({ warn })`. Tiny capture surface
  (only `deps.warn`); their identical "load state+config, find card" head collapsed into one `loadScopeCard` helper (DRY win);
  the dedup set stays a process-wide singleton. 4 tests. **runtime-server.ts 2451 → 2385.**
- **This continuation's tally:** 3 clean §5.U increments — adaptive-budget controller + context-overflow controller (task-
  session-service 3392 → 3157) and the runtime-server telemetry lift (2451 → 2385). All gated tsc+biome+fast+integration.
- **runtime-server: plan-integration-gate runner lift** (`e2ee6687`) — lifted the server-side plan-level integration gate
  (§5.0.5): the two closures + the per-server `completedPlanGateRunKeys` dedup set + the PLAN_GATE_* constants out of
  createRuntimeServer into `createPlanIntegrationGateRunner({ warn })` (service passed per-call). 5 tests. **runtime-server.ts
  2385 → 2230.** Continuation tally now 4 clean §5.U increments; runtime-server 2451 → 2230 (−221), task-session-service
  3392 → 3157.

### Checkpoint (2026-07-06) — clean §5.U vein assessment

Four clean, bounded, test-gated §5.U extractions landed this continuation (all green: tsc+biome+fast+swarm-deterministic-pass
integration, one cluster per commit). Flagship monolith state now:
- `nklein-task-session-service.ts` **4886 → 3157** (−35% across the run): adaptive-budget controller + context-overflow controller
  this continuation, on top of the review-cluster seam (6/6).
- `runtime-server.ts` **2527 → 2230**: terminal-telemetry recorders + plan-integration-gate runner lifted out of the
  ~2300-line createRuntimeServer closure this continuation.
- `nklein-provider-service.ts` 1073 (unchanged this continuation).

**What remains is NOT clean-autonomous — it needs David or carries risk beyond the current safety net:**
1. **createRuntimeServer core** — the big remaining closures (headless-auto-review finalize ~430 lines with several mutable
   in-flight sets; the ~500-line scoped-service factory; the task-start/drain scheduler) capture large amounts of closure
   scope. These are single large clusters with ambiguous module boundaries → **David decision on boundary before extracting.**
2. **task-session-service core** — startTaskSession (~400 lines), sendTaskSessionInput, dispatchResolvedTaskInput, handleTaskEvent
   are the entangled primary lifecycle. Decomposing them is the hard core; boundary is genuinely ambiguous → **David.**
3. **provider-service model-discovery fetchers** (fetchLiteLlmBaseUrlModels / fetchLmStudioBaseUrlModels) are a real DRY/template
   candidate, BUT they do live `globalThis.fetch` and the fetch-LOOP internals are not directly covered (only the throttle/cache
   around them is). Consolidating two subtly-divergent network fetchers without a loop-level test net is a behavior-risk the
   prime directive warns against. **Owed first: fetch-mocked characterization tests (a §5.V increment) to establish the net,
   THEN consolidate.** That §5.V test-first step IS autonomous and is the natural next action if the grind resumes.

§5.Z heavy flows (need a live workspace) and §5.AZ release prep (David-gated, on hold) also remain per prior entries.

- **provider-service: base-URL model-discovery fetchers lift + coverage** (`84c2ee18`) — extracted
  fetchLiteLlmBaseUrlModels + fetchLmStudioBaseUrlModels (and their fetcher-only locals) into
  `nklein-baseurl-model-discovery.ts`; logger keeps component "nklein-provider-service" (byte-identical logs). The §5.V half:
  the fetch LOOP was previously uncovered (only the throttle/cache was) — new direct fetch-mocked test (5) covers both
  providers' happy/non-ok/unreachable/dedup/no-base-URL branches, establishing the net the future 2→1 consolidation was owed.
  **nklein-provider-service.ts 1073 → 933.** Dead LOGGER + createKanbanNKleinLogger + zod removed.
- **Continuation tally: 5 clean §5.U increments, all three flagship monoliths reduced** — task-session-service 3392 → 3157,
  runtime-server 2451 → 2230, provider-service 1073 → 933. All gated tsc+biome+fast+swarm-deterministic-pass, one cluster/commit.
  **Available-next (now unblocked, low-risk):** the two base-URL fetchers can be consolidated into one parameterized
  template-method fetcher now that direct coverage exists — a pure DRY win (~40 lines), no longer a behavior risk.

### Iteration (2026-07-06 later) — the clean vein was NOT exhausted: 3 more §5.U increments

A fresh survey found clean, bounded clusters the prior checkpoint missed:
- **Prompt-warmth ledger** (`ad57d82b`) — `createPromptWarmthLedger()` owns the two §5.AQ per-model prompt-state maps
  (full-bytes reuse telemetry + shell-key routing) + `assembleAndRecord` around the pure `buildSessionSystemPrompt`.
  ZERO service-collaborator deps → fully self-contained. 4 tests. task-session-service 3157 → 3064.
- **Second-opinion review runner** (`5ec0f3aa`) — `createSecondOpinionReviewRunner(deps)`, a standalone harness-based runner
  (sibling of mirror/merge); owns the `inFlightSecondOpinionReviewTaskIds` single-flight guard; drives the shared harness via
  a `getHarness()` dep. 5 tests. 3064 → 2952.
- **Plan-critique runner** (`1e858df7`) — `createPlanCritiqueRunner(deps)`, the sibling of the above; owns the W4.3 per-run
  critique budget; exposes `buildRequestHandler` (the decompose-tool executor factory) + `runPlanCritiqueSession`. 7 tests.
  2952 → 2835.
- **The review-session cluster is now fully extracted** from the service (acceptance/reviewer-selection/harness/mirror/merge
  earlier, + second-opinion + plan-critique now). **task-session-service 4886 → 2835 across the whole run (−42%).**
- Pattern confirmed: harness-based runners take the harness via `getHarness()` (preserving `runBracketed`'s generic) and pass
  consts shared with a sibling (timeout default, max nudges) as deps rather than forcing a shared-consts module.

- **Runtime observation recorders** (`e6f8c045`) — `createRuntimeObservationRecorder(deps)` owns the three SDK-event →
  registry/self-observation recorders. The pure extractors were tested; the WIRING glue (local-provider gate, credit-limit
  → provider_error classification, no-observation skip) was not — 8 new tests pin it (§5.U + §5.V). task-session-service
  2835 → 2773.

### Checkpoint (2026-07-06, end of iteration) — clean cohesive-cluster vein exhausted across the big-3

This iteration landed **4 clean §5.U/§5.V increments** (prompt-warmth ledger, second-opinion runner, plan-critique runner,
observation recorders), all green (tsc+biome+fast+integration), one cluster/commit. Flagship state at run's end:
- `nklein-task-session-service.ts` **4886 → 2773 (−43%)** — every cohesive AUXILIARY cluster is now extracted (residency
  watcher, focus-chain, team-progress, park/timeout/failure controllers, context-budget, retrieval, acceptance verifier,
  reviewer-model-selection, secondary-session harness, speculative-mirror, merge-resolution, adaptive-budget,
  context-overflow, prompt-warmth ledger, second-opinion + plan-critique runners, observation recorders).
- `runtime-server.ts` **2527 → 2230**; `nklein-provider-service.ts` **1651 → 933**.

**What remains in the big-3 is NOT clean-autonomous (unchanged from the prior checkpoint, now more sharply true):**
- task-session-service's remainder is the ENTANGLED PRIMARY LIFECYCLE — `startTaskSession` (~400 lines), `sendTaskSessionInput`,
  `dispatchResolvedTaskInput`, `startRuntimeTaskSessionFromLaunchConfig` (~180), `handleTaskEvent` — plus cross-cutting helpers
  (`recordObservationWithModel` 9 refs, `resolveProviderIdForTask` 8, `cacheLaunchConfig`/`launchConfigByTaskId` 20+ refs) whose
  extraction is a WIDE, risky rewrite. Decomposing the lifecycle needs a **David boundary decision** (as he gave for the
  review-cluster seam) — the module boundary is genuinely ambiguous and it's not "one bounded cluster."
- runtime-server's remainder is the big `createRuntimeServer` closures (headless-auto-review ~430 lines with mutable in-flight
  sets; the ~500-line scoped-service factory) — large single clusters, ambiguous boundary → David.
- provider-service (933) is reasonably sized; the only remaining item is the optional 2→1 base-URL fetcher consolidation
  (now covered, so unblocked, but low-value / log-shape risk).

§5.Z heavy flows (need a live workspace) + §5.AZ release prep (David-gated) remain per prior entries.

### Fable UI/UX pass (2026-07-06, user-directed interrupt of the polishing grind)

David switched the session to Fable for the FULL UI/UX double-check + build-out. All decisions gathered up front via
question rounds, then executed autonomously. Shipped (each commit gated tsc×2 + biome + web suite + test:fast):
- **`36025af3` W3.1** — main chat gets the SHARED renderer (tool/reasoning/status blocks, markdown, card-chip row,
  collapsed+live-expand per the user pick); tool exchanges persist as transcript rows; display roles never enter the
  model prompt; live tool SSE events → activity chips.
- **`77534fb6` zoom ladder** — FIVE levels (user pick): Z0 Chat-only (new) · Z1 Overview (default) · Z2 Lean · Z3 Expert ·
  Z4 Professional; v1→v2 persisted-zoom migration; §5.BA wizard gains the "How much do you want to see?" step.
- **`d7c6ba75` W3.2 + chat surfaces** — Stop button + 180s stalled-SSE watchdog; focus-chain plan strip
  (chat.getFocusChain); map hover-spotlight (chat chip hover → Z1 bubble ring).
- **`327b8516` W3.4** — BoardDagView (comprehensive DAG: status nodes, pan/zoom, cycle edges loud, any-zoom entry);
  needs-you badge in the zoom bar; mailbox "N pending notes" card badge (new getCardMailboxCounts); context-truncation
  indicator in the main chat.
- **`13023bb6`** — §5.BC verified-as-decided (toggle + de-emphasis already shipped); carousel cyan confirmed; web-ui
  biome now 0 warnings.
- **HELD (recorded in todo §5.BB):** the four env-only flag panels (need server config-threading first) + the
  fitness-table browser (needs an endpoint). Egress/searchBackend/speculative settings verified already present.

### Post-Fable resume (2026-07-06, back on Opus) — held-item triage + fitness endpoint

Back on the §5.0.7 polishing grind after the Fable UI/UX pass. David greenlit the two held UI follow-ups as OPTIONAL
server-side polishing slices. Triaged both:
- **Fitness-table read endpoint — SHIPPED (`a5e5c3d5`).** The clean, non-dark half: a TESTED pure view builder
  (`core/fitness-table-view.ts` — flattens the (model × role × difficulty) fitness rows, derives successRate, sets the
  `belowBar` failing-LLM flag, worst-first sort; 5 tests) + a thin read-only `runtime.getFitnessTable` adapter + client
  fetch. Purely additive, zero behavior change. Unblocks the future Fable fitness-browser panel (one query away).
- **Dark-flag config-threading — DEFERRED (recorded, not ground).** The four still-env-only flags (NKLEIN_REVIEW_LENSES,
  NKLEIN_CHAT_ADAPTIVE_TRUNCATION, NKLEIN_REASONING_BUDGET, NKLEIN_BASIC_MEMORY) each need the FULL first-class-config
  treatment to round-trip: **~21 sites across 9 files per flag** (contract, types×3, state-factory, update-merge,
  global-payload×3, change-detection, runtime-config×5, + the consumer). That's heavy, delicate plumbing with near-zero
  IMMEDIATE value (no UI to set them) — genuinely better bundled with the Fable panels so field+read-path+UI land as one
  coherent, immediately-valuable, gated unit. **`NKLEIN_BASIC_MEMORY` additionally is sandbox-mount/ISOLATION-sensitive →
  David-gated** (making mount policy config-driven risks the strict-isolation prime directive if misconfigured). Not a
  clean autonomous slice; flagged for the bundled UI slice.

**Vein re-confirmation:** §5.V high-value coverage is saturated (the two remaining `runtime-endpoint.ts` untested exports
are the TLS getter + fetch-timeout installer that slice 36 explicitly skipped as low-value; `summarizeWorkspaceBoardStreams`
is thin glue over the already-tested `summarizeBoardStreams` core — testing it = padding). §5.U big-3 is mined
(task-session-service **4886 → 2773** across the run; remainder = the entangled primary lifecycle, David-gated boundary).

### §5.Z sweep (2026-07-06, Opus polishing, live env: heavy roster + egress LIVE)

David's machine had a HEAVIER resident roster than prior §5.Z sweeps (qwen3.5-122b-a10b, qwen3.6-27b@q4_k_m, devstral,
qwen2.5-coder-14b, coder-gpu, qwen3-8b) + egress live at 18888. Ran two bounded, high-value §5.Z verifications on it
(direct-model harnesses — no runtime/Docker beyond the SearXNG container):
- **Egress (§5.AC) re-verified — 6/6 e2e (`8b70c97f`).** verify-egress-live ✅ (real results, fail-closed gate,
  no_backend, payload map) + verify-egress-model-e2e 6/6 (model → web_search → live SearXNG → grounded answer). NEW
  data points: the 122B MoE + 27B + devstral weren't in the prior (lighter) sweep. Egress proven 8B→122B.
- **chat-agent-tools (§5.M) — 6/6 + W3.1 regression check.** verify-chat-agent-tools 6/6 across the resident roster;
  doubles as a LIVE regression check of the Fable W3.1 `chat-agent-turn.ts` change (persist user BEFORE the tool loop) —
  every run confirmed `User + assistant persisted: YES` with correct ordering. The chat tool-loop composes end-to-end on
  8B→122B after the renderer/transcript rework.
- Re-confirmed the /v1/models-vs-`state=loaded` caveat (gpt-oss-120b registered-but-not-resident → JIT-load hit the
  memory ceiling); only loaded ids were swept (never force a giant to load — operator's call).
- **decompose-isolation (§5.A) on qwen3.6-27b@q4:** isolation invariant HELD ✓ (zero host-path leaks, clean container
  teardown); decompose capability inconclusive (model went `interrupted` without a decompose_project call under 240s).
- **chat-command-exec (§5.M G2) re-confirmed** on qwen2.5-coder-14b: agent used run_command, the marker echoed back
  (command executed + output flowed into context) — the confirmed-host-command path holds on the current roster.
- **§5.U/§5.V (non-LLM, foreground while the sweeps ran):** extracted the board dependency-graph's pure model
  (`board-dag-model.ts` — cycle-guarded longest-path layering + DFS back-edge cycle detection, previously inline +
  untested in the Fable-built DAG view) with 10 tests pinning the correctness-critical cycle detection (`99a86eeb`).

### 2026-07-06 (Opus) · §5.AZ CI-hygiene + a SILENT pre-commit-gate outage found & fixed

Two release-prep (§5.AZ) items this iteration:
- **Fork-drift guard shipped (`731e7b61`):** `.husky/pre-commit` now runs `npm run test:vendor` (the 4 forked Cline-SDK
  suites, 1814 tests) ONLY when a commit stages a `vendor/**` file — catching silent fork rot at the source without the
  ~30s cost on ordinary commits. Closes the §5.AZ "wire test:vendor" TODO (a hosted-CI mirror remains for later).
- **★ Found the pre-commit gate was SILENTLY OFF.** `git config core.hooksPath` was `/Users/david/GIT/kanban/.husky/_`
  — a stale ABSOLUTE path from before the kanban→nklein rename; that dir no longer exists, so husky fired NO hook and
  every commit since the rename skipped tsc+biome+test:fast with zero warning. (My own gate discipline caught nothing
  bad — I run the checks manually each commit — but the automated safety net was dead.) **Fixed** locally:
  `git config core.hooksPath .husky/_` (repo-relative → survives future moves); verified the hook now fires
  (`Running biome…` → `Pre-commit checks passed`). Recorded the gotcha in todo.md §4A next to the sibling `core.bare`
  incident (it's worse — silent, and the hook's own self-heal can't help since the hook never runs). No committable
  fix (it's untracked local `.git/config`); `npm install` re-sets it via the `prepare: husky` script.
