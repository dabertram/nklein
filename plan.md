# !Klein — Local-Autonomous Swarm Plan (consolidated)

> **Note:** This document is the consolidated successor to the original `plan.md` and `plan2.md`
> (the implementation review), merged into a single source of truth.
>
> **Live document set (2026-06-19):** the live, maintained docs are **`plan.md`** (this file — phased
> implementation tracker), **`specsheet.md`** (the canonical feature spec / source of truth for what !Klein
> *is*), **`iteration-instructions.md`** (the perpetual-iteration playbook for an agent), and
> **`follow-up-5.md`** (latest audit findings). The earlier `follow-up-1.md` … `follow-up-4.md` and
> `findings-from-follow-up-work-4.md` are now **historical/archival** — their open items are folded into the
> "Consolidated status" section below. Do not re-mine the archive; work from this section, `specsheet.md`,
> and `follow-up-5.md`.

---

## Consolidated status (last reconciled 2026-06-19)

**Health:** typecheck ✓ · web:typecheck ✓ · lint ✓ (537 files) · cline-boundary ✓ ·
`test/runtime/cline-sdk` 396/42 ✓ · protected suite 79/9 ✓.

**Recent (2026-06-19):** §2.A decomposition restored under isolation; §3.1 isolation guard tests protected
(human-approved); §2.B start-path retirement locked + deletion blockers mapped; §2.C **strict isolation
verified end-to-end on a real Cline task in Docker against LM Studio** (container observed, no host worktree,
clean teardown, fail-closed, clean telemetry) via a new scripted runbook; §3.7 sandbox empty-teardown patch
capture now records info instead of noisy runtime errors; §3.2 parked cloud-dependent helpers are documented
and hidden from local-only UI/runtime affordances. Remaining open: §2.B code deletion (UI-gated), §2.C
**browser-only** UI checks, and the §3.x polish below.

**Done and verified:** L0 cloud lockdown · L1 reliability (never-overflow guard, real effective window,
local timeouts, back-off, acceptance shell, context bar) · L2 swarm executor (concurrency, auto-start,
endpoint serialization, tool routing, roles, guardrails) · L3 decomposition machinery (recursive expand,
clarifying questions, summary, adaptive re-plan, revisions) · L4 operator UI (cockpit, swarm header+Stop,
MCSR panel, DAG review+approve, diagnostics drawer, first-run wizard, code-intel, activity surface,
settings coverage, coverage matrix) · follow-up-1 robustness (200k clamp relaxed, oversized-prompt graceful,
cold-start floor, tree-sitter repo map, hybrid local embeddings, MCSR decay, no-diff self-review, dogfood
clamp, null-delta merge block) · follow-up-2 hardening (workspace identity, artifact ownership,
lost-session recovery, persistence split, advisor send, code-intel settings, dev-tools gating) · follow-up-3
rename (!Klein/nKlein/nklein + migration), evidence one-click, self-improvement project, protected suite,
guidance skills, security hardening, cloud-UI hidden · follow-up-4 §A–G,K (model-telemetry prune+filter,
live loaded model, NO-CLOUD clamp, Developer Mode, embedding auto-discovery, board pause halts loop,
per-card pause/resume, chat timestamps, full-width context bar) · follow-up-4 ★J strict Docker isolation
(image, runner, manager, pool, queue, clone-in/patch-out, fail-closed, acceptance, MCP disable, network,
unit+integration tests).

**Open work (tracked in `follow-up-5.md`; see that doc for full detail):**

