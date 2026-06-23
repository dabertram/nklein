# !Klein — todo.md (single source of truth for development)

> **This is the one durable dev artifact.** It replaces `specsheet.md`, `plan.md`,
> `iteration-instructions.md`, `follow-up-1.md … follow-up-6.md`, and
> `findings-from-follow-up-work-4.md` (all consolidated here and deleted).
>
> **An agent is told only one of two things:** *"work on `todo.md`"* or *"add to `todo.md`"* — and must
> get everything it needs from this file. So: the rules of engagement, what already exists, what's left,
> and why the project is shaped the way it is all live here.
>
> **Status legend:** `[x]` shipped & verified · `[~]` partial / shipped-but-degraded · `[ ]` open ·
> `LATER:` deferred by decision · `BLOCKED:` needs the user (env is **not** a blocker — the working session has
> Docker + the `nklein/agent-sandbox` image, a live LM Studio with loaded models, and a Playwright browser, so
> Docker/browser/live-model verification is actionable here, not blocked).
>
> **Last reconciled:** 2026-06-22 (against `main..HEAD`, the codebase, and the predecessor planning chain —
> including a line-by-line re-verification pass over all 10 source docs: follow-up-1/2/3 are 100% shipped,
> follow-up-4/5 open items map to §5.A, and the distinct follow-up-2 hardening features are itemized in §6.13).

---

## 1. Prime directives — never violate

1. **LOCAL MODELS ONLY.** `CLOUD_ENABLED = false`
   ([src/nklein-sdk/nklein-local-only-policy.ts](src/nklein-sdk/nklein-local-only-policy.ts)). No path, default,
   setting, or UI may reach a paid/cloud LLM. Cloud providers don't render, can't be selected, and cloud-pinned
   cards hard-stop. Re-enabling cloud is a single deliberate reviewed code change — never a feature you add.
2. **STRICT DOCKER AGENT ISOLATION IS MANDATORY, UNCONDITIONAL, FAIL-CLOSED.** Every agent shell command and
   filesystem read/write runs inside a Docker container; the host runtime never executes shell/FS on the LLM's
   behalf. No host fallback, no "disable isolation" toggle, no degraded mode. If Docker/the image is
   unavailable, agent tasks refuse to start. **Bright line:** board / plan / !Klein-state mutation is *trusted
   control-plane* and may run host-side; the user's-repo file/shell/edit/patch/search is *data-plane* and must be
   sandboxed.
3. **≥32k context minimum.** `NKLEIN_MIN_CONTEXT_WINDOW_TOKENS = 32_000`, enforced at every entry. No oversized
   prompt is ever sent — over-budget turns compact or the task stops. No hardcoded window/speed constants in
   routing/budget decisions.
