# Step planning — plan every step in detail, review the plan, replan on divergence, execute one step at a time

David 2026-09-20: *"make nklein have extra planning steps where the steps are planned in every detail before getting
executed .. that shall get a review round .. whenever updates needed, everything properly replanned etc etc .. so
that we get parts where even 9B models can excel because perfect instructions."* Plus, same day: a standard online
fact-check (`lookup`) for the models' weak recall, wired into the planning stage.

Everything here is **default OFF** (`NKLEIN_STEP_PLANNING`, `NKLEIN_LOOKUP`) per §4A's observe-before-enforce
practice. With both flags unset every session is byte-identical to today.

## What already exists (reused, not rebuilt)

| Concern | Existing mechanism | Where |
| --- | --- | --- |
| Card graph planning + critique | `decompose_project` → W4.3 diverse-critic round (`submit_plan_critique`, `::plan-critique`, max 2 candidates/slug) | `src/nklein-agent/nklein-decomposition-tool.ts`, `nklein-plan-critique-tool.ts`, `nklein-plan-critique-runner.ts`, `src/core/plan-critique-decision.ts` |
| Per-card refinement before work | every started card enters `planning`; a work card refines, then `begin_implementation` | `src/core/task-board-mutations.ts` (`STARTED_CARD_ENTRY_LANE`), `nklein-promotion-tool.ts`, `nklein-task-prompt-builders.ts` (`buildNKleinRefinementSystemPrompt`) |
| Solve-in-prose pre-phase for weak models | F12.62 `::architect` bounded session → `submit_implementation_brief` → brief prepended to the worker prompt (`NKLEIN_ARCHITECT_EDITOR`) | `nklein-architect-runner.ts`, `nklein-architect-tool.ts`, `src/core/architect-editor-split.ts` |
| Bounded auxiliary sessions | `SecondarySessionHarness.runBracketed` (sandbox + deadline + teardown), `admissionParentTaskId` cap-1 handoff | `nklein-secondary-session-harness.ts` |
| Tool-level plans | F3.T3 ActionPlan IR (≤6 tool calls, executed by the runtime) | `src/core/action-plan-ir.ts`, `nklein-action-plan-mode.ts` |
| Review → re-work brief | `buildReviewBouncePrompt` (objective + acceptance + prior concerns), `onBounce` re-drive, redecompose rung | `src/core/review-orchestration.ts`, `src/server/second-opinion-review-runner.ts`, `src/core/review-redecompose.ts` |
| Difficulty → capability | F3.41 `requiredCapabilityForCard` / `smallestTierClearing`, `difficultyFacts` on generated cards | `src/core/model-size-tier-capability.ts`, `card-difficulty-facts.ts` |
| Role models | `modelRoles` is an OPEN record (`runtimeModelRolesSchema`), resolved per card at `start-task-session.ts` | `src/core/runtime-config-api-contract.ts`, `src/config/runtime-config-model-roles-resolver.ts` |
| Online retrieval | §5.AC `research` (SearXNG backend), `browse_url` (Playwright, SSRF floor), config-gated, host-side | `nklein-retrieval-tools-builder.ts`, `nklein-browse-tool.ts`, `src/server/web-search-searxng.ts` |
| Egress receipts | F12.99 hash-chained receipts | `src/core/egress-receipt.ts` |

None of these produce a **per-card, per-step instruction set that is reviewed before execution and replanned with
history**: the decompose critique judges card contracts, the architect brief is one prose blob that nobody reviews,
the ActionPlan is a ≤6-tool-call graph, and the refinement pass is the worker deciding for itself.

## What is new

