# Decomposition validity — research reference (todo §5 decomposition theory)

Folds the three research strands (project-management theory, LLM-planning literature, practitioner experience) into
actionable findings for !Klein's decompose path, and maps them onto the machinery we already have
(`assessNKleinPlanTaskGraphQuality`, the `breakDependencyCycles` net, the `decompose_project` tool schema) and the
candidate design directions. The goal: an architect model emits a task graph that is **valid** (acyclic, rooted,
connected, coherent), **complete** (covers the work), and **startable** (leaf cards a worker can actually run) — and
when it doesn't, !Klein repairs rather than bounces the model.

## 1. Project-management theory — the mature, directly-applicable bodies of work

- **WBS 100%-rule + MECE.** A Work Breakdown Structure decomposes the *deliverable* such that children sum to exactly
  the parent (the 100%-rule) and are mutually exclusive / collectively exhaustive. Applied here: the sum of a plan's
  cards should cover the spec's foundation scope with no overlap and no gap. This is the completeness axis
  `assessNKleinPlanTaskGraphQuality` should score — not just "is it a DAG" but "does it cover the stated scope".
  Practical lever: a **WBS-guided prompt** that lists the spec's scope bullets and asks the architect to map each to
  ≥1 card (the generated lower-20 scenario sets already do this shape: one card per foundation concern).
- **DSM (Design/Dependency Structure Matrix) + tearing/partitioning.** The most directly-applicable body of work: a
  square task×task matrix of "must precede" marks, with mature algorithms to **partition** (topologically order into
  sequential blocks) and, for cycles, **tear** (choose a minimal set of feedback edges to remove/defer so the matrix
  becomes lower-triangular = acyclic). This is precisely what `breakDependencyCycles` does; the DSM literature frames
  the *right* objective — a **minimum feedback arc set** (remove the fewest/lowest-cost edges to acyclify), not an
  arbitrary edge. Upgrade path: score candidate tears by how few dependents they strand.
- **PERT/CPM + critical path.** Once acyclic, the critical path is the longest dependency chain — it bounds wall-clock
  even with infinite parallelism, and is exactly why the `deep_chain` preset serializes (§11002 finding). Useful as a
  UI/telemetry signal ("this plan is N-deep; only 1 card startable at a time") and to warn on needlessly-deep chains.