4. **UPSTREAM-CLEAN SDK BOUNDARY.** Every feature is a `src/nklein-sdk/` plug-in on an official SDK socket.
   `npm run check:nklein-boundary` must stay green. (See §11 for the note that the SDK itself is now vendored
   in-repo under `vendor/nklein-sdk/` — that is repo-owned and editable; the boundary rule is about not forking
   the SDK's *internal* contracts gratuitously.)
5. **PROTECTED TESTS ARE HUMAN-GATED.** You may not weaken or change anything in `test/protected/**`,
   `vitest.protected.config.ts`, or `test/protected/protected-tests.json` without **explicit user approval** via
   a structured `{intent, diff, reason, expectedEffects}` proposal. Default is deny.
6. **Follow `AGENTS.md` / `CLAUDE.md`:** no `any`, no inline/dynamic imports, prefer SDK types, `react-use`
   hooks in web-ui, Tailwind over inline styles, small single-responsibility files, and keep `CHANGELOG.md`
   `## [Upcoming]` current **in the same change** as the code.

### Product identity
!Klein is a local-autonomous, multi-LLM **kanban swarm** for software work. A user drops a high-level idea on
the board; !Klein decomposes it into a dependency-linked DAG of right-sized cards and runs them with local LLM
agents — in parallel where safe — entirely on the user's own hardware. Branding: in-app `!Klein`,
OS/packaging `nKlein`, identifiers `nklein`. The repo name and the `kanban.repositoryCreatedByKanban` git
marker are intentional keeps.

---

## 2. The iteration loop (how to work)

Repeat until the stop condition (§3) is met:

1. **Sync context.** Read this file (§1 directives, §5 open work). Run `git log --oneline -10` and `git status`.
2. **Pick the highest-value open item** from §5, in this priority order:
   1. Anything that unblocks the headline goal: a single high-level prompt → Planning-lane DAG → cards that
      auto-start and run, **with strict isolation ON**.
   2. Safety/correctness (isolation invariants, guardrails, protected-test coverage gaps).
   3. Enumerated open items (§5.A–§5.G).
   4. Backlog / newly-raised items (§5.H–§5.I) that are ready (no unresolved user clarification).
   If comparable, prefer the smallest safe step that ships value.
3. **Deep analysis before coding.** Read the actual implementation, not just this doc. Re-grep quoted
   symbols — line numbers drift. Confirm the gap is real. If the right approach is genuinely ambiguous in a
   way the codebase can't resolve (architecture-shaping decisions, anything touching the invariants), **ask the
   user** — don't guess.
4. **Implement** to production quality. Add **well-selected** tests (§4). Stay within the SDK boundary.
5. **Verify** (the gates below). Everything green before an item is "done".
6. **Update docs in the same change:** flip the checkbox here, and add a user-facing `CHANGELOG.md`
   `## [Upcoming]` bullet. If you're adding a genuinely new capability, write its spec in §5 **first**.
7. **Commit cadence:** collect ~10–15 completed items (or a coherent themed batch), then commit and push —
   keep the remote current without micro-commits. Commit sooner if you hit a milestone, are about to do
   something risky, the tree is getting large, or a handoff is imminent. Work on the feature branch
   (`feat/kanban-reliability-context-upgrade`), never `main`. End every commit message with
   `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

### Verification gates — run before marking ANY item `[x]`
- `npm run typecheck` · `npm run web:typecheck` — 0 errors.
- `npm run lint` — clean · `npm run check:nklein-boundary` — passes.
- `npm run test:fast` plus the specific `npx vitest run test/runtime/...` suites for what you touched — green.
- `npm run test:protected` — green (and you did not modify it without approval).
- web-ui changes: `npm --prefix web-ui run test` for the affected components.
- isolation/Docker changes: run the Docker-gated integration tests if a daemon is available; they must skip
  cleanly when not.
- If a user-relevant UI/flow can't be unit-verified, either run the dev build and observe, or **record the
  manual-verification debt** under §5.A — never silently mark it done.

Never mark `[x]` until its gate passes. Report failures honestly, with output.

---

## 3. Stop condition — when "nothing is left to do"

When every §5 item is done or blocked on the user/an environment, and no correctness/safety/UX gap survives
deep analysis:
1. Final verification pass; make sure this file is in sync.
2. **Do not invent low-value churn to look busy. Stop.**
3. Report: what was accomplished this run, the verification status, and what's now blocked on the user (e.g.
   the portable-state clarifications in §5.F, the manual isolation/UI verification in §5.A that needs a
   Docker-enabled interactive browser session).
4. **Ask the user for new feature ideas.** Offer 2–4 concrete, invariant-respecting proposals of your own as a
   starting point. New ideas get written into §5 first, then worked.

---

## 4. Test selection philosophy (well-selected, not exhaustive)
- Lock **product behavior and invariants**, not implementation trivia. A focused regression for each bug fixed
  and each invariant a small model could plausibly weaken.
- The **protected suite** is the floor that lets small/weak LLMs work on !Klein safely. It must cover the
  load-bearing invariants (local-only policy, context/overflow, timeout scaling, swarm guardrails, workspace
  identity, decomposition apply, the strict-isolation no-host-execution + fail-closed-start guards). Add to the
  protected manifest **only via the human-approval path** (§1.5).
- Keep suites fast and non-hanging. If CI hangs on Node 22, suspect a live subprocess / real SDK-host boot
  before a slow test body (see `.plan/docs/node22-ci-hanging-tests-investigation.md`).

---

## 5. OPEN WORK (the actual todo)

> Everything in §6 is already shipped — listed there so an agent knows what exists and doesn't rebuild it.
> The items below are what's left. Each is independently landable.

### 5.0 — Clarification decisions (2026-06-23 pass; all FINAL unless re-decided)
> The user went through every open question in §5. Recorded here so the tasks are actionable without further
> clarification; the per-section items below are annotated to match.
> - **NEXT / priority order:** **§5.A worktree retirement first**, then the rest.
> - **§5.A:** **Full retirement now** — remove terminal/CLI agents from `RUNTIME_AGENT_CATALOG` + the web-ui
>   legacy path, rework shell-on-task to `docker exec` into the task's sandbox, delete the worktree modules +
>   saved-host-patch path; verify the review/diff/merge + shell UI in-browser (env has Docker + browser).
> - **§5.H:** **Build both prerequisites now, then flip** — native-core→task-execution integration AND
>   python-core auto-start/bundle (+ Settings health line), then make native-core the default runtime (SDK
>   fallback intact) and python-core default-on.
> - **§5.M:** build **memory system first** (sensible defaults, tunable in settings); **fold the home agent into
>   the unified agent** as a selectable scope/role (migrate its session model into the new store). (Signal-first,
>   one-session-per-thread, 3 execution modes, isolated-by-default memory remain as previously decided.)
> - **§5.Q:** canonical model identity = **provider + model + canonical endpoint** (canonicalize loopback /
>   trailing-slash like the MCSR loopback fix; only true duplicates merge); aggregate globally per model.
> - **§5.O:** **CLI orchestrator** extending `nklein dev test-project` (+ collect-evidence/cleanup-report);
>   build the orchestrator **and** the parallel-fan-out dev-test projects **now**, sweep when the user makes the
>   quant / K-V-cache configs available.
> - **§5.L:** next delivery follow-up = **per-project delivery override**, built **with the §5.I#3 project-settings
>   modal** (where per-project settings belong).
> - **§5.B:** **build** the knowledge-tool-usage decomposition signal (backend correlation + Settings stats
>   column); **I draft** the audio-VST domain rubric + scorer.
> - **§5.I#1:** build **all three** residuals — idle-unload timer, verified sha256 in the manifest, in-panel
>   model-override picker.
> - **§5.P:** **keep deferred** until we reach it (it's the last task; boundary depends on how everything lands).

### 5.A — Finish strict-isolation reconciliation & live verification
- [ ] **Retire the host worktree subsystem** *(direction decided: retire — terminal/CLI agents stay
      permanently disabled under local-only).* The single boundary predicate is
      `usesLegacyHostTaskWorkspace(agentId)` ([src/core/agent-catalog.ts](src/core/agent-catalog.ts)) — keep it
      as THE source of truth (invariant-tested). **Deletion is BLOCKED on two UI-verifiable changes:**
      (1) remove terminal/CLI agents from `RUNTIME_AGENT_CATALOG` / launch-support and the web-ui legacy path;
      (2) ~~decide the shell-terminal-on-task story~~ **DECIDED 2026-06-22 (user): shell-on-task = `docker exec`
      into that task's hardened sandbox container** (drop into the sandbox working copy; no host checkout, no
      legacy worktree — the user shell is as isolated as the agent). `startShellSession` /
      `resolveTaskCwd({ ensure: true })` is reworked to attach to the task's container instead of ensuring a host
      checkout. The saved-host-patch retirement and the project-health "accidental worktree" re-validation ride
      along with (1). Do this where the review/diff/merge + shell UI can be visually verified. Files:
      `src/workspace/task-worktree*.ts`, `src/workspace/task-result-branches.ts`, `src/terminal/session-manager.ts`.
- [ ] **UI live-verification debts** *(actionable — Docker + browser + LM Studio available this session).* The
      headless path is verified (`scripts/verify-strict-isolation.mts` ran a real NKlein task in a shared Docker
      sandbox against LM Studio, no host worktree, clean teardown, fail-closed on missing image, clean
      telemetry). **Still owed in-browser (verify via Playwright):** Settings isolation status + pool-control
      inspection; and dev-build UX (no cloud default, model-registry prune, live loaded-model line, Developer Mode
      persistence, embedding auto-discovery). Also verify the swarm concurrency cap and sandbox-pool queue compose
      visibly in the card/header UI.
- [ ] **Isolation polish.** UX for paused / queued / sandbox-unavailable card states + an isolation empty state;
      consider extracting sandbox-lifecycle/pause out of the large
      [src/nklein-sdk/nklein-task-session-service.ts](src/nklein-sdk/nklein-task-session-service.ts); reconcile
      docs so the planning ("L3") story isn't overstated.
- [ ] **UI re-checks to fold into the verification session above:** confirm the decomposition DAG dry-run
      preview still renders; confirm plain-language park reasons display; run a fresh-config local dogfood day on
      the in-use model and assert the telemetry diff shows zero insufficient-balance / 1s-timeout / >1M-overflow /
      provider-error events. *(AGENTS.md worktree tribal-knowledge is already reconciled to the
      container-primary + result-branch model.)*

### 5.B — Decomposition quality & the knowledge-expansion loop
- [x] **FIX (live bug, evidence 2026-06-22T12-09): `decompose_project` malformed/empty-call recovery** *(shipped; verified 2026-06-23 — `relaxJsonSchemaNode` drops `required` + relaxes `additionalProperties` at every depth so `execute` always runs; in-handler validation throws a short directive naming missing fields + "don't resend empty"; `repairJsonStringValue` recovers typo'd/stringified payloads; fuzz-tested).* A small
      local model (gemma-4-26b) called `decompose_project` 3× and all 3 were rejected *before* our handler ran:
      call 1 had typo'd task fields (`tasks_id`, `plant`); calls 2–3 arrived as empty `{}`. The tool's SDK-level
      `inputSchema` (`required: [slug,spec,plan,title,tasks]`, `additionalProperties: false`) makes the **SDK
      pre-reject** with a 4 KB raw Zod dump that (a) small models can't recover from, (b) bloats context, and
      (c) bypasses our in-handler `repairJsonStringValue`. The model then spiraled to empty calls and decomposed
      nothing. **Fix:** relax the boundary `inputSchema` (drop `required`, allow extra props) so `execute` always
      runs; validate in-handler and **return a compact, directive message** (name missing fields; nudge a small
      first payload: "3–6 tasks, keep spec/plan to a few sentences — they're truncated; don't resend empty")
      instead of throwing the dump; detect the empty `{}` case explicitly. Files:
      [src/nklein-sdk/nklein-decomposition-tool.ts](src/nklein-sdk/nklein-decomposition-tool.ts). Distinct from
      the shipped "re-prompt a turn that ends with NO tool call" — here the model *did* call the tool, with bad
      args.
- [ ] **Knowledge-tool usage as a decomposition-quality signal.** Correlate whether retrieval / code-index /
      architecture-knowledge tools were actually used in a planning session *before* `decompose_project`, and
      surface "decomposition used / did not use knowledge tools" in the Settings stats view — not just a usage
      count. Needs session-runtime correlation + a Settings UI column. (Graph-coherence validation,
      `knowledgeDebt` on cards, and the mandatory knowledge-acquisition + scope-pressure workflow are already
      shipped — see §6.)
- [ ] **Audio dev-test rubric.** Score the audio-VST fixture as under-decomposed/shallow against a domain
      rubric: DSP correctness, measured phase alignment, groove invariants, effect-guardrail sweeps, full UI
      control coverage, prototype-vs-real-VST docs. (The preset + run-harness are shipped; this is the *scoring*.)

### 5.C — Run summaries & timeout diagnostics
- [x] **Timeout provenance + stats** *(2026-06-22; completed 2026-06-23)*. Terminal run summaries populate
      `timeoutSource` (`role_override` vs `global_config` vs `autonomous_default`), resolved per-kind from the
      launch-config precedence in `resolveEffectiveTaskTimeoutSettings`, threaded through the start request, stored
      per task, and stamped with the source of the timeout that actually fired. `summarizeTimeoutOutcomes`
      ([src/state/task-run-summary-store.ts](src/state/task-run-summary-store.ts)) groups timeout-triggered runs by
      provider × model × timeout-source × **role** × **scenario** with the terminal outcome each produced.
      **By-role + by-scenario breakdowns DONE (2026-06-23):** the run-summary record carries a coarse `role`
      (`reviewer` for `<taskId>::review`, `architect` for decomposition turns, else `worker` — inferred in
      `captureTerminalRunSummary`) and a dev-test `scenario` (parsed from the `devtest-<scenario>-<ts>` task id);
      pre-§5.C records default to the `unknown` role / `null` scenario group. Both unit-tested. (The by-scenario
      breakdown directly feeds the §5.O robustness sweeps.)

- [x] **Thin real wiring for `runDevTestProject`** *(2026-06-22)*. The harness + outcome classifier + observer
      fallback + cleanup summarizer were already built and unit-tested. Added the side-effecting seams in
      [src/nklein-sdk/nklein-dev-test-runner.ts](src/nklein-sdk/nklein-dev-test-runner.ts): `createDevTestStateReader`
      (live tRPC `workspace.getState` → persisted `loadWorkspaceBoardById` fallback → null, with the fallback
      semantics unit-tested) and `discoverDevTestCleanupEntries` (active/retained classification unit-tested).
      Wired both into real CLI commands ([src/commands/dev.ts](src/commands/dev.ts)): `nklein dev test-project`
      (starts a scenario seed via `runtime.startTaskSession` and monitors to a classified outcome) and
      `nklein dev cleanup-report` (marker-scan + `du` + `docker volume ls` discovery feeding the summarizer).
      **Manual-verification debt (live path):** the tRPC/docker/du glue runs against a live runtime + Docker and
      is not unit-covered — verify `dev test-project` end-to-end and `dev cleanup-report` sizing in the
      Docker-enabled session noted in §5.A.

### 5.E — Cache-key hygiene & fuzz coverage
- [x] **Audit telemetry/session caches for task-id-only keys** *(2026-06-22)*. Dev-test task ids repeat across
      projects. The self-observation sink, task-diagnostics, and run-summary store are workspace-scoped; the
      **model-performance** and **knowledge-tool-usage** caches were verified to already include
      `workspacePathHash` in their observation id / aggregate keys / read filters — and that invariant is now
      locked by regression tests asserting the same repeated task id across two workspaces stays as two distinct
      observations. (The live `*ByTaskId` maps in the session service/runtime are single-process and keyed by the
      unique live task id — not a cross-project persisted cache.)
- [x] **Extend the near-valid tool-payload fuzz suite** *(2026-06-22)* beyond `decompose_project` to
      `expand_task`, `write_file(s)`, and the discovery tools (`test/runtime/nklein-sdk/nklein-tool-payload-fuzz.test.ts`).
      Found + fixed a real gap: `expand_task` parsed its `taskGraph` raw, so a stringified graph (common from
      small models) failed — it now uses the same `repairJsonStringValue` recovery as `decompose_project`.
      (`run_command` is the SDK-owned sandboxed bash bridge with no local schema-recovery surface, so it is out of
      scope for a near-valid-payload fuzz.)

### 5.F — Portable "project state in the repository" (cross-machine continuation)
> Conflict model chosen: **CRDT** (automatic merge, no manual rebase UI). Board CRDT, committed store,
> export/import with local model re-resolution, and live wiring into save/load are shipped (see §6). What's left:
- [x] **Schema migration** when `schemaVersion` advances on the committed
      `<repo>/.nklein/nklein/workspace/board-crdt.json` *(2026-06-22)*. `readPortableBoardCrdt` now goes through
      `migratePortableBoardCrdt` ([src/state/portable-board-crdt.ts](src/state/portable-board-crdt.ts)): a
      forward-migration registry (keyed by source version, empty today) upgrades older committed files up to
      `CURRENT_PORTABLE_BOARD_SCHEMA_VERSION`, refuses newer-than-known versions instead of coercing them, and
      guards against non-advancing migrations. A future bump is a one-line registry entry + the version constant.
- [ ] **Verify the reconcile UX** of a cross-machine fetch-and-continue end-to-end in the UI *(browser available — verify via Playwright).*
- [x] ~~**Confirm WITH THE USER before extending**~~ **DECIDED 2026-06-22 (user):** **repo-committed** =
      board/CRDT, DAG, card progress, `knowledgeDebt`, decomposition — stored as **human-readable (pretty-printed)
      JSON** like `board-crdt.json` today. **Machine-local (never committed):** model registry/measured speeds,
      endpoint URLs, container/sandbox state, telemetry, secrets, absolute host paths, worktree/result-branch
      artifacts, and in-flight sandbox work (these don't move — only plan/graph/progress does). No secrets or
      absolute host paths may leak into committed state; card provenance/links must survive a different checkout;
      roles/fit **re-resolve against the target machine's local models on load**.

### 5.G — Backlog (promote into a worked item when picked up)
- [ ] **Plug-and-play Docker delivery.** Wrap the whole !Klein app (runtime + built web-ui) into a Docker image so
      it's a ready-to-use deliverable, and add a **`docker-compose` example to the README** so anyone can
      `docker compose up` to build the image and get a running, ready-to-use container. **Must handle the
      Docker-in-the-loop wrinkle:** !Klein itself launches hardened Docker sandboxes for agents, so the container
      needs Docker access (mount the host `docker.sock` or document DinD) for agent tasks to run — call this out
      explicitly in the compose example. Persist the runtime home (`~/.nklein`) and project mounts as volumes;
      expose the runtime + web-ui ports; keep local-only/no-cloud defaults. Document local-model endpoint reachability
      from inside the container (host LM Studio/Ollama via `host.docker.internal`).
- [ ] **CI-able dogfood smoke:** a scripted end-to-end that exercises a full 1-shot → decomposition → parallel
      execution → merge cycle on a tiny local model, as a CI gate.
- [ ] **Explicit in-UI sandbox queue list** (today only a per-card "queued" state).
- [ ] **Main-board role/agent visibility.** Add a compact board-header strip that groups active work by role
      (`Architect`, `Worker`, later `Reviewer`) and shows which card each role is currently running/queued on,
      with click-to-focus behavior. Cards now show an inferred role chip, but the fuller UI should persist and
      expose the resolved launch role on session summaries so the view can show planned role, active role,
      model override, and route-up/down decisions without relying only on `startInPlanMode` inference. Keep the
      distinction visible: plan-mode decomposition cards are architect work, while implementation cards waiting
      in Planning with `startInPlanMode: false` are worker work.
- [ ] **Board-level merge-status history surface** (today CLI/integration-card only).
- [x] **Richer acceptance-failure classification taxonomy** *(2026-06-22)*. Built the pure classifier
      ([src/core/acceptance-failure-taxonomy.ts](src/core/acceptance-failure-taxonomy.ts)) — command-not-found,
      missing-script, missing-dependency, type-error, lint-error, compile/syntax-error, test-failures, timeout,
      unknown — each with a label + next-step hint, and wired it onto the acceptance-gate result
      (`failureCategory` + `failureHint`, both now required on `NKleinAcceptanceGateResult`). The category list is a
      single source-of-truth const tuple (`ACCEPTANCE_FAILURE_CATEGORIES`) feeding both the TS union and the wire
      zod enum; labels live in one map (`ACCEPTANCE_FAILURE_LABELS` / `acceptanceFailureCategoryLabel`) reused by the
      classifier and the UI. **UI done:** the contract round-trips `failureCategory`/`failureHint`, and the card
      detail view's Verify-acceptance result renders the classified label + next-step hint on failure
      (`whitespace-pre-line` so it sits on its own line). Tests: gate/taxonomy/auto-repair/task-verify + web-ui
      card-detail all green.

### 5.H — Polyglot / native-agent-core workstream *(active; postdates the predecessor planning chain)*
> Direction: !Klein is growing **its own** capabilities instead of depending only on the vendored SDK — a
> local-only Python core sidecar (`core-py/`, FastAPI) and a TS-native agent core (`src/agent-core/`). Shipped so
> far (see §6.10); the open edges:
> **ENGINEERING REALITY (found 2026-06-22 while wiring):** both "default-now" decisions below are NOT safe
> flag-flips and were NOT flipped:
> - **Native-core default** has nothing to flip — `src/agent-core/` is only `agent-action-decider.ts` +
>   `agent-loop.ts` (~285 lines) and is **not imported by any runtime/session code**. There is no
>   runtime-selection switch; defaulting to it would require first building the native-core→task-execution
>   integration (sandboxed tools, session lifecycle), which needs a live/Docker session to verify. Prerequisite,
>   not a flip.
> - **Python-core default-on** would make every install attempt the (absent) sidecar and rely entirely on the
>   fallback on every call — *worse* default behavior than opt-in *until* the sidecar is bundled + auto-started.
>   The decided "flip + auto-start + bundle + Settings health" needs the auto-start/bundle (live verification)
>   to land first. Safe additive piece available without flipping: the read-only **Settings health line**.
- [x] **Decide the embedding story end-to-end (ties to §5.I-1)** *(2026-06-22)*. Resolved: `local_gguf`
      (nomic-embed-text-v1.5) served in-process by the Python core's `llama-cpp-python` `embedding=True` backend,
      auto-downloaded host-side, wired through `runtimeCodeEmbeddingProviderSchema` as the default, degrading to
      `local_lexical` when the core is off. See §5.I-1 for the shipped detail.
- [ ] **Promote the native agent core path** (`src/agent-core/`) from "one supported runtime" toward a
      first-class local option, keeping strict isolation for its data-plane tools. **DECIDED 2026-06-22 (user):
      make native-core the DEFAULT runtime now**, with the vendored SDK host as automatic fallback. Switch the
      default selection, keep the SDK reachable on failure, and assert strict isolation still holds for
      native-core data-plane tools. (Bigger blast radius — land behind thorough tests + a clean fallback path.)
- [ ] **Python core production wiring & gating.** It's opt-in via `NKLEIN_CORE_PY` (default off) and falls back
      automatically when unreachable. **DECIDED 2026-06-22 (user): flip default-ON now** (auto-start the
      `core-py` sidecar, still auto-fallback when unreachable) **and surface health in Settings** (running, model
      loaded, port). Bundle/package the sidecar so automatic startup is reliable; degrade cleanly if it can't
      start.

### 5.I — Newly raised in chat (2026-06-22) — spec'd, not yet built
- [x] **#1 — Built-in llama.cpp code-embedding model (auto-download, in-process, batteries-included)** *(2026-06-22)*.
      **Shipped (user chose nomic-embed-text-v1.5 via the Python core):** the Python core embeds via an in-process
      quantized GGUF (`llama-cpp-python`, `embedding=True`) on `/v1/embed` with a host-provided `gguf_path` + a
      CPU-thread cap, caches it across batches, and frees it via `/v1/embed/unload`. A host-side download manager
      ([src/nklein-sdk/nklein-embedding-model-manager.ts](src/nklein-sdk/nklein-embedding-model-manager.ts)) streams
      the GGUF to the runtime home with progress + integrity/version checks (the one sanctioned, explicit fetch). A
      `local_gguf` code-embedding provider ([src/nklein-sdk/nklein-code-embeddings.ts](src/nklein-sdk/nklein-code-embeddings.ts))
      lazily ensures the model once, embeds through the core, and degrades to `local_lexical` on any failure;
      `local_gguf` is now the default in `runtimeCodeEmbeddingProviderSchema` but only activates the dense path when
      the Python core is enabled. The Code-intelligence panel surfaces model/download/idle status.
      **Remaining (small, follow-ups):** a real idle-unload *timer* on the host calling `/v1/embed/unload` (the
      endpoint + lazy-load exist; auto-trigger on cache-key change is not yet a background scheduler), a verified
      `sha256` in the default manifest, and an in-panel model-override picker. The min-spec fallback decision
      (dedicated GGUF vs main LLM) is resolved: ship the GGUF default, lexical stays the zero-download floor.
      *(Superseded the original "NOT implemented" investigation note below.)*
- [ ] **#1 (original spec, now superseded by the shipped work above; kept for the detailed acceptance intent).**
      *Investigated 2026-06-22: NOT implemented today* — code embeddings are only `local_lexical` (in-process
      lexical hashing, not real semantic) or `openai_compatible` (an external LM Studio/Ollama endpoint the user
      must run themselves); the Python core's `/v1/embed` is lexical-or-`sentence-transformers` and is **not**
      wired as the app's code-embedding provider; `llama_backend.py` is **generation-only** (`complete()`, no
      `embedding=True`, no download).
      **Goal:** a *premium, zero-config* local code-embedding model that works out of the box on **minimum
      hardware**, served via llama.cpp **in-process** — no external model runtime to install or start, no cheap
      disposable shortcuts.
      **Hard requirements (verbatim intent):**
      - **Auto-download** a quantized GGUF on first need; cache under the runtime home; integrity-verify;
        resumable; progress shown in the code-intelligence panel. The download is the one sanctioned fetch
        (respect local-only/no-egress) and must be explicit/visible — never a silent fetch during a sandboxed
        agent run.
      - **Direct connect, NO external model runtime** — embed in-process via llama.cpp (the Python core's own
        `llama-cpp-python` with `embedding=True`, or a TS `node-llama-cpp` binding if we keep it out of the
        sidecar). Must not depend on the user running LM Studio/Ollama.
      - **Small but strong enough for codebase indexing.** Confirm the default with the user — candidates:
        `nomic-embed-text-v1.5` (~137M, code-capable, 8k ctx) for quality, or `bge-small-en-v1.5` /
        `all-MiniLM-L6-v2` (~22–33M, tens-of-MB RAM) for the absolute-minimum-hardware floor. Ship one strong
        default; allow override.
      - **Low RAM + never hogs the machine.** Quantized (Q4/Q8) + mmap; cap CPU threads and run at low priority
        so it never competes with the main LLM; **lazy-load on demand** (load only when there is something to
        index) and **unload after an idle timeout** so it consumes nothing at rest.
      - **Auto-load when there's work.** Trigger model-load + (re)indexing automatically when a project needs it
        (new/changed files, cache-key change), in the background, throttled — must not block or degrade a
        concurrent main-LLM task.
      **Implementation sketch:** add the llama.cpp embedding backend to the Python core (`embeddings.py` +
      `llama_backend.py` with `embedding=True`) + a model-download/cache manager mirroring the existing ONNX
      compression-scorer download manager
      ([src/nklein-sdk/nklein-compression-model-manager.ts](src/nklein-sdk/nklein-compression-model-manager.ts));
      expose on `/v1/embed`; route the app's code-embedding path
      ([src/nklein-sdk/nklein-code-embeddings.ts](src/nklein-sdk/nklein-code-embeddings.ts)) through the Python
      core; add a `local_gguf` option to `runtimeCodeEmbeddingProviderSchema`
      ([src/core/api-contract.ts](src/core/api-contract.ts)) as the **new default**, with `local_lexical`
      staying the honest no-download fallback; surface model/download/idle status in the code-intelligence panel
      (which is already project-scoped — §6.13). When an agent is sandboxed, the embedder runs **host-side as
      trusted control-plane** over plan/index data, never inside the agent's data-plane.
      **Fallback (if a dedicated embedder isn't worth it on min-spec):** index with the **main/default local
      LLM** instead — its embedding endpoint if it exposes one, or a pooled/throttled generation-based embedding —
      reusing the same provider plumbing. Decide this only after measuring the small-GGUF path on minimum hardware.
      **Acceptance:** a fresh install with **no LM Studio/Ollama running** indexes a repo end-to-end using the
      auto-downloaded in-process model; RAM stays within a small budget; the model unloads when idle; indexing
      never stalls or degrades a concurrent main-LLM task; `local_lexical` still works with zero download.
      **Confirm with the user:** the default model + quant, the RAM/idle budgets, and sidecar (`llama-cpp-python`)
      vs TS (`node-llama-cpp`) hosting.
- [ ] **#3 — Move per-project overrides out of Global Settings.** Today the global runtime-settings dialog shows
      an "Override for this project" affordance ([web-ui/src/components/runtime-settings-dialog.tsx](web-ui/src/components/runtime-settings-dialog.tsx)
      ~line 3466), which is poor UX (project-scoped state polluting global settings). Move all per-project
      overrides — and any genuinely project-scoped settings that aren't overrides — into a dedicated
      **project settings modal reachable from the project selector** (a button that opens a modal listing every
      project-specific override/setting). Keep global settings strictly global.
- [ ] **#4 — Multiple models per agent role + per-task best-fit model selection** *(raised 2026-06-22; deep
      design, explicitly NOT a quick win — get this right rather than fast).** Today each role (Architect /
      Worker / Reviewer) binds to a single model. **Goal:** let the user assign *more than one* model to a role
      so the swarm can truly run many tasks in parallel, and when several models are available **and free** for a
      role, automatically pick the **best-fit** model for each individual task — favoring the fastest and most
      capable that suits the task (context size, model size, model capabilities). **This needs real reasoning, not
      a greedy heuristic:** we likely must introduce a **task difficulty / complexity / size** estimate (e.g. from
      objective text, expected diff scope, file/context footprint, acceptance-command shape, prior-round history)
      and match it against per-model metrics so a small/fast model takes easy cards while a larger/more-capable
      model is reserved for hard ones — and so we never block on a busy model when a free, adequate one exists.
      **Build on what exists:** the **Model Capability & Speed Registry (MCSR, §6.4)** already tracks per-model
      capability/speed and should be the source of per-model metrics (extend it if metrics are missing rather than
      duplicating); the **parallel local swarm executor (§6.5)** is where free-vs-busy model accounting and
      assignment live; role→model config is where the one-to-many binding changes. Respect the prime directives
      (local-only; ≥32k context floor — never select a model that can't hold the task's budget).
      **User override (required):** the user must be able to override the **model-selection priorities** — e.g.
      pin a model to a role, set a preference ordering, or weight speed-vs-capability — so the automatic best-fit
      is a smart default, never a cage. **Acceptance intent:** with ≥2 free models on a role and a mix of
      easy/hard cards, easy cards land on the fast/small model and hard cards on the capable one; no card waits on
      a busy model when a suitable free one exists; user priority overrides are honored end-to-end; selection
      reasoning is inspectable (why this model for this task). **DECIDED 2026-06-22 (user):** default selection
      = **estimate task difficulty → match to MCSR capability/speed, capability-weighted** (prefer the most
      capable free model that fits the ≥32k/context budget; speed is the tiebreaker, and easy cards still take a
      fast/small model). Difficulty signals: objective text length/complexity, expected file/context footprint,
      acceptance-command shape, and prior-round bounce history. User can override the selection priorities
      (pin/prefer/weight speed-vs-capability) per role.
- [ ] **#5 — Universal hover tooltips across the UI (name + short description for every element).** **Goal:** the
      user can always discover what any UI element is by hovering — every meaningful control, button, icon, field,
      badge, panel header, and status indicator shows a tooltip containing the element's **name** and a **short,
      comprehensive description** of what it is / does, so details are always one hover away. Use the existing
      `Tooltip` primitive ([web-ui/src/components/ui/tooltip.tsx](web-ui/src/components/ui/tooltip.tsx)) per
      AGENTS.md (Radix-backed) rather than ad-hoc `title=` attributes, so styling and accessibility stay
      consistent. Prefer a single source of truth for the copy (a name+description map keyed per element) over
      scattering strings, to keep it maintainable and reviewable. Cover icon-only buttons first (highest
      discoverability win), then fields/badges/headers; ensure tooltips are keyboard/focus-accessible, not
      mouse-only. **Acceptance:** hovering (or focusing) any interactive element across the main board, cards,
      drawers, settings, and project surfaces shows a name + concise description; no meaningful control is left
      unexplained; tooltips don't obscure the element or trap focus.
      **Progress:** the `ELEMENT_TOOLTIPS` registry + `ElementTooltip` primitive are in place (§6.13). Wired so
      far *(2026-06-23)*: top-bar icon buttons; board-column (start-all/clear-trash); board-card
      (resume/pause/start/replay); card-detail controls (reject-artifact, collapse-expanded-diff,
      toggle-split-diff); **swarm cockpit (concurrency cap, pause/resume swarm, code-intelligence chip)**;
      **git-history "Discard all changes"**; **terminal "Close"**. This covers the high-value icon-only controls
      across the main board + card + cockpit surfaces. **Remaining (lower-value tail):** labeled tabs/buttons (most
      already self-describing), settings-dialog section headers/fields, model-registry per-row actions (Save/Clear,
      already labeled), project sidebar, and the §5.M chat surface controls.

### 5.K — Second-opinion reviewer workflow *(active; raised 2026-06-22)*
> **Goal (user):** every worker card gets a real second-opinion review from the **reviewer role** (a potentially
> different local LLM), just like a good human dev team. Bouncing back with added insight/feedback is a *normal*
> part of the flow; a clean confirmation from a second perspective is itself valuable. Today the "reviewer" role
> exists in config but **never starts a review session** — `autoReview` is only a *delivery* decision
> (`commit` vs `pr`) + trustworthiness checks, not a peer review. Decisions (2026-06-22): **full loop**; **up to
> 20 rounds** with **stall + identical-loop detection**.
- [x] **Decision core** ([src/core/review-loop.ts](src/core/review-loop.ts)) — pure `decideReviewLoopAction`:
      approve→deliver, request_changes→bounce_to_worker, and **park** on the round limit (default 20), a **stall**
      (worker made no change since the last round), or an **identical loop** (same feedback on unchanged work).
      Fully unit-tested.
- [x] **Reviewer interface** ([src/nklein-sdk/nklein-review-tool.ts](src/nklein-sdk/nklein-review-tool.ts)) —
      a `submit_review` tool (the reviewer's structured output, like `decompose_project`): `verdict`
      (`approve`/`request_changes`), `summary`, `feedback` (required on changes), optional `insight`. Unit-tested.
- [x] **Orchestration** — when a worker card reaches Review with a real diff, auto-start a **reviewer-role**
      session (reviewer model, fallback to the worker model) seeded with the card objective + diff + acceptance
      result + the `submit_review` tool; on `submit_review`, run `decideReviewLoopAction`. Guard against recursion
      (a reviewer card is not itself reviewed) and skip planning cards. Reuse the sandbox/data-plane isolation.
      **WIRED in the delivery-gating seam** (corrected after live verification — see §6 note): service
      `runSecondOpinionReviewSession` (synthetic `<taskId>::review` session prepared from the result branch,
      reviewer model, await verdict via the tool with a timeout, teardown via `clearTaskSessions` +
      `disposeWorkspace`) is invoked from `finalizeHeadlessAutoReviewTask` (runtime-server) right after the card
      moves to Review and **before** the auto-merge/complete, so the verdict gates delivery: approve → deliver;
      request_changes → bounced back to In Progress (no delivery); park → stays in Review. Gated + fail-safe
      (review error/skip → prior auto-complete behavior). Live: runtime boots clean on it; worker→sandbox→
      result-branch verified end-to-end.
      **Pure core done** ([src/core/review-orchestration.ts](src/core/review-orchestration.ts), unit-tested):
      `shouldReviewCard` gate (enabled + in `review` + not a reviewer/planning card + has a diff),
      `fingerprintReviewArtifact` (stall/identical-loop hashing), `buildReviewSeedPrompt` (objective + acceptance
      summary + prior change request + truncated diff → single `submit_review` call), `buildReviewBouncePrompt`,
      `buildReviewSignOff`, and `resolveReviewTransition` (verdict + round + history → deliver/bounce/park + the
      `ReviewRoundRecord` to persist). **Remaining (live):** start the reviewer session with the review tool
      wired to the verdict handler, then call the transition + apply it (next item) + broadcast.
      **Orchestrator done** ([src/nklein-sdk/nklein-second-opinion-review.ts](src/nklein-sdk/nklein-second-opinion-review.ts),
      unit-tested): `runNKleinSecondOpinionReview` injects all I/O (getCard, getTaskDiff, runReviewSession,
      onDeliver/onBounce/onPark) like the acceptance auto-repair, so the gate→diff→verdict→transition→persist flow
      is tested with mocks. **Live adapters started:** `getTaskResultBranchDiff` (the worker-diff input, tested) and
      session-runtime `onReviewSubmitted` threading (attaches the `submit_review` tool only for reviewer turns).
      **Now wired live** via `runSecondOpinionReviewSession` + the state-hub runner (see above); needs a local
      model + Docker to exercise end-to-end.
- [x] **Board state + transitions** — track per card: review round, review history (verdict + feedback/work
      fingerprints for stall/identical-loop detection), last reviewer note. `bounce_to_worker` → move the card
      back to In Progress with the feedback as the worker's next turn; `deliver` → proceed to the existing
      commit/PR delivery with the sign-off attached; `park` → needs-attention with the reason.
      **Done:** the card carries an optional `review` object (`runtimeCardReviewSchema`, CRDT-compatible), and
      `runSecondOpinionReviewForTask` ([src/server/second-opinion-review-runner.ts](src/server/second-opinion-review-runner.ts),
      unit-tested) persists the review round via `applyCardReviewToBoard` and, on bounce, moves the card to
      In Progress + re-drives the worker with the feedback. (deliver → ready-for-review/delivery; park → review
      column with parked status surfaced on the card.)
- [x] **Settings + UI** — a setting to enable second-opinion review (default **on**) with the round cap; surface
      the reviewer's verdict/summary/feedback/insight and the round number on the card (Watch/diagnostics), so the
      second perspective is visible even on a clean approve.
      **Config done:** `secondOpinionReviewEnabled` (default on) + `reviewMaxRounds` (default 20) round-trip through
      `runtime-config.ts` (load/normalize/persist/update + change-detection), unit-tested. **Settings toggle done:**
      Settings → Tasks has a "Second-opinion review of completed cards" switch wired to the config (threaded through
      the dialog's state/dirty-check/save). **Card display done:** the card detail view shows a Second-opinion
      review panel (status + round + summary/requested-changes/sign-off/parked-reason) when a card has review state
      ([web-ui/src/components/card-detail-view.tsx](web-ui/src/components/card-detail-view.tsx)). **Round-cap input
      done (2026-06-23):** Settings → Tasks now has a **Max review rounds** number input (default 20, disabled when
      review is off) threaded through the dialog's state/init/dirty-check/save like the toggle — §5.K complete.

### 5.L — Per-role capability rulesets + agent web/browser access *(active; raised + decided 2026-06-22)*
> **Goal (user):** unleash the swarm by giving agents real capabilities (incl. web/browser access for the
> domain-knowledge the spec demands), governed by **per-agent-role rulesets** in global settings. Today the
> `nklein-web-research-tool.ts` is parked because the sandbox runs `--network none`. **All decisions below are
> FINAL (user, 2026-06-22).**
> **HARD INVARIANTS — unchanged at every tier (never violated by any ruleset):** Docker isolation stays mandatory
> and fail-closed (prime directive #2) — tiers NEVER run agents on the host; `--cap-drop ALL`, `no-new-privileges`,
> read-only rootfs, project mounts read-only all stay. Cloud-LLM lockdown stays absolute (prime directive #1) —
> "open" grants web/data egress + tools, **never** a cloud/paid model provider. ≥32k context floor stays.
- [ ] **Capability tiers (5, monotonic), all inside the mandatory sandbox.** `strict` (network none, no web,
      no browser, no MCP) → `less_strict` (network none, MCP local-only) → `medium` (domain-allowlist egress,
      web research on, no browser) → `more_open` (full internet, web + headless browser, MCP) → `fully_open`
      (full internet, all tools, new tools auto-enabled). **Default preset = `fully_open`.**
- [ ] **Delivery-autonomy tiers (5, SEPARATE parallel dial — user: "its own trait of rules").** `strict`
      (manual commit/PR/merge) → `less_strict` (auto-commit to task branch) → `medium` (auto-commit + auto-open
      PR, manual merge) → `more_open` (auto-merge when review ✓ AND regression delta ≤0; self-merge on null delta
      blocked) → `fully_open` (auto-merge incl. self-merge on green gates). **Default = `fully_open`** (turns on
      `nklein-trusted-auto-merge` self-merge — wire the gates carefully). Keep separate from the capability dial.
- [ ] **Granularity:** one **global preset** as baseline (default fully_open) + **per-role override**
      (Architect/Worker/Reviewer) for BOTH dials. Schema in `src/core/api-contract.ts`; persisted in runtime
      settings.
- [x] **Pure core** (`src/core/agent-rulesets.ts`): both tier enums + capability/delivery matrices +
      `resolveEffectiveAgentRuleset`/`resolveAgentToolAccess`/`sandboxNetworkHasEgress`. Unit-tested.
- [x] **Schema + config** : `agentRulesetsConfigSchema` in `api-contract.ts`; `agentRulesets` loads/exposes/
      preserves through `runtime-config.ts` (default fully_open), round-trip tested.
- [x] **Sandbox wiring + ACTIVATION (VERIFIED LIVE 2026-06-22):** `resolveAgentSandboxNetworkArgs` maps the tier
      to `--network` (full→bridge, none/allowlist→none, allowlist fail-closed); `AgentSandboxManager` applies the
      GLOBAL capability preset's policy to its pool, wired from `runtime-server`. **Verified with the real image:
      `--network none` → fetch blocked, `--network bridge` → HTTP 200, both under `--cap-drop ALL --read-only
      --security-opt no-new-privileges`.** **Remaining:** per-role network override needs policy-keyed pools (a
      pooled container's `--network` is fixed at creation); allowlist needs a real egress proxy.
- [~] **Tool gating:** `resolveAgentToolAccess` (egress-gated) is built + tested. In-sandbox agents already have
      egress via the activation above. **Remaining (lower value, host-egress):** thread tool access into
      `nklein-session-runtime` to drive the host-side `nklein-web-research-tool` enable; a sandbox-side headless
      browser tool; MCP gating. Env supports verifying these live (Docker + LM Studio + runtime all present).
- [~] **Delivery gate:** `decideDeliveryAction` core built + tested (tier × gates → commit/PR/merge/self-merge).
      **DECISION (user, 2026-06-23): self-merge is ALLOWED.** This resolves the old §5.J "self-merge stays off"
      tension — self-merge is on at the open tiers, and the user can adapt it in **global settings, per project,
      and per card**. **WIRED (core):** `finalizeHeadlessAutoReviewTask` resolves the delivery policy
      (`resolveEffectiveAgentRuleset(...).delivery`) and calls `decideDeliveryAction` before auto-merging — gates:
      review-approved (true here since review didn't bounce/park), tests (acceptance ran upstream), protected-path
      (via `isTrustedAutoMergeProtectedPath` over the result-branch changed files), regression (null for now). Only
      `merge` proceeds to the auto-merge; `manual`/`commit`/`open_pr` hold the card in Review with the reason logged.
      Default `fully_open` → merge (incl. self-merge); a protected-path change holds. **Remaining:** (1) auto-perform
      `commit`-to-branch / `open_pr` (today they hold in Review); (2) a measured **regression delta**; (3)
      **per-project + per-card** delivery-tier overrides (config plumbing + UI) on top of the global preset.
- [ ] **Settings UI + config write-path:** global preset picker + per-role tier overrides for both dials (default
      fully_open), + thread `agentRulesets` through `updateRuntimeConfig`/`updateGlobalRuntimeConfig` so the UI can
      save tier changes (read/preserve already work). Make clear Docker isolation + cloud lockdown never relax.

### 5.M — Decoupled agentic coding chat mode + private Signal bridge *(raised + decided 2026-06-22)*
> **Goal (user):** a board-independent **agentic coding chat** — a strong coding agent on par with Claude /
> Codex / Cline (real coding tasks, not just chat), runnable on small local models (qwen3.5-9b and smaller)
> through sophisticated memory management, reachable privately from the user's own phone via a messenger, and
> able to work on the host **only** under explicit user authorization. **Decisions (FINAL 2026-06-22):**
> messenger = **Signal via signal-cli** (linked device, local, private); chat agent = **reuse the NKlein agent
> core + full tool suite** with a new decoupled session/UI; memory = **vector store of the whole conversation +
> human-like short/long-term memory** (long-term "wakes up" on associated topics); execution access = **three
> user-selectable modes** (below).
> **PRIME-DIRECTIVE NOTE:** directive #2 (Docker isolation mandatory/fail-closed, no host execution) continues to
> govern the **autonomous card swarm unchanged**. The chat mode is a **separate, user-driven** surface where the
> user may authorize host access. Host access is NEVER default, always explicit, always logged, and the autonomous
> swarm never gains it. Cloud-LLM lockdown (#1) and ≥32k floor still apply everywhere.
> **DIRECTION (user, 2026-06-23 — agreed):** build **ONE unified agent**, not separate surfaces — the existing
> kanban (home) agent folds into it (likely just a selectable **scope/role**, not its own UI; avoid bloating with
> multiple ways to chat). The single chat session is configured by **selectable "targeted use-case" presets**
> (scope/role/tools) the user turns on per session. **Session scope = "both and more":** workspace-scoped AND
> global/cross-project AND a **full host-access mode**, etc. (the §5.M execution modes become selectable session
> modes). **Messenger routing = one session per thread.** **Messenger scope:** Signal first (signal-cli), then
> **WhatsApp** once the base works + is polished; transport-agnostic bridge so both (and more later) plug in.
> **Use-case presets — SELECTED (user, 2026-06-23):** base always-on = coding + board operation. **Access scopes:**
> (1) project-sandboxed coder (default), (2) all-loaded-projects pilot, (3) host-access power session (typed-confirm,
> logged). [Mobile is a *transport*, not a scope — the bridge routes to sessions regardless.] **Roles:**
> planner/architect (can spin board cards via decompose_project), reviewer (reuse §5.K), debugger/incident,
> researcher (web/browser per §5.L tiers), and **system operator** — a host-level persona that analyzes machine
> issues, optimizes/configures "things", and can drive apps/tools (pairs with the host-access scope; gated behind
> the typed host-mode confirmation; always logged; the autonomous swarm never gets it). Presets compose scope ×
> role; build the unified agent so a session turns these on/off.
- [ ] **Chat session model & store (decoupled from the board).** Board-independent chat sessions with persisted
      transcripts and stable ids; **multiple concurrent sessions**; not represented as kanban cards. New session
      store + lifecycle, separate from the task/board state.
- [ ] **Chat agent runtime (reuse NKlein core).** An interactive multi-turn chat loop built on the existing NKlein
      agent core + tool suite (read/edit/search/run, retrieval, etc.) and provider plumbing, so it has real coding
      capability. New chat entry point + streaming; board-independent.
- [ ] **Multimodal I/O, capability-gated.** Support multimodal **input** (images, and other modalities a model
      accepts — e.g. audio/PDF) when the selected model advertises that capability, and multimodal **output**
      when the model can produce it. Drive this off the model's declared capabilities (MCSR / provider model
      metadata), degrade gracefully to text-only when unsupported, and expose the supported modalities in the chat
      UI + over the Signal bridge (which itself carries images/attachments).
- [ ] **Execution-access modes (3, user-controlled; default = most isolated).** (a) **Docker-isolated** with
      read-only — and, only if the user explicitly enables it, write — access to **explicitly user-mounted files/
      folders** (nothing else reachable); (b) **sandbox-by-default + double-confirmed per-action host escape hatch**
      (each individual host command/edit needs a fresh confirmation and is audit-logged); (c) **host-mode toggle**
      that runs the agent directly on the host for the session, gated behind an **explicitly typed** confirmation
      phrase. All host access is logged; none is ever the default.
- [ ] **Memory system — human-like short/long-term (the hard part).** Embed every turn into a local vector store
      (reuse the in-process code-embedding model). **Short-term** = small live window (so small models sustain very
      long sessions) kept lean via rolling summarization/consolidation; **long-term** = persisted memories that are
      semantically **recalled ("woken up") when associated/similar topics arise** and surfaced back into context.
      Consolidate short→long-term over time. **Multi-session memory scope:** each session is **isolated by default**;
      user opt-in to **shared memory across sessions**; user opt-in to let a session **access all !Klein-loaded
      projects** (filesystem, branches, logs — everything) as retrievable context. Must stay within the ≥32k floor
      and degrade gracefully when the embedding backend is the lexical fallback.
- [ ] **Private Signal bridge.** Link the running instance as a Signal **linked device** via `signal-cli` (pair by
      QR from the user's phone). **Only the paired user** can interact (hard access control — reject all other
      senders); inbound messages route to a chat session and replies go back over Signal. Local, no cloud broker.
      Transport-agnostic bridge interface so WhatsApp/Telegram could be added later, Signal first.
- [ ] **Chat UI (web-ui, separate surface).** A chat surface distinct from the board: session list, transcript,
      streaming, the execution-mode selector, and the memory-scope toggles (shared-memory, project-access). Surface
      the Signal pairing/status. Tooltips per §5.L-style.
- [ ] **Safety, permissions & audit.** The per-action and typed host confirmations, an audit log of every host
      action, and the Signal access-control are first-class and tested. No host action without the user's explicit
      (double / typed) confirmation; the autonomous swarm path can never reach these host capabilities.
- [ ] **Settable session goal (like Codex — user: "they hit the nail with this").** Let the user set an explicit
      **goal/objective** for a chat session that the agent keeps in focus and works toward across turns (persisted
      with the session, editable, shown in the UI + over the Signal bridge). It anchors the agent's planning
      (pairs naturally with the §5.N focus chain — the goal is the chain's north star) and is surfaced back so the
      user always sees what the agent is driving at. Codex's goal UX is the bar to match.
- [ ] **Steering messages (mid-task course-correction).** Let the user send a message **while the agent is
      working** that adjusts/redirects without cancelling the turn — the agent folds the steer into its current
      work (re-prioritize, add a constraint, correct course) rather than dropping everything. Distinct from a
      normal next-turn message: it lands mid-flight. Wire through the chat UI and the Signal bridge; reuse the
      SDK's steering/queue delivery semantics where available (the session runtime already exposes a
      `"queue" | "steer"` delivery mode on `sendTaskSessionInput`). Match the ergonomics users like in Codex/Cline.

### 5.N — Per-agent focus chains (self-directed task checklists) *(raised 2026-06-22)*
> **Goal (user):** give **every** agent a *focus chain* — an agent-authored, ordered checklist it creates at the
> **start of each task** and then works through step by step, like the latest Cline bot and similar agents. It
> keeps a (small) model on-task across long runs, makes the plan-of-attack and live progress legible to the user,
> and survives turn/compaction boundaries. Applies to **all roles** (Architect/planning, Worker, Reviewer), the
> **native kanban agent**, and the planned **chat agents** (§5.M). Needs a **nice visual representation — a todo
> list** (checklist with done / in-progress / pending), not just text in the transcript.
> **Distinction:** this is *intra-task* self-direction (the agent's own steps for one card/turn-loop), distinct
> from `decompose_project` (which splits a project into multiple **board cards**). A focus chain lives inside a
> single task/chat session.
- [~] **Focus-chain model & store.** A persisted, ordered list of steps per task (and per chat session) — each
      step has text + status (`pending`/`in_progress`/`done`, maybe `skipped`) + ordering. Persist it (board card
      field and/or a sibling store) so it survives turns, restarts, and context compaction, and round-trips in the
      workspace state contract. Keep it cheap (small models, ≥32k floor).
      **Done:** pure core ([src/core/focus-chain.ts](src/core/focus-chain.ts)) — `normalizeFocusChain` (trim/clamp,
      drop empties, coerce status, cap 30 steps), `summarizeFocusChain`, `formatFocusChainForPrompt`; +
      `runtimeFocusChainSchema` on the card (`focusChain?`), unit-tested. **Remaining:** per-chat-session store
      (§5.M) + CRDT round-trip check (additive optional field, same as `review`).
- [x] **Agent tool to create/update the chain.** A structured tool (à la `decompose_project` / `submit_review`)
      the agent calls to **create** the chain at task start and **update** it as it works (check off a step, add /
      reorder / revise steps, mark the current one in-progress). Reuse the relaxed-input-schema + short-directive
      error handling proven for the other NKlein tools so small models use it reliably. Consider a re-prompt nudge
      (like decomposition) if a task starts without one.
      **Done:** `update_focus_chain` ([src/nklein-sdk/nklein-focus-chain-tool.ts](src/nklein-sdk/nklein-focus-chain-tool.ts))
      — full-list re-emit shape (small-model-reliable), normalizes via the core, fires an `onUpdated` handler,
      unit-tested. **Remaining:** attach it in the session runtime (like the decompose/review tools) + the
      re-prompt nudge.
- [~] **Wire into every agent surface.** Seed the create-a-focus-chain expectation into the per-task system/seed
      prompts for **Architect, Worker, Reviewer**, the **native kanban agent**, and the **chat agents** (§5.M).
      Each begins a task by drafting its chain, then works it; the reviewer can also check whether the worker
      actually followed/owned its chain. Cohere with the existing efficiency/brevity rules.
      **Done (board agents):** a "Focus Chain" rule pack in `buildKanbanEfficiencyRules` (applied to every task),
      `update_focus_chain` attached in the session runtime (when a persist handler is wired), and the state hub
      persists each update onto `card.focusChain` + broadcasts. **Remaining:** chat-agent surface (§5.M) + an
      optional re-prompt nudge if a task runs without drafting a chain.
- [~] **Visual representation (todo list).** A clear checklist UI: on the card detail / Watch panel for board
      tasks (live updates as steps flip to done), and in the chat surface for chat agents. Use the design-system
      checklist styling (done/in-progress/pending states), with per-control tooltips (§5.L-style). Should read at a
      glance like a todo list, updating in real time.
      **Done (board):** a `FocusChainPanel` in the card detail view renders `card.focusChain` as a todo list
      (✓/▸/○/– marks + x/total), threaded through the web-ui `BoardCard` type + board-state normalizer.
      **Remaining:** the chat surface (§5.M).
- [ ] **Reference & parity.** Mirror the ergonomics of Cline's "focus chain" / markdown task-list and comparable
      agent todo lists (Claude Code / Cursor): the agent maintains and visibly works through the list; the user can
      follow progress and (later, optional) nudge/edit it.
- [~] **More focus-chain ideas (user: "maybe even more ideas, lets rock this").** **Done 2026-06-23:** the
      reviewer (§5.K) now checks whether the worker followed/owned its chain — `buildReviewSeedPrompt` includes the
      worker's `formatFocusChainForPrompt(card.focusChain)` under "Worker's focus chain" and instructs the reviewer
      to flag unfinished/skipped steps or done-steps that don't match the diff (unit-tested; wired via the live
      review runner). **Also done 2026-06-23:** re-anchor the chain into the model's context on long runs / after
      compaction — `reanchorFocusChainMessages` ([src/nklein-sdk/nklein-focus-chain-rail.ts](src/nklein-sdk/nklein-focus-chain-rail.ts))
      re-projects the latest chain (captured per session when `update_focus_chain` fires) into every model request
      via the `beforeModel` hook, stripping any stale rail so it never stacks or goes out of date (unit-tested,
      fail-safe no-op when there's no chain). **Still open:** user can view/edit/reorder/add steps from the UI;
      per-step timing/telemetry; carry the chain into the run summary; let a step link to the file(s)/card(s) it
      touched; chat-agent surface (§5.M).

### 5.O — Robustness sweeps: harden across model sizes / families / quants + parallelism *(raised 2026-06-23)*
> **Goal (user):** make !Klein robust on **as many small local LLMs as possible** (low weight quant — at least
> down to 4-bit, lower if models exist — and low **K/V-cache** quant, e.g. q8 / q5.1 which stay strong but very
> memory-efficient) AND optimized for the **large** models we can now run — "successful and efficient on any kind
> of model that gets connected." The method is evidence-driven: the user makes models available, we **sweep the
> dev-test projects across configs, collect evidence, and harden** !Klein against the common failure modes that
> surface. Also harden for **parallel multi-agent** work with dev-test projects that genuinely exercise + benefit
> from parallelism. **Phase note (user):** we're still "punching through" the early phase; the heavy sweep
> automation is designed/built **when we start the sweeps** — discuss then.
- [ ] **Model-matrix robustness (small → large).** Sweep representative models across **size × family × weight
      quant (≤4-bit and lower) × K/V-cache quant (q8/q5.1/…) × context window**, run the dev-test presets, and use
      `collect evidence` to catalog the failure taxonomy per config (tool-call malformation, no-tool-call stalls,
      structured-output misses like decompose/submit_review/update_focus_chain, context-overflow, host
      crash/unload under memory pressure, reasoning runaways). Feed findings back into guardrails/prompts/budgets so
      a given config "just works." Equally: ensure **large** models run efficiently (no needless small-model
      hedging when the model is capable). Capability-tier the hardening off the live model, not catalog defaults.
- [ ] **Parallel multi-agent dev-test coverage.** Define a small set of dev-test projects whose DAGs **fan out
      widely** (many independent implementation cards with a few join points) so parallel execution is both
      exercised and clearly beneficial — to harden the swarm executor, sandbox pool, result-branch merges, and the
      §5.K review/§5.L delivery flow under real concurrency. Cover the spread: a wide-fan-out feature build, a
      deep-dependency chain, a mixed DAG, and a "lots of tiny cards" stress case.
- [ ] **Autonomous sweep tooling (designed when we start sweeps).** An efficient way to sweep configs **with as
      little cloud-agent involvement as possible** (there are long waits): build on the existing `nklein dev
      test-project` + `collect evidence` + `cleanup-report`, adding orchestration that iterates the model/quant/
      config matrix unattended, captures evidence per run, and summarizes outcomes — living in the Developer Tools
      section or as side-helper tooling. **Discuss the exact shape together when we begin the sweeps.**

### 5.Q — Model telemetry & performance-stats consistency *(raised 2026-06-23)*
> **Goal (user):** verify and fix the **model telemetry / performance-stats collection**. The user saw the **same
> model listed multiple times** in the stats — these must be **consistent, global** per-model stats. **Phase note
> (user):** clarify the exact details together once we pick this up. This underpins §5.O (evidence-driven sweeps
> rely on trustworthy per-model/per-config stats) and the shipped stats view (§6.6).
- [ ] **Audit the stats pipeline for model-identity fragmentation.** Find why one model appears as several rows —
      likely an inconsistent **model-identity key** across the telemetry/aggregation path (e.g. provider-prefixed
      vs bare id, casing, a stale/loaded-vs-catalog id, per-endpoint or per-session variance, or quant/context
      variants counted separately). Establish a single **canonical model-identity** used everywhere stats are keyed
      and aggregated, and dedupe/merge existing rows on it so the global view is one consistent entry per model.
- [ ] **Verify global vs per-scope aggregation.** Confirm performance stats aggregate **globally per model** (not
      siloed by workspace/session/run in a way that splits one model), while still allowing intended breakdowns
      (project/role/tool/category/outcome per §6.6). Add coverage for the dedupe/aggregation core. *(Clarify the
      precise desired groupings with the user before building.)*

### 5.J — LATER (deferred by decision)
- LATER: **In-sandbox command operator.** Because !Klein owns the Docker image, ship a small in-image command
  operator that runs shell commands directly with structured stdout/stderr/exit-code/error metadata, typed
  next-step guidance, and clearer UI status than the generic SDK `bash` bridge.
- LATER: **Linux & Windows first-class runtime.** Keep Docker mandatory for every agent shell/FS action. Linux:
  verify Docker availability, sandbox image build/run, endpoint discovery, browser/runtime launch, headless
  file-picker fallback, path handling. Windows (Docker Desktop/WSL): verify path translation, shell/PTY, Git,
  Docker volume/mount semantics, endpoint discovery, browser/runtime launch, packaged app. Must not weaken the
  strict-isolation invariant. *(A dev-only `start.bat` Windows launcher exists.)*
- **PARKED (cloud-dependent; re-enable only when cloud is revisited or a strong local model is proven):**
  `nklein-advisor.ts` (config/log/MCP advisor buttons), `nklein-model-research.ts` (model-freshness research),
  `nklein-team-delegation.ts`/`nklein-team-progress.ts` (native team delegation UI),
  `nklein-web-research-tool.ts` (host web research — also incompatible with `--network none`). These compile as
  parked helpers and render no local-only UI. *(NOTE: `nklein-trusted-auto-merge.ts` self-merge is no longer
  parked — per the 2026-06-23 decision it is ALLOWED and configurable; see §5.L delivery gate.)*

### 5.P — LAST: full Python backend port *(raised 2026-06-23; bottom of the list)*
> **Goal (user, tentative):** port the backend to Python so that **practically no TypeScript remains in the
> backend**. **Status: explicitly the very late / likely final task** — do NOT start until nearly everything else
> is done. The user is **not** locked to a strict "zero TS" target: there may be good reasons to keep some TS
> (web-ui stays TS regardless; some boundaries/SDKs may be cheaper to keep), and we'll go through **a lot of
> clarifying questions** before committing. Rationale for deferring + then doing it fast: porting a **battle-proven
> tool with strong test coverage** is close to a mechanical, well-specified job (the test suite is the spec), so it
> can plausibly be a largely **autonomous overnight** effort once we get there. **Revisit scope when we reach it;**
> for now it just sits at the bottom and we'll know much more by then.
> Open questions to settle then (non-exhaustive): exact TS/Python boundary (does the NKlein SDK boundary, the
> Docker sandbox manager, the tRPC contract, the runtime server all move? what does web-ui talk to?); reuse the
> existing `core-py` FastAPI sidecar as the seed vs. a fresh service; how the strong test suite ports/maps to keep
> it the spec; migration strategy (strangler vs. big-bang); perf/packaging/Docker-delivery implications.

---

## 6. SHIPPED — already implemented (do not rebuild)

> Crossed off. Grouped by area; file pointers in §1.4 / §5 / `AGENTS.md`.

### 6.1 Local-only platform & cloud lockdown
- [x] Single default-deny policy (`LOCAL_PROVIDER_IDS = {ollama, lmstudio, lm-studio}`, `isLocalProvider`/
      `isLocalBaseUrl` for localhost/RFC-1918/CGNAT/`*.local`, managed-OAuth denied, typed
      `CloudProviderDisabledError`), gated at `resolveLaunchConfig`, re-asserted at task start and router/role
      resolution; cloud-pinned cards hard-stop. Catalog/picker/roles/onboarding/settings filter cloud out;
      `normalizeAgentId` clamps persisted cloud ids → `nklein`. Boundary scan test guards the policy file.

### 6.2 Reliability core
- [x] Never-overflow pre-send guard (same source as the context bar; compacts, or a specific "your message is
      larger than the working budget" message). Real effective window = `min(advertised, override, sanity
      ceiling)` (old 200k clamp removed). Local-appropriate timeouts (no 1s bug; generous floors; `unlimited`
      honored; positive timeouts scale up from measured MCSR speed; cold-start pessimistic prior). Error back-off
      / park instead of telemetry storms. Session restart/resume via persisted launch config (no host
      session-map casting). Acceptance gate uses non-login shell / direct exec with streamed buffer.

### 6.3 Context budget visualization
- [x] Per-task `ContextBudgetBreakdown` (system · tool schemas · prompt · file content · history · reserved
      working · reserved output) against the real window; segmented green→gold→orange→red full-width bar in chat
      + compact form on cards; graceful degrade.

### 6.4 Model Capability & Speed Registry (MCSR)
- [x] Per-model capability + measured prefill/decode/TTFT speed (EWMA, fractional, debounced), capability prior
      weighted `1/(1+samples)`, 30-day half-life decay. Effective context-window resolution (advertised/observed/
      override, ≥32k). Chat Model Telemetry panel + Settings with per-model context Save/Clear, zero-sample
      prompt, stale-row prune + per-row delete, shared loaded-model filter.
- [x] *(2026-06-22)* **Loopback endpoint canonicalization** — `localhost`/`127.0.0.1`/`0.0.0.0`/`::1` and
      trailing slashes are normalized in the registry key, so the same local model isn't registered/displayed
      twice (once selected-but-blank, once with telemetry); persisted duplicates merge on load.

### 6.5 Parallel local swarm executor
- [x] `maxConcurrentTasks` enforced across single/batch/dependency/runtime starts; auto-start unblocked cards on
      completion/commit under the cap; per-endpoint serialization with typed `endpoint_busy` + `retryAfterMs` +
      opt-in queued admission; file-overlap-aware scheduling (`filesLikelyTouched`); dependency-ordered
      auto-merge of reviewed worktrees (conflicts spawn a Planning integration card); shared decision blackboard
      (`decisions.md`); per-model tool routing; swarm guardrails (turn/wall-time budgets, no-diff + repeated-tool
      watchdogs, 12-card batch budget, workspace Pause/Resume stop signal) — surfaced in Settings.

### 6.6 Autonomous decomposition & planning
- [x] `decompose_project` / `expand_task` with sizing-contract + graph/reference validation; recursive bounded
      expand to terminal leaves with connected-local-model fit guard; plan artifacts under
      `<project>/.nklein/nklein/plans/<slug>/` (`spec.md`, `plan.md`, `tasks.json`, `questions.md`, `summary.md`,
      `decisions.md`, `revisions.md`, idempotent apply); cards land in Planning and flow into execution;
      naive-idea → clarifying questions (option chips) → reviewable plain-language plan; adaptive re-planning on
      `plan-gap` events.
- [x] **Dependency-coherence validation + deep-domain aids** *(2026-06-21)*: graph-quality checks reject
      incoherent DAGs (free-floating test/docs cards), warn on sparse/isolated/reversed/UI-without-domain graphs;
      generated cards carry `knowledgeDebt`; the `kanban-decompose` workflow mandates a knowledge-acquisition +
      "under-decomposed by 10x/100x?" scope-pressure pass. ([src/nklein-sdk/nklein-decomposition-graph-quality.ts](src/nklein-sdk/nklein-decomposition-graph-quality.ts))
- [x] **Works under strict isolation** *(restored 2026-06-19)*: decomposition tools are trusted control-plane
      (mutate only `~/.nklein/nklein/` artifacts + the board, never the working tree), stay host-side during
      sandboxed planning, with the host workspace root forwarded so artifacts/board resolve to the owning
      workspace. Live-verified: a 1-shot prompt → Planning DAG → started card with isolation ON.
- [x] *(2026-06-22)* **Planning-card start fixes** — the Start (play) button now works on Planning cards, a
      plan-mode card starts in place without dropping the kickoff, dragging Planning→In Progress launches an
      approved act-mode card, and "Approve for execution" launches the task when none is running.

### 6.7 Codebase intelligence
- [x] TypeScript-AST + PageRank repo map (lexical fallback), personalization boosts, invalidated after mutating
      tools. Code index with provider/model-separated dense vectors, `local_lexical` honest fallback,
      OpenAI-compatible local embedding endpoints, hybrid lexical+semantic+repo-map search, cache GC. Settings
      Code-intelligence panel + board chip; global + per-project embedding overrides. Knowledge/tool-usage JSONL
      telemetry aggregated by project/version/model/role/tool/category/outcome, shown in the stats view.
- [~] Knowledge-expansion loop *(started 2026-06-21)*: decomposition mandates knowledge-acquisition +
      scope-pressure and cards record `knowledgeDebt`. **Open:** correlate actual knowledge-tool use into a
      decomposition-quality signal — see §5.B.

### 6.8 Operator UI & observability (swarm cockpit)
- [x] Running cards show role/model, token bar, tok/s, elapsed, current tool, turn count; global swarm header
      (running/waiting/blocked, per-endpoint grouping, concurrency slider, Pause/Resume, code-intel chip); MCSR
      panel; Planning DAG review with fit badges + "Approve for execution" + revised-plan flags; per-card
      diagnostics drawer (telemetry, no LLM); "what !Klein is doing right now" activity surface; first-run
      local-model setup wizard; progressive disclosure + feature-visibility coverage matrix; statistics view
      (model performance + knowledge-tool usage).
- [x] *(2026-06-21)* **OpenHands-style "watch the agent's hands"** per-card **Watch** tab: live
      state/model/elapsed/current-tool, an accumulated activity timeline, the files it is changing this run, and
      a jump to its terminal.
- [ ] **Open:** browser-only live verification of the cockpit + isolation status/pool UI — see §5.A.

### 6.9 Strict Docker agent isolation
- [x] Pinned `nklein/agent-sandbox` image, in-container tool-runner (`/opt/nklein/tool-runner.cjs`),
      `AgentSandboxManager` boundary (docker CLI). Configurable container **pool** (max containers,
      agents-per-container, CPU/RAM, idle timeout, FIFO queue; Shared/Dedicated presets; `--network none`,
      `--cap-drop ALL`, `no-new-privileges`, `--read-only`, tmpfs, per-container named volume, ro project mount).
      Per-task uid + `/workspaces/<taskId>`; clone-in / patch-out via `nklein/tasks/<task>` result branches
      applied host-side with a temp index (`commit-tree`, no host checkout mutation). All host-touching agent
      surfaces routed through the container (default executors, acceptance gate, repo_map/search/file-discovery/
      read_large_file/write_file(s) proxies); local-exec MCP default-denied; `webFetch` disabled under no-egress.
      Fail-closed preflight at start + startup; no-host-execution guard tests; Docker-gated integration tests;
      orphan reaping; killswitch; Settings isolation status + pool controls.
- [x] Live-verified end-to-end (2026-06-19, real LM Studio task in Docker, clean teardown, fail-closed).
- [x] **Classified patch-capture & stall diagnostics** *(2026-06-21)*: typed corrupt-vs-non-applying patch
      classification, failing file/hunk extraction, failing patch preserved under `patch-failures/`, structured
      stream/tool inactivity-timeout card note (last activity/tool, captured?, resume safety).
      ([src/workspace/task-patch-capture-diagnostics.ts](src/workspace/task-patch-capture-diagnostics.ts))
- [ ] **Open:** retire the host worktree subsystem — see §5.A.

### 6.10 Polyglot core, native agent core & local-model SOTA *(postdates the predecessor docs)*
- [x] **Python core sidecar** (`core-py/`, FastAPI, local-only): constrained generation (`/v1/generate`,
      `/v1/generate_structured` — full sampling + grammar/JSON-schema decoding via own `llama-cpp-python` or a
      proxied local OpenAI server), ML services (`/v1/compress` LLMLingua-2-style, `/v1/embed` lexical/
      sentence-transformers, `/v1/repomap` PageRank), native ReAct agent loop (`/v1/agent/run` with
      path-contained tools + aider-style fuzzy edit), decomposition quality (`/v1/decompose/select`
      coherence + best-of-N), reasoning-model fallback (verified vs qwen3.5). Opt-in via `NKLEIN_CORE_PY`
      (default off), auto-fallback when unreachable. `KleinCoreClient` is a drop-in for the local client.
- [x] **TS native agent core** (`src/agent-core/`): constrained tool-calling (ReAct) loop on the !Klein-owned
      local client with stall/loop + max-turn guards and a JSON-schema-constrained action decider.
- [x] **Local-model SOTA helpers:** per-model/role sampling policy (`resolveLocalSamplingOptions`), shared
      JSON-repair (`repairJsonValue`), best-of-N decomposition self-consistency, LLMLingua-2-style selective
      compression (+ ONNX scorer download/update manager), `LocalLlmClient` with full sampling + grammar
      constrained decoding, aider-style `edit_file` fuzzy ladder, `run_command` tool.
- [x] **LM Studio live-only selection fix:** discover loaded models from the live endpoint, fall back to the
      catalog localhost base URL when none saved, auto-select the first loaded model (don't trust stale catalog
      defaults like `openai/gpt-oss-20b`).
- [x] **Audio-VST / psytrance autonomous dev-test preset** (left-sidebar Dev Test Scenarios, same
      create-and-start flow) + DSP benchmark harness (first successful autonomous run recorded). *(Rubric scoring
      still open — §5.B.)*
- [x] **Modern DAW Foundation dev-test preset** *(2026-06-22)* — the maximal stress fixture: a `daw_foundation`
      preset that scaffolds a project from a comprehensive, full-modern-DAW-parity spec
      ([scripts/dev-fixtures/daw-foundation-spec.md](scripts/dev-fixtures/daw-foundation-spec.md) — Ableton/FL/
      Bitwig/Logic/Cubase/Studio One/Reason/Reaper signature workflows, modular environment, MCP control, linked
      multi-window/web, SOTA quality bar) plus a real tested `timebase` seed
      ([scripts/dev-fixtures/daw-foundation/](scripts/dev-fixtures/daw-foundation/)). Scenario uses a new
      `specificationPath` so the full spec is a real file (not crammed into the prompt); the seed prompt is
      realistic ambitious-user voice demanding deep decomposition, explicit knowledge debt, heavy external-
      knowledge fetching, real DSP + golden tests, and a release-quality SOTA bar. Intended to push 9B local
      models to their limits and showcase 120B+ models. *(Domain rubric scoring still open — §5.B.)*
- [x] **`THIRD_PARTY_NOTICES.md`** documenting re-implementation-with-attribution of ecosystem techniques
      (aider, Roo Code, Continue — Apache-2.0; OpenHands — MIT), excluding AGPL-3.0 to keep !Klein Apache-2.0.

### 6.11 Runtime control, chat UX, self-improvement, security, portability baseline
- [x] Board pause halts the agent loop at the per-turn checkpoint (`"paused"` park state; auto-resume; gates
      sandbox executors + acceptance gate); per-card pause/resume (`paused-tasks.json`, tRPC, board toggle);
      finished-card Replay (`replayCardsEnabled`, default off, confirm-gated, destructive reset); per-message
      chat timestamps + full-width context bar.
- [x] Self-observation telemetry sink (path-redacted, secret-pattern-broadened, rotation); evidence bundle +
      one-click "Create evidence"; gated "Create !Klein self-improvement project"; dogfood backlog engine
      (sizing-clamped); smoke-eval harness (local roster); evidence/diff drawer; ⌘K palette; developer surfaces
      behind a persistent **Developer Mode** toggle. **Protected test suite** (`test/protected/`, 9 files / 79
      tests, `npm run test:protected`) + `agent-write-guard` (protected-path + secret-write block, structured
      approval surfaced in chat, audited) — strict-isolation guards included in the manifest (human-approved).
- [x] Electron hardening (contextIsolation, no nodeIntegration, sandbox, webSecurity, deny-by-default popups,
      same-origin nav, CSP fallback, packaged devtools off; runtime bound to `127.0.0.1`; hardened
      Set-Cookie/session token; secret scanning in the agent-write path). Workspace-identity hardening
      (explicit-only registration, self-project confirmation surviving removal, task-worktree→owning-workspace
      resolution, accidental-project repair, board-vs-runtime persistence split, board-save conflict
      rebase/retry). Add-Project UX (one controlled dialog; Existing-Folder + New-Folder flows). Guidance skills
      (`security`/`ui`/`ts`) as on-demand `/nklein-*` workflows.
- [~] **Project portability baseline:** runtime-home stays the fast local index/cache, but board state, session
      summaries, revision metadata, and workspace identity mirror into `<project>/.nklein/nklein/workspace/` and
      can recover from that mirror. **Full portable CRDT state** (per-field LWW board CRDT
      [src/state/portable-board-crdt.ts](src/state/portable-board-crdt.ts), committed store
      [src/state/portable-board-store.ts](src/state/portable-board-store.ts), export/import with machine-local
      `nkleinSettings` stripped on import, live wiring into save/load, card-trash tombstones, per-machine
      `replica-id`, cross-machine-recovery integration test) is shipped. **Open:** schema migration + browser
      verify — see §5.F.

### 6.12 SDK vendoring & repo integration *(2026-06-22)*
- [x] The agent SDK is vendored fully in-repo under `vendor/nklein-sdk/{core,agents,llms,shared}` (committed
      dist), the daemon/branding rebrand applied, and the `@nklein/*` external-package wrapper removed in favor
      of in-repo path aliases (`scripts/nklein-sdk-alias.mjs` for vitest/esbuild, `tsconfig` paths for tsc/tsx),
      with the SDK's runtime deps hoisted to the root manifest. The SDK is now repo-owned and editable.
- [x] **Hub-daemon crash fix:** the SDK session host runs on the in-process `local` backend, so the SDK's broken
      cron/automation hub daemon (an upstream defect) is never spawned. !Klein doesn't use scheduled-agent
      features.

### 6.13 Recovery, artifact application, review actions, settings clarity & diagnostics *(follow-up-2 hardening)*
> These distinct shipped features were under-represented in earlier passes of this doc; itemized here so they're
> not mistaken for open work or rebuilt.
- [x] **Lost-session recovery.** Heartbeat-`lost` sessions are detected and parked into a needs-attention /
      review-style state when useful output/artifacts exist, exposing **Resume / Mark interrupted / Apply pending
      artifacts** actions, preserving transcript + artifact refs, and showing a human-readable reason on the card.
      A **lost-heartbeat policy** setting chooses **Park + Actions** (default) vs **Keep running** for manual
      operators. *(Confirmed live: the captured task config carries `lostHeartbeatPolicy: "park"`.)*
- [x] **Decomposition artifact application & review.** Generated graphs are **workspace-owned artifacts**
      (artifact id, owning workspace id, source-task provenance, validation status), applied idempotently by
      `{workspaceId, artifactId}` (never by slug/cwd). A global **auto-apply** setting (default on) + a **per-card
      override**; when auto-apply is off, an **inline pending-artifact review** (kind / task count / dependency
      count / validation / timestamp, with **Apply / Reject**) on the source card. Fixed the "chat says 10 tasks
      generated but the parent board has none" accidental-task-worktree bug class, with regression coverage.
- [x] **Auto-review trustworthiness.** Auto-review runs when cards reach Review; if it can't run, or *claims
      success with no commit/PR/branch effect*, the card is flagged with a specific reason + recovery action;
      review-checkpoint capture failures that affect recovery are surfaced (harmless cleanup noise stays out of
      the UI but is recorded).
- [x] **Verify & Merge card actions.** A **Verify** action on Review/Planning cards when an `Acceptance check:`
      line is detected (runs in the right workspace; shows status / output summary / failure reason); a
      Review-lane **Merge** action showing progress, conflicts, skipped tasks, and cleanup status.
- [x] **Settings clarity & safety.** "Effective context" + "Context override" labels with token **units** and
      visually-distinct inherited/default/effective values; full `RuntimeTaskNKleinSettings` exposed with **human
      labels** (context scope, timeouts) instead of raw keys like `requestTimeoutMs`; model-role overrides
      preserve provider/model/reasoning/context-scope/timeout; fixture model ids (`small-local-model`, etc.)
      guarded from leaking into user-facing selectors.
- [x] **Project/workspace health diagnostics.** Checks for accidental worktree projects, missing parent
      workspaces, lost sessions with pending artifacts, and stale never-applied/rejected artifacts — surfaced in
      Developer Tools / a project-health area — plus telemetry for workspace-resolver decisions (explicit id /
      path / parent-worktree / existing-index / rejected auto-registration) and artifact lifecycle events.
- [x] **Code-intelligence is project-scoped.** Moved out of Global Settings into the selected-project sidebar
      panel (indexing status, embedding provider/model, last-indexed, errors; hidden when no project is selected),
      with global default + per-project embedding override. **This is the precedent for §5.I-3** (move the
      remaining per-project overrides off Global Settings).
- [x] **Reliability/robustness/UX details** *(follow-up-1)*: graceful single-oversized-prompt degrade;
      `route_up`/router reason-string accuracy; plain-language park reasons; decomposition DAG **dry-run
      preview**; **test-first decomposition** default for suitable cards; prompt-prefix caching + multi-endpoint
      parallelism nudges + aggressive tool-schema trimming for weak models; app icon/logo; endpoint reachability
      + model discovery.

---

## 7. Success criteria (the bar for "done")
1. Cloud is unreachable; a cloud-pinned card hard-stops; re-enabling is one reviewed code change.
2. No oversized prompt ever leaves; over-budget turns compact or stop.
3. The loop is stable: no 1s timeouts, no restart-config failures, no retry storms.
4. ≥32k enforced everywhere; budgets/compression scale to the local window with no hardcoded constants.
5. A multi-card DAG auto-starts unblocked cards under the cap, serializes per endpoint, parallelizes across
   endpoints, never thrashes the machine.
6. **A single high-level prompt yields a Planning-lane DAG of local-feasible cards that get created and flow
   into execution — with strict isolation ON.** *(DAG-under-isolation + a started card verified; fully-automatic
   unblocked-card swarm start is the remaining end-to-end target.)*
7. Context is a segmented green→red bar against the real effective window.
8. Parallel cards never collide on shared files; result-branches merge in dependency order; runs are budgeted,
   one-click stoppable, stalled tasks auto-park.
9. The board is a live cockpit (per-agent status, MCSR, DAG + fit badges, diagnostics, first-run wizard) — all
   cloud-free.
10. A loose idea triggers clarifying questions, yields a reviewable plain-language plan, adapts on
    execution-discovered gaps.
11. Nothing built since branching from `main` is invisible in the UI (coverage matrix has no unmapped entry).
12. **Every agent shell/FS action runs in Docker; no host fallback; Docker-down fails closed.**
13. Upstream-clean: re-pulling the SDK contracts needs no reverts.

---

## 8. Superseded decisions & direction changes (history — so nothing is lost or re-litigated)

- **Cloud went from "normal option" → banned.** The original `plan.md` targeted 8–16k small models and treated
  cloud as always-available. One day of telemetry showed cloud defaulting to `anthropic/claude-sonnet-4.6` and
  causing 678× "Insufficient balance", 227× "1.1M-token prompt exceeds 1M limit", 227× "1s timeout", 453×
  "No previous session config". Result: **LOCAL ONLY + ≥32k minimum** invariants (§1). All cloud paths are
  hidden/parked, not deleted, so a future single-file re-enable is possible.
- **Host worktrees → Docker clone-in/patch-out.** The early model ran agent tools on host task worktrees. That
  was replaced by **strict Docker isolation** with `nklein/tasks/<task>` result branches applied host-side. The
  worktree subsystem is now legacy and slated for retirement (§5.A); it is NOT dead yet (terminal/CLI agents +
  shell-on-task still reach it), which is why deletion is gated on UI-verifiable changes.
- **Decomposition under isolation was briefly dark, then restored.** For a period, sandboxed planning omitted
  `decompose_project`/`expand_task`. Decision reversed 2026-06-19: they are *trusted control-plane* and stay
  host-side (they touch only plan artifacts + the board). The earlier "produce a plan in chat instead of
  /kanban-decompose" guidance is superseded.
- **Portable-state conflict model = CRDT** (not last-writer-wins-with-manual-rebase). Chosen 2026-06-21; merge
  is automatic, so no manual rebase UI is needed.
- **New direction (postdates the planning chain): grow !Klein's own core.** A local-only Python core sidecar
  (`core-py/`) and a TS native agent core (`src/agent-core/`) now provide ML + native-agent capabilities the
  vendored SDK can't (constrained/grammar decoding, own embeddings/compression/repomap, native ReAct loop). The
  vendored SDK remains one supported runtime, no longer the only one (§5.H, §6.10).
- **SDK is now vendored & de-packaged in-repo** (§6.12) — the `@nkleinbot/*` "never patch node_modules" framing
  from the predecessor docs is updated: the SDK lives under `vendor/nklein-sdk/` and is ours to edit; the
  boundary discipline (`check:nklein-boundary`, `src/nklein-sdk/` plug-ins) still holds for *integration*.
- **Archival sources (folded in, then deleted):** `follow-up-1..4.md` + `findings-from-follow-up-work-4.md` were
  already declared archival by the iteration playbook — their open items live on as §5.A (isolation/worktree)
  and §5.A (UI verification); their shipped items are in §6. `follow-up-5.md`/`follow-up-6.md` open threads are
  §5.A–§5.F. `specsheet.md`/`plan.md` status is reconciled into §6 (shipped) and §5 (open). All are superseded
  by **this file**.

---

## 9. Changelog discipline
`CHANGELOG.md` keeps a running `## [Upcoming]` section, updated **within** the same change as the code (derive
entries from the real diff, not commit subjects). Only open a PR / cut a release when the user asks.