### 1. The detailed step plan (`src/core/step-plan.ts`)
A typed artifact per card: `{ schemaVersion: 1, cardId, revision, baseRef, objective, steps[], history[] }`. Each step
carries `id, title, intent, files[{path, symbol?, change}], commands[], expectedOutcome, acceptance{command?, check},
inputs[], mustNot[], difficulty (trivial|easy|medium|hard), verify?{claim, query}` — everything a small model needs and
nothing it has to discover. `stepCapabilityFloor(step)` maps the step's difficulty + file count onto the F3.41 scale
so routing can send trivial steps to the 9B/Bonsai seats. `validateStepPlan` collects every structural violation in one
pass (empty plan, duplicate ids, absolute/host paths, missing acceptance/outcome, a `verify` without claim+query, more
than `MAX_STEP_PLAN_STEPS`). `renderStepInstruction` renders ONE step as a self-contained worker instruction (with the
must-nots, the acceptance, the lookup mandate when the tool is present). Persisted as JSON under the diagnostic store
(`step-plans/<workspace-hash>/<taskId>.json`, `src/nklein-agent/step-plan-store.ts`).

### 2. The plan-review round (`src/core/step-plan-review.ts`, `nklein-step-plan-review-tool.ts`)
A reviewer session (`<task>::step-plan-review`, strong model) gets the rendered plan and an explicit, testable
checklist — `completeness`, `ambiguity`, `missing_files`, `wrong_assumption`, `unsafe_step`, `acceptance_unprovable`,
`fact_from_memory`, `too_large_for_tier` — and submits `submit_step_plan_review` with `approve` or `revise` + findings
`[{category, stepId?, fix}]`. `decideStepPlanReviewRound` bounds the rounds (`NKLEIN_STEP_PLAN_MAX_REVIEW_ROUNDS`,
default 2): approve ⇒ execute; revise ⇒ the planner gets the findings verbatim and resubmits; rounds exhausted ⇒ the card
falls back to the ordinary (unplanned) worker path and says so in telemetry. The plan is never executed unapproved.

### 3. Replanning with history (`src/core/step-plan-replan.ts`)
Triggers: `step_failed` (acceptance failed after the bounded attempts), `worker_blocked` (the worker reports it cannot
proceed / asks a question), `review_bounce` (the delivery review requested changes), `base_changed` (the card's base ref
moved under the plan), `user_steer` (an operator instruction arrived mid-execution). `buildReplanBrief` folds the trigger
+ evidence + the retained `history` (what was tried, what failed, which steps are DONE and must not be redone) into the
planner's re-prompt; `decideReplan` bounds it (`NKLEIN_STEP_PLAN_MAX_REPLANS`, default 2). Every replan goes through the
review round again; done steps are carried forward, not repeated.