- **Story-mapping / vertical slices.** Prefer a few end-to-end **release-quality vertical slices** over many shallow
  horizontal placeholders — the dev-test specs already demand this ("prefer fewer production-quality slices over many
  labels"). A validity check can flag a plan that is all-scaffold-no-slice.

## 2. LLM-planning literature — techniques + failure taxonomies

- **HTN (Hierarchical Task Network) planning** and **LLM+P** (LLM emits a formal plan, a classical planner/validator
  checks it): the enduring lesson is *separate generation from validation* — let the model draft, then check with a
  deterministic validator and feed violations back. !Klein already has the validator (`taskGraphSchema` + coherence
  checks); the leverage is the **feedback loop** quality.
- **Tree/Graph-of-Thoughts, ADaPT (As-Needed Decomposition), Plan-and-Solve, self-refine/critic loops.** Two robust
  patterns: (a) **decompose only as needed** — don't over-plan; expand a card into subcards when it proves too big
  (ties the §5 redecompose-on-too-hard path the review runner already triggers); (b) a **critic pass** that reviews the
  plan against explicit criteria before committing (our repair+critic direction #3).
- **Constrained decoding for structure.** Emitting into a tool-call schema (or a DAG grammar) makes many invalid graphs
  *unrepresentable*. Caveat from §5.AN (live-found): LM Studio silently ignores top-level GBNF `grammar`;
  `response_format: json_schema` is the only constrained-decode lever there, and reasoning models over-reason and land
  the structured answer in the tool call / `reasoning_content`, not prose (confirmed again 2026-07-10: qwen3-8b emits
  near-empty `content` with the decomposition in the tool call).
- **Failure taxonomies (MAST / TRAIL / agent-loop studies).** The recurring decomposition failure modes to detect +
  mitigate: **cyclic deps**, **orphan cards** (no path from a root), **no root** (every card depends on another),
  **under-decomposition** (one giant card), **over-decomposition** (trivial fragments), **scope drift** (cards outside
  the spec), and **boundary loops** (a card whose objective is blocked by the gates — the exact qwen3.6 `*.js`/`*.ts`
  loop, now detected by `agent-turn-loop.ts`). Each maps to a deterministic check.

## 3. Practitioner experience — how decomposing agents keep graphs valid

- **Devin / OpenHands / CrewAI / LangGraph / Claude subagent orchestration / Aider repo-map:** common threads —
  (a) a **repo/architecture map** grounds decomposition in real files (Aider's repo-map; our codebase-memory + the
  `filesLikelyTouched` field); (b) **explicit dependency edges** rather than inferred order (our inline `dependsOn`);
  (c) **small, independently-verifiable leaves** each with an acceptance check (our per-card `acceptanceCommand`);
  (d) **replan/expand on failure** instead of thrashing one giant task (our review-runner redecompose).
- The consistent postmortem lesson: invalid graphs come from the model *inventing* order or *omitting* the root, and
  the cheap fix is a **deterministic post-pass** (acyclify + reattach orphans + inject a root) plus a **critic** — not
  a smarter prompt alone.

## 4. Mapping the candidate design directions onto the above

| Direction | Grounded by | Verdict |
|---|---|---|
| (1) Incremental validated tool-call construction | HTN + constrained decode; "can't emit invalid" | Strongest guarantee, highest wiring cost; revisit if repair proves insufficient |
| (2) DAG-grammar constrained decode | constrained decoding | Blocked on LM Studio grammar support (§5.AN); `json_schema` only |
| (3) Hardened one-shot schema + repair+critic | LLM+P validate-and-feedback; DSM tearing; self-refine | **Current path — the pragmatic optimum.** Upgrade repair to minimum-feedback-arc-set tearing + orphan reattachment + no-root fallback |
| (4) Architect self-check tool | critic loops | Cheap add: a `validate_decomposition` tool the model must call before finishing |
| (5) WBS-guided prompt + worked examples | WBS 100%-rule; story-mapping | Cheap, compounding; pair with a scope-coverage score |

**Recommendation:** stay on direction (3), upgraded — (a) make `breakDependencyCycles` target a **minimum feedback
arc set** (fewest stranded dependents), (b) add **orphan-reattachment** + **no-root fallback** to the repair pass,
(c) add a **scope-coverage** score to `assessNKleinPlanTaskGraphQuality` (WBS 100%-rule against the spec's scope
bullets), (d) optionally add the (4) self-check tool. Decide each lever with an **eval harness** (already built:
`eval-prompt-corpus.ts` decompose family + `scoreValidDag`; extend with completeness + startability scores) — measure
before/after per lever across the fleet × presets, don't guess.

## 5. Deterministic checks the validator should enforce (the failure-taxonomy → check map)

- acyclic (DSM partition succeeds) · rooted (≥1 card with no deps) · connected (every card reachable from a root) ·
  no orphan (no card whose deps reference a non-existent id) · bounded fan (not one giant card; not all-trivial) ·
  scope-coverage (each spec scope bullet maps to ≥1 card) · startability (leaves have an acceptance command) ·
  no boundary loop (a card's objective isn't blocked by its own gates — cross-check against `agent-turn-loop`).

Converges with: §5.AB (role/decomposition selection) · §5.AN (constrained-decode map) · §5.AA (recover-in-!Klein) ·
`assessNKleinPlanTaskGraphQuality` · the shipped `breakDependencyCycles` net · the eval harness (`eval-prompt-corpus`).
