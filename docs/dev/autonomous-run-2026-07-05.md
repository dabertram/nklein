# Autonomous run — 2026-07-05 (multi-day, David away)

Living log of the autonomous grind + **the collected items that need David's guidance** (the `/goal`'s "collect everything that really needs my guidance"). Update as the run continues.

## ★ DECISIONS OWED (David) — consolidated 2026-07-05, RESOLVED same day

David reviewed all seven via AskUserQuestion. Decisions 1-2 applied (code + tests flipped, gate green); 3 deferred;
4/5/6 approved to build now (see below for progress).

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
