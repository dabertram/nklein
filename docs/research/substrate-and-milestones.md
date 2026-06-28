# The shared substrate, the system map, and the milestone ladder

> **Why this doc exists.** An external audit (2026-06-26) of `todo.md` made a sharp, correct point: !Klein has grown
> from a kanban-agent app into *"a local-only autonomous software-work operating system with a model-evaluation lab,
> adaptive retry engine, safe tool kernel, durable agent memory, and cross-model verification harness."* The new
> ambition sections (§5.AA adaptive robustness, §5.AB role→model selection, §5.AC online+temporal, §5.AD context,
> §5.AE dynamic skills) are individually strong but **all depend on the same missing substrate**, and the spec lacks a
> machine-readable milestone/dependency structure so task selection is expensive. This doc is the durable architecture
> record: the **system component map**, the **Agent Attempt Ledger** (the keystone primitive), the **tool-capability
> manifest**, and the **milestone ladder**. `todo.md` §5.0.2 + §5.AF are the actionable backlog for it.
>
> **The disciplined response (mine, adapting the audit):** the audit's own thesis is *"consolidate the substrate, don't
> add more feature ideas."* So instead of the ~8 new sections its idea-list would imply, we add **ONE** substrate
> section (§5.AF) + a sequencing/milestone callout (§5.0.2) + an operator-UX section (§5.AG), **tier** the cross-model
> done-bar (§5.Z), **unify** the three existing tool-gating mechanisms into one manifest, and fold the rest of the
> audit's framings ("flight recorder", "driving school", "workload compiler", "policy DSL", "context profiler",
> "freshness cache") into the sections they already belong to as concept notes + cross-links. Proliferation is the
> disease the audit diagnosed; the cure is not more sections.

## 1. System component map (the grown system, as it actually is)

```
            ┌───────────────────────── operator surfaces ─────────────────────────┐
            │  web-ui (board · chat sidebar · settings · cockpit)   CLI (nklein …) │
            └───────────────▲───────────────────────────────────────▲─────────────┘
                            │ tRPC/HTTP + WS state-stream (the port-resilient seam, §5.V)
            ┌───────────────┴───────────────────────────────────────────────────────┐
            │  runtime-server  ── runtime-state-hub (event projection)                │
            │   • task lifecycle / lane reconcile / auto-start cascade / merge gate   │
            │   • swarm scheduler (concurrency cap, endpoint serialization §6.5)      │
            └───┬───────────────────────┬───────────────────────────┬────────────────┘
                │                       │                           │
   ┌────────────▼─────────┐  ┌──────────▼───────────┐   ┌───────────▼─────────────────┐
   │  NKlein session svc  │  │  chat services       │   │  board / workspace state    │
   │  (agent loop, guards │  │  (interactive +      │   │  (CRDT, locked mutate,      │
   │   §5.X collaborators)│  │   autonomous driver) │   │   result branches)          │
   └───────┬──────────────┘  └──────────┬───────────┘   └─────────────────────────────┘
           │ tool calls (gated)         │
   ┌───────▼─────────────────────────────▼───────────────────────────────────────────┐
   │  TOOL KERNEL  — every tool gated by a capability manifest (§5.AF): mutation-level │
   │  · network-level · fs-scope · audit-detail · approval · replayability            │
   │  (unifies: chat execution-mode action-kinds + §5.L rulesets + NKlein approval)   │
   └───────┬──────────────────────────────────────────────────────────────────────────┘
           │ data-plane (fs/shell/edit/patch/search) — ALWAYS Docker-sandboxed (#2)
   ┌───────▼─────────┐     ┌──────────────────────┐    ┌──────────────────────────────┐
   │  Docker sandbox  │     │  MODEL LAYER          │    │  knowledge / memory          │
   │  (per-task, FAIL │     │  local LLM clients,   │    │  repo-map · code-index ·     │
   │   -CLOSED, no    │     │  endpoint strategy,   │    │  embeddings · chat memory ·  │
   │   host exec)     │     │  MCSR speeds          │    │  online retrieval (§5.AC)    │
   └──────────────────┘     └──────────┬───────────┘    └──────────────────────────────┘
                                       │ writes every attempt outcome
   ┌───────────────────────────────────▼───────────────────────────────────────────────┐
   │  ★ AGENT ATTEMPT LEDGER (§5.AF) — the keystone evidence stream ★                    │
   │  one append-only record per agent/model attempt; the SINGLE source the learning    │
   │  + verification + selection layers read.                                            │
   └───────────────────────────────────┬───────────────────────────────────────────────┘
        projections / consumers ────────┼───────────────────────────────────────────────
   ModelBehaviorProfile (§5.AA)  ·  MCSR speeds (§6.4)  ·  ModelFitness (§5.AB)  ·
   §5.Z cross-model matrix  ·  context quality-knee (§5.AD)  ·  retry policy engine (§5.AA)  ·
   replay/simulation fixtures (§5.V)  ·  operator dashboards (§5.AG)
```