- [x] **🔴 §2.A — Restore autonomous decomposition→cards under strict isolation.** *(done 2026-06-19)* The
      trusted control-plane `decompose_project`/`expand_task` tools now stay available host-side even under
      isolation (they mutate only `~/.cline/nklein/` plan artifacts + the board via `mutateWorkspaceState`,
      never the user's working tree), so sandboxed planning can again produce a Planning-lane DAG of cards.
      Implemented in [cline-session-runtime.ts](src/cline-sdk/cline-session-runtime.ts) (always include the
      decomposition tools), [cline-task-session-service.ts](src/cline-sdk/cline-task-session-service.ts)
      (planning prompt advertises the workflow again; host `workspaceRoot` always forwarded so artifacts/board
      resolve to the owning workspace, not the container workdir). Covered by updated session-runtime +
      task-session-service tests.
- [~] **🟠 §2.B — Retire the host worktree subsystem.** *(direction decided 2026-06-19: retire — terminal/CLI
      agents stay permanently disabled under local-only. Start-path retirement confirmed + locked this
      session.)* Done so far: the boundary is the single predicate `usesLegacyHostTaskWorkspace(agentId)`
      ([agent-catalog.ts:97](src/core/agent-catalog.ts#L97)) — now documented as THE source of truth and
      covered by an invariant test ([test/runtime/agent-catalog.test.ts](test/runtime/agent-catalog.test.ts))
      proving Cline/default/null never create a host worktree; under local-only every agent clamps to `cline`,
      so no reachable task start creates a worktree. AGENTS.md worktree note reconciled to the
      container-primary model (2026-06-19). **Reachability audit (2026-06-19): the worktree modules are NOT
      dead and cannot be safely deleted yet.** Every helper has live callers: `ensureWorktree` is live
      web-ui/CLI contract (gated by `usesLegacyHostTaskWorkspace`, dead-at-runtime for Cline but
      compile-coupled), and `ensureTaskWorktreeIfDoesntExist` + the saved-patch sync are reachable via
      user shell-terminals-on-a-task (`startShellSession` → `resolveTaskCwd({ ensure: true })`) and legacy
      diff/merge reads. **True deletion is therefore blocked on two larger, UI-verifiable changes:** (1) remove
      terminal/CLI agents from `RUNTIME_AGENT_CATALOG` / launch-support and the web-ui legacy path, and (2)
      decide the shell-terminal-on-task story (it still legitimately ensures a host checkout). Schedule both in
      an environment where the review/diff/merge + shell UI can be verified. The saved-host-patch retirement
      and project-health "accidental worktree" re-validation ride along with (1).
- [~] **🟠 §2.C — End-to-end verification.** *(headless parts DONE 2026-06-19; UI parts still owed.)* Verified
      against real Docker (29.4.3) + real LM Studio (`qwen3.5-9b-mlx-8bit-m4-32kctx`) via the new scripted
      runbook [scripts/verify-strict-isolation.mts](scripts/verify-strict-isolation.mts) (run against an
      isolated HOME): a **real Cline task** booted the SDK against the local model and **a shared
      `nklein-agent-sandbox-1` container appeared**, **no host worktree** was created, and the container **tore
      down cleanly** on dispose; the Docker-gated `agent-sandbox.integration.test.ts` passes against the real
      image; **fail-closed** confirmed (bogus `NKLEIN_AGENT_SANDBOX_IMAGE` → `AgentSandboxUnavailableError`
      remediation, zero containers); run telemetry showed **zero** `Insufficient balance` / `1s timeout` /
      `>1M overflow` / `context_overflow` / `provider_error`. **Still owed (needs the in-app browser):**
      Settings isolation status + pool-control inspection, and dev-build UX (no Claude default, registry prune,
      live loaded-model line, Developer Mode persistence, embedding auto-discovery).
- [x] **🟠 §3.1 — Protect the strict-isolation guard tests.** *(done 2026-06-19, human-approved)* Added
      `cline-agent-sandbox-host-guard`, `cline-agent-sandbox`, and `cline-task-start-guard` to
      `test/protected/protected-tests.json` + README; protected suite now 9 files / 79 tests. Weakening agent
      isolation now requires explicit human approval via the write-guard.
- [x] **§3.7 — Sandbox patch-capture teardown polish.** *(done 2026-06-19)* Result-patch finalization now
      treats early teardown/no-workspace staging races as benign "no changes to capture" observations and
      still emits warnings for real capture failures. Covered by task-session-service regression tests.
- [x] **§3.2 — Parked cloud-dependent features hidden.** *(done 2026-06-19)* Advisor/model-research, host
      web-research, native Cline teams, and trusted auto-merge remain documented parked helpers; Settings no
      longer renders advisor actions in local-only mode, host web research is not registered while
      `CLOUD_ENABLED=false`, and native SDK team delegation stays disabled even if the legacy env flag is set.
      Covered by runtime + web-ui regression tests.
- [~] **§3.3 — Agentic workflow consistency under isolation.** *(partly verified 2026-06-19)* Acceptance
      auto-repair uses the scoped sandbox verifier without resolving a host worktree; plan-gap and
      expand-plan-task resolve the owning workspace repo path; task merge already has result-branch coverage
      proving it skips legacy worktree resolution when a result branch exists. Remaining: verify the swarm
      concurrency cap and sandbox pool queue compose visibly in the card/header UI.
- [ ] **§3.4/§3.5/§3.6 — Polish:** UX polish for paused/queued/sandbox-unavailable card states + isolation
      empty state; centralize the legacy predicate; consider extracting sandbox-lifecycle/pause from
      `cline-task-session-service.ts`; reconcile docs so L3 isn't overstated.

---

## Context — why this rewrite

The original `plan.md` aimed at making **8–16k** small models usable and treated cloud models as a
normal, always-available option. Two things changed:

1. **Cloud caused real harm and is now banned.** One day of telemetry (`~/.cline/kanban/telemetry/2026-06-17.jsonl`,
   2,284 events) shows !Klein defaulting to the `cline` provider → `anthropic/claude-sonnet-4.6` and:
   - **678×** `"Insufficient balance … $0.00"` — relentless cloud retries with no credits.
   - **227×** `"Maximum prompt length exceeded: 1,102,640 tokens exceeds the 1,000,000 token limit"` —
     a task ballooned to **1.1M tokens** and kept hammering a *paid* API.
   - **227×** `"timeout after 1 seconds"` (tool + stream) and **453×** `"No previous Cline session config is available"`.

   Runtime artifacts under `~/.cline/kanban` confirm cloud is wired in as the default at *every* layer:
   `cline-provider-selection.json` selects **`openrouter`** (cloud) and `config.json`'s `selectedAgentId`
   is **`cline`** (cloud) — even though `modelRoles` already point at **local** lmstudio qwen models
   (architect/worker/reviewer); dev-run snapshots seed cards with `agentId: "cline"`. `config.json` also
   has all timeouts `null`/`"unlimited"`, so the **1-second timeouts are a code default/bug, not user
   config**. And `model-registry.json` shows the in-use local model with `contextWindow.effective = null`
   and `speed.samples = 0` — the **MCSR never resolved the window or measured speed**, so budgets fall
   back to a bogus 200k/120k "smart budget" heuristic (which is why an 80k model looked "healthy" at 87k).

   **Decision (locked): LOCAL MODELS ONLY.** Cloud is hard-disabled in code with no UI/flag to
   re-enable. A card pointing at a cloud model **hard-stops** with a clear message. Cloud may be
   revisited *later* — but not now, and not by accident.

2. **The window target moved up.** We no longer chase 8–16k; the minimum is **≥30k** context
   (already implemented at **32k**). Most of the old "fight to survive 8k" work is therefore obsolete
   and is crossed off below.

The goal is unchanged in spirit but tighter in scope: **a lean, autonomous, multi-LLM swarm that runs
entirely on local models, decomposes complex ideas into right-sized cards, and runs many of them in
parallel without ever melting the machine or shipping garbage.**

`plan2.md` was a thorough implementation review of the `feat/kanban-reliability-context-upgrade` branch;
its findings are folded in below — resolved ones crossed off, open ones carried forward with detail.

**Cross-cutting rules (unchanged):** stay upstream-mergeable (every feature is a `src/cline-sdk/`
plug-in on an official SDK socket — *never* patch `node_modules/@clinebot/*`); everything
context-related is model- and speed-aware with no hardcoded window/speed constants; never start an
unrealistic task; never emit an oversized prompt.

Legend: `- [x] ~~done~~` = already implemented/verified · `- [ ]` = open work.

---

## Phase L0 — LOCAL-ONLY LOCKDOWN  *(do first; blocks all other phases)*

**Outcome:** It is *impossible* for any request to reach a paid/cloud LLM. No cloud provider appears
in the UI, no task can start on one, no router/role/decomposition path can select one. Re-enabling is a
deliberate code change in **one** place, never a setting.

Design it as a single **default-deny allow-list** module — not scattered `throw`s — so the lockdown is
auditable and the eventual "unleash cloud" switch is one file.

> **Progress (implemented in this branch — verified by typecheck, Cline boundary checks, runtime/provider
> tests, and local-only policy tests):** the policy module, dispatch gates, registry dedupe, runtime hard-stop,
> safe defaults, UI catalog/picker filtering, router/role filtering, cloud-pinned resume handling, and boundary
> scan coverage are **done**. Re-enabling cloud remains a deliberate code change in
> `cline-local-only-policy.ts`, not a runtime toggle.

- [x] ~~**Create `src/cline-sdk/cline-local-only-policy.ts`** — the single source of truth.~~ *(done)*
  - [x] ~~`LOCAL_PROVIDER_IDS = { "ollama", "lmstudio", "lm-studio" }`~~ — done; `cline-model-registry.ts`
        now **imports** `LOCAL_PROVIDER_IDS` (its `LOCAL_SERIALIZED_PROVIDER_IDS = LOCAL_PROVIDER_IDS`), no duplication.
  - [x] ~~`isLocalProvider(providerId, baseUrl?)`~~ — done, with `isLocalBaseUrl` covering
        `localhost` / `127.0.0.1` / `::1` / `0.0.0.0` / `*.local` / RFC-1918 / link-local / CGNAT; managed
        OAuth (`cline`/`oca`/`openai-codex`) always denied; everything non-local default-denied.
  - [x] ~~`assertLocalProviderAllowed(...)` → typed `CloudProviderDisabledError`~~ — done (+ `isCloudProviderDisabledError` guard).
  - [x] ~~`CLOUD_ENABLED = false` single switch~~ — done.
- [x] ~~**Gate the request chokepoint** — `resolveLaunchConfig()`~~ — done: `assertLocalProviderAllowed`
      is called in [cline-provider-service.ts](src/cline-sdk/cline-provider-service.ts) right after the
      provider id is resolved and **before** any OAuth/API-key/network work. This alone makes it impossible
      to dispatch to cloud (a `cline`-defaulted card now throws `CloudProviderDisabledError` here).
- [x] ~~**Belt-and-suspenders at task start** — in `runtime-api.ts` `startTaskSession`
      (~[runtime-api.ts:348](src/trpc/runtime-api.ts#L348)): re-assert after `resolveLaunchConfig`, and
      translate `CloudProviderDisabledError` into a **hard-stop + parked card** with the clear message
      (chosen behavior: refuse, don't auto-substitute). Surface it in the task summary, not a silent retry.~~
- [x] ~~**Stop the cloud default everywhere it's persisted.** A fresh install (and existing state) must
      **never** auto-select cloud:
  - [x] `SDK_DEFAULT_PROVIDER_ID` / `SDK_DEFAULT_MODEL_ID`
        ([sdk-provider-boundary.ts:43-44](src/cline-sdk/sdk-provider-boundary.ts#L43)) and the runtime
        default agent ([runtime-config.ts](src/config/runtime-config.ts), `selectedAgentId` defaults to `cline`).
  - [x] The persisted provider selection — observed value is `openrouter` (cloud) in
        `~/.cline/kanban/cline-provider-selection.json`; a cloud selection must be rejected/ignored on load
        (fall through to a local provider or the hard-stop), not silently honored.
  - [x] The Dev Test Project seeds cards with `agentId: "cline"` (seen in dev-run `config-snapshot.json`) —
        seed the configured **local** agent/role instead.
  - With no local model configured, starting a task hard-stops with the configure-a-local-model message
    instead of falling back to `cline`.~~
- [x] ~~**Filter the provider catalog & model picker** so cloud options never render:
      `getProviderCatalog()` ([cline-provider-service.ts:1229](src/cline-sdk/cline-provider-service.ts#L1229)),
      `fetchClineProviderCatalog()` ([runtime-config-query.ts:122-154](web-ui/src/runtime/runtime-config-query.ts#L122)),
      and the hardcoded cloud recommendations in
      [cline-model-picker-options.ts:5-19](web-ui/src/components/detail-panels/cline-model-picker-options.ts#L5).~~
- [x] ~~**Block cloud at routing/role resolution too** — the capability router
      ([cline-task-router.ts](src/cline-sdk/cline-task-router.ts)) and role resolution
      (`modelRoles`) must drop cloud candidates so a "route up" can never escalate *into* cloud.~~
- [x] ~~**Make existing cloud-pinned cards safe.** Any task whose persisted `clineSettings` names a
      cloud provider hard-stops on (re)start with the clear message — including resume-from-persistence
      and the overflow-recovery restart path. No migration that silently rewrites them.~~
- [x] ~~**Tests:** policy unit test is **done**
      ([test/runtime/cline-sdk/cline-local-only-policy.test.ts](test/runtime/cline-sdk/cline-local-only-policy.test.ts),
      8/8 green — covers cloud-id deny, local-id allow, managed-OAuth-always-cloud, custom local-baseUrl
      allow, host classification, typed-error guard). **Now also covered:** catalog/picker omit cloud, cloud
      selections are ignored on load, cloud saves/OAuth are blocked, cloud-pinned starts hard-stop, and the
      router never returns a cloud candidate. The local-only policy test now also scans production TypeScript
      for concrete cloud-provider literals and fails unless the occurrence is confined to a documented boundary
      file; CLI Cline provider/model examples now point at local models.~~

---

## Phase L1 — Reliability stabilization  *(fix the bugs that are actually killing the loop)*

**Outcome:** The dogfood loop stops self-destructing. No oversized prompt is ever emitted (even
locally), session restart works, slow local models aren't killed by tiny timeouts, and errors back off
instead of storming. These are the concrete failures behind the telemetry above.

### L1.1 — Authoritative, never-overflow pre-send guard
- [x] ~~A proactive pre-send guard exists~~ ([cline-task-session-service.ts:666-695](src/cline-sdk/cline-task-session-service.ts#L666)) —
      it compacts history and throws if projected tokens exceed the window.
- [x] ~~**Fix the window it trusts.** The guard compacts to the model's *advertised* window; the cloud
      Sonnet advertised ~1M, so it compacted-to-1M and sent 1.1M. The effective window must be
      `min(advertised, user-configured, !Klein hard ceiling)`. Replace the 1M-trusting path so the
      guard target is the **effective** window, sourced consistently with what the SDK actually uses
      (see `resolveKnownContextWindowForTask` / `DEFAULT_CLINE_CONTEXT_WINDOW_TOKENS`,
      [cline-task-session-service.ts:662-664](src/cline-sdk/cline-task-session-service.ts#L662)).~~ Session
      start/restart now normalizes launch windows through a !Klein-owned effective ceiling before building
      prompts, approvals, initial messages, or dispatching to the SDK; runtime routing passes the selected
      MCSR/user effective window into the Cline session instead of the provider-advertised window; the router,
      decomposition feasibility guard, and chat-panel fallback budget display all prefer MCSR effective windows.
- [x] ~~**Add an absolute !Klein-owned ceiling.** A hard cap (derived from the resolved local window, with
      a sane maximum) above which a request is **never** assembled or sent, regardless of what any
      provider advertises. If, after maximal compaction, projected tokens still exceed the effective
      window → **stop the task with a clear message**, never send. (Local-only makes this cheap to be
      strict about: local windows are knowable, e.g. the in-use `qwen3.5-9b-…-ctx80k` = 80k.)~~
- [x] ~~**Convert overflow telemetry from reactive to also-proactive.** Today `context_overflow` is
      emitted only after a provider 400 ([cline-task-session-service.ts:608-618](src/cline-sdk/cline-task-session-service.ts#L608)).
      Emit a *pre-send* "would-overflow, compacted/blocked" signal so the data shows the guard working,
      not just failures.~~

### L1.2 — Fix session restart / resume (the 453× error)
- [x] ~~**`"No previous Cline session config is available"` on restart.** The overflow-recovery path calls
      `restartTaskSession(... launchConfigOverrides ...)` ([:737-748](src/cline-sdk/cline-task-session-service.ts#L737))
      but the launch config isn't reliably available, so the restart throws — turning a recoverable
      overflow into a hard failure (and feeding the "max consecutive mistakes" cascade). Persist the
      resolved launch config with the session and reuse it on restart/resume; add a regression test that
      compacts → restarts → succeeds without a config lookup failure. (Tribal-knowledge match:
      AGENTS.md notes the host won't expose its session map — restart must come from persisted history.)~~
      Done via public SDK session metadata (`kanban.launchConfig`) plus service-level fallback starts when
      the runtime's private last-start cache is empty; no host session-map casting.

### L1.3 — Local-appropriate timeouts (the 227× "1 seconds" error)
- [x] ~~**Find and fix the 1-second tool/stream timeouts.** `config.json` has `agentTimeoutMode:
      "unlimited"` and every timeout field `null`, yet telemetry shows `"timeout after 1 seconds"` ×227 —
      so this is a **code default/bug**, not user config (likely a `null → 1` or seconds/ms confusion).
      Trace `timeoutMode` / tool-execution + stream-inactivity timeouts from `clineSettings`
      ([api-contract.ts](src/core/api-contract.ts)) through the session runtime; a 1s timeout is fatal on
      a slow local model (low prefill tok/s). Defaults must be local-model-aware (scale to MCSR
      wall-time-per-1k-tokens, or at minimum a generous local floor) and honor `"unlimited"`. Verify no
      path resolves a timeout to `1`.~~ Legacy `cloud` timeout profiles now resolve to generous local
      floors in runtime config and runtime dispatch; stale positive task/global timeouts clamp to at least
      60 seconds before reaching Cline start/stream/tool scheduling; `unlimited` still resolves to `null`;
      and runtime dispatch raises positive local Cline request/stream/tool/agent/conversation timeouts from
      measured MCSR speed observations (`wallTimeMsPer1kPromptTokensEwma`, prefill/decode rates, TTFT, and
      observed wall time) without lowering configured values.

### L1.4 — Error back-off (no retry storms)
- [x] ~~**Don't loop on the same error.** Even with cloud gone, ensure repeated identical failures back
      off and respect `maxConsecutiveMistakes` (SDK-native) instead of re-emitting hundreds of identical
      signals. The "Detected N consecutive identical calls" stopper exists; extend the same discipline to
      start/send failures so a broken card parks instead of storming the telemetry.~~

### L1.5 — Acceptance gate must not freeze on a login shell  *(plan2.md L4)*
- [x] ~~`resolveShellExecution` runs `"$SHELL" -lc <command>`
      ([cline-acceptance-gate.ts:45-83](src/cline-sdk/cline-acceptance-gate.ts#L45)). AGENTS.md
      explicitly warns profile-loading shells on hot paths freeze conda/nvm setups. Use a non-login
      shell or direct exec with an explicit PATH; raise/stream `maxBuffer` (currently 2 MB → a passing
      command with large output throws `ENOBUFS` → false failure).~~

### L1.6 — Context budget visualization bar (UI)  *(replaces "request context / available context / health")*

**Outcome:** The card chat panel shows a single segmented, colored bar (VS Code Cline style) that
visualizes the **entire prompt that will actually be sent** to the local model, broken into its parts, as
a fraction of the model's **real** effective context window — green when healthy, shading through
yellow → orange → red as it fills/overflows. This makes the very failure mode behind the 1.1M incident
visible instead of buried in a text label.

**Backend — expose a faithful breakdown (don't let the UI guess):**
- [x] ~~Add a structured `ContextBudgetBreakdown` per task, computed from the **same source as the pre-send
      guard (L1.1)** so it reflects what will be sent, not a frontend estimate. Segments:
      `systemPromptTokens` (append-system-prompt + SDK base system prompt + rules),
      `toolSchemaTokens`, `taskPromptTokens` (card title/prompt + injected task info),
      `userMessageTokens`, `includedFileContentTokens` (retained `read_files` output),
      `otherHistoryTokens`, plus the reserves from `buildKanbanContextSafetyBudgets`
      (`reservedPromptOverheadTokens`, `reservedOutputTokens`), `usedWorkingTokens`, `freeWorkingTokens`,
      and `effectiveContextWindow`.~~ Summaries now expose a breakdown driven by the same
      effective context window and token counters as the pre-send guard; tool schema and precise retained
      file-output segmentation are backend-owned, with retained `read_files` / `read_large_file` tool
      results split into `includedFileContentTokens` instead of being folded into other history.
- [x] ~~Source system/tool token counts from the SDK where it exposes them; otherwise estimate with the
      existing `gpt-tokenizer`.~~ The SDK does not expose a public per-request system/tool breakdown here,
      so !Klein now counts the exact system prompt it passes to the SDK and estimates enabled !Klein
      tool-schema overhead from the active tool policy surface with `countKanbanTextTokens`.
- [x] ~~Flow the breakdown through the runtime session summary / tRPC alongside `contextWindowByTaskId`.~~
      `RuntimeTaskSessionSummary.contextBudgetBreakdown` carries the backend breakdown to the chat panel.
- [x] ~~Use the real effective window (L1.1 / MCSR), not the 200k/120k/160k "smart budget" heuristic in
      `formatClineContextBudgetDisplay`.~~ Backend breakdowns display the real effective context window, and
      frontend-only estimates now say "effective model window" when a model window exists or "fallback
      working budget" when it does not.

**Frontend (web-ui) — the bar:**
- [x] ~~New stacked, segmented bar component (Tailwind + design tokens, dark theme) rendering the segments
      in order — system prompt · tool schemas · task/user prompt · included file content · other history ·
      reserved working · reserved output — each sized to its share of the effective window, filling the bar
      left→right; reserved output/overhead shown as distinct trailing (muted/hatched) segments so headroom
      is visible.~~
- [x] ~~Health color ramp on the fill.~~ Usage drives `status-green`, `status-gold`, `status-orange`, or
      `status-red`, with overflow treated as red.
- [x] ~~Replace the current text line and separate request/model/health pieces with this bar.~~ The backend
      breakdown renders a segmented bar with compact summary text and per-segment token tooltips.
- [x] ~~Update `formatClineContextBudgetDisplay` and its tests.~~ The fallback formatter now distinguishes
      effective model windows from fallback working budgets, and tests cover overflow wording without
      claiming heuristic budgets are available model context. Degrade gracefully when a breakdown
      field is unavailable — fold unknowns into an "other" segment rather than hiding the bar.

---

## Phase L2 — Parallel local swarm executor  *(the "multiple LLMs in parallel" focus)*

**Outcome:** The user configures a roster of **local** models with roles, and !Klein auto-starts every
currently-unblocked card up to a concurrency cap, serializing tasks that share one local GPU/endpoint
while running distinct endpoints truly in parallel — without thrashing the machine.

### L2.1 — Foundations (already present)
- [x] ~~`modelRoles` config exists~~ — record of role → `clineSettings`
      ([runtime-config.ts](src/config/runtime-config.ts), [api-contract.ts:122-123](src/core/api-contract.ts#L122)).
- [x] ~~Capability router exists~~ ([cline-task-router.ts](src/cline-sdk/cline-task-router.ts)).
- [x] ~~Per-endpoint serialization scaffold exists~~ ([cline-endpoint-scheduler.ts](src/cline-sdk/cline-endpoint-scheduler.ts)),
      with a local-provider set.
- [x] ~~`maxConcurrentTasks` setting exists~~ (default 3, [runtime-config.ts:100](src/config/runtime-config.ts#L100)).
- [x] ~~Worktrees isolate parallel tasks; the linking DAG models dependencies~~
      ([task-board-mutations.ts](src/core/task-board-mutations.ts)).

### L2.2 — The missing executor (the real gap)
- [x] ~~**Active concurrency enforcement.** `maxConcurrentTasks` is stored but **never enforced** — no code
      starts/stops tasks against it. Build a scheduler that tracks running sessions and admits new starts
      only under the cap.~~ Implemented across single-card starts, backlog batch starts, dependency auto-starts,
      and runtime API starts; backend enforcement counts running/review project task sessions across terminal and
      already-loaded Cline services without cold-starting Cline just to enforce the cap.
- [x] ~~**Auto-start unblocked cards.** When a card completes/commits, automatically start every card whose
      `dependsOn[]` is now satisfied, subject to the cap and per-endpoint serialization. This is the
      payoff of decomposition (L3): feed it a correct DAG and it runs hands-off.~~ Existing linked-task
      completion/trash and auto-review flows now auto-start only the newly unblocked backlog cards that fit
      under the concurrency cap. Per-endpoint serialization remains tracked separately below.
- [x] ~~**Local-endpoint serialization, parallel across endpoints.** Serialize tasks that target the *same*
      local endpoint (one 9B server can't serve many at once); parallelize across *distinct* local
      endpoints. Drive ordering/pacing from the MCSR wall-time estimate (tokens ÷ measured decode rate +
      prefill) so we don't fire everything at once and thrash one server.~~ Endpoint-busy decisions carry a
      dedicated `endpoint_busy` response code plus an optional `retryAfterMs` estimate derived from the
      MCSR's observed wall-time and the running session's `startedAt`; opt-in queued admission now
      deduplicates starts per workspace/task, retries queued dependency auto-starts when Cline summary events
      show an endpoint freed, and requeues with the observed wait estimate if the endpoint is still busy.
- [x] ~~**Plan2.md H3 (re-scoped):** `getSharedEndpointId` defaults a `sharedEndpointId` for *every*
      registry entry ([cline-model-registry.ts:212-216](src/cline-sdk/cline-model-registry.ts#L212));
      under local-only the failure mode flips — ensure serialization keys are correct *per local GPU/endpoint*
      and that two distinct local endpoints never collide onto one shared id. (Cloud serialization is now moot.)~~
      The scheduler and registry now share the local-only policy for endpoint serialization, including custom
      local OpenAI-compatible providers, and regression tests cover same-endpoint blocking plus distinct-endpoint
      parallel starts.
- [x] ~~**Per-model tool routing for weak local models.** Wire the SDK's native `model-tool-routing`
      (`ToolRoutingRule`) so a small local model gets a trimmed, sequential toolset and a strong local
      model gets the full set. Config we own at the boundary — no SDK fork.~~ !Klein now passes a typed
      SDK `ToolRoutingRule` that trims fragile/default tools (`fetch_web_content`, `skills`,
      `ask_question`, `editor`) for small local model families, including custom local
      OpenAI-compatible providers whose provider id cannot be matched from SDK rules. Strong models
      stay off the trim rule and keep the full default toolset. The installed Cline core already resolves
      omitted `maxParallelToolCalls` to sequential execution; the public `ClineCoreStartInput` config still
      does not expose that field, so !Klein leaves sequential execution to the typed SDK default instead of
      smuggling an undeclared config property.

### L2.3 — Roster/roles wired to routing
- [x] ~~**Make `modelRoles` active, not read-only.** Roles resolve to whichever connected *local* model
      best fits the role's capability tier via the MCSR; auto-assignment by decomposition `complexity`
      writes `clineSettings`; all assignment goes through the router/guard.~~ Decomposition apply now validates
      each leaf through the Cline router/guard and writes the router-selected role's settings onto the created
      Planning card, including route-up cases where a suggested `worker` task needs a stronger configured role.
      If the router selects the default local model, stale suggested role overrides are intentionally not copied.
- [x] ~~**Plan2.md H2:** the router picks `feasible[0]` (smallest sufficient) and then mislabels a feasible
      user-pick as `route_up` to a *smaller* model with a false reason
      ([cline-task-router.ts:122-151](src/cline-sdk/cline-task-router.ts#L122),
      [runtime-api.ts:401-423](src/trpc/runtime-api.ts#L401)). Fix: if the preferred model is in the
      feasible set, **`assign` it**; only `route_up` when preferred is absent/infeasible; fix the reason
      string. (Local-only: candidate pool is local models only.)~~
- [x] ~~**Plan2.md H1 (re-verify, then cross off):** confirm a small *local* model can be `assign`ed at
      30k–80k — fit budget must come from the **candidate's** window, not the largest one
      ([cline-task-start-guard.ts:45-53](src/cline-sdk/cline-task-start-guard.ts#L45)). Add a 32k/80k
      assignment test.~~

### L2.4 — Swarm coordination & safety
*(Reality check: on a single local GPU, "parallel" is mostly time-sliced queueing — LM Studio/Ollama
serve one model at a time and switching reloads weights. Same-endpoint serialization is L2.2; the wins
below are correctness and safety of the autonomous DAG, not literal concurrency.)*
- [x] ~~**File-overlap-aware parallelism.** Never schedule two concurrent cards whose `filesLikelyTouched`
      overlap (the decomposer already emits this, L3) — serialize them to avoid worktree merge hell. Fall
      back to dependency order when the data is missing.~~ Decomposition-created cards now persist
      `filesLikelyTouched` structurally; UI single starts, manual start-all, dependency auto-starts, and CLI
      `task start` skip/block overlapping active work. The generic runtime start API remains session-oriented and
      does not receive board context.
- [x] ~~**Dependency-ordered auto-merge with conflict handling.** Merge completed task worktrees back to the
      base in DAG order; on a merge conflict, auto-create an **integration card** (conflicting paths in its
      prompt) rather than failing silently. Respect the AGENTS.md worktree rule: overlapping agent edits
      stay isolated and produce a warning, never a silent overwrite. **Progress:** `nklein task merge`
      now merges review/completed task worktree HEADs into a clean checked-out base worktree in dependency
      order, aborts conflicted Git merges, and creates a Planning integration card with conflicted paths.
      Still open: wire this into the normal completion/cleanup flow so successful reviewed tasks merge
      automatically before their worktrees are removed.~~ `nklein task done` now auto-merges reviewed task
      worktrees after moving them to Completed and before worktree cleanup or dependent auto-start. Blocked
      or conflicted merges preserve the task worktree; conflicts create the existing Planning integration
      card and prevent dependents from auto-starting from an unmerged base.
- [x] ~~**Shared decision blackboard.** Persist the plan's spec + a running `decisions.md` per plan
      (`.cline/kanban/plans/<slug>/`) and inject the relevant slice into each dependent card's
      self-contained prompt (L3) so swarm agents stay consistent on shared contracts (the API shape decided
      in card A reaches card B). Keep it compact via P3 compression so it doesn't eat the window.~~
      `decisions.md` is now a first-class plan artifact generated from answered/assumed clarifying
      questions, exposed through CLI/API/tool outputs, and compactly injected with the shared spec into
      decomposition-created card prompts.
- [x] **Swarm guardrails (backend).** A per-autonomous-run budget (max total turns / wall-time / cards), a
      **stall watchdog** that auto-parks a card with no diff or repeated identical tool calls after N turns
      (extends the existing "5 consecutive identical calls" stopper), and a swarm-level **stop signal** the
      UI Stop button triggers (L4). Bounded autonomy so an overnight run can't run away. **Progress:**
      workspaces now have an explicit `.cline/kanban/swarm-stop.json` stop signal; `nklein task swarm-stop`
      and `nklein task swarm-resume` toggle it, and runtime project task starts return typed
      `swarm_stopped` errors while it is active. Native Cline starts now also wire the typed consecutive
      mistake limit callback into !Klein self-observation telemetry and explicitly stop the task when the
      guardrail is reached. Cline task sessions now enforce a per-task autonomous turn budget, abort the
      session at the limit, park the card for review, and record `budget_wall` telemetry with checkpoint
      evidence. They now enforce a per-task autonomous wall-time budget through the same checkpoint path,
      aborting and parking over-budget tasks with `max_autonomous_wall_time` telemetry. The checkpoint path
      also watches for repeated no-diff checkpoints and parks sessions that keep producing the same commit
      without new diff progress. The board cockpit now exposes the stop signal as a Pause/Resume control.
      Start-all and dependent auto-start batches now share a 12-card swarm batch budget, enforced from the
      shared runtime contract and surfaced in settings. Cline task sessions now also park tasks after 5
      repeated non-attention tool starts with the same summarized input, recording `repeated_tool_calls`
      `budget_wall` telemetry and surfacing the guardrail in settings.

---

## Phase L3 — Autonomous task decomposition completion  *(the decomposition focus)*

**Outcome:** A project-scale prompt yields a reviewable spec + plan + a dependency-linked DAG of cards,
each guaranteed runnable by a connected *local* model, landing in the Planning lane and flowing into the
L2 executor — fully autonomously, recursively splitting anything too big.

### L3.1 — Already built
- [x] ~~`decompose_project` / `expand_task` tools~~ ([cline-decomposition-tool.ts:390-497](src/cline-sdk/cline-decomposition-tool.ts#L390)).
- [x] ~~Sizing contract validation~~ (`validateTaskSizingContract`: complexity ≤ 75, ≤ 3 likely files,
      acceptance command required) and graph/reference validation
      ([cline-decomposition-tool.ts:118-206](src/cline-sdk/cline-decomposition-tool.ts#L118)).
- [x] ~~Plan artifacts (spec.md / plan.md / tasks.json) with Zod schemas + atomic disk I/O~~
      ([cline-plan-artifacts.ts](src/cline-sdk/cline-plan-artifacts.ts)).
- [x] ~~Apply-to-board: creates cards + dependency links from the graph~~
      ([cline-decomposition-tool.ts:266-388](src/cline-sdk/cline-decomposition-tool.ts#L266)).
- [x] ~~`Planning` column exists in the board enum~~ ([api-contract.ts](src/core/api-contract.ts)).

### L3.2 — Open gaps
- [x] ~~Land cards in the Planning lane, not Backlog.~~ `applyClinePlanTaskGraphToBoard` now adds cards to
      `planning`, persisted runtime boards normalize the Planning column, dependency links treat Planning as a
      waiting lane, runnable Planning cards can flow into `in_progress`, and successful auto-apply moves the
      source decomposition card to Completed so repeated starts do not re-run the decomposer beside the DAG.
      Decomposition roots are requested for automatic start through the runtime queue, linked dependents stay
      gated until prerequisites complete, and generated cards prefer the workspace default acceptance command
      over brittle output-shape probes
      ([cline-decomposition-tool.ts](src/cline-sdk/cline-decomposition-tool.ts),
      [workspace-state.ts](src/state/workspace-state.ts),
      [task-board-mutations.ts](src/core/task-board-mutations.ts),
      [use-board-interactions.ts](web-ui/src/hooks/use-board-interactions.ts)). A 2026-06-19 complex dev-test
      live run also caught and fixed the CLI/runtime start eligibility gap for generated `startInPlanMode:
      false` Planning cards.
- [x] ~~Ship the decomposition prompt as an overridable rule, not a hardcoded string.~~ Runtime setup now
      seeds `kanban-decompose.md` as a user-editable workflow, resolves `/kanban-decompose` through
      `userInstructionService`, preserves user edits, and plan-mode task starts reference the workflow
      command instead of embedding the default prompt body
      ([cline-runtime-setup.ts](src/cline-sdk/cline-runtime-setup.ts),
      [cline-task-session-service.ts](src/cline-sdk/cline-task-session-service.ts),
      [cline-decomposition-workflow.ts](src/cline-sdk/cline-decomposition-workflow.ts)).
- [x] ~~Automatic recursive expand loop.~~ `decompose_project` now accepts a recursive `expansions` map,
      applies replacements before validation, rewrites dependencies from expanded parents to terminal leaves,
      enforces a bounded expansion depth, and keeps `expand_task` as a validation helper rather than the
      primary submission loop. Final leaves still pass the sizing and connected-local-model feasibility guards,
      making "small-model-executable" a measured property before artifacts are accepted
      ([cline-decomposition-tool.ts](src/cline-sdk/cline-decomposition-tool.ts),
      [cline-decomposition-workflow.ts](src/cline-sdk/cline-decomposition-workflow.ts)).
- [x] ~~Plan2.md M8: `decompose_project.execute` validates without `routingCandidates`.~~ The tool result now
      includes `modelFitValidated: false` and explicitly states that schema/sizing passed while connected
      local model fit is enforced later at apply/start time
      ([cline-decomposition-tool.ts](src/cline-sdk/cline-decomposition-tool.ts)).
- [x] ~~Plan2.md L7: decomposition task ids `slugify(slug)-slugify(task.id)` can collide.~~ Colliding
      plan-task slugs and repeated graph applies are disambiguated with suffixes, and dependency mapping is
      covered by regression tests
      ([cline-decomposition-tool.test.ts](test/runtime/cline-sdk/cline-decomposition-tool.test.ts)).

### L3.3 — Naive idea intake → clarification → workable plan
**Outcome:** A user (technical or not) types a loose, half-formed idea into the Planning lane, and !Klein
*interrogates* it — surfacing ambiguities, gaps, and contradictions as plain-language questions — **before**
committing to a spec/plan/DAG. The result reflects the user's actual intent, not the model's first guess.
- [x] ~~Clarification round in the planning workflow.~~ The overridable `kanban-decompose` workflow now
      instructs planning sessions to inspect ambiguous ideas, ask targeted option-based questions with a
      recommended default, and record answers or assumptions before writing artifacts
      ([cline-decomposition-workflow.ts](src/cline-sdk/cline-decomposition-workflow.ts)).
- [x] ~~Structured open-questions artifact.~~ `decompose_project.questions` records answered questions and
      assumed defaults, unresolved `open` questions are rejected before artifacts are written, and
      `.cline/kanban/plans/<slug>/questions.md` is emitted/exposed with plan artifacts
      ([cline-plan-artifacts.ts](src/cline-sdk/cline-plan-artifacts.ts),
      [cline-decomposition-tool.ts](src/cline-sdk/cline-decomposition-tool.ts)).
- [x] ~~Question UI for both audiences.~~ The Cline chat panel now detects option-style clarifying
      questions in the latest assistant turn, renders answer chips, and sends selected answers through the
      existing chat turn while keeping the free-text composer available
      ([cline-agent-chat-panel.tsx](web-ui/src/components/detail-panels/cline-agent-chat-panel.tsx)).
- [x] ~~Plain-language plan summary.~~ Alongside the technical spec/plan, `decompose_project` now accepts
      a plain-language `summary`, writes `.cline/kanban/plans/<slug>/summary.md`, exposes `summaryPath`,
      and the workflow asks for what will be built, the step/card count, and assumptions. The L4 DAG review
      can render this artifact directly
      ([cline-plan-artifacts.ts](src/cline-sdk/cline-plan-artifacts.ts),
      [cline-decomposition-tool.ts](src/cline-sdk/cline-decomposition-tool.ts)).

### L3.4 — Adaptive re-planning (handle oversights found during execution)
**Outcome:** Plans aren't frozen. When working a card reveals something the plan missed — a contradiction,
a missing dependency, a wrong assumption, a task bigger than estimated — !Klein adapts the plan instead of
plowing ahead or silently failing.
- [x] **Plan-gap signal from execution.** A running card that hits a blocking gap (missing decision,
      contradictory requirement, nonexistent dependency, scope beyond its fit budget) raises a structured
      **plan-gap** event rather than guessing. Wire it through the self-observation sink + the
      acceptance/escalation path. **Progress:** `nklein task plan-gap` now records typed `plan_gap`
      self-observation events for missing decisions, contradictions, missing dependencies, oversized scope,
      and integration gaps, and the agent system prompt tells execution agents to use it instead of
      silently broadening a task. Acceptance verification now also records plan gaps for missing acceptance
      contracts and exhausted repair/escalation attempts, with conservative output classification for obvious
      missing dependency/file, contradictory requirement, and oversized-scope signatures. Acceptance failure
      classification now uses named domain pattern groups for unresolved decisions, contradictions, missing
      packages/files/commands/config/schema, and scope/resource exhaustion.
- [x] ~~**Auto-adapt within bounds.** On a plan-gap: sizing/scope miss → `expand_task` recursive split (L3.2)
      and re-link the DAG; missing integration step → insert an integration card (L2.4); genuine
      ambiguity/contradiction → pause and **ask the user** (L3.3), then patch the plan. Bounded by the swarm
      guardrails (L2.4) so adaptation can't loop.~~ `nklein task plan-gap --kind
      integration_needed` now inserts a Planning integration card with plan mode, auto-review, evidence, and
      the current branch/default branch as its base ref. Scope-too-large gaps now mark the source card as
      needing decomposition and create a deduplicated Planning split card; missing-decision and contradiction
      gaps create deduplicated Planning decision-pause cards that ask for the smallest user decision before
      work continues. Approved replacement graphs can now be applied with `nklein task expand-plan-task`,
      which replaces the oversized saved-plan task, inherits upstream dependencies into replacement entry
      tasks, re-links downstream dependents to terminal replacement tasks, and rewrites `tasks.json`.
- [x] ~~**Plan revision history.** Record every plan change (what was added/split/re-linked and the gap that
      motivated it) in the plan artifacts, so the evolving plan stays auditable and the DAG view (L4) can
      flag "revised" cards.~~ New decomposition plans now include a first-class
      `revisions.md` artifact, exposed through tool/CLI/API outputs with legacy-read fallback, and
      `nklein task plan-gap --plan-slug <slug>` appends concrete gap entries to that audit trail. Automatic
      integration-card adaptation returns the created Planning card alongside the gap response and appends a
      concrete `integration_card_added` revision entry when a plan slug is available. `nklein task plan-gap`
      now also infers the owning decomposition plan from decomposition-created task IDs, including
      collision-suffixed card IDs when unambiguous, so automatic integration-card adaptation can append to
      `revisions.md` without a manual `--plan-slug`. Recursive `decompose_project.expansions` now write an
      initial `recursive_split` revision listing each expanded task and pointing to the rewritten dependency
      graph in `tasks.json`. Decision/contradiction and scope-too-large adaptation cards now append concrete
      `decision_card_added` or `scope_split_card_added` revision entries when the owning plan is known.
      Direct saved DAG replacement/re-linking now appends `recursive_task_replaced` entries that record the
      replacement description and entry/terminal dependency bridge evidence.

---

## Phase L4 — Operator UI & observability (local swarm cockpit)

**Outcome:** The board becomes a live cockpit for a local swarm — you can see every agent, the
model/endpoint state, and the decomposed plan, and stop or diagnose anything at a glance, with no cloud
model anywhere in the surface.

**Design principle — progressive disclosure for two audiences.** Every !Klein capability must be both
*usable by a non-technical person* (a simple status/summary, sane defaults, plain language) **and**
*fully inspectable by a technical person* (the underlying numbers, decisions, and logs, one expand away).
Default to a clean summary; reveal depth on demand (expanders, tooltips, an "advanced/details" toggle).
The hard rule: **no capability we built since branching from `main` is invisible** — if it runs, the user
can see *that* it ran, *what* it decided, and *why*, both during work and afterward in settings.

- [x] ~~**Board as swarm cockpit.** Each running card shows a live mini-status: role/model, a compact form
      of the L1.6 token bar, tok/s + elapsed (from MCSR / session timing), current tool, and turn count.
      Reuse the data already flowing through the session summary — no new poll loop.~~ Running cards now
      enrich the existing session activity area with compact token counts, approximate output tok/s, elapsed
      runtime, current tool/activity, turn checkpoint, and a tiny context-budget bar from the backend
      breakdown; the existing card model badge continues to show role/model selection.
- [x] ~~**Global swarm header + Stop.** A header strip: running / queued / blocked counts, per-local-endpoint
      utilization, a concurrency-cap slider (wired to `maxConcurrentTasks`, L2.2), and a prominent
      **Pause/Stop swarm** control that fires the L2.4 stop signal.~~ The board now renders a
      compact Local swarm strip with running/waiting/blocked counts plus a Pause/Resume button backed by
      typed runtime `getSwarmStop` / `requestSwarmStop` / `clearSwarmStop` endpoints. The strip also has an
      inline concurrency-cap slider wired to `maxConcurrentTasks` through the existing runtime config save
      path, and running Cline session summaries expose local shared-endpoint ids so the header can group active
      work by endpoint.
- [x] ~~**Model & endpoint panel (surface the MCSR).** A panel showing each configured local model:
      effective context window, measured prefill/decode tok/s, capability score, and which model is loaded.
      Show it **before** `samples>0` too (today `formatClineModelRegistryDisplay`
      ([cline-agent-chat-panel.tsx:183-202](web-ui/src/components/detail-panels/cline-agent-chat-panel.tsx#L183))
      hides it) and prompt **"set context window"** when it's `null` (the current state). Cloud providers
      never appear here (L0).~~ The Cline chat panel now has an expandable Model Telemetry panel
      backed by the typed MCSR snapshot. It lists local-only registry entries, pins the selected model first,
      shows effective/override/observed/advertised windows, endpoint/shared-endpoint id, prefill/decode tok/s,
      latency, sample count, last observation, and capability, and still renders unmeasured zero-sample entries with a "Set context window"
      prompt. The runtime registry endpoint filters out cloud/remote providers with the same local-only policy
      used for dispatch, and now synthesizes read-only zero-sample rows for configured local provider/model
      selections and model-role roster entries before telemetry exists. The same telemetry surface is now promoted
      into Cline settings with local-only per-model context-window Save/Clear controls.
- [x] ~~**Decomposition DAG review view (Planning lane).** Render the proposed task graph as a dependency
      graph with complexity, assigned role/model, and a per-leaf **fit badge** (green = a connected local
      model can run it; red = must split) from the L3 routing-feasibility check. Editable/approvable in the
      Planning lane before cards flow to execution. Keep it lightweight (existing board primitives or a
      small graph lib).~~ Planning card detail now includes a compact DAG review panel for linked
      cards, showing prerequisite/dependent relationships, card status, prompt-derived complexity, likely
      files, and model/agent hints from existing board data. Decomposition-created cards now also carry a
      backend `Model fit:` marker from the routing guard when connected candidates were checked, and the DAG
      panel renders a distinct backend fit badge from that marker. The panel now walks the full connected
      dependency component for the selected card instead of stopping at immediate prerequisites/dependents.
      Adaptation-created integration/decision/contradiction/split cards and decomposition-blocked source cards
      now render a revised-plan flag in the DAG. Planning cards that are still gated by plan mode now show an
      explicit Approve for execution action in the DAG panel, flipping only the execution gate while preserving
      revision/block metadata and existing edit paths.
- [x] ~~**Per-card diagnostics drawer (no LLM).** A drawer surfacing that card's structured self-observation
      telemetry — errors, overflows, retries, timings, eval result — read directly from the sink
      (`~/.cline/kanban/telemetry/`). The cheap, cloud-free companion to the parked P8 "why did this fail"
      advisor.~~ The telemetry sink now has a bounded JSONL reader, runtime exposes typed
      `getTaskDiagnostics`, and the card detail view includes a collapsible Diagnostics panel that loads
      recent local events for the selected task without invoking an LLM.
- [x] ~~**First-run local-model setup wizard.** On first launch (or when no local model is configured),
      detect running Ollama / LM Studio endpoints, list loaded models, let the user set context windows and
      assign roles (architect/worker/reviewer → `modelRoles`). Directly fixes today's cloud-defaulted,
      null-window, `openrouter`-selected starting state.~~ Startup onboarding now reopens after
      first-run dismissal when Cline is selected without a configured local model; the Cline agent card shows
      detected local Ollama / LM Studio endpoints and loaded models from the existing provider/model APIs; and
      finishing Cline setup seeds empty architect/worker/reviewer roles from the selected local provider/model
      without overwriting configured role choices or accepting non-local providers. Cline settings now provides
      explicit per-model context-window Save/Clear controls backed by the MCSR override API. First-run
      onboarding now includes a context-window override input on the Cline setup card and seeds empty model
      roles with the selected local model plus selected reasoning effort. The same onboarding card now includes
      a guided Ollama/LM Studio endpoint start panel with official download links plus install, start, model-load,
      and verification commands for getting a local OpenAI-compatible endpoint online.
- [x] ~~**Code intelligence status & progress** *(explicitly requested).* Surface repo-map build state and
      **code-index embedding progress** — chunks indexed / total, % done, last indexed, staleness, search
      availability — as a small board/settings status chip with an expandable detail panel. Covers
      `cline-repo-map.ts` / `cline-code-index.ts` / `cline-code-search.ts`, which have **no UI today**.
      ~~ Settings now has a refreshable Code intelligence panel backed by a typed runtime API.
      It reports repo-map availability/files/symbols/truncation and code-index cache coverage
      (indexed chunks/total chunks, indexed files/total files, stale/missing files, last indexed,
      embedding provider/model, cache path, and search availability). The board Local swarm strip now also
      shows a compact code-intelligence chip (`ready`, `issue`, repo-map ready, or code-index coverage).
      Active `searchClineCodeIndex` runs now publish in-memory scan/embed/persist progress with file/chunk
      counters and cache hit/miss counts; the settings panel shows that progress and polls until the run
      completes, errors, or returns idle.
- [x] **"What !Klein is doing right now" activity surface.** During active work, show the live per-card
      pipeline: planning → routing decision (which model/role and *why*) → context budget (L1.6 bar) →
      retrieval/indexing → tool calls → acceptance gate result → merge. Each step expandable to its raw
      detail for technical users; collapsed to a plain status for everyone else. **Progress:** card detail now
      includes a compact Activity surface above diagnostics, populated from the selected card and live session
      summary: planning/execution state, provider/model routing, context-budget usage, current tool activity,
      and acceptance/review state. It now separates retrieval/indexing from generic tool calls and labels
      routing detail as card-selected or runtime-selected, including the selected local endpoint when available.
      Acceptance and merge are now first-class Activity steps backed by local diagnostics: acceptance failures
      and plan-gap history surface in the pipeline, task worktree merge/skipped/conflict events are recorded as
      task-scoped telemetry, and the raw expandable Diagnostics panel remains one click away for full history.
- [x] **Settings coverage for every capability.** Reorganize settings so each new pillar is configurable
      and explained in plain language with an "advanced" reveal for raw values: model roles & roster,
      per-model context-window override, routing/guard thresholds, concurrency cap,
      context-budget/compression policy, repo-map/index toggles, acceptance-gate commands, autonomy/guardrail
      limits, telemetry retention/redaction. **Progress:** settings already cover agent selection, timeouts,
      max writable file lines, max concurrent tasks, task defaults, Cline provider setup, model roles, MCP,
      code-intelligence status, per-model context-window overrides, smoke eval, dogfood suggestions, git prompts,
      notifications, appearance, and project paths. The General section now also surfaces Local swarm guardrails,
      including the configurable concurrency cap and enforced Cline turn, wall-time, no-diff, and mistake
      guardrails. General settings now also include Advanced policy visibility rows for routing policy,
      context-budget policy, acceptance-gate command source, and local telemetry/diagnostic retention, with
      raw keys/paths shown for technical inspection.
- [x] ~~**Feature-visibility coverage matrix (acceptance gate for this section).** Maintain an explicit map of
      every since-branch capability → its UI surface(s): MCSR/model stats → model panel; context budget →
      L1.6 bar; routing/guard decisions → activity surface + card detail; decomposition + DAG + clarifying
      questions → L3/L4 DAG view; repo-map/code-index → status chip above; acceptance gate + repair/escalation
      → card status + diagnostics drawer; telemetry → diagnostics drawer + settings; worktree/merge/integration
      → board + L2.4; dogfood/self-improvement backlog → its own view; team/subagent progress → card status.
      **Anything unmapped is a gap to close.** (Advisor/model-freshness stay hidden while parked, L0.)~~

      | Capability | Primary Surface | Remaining Visibility Gap |
      | --- | --- | --- |
      | Local-only routing / cloud blocks | model picker, blocked card reason, start errors, card Activity surface | routing rationale detail |
      | MCSR model stats | Cline chat Model Telemetry panel | consider global/settings promotion |
      | Effective context budget | Cline chat segmented bar, running-card mini bar | none known |
      | Decomposition plans | Planning lane cards, plan artifact paths | DAG review graph |
      | Swarm guardrails | board Local swarm strip, task Diagnostics panel | per-run budget settings/progress |
      | Code intelligence | settings Code intelligence panel, board code-intelligence chip | live indexing/build progress |
      | Acceptance gates / plan gaps | task Diagnostics panel, plan `revisions.md` | richer failure classification |
      | Worktree auto-merge | task done / merge CLI output, integration cards on conflict | board-level merge status history |
      | Queued endpoint admission | `endpoint_busy` start response, queued auto-start retry, board endpoint utilization, board swarm cap slider | explicit queue list in UI |

---

## Carried-forward pillars (re-scoped to local-only; status reconciled with plan2.md)

### MCSR — Model Capability & Speed Registry
- [x] ~~Registry with EWMA store, capability blend, persistence, timing tap~~
      ([cline-model-registry.ts](src/cline-sdk/cline-model-registry.ts)).
- [x] ~~≥30k context policy~~ — **done at 32k** (`CLINE_MIN_CONTEXT_WINDOW_TOKENS = 32_000`,
      `assertClineContextWindowPolicy`, [cline-context-window-policy.ts:1](src/cline-sdk/cline-context-window-policy.ts#L1)).
      *The entire 8–16k premise of the old plan is obsolete — removed.*
- [x] ~~**Verify 30k enforcement at every entry** (provider save, task start, router candidates, role
      resolution) and confirm the unknown-window fallback (8k/12k reserves,
      [cline-context-budgets.ts:66-74](src/cline-sdk/cline-context-budgets.ts#L66)) can't admit a
      sub-30k model.~~
      `assertClineContextWindowPolicy` is enforced at provider save, launch resolution, role candidate
      construction, runtime start, and start-guard fallback creation; tests cover null/16k rejection and 32k acceptance.
- [x] ~~**Resolve & measure the local model (currently null).** `model-registry.json` shows the in-use
      lmstudio qwen with `contextWindow.{advertised,observed,userOverride,effective} = null` and
      `speed.samples = 0` — so the MCSR provides no window or speed and budgets/UI fall back to heuristics.
      Resolve the effective window for local providers (advertise from the LM Studio/Ollama API, observe
      from real requests, or honor a user override — the `…ctx80k` model is 80k) and wire the timing tap so
      speed EWMA actually accrues. This is the data the L1.1 guard and the L1.6 bar depend on.~~
      Local task starts now record explicit local launch context windows into the MCSR immediately, typed SDK
      usage events record speed observations using !Klein-measured request duration, and registry context-window
      metadata supports advertised/observed/user-override precedence with persistence coverage.
- [x] ~~**Plan2.md M1:** capability prior never decays — `calculateEffectiveCapability` is a permanent
      equal-weight average ([cline-model-registry.ts:236-247](src/cline-sdk/cline-model-registry.ts#L236)).
      Weight the cold-start prior by `1/(1+samples)` so observed data dominates over time.~~
      `calculateEffectiveCapability` weights the static prior by `1 / (1 + samples)` and now decays aging
      observed eval/pass-rate evidence back toward that prior on a 30-day half-life. Registry tests cover both
      the conservative fresh blend and the age-based decay returned by snapshots.
- [x] ~~**Plan2.md L3:** debounce/batch registry persistence (currently a locked disk write per request,
      [:412-468](src/cline-sdk/cline-model-registry.ts#L412)); store EWMA fields as floats (currently
      truncated to int on reload).~~
      Registry observations now update the in-memory MCSR immediately, coalesce locked disk writes behind a
      debounce, and expose `flush()` for callers/tests that require durable persistence. Regression coverage
      also proves fractional EWMA speed fields survive loading persisted registry files.
- [x] ~~**Plan2.md L7:** registry event extraction guesses SDK event shapes via `asRecord`/string keys
      ([:579-630](src/cline-sdk/cline-model-registry.ts#L579)) — prefer SDK-provided event types.~~
      Model-registry observation extraction now accepts typed `ClineSdkSessionEvent` values, narrows to the
      SDK `usage` agent-event union, and relies on !Klein's measured request wall time instead of speculative
      `run-finished` payload fields.

### Codebase intelligence (repo map + search)
- [x] ~~**Plan2.md M4:** repo map uses line-anchored regex + raw reference counts, is `O(symbols×files)`,
      and is memoized once per session so it goes **stale after edits**
      ([cline-repo-map.ts:106-216](src/cline-sdk/cline-repo-map.ts#L106),
      [cline-session-runtime.ts:111-137](src/cline-sdk/cline-session-runtime.ts#L111)). Either deliver
      the planned tree-sitter + PageRank version, or **explicitly document the heuristic** and at minimum:
      bound the cost (cap symbols before counting) and add an invalidation hook so edits refresh the map.~~
      The repo map is documented as a bounded local lexical heuristic, caps reference-ranked symbols before
      counting, and the Cline runtime now invalidates the cached map after successful workspace-mutating tools
      (`write_file`, `apply_patch`, shell commands, etc.) while keeping read-only tool calls cached; runtime tests
      prove stale symbols refresh after writes.
- [x] ~~**Plan2.md M2:** "local embeddings" are bag-of-words token counts, not embeddings
      ([cline-code-embeddings.ts:18-77](src/cline-sdk/cline-code-embeddings.ts#L18)). Either integrate a
      real local ONNX embedding model (fastembed/BGE-small or transformers.js/MiniLM — must be offline,
      no API key, consistent with local-only) **or** rename `local_hash` → `local_lexical` and stop
      overselling it. (Note: an external embedding endpoint is **cloud** and now banned — so real
      semantic search *must* be local-ONNX or it doesn't exist.)~~
      The local provider is now explicitly `local_lexical` with a lexical-vector model/cache key.
- [x] ~~**Plan2.md M3:** search is lexical-first with semantic only as a zero-result fallback
      ([cline-code-search.ts:202-230](src/cline-sdk/cline-code-search.ts#L202)). Merge/normalize lexical
      + vector into one ranked hybrid list (true hybrid), or document the lexical-first reality.~~
      `searchClineCodeIndex` now scores every chunk with vector similarity plus lexical score in one ranked list.
- [x] ~~**Plan2.md L2:** code-index vector cache grows monotonically; stale chunks never pruned; mtime
      metadata written but never read for invalidation
      ([cline-code-index.ts:266-306](src/cline-sdk/cline-code-index.ts#L266)).~~
      Cache persistence now writes only embeddings referenced by the current file/chunk set, with regression
      coverage for deleted chunks.

### Context engineering & compression
- [x] ~~Budget floors no longer zero-out small windows (plan2.md H1)~~ — now ratio-based (0.1 / 0.15,
      floors 512/1024), [cline-context-budgets.ts:61-98](src/cline-sdk/cline-context-budgets.ts#L61).
- [x] ~~**Proactive guard correctness** — covered in **L1.1** (effective window + absolute ceiling).~~
- [x] ~~**Plan2.md L1:** dead/inverted branch in `compressKanbanContextText` — when
      `allowModelAssisted` is true it returns a naive char-slice labeled `model_assisted_disabled`,
      skipping the better caveman/minify path ([cline-context-compression.ts:188-215](src/cline-sdk/cline-context-compression.ts#L188)).
      Delete the branch or fall back to caveman/minify.~~
      The deterministic path now always uses caveman/minify compression, and provider-assisted compression is
      isolated in `compressKanbanContextTextWithProvider`.
- [x] ~~**Plan2.md L6 / success-criterion #6:** hoist hardcoded policy constants
      (`24_000`/`16_000`/`750`/`2_500`, curve factors,
      [cline-context-budgets.ts:79-108](src/cline-sdk/cline-context-budgets.ts#L79)) into named,
      documented policy parameters — or relax the "no hardcoded constants" success criterion to "no
      hardcoded *window/speed* constants in routing/budget *decisions*.~~
      Context-budget reserves, pressure references/ranges, fallback reserves, file chunk minimums, and char
      budget conversion are now named policy constants with comments for the pressure curve.

### Autonomy & reliability gates
- [x] ~~Acceptance repair/escalation ladder is well-structured~~ ([cline-acceptance-repair.ts](src/cline-sdk/cline-acceptance-repair.ts)).
- [x] ~~**Plan2.md M5:** the `afterModel` self-review can't detect "claimed success without a diff" — it's
      a text-only heuristic and can false-positive on negations
      ([cline-self-review-hook.ts:31-48](src/cline-sdk/cline-self-review-hook.ts#L31)). Feed an actual
      "files changed since session start" signal (the acceptance path already resolves the worktree) and
      block completion when a completion claim coincides with an empty diff.~~
      `cline-session-runtime` now reads workspace changes and passes `hasChangedFiles` into the self-review
      hook; hook tests cover completion claims with no changed files.
- [x] ~~Acceptance-gate shell fix — covered in **L1.5**.~~

### Self-improvement loop (Dogfood Engine) + telemetry
- [x] ~~Self-observation sink is clean and async~~ ([self-observation-sink.ts](src/telemetry/self-observation-sink.ts)).
- [x] ~~**Plan2.md M6:** the dogfood backlog emits task graphs its own validator rejects — sets
      `complexity: 80` and copies many `filesLikelyTouched` from telemetry, but
      `validateTaskSizingContract` rejects `complexity > 75` and `> 3` files
      ([cline-dogfood-engine.ts:330-347](src/cline-sdk/cline-dogfood-engine.ts#L330)). Clamp/split and
      carry "requires human approval" as metadata, not an out-of-range complexity.~~
      Dogfood task graphs now cap complexity to the decomposition limit and cap likely files to 3, with
      regression coverage.
- [x] ~~**Plan2.md M7:** trusted auto-merge passes on an *unknown* (`null`) regression delta and lists
      protected paths (`src/permissions/`, `src/sandbox/`) that **don't exist** while omitting real
      guardrail code ([cline-trusted-auto-merge.ts:1-84](src/cline-sdk/cline-trusted-auto-merge.ts#L1)).
      Treat `null` delta as **block**; reconcile the protected list with files that actually exist
      ([agent-write-guard.ts](src/core/agent-write-guard.ts), etc.).~~
      `evaluateTrustedAutoMerge` blocks `null` regression deltas and protects the real guardrail/runtime paths.
- [x] ~~**Plan2.md L5:** sink stores `workspacePath` and file paths verbatim; secret regex misses AWS
      keys / generic JWTs; no retention/rotation
      ([self-observation-sink.ts:52-107](src/telemetry/self-observation-sink.ts#L52)). Add path
      redaction/relativization, broaden secret patterns, cap/rotate retention.~~
      The sink now redacts absolute paths in top-level fields and nested metadata, covers AWS/GitHub/JWT-style
      secrets, and prunes daily JSONL logs by retention.
- [x] ~~**Plan2.md L7:** team-progress frames a `task_end` error as completion
      ([cline-team-progress.ts:57-58](src/cline-sdk/cline-team-progress.ts#L57)) — distinct failure summary.~~
      `task_end` summaries now treat object-shaped and string-shaped errors as failures.

### Advisor surface & model freshness — **PARKED (cloud-dependent)**
- [x] ~~P6 model-freshness / P8 advisor buttons (MCP discovery, config explainer, log analysis)~~ —
      **deferred** until cloud is re-enabled *or* a capable local model is proven to drive them. These
      lean on web research + a strong model; they are explicitly out of near-term scope. The clean,
      already-built `cline-advisor.ts` helper stays as-is, unused, until then.

### Dev Test Project & evidence bundle
- [x] ~~Evidence bundle + self-observation sink are clean and async~~; dev fixtures exist
      ([scripts/dev-fixtures/](scripts/dev-fixtures/)).
- [x] ~~Ensure the one-click dev smoke run uses the **local roster only** and that its evidence bundle
      surfaces the new pre-send-guard / overflow / timeout signals so this stays the fast iteration loop.~~
      `nklein dev smoke-eval` now rejects cloud provider scoring, passes an explicit local model roster into
      the evidence bundle, and copies relevant local self-observation guard/overflow/timeout telemetry into
      the bundle with summary counts.

---

## plan2.md findings → status at a glance

| Finding | Status | Where |
|---|---|---|
| H1 budget floors zero-out small windows | ✅ resolved (ratio-based) + obsolete (target now 30k) | L2.3 verify, MCSR |
| H2 router downgrades feasible user pick, wrong reason | ⬜ open | L2.3 |
| H3 cloud over-serialization | ◧ re-scoped (cloud moot; fix local keys) | L2.2 |
| M1 capability prior never decays | ✅ resolved (observed evidence decays toward prior on 30-day half-life) | MCSR |
| M2 "local embeddings" are bag-of-words | ⬜ open / re-scope | Codebase intel |
| M3 lexical-first, semantic only as fallback | ⬜ open / re-scope | Codebase intel |
| M4 repo map regex (not tree-sitter+PageRank), stale, O(n²) | ⬜ open | Codebase intel |
| M5 self-review can't detect no-diff | ⬜ open | Autonomy gates |
| M6 dogfood graphs violate own validator | ⬜ open | Dogfood |
| M7 auto-merge passes null delta; bad protected list | ⬜ open | Dogfood |
| M8 decompose tool reports valid without fit guard | ⬜ open | L3.2 |
| L1 dead inverted compression branch | ⬜ open | Context eng |
| L2 code-index cache grows unbounded | ✅ resolved (persisted cache keeps only current chunk hashes; GC regression test covers deleted chunks) | Codebase intel |
| L3 registry write amplification + EWMA int-truncation | ⬜ open | MCSR |
| L4 acceptance gate spawns login shell | ⬜ open | L1.5 |
| L5 telemetry no path redaction/retention | ⬜ open | Dogfood |
| L6 hardcoded policy constants vs success #6 | ⬜ open | Context eng |
| L7 team-progress / id collision / SDK event shapes | ⬜ open | various |
| 32k context policy | ✅ resolved | MCSR |
| Cloud hard-disable | ✅ resolved (policy module, dispatch/runtime gates, defaults, UI filter, router/role filtering, cloud-pinned resume, boundary scan) | L0 |
| 1.1M overflow / authoritative guard | ⬜ open (NEW, top priority) | L1.1 |
| 1s timeouts (code bug; config is "unlimited") / broken session restart / retry storms | ⬜ open (NEW, top priority) | L1.2–L1.4 |
| Cloud persisted everywhere (provider=openrouter, agent=cline, dev seed=cline) | ⬜ open (NEW) | L0 |
| Local model unresolved in MCSR (effective window null, 0 speed samples) | ⬜ open (NEW) | L1.6 / MCSR |
| Context budget visualization bar (segmented, green→red) | ⬜ open (NEW UI) | L1.6 |
| Swarm coordination: file-overlap parallelism + ordered merge | ⬜ open (NEW) | L2.4 |
| Shared decision blackboard for dependent cards | ✅ resolved | L2.4 |
| Swarm guardrails: run budget + stall watchdog + stop | ⬜ open (NEW) | L2.4 / L4 |
| Operator UI: cockpit, swarm header+Stop, model panel, DAG review | ◧ in progress (task-detail MCSR panel landed; cockpit/header/DAG/global surface open) | L4 |
| Per-card diagnostics drawer + first-run setup wizard | ⬜ open (NEW UI) | L4 |
| Naive idea intake → clarifying questions → workable plan | ⬜ open (NEW) | L3.3 |
| Adaptive re-planning on execution-discovered gaps | ⬜ open (NEW) | L3.4 |
| Code-index / repo-map status & progress in UI | ◧ in progress (settings status panel landed; board chip/live progress open) | L4 |
| Progressive-disclosure visibility for all since-branch features (+ coverage matrix) | ⬜ open (NEW UI) | L4 |
| CHANGELOG `## [Upcoming]` populated (124 commits) + maintained going forward | ⬜ open (NEW) | Changelog |

---

## Success criteria (updated for local-only)

1. **Cloud is unreachable.** No request can leave for a paid API; cloud providers don't render, can't be
   selected, and a cloud-pinned card hard-stops with a clear message. Re-enabling is a single reviewed
   code change.
2. **No oversized prompt, ever.** On the eval suite, zero requests exceed the effective local window;
   over-budget turns are compacted or the task stops — never sent.
3. **The loop is stable.** No 1-second timeouts, no "no previous session config" restart failures, no
   retry storms; errors back off and park.
4. **≥30k enforced** at every entry (verified), with budgets and compression that scale to the local
   window with no hardcoded window/speed constants in routing/budget decisions.
5. **Parallel local swarm works.** A multi-card DAG auto-starts unblocked cards up to the concurrency cap,
   serializes per local endpoint, runs distinct endpoints in parallel, and never thrashes the machine.
   The 2026-06-19 complex dev-test run verified DAG creation and manual root-card start from Planning; automatic
   root-card start after decomposition still needs a dedicated end-to-end verification/fix.
6. **Decomposition is autonomous & local-feasible.** A project prompt yields a Planning-lane DAG where
   every leaf is guaranteed runnable by a connected local model (recursive expand), validated for fit at
   tool time, never started blind.
7. **Context is visible.** The card panel shows a segmented, green→red bar of the full prompt (system /
   tools / task / files / history / reserved working / output) against the model's **real** effective
   window — replacing the old text health line and the 200k/120k smart-budget heuristic.
8. **Swarm is safe & coordinated.** Parallel cards never collide on shared files; worktrees merge in
   dependency order (conflicts spawn an integration card); an autonomous run respects its budget, can be
   stopped in one click, and stalled/looping tasks auto-park.
9. **Operator visibility.** The board shows live per-agent status and MCSR model stats, a reviewable
   decomposition DAG with fit badges, a per-card diagnostics drawer, and a first-run local-model wizard —
   all cloud-free.
10. **Naive idea → workable plan.** A loose idea typed into the Planning lane triggers clarifying questions
    (or recorded assumptions), yields a reviewable plan with a plain-language summary, and **adapts** when
    execution reveals gaps (split / integrate / re-ask) instead of failing blind.
11. **Nothing is invisible.** Every capability built since branching from `main` is discoverable in the UI —
    a simple summary for non-technical users, full technical detail one expand away — both during active
    work and in settings (including code-index/repo-map status & progress). The coverage matrix has no
    unmapped entries.
12. **Upstream-clean.** We can re-pull Cline-Kanban without reverting our work (no `node_modules/@clinebot/*` diffs).

---

## Verification

- **Unit/integration:** new L0 tests (cloud-block), L1.1 effective-window/ceiling tests at 32k & 80k,
  L1.2 compact→restart regression, L2 assignment tests (small local model gets `assign`; preferred
  feasible model isn't downgraded), L3 recursive-expand + Planning-lane tests. Run the existing
  `test/runtime/cline-sdk/*` suites.
- **End-to-end (local only):** with the in-use local model (e.g. `qwen3.5-9b-…-ctx80k` via LM Studio),
  run the Dev Test Project smoke run; confirm the run completes, the evidence bundle shows **no**
  `context_overflow`, **no** cloud `provider_error`, and **no** 1s-timeout signals.
- **UI:** open a running card and confirm the context bar renders the segmented breakdown against the
  real ~80k window (not 120k/200k), with the color ramp tracking usage and an overflow marker past 100%.
- **Config sanity:** after the lockdown, `~/.cline/kanban/config.json` / `cline-provider-selection.json`
  never re-introduce a cloud `selectedAgentId`/provider on load; `model-registry.json` gains a non-null
  `contextWindow.effective` and accruing `speed` samples for the local model.
- **Telemetry diff:** re-run a day of dogfood; the `~/.cline/kanban/telemetry/*.jsonl` should show zero
  `"Insufficient balance"`, zero `>1M-token` overflows, and zero `"timeout after 1 seconds"`.
- **CI guardrail:** `git diff --exit-code node_modules/@clinebot` stays clean; lint bans deep SDK imports
  outside `src/cline-sdk/`.

---

## Project portability — active baseline

**Outcome:** Durable project state moves into the project directory so a !Klein board can be recovered from
the repository checkout instead of depending only on one machine's `~/.cline/nklein` runtime cache.

- [x] **Mirror core workspace state into the project.** Board state, session summaries, revision metadata,
      and workspace identity are written to `<project>/.cline/nklein/workspace/` on normal state saves and
      atomic board mutations, while `~/.cline/nklein/workspaces/<id>/` remains the fast runtime cache/index.
- [x] **Recover from workspace-local state.** `loadWorkspaceState` falls back to the project-local mirror
      when the runtime-home `board.json`, `sessions.json`, or `meta.json` files are missing, with integration
      coverage that deletes the runtime cache and reloads from the project directory.
- [ ] **Define the full portable schema.** Decide which state is durable and portable versus machine-local:
      portable includes board/cards/DAG/provenance/spec/plan/decisions/revisions; machine-local includes
      running SDK sessions, model speed telemetry, endpoint URLs, sandbox containers, result branches, and
      raw telemetry.
- [ ] **Conflict and sync semantics.** Add explicit import/reconcile UX for two machines advancing the same
      board, instead of assuming last-writer-wins.
- [ ] **Sandbox visibility.** Make newly written trusted control-plane artifacts visible to newly started
      sandbox tasks through the workspace-local state while keeping active sandbox sessions from depending on
      host-only paths.

---

## Follow-up-6 implementation pass — dev-test reliability, deep-domain decomposition, portability

> Source: `follow-up-6.md` (the June 2026 habit + audio-VST autonomous dev-test runs), specsheet §14.2
> (portable project state) and §7's open knowledge-expansion loop, plus the deep-complex-domain capability
> goal (stop massively underestimating hard domains). Sequenced so each item is independently landable.

### F6.1 — Decomposition quality: graph coherence, scope pressure, knowledge debt  *(deep-domain)*
- [x] **Dependency-coherence validation after `decompose_project`.** New
      [cline-decomposition-graph-quality.ts](src/cline-sdk/cline-decomposition-graph-quality.ts) classifies
      cards (test / docs / UI / domain-core) and rejects graphs where a test/acceptance card does not depend on
      the implementation it verifies or a docs card does not depend on the work it documents; sparsity,
      isolated cards, likely-reversed test edges, and UI-without-domain are surfaced as warnings in the tool
      result + self-observation telemetry (the creation gate opts in via `enforceGraphQuality`; applying a
      persisted/partial graph does not retroactively throw). Unit-tested. *(follow-up-6 §3.3)*
- [x] **`knowledgeDebt` field on generated cards + knowledge-acquisition / scope-pressure workflow.** Added a
      `knowledgeDebt` field to the plan-task schema and card prompt, and a mandatory knowledge-acquisition +
      "is this under-decomposed by 10x/100x?" scope-pressure pass to the `kanban-decompose` workflow for
      domain-heavy work. *(follow-up-6 §3.1, §3.2; specsheet §7 knowledge-expansion loop)*
- [ ] **Knowledge-tool usage as a decomposition quality signal.** Correlate whether retrieval / code-index /
      architecture-knowledge tools were actually used in a planning session before `decompose_project`, and
      surface "decomposition used / did not use knowledge tools" in the stats view, not just a usage count.
      *(follow-up-6 §3.2 — deferred; needs session-runtime correlation + Settings UI.)*
- [ ] **Audio dev-test rubric.** Score the audio-VST fixture as under-decomposed/shallow against a domain
      rubric (DSP correctness, measured phase alignment, groove invariants, effect guardrail sweeps, full UI
      control coverage, prototype-vs-real-VST docs). *(follow-up-6 §3.8)*

### F6.2 — Sandbox patch capture & timeout diagnostics
- [x] **Classified patch-capture failures.** New
      [task-patch-capture-diagnostics.ts](src/workspace/task-patch-capture-diagnostics.ts) distinguishes a
      corrupt/garbled diff from a non-applying patch, extracts the first failing file/hunk, preserves the
      failing patch under runtime-home `patch-failures/`, and attaches all of it (typed `TaskPatchCaptureError`)
      to the review card + telemetry. Unit-tested. *(follow-up-6 §3.5)*
- [x] **Structured stream/tool inactivity-timeout note.** `handleTaskTimeout` now records last activity, last
      tool, whether workspace changes were captured, and resume safety on the card and in telemetry.
      *(follow-up-6 §3.5)*

### F6.3 — Persisted run summaries & last-run card metadata
- [x] **Persist terminal task-run summaries separately from live `sessions.json`.**
      [task-run-summary-store.ts](src/state/task-run-summary-store.ts) appends a durable per-task run record
      (provider/model, endpoint, exit/review reason, last activity, token usage, timing) on each terminal
      transition (via the `emitSummary` chokepoint), to a runtime-home `task-runs/` JSONL that survives
      runtime shutdown; recent records are exposed through `getTaskDiagnostics`. Unit-tested. The record
      reserves `timeoutReason`/`timeoutSource`/`patchCaptureStatus` fields for the next item. *(§3.6, §4.2)*
- [~] **Timeout reason on the run record.** Terminal run summaries now carry a structured `timeoutReason`
      (e.g. "stream inactivity timeout after 360s") populated when a task is aborted on timeout. Remaining:
      `timeoutSource` provenance (global config vs role override vs autonomous default) from the launch config,
      and stats for timeout-triggered review outcomes by model/role/scenario. *(follow-up-6 §4.2)*

### F6.4 — Dev-test harness, outcome classification, observer & cleanup
- [x] **Shared run-outcome classifier.** [dev-test-outcome.ts](src/core/dev-test-outcome.ts) classifies a run
      from board counts + acceptance result + runtime reachability into `completed` /
      `acceptance_green_workflow_incomplete` / `blocked_by_review_cards` / `stagnant` / `runtime_down` /
      `failed` (success only when every non-trash card is Completed), with a `countDevTestBoardColumns` helper
      for the persisted-state path. Unit-tested. This is the shared core for the harness and observer below.
      *(follow-up-6 §3.4, §3.7, §5)*
- [x] **Official `runDevTestProject` harness** ([cline-dev-test-harness.ts](src/cline-sdk/cline-dev-test-harness.ts)):
      `buildDevTestSeedStartPayload` produces the exact UI-equivalent start payload (`taskTitle`,
      `startInPlanMode`, `baseRef`, `agentId`, `clineSettings`), and `runDevTestProject` runs the monitor loop
      over injected deps (start/readState/runAcceptance/sleep/now) — bounded by `maxWaitMs`, settles on stable
      polls, degrades when the runtime vanishes, and returns the classified outcome. Unit-tested with fakes.
      Remaining: thin real wiring (tRPC client + persisted-state fallback reader) + a `dev` CLI command.
      *(follow-up-6 §4.1)*
- [x] **Observer persisted-state fallback** is satisfied by the same harness `readState` contract +
      `countDevTestBoardColumns` (the reader returns `runtimeReachable: false` with the last persisted board);
      the loop then emits `runtime_down`. *(follow-up-6 §3.7, §2.3)*
- [x] **Dev-test cleanup report summarizer** ([dev-test-cleanup.ts](src/core/dev-test-cleanup.ts)): classifies
      entries into dev-test workspaces / sandbox volumes / editor caches, never reclaims the active run, and
      reports reclaimable vs retained bytes per category. Unit-tested. Remaining: filesystem/`docker`/`du`
      discovery wrapper + CLI surface. *(follow-up-6 §4.3)*

### F6.5 — Guards, regressions & fuzz coverage
- [x] **Narrowed the same-turn read guard** to content reads only (discovery/edits after a read are allowed)
      with an explicit next-step rejection message. *(follow-up-6 §2.6)*
- [x] **Near-valid tool-payload fuzz suite** for `decompose_project`
      ([cline-decomposition-tool-fuzz.test.ts](test/runtime/cline-sdk/cline-decomposition-tool-fuzz.test.ts));
      also made `summary` accept `null`. *(follow-up-6 §2.4 — `expand_task`/`write_file(s)`/discovery/command
      fuzz coverage still to extend.)*
- [x] **Regression test** proving generated cards land in Planning with start preconditions met. *(§2.1)*
- [ ] **Audit telemetry/session caches for task-id-only keys** (dev-test ids repeat across projects). The
      self-observation sink + task-diagnostics + run-summary store are workspace-scoped; sweep the remaining
      model-performance / knowledge-tool-usage caches. *(follow-up-6 §2.2)*

### F6.6 — Full portable project-state schema  *(specsheet §14.2; conflict model: CRDT)*
- [x] **CRDT board state.** [portable-board-crdt.ts](src/state/portable-board-crdt.ts) — per-field LWW-register
      CRDT with tombstones (cards + placement) and per-edge presence registers (DAG), with a merge proven
      commutative/associative/idempotent and deterministic LWW/delete conflict resolution. Unit-tested.
- [x] **Committed store + export/import + local re-resolution.**
      [portable-board-store.ts](src/state/portable-board-store.ts) writes the CRDT to the committed
      `<repo>/.cline/nklein/workspace/board-crdt.json`, merges committed⊕local on export, and
      `prepareImportedBoardForLocalModels` strips machine-local `clineSettings` so the importing machine
      re-resolves roles/fit against its own local models (§14.2 invariant). Unit-tested. Because the merge is a
      true CRDT, reconciliation is automatic (no manual rebase UI required). Plan artifacts
      (spec/plan/decisions/revisions) are already workspace-committed under `.cline/nklein/plans/`.
- [x] **Live wiring.** `writeWorkspaceStateFiles` now exports the durable board into the committed CRDT on
      every save (best-effort), and `readWorkspaceBoardForContext` recovers from the committed CRDT (with local
      re-resolution) when neither the runtime cache nor the project board mirror exists. Permanent card removal
      is tombstoned automatically on export (cards absent from a non-empty local board). A stable per-machine
      `replica-id` lives under the runtime home. Covered by a new cross-machine-recovery integration test.
      Remaining: schema migration when `schemaVersion` advances + browser verification of the reconcile UX.

---

## Changelog — maintain a running `## [Upcoming]` section

`CHANGELOG.md` now has a running `## [Upcoming]` section, but the full diff-grounded reconciliation still
needs to be audited against the current `main...HEAD` diff before release.

- [x] **Derive the entry from the actual diff, not commit messages.** Build `## [Upcoming]` from
      `git diff --name-status main...HEAD` plus **reading the real content** of each meaningful change —
      commit subjects are a guide only and undercount. Audited against merge-base `cb1bf3d` and the current
      `main...HEAD` diff (238 files changed; +43,275 / -5,006), including the file-discovery /
      `write_files` / `read_large_file` tools, eval harness/evidence bundle, model-tool-routing, team
      delegation/progress, web-research tool, `agent-write-guard`, ownership-aware worktree sync,
      settings surfaces, and projects/repository ownership cleanup. Added user-facing `## [Upcoming]`
      bullets for the previously underrepresented areas without presenting cloud/advisor behavior as
      generally available.
- [x] ~~**Prepend `## [Upcoming]`** to `CHANGELOG.md`, grouped by theme (the repo uses flat bullets per
      release, but grouping is far more readable at this size). The draft below is diff-grounded but must be
      reconciled line-by-line against the code during execution.~~
      `CHANGELOG.md` has a top-level `## [Upcoming]` section and current branch work is being appended there.
- [x] ~~**Process rule (ongoing):** every feature/fix/change is appended to `## [Upcoming]` in the **same
      commit/PR that lands it** — no exceptions, including every item in this plan (L0 cloud lockdown is the
      next entry). Add a one-line reminder to `AGENTS.md` so agents maintain it automatically. When a
      version is cut, rename `## [Upcoming]` to the version and start a fresh empty one on top.~~
      `AGENTS.md` now reminds agents to keep `CHANGELOG.md` current in the same change, and this branch's
      recent reliability commits update `## [Upcoming]` alongside their implementation changes.

### Drafted `## [Upcoming]` entry (diff-grounded; reconcile against code before shipping)

**Context & reliability**
- Real per-model context windows (advertised / observed / user override) with a **≥32k minimum** policy; LM Studio loaded-model context handling and linked-host handling
- Hard Cline context-window budget enforcement, tokenized read budgets, file-chunk token/char caps, a context-pressure budget policy, and ratio-scaled output/overhead reserves
- Context compaction focused on the latest file reads; !Klein-side context-overflow compaction fallback
- Configurable timeout modes/profiles and granular request / stream / tool / agent / conversation timeout controls
- Heartbeat & token-liveness telemetry; clearer model-activity status (reasoning counted as streaming)
- Resume persisted Cline chat after restart; hardened Cline startup guardrails

**Agent tooling for local models** *(new `AgentTool`s)*
- File-discovery tools (`list_files` / `find_files` / `get_file_size`) and a focused `write_files` tool
- `read_large_file` chunk/stitch workflow with per-chunk summaries, cursor hardening, same-turn-read serialization, and required final synthesis
- On-demand `repo_map` and `search_code` retrieval tools; model-aware per-model tool routing (trim toolset per model); approval required for guarded tools

**Model Capability & Speed Registry (MCSR)**
- Per-model capability + measured-speed registry (request durations via the event adapter), exposed through the runtime API and shown in the chat panel; provider service uses measured context windows; eval-harness results feed capability scores

**Autonomous decomposition**
- Plan artifact schemas (spec / plan / tasks); `task decompose` command and built-in `decompose_project` / `expand_task` tools
- Planning lane for plan-mode tasks; apply generated task graphs to the board with dependency links and per-role model settings
- Sizing-contract enforcement + test-first option; rejected decompositions recorded; overridable/implicit decomposition workflow shipped as a runtime prompt; blocked-card decompose action

**Codebase intelligence**
- Token-budgeted repo map injected before model calls; focused code search; offline code-index fallback, cached local vector index, configurable embedding provider

**Multi-model routing, roles & scheduling**
- Capability-aware task router + no-unrealistic-tasks start guard; tasks parked when no model fits; model-fit guard on decomposed tasks
- Model roles runtime config + settings editor, applied during decomposition; shared-endpoint serialization for local models; caps on dependency-triggered and manual bulk task starts; parked tasks skipped in bulk starts

**Autonomy & reliability gates**
- Acceptance-gate runner + `task acceptance` verification command; acceptance auto-repair + repair guidance run before review; completion self-review hook

**Self-improvement & telemetry**
- Local self-observation telemetry sink (errors / overflows / retries / inefficiencies) with Cline failures recorded; dogfood improvement-backlog engine + human-seeded suggestions + self-improvement surface; eval harness + scored smoke runs; dev evidence-bundle writer

**Context compression**
- Code-safe context compression helper (prose caveman / code minify); gated model-assisted compression

**Workspace, worktrees & safety**
- `agent-write-guard` write-scope guardrail; ownership-aware worktree sync of external project-folder changes with isolation warnings; `kanban.repositoryCreatedByKanban` ownership marker (survives remove/re-add) and guarded `.git` deletion; worktree cleanup hardening; projects tRPC API refactor/removal *(verify user-facing impact)*

**Dev tooling & CI**
- Dev Test Project scaffold + smoke eval harness/CLI with scored runs and one-click trial; `dev` commands; root `start.sh` and `start.bat`; CI gate (`check-cline-boundary.mjs`) enforcing the Cline SDK boundary

**Settings & UX**
- Settings dialog overhaul: model-role editor, explicit Cline provider selection, expanded model selectors, chat reset controls, context-efficiency + timeout task settings; token usage, model telemetry, and a context-budget display on cards

**Gated / parked (cloud-dependent — see L0)**
- Web-research tool + model-freshness advisor (`cline-model-research`) + MCP-discovery advisor + advisor settings buttons; native Cline team delegation + team-progress UI; trusted auto-merge safety policy

---

## Sequencing

**L0 (cloud lockdown) → L1 (stabilization, incl. the L1.6 context bar) → L2 (parallel executor +
swarm coordination/safety) → L3 (decomposition completion) → L4 (operator UI & observability)**, then the
carried-forward correctness items (MCSR decay + local-window resolution, router H2, repo-map/search,
gates, dogfood contract/safety) as capacity allows. Advisor/model-freshness stay parked until cloud is
revisited. (L4 surfaces can land incrementally alongside the phases that produce their data — e.g. the
context bar with L1, the model panel with the MCSR fix, the DAG view with L3.)

---

## Competitive feature research (aider / Cline / Roo Code / OpenHands / Open Interpreter / continue.dev)

> Goal: make !Klein the most capable local-only agentic tool, with special focus on keeping small/quantized
> models with small context windows productive on hard tasks. Each row notes the technique, who does it, and
> !Klein's status. Items already covered are recorded so we don't re-mine them.

### Implemented this pass
- [x] **Lenient fuzzy search/replace editing (aider `editblock`).** New
      [cline-fuzzy-edit.ts](src/cline-sdk/cline-fuzzy-edit.ts) + [`edit_file` tool](src/cline-sdk/cline-edit-file-tool.ts):
      exact → whitespace-flexible (re-indent) → leading-blank → `...` elision → fuzzy ≥0.8 ladder. Token-efficient
      (vs whole-file) and tolerant of near-miss search blocks — the #1 failure mode for weak models. Registered in
      the sandbox tool runner + scope/secret/line guards; small-model nudge added to leaf-task prompts.

### Already in !Klein (verified during research — do not rebuild)
- Reflection / retry on failed acceptance with error feedback → `cline-acceptance-repair.ts` + plan-gap loop.
- Context compaction / focus on latest reads → `cline-context-compression.ts` + `cline-context-focus-policy.ts`.
- Token-budgeted large-file chunk/stitch reads → `cline-large-file-workflow.ts`.
- Repo map + hybrid lexical+semantic code index/search → `cline-repo-map.ts` / `cline-code-index.ts` / `cline-code-search.ts`.
- Per-model tool routing (trim fragile tools for small models) + sequential tool calls → `cline-model-tool-routing.ts`.
- Plan/Act modes + per-turn checkpoints → planning lane + `turn-checkpoints.ts`.
- Repeated-read / repeated-tool loop guards → `cline-session-runtime.ts` / session service guardrails.

### Candidate techniques to evaluate next (not yet implemented)
- [ ] **Tree-sitter + PageRank repo map (aider).** !Klein's repo map is a documented bounded lexical heuristic;
      upgrading ranking quality would sharpen which symbols small-context models see first. (plan2.md M4.)
- [ ] **LLM-summarizing condenser (OpenHands).** Add an opt-in "summarize older turns into a compact memory"
      condenser alongside the existing deterministic compaction, for very long autonomous runs on small windows.
- [ ] **Edit-format auto-selection per model capability (aider).** Now that `edit_file` exists, route small
      models to it by default and reserve whole-file writes for new files / strong models.
- [ ] **Line-number-anchored edits (Roo Code).** Optionally include line numbers in read output and accept a
      line hint in `edit_file` to disambiguate repeated search blocks.
- [ ] **Microagents / domain knowledge packs (OpenHands).** Extend guidance skills + `knowledgeDebt` into
      reusable per-domain knowledge injected when a card's topic matches.
- [ ] **Anti-lazy-edit prompting (aider udiff lesson).** Detect and reject `// ... unchanged ...` placeholder
      edits that drop real code.

---

## Small-model / limited-hardware capability pass (academic + competitive, 2026-06-21)

> Direction (user): do not rely solely on the Cline SDK — give !Klein its own local-model path so it can use
> the levers the SDK cannot forward (grammar/JSON-schema constrained decoding, min_p, repetition_penalty), and
> batteries-included ONNX prompt compression with opt-out. Academic grounding: min-p (arXiv:2407.01082),
> LLMLingua-2 (arXiv:2403.12968), self-consistency (arXiv:2203.11171), grammar-constrained decoding
> (arXiv:2403.06988).

- [x] **Keystone: `LocalLlmClient`** ([cline-local-llm-client.ts](src/cline-sdk/cline-local-llm-client.ts)) —
      direct local-only OpenAI-compatible client with full sampling + grammar/JSON-schema constrained decoding
      and a `generateStructured` helper (schema-valid JSON, prose/fence recovery, corrective retry). Unit-tested.
      Unblocks the constrained-decoding technique the SDK cannot forward, without forking the SDK.
- [ ] **Consumer: per-model sampling policy** — choose temperature/min_p/repeat_penalty per model/role
      (low/deterministic for coding + quantized) and use `LocalLlmClient` for structured sub-tasks.
- [ ] **Consumer: constrained decomposition + best-of-N selection** — generate plans via `generateStructured`
      against the plan-task-graph JSON schema; sample N and select with `assessClinePlanTaskGraphQuality`
      (self-consistency). Plumb provider/baseUrl resolution into the decomposition flow.
- [ ] **Consumer: constrained tool-argument generation/repair** — unify the ad-hoc JSON parsers behind a
      shared repair helper; optionally regenerate malformed tool args via `generateStructured`.
- [ ] **Batteries-included ONNX LLMLingua-2 compression** — runtime model download/update, run via llama.cpp /
      onnxruntime, opt-out to the existing caveman/minify fallback; new compression mode in
      `cline-context-compression.ts`.
- [ ] **Setup guidance** — recommend hardware-appropriate server settings (quant e.g. Q4_K_M, KV-cache, flash
      attention, context size, min_p/repeat_penalty) in onboarding.
- [ ] **Upstream proposal** — ask `@clinebot` to forward `response_format`/grammar + top_p/top_k/min_p/
      repetition_penalty in its provider layer so the main agent loop benefits too.

### Small-model capability pass — implemented (2026-06-21, second batch)
- [x] **Per-model/role sampling policy** ([cline-sampling-policy.ts](src/cline-sdk/cline-sampling-policy.ts)) —
      deterministic low temperature + min_p + repetition penalty, tightened for small/quantized families.
- [x] **Unified tool-argument JSON repair** ([cline-tool-argument-repair.ts](src/cline-sdk/cline-tool-argument-repair.ts))
      — shared near-valid JSON recovery; decompose_project/write_files/edit_file now use it.
- [x] **Best-of-N decomposition selection** ([cline-decomposition-selection.ts](src/cline-sdk/cline-decomposition-selection.ts))
      — self-consistency scored by the sizing + graph-coherence validators; injectable generator.
- [x] **LLMLingua-2-style selective compression** ([cline-prompt-compression.ts](src/cline-sdk/cline-prompt-compression.ts))
      + **runtime ONNX model download/update manager**
      ([cline-compression-model-manager.ts](src/cline-sdk/cline-compression-model-manager.ts)); wired as the
      opt-in `selective` mode in `cline-context-compression.ts`. Heuristic scorer is the batteries-included
      default; ONNX scorer is opt-in.

### Remaining seams / follow-ups
- [ ] **ONNX inference adapter** that runs the downloaded LLMLingua-2 model and provides a
      `TokenImportanceScorer` (the heavy native/WASM dep is deliberately not forced into committed code; the
      heuristic scorer ships as the default). Wire `ensureCompressionModel` → adapter → `selectiveScorer`.
- [ ] **Wire the consumers into live flows**: pass `resolveLocalSamplingOptions` through `LocalLlmClient` calls;
      route decomposition through best-of-N when `decompositionCandidates > 1`; expose `selective` compression +
      the model opt-in as settings.
- [ ] **Setup guidance (web-ui)**: recommend quant level (e.g. Q4_K_M), KV-cache, flash attention, context
      size vs the ≥32k floor, and server-side min_p/repeat_penalty in onboarding (browser-verify).
- [ ] **Upstream `@clinebot` proposal**: forward `response_format`/grammar + top_p/top_k/min_p/repetition_penalty
      in the SDK provider layer so the main agent loop gets constrained decoding too (until then, the
      `LocalLlmClient` path carries it for structured operations).

---

## Own agent core — going beyond Cline-only (2026-06-21)

> Decision: !Klein grows its own native backend rather than staying a Cline-SDK-only runtime, and adopts the
> best implementations from the local-agent ecosystem into its own codebase (attribution + license posture in
> THIRD_PARTY_NOTICES.md). Cline remains one supported runtime.

- [x] **Native agent loop** ([src/agent-core/agent-loop.ts](src/agent-core/agent-loop.ts)) — ReAct
      tool-calling loop with stall/loop + max-turn guards, decoupled from the SDK and unit-tested.
- [x] **Constrained action decider** ([src/agent-core/agent-action-decider.ts](src/agent-core/agent-action-decider.ts))
      — selects the next tool via JSON-schema constrained decoding on `LocalLlmClient`, using the sampling policy.
- [x] **Attribution & licensing** ([THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)) — per-project license +
      what was adopted; AGPL (Open Interpreter) excluded from code.
- [ ] **Tool registry for the native core** — expose !Klein's existing tools (edit_file, write_files, read,
      search, repo_map, decompose) as `AgentCoreTool`s and a `runNativeAgentTask` entrypoint.
- [ ] **Runtime selection** — let a task choose the native core vs the Cline runtime (config/role); wire the
      native core into the task-session service alongside the Cline path.
- [ ] **Port remaining adopted techniques** as needed (OpenHands condenser pipeline, Continue context
      providers, Roo multi-file diff) — each recorded in THIRD_PARTY_NOTICES.md when added.

---

## Python core migration — Phase 0/1 landed (2026-06-21)

> Strangler-fig pivot to a polyglot split (Python core sidecar + TS server/UI). See the approved migration
> plan and THIRD_PARTY_NOTICES.md.

- [x] **core-py scaffold** (`core-py/`): FastAPI app (`/health`, `/v1/generate`, `/v1/generate_structured`),
      pydantic versioned contract + JSON-Schema export, local-only guard, sampling policy, generation backends
      (proxy + `llama-cpp-python` seam), structured-generation recovery+retry, pytest suite, pyproject (`uv`).
      Pure helpers verified under system python3; full suite runs via `uv run pytest`.
- [x] **TS `KleinCoreClient` + flag** (`src/cline-sdk/klein-core-client.ts`, `src/config/klein-core-config.ts`):
      drop-in `generateStructured` to the sidecar with automatic `LocalLlmClient` fallback; `createStructuredGenerator`
      routing seam; opt-in via `NKLEIN_CORE_PY` (default off). Unit-tested; full TS suite green (1140).
- [ ] **Wire `createStructuredGenerator` into live callers** (agent-core decider, decomposition) — the seam is
      ready; flip the construction sites when Phase 3 wiring lands.
- [ ] **Contract parity CI** (zod ↔ exported JSON-Schema ↔ pydantic).
- [ ] **Phases 2–5** per the approved plan (ML services, native agent core in Python adopting aider/OpenHands,
      decomposition/tools, Electron bundling).

---

## State-report reconciliation (habit + audio-VST dev-test runs)

> Maps the dev-test state report's concluded todos and remaining gaps to their current status. Most "remaining
> gaps" were addressed during this session; the rest are tracked above (Python migration phases) or below.

### Concluded (shipped earlier this branch / session) — verified
- [x] Generated decomposition cards start from Planning — regression test in `cline-decomposition-tool.test.ts`.
- [x] Diagnostics workspace-scoped (path hash, not task-id only) — self-observation sink + task-run store.
- [x] Workspace lock contention retried — scoped runtime requests + auto-review.
- [x] Near-valid model tool payloads repaired — `cline-tool-argument-repair.ts` (shared) + fuzz suite.
- [x] Host paths normalized inside sandbox tools/commands — agent-sandbox path normalization.
- [x] Empty clean patch can complete review; runaway/stalled generated tasks get bounded timeouts.
- [x] Model performance + knowledge/tool usage stats exist.

### Remaining big gaps from the report → status this session
- [x] **Decomposition domain-knowledge phase before graph finalization** — `kanban-decompose` workflow now
      mandates a knowledge-acquisition phase; cards carry `knowledgeDebt`. (`cline-decomposition-workflow.ts`,
      `cline-plan-artifacts.ts`.)
- [x] **"Scope pressure" pass to detect 10x/100x under-decomposition** — added to the decompose workflow.
- [x] **Dependency-graph validation (missing/weak/reversed edges)** — `cline-decomposition-graph-quality.ts`
      (hard violations + warnings), enforced at the creation gate.
- [x] **Dev-test success = all non-trash cards Completed, not just passing tests** —
      `dev-test-outcome.ts` (`acceptance_green_workflow_incomplete` vs `completed`).
- [x] **Better persisted review diagnostics (corrupt patch capture, stream inactivity timeouts)** —
      `task-patch-capture-diagnostics.ts` (classified + preserved artifact) + structured timeout note in
      `cline-task-session-service.ts`.
- [x] **Runtime shutdown preserves task-run summaries (sessions.json empties on shutdown)** —
      `task-run-summary-store.ts` (durable `task-runs/`), surfaced via `getTaskDiagnostics`.
- [x] **Observers get clean final summaries when the runtime disappears** — `dev-test-outcome.ts`
      `runtime_down` classification + `countDevTestBoardColumns` persisted-state path.

### Still open (quality, beyond what shipped)
- [ ] Prove "hands-off complex project completion" end-to-end: drive every generated card to Completed on the
      audio-VST benchmark (needs the live runtime + a capable local model). The mechanisms exist; the
      remaining work is decomposition *quality* on hard domains — which the **Python core** (real knowledge
      acquisition + best-of-N + constrained decoding + stronger repo map) is intended to raise.
- [ ] Wire best-of-N + knowledge-acquisition through the Python core once Phases 2–4 land, then re-run the
      audio-VST benchmark and score with both acceptance AND board-completion.
