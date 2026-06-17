# Kanban Autonomy & Small-Model Upgrade Plan

> **Goal:** Make Kanban able to take a *complex project idea* and decompose it into a concrete,
> dependency-ordered set of implementation plans and tasks that even small local models —
> e.g. `qwen3.5-9b` with an **8k–16k token context window** — can execute *mostly autonomously*
> and ship good software.
>
> **Hard constraint:** We are a fork that **sits on top of the Cline SDK** (`@clinebot/core`,
> `@clinebot/shared`, `@clinebot/llms`) via the local `src/cline-sdk/` boundary. We do **not** patch
> the SDK. Everything here plugs into *official extension points* so we can keep pulling upstream
> Cline / Cline-Kanban updates with minimal merge pain. If a capability genuinely cannot be built on
> top, it is flagged as "needs upstream" and parked, not forked in.

---

## 0. TL;DR — what we are building

A set of capability pillars, each implemented as a **bolt-on layer inside `src/cline-sdk/`** (or the
Kanban app layer) that the SDK already has a socket for. **Pillar numbers are identifiers, not execution
order** — the roadmap in [§7](#7-phased-roadmap) defines sequencing (e.g. P7's telemetry lands in Phase 0
and its self-improvement loop is an *early* Phase 2.5, while P6 freshness is intentionally late):