The crucial observation: **the bottom half is missing.** The model layer runs attempts, but the outcomes evaporate into per-domain stores (`task-run-summary-store`, model-registry observations, knowledge-tool telemetry, host-action audit, merge-history) that don't share a grain or a key. Every §5.AA–§5.AD ambition needs the same attempt-grain evidence. **Build the ledger; make the rest projections.**

## 2. The Agent Attempt Ledger — schema (the keystone)

One append-only JSONL record per **attempt** (an attempt = one model invocation toward a task/turn, including its retry rung). Pure schema + a `jsonl-store`-backed writer (we already have the validated `src/state/jsonl-store.ts` boundary — reuse it). Fields:

| field | meaning | feeds |
|---|---|---|
| `attemptId`, `parentAttemptId?` | stable id; parent links retries/escalations into a chain | replay, "what did we try before escalating" |
| `taskId`, `workspacePathHash`, `role` | what + where + which role | §5.Z, fitness per role |
| `modelId` (canonical provider:model:endpoint), `endpoint`, `endpointStrategy` | which model + which API surface (§5.AA endpoint iteration) | profile, MCSR, fitness |
| `promptStrategy`, `toolSetOffered[]`, `simplificationLevel` | §5.AA/§5.AE levers actually applied this rung | profile (which levers work per model) |
| `contextTokens`, `contextBudgetTarget` | §5.AD context size in play | quality-knee learning |
| `difficulty` | §5.AB task-difficulty estimate | fitness key |
| `startedAt`, `completedAt`, `ttftMs`, `tokensPerSec` | timing | MCSR, fitness speed |
| `toolCalls[]` (name, fingerprint, outcome) | what it did | loop/dup analysis, replay |
| `outcome` (`success`/`no_tool_call`/`narrated`/`loop`/`timeout`/`malformed`/`other_failure`) | the §5.AA `ModelOutcomeKind` | profile failure-modes |
| `qualityScore?`, `qualityOk?` | graded quality (eval scorer or downstream signal) | fitness, quality-knee |
| `retriesBefore` | rung index in the retry ladder | learned retry budget |
| `salvage?` (looped→salvaged, recovered-narrated-call, …) | what recovery fired | hardening telemetry |
| `artifacts?` (resultBranch, patchRef, evidenceBundle) | durable output pointers | delivery audit, replay |