### 4. Execution against the plan (`src/core/step-plan-execution.ts`, `nklein-step-plan-controller.ts`)
Workers get ONE step at a time. The worker's start prompt is step 1's instruction; the `complete_step` control-plane
tool is how a step ends: the harness runs the step's `acceptance.command` in the worker's own sandbox, and the TOOL
RESULT either carries the next step's instruction (accepted), the failure output + "fix and call again" (bounded per
step), or — after the bound — a replanned next step (the planner + reviewer run as awaited children of the worker turn
with the cap-1 admission handoff, exactly like `decompose_project` awaits its critic). A `verify` step is accepted only
when the completion cites a `lookup` receipt recorded for this card. After the last step the result says "deliver"; the
existing capture → review → acceptance rails are untouched. A review bounce re-derives the first pending step (with the
reviewer's feedback as a replan trigger) instead of the generic re-work brief.

### 5. Flags and per-role models
- `NKLEIN_STEP_PLANNING=1` turns the whole stage on (registered `enforcing`, default OFF).
- Planner model: `NKLEIN_STEP_PLANNER_MODEL` env, else `modelRoles.planner` in the runtime config, else the card's routed
  model. Plan reviewer: `NKLEIN_STEP_PLAN_REVIEWER_MODEL`, else `modelRoles.plan_reviewer`, else the lineage-diverse
  escalation pick (`pickDiverseEscalationModel`), else the card's model (self-review, surfaced as a waiver).
- `modelRoles` already accepts any role key, so `planner` / `plan_reviewer` need no schema change; the Settings UI role
  list is extended so they are editable.

### 6. `lookup` — the online fact-check (`nklein-lookup-tool.ts`, `nklein-lookup-client.ts`, `src/core/lookup-*.ts`)
- One tool, two modes: `{ query }` = web search (DuckDuckGo HTML endpoint, no API key, parsed by
  `parseDuckDuckGoHtmlResults`) returning `[{title, url, snippet}]`; `{ url }` = fetch one result page, HTML → text
  (`extractReadableText`), size-capped, SSRF-guarded (same `checkHostForSsrf` floor as `browse_url`), prescreened as
  untrusted content.
- Both requests leave the machine THROUGH the sandbox egress proxy (`HTTPS_PROXY` = the task's proxy URL from the
  existing claim/placement mechanism), so the proxy's allowlist + audit apply; the allowlist gains the lookup hosts
  only while the flag is on (see "Egress changes").
- Receipts: every lookup appends `{ id, kind, url, sha256, bytes, cardId, stepId, at }` to
  `lookup-receipts/<workspace-hash>.jsonl` and caches the body under `lookup-cache/<sha256>`; a repeated lookup of
  the same URL is served from the cache (reproducible re-runs, nothing re-leaves the machine) and still gets a receipt
  marked `cached`.
- Planning wiring: the planner is told to attach a `verify {claim, query}` to any step whose correctness rests on a
  fact (API signature, version, real-world value, library behaviour); the reviewer's checklist bounces
  `fact_from_memory`; every step instruction on a weak seat says *never assert a fact from memory when `lookup` is
  available*. `NKLEIN_LOOKUP=1` attaches the tool to worker AND planner/plan-reviewer sessions (the one deliberate
  exception to "synthetic sessions never get egress": a plan reviewer that cannot look things up cannot catch a fact
  stated from memory).

## Egress changes (all gated on `NKLEIN_LOOKUP`; byte-identical when off)
| Change | Where | Why |
| --- | --- | --- |
| New ecosystem pack `lookup` = `html.duckduckgo.com` | `src/core/sandbox-egress-ecosystems.ts`; appended as `ecosystem:lookup` to the resolved allowlist in `AgentSandboxManager` only while the flag is on | The search leg contacts exactly one host: DuckDuckGo's server-rendered HTML endpoint (no API key, no JavaScript). Result links are unwrapped client-side, so the redirector host is never contacted. |
| Per-task, per-host, time-bounded grants | `src/core/egress-task-grants.ts`; control route `POST /task-grants/issue` (`egress-confirm-control.ts`, client `issueEgressTaskGrant`); the proxy merges a task's live grants into its allowlist only for a request carrying that task's credential (`egress-proxy-server.ts`) | Result pages cannot be pre-listed. A grant is issued by the trusted runtime (never the sandbox or the model), names one host, expires in ≤60 s, and is attributable — the audit record still carries the task id. |
| Worker listener published on host loopback | `egress-proxy-lifecycle.ts` (`publishLookupListener` ⇒ `--publish 127.0.0.1::<worker port>`; availability gains `lookupProxy`) | The lookup client runs host-side but must go THROUGH the proxy: it uses `http://<task>:<token>@127.0.0.1:<port>` so allowlist, grants, DNS vetting and audit apply exactly as for a sandbox request. A running proxy without the publish is replaced (same drift class as an allowlist change). |
| Identity registry `has()` | `egress-task-identity.ts` | A grant for a task with no issued credential is refused (409) — the proxy could never honor it. |

Nothing else widens: ports stay 443/80, IP literals and private ranges stay denied, the SSRF floor is checked before
the request and after redirects, fetched bytes are capped (2 MB) and prescreened as untrusted content.

## Validation
- Pure cores: unit tests beside each module (`src/core/*.test.ts`, `test/runtime/...`).
- Simulated e2e (`test/runtime/nklein-agent/step-plan-e2e.test.ts`): scripted planner / reviewer / worker responses
  drive a card through plan → review (revise, then approve) → execute step 1 → step 2 fails acceptance → replan (through
  review again) → verify step with a lookup receipt → deliver. No Docker, no network.
- Next with real models: planner on Qwen3.6-27B (m5max), plan reviewer on Qwen3.8-27B medium effort (diverse lineage),
  steps executed by Qwen3.5-9B (m4mini) and Bonsai 2 27B ternary; measure per-step acceptance rate vs the same cards
  unplanned (paired, same seats), per §4A "a score is meaningless without the models that produced it".