| Pillar | What it does | SDK socket it plugs into |
|--------|--------------|--------------------------|
| **P0. Model Capability & Speed Registry (MCSR)** | Continuously learns each configured model's *real* context window, *measured* prefill/decode speed (tok/s, TTFT, wall-time), and capability tier — the single source of truth every other pillar reads | Timing capture in the session pipeline; Kanban-owned config; no SDK change |
| **P1. Decomposition engine** | Idea → spec → plan → dependency-ordered task cards, each sized to a *realistic* fit budget | Kanban tools + a "Planning" board lane; no SDK change |
| **P2. Codebase intelligence** | Tree-sitter repo map + local-embedding RAG so small models *find* code instead of *reading everything* | Custom `AgentTool`s + `beforeModel` context injection |
| **P3. Context engineering** | Model-aware, code-safe context compression + budget enforcement (scaled to each model's window **and** measured speed) so 8–16k windows survive long tasks | `compaction.compact` / `prepareTurn` + `beforeModel` |
| **P4. Multi-model roles & capability-aware routing** | Assign work to the *smallest sufficient* model; never hand a too-hard/too-big task to a small model when a bigger one exists; if **no** model is adequate, decompose instead of starting; parallelize independent tasks | Per-task `clineSettings` (exists) + SDK `model-tool-routing` + MCSR |
| **P5. Autonomy & reliability** | Self-verification, test-gating, repair/escalation loops so weak models don't ship broken code | `afterModel` + Kanban hooks + auto-review |
| **P6. Model freshness** *(later)* | LLM researches live leaderboards, suggests newer/better models of comparable size per role | `web_research` tool + MCSR; advisor button |
| **P7. Self-improvement loop (Dogfood Engine)** *(early)* | Kanban collects its own runtime telemetry (bugs, errors, exceptions, inefficiencies) and turns it into guard-checked, eval-gated tasks against **its own codebase** | Telemetry tap + existing task pipeline + eval harness |
| **P8. LLM-assisted advisor surface** *(later)* | User-triggered buttons that use a connected LLM for suggestions: MCP-plugin discovery, config explainer, self-log analysis | Kanban app layer; explicitly *not* a background task |

Two **cross-cutting rules** bind these together and are reflected in every pillar below:

1. **Everything context-related is model- and speed-aware.** No budget, compression ratio, repo-map size,
   retrieval cap, or scheduling decision uses a hardcoded number — they all derive from the **MCSR** entry
   for the *currently assigned* model (its real context window and its *observed* request-processing speed).
   See [§2.5](#25-cross-cutting-foundation-the-model-capability--speed-registry-mcsr).
2. **Kanban never "gets its hands dirty on unrealistic tasks."** Before any task starts, its estimated
   difficulty and fit-budget are checked against the MCSR. If only a bigger model can handle it, route up;
   if *no* available model can, **decompose first** (auto, or suggested) rather than starting. See the
   [no-unrealistic-tasks guard](#252-capability-aware-routing--the-no-unrealistic-tasks-guard).

Everything below is sequenced into phases in [§7](#7-phased-roadmap).

---

## 1. Why this is hard for an 8–16k model (the problem we are actually solving)

A frontier model with 200k+ context can brute-force agentic coding: read whole files, keep the entire
transcript, reason globally. A `qwen3.5-9b` at 8–16k **cannot**, and the failure modes are specific:

1. **Context starvation.** The system prompt + tool schemas + workspace metadata + one or two file
   reads already blow past 8k. The model never even gets to *reason*. Our own
   [`cline-context-budgets.ts`](src/cline-sdk/cline-context-budgets.ts) already reserves ~10% output +
   ~15% prompt-overhead; at 16k that leaves a *safe working budget* of only ~12k, and at 8k it is
   effectively gone. This is the dominant constraint and everything in P2/P3 exists to fight it.
2. **Whole-file reading is fatal.** A frontier model reads a 1,500-line file to find one function.
   A small model *can't* — the file alone exceeds its window. It needs **symbol-level retrieval**, not
   file-level reading. (We already started this: `list_files`/`find_files`/`get_file_size` in
   [`cline-file-discovery-tools.ts`](src/cline-sdk/cline-file-discovery-tools.ts) and the
   `read_large_file` chunk/stitch workflow in
   [`cline-large-file-workflow.ts`](src/cline-sdk/cline-large-file-workflow.ts). We need to go further:
   give it a *map* and a *search*, so it rarely reads a whole file at all.)
3. **Planning collapse.** Small models lose the plot over long horizons. They forget the goal, redo
   work, drift. The fix is **externalizing the plan**: the decomposition lives in *durable task cards
   and a checklist file on disk*, not in the model's head. Each card is sized so the *whole* task fits
   the window. This is the core of P1 and why Kanban's card model is the right substrate.
4. **Tool-call fragility.** Small/local models hallucinate tool arguments, can't reliably emit parallel
   tool calls, and choke on large tool schemas. They need **fewer, simpler, well-described tools** and
   sequential execution. The SDK's `model-tool-routing` (see [§5](#5-p4--multi-model-roles--routing))
   lets us trim the toolset *per model*.
5. **No global reasoning = needs verification.** A weak model will confidently ship broken code. It
   must be forced through **objective gates** (build, typecheck, tests) and given **repair loops**, not
   trusted. This is P5.

**Design principle that falls out of this:** *Retrieval over reading, externalized plans over
in-context plans, fewer tools, hard verification gates, and ruthless context compression.* Every
workstream maps back to one of these.

---

## 2. Architectural guardrails (how we stay upstream-mergeable)

The Cline SDK exposes a clean extension surface. We verified these against the installed packages
(`node_modules/@clinebot/{core,shared}/dist`). **Use only these; never reach into private SDK state.**

- **Custom tools** — `AgentTool` / `AgentToolDefinition` (`@clinebot/shared/dist/agent.d.ts`). This is
  how we already add `list_files`, `read_large_file`, `write_files`. *All P2 retrieval tools land here.*
- **`beforeModel(context) → { tools?, ... }` hook** — rewrite/inject before each model request. *Use for
  context injection (repo map, focus brief) and dynamic tool trimming.*
- **`afterModel(context) → AgentStopControl?` hook** — inspect each model turn. *Use for verification
  nudges and mistake detection.*
- **`compaction.compact` + host-owned `prepareTurn` context pipeline** — the runtime replaces its
  in-memory transcript with what we return, so compaction persists. We already use this in
  [`cline-context-focus-policy.ts`](src/cline-sdk/cline-context-focus-policy.ts) and
  [`cline-context-overflow-compaction.ts`](src/cline-sdk/cline-context-overflow-compaction.ts). *All P3
  compression lands here.*
- **`model-tool-routing` (`ToolRoutingRule`)** — native per-`providerId`/`modelId`/`mode` enable/disable
  of tools (`@clinebot/core/dist/extensions/tools/model-tool-routing.d.ts`). *This is the official lever
  for "small model gets fewer tools."*
- **Teams / subagents** — `teamName`, `TeamEvent` in `@clinebot/core` extensions; the SDK ships
  subagents and agent teams natively. *Prefer these over a homegrown orchestrator for P4 where possible.*
- **`userInstructionService`** — skills/rules/workflows (`createUserInstructionConfigService`). *Use for
  shipping our decomposition/role prompts as versioned rules, not hardcoded strings.*
- **Mistake limiting** (`maxConsecutiveMistakes`) and **checkpoints** — already native. *Wire P5 repair
  loops to these instead of building our own.*

> **Boundary test for every PR in this plan:** *"Could I delete this file and re-pull upstream Cline
> Kanban cleanly?"* If a change forces edits *inside* `node_modules/@clinebot/*` or depends on private
> SDK internals, it is rejected and reworked as a boundary-layer plug-in.

External references for the SDK surface:
[Cline SDK overview](https://docs.cline.bot/sdk/overview) ·
[Cline SDK announcement](https://cline.bot/blog/introducing-cline-sdk-the-upgraded-agent-runtime) ·
[`@cline/agents` on npm](https://www.npmjs.com/package/@cline/agents) ·
[cline/cline `/sdk`](https://github.com/cline/cline/tree/main/sdk).

---

## 2.5 Cross-cutting foundation: the Model Capability & Speed Registry (MCSR)

This is the spine the rest of the plan hangs on, so it is built **first** (Phase 0). It removes every
hardcoded context/speed assumption and replaces it with *measured, per-model* facts.

### 2.5.1 What the MCSR stores (per configured model/endpoint)

A Kanban-owned registry (`~/.cline/kanban/model-registry.json`, in-memory mirror) keyed by
`providerId:modelId:endpoint`, holding a rolling **EWMA** (exponentially-weighted moving average) of:

- **Context window** — advertised by the provider catalog, *corrected* by what the endpoint actually
  accepts, and user-overridable. Small/local models (Ollama, LM Studio) frequently misreport; the
  override + correction path is mandatory (see [§5.3](#53-resolve-the-per-model-context-window-correctly)).
- **Speed / "total-llm-request-processing-speed"** — captured from *every real request* and from an
  optional one-shot warmup probe:
  - **prefill rate** (prompt-eval tok/s) — how fast it ingests context,
  - **decode rate** (generation tok/s) — how fast it emits output,
  - **TTFT** (time-to-first-token),
  - **total wall-time per request** and **per 1k context tokens** (the number that tells us how much a
    big prompt *costs in seconds* on this model).
  These are exactly the metrics local-inference benchmarking standardizes on (prompt-eval rate vs.
  eval rate) — see [Ollama throughput benchmarking](https://github.com/MinhNgyuen/llm-benchmark) and
  [local benchmark methodology](https://localaimaster.com/blog/benchmark-local-ai-setup).
- **Capability tier** — a 0–100 score blended from: (a) the model's **observed pass-rate** on Kanban's
  own eval harness (Phase 0), (b) optional **external leaderboard intelligence index**
  ([Artificial Analysis](https://artificialanalysis.ai/) / [llm-stats](https://llm-stats.com/), which
  publish a composite of SWE-Bench-Verified + coding-arena + live speed), and (c) a static prior per
  known model family for cold-start. Capability and difficulty live on the **same 0–100 scale** so
  routing is a direct comparison.
- **Constraints** — cost-per-token (API), and a **shared-endpoint id** for local models so the scheduler
  knows two tasks would contend for the same GPU/VRAM.

**Where the data comes from (no SDK fork):** the session service already streams usage/timing through the
event adapter ([`cline-event-adapter.ts`](src/cline-sdk/cline-event-adapter.ts),
[`cline-task-session-service.ts`](src/cline-sdk/cline-task-session-service.ts)). We tap that stream to
record tokens-in / tokens-out / durations per request and fold them into the EWMA. Nothing in the model
loop changes.

**New file:** `src/cline-sdk/cline-model-registry.ts` (store + EWMA + capability blend + persistence),
plus a thin timing tap wired in the session service.

### 2.5.2 Capability-aware routing & the "no-unrealistic-tasks" guard

This is the rule the user emphasized: **Kanban must never start a task that's unrealistic for the model it
would run on, and must never hand a hard task to a small model when a bigger one is connected.** It is
enforced as a gate at task-start and at decomposition time.

**Inputs per task:**
- **Difficulty estimate (0–100):** from the decomposition engine's `complexity` score, refined by task
  features (files touched, expected diff size, breadth across modules) and, on retries, by the
  *latency-as-difficulty proxy* (a larger model's processing time correlates with task hardness — a known
  result in routing/cascade research). Grounded in task-difficulty literature: agent success drops sharply
  as difficulty/horizon rises ([Measuring AI Ability to Complete Long Tasks / METR](https://arxiv.org/html/2503.14499v1),
  [Agent Psychometrics / IRT task prediction](https://arxiv.org/html/2604.00594v1)).
- **Fit budget (tokens):** required context = system prompt + repo map + expected reads + working room +
  output reserve, computed from the active model's MCSR window via
  [`cline-context-budgets.ts`](src/cline-sdk/cline-context-budgets.ts).

**Decision procedure (the guard):**

1. **Find candidates** = configured models where `capability ≥ difficulty` **and** `contextWindow ≥ fit
   budget`. Among candidates, pick the **smallest/cheapest/fastest sufficient** one (RouteLLM principle:
   ~95% of top-model quality at ~85% lower cost by routing simple work down —
   [RouteLLM, LMSYS](https://www.lmsys.org/blog/2024-07-01-routellm/),
   [routing & cascading survey](https://arxiv.org/html/2603.04445v1)). Speed breaks ties: if two models
   are both adequate, prefer the one whose MCSR predicts lower wall-time for this task's token profile.
2. **Route up, never down.** If the only adequate models are *bigger* than the per-task default, route to
   the smallest adequate big model. A small model is **never** assigned a task above its capability/window.
3. **No adequate model → do not start.** If *no* configured model satisfies both constraints (too hard for
   the strongest, or fit-budget exceeds the largest window):
   - **auto-decompose ON** → invoke `expand_task` ([§3](#3-p1--decomposition-engine-idea--spec--plan--tasks))
     to split the card until every subtask is realistic for *some* connected model, re-link the DAG, then
     proceed. Bounded by a max split depth.
   - **auto-decompose OFF** → park the card in a `needs-decomposition` state with a one-click **Decompose**
     action and a plain-language note ("no connected model can handle this in one task; split it or connect
     a model with ≥ N-token context / higher capability").
   - If even atomic subtasks remain infeasible (max depth hit) → escalate to the human with an explicit
     explanation and a suggested model class. **Never** silently run an unrealistic task.
4. **Cascade on failure (P5 tie-in).** If an assigned model fails its verification gate, the escalation
   ladder ([§7-bis](#7-bis-p5--autonomy--reliability-dont-let-a-weak-model-ship-garbage)) re-routes the
   card *up* one capability tier rather than retrying the same model indefinitely.

**New file:** `src/cline-sdk/cline-task-router.ts` (difficulty + fit-budget vs. MCSR → assignment | route-up
| decompose | escalate), called from the decomposition engine, the task-start path, and the auto-start
scheduler. The guard is one function with one return type, so every entry point enforces it identically.

---

## 3. P1 — Decomposition engine (idea → spec → plan → tasks)

**Outcome:** A user types "build me a habit-tracker PWA with offline sync" into the sidebar chat, and
Kanban produces a reviewable **spec**, a **technical plan**, and a **DAG of small, independently
runnable task cards** already linked with the dependency arrows Kanban supports — each card sized to fit
a small model's window.

This is the single highest-leverage feature: it converts "a hard problem a small model can't hold in its
head" into "many easy problems each of which fits in 16k."

### 3.1 Adopt a spec-driven pipeline (don't reinvent it)

The industry has converged on a **Spec → Plan → Tasks → Implement** loop. We adopt it wholesale and map
each phase onto Kanban primitives. Reference implementations to mine for prompt structure and artifact
schemas:

- **GitHub Spec Kit** — the de-facto open standard (`Spec → Plan → Tasks → Implement`), supports 30+
  agents. Steal its phase prompts and the `tasks.md` decomposition format.
  [spec-kit docs](https://github.github.com/spec-kit/) ·
  [Microsoft walkthrough](https://developer.microsoft.com/blog/spec-driven-development-spec-kit).
- **Kiro** — requirements → design → atomic tasks "spanning no more than a few files per task." That
  *few-files-per-task* rule is exactly our sizing constraint for small models.
  [9-tool comparison](https://www.marktechpost.com/2026/05/08/9-best-ai-tools-for-spec-driven-development-in-2026-kiro-bmad-gsd-and-more-compare/).
- **claude-task-master** — `parse_prd` → `tasks.json` with dependencies + complexity scores, and
  `expand_task` to recursively split a task that's too big. We mirror this: a **complexity score** per
  task that decides (a) whether to split further and (b) which model role to assign (P4).
  [claude-task-master](https://github.com/eyaltoledano/claude-task-master) ·
  [task structure](https://github.com/eyaltoledano/claude-task-master/blob/main/docs/task-structure.md).
- **BMAD-METHOD** — role-based agents (Analyst → PM → Architect → SM → Dev → QA) + an Orchestrator. We
  borrow the *roles as prompt personas* idea for P4, and the planning-document discipline here.
  [BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD).

### 3.2 How it maps onto Kanban (concrete)

Add a **Planning lane** before `in_progress`. The design research already exists in
[`.plan/docs/planning-column-research.md`](.plan/docs/planning-column-research.md) — implement it:

1. **Idea capture (Backlog).** The sidebar chat agent (governed by
   [`src/prompts/append-system-prompt.ts`](src/prompts/append-system-prompt.ts)) gets a new directive:
   when the user describes a *project-scale* idea (not a single change), run the decomposition workflow
   instead of creating one card.
2. **Spec + Plan (Planning lane, read-only session).** Start a session in plan/read-only mode
   (`buildClineStartPrompt(..., startInPlanMode=true)` already exists in
   [`cline-task-session-service.ts`](src/cline-sdk/cline-task-session-service.ts)). The agent reads the
   codebase **via the P2 repo map (not whole files)** and emits two artifacts to disk:
   `.cline/kanban/plans/<slug>/spec.md` and `plan.md`. Read-only keeps planning cheap so users can fan
   out 10 plans in parallel (the "parallel planning" value prop from the research doc).
3. **Tasks (decomposition tool).** A new Kanban CLI verb + tool, `task decompose`, takes the approved
   plan and emits a **task graph**: title, self-contained prompt, `dependsOn[]`, `complexity`,
   `suggestedRole`, `filesLikelyTouched[]`. Kanban then *programmatically* creates the cards and the
   dependency links using existing `task create` / `task link`
   ([`src/commands/task.ts`](src/commands/task.ts),
   [`src/core/task-board-mutations.ts`](src/core/task-board-mutations.ts)). The decomposition prompt
   itself ships as a **rule/workflow** via `userInstructionService`, not a hardcoded string, so it's
   user-overridable and versioned.
4. **Autonomous execution.** Existing linking + auto-commit chains already give us "task A done →
   commit → auto-start linked task B." Decomposition just *populates* that graph correctly. This is the
   feature that already works; we're feeding it a well-formed DAG.

### 3.3 The task-sizing contract (the small-model-critical part)

Every generated card must satisfy a **fit budget** so a small model can complete it in one or two turns
without overflow. The decomposition tool enforces, and rejects/re-splits otherwise:

- **Self-contained prompt:** the card prompt embeds the *relevant slice* of the spec + the exact
  acceptance criteria + the `filesLikelyTouched` list. The model should not need to re-read the whole
  spec.
- **Few files:** target ≤ ~3 files / ≤ ~400 changed lines per card (Kiro's heuristic). Bigger ⇒
  `expand_task`-style recursive split.
- **Explicit "done" test:** each card carries a machine-checkable acceptance check (a command to run, a
  test to pass) used by P5's verification gate.
- **Complexity score → router input:** feeds the capability-aware router
  ([§2.5.2](#252-capability-aware-routing--the-no-unrealistic-tasks-guard)) for both model assignment and
  the feasibility check.
- **Feasibility check at split time:** the decomposer doesn't just split by file count — it splits until
  every leaf card *passes the guard* against the **currently connected** models (MCSR). A card that no
  connected model could realistically run is, by definition, not done being decomposed. This is what makes
  "small-model-executable" a property the decomposition is *measured against*, not a hope.

**New files:** `src/cline-sdk/cline-decomposition-tool.ts` (the `decompose_project` / `expand_task`
tools), `src/cline-sdk/cline-plan-artifacts.ts` (spec/plan/task-graph schemas + disk I/O), plus a
`task decompose` command and a Planning column in the board state
([`web-ui/src/state/board-state.ts`](web-ui/src/state/board-state.ts), `api-contract.ts` column enum).

---

## 4. P2 — Codebase intelligence (repo map + RAG, so small models stop reading whole files)

**Outcome:** Before the model writes anything, it has a **token-budgeted map of the repository** and a
**semantic + lexical search tool** that returns *symbol-level snippets*. A small model navigates a
100k-LOC repo by retrieving the 5 relevant functions instead of reading 20 files.

This is the difference between "small model is useless on a real repo" and "small model is productive."

### 4.1 Tree-sitter repo map (the aider approach)

Build an **Aider-style ranked repository map**: parse the repo with tree-sitter, extract definitions and
references as tags, build a symbol graph, run **PageRank** to surface the most-referenced symbols, and
render a **token-budgeted** signature-only outline (function/class/type signatures, no bodies). This
gives the model a "table of contents" of the codebase in a few hundred tokens.

- Reference design: [aider repo map](https://aider.chat/docs/repomap.html) ·
  [building a better repo map with tree-sitter](https://aider.chat/2023/10/22/repomap.html) ·
  [aider repo-map deep dive](https://deepwiki.com/Aider-AI/aider/4.1-repository-mapping-system) ·
  port reference [RepoMapper](https://github.com/pdavis68/RepoMapper).
- Parsing in Node: [`web-tree-sitter`](https://www.npmjs.com/package/web-tree-sitter) (WASM grammars,
  no native build — matters for `npx kanban` zero-install) and the language WASMs. For ranking, a small
  PageRank (`graphology` + `graphology-metrics`, or a ~30-line power-iteration we own).
- Token budgeting must reuse our existing [`cline-context-budgets.ts`](src/cline-sdk/cline-context-budgets.ts)
  so the map auto-scales to the active model's window: at 8k the map is signatures-of-top-N-symbols only;
  at 200k it can be lavish.

**Injection:** the repo map is injected via the `beforeModel` hook (so it refreshes as files change) and
also offered as an on-demand `repo_map` tool (so the model can request a focused submap for a directory).

### 4.2 Semantic code search with local embeddings (optional RAG)

Layer a retrieval tool `search_code` on top of the map: tree-sitter chunks the repo into **semantic
units** (functions, classes, methods — *not* fixed line windows, which is what makes code RAG actually
work), embeds them with a **local** embedding model, and serves hybrid (vector + lexical) search.

- **Local, zero-API embeddings** (must work offline / no API key, consistent with `npx kanban` ethos):
  [`fastembed-js`](https://www.npmjs.com/package/fastembed) (BGE-small, ONNX) or
  [`@xenova/transformers` / transformers.js](https://www.npmjs.com/package/@xenova/transformers) with
  `all-MiniLM-L6-v2` (384-dim). Models are fetched once on first use and cached under `~/.cline/kanban`.
  [Node embeddings how-to](https://philna.sh/blog/2024/09/25/how-to-create-vector-embeddings-in-node-js/).
- **Why AST chunking matters:** chunking on syntax boundaries (tree-sitter) keeps each snippet
  semantically whole and maps cleanly back to file:line for precise retrieval — see
  [semantic code indexing with tree-sitter](https://medium.com/@email2dineshkuppan/semantic-code-indexing-with-ast-and-tree-sitter-for-ai-agents-part-1-of-3-eb5237ba687a).
- **Storage:** a small on-disk vector index per workspace (sqlite + a brute-force/HNSW cosine search is
  plenty at repo scale; e.g. `sqlite-vec` or an in-memory index rebuilt from a cached embeddings file).
  Keep it in `~/.cline/kanban/index/<workspace-hash>/` and invalidate per-file by mtime/hash.
- **Hybrid is non-negotiable for code:** combine embedding similarity with exact lexical/symbol matches
  (ripgrep-style) — identifiers and error strings need exact match, prose needs vectors.

> **Scope discipline:** P2's embedding RAG is **opt-in** and **incremental**. The tree-sitter repo map
> (4.1) is the must-have and is cheap; embeddings (4.2) are the power-up. Ship 4.1 first, measure, then
> decide whether 4.2 earns its complexity. (Aider, notably, ships *only* the ranked map and no embeddings
> — strong evidence the map alone is enough for most navigation.)

### 4.3 Tool ergonomics for small models

Retrieval tools must be **few and forgiving**. Expose a small, stable set:
`repo_map`, `search_code`, `read_files` (focused excerpts), `read_large_file` (existing, last resort).
Descriptions written for a weak model: short, imperative, with a worked example. This complements the
existing discovery tools rather than replacing them.

**New files:** `src/cline-sdk/cline-repo-map.ts` (tree-sitter parse + PageRank + budgeted render),
`src/cline-sdk/cline-code-index.ts` (chunk + embed + search), `src/cline-sdk/cline-retrieval-tools.ts`
(the `repo_map` / `search_code` `AgentTool`s). Wire injection in the session service alongside the
existing `createFileDiscoveryTools` call.

---

## 5. P3 — Context engineering & compression (survive 8–16k over long tasks)

**Outcome:** Long, multi-turn tasks don't die from overflow. The transcript, file reads, and tool
results are continuously compressed in a **code-safe** way, and the budget is *enforced*, not hoped for.

We already have the skeleton: budgets, a focus policy that compacts read_files ledgers, overflow
recovery, and an efficiency-rules system prompt. P3 hardens and extends it.

### 5.0 Everything here is driven by the MCSR (context window **and** speed)

Every number in P3 is derived, never hardcoded, from the active model's MCSR entry
([§2.5](#25-cross-cutting-foundation-the-model-capability--speed-registry-mcsr)):

- **Window-driven sizing (already partly true):** budgets, repo-map size, retrieval result caps, chunk
  sizes, and the compaction trigger threshold all scale to the *measured* context window. On model change
  (or route-up), budgets recompute immediately for the new window.
- **Speed-driven aggressiveness (new):** the *observed processing speed* sets how hard we compress and how
  big a prompt we're willing to send. A slow endpoint (e.g. a local 9B at 15 tok/s prefill) means a large
  prompt costs *real wall-clock seconds*, so we compress harder and keep prompts lean to keep turns
  responsive; a fast endpoint with headroom can afford richer context. Concretely: the compaction trigger
  ratio and the repo-map/retrieval token budgets are functions of `min(window-headroom, speed-headroom)`,
  where `speed-headroom` is derived from the MCSR wall-time-per-1k-tokens so a turn stays under a target
  latency. This makes Kanban feel usable on slow local models instead of hanging on giant prompts.

### 5.1 Code-safe compression (not naive token pruning)

Two complementary techniques, both behind the `prepareTurn`/`compaction` socket so the SDK persists the
compressed transcript:

1. **Structured summarization of stale turns (we already do a basic version).** Extend
   [`cline-context-focus-policy.ts`](src/cline-sdk/cline-context-focus-policy.ts): old file reads
   collapse to "file X: covered lines A–B, key symbols/decisions: …"; old tool results collapse to
   outcome + delta; the *running plan/ledger* is always preserved verbatim. This is the
   externalized-memory idea — the model's working state lives in a compact, always-present brief.
2. **Caveman-style semantic compression for prose-heavy context** (specs, plans, instructions, the
   system prompt's static guidance). Strip predictable grammar while preserving load-bearing facts —
   40–58% reduction on natural-language text with ~no info loss.
   [Caveman compression](https://github.com/wilpel/caveman-compression) ·
   [overview](https://betterstack.com/community/guides/ai/caveman-llm/). Apply this to *our own injected
   prose* (system prompt, repo map prose, spec excerpts) — **not** to source code (token-level pruning
   breaks code/JSON/paths; this is a known LLMLingua caveat:
   [Microsoft LLMLingua](https://github.com/microsoft/LLMLingua)).
3. **For code specifically:** prefer *minification / signature-stripping* over token pruning — strip
   comments/whitespace, or send signatures-only (the repo map already does this). For genuinely needed
   long code context, the research direction is
   [LongCodeZip (code-aware context compression)](https://arxiv.org/pdf/2510.00446); start with the
   cheap minify, treat LLMLingua-2 / LongCodeZip as a later, opt-in, model-assisted pass.

### 5.2 Hard budget enforcement

The current budget math in [`cline-context-budgets.ts`](src/cline-sdk/cline-context-budgets.ts) is good;
make it *binding*:

- **Pre-send guard** (partially exists): project next-turn tokens; if over the safe working budget,
  *force* a compaction pass (5.1) before sending rather than letting the provider 400. Extend the
  existing overflow detector in
  [`cline-context-overflow-compaction.ts`](src/cline-sdk/cline-context-overflow-compaction.ts) from
  *reactive* (catch the error) to *proactive* (never emit the over-budget request).
- **Auto-`/compact` summary checkpoints:** when usage crosses ~70% of safe budget, emit a one-time
  durable summary card/file and prune. (The SDK already exposes checkpoints — wire to those.)
- **Surface the budget in the UI:** a token-usage meter per card (the data already flows through the
  session service — `contextWindowByTaskId`, projected tokens). Lets users *see* when a model is near
  the wall and pick a bigger-window role.

### 5.3 Resolve the per-model context window correctly

Small local models lie about / don't advertise their window. `clineSettings.contextWindow` already
exists per task; ensure the **provider catalog** (`mergeProviderModelsWithContextWindowFallback` in
[`cline-provider-service.ts`](src/cline-sdk/cline-provider-service.ts)) has sane fallbacks for
Ollama/LM Studio models and that the user can **override** the window per role/model in settings — the
whole budget system is only as good as this number.

---

## 6. P4 — Multi-model roles & parallel routing

**Outcome:** The user configures a small **roster of models with roles** — e.g. a strong/slow model for
architecture & hard tasks, a fast/cheap (or local) model for bulk mechanical tasks — and Kanban routes
each task to the right one and runs independent tasks in parallel.

Foundations already exist: per-task `clineSettings` carries `providerId` / `modelId` / `reasoningEffort`
/ `contextScope` ([`api-contract.ts`](src/core/api-contract.ts)), the provider service supports custom
providers (Ollama/LM Studio/OpenRouter), and worktrees already isolate parallel tasks. We add the
**roles layer** and **auto-assignment** on top.

### 6.1 Model roster + roles (config layer)

Add a Kanban-owned config (extend [`src/config/runtime-config.ts`](src/config/runtime-config.ts), today
it only has a single `selectedAgentId`) describing a **roster**:

```jsonc
// ~/.cline/kanban/config.json  (illustrative)
"modelRoles": {
  "architect": { "providerId": "anthropic", "modelId": "…strong…", "reasoningEffort": "high" },
  "worker":    { "providerId": "ollama",   "modelId": "qwen3.5-9b", "contextWindow": 16000 },
  "reviewer":  { "providerId": "openrouter","modelId": "…mid…" }
}
```

Roles map onto the BMAD persona idea ([BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD)) but
stay lightweight: a role = (model + reasoning + a short persona prompt fragment shipped as a rule).

### 6.2 Auto-assignment by complexity

The decomposition engine (P1) already emits a `complexity` score per card. Map it:

- High complexity / architectural / "touches many modules" ⇒ **architect** role (strong, slow, rare).
- Low complexity / mechanical / well-specified ⇒ **worker** role (fast/local, frequent).
- Planning lane sessions ⇒ **architect**; verification/repair passes (P5) ⇒ **reviewer**.

Roles are not hardcoded to a model — each role resolves to whichever connected model best fits its
capability tier in the MCSR, so the mapping stays correct as the roster changes. **Assignment always goes
through the router/guard** ([§2.5.2](#252-capability-aware-routing--the-no-unrealistic-tasks-guard)): the
complexity score picks a *target tier*, the router picks the smallest sufficient model in that tier (or
routes up / triggers decomposition if none fits). Assignment writes `clineSettings` on the card; the user
can override per card in the UI (the card detail panel already edits cline settings). This is a
*suggestion*, never a lock-in — but the override is still re-checked by the guard so a user can't
accidentally pin an unrealistic task to a tiny model.

### 6.3 Per-model tool routing (small-model survival)

Use the SDK's native `model-tool-routing` (`ToolRoutingRule` with `modelIdIncludes` / `providerIdIncludes`
→ `enableTools` / `disableTools`,
`@clinebot/core/dist/extensions/tools/model-tool-routing.d.ts`). For a small local model, **trim the
toolset**: drop rarely-needed tools, force sequential tool execution, prefer the simplest read path. For
a strong model, allow the full set + parallel tools. This is exactly the lever weak models need (problem
#4 in [§1](#1-why-this-is-hard-for-an-816k-model-the-problem-we-are-actually-solving)) and it's a config
we *own at the boundary* — no SDK fork.

### 6.4 Parallelism & orchestration

- **Independent tasks already parallelize** via worktrees + the linking DAG. P1 produces a correct DAG;
  the executor just needs to **auto-start all currently-unblocked cards** up to a user-set concurrency
  cap (new setting `maxConcurrentTasks`). Throttle by role (e.g. only 1 architect-model task at a time
  to respect rate limits / VRAM; many worker tasks). The scheduler reads the MCSR **shared-endpoint id**
  to serialize tasks that would contend for the same local GPU, and uses the MCSR **wall-time estimate**
  (tokens ÷ measured decode rate + prefill) to order and pace the queue rather than firing everything at
  once and thrashing a single local server.
- **Prefer SDK teams/subagents** (`teamName`, `TeamEvent`) for *intra-task* sub-delegation (e.g. a task
  spawns a focused "write the tests" subagent) rather than building our own orchestrator. Evaluate the
  native team API before writing any custom fan-out.
- **VRAM/rate-limit awareness for local models:** a single 9B model server can't serve 10 parallel
  tasks. The scheduler must serialize tasks that target the *same local endpoint* while parallelizing
  across distinct endpoints/cloud providers.

---

## 7-bis. P5 — Autonomy & reliability (don't let a weak model ship garbage)

**Outcome:** A card is not "done" because the model *said* so; it's done because it **passed an objective
gate**. Weak models get tight repair loops instead of trust.

- **Acceptance gate per card.** Each P1 card carries a check command (build / typecheck / test). On the
  model's "I'm finished" signal, Kanban runs the gate (it already runs scripts via Script Shortcuts and
  has hooks). Fail ⇒ feed the failure back as the next turn (auto-repair loop), bounded by
  `maxConsecutiveMistakes` (SDK-native) before escalating to the user or to a stronger role.
- **Test-first option.** For suitable tasks, decomposition can emit the acceptance test *as part of the
  card* so the worker model codes against a concrete target — far more reliable for small models than
  open-ended "implement X."
- **Self-review via `afterModel`.** A lightweight `afterModel` hook can detect obvious giveaways
  (claimed success with no diff, truncated writes, left-in TODOs) and refuse completion.
- **Escalation ladder.** worker fails N times ⇒ retry once with the reviewer/architect role (P4) ⇒ if
  still failing, park in `review` with a clear failure summary for a human. This makes "mostly
  autonomous" safe: the floor is "stops and asks," never "ships broken."
- **Online research tool (grounding).** A `web_research` tool (gated, opt-in) so a stuck task can fetch
  docs/changelogs/error-message context instead of hallucinating an API. Implement on top of the
  agent's existing web-fetch where present, or a Kanban-owned fetch with allow-listing. Keep results
  piped through P3 compression before they enter context.

---

## 7-ter. P6 — Model freshness ("check latest LLM models") — *later feature*

**Outcome:** A one-click **"Check for better models"** action. Kanban uses an LLM to research the current
state of the art online and tells the user, per connected model: *"Your worker slot is `qwen3.5-9b`; a
newer model of comparable size/context, `<X>`, now scores materially higher on coding — consider
swapping."* It never auto-swaps; it **suggests**, with evidence.

This is explicitly a **later** feature (lands after the core pillars), but it's designed in now because it
plugs into the same MCSR substrate.

**How it works:**
1. **Gather the user's roster** from the MCSR: each connected model's family, parameter size class,
   context window, provider, and observed capability/speed.
2. **Research the field** with the LLM-driven `web_research` tool (built in P5), querying live,
   structured leaderboards rather than guessing: [Artificial Analysis](https://artificialanalysis.ai/)
   and [llm-stats](https://llm-stats.com/) both publish intelligence + coding + speed + price for 300+
   models and refresh continuously; [OpenRouter](https://openrouter.ai/) exposes a models API for
   currently-servable models and pricing. The agent extracts candidates that are **comparable in
   size/context** but **higher in coding capability** (or similar capability at better speed/price).
3. **Rank & explain.** Produce a short, sourced recommendation per slot: candidate, why it's better
   (benchmark deltas), trade-offs (license, local-runnability, VRAM, context), and the exact step to
   switch (e.g. `ollama pull <X>` or change the provider/model in settings).
4. **Respect the roles.** Recommendations are per **role** (architect/worker/reviewer), since "better"
   depends on the slot — a faster local model for the worker slot, a smarter cloud model for architect.
5. **One-click trial.** Optionally let the user assign a candidate to a role and run it against Kanban's
   own eval harness (Phase 0) to get a *local, real* capability number before committing — closing the
   loop back into the MCSR.

**Boundary note:** purely Kanban-side (a tool + a settings panel + leaderboard fetchers). No SDK changes.
Keep leaderboard sources behind an allow-list and cache results; degrade gracefully offline (show last
cached recommendations).

**New files:** `src/cline-sdk/cline-model-research.ts` (leaderboard fetch + candidate ranking), a
`check-models` command/tool, and a settings-panel surface in `web-ui`.

---

## 7-quater. P7 — Self-improvement loop ("Kanban improves Kanban") — *early*

**Outcome:** Kanban watches itself run, collects everything relevant (bugs, errors, exceptions, plus softer
signals: overflows, tool-arg failures, retries, slow turns, abandoned tasks, low eval scores), and turns
those signals into **concrete, guard-checked, eval-gated tasks against its own codebase** — to fix bugs,
harden failure modes, raise coding quality, improve efficiency, improve agent-swarm behavior, extend
features, and — the north star — **push up the task-complexity ceiling that small models can clear.**

This is the flywheel: every other pillar produces telemetry; this pillar converts telemetry into
improvements; improvements make the pillars better. It is sequenced **early** (telemetry in Phase 0, the
loop in Phase 2.5) because Kanban *already* runs coding agents against a repo in isolated worktrees with a
review/auto-commit gate — pointing that machinery at its own repo is a small step once decomposition (P2)
and the eval harness (Phase 0) exist.

This is a known, validated research direction — we are not inventing it, we are operationalizing it on top
of Kanban's existing task pipeline:
[Darwin Gödel Machine (Sakana, ICLR 2026)](https://arxiv.org/abs/2505.22954) self-improved a coding agent
from 20% → 50% on SWE-bench by reading and modifying its own code and **empirically validating every
change on benchmarks**, keeping an *archive of attempts including why failures failed*. Agent observability
practice ([AgentTrace](https://arxiv.org/html/2602.10133v1),
[agent observability guide](https://www.groundcover.com/learn/observability/ai-agent-observability))
supplies the telemetry schema.

### 7-quater.1 Self-observation telemetry (Phase 0 substrate)

A Kanban-owned, structured, **local** telemetry sink (`~/.cline/kanban/telemetry/`, append-only JSONL,
async so it never slows a turn) that records, with run/task/model correlation IDs:

- **Hard signals:** uncaught exceptions, runtime errors, SDK/provider errors, tool execution failures,
  context-overflow events, failed verification gates, crashes.
- **Soft signals (inefficiencies & shortcomings):** turns that hit the budget wall, repeated re-reads of
  the same file, tool-argument hallucinations, abandoned/parked tasks, escalations, slow turns (from the
  MCSR), low eval-harness scores, decomposition rejects, churn (a card reopened N times).
- **Provenance & privacy:** redact secrets/paths by default; everything stays on the user's machine;
  shipping anywhere is opt-in. This reuses the existing telemetry plumbing
  ([`src/telemetry/`](src/telemetry/), [`cline-telemetry-service.ts`](src/cline-sdk/cline-telemetry-service.ts))
  rather than adding a parallel system.

This sink is *also* what feeds the MCSR capability scores and the budget tuning — one observation stream,
several consumers.

### 7-quater.2 The Dogfood Engine (Phase 2.5 loop)

1. **Cluster & triage.** Periodically (or on a button), a connected LLM reads the telemetry, **clusters**
   recurring signals into candidate improvements, and ranks by frequency × severity × expected effort. The
   output is a prioritized "self-improvement backlog."
2. **Decompose into real cards.** Each candidate goes through the P1 decomposition engine → sized,
   guard-checked task cards *against the Kanban repo as a registered project* (Kanban already supports
   multiple projects). A telemetry cluster like "37 overflow events all in large-file stitching" becomes a
   concrete card with a reproduction and an acceptance test.
3. **Run through the existing pipeline.** Worktree isolation (already exists) + capability routing (P4) +
   the autonomy gates (P5). The **eval harness is the acceptance gate** — mirroring DGM's empirical
   validation: a self-improvement is only mergeable if it improves (or holds) the targeted metric and
   regresses nothing.
4. **Archive attempts.** Keep DGM-style history of what was tried and why it failed, so the engine doesn't
   loop on the same dead ends and so humans can audit it.
5. **Human-seeded input (the button).** A first-class **"Suggest an improvement"** input where the user
   describes a pain point, paste a stack trace, or upvote a clustered candidate. This seeds/steers the
   self-improvement backlog directly — human taste stays in the loop.

### 7-quater.3 Safety rails (non-negotiable for self-modifying code)

A coding agent editing its own codebase is powerful and must be tightly gated. Hard rules:

- **Propose, never self-merge.** Improvements land as candidate branches/PRs in isolated worktrees and
  require the **eval-harness + full test gate to pass** *and* (by default) **human review before merge**
  into the running install. There is a frozen, known-good Kanban baseline at all times.
- **No silent edits to safety-critical code.** Changes touching the permission/sandbox/path-guard/git
  guardrail code ([`src/security/`](src/security/), worktree cleanup, `path-sandbox.ts`,
  the autonomous-mode flags) are **never** auto-committed — they always require explicit human approval,
  even when auto-commit is enabled elsewhere.
- **Bounded autonomy.** Rate-limit self-improvement runs; cap concurrent self-edits; the engine cannot
  modify its own gates/telemetry-redaction without human sign-off (no removing its own seatbelt).
- **Auditability.** Every self-change is traceable to the telemetry cluster that motivated it and the eval
  delta that justified it.

**Future toggle — "trusted auto-merge" (ships OFF, off by default):** once the eval harness has *earned
trust* over many runs, an optional mode may let a self-improvement merge **without** human review **iff**
it (a) is fully green on the eval-harness + test gate, (b) touches **no** security/sandbox/permission/git-
guardrail/telemetry-redaction code, and (c) clears a regression-delta threshold. Anything touching the
protected paths, or any red/uncertain result, always falls back to human sign-off. This stays disabled
until the gate is proven; enabling it is an explicit, logged user decision with a one-click kill-switch
back to propose-only. Treat it as the *reward* for a trustworthy harness, never the default.

**New files:** `src/telemetry/self-observation-sink.ts` (Phase 0), `src/cline-sdk/cline-dogfood-engine.ts`
(cluster → triage → decompose → enqueue, Phase 2.5), plus a "Suggest an improvement" surface and a
self-improvement backlog view in `web-ui`.

---

## 7-quinquies. P8 — LLM-assisted advisor surface (user-triggered helpers) — *later*

**Outcome:** A small, coherent set of **buttons** where the user explicitly asks a connected LLM for help
with *configuring and understanding Kanban itself*. The unifying rule: **these are user-initiated, not
silent background tasks** — the LLM advises, the user decides. Keep it tasteful and bounded, not a swarm
of always-on agents.

P6 model-freshness ([§7-ter](#7-ter-p6--model-freshness-check-latest-llm-models--later-feature)) is the
canonical instance of this pattern; P8 generalizes it to a few more high-value buttons:

### 7-quinquies.1 MCP-plugin discovery & suggestions

A **"Find useful MCP plugins"** button: the LLM researches the live MCP registries, then suggests servers
relevant to *this* project (inferred from the repo map / task history / stack) with a clear "what it's for
and why it'd help you" rationale, and a one-click add via the existing MCP settings service.

- **Sources:** [mcp.so](https://mcp.so/), [Smithery](https://smithery.ai/),
  [glama.ai/mcp](https://glama.ai/mcp), the
  [GitHub MCP Registry](https://github.blog/ai-and-ml/github-copilot/meet-the-github-mcp-registry-the-fastest-way-to-discover-mcp-servers/),
  and [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers). Overview:
  [best MCP registries 2026](https://www.truefoundry.com/blog/best-mcp-registries).
- **Security is part of the recommendation, not an afterthought.** A scan of 8,000+ MCP servers found
  ~37% with SSRF, ~43% with unsafe command-exec paths, ~41% with zero auth
  ([truefoundry](https://www.truefoundry.com/blog/best-mcp-registries)). Suggestions must surface a trust
  signal (maintenedness, auth, popularity, permissions requested) and default to an **allow-list + explicit
  user confirmation** before any install. Never auto-install.
- **Plugs into existing code:** [`cline-mcp-runtime-service.ts`](src/cline-sdk/cline-mcp-runtime-service.ts)
  and [`cline-mcp-settings-service.ts`](src/cline-sdk/cline-mcp-settings-service.ts) already manage MCP —
  this adds discovery + ranking on top, no SDK change.

### 7-quinquies.2 Config & self-diagnosis helpers

Small, focused, on-demand buttons that each take Kanban's *own* state as input:

- **"Explain / suggest this config"** — point the LLM at a settings panel (model roles, timeouts, context
  scope, auto-review) and ask for a recommendation tailored to the connected models (reads the MCSR).
- **"Analyze Kanban's debug logs"** — feed the verbose/debug log + recent telemetry slice to the LLM and
  ask "what's wrong / what's slow / what should I change?" This is the human-facing companion to the P7
  Dogfood Engine: P7 *fixes* automatically-clustered issues; this *explains* a specific situation a user
  is looking at right now.
- **"Why did this task fail / stall?"** — per-card explanation built from that card's telemetry + transcript.

**Scope discipline:** all P8 buttons are thin (a prompt + the relevant context slice + a connected model),
share one `src/cline-sdk/cline-advisor.ts` helper, and never run unprompted. No standing background LLM
load, no autonomous config changes — suggestions only, applied on explicit user click.

---

## 7-sexies. Dev Test Project & Evidence Bundle — *build this first* (dev tooling, droppable)

**Outcome:** A fixed, pinned **"Dev Test Project"** entry in the sidebar that lets *you* validate any
increment of this plan with **one click to run** and **one click to copy the evidence path** — then hand
that path to a strong coding agent ("analyze the run at `<path>`") for diagnosis. The whole point is a
**fast, low-babysitting iteration loop** so the rest of the plan can be built and verified quickly.

This is **dev-only scaffolding**, gated behind a dev flag (`NODE_ENV=development` / a hidden setting), and
is explicitly **droppable** later — it ships nothing to end users. It is the *first* thing to implement
because every subsequent phase becomes faster to verify once it exists. It reuses, rather than duplicates,
the Phase 0 telemetry sink and eval harness.

### 7-sexies.1 One-click autonomous run

The sidebar entry exposes a **"Run dev smoke test"** button that, with no further input:

1. **Scaffolds a fresh throwaway workspace** from a small bundled template repo (a minimal but real
   project — e.g. a tiny TS lib/CLI with tests) into a temp dir, `git init`s it, and registers it as a
   Kanban project (reuses the existing project-add + worktree machinery).
2. **Seeds a known task** (or a small decomposition, once P1 exists) — a fixed, representative prompt with
   a built-in acceptance check — and **starts it autonomously** with auto-commit/auto-review on, so it runs
   end-to-end without hand-holding. Uses the *currently configured* model roster, so the same button
   doubles as a quick "is my small local model actually working through this?" check.
3. **Runs unattended.** Because it's the normal task pipeline (worktree + agent + gates), it exercises the
   real code paths the plan touches — decomposition, routing/guard, context budgeting, autonomy gates —
   not a mock.

A small set of **preset scenarios** (a dropdown) lets you target what you're iterating on: e.g.
`small-model @ 8k`, `decomposition of a multi-file feature`, `forced large-file read`, `multi-task DAG`.
Each preset is just a fixed template + prompt + model override.

### 7-sexies.2 Evidence bundle + one-click copy path

Every run writes a self-contained **evidence bundle** to a stable location
(`~/.cline/kanban/dev-runs/<scenario>-<timestamp>/`) designed to be read by *another agent or a human*:

- `summary.md` — scenario, models used, outcome (pass/fail + gate result), headline MCSR stats (tokens
  in/out, context-window usage, prefill/decode tok/s, wall-time), and links to the artifacts below.
- `telemetry.jsonl` — the P7 self-observation stream for the run (errors, overflows, retries, inefficiencies).
- `transcript/` — full message history + tool calls (from the message repository) per task.
- `diff.patch` + final worktree snapshot — what the agent actually produced.
- `config-snapshot.json` — roster/roles, context scope, routing decisions, guard decisions.
- `eval.json` — harness result if the scenario ran one.

The sidebar entry shows the **latest bundle path with a copy-to-clipboard button** (and a "reveal in file
manager" affordance). So your loop is: click **Run** → wait → click **Copy path** → paste into a strong
agent and say "analyze this run." That's the no-babysitting iteration cycle you asked for.

**Boundary & scope:** purely Kanban app-layer + a bundled template; reuses task/worktree/telemetry/message
primitives; no SDK change. Keep the template repo tiny and the collector behind the dev flag so it can be
deleted in one commit when no longer needed.

**New files:** `scripts/dev-fixtures/<template-repo>/` (bundled sample project),
`src/cline-sdk/cline-dev-test-project.ts` (scaffold + seed + run orchestration),
`src/telemetry/evidence-bundle.ts` (collect + write + path resolution), and a pinned dev-only sidebar
surface in `web-ui` with the run + copy-path controls.

---

## 7. Phased roadmap

Ordered for **earliest small-model value** and lowest merge risk. Each phase is independently shippable.

### Phase 0a — Dev Test Project & Evidence Bundle — *build first* (~half sprint)
- Pinned dev-only sidebar entry: one-click autonomous smoke run + one-click copy-evidence-path
  ([§7-sexies](#7-sexies-dev-test-project--evidence-bundle--build-this-first-dev-tooling-droppable)).
- A minimal evidence bundle from day one (transcript + diff + summary), grown as later phases add
  telemetry/MCSR/eval data. *Rationale: this is the iteration loop that makes every phase below faster to
  verify with minimal babysitting — so it comes before everything, even the MCSR.*

### Phase 0 — Foundations & measurement (1 sprint)
- **Model Capability & Speed Registry (MCSR)** — timing capture in the session pipeline, EWMA store,
  capability blend, persistence ([§2.5](#25-cross-cutting-foundation-the-model-capability--speed-registry-mcsr)).
  *This is the dependency for P3 budgeting, P4 routing, and the P6 freshness feature — build it first.*
- Build a **small-model eval harness**: a fixed repo + a set of decomposable tasks, run end-to-end with
  `qwen3.5-9b @ 16k` and `@ 8k`, record overflow rate, tool-error rate, task pass rate, tokens/turn.
  *Everything after this is measured against Phase 0 baselines; it also seeds the MCSR capability scores.*
- **Self-observation telemetry sink** — structured, local, async capture of bugs/errors/exceptions +
  inefficiency signals ([§7-quater.1](#7-quater1-self-observation-telemetry-phase-0-substrate)). *Built
  now because it also feeds the MCSR and budget tuning; it's the substrate for the Phase 2.5 self-improvement loop.*
- Make the per-model context window resolution robust ([§5.3](#53-resolve-the-per-model-context-window-correctly)).
- Token-usage + speed meter in the card UI ([§5.2](#52-hard-budget-enforcement)).

### Phase 1 — Codebase intelligence v1 (highest leverage) (1–2 sprints)
- Tree-sitter **ranked repo map** + `repo_map` tool + `beforeModel` injection ([§4.1](#41-tree-sitter-repo-map-the-aider-approach)).
- Tool-ergonomics pass for small models ([§4.3](#43-tool-ergonomics-for-small-models)).
- *Expected:* large drop in "whole-file read" overflows; small model can navigate a real repo.

### Phase 2 — Decomposition engine v1 (1–2 sprints)
- Planning lane + read-only planning sessions ([§3.2](#32-how-it-maps-onto-kanban-concrete)).
- `task decompose` / `expand_task` tools emitting a sized, dependency-linked task DAG with complexity
  scores ([§3.2](#32-how-it-maps-onto-kanban-concrete), [§3.3](#33-the-task-sizing-contract-the-small-model-critical-part)).
- Decomposition prompts shipped as overridable rules/workflows.

### Phase 2.5 — Self-improvement loop v1 (Dogfood Engine) — *early* (1 sprint)
- Telemetry triage/clustering → self-improvement backlog; decompose into guard-checked cards against the
  Kanban repo; eval-harness as the merge gate; DGM-style attempt archive
  ([§7-quater.2](#7-quater2-the-dogfood-engine-phase-25-loop)).
- The **"Suggest an improvement"** user-input surface ([§7-quater.2](#7-quater2-the-dogfood-engine-phase-25-loop)).
- The self-modification **safety rails** ([§7-quater.3](#7-quater3-safety-rails-non-negotiable-for-self-modifying-code))
  ship *with* this phase, not after — propose-never-self-merge, protected security code, bounded autonomy.
  *Earliest feasible point: needs Phase 0 telemetry + eval harness and Phase 2 decomposition.*

### Phase 3 — Context engineering hardening (1 sprint)
- Proactive budget enforcement + auto-compaction checkpoints ([§5.2](#52-hard-budget-enforcement)).
- Caveman compression for injected prose; code minify for code context ([§5.1](#51-code-safe-compression-not-naive-token-pruning)).
- Extend the focus policy's structured summarization.

### Phase 4 — Multi-model roles, capability routing & the guard (1–2 sprints)
- Model roster + roles config ([§6.1](#61-model-roster--roles-config-layer)); auto-assignment by
  complexity ([§6.2](#62-auto-assignment-by-complexity)).
- **Capability-aware router + no-unrealistic-tasks guard** (`cline-task-router.ts`) wired into task-start,
  decomposition, and the auto-start scheduler
  ([§2.5.2](#252-capability-aware-routing--the-no-unrealistic-tasks-guard)). *Depends on MCSR (Phase 0)
  and decomposition (Phase 2).*
- SDK `model-tool-routing` rules per role ([§6.3](#63-per-model-tool-routing-small-model-survival)).
- Concurrency cap + MCSR-driven per-endpoint serialization for local models ([§6.4](#64-parallelism--orchestration)).

### Phase 5 — Autonomy & reliability (1–2 sprints)
- Acceptance gates + auto-repair loop + escalation ladder ([§7-bis](#7-bis-p5--autonomy--reliability-dont-let-a-weak-model-ship-garbage)).
- `web_research` grounding tool.
- Test-first decomposition option.

### Phase 6 — Optional power-ups (de-risked, measured)
- Local-embedding semantic `search_code` ([§4.2](#42-semantic-code-search-with-local-embeddings-optional-rag)) — *only if Phase 1 metrics show the ranked map is insufficient.*
- LLMLingua-2 / LongCodeZip model-assisted code compression ([§5.1](#51-code-safe-compression-not-naive-token-pruning)).
- SDK team/subagent intra-task delegation ([§6.4](#64-parallelism--orchestration)).

### Phase 7 — LLM-assisted advisor surface — *later* (1–2 sprints)
- **Model freshness** ("check latest LLM models"): leaderboard research + per-role swap suggestions +
  one-click eval-harness trial ([§7-ter](#7-ter-p6--model-freshness-check-latest-llm-models--later-feature)).
- **MCP-plugin discovery**: registry research + project-relevant, security-aware suggestions + one-click add
  ([§7-quinquies.1](#7-quinquies1-mcp-plugin-discovery--suggestions)).
- **Config & self-diagnosis helpers**: "explain this config", "analyze Kanban's debug logs", "why did this
  task fail" ([§7-quinquies.2](#7-quinquies2-config--self-diagnosis-helpers)).
- *All user-triggered, share one `cline-advisor.ts` helper; depend on the P5 `web_research` tool + MCSR;
  intentionally sequenced last.*

---

## 7.5 Implementation readiness & effort estimate

### 7.5.1 Definition of Ready (why this is implementable now, not just a vision)

- **Every feature maps to an existing SDK socket and a named new file** in `src/cline-sdk/` — no SDK fork,
  no private-state access ([§2](#2-architectural-guardrails-how-we-stay-upstream-mergeable)). The full
  new-file inventory is in [§7.5.2](#752-new-component-inventory).
- **Acceptance is objective:** the Phase 0 eval harness is the backbone — every later phase is "merged
  when the harness metric it targets improves and nothing regresses." This is also how we avoid
  over-building the optional pillars.
- **A boundary CI gate** (`git diff --exit-code node_modules/@clinebot` + a lint rule banning deep SDK
  imports outside `src/cline-sdk/`) makes the upstream-mergeable constraint enforceable, not aspirational.
- **A fast iteration loop exists from day one:** the Phase 0a Dev Test Project gives one-click autonomous
  runs + one-click evidence-path copy, so each increment is verified by running it and pointing a strong
  agent at the evidence — not by manual babysitting.
- **Phases are independently shippable and dependency-ordered:** Dev harness (0a) → MCSR + telemetry +
  eval harness (P0) → repo map (P1) → decomposition (P2) → self-improvement loop (2.5) → context hardening
  (P3) → routing/guard (P4) → autonomy (P5) → optional/advisor (P6/P7).

### 7.5.2 New component inventory

| File / surface | Phase | Purpose |
|----------------|-------|---------|
| `scripts/dev-fixtures/<template-repo>/` + `src/cline-sdk/cline-dev-test-project.ts` | 0a | Dev Test Project: scaffold + seed + autonomous run |
| `src/telemetry/evidence-bundle.ts` + pinned dev sidebar surface | 0a | Evidence bundle + one-click copy-path |
| `src/cline-sdk/cline-model-registry.ts` + session-service timing tap | 0 | MCSR: window + measured speed + capability EWMA |
| `test/eval/` small-model harness | 0 | Baselines + capability scoring |
| `src/telemetry/self-observation-sink.ts` | 0 | Structured local telemetry: bugs/errors/exceptions + inefficiency signals |
| card token/speed meter (`web-ui`) | 0 | Surface budget + wall-time |
| `src/cline-sdk/cline-repo-map.ts` | 1 | Tree-sitter ranked (PageRank) repo map |
| `src/cline-sdk/cline-retrieval-tools.ts` | 1 | `repo_map` / `search_code` tools |
| `src/cline-sdk/cline-decomposition-tool.ts` | 2 | `decompose_project` / `expand_task` |
| `src/cline-sdk/cline-plan-artifacts.ts` | 2 | spec/plan/task-graph schemas + disk I/O |
| Planning lane | 2 | `api-contract.ts` column enum, `web-ui/src/state/board-state.ts`, `task decompose` command |
| `src/cline-sdk/cline-dogfood-engine.ts` + "Suggest an improvement" UI | 2.5 | telemetry → guard-checked, eval-gated self-improvement cards (safety-railed) |
| compression + proactive-budget extensions | 3 | extend `cline-context-focus-policy.ts` / `cline-context-overflow-compaction.ts` |
| `src/cline-sdk/cline-task-router.ts` | 4 | capability routing + no-unrealistic-tasks guard |
| roster/roles config | 4 | extend `src/config/runtime-config.ts` + settings UI |
| `model-tool-routing` rules + scheduler | 4 | per-model toolset + concurrency/serialization |
| acceptance-gate + repair/escalation + `web_research` | 5 | wire to hooks, auto-review, `maxConsecutiveMistakes` |
| `src/cline-sdk/cline-code-index.ts` | 6 | optional local-embedding RAG |
| `src/cline-sdk/cline-model-research.ts` + `check-models` | 7 | model-freshness suggestions |
| `src/cline-sdk/cline-advisor.ts` + MCP-discovery / config / log buttons | 7 | LLM-assisted, user-triggered advisor surface |

### 7.5.3 Rough effort estimate — GPT-5.5 on *medium*

**Assumptions:** the work is itself decomposed into ~80–120 Kanban cards and driven mostly autonomously
by GPT-5.5 (medium reasoning) with **one human reviewing/merging and steering a few hours a day**; the
Phase 0 eval harness exists early so cards have objective acceptance; CI is green between merges.

| Phase | Scope | Agent-execution estimate |
|-------|-------|--------------------------|
| 0a | Dev Test Project + evidence bundle + copy-path (build first) | ~2–3 agent-days |
| 0 | MCSR + eval harness + telemetry sink + window/UI | ~5–7 agent-days |
| 1 | tree-sitter repo map + retrieval (fiddly: WASM grammars, ranking, budgeting) | ~5–8 agent-days |
| 2 | decomposition engine + planning lane + UI (cross-cutting, prompt iteration) | ~6–9 agent-days |
| 2.5 | self-improvement loop (Dogfood Engine) + safety rails + "suggest improvement" UI | ~4–6 agent-days |
| 3 | proactive budgeting + code-safe compression | ~3–5 agent-days |
| 4 | roster/roles + router/guard + tool-routing + scheduler | ~5–8 agent-days |
| 5 | gates + repair/escalation + `web_research` + test-first | ~4–6 agent-days |
| **Core total (0a–5, incl. 2.5)** | | **~34–52 agent-days** |
| 6 | optional embeddings / LLMLingua / teams (only if earned) | ~+3–5 agent-days |
| 7 | advisor surface: model freshness + MCP discovery + config/log helpers | ~+4–7 agent-days |

**Translating to wall-clock:** with one human in the loop for review/CI/integration friction (~1.3–1.6×),
the **core (Phase 0a–P5, incl. the dev harness and the early self-improvement loop) is roughly 7–12
calendar weeks**; the full plan including optional Phase 6–7 is **~9–14 weeks**. In raw model-execution
terms that's on the order of **~150–260 hours of GPT-5.5-medium agent time** for the core. The Phase 0a dev
harness pays for itself quickly by cutting the verify-time on every later phase.

**Caveats that move the estimate:**
- The long poles are the *empirical* pieces — repo-map quality, decomposition correctness, the
  router/guard, and compression fidelity — which need eval-driven iteration, not just code volume. Budget
  extra time there; the CRUD/UI/config cards are fast.
- Run **planning/architecture and decomposition cards at *high* reasoning effort** even if the bulk
  implementation cards run at medium — getting the spec/DAG right upstream saves far more downstream.
- Estimate assumes the installed `@clinebot/*` SDK keeps its current extension surface; a major upstream
  SDK shift mid-build would add re-integration time (mitigated by the thin boundary layer).

---

## 8. Risks, trade-offs, and how we de-risk

| Risk | Mitigation |
|------|------------|
| **Scope creep / over-engineering** (embeddings, LLMLingua, teams are all tempting) | Each is gated behind a measured "does the cheap version already win?" check. Aider ships *only* the ranked map — we default to the same and earn complexity with data. |
| **Upstream merge pain** | Every feature is a `src/cline-sdk/` plug-in on an official socket. CI check: no diffs under `node_modules/@clinebot/*`; boundary review on every PR ([§2](#2-architectural-guardrails-how-we-stay-upstream-mergeable)). |
| **`npx kanban` zero-install must survive** | Prefer WASM tree-sitter + lazily-fetched-and-cached embedding models over native builds. No mandatory heavy deps in the hot path. |
| **Compression corrupts code** | Never token-prune code; use signatures/minify for code, caveman only for prose. Verify with the eval harness. |
| **Small models still fail on truly hard tasks** | That's expected and *fine* — the escalation ladder (P5) routes hard cards to a strong role or a human. "Mostly autonomous" = the easy 80% is hands-off, the hard 20% stops and asks. |
| **Local-model parallelism melts the machine** | Per-endpoint serialization + concurrency caps ([§6.4](#64-parallelism--orchestration)). |
| **Embedding index staleness / cost** | Incremental re-index by file hash/mtime; index lives in `~/.cline/kanban`, rebuildable, never blocking a task start. |
| **MCSR cold-start (no data for a freshly connected model)** | Seed from static family priors + an optional warmup probe + the first eval-harness run; route *conservatively* (treat unknown capability as lower) until enough real requests accrue into the EWMA. |
| **Difficulty/capability mis-estimate routes a task wrong** | Errs toward route-up/decompose, never down; the P5 cascade re-routes up on verification failure; user override (still guard-checked) is always available. The guard is fail-safe: when unsure, it decomposes or asks rather than running blind. |
| **Model-freshness leaderboard sources change/break or run offline (P6)** | Source allow-list + cached last-known results + graceful offline degradation; recommendations are advisory and never auto-applied. |
| **Self-modifying agent (P7) ships a regression or weakens its own safety** | Propose-never-self-merge: candidate branch in an isolated worktree, eval-harness + full test gate, human review before merge; security/sandbox/permission code can never be auto-committed; the engine cannot edit its own gates/redaction without sign-off; DGM-style attempt archive for auditability. A frozen known-good baseline always exists. |
| **Self-improvement loop wastes compute on low-value churn** | Triage ranks by frequency × severity × expected effort; rate-limited and concurrency-capped; the eval gate means only metric-improving changes merge; human "Suggest an improvement" input steers priority. |
| **MCP suggestions install an insecure/malicious server (P8)** | ~37% SSRF / ~43% unsafe-exec / ~41% no-auth in the wild — so suggestions carry a trust signal (auth, maintenedness, permissions requested), default to an allow-list, and require explicit user confirmation; never auto-install. |
| **Advisor buttons (P8) sprawl into always-on background agents** | Hard rule: P8 is user-triggered only, one shared thin `cline-advisor.ts` helper, no standing LLM load, suggestions applied only on explicit click. |

---

## 9. Success criteria (what "great" looks like)

1. **Decomposition:** a project-scale prompt yields a reviewable spec + plan + a correctly dependency-
   linked DAG of cards, each passing the task-sizing contract ([§3.3](#33-the-task-sizing-contract-the-small-model-critical-part)).
2. **Small-model task pass rate:** `qwen3.5-9b @ 16k` completes a target % of generated worker-cards
   end-to-end (build/typecheck/tests green) without human intervention — tracked from the Phase 0
   baseline.
3. **Overflow rate → near zero** on the eval suite at 8–16k (proactive budgeting + retrieval-over-reading).
4. **Autonomous chains:** a multi-card DAG runs to completion (auto-start → gate → commit → next) with
   human attention only on escalations.
5. **Capability guard holds:** in the eval suite, **zero** tasks ever start on a model that can't fit or
   can't handle them — infeasible tasks are auto-decomposed (or parked with a clear reason), never run
   blind; and a hard task is never assigned to a small model while a bigger connected one exists.
6. **Fully model-aware:** changing a task's assigned model immediately rescales its budgets, compression,
   repo-map size, and scheduling from the MCSR — a grep of the codebase finds **no hardcoded context-size
   or speed constants** in the context/routing paths.
7. **Self-improvement flywheel runs safely:** Kanban turns its own telemetry into eval-gated improvement
   cards against its own repo; every self-change passes the eval harness + tests in an isolated worktree
   and (by default) human review, security-critical code is never auto-committed, and the loop is auditable
   back to the telemetry that motivated it. Over time, the small-model task-pass rate and complexity
   ceiling trend *up* without proportional human effort.
8. **Upstream-clean:** we can re-pull Cline Kanban without reverting our work.

---

## 10. Appendix — external references

**Cline SDK (our substrate):**
[SDK overview](https://docs.cline.bot/sdk/overview) ·
[announcement](https://cline.bot/blog/introducing-cline-sdk-the-upgraded-agent-runtime) ·
[`@cline/agents`](https://www.npmjs.com/package/@cline/agents) ·
[cline/cline `/sdk`](https://github.com/cline/cline/tree/main/sdk) ·
[Cline CLI + Kanban](https://cline.bot/cli).

**Decomposition / spec-driven:**
[GitHub Spec Kit](https://github.github.com/spec-kit/) ·
[Spec Kit walkthrough](https://developer.microsoft.com/blog/spec-driven-development-spec-kit) ·
[claude-task-master](https://github.com/eyaltoledano/claude-task-master) ·
[task structure](https://github.com/eyaltoledano/claude-task-master/blob/main/docs/task-structure.md) ·
[BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD) ·
[2026 SDD tool comparison](https://www.marktechpost.com/2026/05/08/9-best-ai-tools-for-spec-driven-development-in-2026-kiro-bmad-gsd-and-more-compare/).

**Codebase mapping / RAG:**
[aider repo map docs](https://aider.chat/docs/repomap.html) ·
[aider repo map (tree-sitter)](https://aider.chat/2023/10/22/repomap.html) ·
[aider repo map internals](https://deepwiki.com/Aider-AI/aider/4.1-repository-mapping-system) ·
[RepoMapper port](https://github.com/pdavis68/RepoMapper) ·
[web-tree-sitter](https://www.npmjs.com/package/web-tree-sitter) ·
[fastembed-js](https://www.npmjs.com/package/fastembed) ·
[transformers.js](https://www.npmjs.com/package/@xenova/transformers) ·
[Node embeddings how-to](https://philna.sh/blog/2024/09/25/how-to-create-vector-embeddings-in-node-js/) ·
[tree-sitter semantic indexing](https://medium.com/@email2dineshkuppan/semantic-code-indexing-with-ast-and-tree-sitter-for-ai-agents-part-1-of-3-eb5237ba687a).

**Context compression:**
[Caveman compression](https://github.com/wilpel/caveman-compression) ·
[Caveman overview](https://betterstack.com/community/guides/ai/caveman-llm/) ·
[LLMLingua](https://github.com/microsoft/LLMLingua) ·
[LLMLingua-2 paper](https://arxiv.org/pdf/2403.12968) ·
[LongCodeZip (code-aware)](https://arxiv.org/pdf/2510.00446) ·
[prompt-compression techniques](https://www.morphllm.com/prompt-compression).

**Small / local models:**
[Qwen models & context guidance](https://www.digitalapplied.com/blog/qwen-3-6-plus-1m-context-always-on-cot-guide) ·
[Qwen on OpenRouter](https://openrouter.ai/qwen).

**Capability-aware routing, task difficulty & escalation:**
[RouteLLM (LMSYS)](https://www.lmsys.org/blog/2024-07-01-routellm/) ·
[RouteLLM paper](https://arxiv.org/pdf/2406.18665) ·
[Dynamic model routing & cascading survey](https://arxiv.org/html/2603.04445v1) ·
[kNN beats learned routers](https://arxiv.org/pdf/2505.12601) ·
[Measuring AI ability to complete long tasks (METR)](https://arxiv.org/html/2503.14499v1) ·
[Agent Psychometrics / IRT task prediction](https://arxiv.org/html/2604.00594v1) ·
[Human-in-the-loop escalation design](https://www.digitalapplied.com/blog/human-in-the-loop-escalation-design-ai-agents-2026).

**Model leaderboards & speed (for MCSR capability blend + P6 freshness):**
[Artificial Analysis](https://artificialanalysis.ai/) ·
[llm-stats leaderboard](https://llm-stats.com/leaderboards/llm-leaderboard) ·
[OpenRouter](https://openrouter.ai/) ·
[local LLM throughput benchmarking](https://localaimaster.com/blog/benchmark-local-ai-setup) ·
[ollama tokens/sec benchmark tool](https://github.com/MinhNgyuen/llm-benchmark).

**Self-improving agents & telemetry (P7):**
[Darwin Gödel Machine (Sakana, ICLR 2026)](https://arxiv.org/abs/2505.22954) ·
[DGM overview](https://sakana.ai/dgm/) ·
[AgentTrace structured agent logging](https://arxiv.org/html/2602.10133v1) ·
[AI agent observability guide](https://www.groundcover.com/learn/observability/ai-agent-observability) ·
[LangChain agent observability](https://www.langchain.com/resources/agent-observability).

**MCP discovery & registries (P8):**
[best MCP registries 2026](https://www.truefoundry.com/blog/best-mcp-registries) ·
[mcp.so](https://mcp.so/) · [Smithery](https://smithery.ai/) · [glama.ai/mcp](https://glama.ai/mcp) ·
[GitHub MCP Registry](https://github.blog/ai-and-ml/github-copilot/meet-the-github-mcp-registry-the-fastest-way-to-discover-mcp-servers/) ·
[awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers).

**Internal design docs to build on:**
[`.plan/docs/planning-column-research.md`](.plan/docs/planning-column-research.md) ·
[`.plan/docs/ideation-chat.md`](.plan/docs/ideation-chat.md) ·
[`.plan/docs/cline-sdk-native-integration-plan.md`](.plan/docs/cline-sdk-native-integration-plan.md) ·
[`AGENTS.md`](AGENTS.md).