**Do NOT build a parallel duplicate.** The ledger SUBSUMES / re-homes the attempt-grain bits currently scattered in `task-run-summary-store` (terminal outcome + focus-chain summary), model-registry **observations** (speed/capability samples), and the knowledge-tool telemetry. The migration: write the ledger first, then make those stores read projections (or thin writers onto it). The host-action **audit** store (§5.Y #11) stays its own security log but can cross-reference `attemptId`.

## 3. Tool-capability manifest (unify the three gating mechanisms)

Today three separate mechanisms gate tools: the chat `chat-execution-mode` action-kinds (`sandbox_read`/`sandbox_write`/`control_plane`/`host_command`), the §5.L per-role capability/delivery rulesets, and the NKlein tool-approval policy. They've **drifted into three forked logics** (a §5.U-class smell). Consolidate into **one declarative manifest** — each tool (chat + NKlein + future) declares its facets once:

`{ mutationLevel: read | sandbox_write | control_plane | host_write ; networkLevel: none | egress ; fsScope: workspace | host ; auditDetail: how to render the action for the §5.Y audit ; approval: auto | confirm | risk_ack | typed_host ; replayable: bool }`

The gate becomes one function of `(manifest, mode, ruleset)`. This is also the seam for the audit's **external-action policy** ("dark factory" network/accounts/purchases/publishing/money): those are just higher `networkLevel`/`approval` tiers on the same manifest — collected for later, invariant-#1-locked now.

## 4. Replay / simulation mode (ties the ledger to §5.V)

A captured ledger attempt records the model's outputs → replay them as a **deterministic fixture** against the live orchestration (no model needed). This (a) makes the currently "live-only, deferred to e2e" §5.V flows **deterministically testable**, (b) is the audit's "flight recorder" (replay/diff/inspect a black-box run), and (c) debugs orchestration races without a GPU. Replayability is a per-tool manifest facet (§3).

## 5. Durable long-run job scheduler

Many sweeps + multi-card runs are too long/fragile for foreground `verify-*.mts` scripts (proven: the 30-min multi-card run died on one transient `fetch failed`). A durable background job runner that **checkpoints to the ledger** and **resumes** from the last attempt survives that. The endpoint scheduler (§6.5) + per-model concurrency (§5.T) are the in-process seeds; this is the cross-run, restart-survivable layer. NOT the deferred perf-comparison sweeps (§5.O out-of-scope) — this is operational durability.

## 6. Resource governance (operational, NOT perf-benchmarking)

A local multi-model lab can OOM / thrash / saturate an endpoint. Operational governance: model load/unload policy, VRAM/RAM/disk headroom checks before a sweep, endpoint-saturation backpressure (the scheduler already serializes per endpoint), background-job priority vs. interactive. **Distinct from** the §5.O-deferred performance/efficiency *comparison* sweeps — this is "don't melt the machine / don't deadlock the endpoint," which is in-scope operational safety.

## 7. Milestone ladder (the machine-readable progress structure)

| Milestone | Definition | Status (2026-06-26) |
|---|---|---|
| **M0 — single-card reliable** | one card → implement → `awaiting_review` → correct result branch, across the roster | **DONE** (verify-task-completion 8/9; §5.Z) |
| **M1 — decompose → multi-card → merge, unattended** | a goal → DAG → cascade → all cards → review → merge, surviving restarts | **mechanism PROVEN**, full unattended run needs the **§5.AF durable scheduler** (foreground scripts too fragile) |
| **M2 — all-model adaptive** | the §5.AA retry ladder + §5.AB selection driving every assignment off the **ledger**; weak models lifted, no circles | needs **§5.AF ledger** + profile persistence (cores exist, unfed) |
| **M3 — online freshness** | §5.AC temporal + online retrieval + freshness cache wired into research roles | temporal DONE; retrieval/cache open |
| **M4 — self-improving (quarantined)** | !Klein proposes patches to itself, gated by protected-tests + replay-eval + security review before landing | self-improvement project exists; **quarantine gate** (§5.AF) is the missing safety |

**Substrate-first sequencing:** M2/M3/M4 all sit on **§5.AF**. The high-leverage order is: land the **Attempt Ledger** → make `ModelBehaviorProfile`/MCSR/§5.Z/fitness projections of it → then the §5.AA/§5.AB engines have real data and stop being "parallel dreams." Build the substrate before widening the ambition fronts.
