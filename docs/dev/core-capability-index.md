# Core capability index

> **GENERATED — do not edit by hand.** Regenerate with `nklein dev capability-index`.
> Search it with `nklein dev capability-index --search <term>` **before writing a new core**.

## Why this exists

One session produced three near-duplications: a significance test reimplemented (more weakly) beside the
existing one, an optimizer nearly duplicated, and two evaluation items specified from scratch when a core
written two weeks earlier already implemented their verdict logic.

The cause was not dead code — it was **discoverability**. A long orphan list reads as *too much unused
code*; the accurate reading is *a lot of built capability nobody can find*. Deleting it destroys value;
indexing it recovers value.

581 core modules.

| module | purpose | labels |
| --- | --- | --- |
| `ab-significance-gate.ts` | A/B significance gate (F12.41) — PURE decision core. | F12.41 |
| `acceptance-failure-taxonomy.ts` | Acceptance-failure classification taxonomy (todo.md §5.G). | §5.G |
| `action-fanout-cap.ts` | Action fan-out cap (Phase 7S / S9) — PURE decision core. | F3.21 F3.30 §5.L |
| `action-plan-executor.ts` | F3.T3 — execute an {@link ActionPlan} end to end. | — |
| `action-plan-ir-gbnf.ts` | GBNF grammar generator for the action-plan IR (todo §5.O — "grammar-constrained decoding for the IR"). | §5.AN §5.O |
| `action-plan-ir.ts` | Action-plan intermediate representation — a typed, validatable plan for multi-step tool workflows (todo §5.O). | §5.O |
| `adaptive-attempt-loop.ts` | The §5.AA adaptive-attempt DRIVER — the effectful loop that ties the retry-policy decision core together. | §5.AA |
| `adaptive-decomposition-decision.ts` | Adaptive (ADaPT-style) decomposition-granularity decision (todo §5.AB-(E) — the model-landscape-aware | §5.AB §5.AL §5.Z |
| `admissible-cited-synthesis.ts` | ADMISSIBILITY-gated cited synthesis — the guard that stands in FRONT of `assembleCitedAnswer` in the §5.AC "knows | §5.AC |
| `adw-run-api-contract.ts` | F12.107 — the ADW runner's wire contract (list definitions / start a run / poll run status). | F12.107 |
| `adw-workflow.ts` | F12.107 first-class ADW definitions — the PURE half. | F12.107 §5.AE |
| `agent-attempt-ledger.ts` | The Agent Attempt Ledger (todo §5.AF) — the keystone evidence substrate. | F1.16 F1.18b §5.AA §5.AB §5.AC §5.AD §5.AF §5.O §5.Z |
| `agent-catalog.ts` | (no docblock) | P0.9c §5.A |
| `agent-ledger-efficiency.ts` | §5.AW efficiency scoreboard (audit 2026-07-02 W1.4) — the ledger-derived rollup that makes swarm waste VISIBLE. | W1.1 W1.4 §5.AG §5.AW |
| `agent-ledger-projections.ts` | Projections that bridge the Agent Attempt Ledger (§5.AF — the ONE evidence stream) to the learning/selection layers, | §5.AA §5.AF §5.Z |
| `agent-ledger-selectors.ts` | The current controller run-state for a workflow — the `to` of its most-recent transition (by `recordedAt`), or null | §5.U |
| `agent-rulesets.ts` | Per-role agent rulesets: two independent, tiered dials that let the user "unleash" the swarm while keeping | — |
| `agent-stuckness.ts` | Failure outcomes that usually reflect a fixable OUTPUT-FORMAT slip (or a transient SDK/endpoint abort) — the model | §5.AA §5.AB §5.AF §5.AK |
| `agent-turn-loop.ts` | (no docblock) | §5.AF §5.AG |
| `agent-write-guard.ts` | `maxAgentWritableFileLines` is a SOFT target (the push-against point), NOT a hard wall — a write may exceed it when a | — |
| `air-gap-posture.ts` | Air-gap posture assessment (F12.101 first slice) — PURE core. | F12.101 |
| `answer-budget-learn.ts` | §5.AD (output sibling) — LEARN the per-(model, task-class) output/answer budget from observed token consumption. | §5.AA §5.AD |
| `answer-budget-prior.ts` | PROACTIVE answer-budget sizing (todo §5.AD "Size UP-FRONT"). | §5.AA §5.AD §5.AF |
| `answer-budget-projection.ts` | F4.10 — project observed answer sizes (output tokens) per model from the §5.Q model-performance observations, so | F4.10 §5.Q |
| `anti-decomposition-guard.ts` | F12.37 anti-decomposition guard — PURE core. | F12.37 |
| `api-contract.ts` | (no docblock) | §5.M §5.X |
| `api-validation.ts` | (no docblock) | — |
| `apple-silicon-probe.ts` | F12.75 (effectful half) — probe the LOCAL machine for the Apple-Silicon GPU-wiring ceiling. | F12.75 |
| `apple-silicon-vram.ts` | F12.75 Apple-Silicon wired-memory enrichment for load routing — PURE core. | F12.75 |
| `architect-editor-split.ts` | F12.62 — Architect/Editor split per card (the biggest documented small-model win). | F12.62 |
| `assumption-safety.ts` | Assumption-safety decider (todo.md §5.S) — the pure "clarify vs. | §5.S |
| `attempt-idempotency-key.ts` | Attempt idempotency-key derivation + dedup (todo.md §5.AF — the durable scheduler / Agent Attempt Ledger). | §5.AF |
| `attempt-model-selection.ts` | F3.7 (pure core / a-leaf) — attempt-start model selection over the learned `ModelBehaviorProfile`s. | F3.7 |
| `attempt-progress-tracker.ts` | The §5.AA cross-attempt PROGRESS tracker — the pure primitive that answers "did the last remedy actually improve | §5.AA §5.AB |
| `audio-vst-rubric.ts` | §5.B — the SCORING rubric for the audio-VST psytrance dev-test fixture (the preset + harness are shipped; this is the | §5.B |
| `auto-clarify.ts` | Auto-clarify loop core (todo.md §5.S) — the pure decision logic for resolving a card's open clarifying | §5.B §5.K §5.S |
| `auto-decomposition-depth.ts` | F4.38 — feed REAL budget + complexity into AUTO decomposition depth (pure). | F4.38 |
| `auto-loaded-model-registry.ts` | F1.23 — the registry of models !Klein AUTONOMOUSLY loaded (via the NKLEIN_DEVICE_RAM_GB machine-aware loader), | F1.23 |
| `autonomous-timeout-defaults.ts` | Resolve the OS power-mode multiplier for the autonomous timeout defaults (Low Power ≈ ×2). | — |
| `background-eval-admission.ts` | §5.AI idle-aware admission gate for the always-on dev-test evaluation rail. | §5.AF §5.AG §5.AI |
| `background-eval-controls.ts` | F1.35 (§5.AI) — rail CONTROLS + STATUS, the pure core: an enable/pause control reducer that tells the host | F1.31 F1.31b F1.35 §5.AI |
| `background-eval-evidence-feed.ts` | F1.32b evidence feed — the fitness-row → coverage-probe mapping that makes the rail picker's EVIDENCE mode | F1.32b §5.AB |
| `background-eval-runner-signals.ts` | Pure derivation of the §5.AI background-eval runner's admission SIGNALS from a snapshot of live runtime state. | §5.AI |
| `background-eval-runner.ts` | §5.AI durable background-eval runner CORE — the brain of the always-on dev-test rail, with every effect INJECTED so | F1.32b §5.AF §5.AI |
| `background-eval-selection.ts` | F1.32 (§5.AI) — the rail's TARGET picker: which (project, model) pair the background-eval service should run | F1.31b F1.32 F1.35 §5.AI |
| `basic-memory-note-parse.ts` | F5.2 (pure core, effectful-reader companion) — parse ONE raw basic-memory markdown note into the | F5.2 |
| `basic-memory-note-reader.ts` | F5.2 (effectful b-leaf) — read the on-disk basic-memory knowledge base into {@link AuditableMemoryNote}s for the | F2.9b F5.2 |
| `basic-memory-provenance.ts` | §5.AR — provenance stamping + provenance-weighted RECALL for authored (basic-memory) notes. | §5.AR §5.AW |
| `basic-memory-scoping.ts` | §5.AR — pure scoping + egress-hardening plan for the basic-memory MCP server. | §5.AR |
| `board-api-contract.ts` | (no docblock) | §5.K §5.X |
| `board-chat-digest.ts` | §5.AT STEP 2 — build the board→chat digest MESSAGE from a set of surfaced feedback items (the output of | §5.AG §5.AT §5.AU |
| `board-chat-feedback.ts` | §5.AT — the pure decision heart of board→chat feedback: given a board/card STATE TRANSITION (prev vs next normalized | §5.AT |
| `board-streams-summary.ts` | §5.AU — compose a board into its per-STREAM overview: for each stream, the member cards + their rolled-up status | §5.AU |
| `bulk-seed.ts` | F12.109 bulk fan-out seeding — the PURE substitution/parsing halves, shared by the `task seed-bulk` CLI and | F12.109 |
| `cache-aware-prompt-layout.ts` | Cache-aware prompt layout (todo §5.AQ item D) — the PURE guard that keeps the system-prompt PREFIX byte-stable so | §5.AQ |
| `cache-friendly-arch.ts` | Cache-friendliness PRE-filter from the model id (todo §5.AQ item E) — a cheap, pure heuristic that classifies a | §5.AQ |
| `cache-friendly-route.ts` | Cache-friendly variant routing (todo §5.AQ item E — the adaptation playbook). | §5.AQ |
| `cache-health.ts` | Cache-HEALTH probe interpreter (todo §5.AQ item E) — the PURE math that decides whether a local runtime is actually | §5.AB §5.AL §5.AQ |
| `cache-prefix-retention.ts` | Prompt-cache PREFIX RETENTION / EVICTION policy (todo §5.AQ item E — the swarm "parallel slots EVICT each other's | §5.AD §5.AE §5.AF §5.AQ |
| `cache-prefix-reuse.ts` | Prompt-cache prefix-reuse ESTIMATOR (todo §5.AQ item D — the cache-aware-layout axis). | §5.AD §5.AE §5.AQ |
| `cache-stable-prefix-order.ts` | Cache-stable prefix ORDER planner (todo §5.AQ item D — the byte-stable-prefix LAYOUT lever). | §5.AD §5.AE §5.AQ |
| `cache-warmth.ts` | §5.AQ strategies (a)+(d)+(b) — CACHE-WARMTH-AWARE routing (session stickiness, session-kind batching, context | §5.AB §5.AQ |
| `cache-warmup-amortization.ts` | Prefix-cache warm-up AMORTIZATION / breakeven decision (todo §5.AQ — item H Tier 0 "healthy prefix caching … nothing | §5.AF §5.AQ |
| `candidate-tournament.ts` | Best-of-N candidate selection: clustering + recursive tournament voting (F12.94, todo §5.AW). | F12.94 §5.AW |
| `capability-blend.ts` | Blend a candidate's registry `baseCapability` with its LEDGER-observed success rate, preferring per-(model, role) | §5.AB |
| `capability-broker-gate.ts` | Shared capability-broker GATE (§5.L) — the ONE pure decision both the chat tool executor and the swarm tool path | §5.L |
| `capability-broker-manifest-input.ts` | Capability-broker FROM-MANIFEST constructor (todo §5.AF — the ergonomic manifest adapter for the §5.L keystone). | §5.AF §5.L |
| `capability-broker.ts` | Capability broker — the §5.L context-aware decision core (todo §5.L "Capability broker (pure decision core)" → the | §5.L |
| `capability-ceiling-advisory.ts` | F12.105 honest hybrid capability-ceiling advisory — the CARD-LEVEL, honesty-first counterpart to F3.35's | F12.105 F3.35 |
| `capability-ceiling-recommendation.ts` | F3.35 — capability-ceiling model recommendations (pure). | F3.34 F3.35 |
| `capability-escalation.ts` | Capability-escalation detector (todo §5.L — "Capability broker (pure decision core)" → the fail-closed pre-check | §5.L |
| `capability-grants.ts` | F2.2 (§5.L) — capability GRANTS with least scope + bounded duration, and the retry-never-widens rule by | F2.2 §5.L |
| `capability-index.ts` | Capability index — extract each core module's PURPOSE so existing capability is findable. | F12.28 F12.35 F12.41 F12.82 P20.2 P20.5 §5.AQ |
| `capability-prior-from-catalog.ts` | §5.AB capability PRIOR from the §5.AL catalog — the principled complement to the best-effort routing bridge | §5.AB §5.AL |
| `card-action-trail.ts` | F12.55 plain-language, artifact-anchored action trail — PURE core. | F12.55 |
| `card-effort.ts` | F12.58 per-card cost/effort meter — PURE core. | F12.58 |
| `card-message-effect.ts` | §5.AU STEP 6a — decide what a message SENT TO A CARD actually does, keeping COMMUNICATION decoupled from EXECUTION | §5.AS §5.AU |
| `card-pause.ts` | (no docblock) | — |
| `catalog-update-decision.ts` | §5.AB llmfit-catalog update DECISION — the pure decider behind "check GitHub for a newer catalog and SUGGEST an | §5.AB |
| `chat-api-contract.ts` | tRPC contract for the board-independent unified chat agent (todo §5.M). | §5.AE §5.AT §5.AU §5.M |
| `chat-multimodal.ts` | F2.7 (§5.M) — capability-gated MULTIMODAL chat, the pure cores: images first, audio/PDF stay refused until a | F2.7 §5.M |
| `chat-session-skill-profile.ts` | §5.AE chat-session skill profile (pure) — resolve a chat session's USER-SELECTED skill ids into a merged | §5.AE |
| `citation-conflict-annotation.ts` | F4.5 — annotate a rendered synthesis with the resolved source conflicts. | F4.5 |
| `citation-conflict-authority.ts` | F4.5 — resolve a citation conflict by preferring the newer, MORE-AUTHORITATIVE source, while RETAINING the minority | F4.5 |
| `citation-conflict-batch.ts` | §5.AC batch recency tie-break — the "resolve MANY conflict groups at once" fan-out over | §5.AC |
| `citation-conflict-detection.ts` | F4.5 — DETERMINISTIC claim-conflict detection: group a flat list of keyed claims into conflict clusters WITHOUT asking | F4.5 |
| `citation-conflict-recency.ts` | §5.AC recency tie-break — the "prefer newer in conflicts" half of citation verification. | §5.AC |
| `cited-source-freshness.ts` | §5.AC — stamp CITED sources with a freshness judgment (pure). | §5.AC |
| `cited-synthesis.ts` | Cited-answer assembly for the §5.AC retrieval loop — the "synthesize → CITE" step. | §5.AC |
| `claim-admissibility.ts` | §5.AC CLAIM-ADMISSIBILITY gate — the AND of the two independent "may we assert this?" axes the lighthouse defines: | §5.AC |
| `claim-corroboration-requirement.ts` | Per-claim CORROBORATION-requirement gate — the "does this claim have enough INDEPENDENT backing to assert?" half of | §5.AC |
| `clarification-answer.ts` | Project a user's manual clarification answer onto a plan-artifact question. | §5.B §5.S |
| `clarification-count.ts` | (no docblock) | §5.B §5.S |
| `clarification-need.ts` | Clarification-need detector + policy (todo.md §5.S) — the pure ENTRY GATE to the auto-clarify loop. | §5.S |
| `clarification-option-set.ts` | Clarification option-set preparer (todo.md §5.S) — the pure data layer behind the manual-mode clarifying dialog. | §5.S |
| `coalescing-scheduler.ts` | A tiny throttle-coalescer: bounds a frequently-requested side effect to **at most one run per window**, always using | §5.AI |
| `codeact-gating.ts` | F12.26 — capability-gated CodeAct (executable code actions). | F12.26 |
| `compiler-diagnostics.ts` | F12.86 multi-language compiler/type-check repair micro-loop — the PURE core. | F12.86 |
| `completion-stop-reason.ts` | §5.AN: normalize a completion's STOP-REASON across LM Studio's three request dialects into ONE actionable outcome (pure). | §5.AA §5.AN |
| `completion-usage.ts` | Defensive extraction of token USAGE from a raw OpenAI-/LM-Studio-style completion response. | F4.12 |
| `concurrency-config.ts` | Per-provider + per-model concurrency configuration (todo §5.W, user 2026-06-26). | §5.AB §5.T §5.W |
| `confidence-resource-routing.ts` | F3.33 — confidence- and resource-aware routing (pure). | F3.33 |
| `confidence-scorer.ts` | §5.AB / §5.K — calibrated-confidence scorer (pure core). | §5.AB §5.K |
| `config-api-contract.ts` | (no docblock) | §5.AB §5.L §5.W §5.X |
| `constraint-tax-strategy.ts` | F12.78 — "reason-free, constrain-late": decide HOW to get structured output from a model. | F12.78 |
| `content-addressable-cache.ts` | F12.32 — content-addressable caching for tool results + model responses (the determinism-BOUNDING half; | F12.32 F12.67 |
| `context-budget-knee.ts` | Learned quality-effective context-budget ESTIMATOR — the "quality knee" fit (todo §5.AD). | §5.AA §5.AD §5.AE |
| `context-compaction.ts` | Small-model-safe context compaction (todo §5.AQ item F) — summarization **compaction** + **tool-result clearing** | §5.AQ |
| `context-occupancy-pressure.ts` | Context-occupancy PRESSURE decider (todo §5.AD) — a multi-way triage over how full the context window is. | §5.AD §5.AE §5.W |
| `context-position-salience-risk.ts` | Lost-in-the-middle POSITION-salience-risk scorer (todo §5.AD) — quantify, per placement, how much attention a | §5.AD |
| `context-pressure-triage.ts` | F4.14 (pure core / a-leaf) — context-pressure TRIAGE: at runtime, decide `continue` / `compact` / `stop` for a turn | F3.1 F3.5 F4.10 F4.14 |
| `context-reanchor.ts` | End-of-context task re-anchor for long runs (todo §5.AD / §5.N — context management). | §5.AD §5.N |
| `context-size-advisor.ts` | §5.AQ B2 — the observation-based CONTEXT-SIZE ADVISOR. | §5.AQ |
| `context-size-recommender.ts` | The recommended MAX context tokens for this host/model/role, or null when no cap is warranted (the host keeps | §5.AF §5.Z |
| `context-smart-zone.ts` | Smart-zone context arrangement (todo §5.AD) — order assembled context for where models actually attend. | §5.AA §5.AD |
| `context-timing-projection.ts` | F4.9 — project the §5.AF attempt ledger into {@link ContextTimingObservation}s per model, so `recommendContextCap` | F4.9 §5.AF |
| `cost-per-resolve.ts` | Cost-per-resolve + Pareto frontier (F12.48) — PURE ledger projection. | F12.48 |
| `cron-match.ts` | Minimal 5-field cron matcher (minute hour day-of-month month day-of-week, LOCAL time) for the F12.106 | F12.106 |
| `cross-model-bounce.ts` | §5.AD cross-model bounce — the prompt substrate behind the enforced-reasoning gate's `cross_model_carry` kind: | §5.AD §5.K |
| `daw-foundation-rubric.ts` | F1.2 — the SCORING rubric for the DAW-foundation challenge preset (`daw_foundation` → | F1.2 |
| `decision-handoff.ts` | F12.38 compacted decision-handoff between dependent cards — PURE core. | F12.38 |
| `decompose-tool-policy.ts` | §5.B/§5.O decompose (plan-mode) TOOL-SET restriction — a decompose/plan card's ONLY job is to call `decompose_project` | §5.B §5.O |
| `decomposition-redecompose-trigger.ts` | Re-decompose trigger (todo §5.B — decomposition quality & the knowledge-expansion loop). | §5.AB §5.B §5.Z |
| `decomposition-stall.ts` | Decomposition turn-stall recovery decision core (todo §5.B/§5.G follow-up). | §5.B §5.G |
| `decomposition-subtask-dag.ts` | Decomposition subtask-DAG structural validator (todo §5.B — decomposition quality & the knowledge-expansion loop). | §5.AK §5.B §5.O |
| `deliberation-loop.ts` | §5.AW deliberation core (audit 2026-07-02 W4.1) — a bounded, decision-agnostic PROPOSE → CRITIQUE → RESOLVE loop | W4.1 §5.AB §5.AF §5.AW §5.S |
| `deliberation-trigger.ts` | §5.AW deliberation TRIGGER gate (audit 2026-07-02 W4.1) — deliberation is ON by default but fires RARELY | W4.1 §5.AW |
| `delivery-decision.ts` | Delivery-autonomy decision core (todo §5.L). | W4.2a §5.L §5.U |
| `delivery-evidence.ts` | FAIL-CLOSED delivery-gate evidence (audit 2026-07-02 W0.1). | W0.1 |
| `delivery-quality-gate-audit.ts` | Delivery-quality gate audit (pure) — gives the ported {@link aggregateGateAudit} a real, non-speculative consumer by | — |
| `delivery-quality-gate.ts` | Delivery quality gate (pure) — the bridge that composes the opencode-swarm-ported diff scanners | — |
| `dev-test-cleanup.ts` | Dev-test cleanup reporting (follow-up-6 §4.3). | — |
| `dev-test-outcome.ts` | Dev-test run outcome classification (follow-up-6 §3.4, §3.7, §5). | §5.B |
| `dev-test-sweep.ts` | Dev-test sweep orchestrator (todo §5.O) — run the dev-test scenarios across a set of presets, then | §5.O |
| `device-load-routing.ts` | §5.AB machine-aware load routing — the PURE device selector that keeps a model OFF a linked node it would SWAP. | §5.AB |
| `diagnostic-oracles.ts` | Diagnostic oracles (small-LLM research pass, 2026-06-27) — the two verdict cores that upgrade the dev-test rail | — |
| `diff-minimality.ts` | Diff-minimality metrics (F12.45 slice) — PURE core. | F12.45 |
| `diff-review-risk.ts` | F12.54 risk-aware review routing — PURE core. | F12.54 |
| `discriminative-tiebreak.ts` | F12.95 agentic discriminative-test tie-breaker — PURE core. | F12.94 F12.95 |
| `dispatch-reservations.ts` | F1.24 (§5.AF) — RESOURCE RESERVATIONS for dispatch: reserve what a card's session will consume BEFORE admission | F1.19 F1.24 §5.AF |
| `distractor-pruning.ts` | Distractor-aware retrieval pruning (§5.AD) — a PURE, generic ranker/pruner over any score-bearing retrieval results | §5.AA §5.AD |
| `diversity-reachability.ts` | §5.AB reasoning-diversity PRE-CHECK (audit 2026-07-02 follow-on): the self-review GUARD that answers a question | §5.AB |
| `drift-critic.ts` | F12.92 every-k-step drift critic — PURE core. | F12.21 F12.22 F12.42 F12.92 |
| `durable-admission.ts` | F1.19 (§5.AF) — SATURATION-AWARE durable admission: which ready jobs a scheduling wake should consider, given | F1.19 §5.AF |
| `durable-job-critical-path.ts` | The durable scheduler's CRITICAL-PATH / longest-remaining-chain analysis — pure core (todo §5.AF; the C3 durable | §5.AF §5.AG |
| `durable-job-depth-priority.ts` | The COMPOSITION adapter that makes {@link module:core/durable-scheduler-ready-order#orderReadyJobs} depth-aware | §5.AF |
| `durable-lease-idempotency.ts` | The COMPOSITION adapter that stamps a durable-scheduler `lease` action with its at-most-once idempotency key (todo | §5.AF |
| `durable-lease-renewal.ts` | Durable-lease RENEWAL / EXPIRY / STEAL decision — pure core (todo.md §5.AF; the C3 durable long-run scheduler). | §5.AF |
| `durable-run-controller.ts` | The durable multi-card run controller (todo §5.AF; the C3 "unattended + restart-survivable" milestone) — the | F1.19 §5.AF |
| `durable-run-ports.ts` | The durable-run PORTS factory (todo §5.AF; the C3 hot-path wiring seam) — builds a {@link DurableRunPorts} for the | §5.AF |
| `durable-run-reaction.ts` | Bridge: a task-session state change → the durable-run controller call the runtime should make (todo §5.AF, the C3 | F1.18 §5.AF |
| `durable-run-registry.ts` | Per-workspace registry of active durable runs + the summary→controller dispatch (todo §5.AF, the C3 live-wiring | F1.18 §5.AF |
| `durable-scheduler-backpressure.ts` | The durable scheduler's ENDPOINT-SATURATION BACKPRESSURE / ADMISSION-CONTROL policy — pure core (todo §5.AF, | §5.AF §5.AI |
| `durable-scheduler-ledger.ts` | The durable-scheduler ⇄ Agent Attempt Ledger adapter (todo §5.AF; the C3 boot-replay seam) — PURE. | §5.AA §5.AF |
| `durable-scheduler-ready-order.ts` | The durable scheduler's READY-JOB PRIORITY / ORDERING policy — pure core (todo §5.AF; the C3 durable long-run | §5.AB §5.AF §5.AI |
| `durable-scheduler.ts` | The durable long-run job scheduler — DECISION CORE (todo §5.AF; the C3 "unattended + restart-survivable" milestone). | F1.18b §5.AF |
| `ears-acceptance-criteria.ts` | F12.8 EARS-notation acceptance criteria + one-at-a-time clarification — PURE core. | F11.1 F12.8 F12.9 |
| `edit-syntax-guard.ts` | F12.63 post-edit syntax guard — PURE core. | F12.63 |
| `edit-thrash-detector.ts` | Single-file edit-thrash detector (F12.15's uncovered detector) — PURE core. | F12.15 |
| `ego-graph.ts` | F11.2c k-hop ego-graph localization — PURE core. | F11.2c |
| `egress-confirm-control.ts` | F2.3b — the pure request logic for the egress-confirm LOOPBACK control channel. | F2.3b |
| `egress-confirm-queue.ts` | F2.3 (§5.L I5) — the egress CONFIRM queue: the pure state machine behind the host↔proxy approval channel. | F2.3 §5.L |
| `egress-policy-decision.ts` | Egress / browser-access decision core (todo §5.L — "PROVENANCE/TAINT + a real EGRESS broker" → the **Egress broker** | §5.L |
| `egress-provenance-gate.ts` | Egress provenance gate (Phase 7S / S8) — PURE decision core. | — |
| `egress-proxy-audit.ts` | Egress-proxy per-attempt audit RECORD (docs/dev/egress-proxy-design.md §5 audit record; R5). | F2.5 |
| `egress-proxy-protocol.ts` | Egress-proxy protocol parsing (docs/dev/egress-proxy-design.md §5/§6 I1 — the pure head of the §5.L host-side | §5.L |
| `egress-proxy-verdict.ts` | Egress-proxy verdict composition (docs/dev/egress-proxy-design.md §5/§6 I1). | — |
| `egress-receipt.ts` | Egress receipts (F12.99) — PURE hash-chained receipt building + verification. | F12.99 |
| `egress-task-identity.ts` | F2.5 (§5.L) — per-task egress IDENTITY: the host issues each task session a proxy credential, hands it to the | F2.5 §5.L |
| `endpoint-iteration-loop.ts` | §5.AB endpoint-iteration — the retry-loop ORCHESTRATOR that ties the try-order decider, the per-endpoint clients, and | §5.AB |
| `enforced-reasoning-benefit.ts` | F3.16 — learn whether a model needs ENFORCED reasoning (pure). | F3.16 |
| `enforced-reasoning-gate.ts` | Enforced-reasoning gate + kind selector (todo §5.AD) — decide WHETHER to bounce a model through a reasoning loop, | §5.AA §5.AB §5.AD §5.AG §5.K §5.S |
| `enforced-reasoning-learning.ts` | §5.AD "learn whether a model NEEDS enforced reasoning" — the per-model learning that turns the §5.AD enforced-reasoning | §5.AB §5.AD |
| `enforced-reasoning-loop.ts` | §5.AD enforced-reasoning LOOP driver — the one effectful loop behind the gate's three kinds, pure over the | F3.15 §5.AD |
| `enforced-reasoning-round-stop.ts` | Enforced-reasoning ROUND stop policy (todo §5.AD) — the per-round CONTINUE\|STOP decider for an IN-FLIGHT reasoning | §5.AA §5.AD §5.AF §5.AG §5.K §5.S |
| `ensure-model-loaded.ts` | §5.AB machine-aware AUTONOMOUS LOAD — the effectful adapter that LOADS a task's model onto a linked device that FITS, | §5.AB §5.AL |
| `env-flag.ts` | Parse an environment-variable string as a boolean flag — the ONE shared implementation (previously copy-pasted four | §5.BB |
| `error-message.ts` | Stringify an unknown thrown value to a human-readable message — the ONE shared implementation (previously copy-pasted | — |
| `escalation-resume-action.ts` | F2.18 — map a hard-stuck escalation suggestion to the RESUME ACTION the operator takes, and pin the contract | F2.18 |
| `escalation-suggestions.ts` | Optional signals about WHY the task is stuck, used only to promote the most-likely fix to the front. | §5.A §5.AA §5.AB §5.AG §5.L §5.M §5.S |
| `eval-answer-extraction.ts` | Eval-answer EXTRACTION (§5.AB eval harness, todo 5913) — the pure bridge between a model's RAW text output and the | §5.AA §5.AB §5.AN |
| `eval-context-footprint.ts` | §5.AB/§5.AD — SIZE/CONTEXT FOOTPRINT variants for the eval corpus. | §5.AB §5.AD |
| `eval-fitness-fold.ts` | Fold an eval-cell OUTCOME into a §5.AB {@link ModelFitnessRecord} (todo §5.AB — "run a model through the matrix → | §5.AA §5.AB |
| `eval-freshness-decay.ts` | F3.26 — eval-cell FRESHNESS / DECAY + re-evaluation priority (pure). | F3.26 §5.AB |
| `eval-prompt-corpus.ts` | §5.AB — the EVAL PROMPT CORPUS: a small, hand-authored set of role × difficulty tasks with a deterministic answer | §5.AB §5.V |
| `evidence-currency-capture.ts` | F4.3 producer substrate — turn a retrieved web source into a {@link CurrencyEvidence} so | F4.3 |
| `evidence-currency-status.ts` | F4.3 — "is this current?" evidence-currency status (pure). | F4.3 |
| `execution-arbitration.ts` | F12.4 execution-based candidate arbitration — PURE core. | F12.4 §5.AW |
| `extraction-span.ts` | Extraction-span extractor for the §5.AC retrieval loop — "extract" step. | §5.AC |
| `failure-capsule.ts` | Failure capsules — PURE core for todo §5.AA(b). | §5.AA §5.AF §5.AG |
| `failure-hopelessness-from-errors.ts` | §5.AW hopelessness short-circuit, driven straight from RAW caught errors. | §5.AA §5.AW |
| `failure-hopelessness.ts` | §5.AW hopelessness short-circuit (audit 2026-07-02, swarm-behavior rank 10). | §5.AW |
| `failure-signature.ts` | The §5.AA failure-SIGNATURE classifier — map a RAW error/outcome text (a thrown error's message, an endpoint's error | §5.AA |
| `fast-memory-fit.ts` | Fast-memory spillover-cliff guard (todo §5.AQ item G — "avoid the spillover cliff"). | §5.AB §5.AQ |
| `fitness-projections.ts` | §5.AB — pure projections over the fitness table. | F1.1 F2.21 §5.AB |
| `fitness-routing-evidence.ts` | Fitness-table routing evidence (§5.AB live consumption; 2026-07-17). | §5.AB |
| `fitness-table-schema.ts` | §5.AB — the fitness table SCHEMA (pure). | F1.1 F2.22 §5.AB |
| `fitness-table-view.ts` | §5.AL fitness-table VIEW (pure) — the read-model behind the operator's fitness browser. | F2.22 §5.AL |
| `fixture-model-ids.ts` | Whether `modelId` is a synthetic fixture/test id that must be kept out of the live registry surfaces. | — |
| `flake-quarantine.ts` | §5.AI dev-test rail — per-test FLAKE-QUARANTINE policy (pure). | §5.AI |
| `fleet-aware-decomposition.ts` | F12.110 fleet-aware decomposition — the AVAILABLE model fleet as DIRECT decompose input, so cards are BORN | F12.110 F4.38 |
| `fleet-host-cap-config.ts` | (no docblock) | — |
| `fleet-host-observation.ts` | (no docblock) | — |
| `fleet-review-observation.ts` | (no docblock) | — |
| `focus-chain-diff.ts` | Focus-chain diff (todo.md §5.N) — given the previous and next state of an agent's focus chain, compute *what | §5.N |
| `focus-chain-nudge.ts` | §5.M / §5.N — the focus-chain NUDGE decision (pure core). | §5.M §5.N |
| `focus-chain.ts` | Per-agent focus chain (todo.md §5.N) — the agent-authored, ordered checklist it drafts at the start of a task | §5.N |
| `frontend-framework-preamble.ts` | Frontend framework-convention preamble (F12.89) — PURE core. | F12.79 F12.80 F12.89 |
| `gate-audit-metrics.ts` | Gate audit metrics (pure) — ported from opencode-swarm's gate-audit / gate-stats. | — |
| `git-history-api-contract.ts` | (no docblock) | §5.X |
| `git-process-env.ts` | (no docblock) | — |
| `git-sync-api-contract.ts` | (no docblock) | §5.X |
| `golden-set-drift.ts` | Golden-set drift watch (F12.49 final slice) — PURE core. | F12.49 |
| `golden-set-miner.ts` | Ledger-mined golden-set candidate selection (F12.49 slice) — PURE core. | F11.4 F12.42 F12.49 |
| `graceful-shutdown.ts` | (no docblock) | — |
| `hard-stuck-escalation.ts` | The attempt-stream signals for THIS stuck-point (outcomes / approaches / loop / retry budget / progress). | §5.AB §5.AG |
| `hard-task-wait.ts` | §5.AB wait-vs-attempt consumption — the pure gate behind the `hardTaskRoutingMode` setting. | §5.AB |
| `history-blind-corrector.ts` | F12.91 history-blind corrector role — a review pass that sees ONLY the objective + the proposed patch + | F12.91 |
| `home-agent-session.ts` | (no docblock) | — |
| `host-action-confirm-queue.ts` | F2.2b/F2.12b (§5.L/§5.M) — the HOST-ACTION confirm queue: the pure state machine behind an operator confirmation | F2.12b F2.2b §5.L §5.M |
| `host-open-intents.ts` | F2.6 (§5.M) — typed, allowlisted HOST-OPEN intents replacing the raw `runCommand` string surface. | F2.6 §5.M |
| `incremental-dag-construction.ts` | §5.AV — INCREMENTAL, VALIDATED graph construction: make an invalid decomposition (nearly) impossible to *emit*. | §5.AB §5.AV |
| `inference-lever-planning.ts` | F12.27 tool-role QUANTIZATION FLOOR + adaptive THINKING BUDGET (inference levers, feeds H7.32) — PURE core. | F12.27 |
| `inference-levers.ts` | Per-request inference speed+quality levers (todo §5.AQ item H) — the PURE decision core for the small-HW knobs that | §5.AB §5.AF §5.AL §5.AQ |
| `injection-audit-summary.ts` | Phase 7S / S11 — pure read-side summary of injection pre-screen events (from the injection-event store). | — |
| `instruction-reanchor.ts` | F12.21 instruction re-anchoring against context rot — PURE core. | F12.21 F12.56 F4.40 |
| `intent-merge-rung.ts` | F12.20b — the INTENT-MERGE rung: the last step of the edit-application ladder, taken only when the | F12.20b |
| `jit-fragment-budget.ts` | §5.AE JIT context-fragment BUDGET selection — the pure seam between "which fragments the active skills need" and | F4.17 §5.AD §5.AE §5.AG |
| `judge-calibration.ts` | LLM-judge calibration + bias harness (F12.50) — PURE core. | F12.50 |
| `judge-tool-policy.ts` | F4.37 companion — VERDICT-session TOOL-SET restriction (the second half of the judge-session diet). | F4.37 §5.B |
| `kanban-command.ts` | (no docblock) | — |
| `klein-self-corpus-provenance.ts` | F2.19 — freshness + provenance for the read-only !Klein self-awareness corpus. | F2.19 F2.20 |
| `klein-self-corpus-routing.ts` | !Klein self-awareness corpus ROUTER — the "which of !Klein's own planning docs should ground this answer?" gate of the | §5.AH |
| `knowledge-volatility-ttl.ts` | Knowledge-TTL / topic-volatility policy — the "how long does a fact stay trustable?" gate of the "knows today" | §5.AC |
| `kv-cache-size.ts` | KV-cache VRAM sizing + right-size-the-context recommendation (todo §5.AQ item G) — the #1 resource-frugality lever on | §5.AB §5.AQ |
| `kv-prefix-audit.ts` | F12.7 KV-cache prefix-volatility audit — PURE core. | F12.7 F4.40 |
| `language-capability-routing.ts` | Language- & task-type-aware model-size routing (F12.83, todo §5.AF / Phase 12). | F12.83 §5.AF |
| `language-toolchain-detection.ts` | F12.84 per-language environment + test-runner auto-detection — PURE core. | F11.2g F12.84 F12.86 |
| `learned-retry-budget.ts` | F3.30 — learned retry budgets (pure). | F3.30 §5.AA |
| `ledger-evidence.ts` | The per-(model, role) evidence key: the model key joined to the role by a NUL (U+0000) so it can't collide with any | — |
| `ledger-few-shot-exemplars.ts` | F12.81 ledger-sourced dynamic few-shot injection — PURE core. | F11.2h F12.81 §5.AQ |
| `ledger-replay-determinism.ts` | Replay-determinism checker for the Agent Attempt Ledger (todo.md §5.AF — "Replay / simulation mode"). | §5.AF §5.V |
| `live-agent-state.ts` | F12.51 differentiated live agent-state taxonomy — PURE core. | F12.51 §5.AG |
| `llmfit-adapter.ts` | Adapter for `llmfit` (todo §5.AB; MIT, https://github.com/AlexsJones/llmfit) — a local CLI that scores models for | §5.AB §5.AL |
| `llmfit-capability-prior.ts` | llmfit → cold-start capability PRIOR (todo §5.AB, user 2026-07-01: "llmfit will help to have a baseline for model | §5.AB §5.AL |
| `llmfit-catalog-supplement.ts` | Converts the explicit llmfit GitHub catalog cache into a NON-authoritative catalog supplement. | — |
| `llmfit-catalog-update.ts` | User-triggered llmfit catalog update check (§5.AB). | §5.AB |
| `llmfit-fitness-bridge.ts` | Bridge llmfit's FIT/SPEED estimates into §5.AB routing priors and reconcile llmfit's coarse tool-use tag against the | §5.AB §5.AL |
| `llmfit-roster.ts` | llmfit → AGENTIC roster planner (todo §5.AB / per-machine pools, user 2026-07-01 — "llmfit would help auto-selecting | §5.AB §5.AF §5.AL |
| `llmfit-runner.ts` | The ONE effectful place llmfit is actually invoked (todo §5.AB) — a thin shell-out that produces an injectable | §5.AB |
| `lms-link-status.ts` | Parse `lms link status --json` — the LM Link device roster: this host's name + every linked PEER's device id → name. | — |
| `lms-model-catalog.ts` | Parse `lms ls` (the DOWNLOADED-model catalog) into per-model {device, size} rows — the local half of the fleet | F3.35 |
| `lms-model-control.ts` | Guarded model-load PLANNER + `lms` command builders (todo §5.AF / §5.AB — the 2026-06-29 "let !Klein manage models" | §5.AB §5.AF |
| `lms-model-runner.ts` | Effectful guarded model runner (todo §5.AF / §5.AB — the 2026-06-29 load-handover). | F12.68 §5.AB §5.AF §5.AQ |
| `lms-ps-json.ts` | Parse `lms ps --json` — the RICH, machine-readable view of the currently-loaded model instances (todo §5.AB per-machine | §5.AB |
| `lms-session-stall.ts` | Model-aware stall decisions for live verification harnesses. | — |
| `lmstudio-capacity-report.ts` | (no docblock) | — |
| `lmstudio-keep-alive-ttl.ts` | Model keep-alive TTL SUGGESTION policy (todo §5.AN — the `ttl` (auto-evict) + JIT-loading lever, live-noted as a | §5.AB §5.AF §5.AN |
| `lmstudio-liveness.ts` | LM Studio liveness probe (todo §5.AN — the "never assume silence = death" guard, user 2026-06-30). | §5.AN |
| `lmstudio-loaded-model-descriptors.ts` | Rich descriptors for the currently-LOADED LM Studio models, read from the NATIVE `/api/v1/models` endpoint when | F2.7b §5.AB §5.AL |
| `lmstudio-loaded-models.ts` | "Only use ALREADY-LOADED models — never trigger a load" (user directive, 2026-06-28). | — |
| `lmstudio-log-anomalies.ts` | LM Studio dev-log anomaly detector (todo §5.Z, user 2026-06-28: "the test harness should keep an eye on the LM Studio | §5.Z |
| `lmstudio-max-tokens-clamp.ts` | Per-request `max_tokens` CLAMP policy (todo §5.AN — "get more out of every model", the pre-flight output-budget guard). | §5.AA §5.AB §5.AN §5.L |
| `lmstudio-request-stats.ts` | §5.AN: parse LM Studio's per-request inference `stats` from its native `/api/v0/chat/completions` response (pure). | §5.AB §5.AN |
| `lmstudio-response-format.ts` | §5.AN: build + validate LM Studio's `response_format` structured-output payload from an INJECTED target JSON Schema (pure). | §5.AN |
| `lmstudio-rest-model-client.ts` | §5.AN LM Studio REST model management — the IN-PROCESS alternative to `lms` CLI shell-outs, wired to the | §5.AN |
| `load-context-plan.ts` | Load-context planner (todo §5.AQ item G — the #1 VRAM lever) — decide what context-length to load a model AT, so | F12.68 §5.AB §5.AQ §5.L |
| `local-endpoint-clients.ts` | §5.AB endpoint-iteration — the effectful HTTP clients for the `anthropic_messages` + `native_v1_chat` endpoint kinds, | §5.AB |
| `local-messages-api-shape.ts` | §5.AB endpoint-iteration — the PURE wire-shape core for the `anthropic_messages` endpoint kind (a LOCAL model server | §5.AB |
| `local-model-endpoint-strategy.ts` | §5.AB endpoint-iteration STRATEGY — the pure try-order decider behind "some local model servers speak OpenAI's | §5.AB |
| `local-model-endpoint.ts` | The default local model-server endpoint (todo §5.U — consolidates a magic URL that was hardcoded ~8x across the | §5.U |
| `local-native-chat-shape.ts` | §5.AB endpoint-iteration — the PURE wire-shape core for the `native_v1_chat` endpoint kind: LM Studio's native | F4.33 F4.34 F4.45 §5.AB |
| `localization-provider.ts` | §5.B localization port — the READ-ONLY fault-localization contract the repair kernel's `localize` step depends on. | §5.B |
| `long-memory-eval.ts` | Internal LongMemEval-style fixture for deciding whether !Klein may broaden memory scope. | F2.10 |
| `long-memory-live-eval.ts` | Pure parser/scorer for the effectful LongMemEval live verifier. | — |
| `machine-concurrency-gate.ts` | Per-MACHINE concurrency admission (§5.AB per-machine pools). | §5.AB |
| `manifest-influence-sink.ts` | Manifest → protected-influence-sink adapter (todo §5.AF manifest × §5.L sinks) — PURE decision core. | F1.20 §5.AF §5.L |
| `manifest-phase-gate.ts` | Manifest ↔ run-phase gate — a thin PURE adapter (todo §5.AF, the `allowedRunStates` research-addendum concept). | §5.AF |
| `mast-failure-modes.ts` | F12.39 MAST failure-mode tagging over the attempt ledger — PURE core. | F12.39 |
| `mcp-localization-provider.ts` | §5.B — MCP-backed {@link LocalizationProvider}, pure over an INJECTED mcp-tool-caller. | §5.B |
| `mcp-server-memory-fit.ts` | §5.AR / §5.AF — decide whether a curated sandbox MCP server FITS in a task's container MEMORY budget, paralleling the | §5.AF §5.AL §5.AR |
| `mcp-server-model-fit.ts` | §5.AL / §5.AP — decide whether a curated MCP server's tools should be OFFERED to a given model ("for models where it | §5.AL §5.AP |
| `mcp-tool-surface-pin.ts` | F12.31 MCP hardening — tool-SURFACE pinning + server allowlist. | F12.31 |
| `mechanism-decision-report.ts` | P15.2 — turn a mechanism's observation stream into a DECISION. | F12.28 F12.41 P15.1 P15.2 |
| `mechanism-observation-audit.ts` | P15.1b — the observation-count half of the mechanism registry. | P15.1b |
| `memory-audit.ts` | §5.AR / §5.AW — the strong-model MEMORY AUDIT (pure core). | §5.AF §5.AR §5.AW |
| `memory-freshness-audit.ts` | F5.2 (pure core) — Basic Memory FRESHNESS / CONSISTENCY audit. | F5.2 |
| `memory-freshness-schedule.ts` | F5.2 (pure scheduler core) — the decision + retention seam between the runtime idle path and the model-free | F1.26 F5.2 |
| `memory-governance.ts` | §5.M memory governance (pure core) — the rules that keep AUTHORED memory (basic-memory notes) trustworthy + scoped. | §5.AR §5.M |
| `memory-layers.ts` | §5.M LAYERED memory as one projection over the existing substrate (working · episodic · semantic · procedural). | §5.AD §5.AE §5.AF §5.M |
| `memory-lifecycle.ts` | Memory knowledge lifecycle (pure) — ported from opencode-swarm's knowledge lifecycle (utility scoring + auto-promote / | F5.2 |
| `merkle-file-tree.ts` | F12.67 Merkle file-hash tree — PURE core. | F12.67 |
| `message-target-picker.ts` | F2.16a (§5.AU rung 5) — the ISOLATED LLM target picker that runs ONLY after the deterministic | F2.16a §5.AU |
| `message-target-resolver.ts` | §5.AU — resolve the TARGET of a main-chat message: the "whose message is this?" problem. | F2.16b §5.AT §5.AU |
| `model-attributes.ts` | §5.AB-(B) — pure, deterministic parsing of a model's OBSERVABLE ATTRIBUTES (FORMAT + QUANT + size) from its served | §5.AB |
| `model-behavior-profile.ts` | Per-model behavioural learning profile (todo §5.AA) — "!Klein learns to use each model to its best". | §5.AA §5.AB §5.AD |
| `model-capability-catalog-data.ts` | The curated catalog. | §5.AL §5.U |
| `model-capability-catalog.ts` | Persistent model-capability catalog (todo §5.AL) — !Klein's curated, checked-in knowledge of which local | §5.AB §5.AL |
| `model-catalog-overlay.ts` | §5.AL / §5.AB decision #1 (David 2026-07-07): the model-capability catalog must be DATA-DRIVEN, not baked into | §5.AB §5.AL |
| `model-class-cap.ts` | §5.AE per-role model-class cap (compute control) — the PURE classifier + gate behind the user's "only the architect | §5.AE |
| `model-discovery-throttle.ts` | The single throttle policy for live `/models` catalog discovery (todo §4A; 2026-06-28 hammering incident). | — |
| `model-diversity.ts` | §5.AB reasoning-diversity re-ranking for DECISION roles (audit 2026-07-02 W0.4). | W0.4 §5.AB |
| `model-eval-aggregation.ts` | §5.AB EVAL-HARNESS result aggregator (pure) — the missing step between the eval harness and the selector. | §5.AA §5.AB |
| `model-eval-coverage-plan.ts` | §5.AB eval-harness COVERAGE planner (pure) — the "which (model, role, difficulty) cell do I probe NEXT to | §5.AB |
| `model-eval-stability.ts` | §5.AB EVAL-STABILITY / confidence scorer (pure) — is a model's per-cell eval verdict SETTLED or still FLAKY? The | §5.AB §5.AI |
| `model-failover-policy.ts` | Model-failover policy (F3.2 failover leg) — PURE decision core. | F3.2 |
| `model-fitness-freshness.ts` | §5.AB fitness-store FRESHNESS / DECAY + re-eval prioritization (pure). | §5.AB §5.AF §5.AI |
| `model-fitness.ts` | The "best model for the job" brain (todo §5.AB): score each connected model's fitness per role/difficulty and pick | §5.AA §5.AB |
| `model-fleet-advisor.ts` | §5.AL / §5.AB gap 5 (David 2026-07-07) — user-facing MODEL SUGGESTIONS. | §5.AB §5.AL |
| `model-identity.ts` | Canonical model identity normalization — the single source of truth shared by the model registry | §5.Q |
| `model-license-declaration.ts` | F12.100 (data half) — the OPERATOR-DECLARED model license map. | F12.100 P23.2 |
| `model-license-gate.ts` | F12.100 model provenance, license gate, and AI-BOM — PURE core. | F12.100 |
| `model-lineage.ts` | §5.AB reasoning-diversity (audit 2026-07-02 W0.3): the COARSE model lineage — the training/architecture family | W0.3 §5.AB |
| `model-load-headroom.ts` | Model-load headroom guard (todo §5.AF resource governance) — the PURE prerequisite for letting !Klein load models | §5.AF |
| `model-load-policy.ts` | §5.AB/§10 model load/unload POLICY (operational resource governance) — the pure decider a sweep runner consults | F1.23 §5.AB |
| `model-online-lookup.ts` | LLM-based ONLINE capability lookup for UNKNOWN models (todo §5.AL). | §5.AL |
| `model-pool-key.ts` | Derive the ROUTING pool key for a swarm candidate (§5.AB LM-Link per-machine pools, user 2026-07-01). | §5.AB |
| `model-pool-routing.ts` | Pool-aware routing (todo §5.AB per-machine pools, user 2026-06-29). | §5.AB |
| `model-pool.ts` | §5.W / §5.AF — the `ModelPool` model (pure core). | §5.AF §5.W |
| `model-residency-planner.ts` | §5.AB autonomous load/unload planner (David 2026-07-07: "load/unload as-needed, just don't overload any of the 3 | §5.AB |
| `model-selection-reason.ts` | The §5.AB "why this model for this task" inspectable reason (sub-deliverable #5) — a PURE projection of a task-start | §5.AB §5.AE §5.AF §5.AG |
| `model-sensitive-pruning.ts` | F4.13 — model-sensitive retrieval pruning (pure). | F4.13 |
| `model-stats-tracking-level.ts` | Model-stats tracking level (§5.AN, David 2026-07-04) — PURE decision core. | §5.AN |
| `model-swarm-route.ts` | End-to-end swarm route: machine pool → model within the pool (todo §5.AB per-machine pools, user 2026-06-29). | §5.AB §5.Z |
| `model-task-affinity.ts` | Best-fit affinity tags (§5.AB/§5.AE) — the small shared vocabulary that lets the router match a TASK to a MODEL | §5.AB §5.AE §5.AL |
| `model-thinking-control.ts` | §5.AA model thinking-control — the per-model soft-switch that turns a reasoning model's hidden reasoning channel OFF | §5.AA |
| `model-tuning-recommendations.ts` | Collapse a model key to a canonical per-model display name so the two recording paths line up. | F3.30 F4.10 F4.9 |
| `model-turn-admission.ts` | (no docblock) | — |
| `monorepo-task-scope.ts` | F11.2k monorepo-aware task scoping — PURE core. | F11.2k |
| `multimodal-provider-compat.ts` | F2.7b hardening — PROVIDER image-format compatibility. | F2.7b |
| `mutation-adequacy.ts` | F12.46 — test-adequacy (mutation) gate for agent-written tests (pure core). | F12.46 |
| `n-eyes-review-schedule.ts` | F1.37 (§5.AW) — orthogonal N-EYES review scheduling, the pure protocol layer over the shipped parts: lenses | F1.37 F1.37b §5.AW |
| `narration-dialect.ts` | §5.AA — classify WHICH narrated-tool-call recovery dialect a stuck (no-structured-call) turn is in, so the runtime | §5.AA §5.AG |
| `nklein-mcp-api-contract.ts` | (no docblock) | §5.X |
| `nklein-ops-api-contract.ts` | (no docblock) | §5.G §5.H §5.X |
| `nklein-provider-api-contract.ts` | (no docblock) | §5.X |
| `nklein-provider-mutations-api-contract.ts` | (no docblock) | §5.X |
| `normalize-number.ts` | Numeric normalizers shared across config + agent modules (previously copy-pasted). | — |
| `normalize-system-first.ts` | Normalize a chat message array so all `system` content sits in a SINGLE system message at index 0 (§5.AA | §5.AA |
| `number-stats.ts` | Tiny pure numeric statistics, extracted from agent-attempt-ledger. | — |
| `openai-compat-base-url.ts` | OpenAI-compat base-URL normalization — shared by every seam that hands a local provider base URL to an | — |
| `operator-board-health.ts` | The minimal board shape the rollup reads — columns of cards with an id and (optionally) the card's start-blocked | F12.52 §5.A §5.AG §5.AW §5.L §5.M §5.S |
| `operator-task-state.ts` | §5.AG operator board-health classifier — the at-a-glance "healthy / stuck / risky / done" state for a task, derived | F1.21 F1.9b F2.17 §5.A §5.AA §5.AB §5.AF §5.AG §5.AW §5.L §5.M §5.S |
| `opportunistic-idle-work.ts` | §5.AW opportunistic idle-work decision (pure) — composes the approved {@link rankOpportunisticWork} priority chooser | §5.AB §5.AR §5.AW |
| `opportunistic-work-ranker.ts` | §5.AW opportunistic idle-work ranker — APPROVED (David decision-11, 2026-07-04). | §5.AB §5.AF §5.AR §5.AW |
| `opportunistic-work-value.ts` | F1.36 (§5.AW) — the two pieces the live idle-work sweep was missing: a BACKGROUND-BUDGET gate (idle work must | F1.26 F1.33 F1.36 §5.AF §5.AW |
| `otel-genai-export.ts` | F12.47 — OTel GenAI export bridge (pure mapping half): project !Klein's attempt-ledger events into | F12.47 |
| `outer-controller-fsm.ts` | F3.12 — the outer-controller finite state machine (pure). | F3.12 |
| `output-truncation-classification.ts` | F4.12 — reasoning-aware truncation CLASSIFICATION. | F4.12 |
| `outward-action-approval.ts` | Outward-action approval decision (Phase 7S / S3) — PURE decision core. | §5.L |
| `outward-action-queue.ts` | Outward-action review queue — pure helpers (Phase 7S / S3, "queue for later review" model, David 2026-07-16). | — |
| `parallel-swarm-guardrails.ts` | (no docblock) | — |
| `parse-json-line.ts` | Parse one JSON line and validate it against a schema, returning the parsed value or null. | — |
| `patch-candidate-parser.ts` | §5.AK N-candidate patch parser (pure) — turn a narrow model's "here are N patches" output into DISCRETE, | §5.AK |
| `patch-generation-prompt.ts` | §5.AK — the generate-N-patches prompt (the model's ONE narrow generative subtask in the repair kernel). | §5.AK |
| `persisted-prompt-session-models.ts` | (no docblock) | — |
| `placeholder-scan.ts` | Placeholder / stub scanner (pure) — a mechanical enforcement of the §4A "no built-but-not-wired" rule, ported from | — |
| `plan-artifacts-api-contract.ts` | (no docblock) | F1.3d F1.4 §5.X |
| `plan-critique-decision.ts` | W4.3 — the decompose-specific adapter over the §5.AW deliberation trigger: should THIS validated plan get one | W4.3 §5.AW |
| `plan-gap-kind.ts` | The plan-gap kind enum + type, kept in a **browser-safe** module (zod only, no Node imports) so the contract | — |
| `plan-gap.ts` | (no docblock) | — |
| `plan-integration-gate.ts` | Plan-level integration gate — pure core (todo §5.0.5, decision 2026-07-02: "YES, gate the plan"). | — |
| `png-decode.ts` | Minimal PNG → raw RGBA decoder (F12.87 screenshot leg). | F12.87 |
| `portable-continuation-selector.ts` | §5.F continuation-point selector — "persisted state → where to safely resume + why". | §5.F |
| `power-aware-timeout.ts` | Power-aware timeout scaling for the test/verify harnesses (todo §5.AF/§5.Z; user directive 2026-06-28). | §5.AF §5.Z |
| `predicted-execution-check.ts` | Predict-then-execute verification (F12.96) — PURE comparison core. | F12.96 |
| `procedural-skill-audit-sweep.ts` | F12.30 lifecycle sweep — apply paired-trajectory audit verdicts to the procedural-skill bank. | F12.29 F12.30 |
| `procedural-skill-audit.ts` | F12.30 — ground-truth-free skill auditing via PAIRED trajectories (SkillAudit; ACE evolving-playbooks). | F12.29 F12.30 |
| `procedural-skill-distillation.ts` | Procedural-skill DISTILLATION producer (F4.19) — turns a completed, successful task into a reusable procedure record. | F4.19 §5.N |
| `procedural-skill-lifecycle.ts` | §5.AE ProceduralSkillBank — the SAFETY KEYSTONE: the skill lifecycle state machine. | §5.AE §5.AF |
| `procedural-skill-record.ts` | F4.19 — the durable ProceduralSkill record + its pure mutations. | F12.29 F4.19 |
| `procedural-skill-retrieval.ts` | F4.19 — procedural-skill RETRIEVAL matching (pure). | F12.29 F4.19 |
| `process-remediation-ledger.ts` | Project a {@link ProcessTrajectory} from the agent attempt ledger (pure) — the input adapter that lets the record-only | — |
| `process-remediation.ts` | Process Remediation Model (pure) — ported from opencode-swarm's PRM and adapted to complement (not duplicate) | F1.10 |
| `progress-stall-detector.ts` | F12.22 progress-ledger stall detector — PURE core. | F12.22 |
| `projects-api-contract.ts` | (no docblock) | §5.AF §5.O §5.X |
| `prompt-evolution-gate.ts` | F12.28 — per-(model×role) prompt evolution, and the ADOPTION GATE that keeps it honest. | F12.28 P20.6 |
| `prompt-family-scorers.ts` | §5.V — deterministic scorers per PROMPT FAMILY (pure core). | §5.AB §5.V |
| `prompt-fragment-assembly.ts` | W2.3b (audit 2026-07-02, §5.AQ context economy) — the CACHE-STABLE-PREFIX fragment assembler. | F4.39 W2.3b §5.AQ |
| `prompt-fragment-lint.ts` | Prompt-fragment linter (F12.79 instruction-budget + F12.80 positive-phrasing, todo §5.AF / Phase 12). | F12.79 F12.80 §5.AF |
| `prompt-intent-mode.ts` | F4.39 — prompt INTENT modes. | F4.39 |
| `prompt-shell-restructure.ts` | §5.AQ strategy (e) — BYTE-STABLE PROMPT SHELL restructure: string surgery on the SDK-built base system prompt that | §5.AQ |
| `protected-test-approval-store.ts` | (no docblock) | — |
| `provider-schema-downgrade.ts` | F3.T4 — downgrade a JSON schema to the smallest SAFE dialect a provider actually supports. | — |
| `provider-schema-profile.ts` | Per-provider JSON-schema profiles for tool definitions and structured output. | §5.O |
| `quality-budget.ts` | Quality budget (pure) — ported from opencode-swarm's quality_budget gate, reduced to the signals computable from a | — |
| `question-clarification-pass.ts` | F1.3c — the deterministic question-quality pass over a decomposition's OPEN plan questions (§5.S "wire into the | F1.3c §5.S |
| `rail-delivery-trend.ts` | §5.AI dev-test rail — per-scenario delivery TREND over the harvested run history (pure). | §5.AI |
| `rail-evidence.ts` | §5.AI dev-test rail evidence: the shared report shape (persisted as `rail-*.json` by the rail/daemon) plus a pure | §5.AI |
| `rail-findings.ts` | F1.33 (§5.AI) — auto-analyse harvested rail evidence into TYPED FINDINGS, and turn those into deduplicated | F1.26 F1.33 §5.AI |
| `read-before-write-guard.ts` | F12.19 read-before-write + stale-read guard — PURE core. | F12.19 |
| `reason-then-act.ts` | §5.AD reason-THEN-act — the pure orchestration transform for the two-phase turn that converts a reasoning model into | §5.AD |
| `reasoning-capture.ts` | F2.23 (first a-leaf) — the SAFE reasoning-capture primitive. | F2.23 |
| `reasoning-channel-split.ts` | §5.AN: separate a completion's REASONING channel from its VISIBLE answer, across LM Studio's documented reasoning | §5.AA §5.AN |
| `reasoning-control.ts` | §5.AA — reasoning control as a first-class lever (pure core). | §5.AA |
| `reasoning-output-budget.ts` | Reasoning-aware OUTPUT-BUDGET sizing (todo §5.AN — "get more out of every model", the PRE-FLIGHT complement to the | §5.AL §5.AN |
| `relative-date-resolver.ts` | Relative-date resolver — turn a relative temporal phrase into an absolute date against the authoritative "now" | §5.AC |
| `repair-controller-decision.ts` | §5.AK repair-controller semantics (pure) — when a node fails, decide WHICH repair action to take, as a priority | §5.AK |
| `repair-kernel-ledger.ts` | §5.AK — project a repair-kernel run into a §5.AF ledger record: the observable EVIDENCE of one constrained bugfix | §5.AF §5.AK |
| `repair-kernel.ts` | The deterministic repair kernel (§5.B) — the constrained bugfix pipeline that keeps a small model from WANDERING. | §5.B |
| `repair-validation-gates.ts` | §5.B repair-kernel VALIDATOR — run a candidate patch's gates and produce the {@link RawValidationGates} the ranker | §5.B |
| `replay-eval-orchestration.ts` | F1.26b — compose the shipped self-improvement REPLAY cores into one outcome: evaluate a captured (pre-patch | F1.26 F1.26b §5.AF |
| `repo-fact-sheet.ts` | F12.23 first-turn repo bootstrap fact-sheet — PURE core. | F11.2f F12.23 |
| `repo-verify-commands.ts` | F11.2g repo-own verify commands — PURE derivation. | F11.2g |
| `request-economy-plan.ts` | Request-economy planner (todo §5.AQ) — the ONE pure decision that unifies the context-economy substrate so the | §5.AQ |
| `research-freshness-gate.ts` | §5.AC freshness gate for the decompose/research pass — the pure decision behind "if the knowledge is stale, | §5.AC |
| `result-handle.ts` | Result-handle scheme for small-model context frugality (todo §5.O "Result handles"). | §5.O |
| `retrieval-fetch-adapter.ts` | §5.AC retrieval-loop FETCH adapter — plugs a page fetcher into the retrieval loop's injected `fetch` dep | §5.AC §5.L |
| `retrieval-freshness-authority-rank.ts` | Recency×authority COMBINER for the §5.AC "knows today" retrieval loop — the step that FUSES the two freshness halves | §5.AC |
| `retrieval-freshness.ts` | Freshness judgment for retrieved info (todo §5.AC, the "knows today" lighthouse). | §5.AC |
| `retrieval-ledger-projection.ts` | §5.AC/§5.AF retrieval-usefulness projection — the query over the `retrieval` ledger events (see | §5.AC §5.AF |
| `retrieval-loop-driver.ts` | §5.AC retrieval-loop DRIVER — the effectful orchestrator that wraps the pure `nextRetrievalAction` state machine | §5.AC §5.L |
| `retrieval-loop-state.ts` | §5.AC retrieval-loop STATE MACHINE — pure decision core. | §5.AC |
| `retrieval-query-plan.ts` | Query-plan ("rewrite") step for the §5.AC retrieval loop. | §5.AC §5.B |
| `retrieval-recall-eval.ts` | §5.I — recall@k evaluation for the code-retrieval modes (lexical-only · dense-only · lexical→dense rerank) on a | §5.I |
| `retrieval-rerank.ts` | Retrieval reranking: deterministic lexical scorer for search hits. | §5.AC |
| `retrieval-search-adapter.ts` | §5.AC retrieval-loop SEARCH adapter — maps a web_search backend's response into the retrieval loop's injected | §5.AC |
| `retrieval-source-trust.ts` | Retrieved-source TRUST scorer — the "how much should I trust WHERE this came from?" gate of the "knows today" | §5.AC |
| `retrieval-sufficiency.ts` | Sufficiency judgment for the §5.AC retrieval loop. | §5.AC |
| `retrieval-synthesis-adapter.ts` | §5.AC retrieval-loop SYNTHESIS adapter — maps an injected model completion into the loop's optional `synthesize` dep | §5.AC |
| `retrieved-evidence.ts` | First-class RetrievedEvidence objects + citation verification (todo §5.AC). | §5.AC §5.L |
| `retry-budget-projection.ts` | F3.30 — project the attempt ledger into {@link RetryBudgetObservation}s per model, so `estimateLearnedRetryBudget` | F3.30 |
| `retry-policy.ts` | The §5.AA retry-policy decision core — a typed controller strategy table that, given the failure that just happened | §5.AA |
| `review-effort-scaling.ts` | F12.35 confidence-gated review + effort scaling (the DOWN pattern) — PURE core. | F12.35 |
| `review-lenses.ts` | §5.AW N-eyes review LENSES (audit 2026-07-02 W4.4) — "as many eyes as available, but each looks DIFFERENTLY." | F12.5 W4.4 §5.AB §5.AW |
| `review-loop.ts` | Second-opinion review loop decision core. | W4.2 |
| `review-orchestration.ts` | Second-opinion review orchestration core (todo.md §5.K). | §5.AB §5.AW §5.K |
| `review-panel-plan.ts` | §5.AW review-PANEL planner — compose the complexity classifier's OUTPUT (a {@link TaskComplexity} band) with the | §5.AW |
| `review-panel-verdict.ts` | §5.AB parallel panel-of-judges — combine N diverse judges' verdicts into ONE merge/block decision (David 2026-07-07 | §5.AB |
| `reward-hack-signals.ts` | Reward-hacking signals over a delivered diff (F12.44 slice) — PURE core. | F12.44 |
| `richer-card-schema.ts` | §5.AK — the richer, work-package-shaped CARD schema (pure). | §5.AK |
| `role-model-class.ts` | Role → model-CLASS fit (todo §5.AB — the ≥3-agent parallel swarm, near-term user steer 2026-06-29). | §5.AA §5.AB §5.AL |
| `role-model-readiness.ts` | Preflight: are the models a run's configured roles need actually LOADED on the fleet? A live dev-test (2026-07-15) | — |
| `role-model-selection.ts` | Per-task best-fit model selection for a role that has MORE THAN ONE model assigned (todo §5.L / chat #4). | §5.L |
| `role-model-swarm-pick.ts` | Two-stage swarm model pick (todo §5.AB — the ≥3-agent parallel swarm, user 2026-06-29). | §5.AB §5.AL §5.Z |
| `rounds-budget.ts` | §5.reasoning-loop — the learned ROUNDS BUDGET (pure core). | — |
| `routing-decision-log.ts` | §5.AB confidence/resource-aware routing — the per-routing-decision LOG + its calibration summary. | §5.AB |
| `run-attention-signals.ts` | §5.AG run-attention signal deriver — the TIME/BUDGET-aware upstream that turns raw run telemetry (activity & | §5.A §5.AA §5.AG §5.T |
| `run-state-machine.ts` | Finite-state run controller — PURE decision core (todo §5.AA(a)). | §5.AA §5.AF §5.AG §5.Z |
| `runaway-budget-stop.ts` | F12.40 runaway budget HARD-STOP — PURE core. | F12.40 F12.58 §5.AG |
| `runaway-generation-detector.ts` | Runaway-generation detector (§5.AA robustness — live-found sweep run 9, 2026-07-08). | §5.AA |
| `runtime-config-api-contract.ts` | (no docblock) | P0.9c §5.X |
| `runtime-endpoint.ts` | (no docblock) | — |
| `runtime-model-verdict.ts` | §5.AL RUNTIME model-suitability verdict (pure) — the evidence-based companion to the curated | §5.AB §5.AL |
| `sandbox-mcp-catalog.ts` | §5.AR — the curated catalog of MCP servers that !Klein hosts INSIDE the agent sandbox, plus the pure helpers that | §5.AF §5.AL §5.AR |
| `sbom-generation.ts` | F12.102 (SBOM half) — build a Software Bill of Materials for the app itself, PURE core. | F12.100 F12.102 |
| `scaffold-profile.ts` | F12.14 minimal-scaffold baseline + inverse-scaling discipline — PURE core. | F12.14 |
| `scoped-override-resolution.ts` | F4.16 (§ dynamics-level config) — resolve a setting across the four override SCOPES with a fixed precedence: | F4.16 F4.28 |
| `self-bounce-personas.ts` | §5.AD self-bounce personas — the prompt substrate behind the enforced-reasoning gate's `self_bounce_varied` kind. | §5.AA §5.AD |
| `self-compaction-rubric.ts` | F12.6 self-compaction fire/hold rubric — PURE core. | F12.6 |
| `self-consistency.ts` | Self-consistency sampling: majority-vote across N sampled reasoning paths (todo §5.AD). | §5.AD |
| `self-improvement-gate.ts` | §5.AF M4 self-improvement quarantine — the SAFETY KEYSTONE: the fail-closed approval gate for an auto-generated | F1.25 §5.AE §5.AF §5.Y |
| `session-state-predicates.ts` | Session-state predicates (todo §5.U — consolidates a `state === "running" \|\| state === "queued"` check that had | §5.U |
| `session-turn-liveness.ts` | ZERO-TOKEN TURN LIVENESS (live-found 2026-07-13, real-model rail run — the "planning freeze" root cause). | §5.AQ |
| `setup-detection.ts` | §5.BA guided-configuration detection core — PURE "detect → recommend" logic. | §5.AR §5.AX §5.BA |
| `shell.ts` | (no docblock) | — |
| `shortcut-behavior-monitor.ts` | F12.97 shortcut-behavior monitor over a delivered diff — PURE core, complementary to F12.44's | F12.44 F12.97 |
| `skill-api-profile-apply.ts` | §5.AE skill apiProfile → chat model-call reconcile — DRAFT (David decision-7: SESSION-SCOPED), held for approval. | §5.AE |
| `skill-api-profile-request.ts` | §5.AE → §5.AN bridge (pure): translate a resolved {@link SkillApiProfile} (the abstract per-skill INTENT — | §5.AA §5.AE §5.AG §5.AN |
| `skill-bundle-screening.ts` | F4.24 — deterministic bundle screening for EXECUTABLES / binary payloads. | F4.24 |
| `skill-bundled-file-manifest.ts` | SKILL.md BUNDLED-FILE manifest validator (todo §5.AP.A leaf (b) — the bundled-file (`scripts/` / `references/` / | §5.AP |
| `skill-capability-grant-reconcile.ts` | Skill capability-GRANT reconciler (todo §5.AP.D — "an activated skill runs under the SAME §5.L per-role capability | §5.AP §5.L |
| `skill-compat.ts` | The §5.AE skill-set COMPATIBILITY checker — a pure diagnostic over a PROPOSED active skill set that flags CONFLICTS | §5.AE §5.AG §5.AN |
| `skill-execution-gate.ts` | §5.AR skill-import safety — item D's NO-AUTO-EXECUTE bundled-script gate ("the real protection"). | §5.AR §5.L |
| `skill-fragment-mapping.ts` | §5.AE skill-fragment → prompt-assembly mapping — APPROVED (David decision-10, 2026-07-04). | §5.AE |
| `skill-import-decision.ts` | §5.AR skill-import safety — MODE C decision core (the "ship FIRST — the safe one" user-controlled flow). | §5.AP §5.AR §5.L |
| `skill-injection-prescreen.ts` | SKILL.md injection PRE-SCREEN (todo §5.AP.E — the deterministic, NON-LLM safety scan that adds ZERO prompt-exposure) — | §5.AP §5.L |
| `skill-md-parse.ts` | SKILL.md parser + manifest validator (todo §5.AP.A — align the §5.AE skill system to the open SKILL.md standard) — | §5.AE §5.AP §5.L |
| `skill-pin-drift.ts` | Skill / MCP pin-drift detection (Phase 7S / S7 supply-chain, rug-pull guard) — PURE decision core. | — |
| `skill-prompt-fragments.ts` | §5.AE skill → assembler-fragment bridge (pure). | §5.AE |
| `skill-registry.ts` | The §5.AE Skill registry + context-fragment catalog — the PURE, hand-authored foundation for dynamic prompts. | §5.AA §5.AB §5.AC §5.AD §5.AE §5.AL §5.AN §5.L |
| `skill-resolver.ts` | The §5.AE dynamic skill RESOLVER — picks the active skill set for a task/turn from the §5.AE `SKILL_REGISTRY`, honoring | §5.AA §5.AB §5.AD §5.AE §5.AG §5.AN §5.L |
| `skill-source-trust.ts` | §5.AR skill-import safety — TRUSTED-SOURCE classification (item B). | §5.AR |
| `skill-trajectory-projection.ts` | F12.30 pairing projection — turn raw attempt-ledger events into the paired trajectory samples | F12.29 F12.30 |
| `skill-variation-rung.ts` | §5.AE skill-variation escalation rung (ties §5.AA/§5.AB) — when a task stubbornly fails, propose a DIFFERENT skill | §5.AA §5.AB §5.AC §5.AE |
| `slugify.ts` | The ONE slug transform (previously copy-pasted ~6× as `slugify` / `slugifyTaskId` / `slugifyPlanTaskId` / | — |
| `spec-deliberation.ts` | F12.111 — multi-model SPEC-TIME deliberation: disagreement as an underspecification detector. | F12.111 F12.35 |
| `spec-invariant-derivation.ts` | F12.93 property-based acceptance gate — the PURE half: derive spec-stated INVARIANTS (independent of the | F12.44 F12.93 F12.93b F12.97 |
| `spec-lint.ts` | F12.9 pre-decompose spec linter — PURE core. | F12.9 §5.S |
| `spectrum-fault-localization.ts` | §5.AK / §5.B — spectrum-based fault localization (SBFL, pure core). | §5.AK §5.B |
| `speculative-delivery-target.ts` | §5.AW best-of-N arbitration — the PURE decision for WHICH result branch a reviewed task delivers, lifted out of | §5.AW |
| `speculative-mirror.ts` | §5.AW opportunistic speculative best-of-N — the pure mirror-tick decision core. | §5.AQ §5.AW |
| `speed-aware-liveness.ts` | F3.19 — power- AND speed-aware liveness budgets. | F3.19 |
| `speed-capability-dial.ts` | §5.I#4 — the per-role SPEED-vs-CAPABILITY dial applied to a fit-ranked candidate list. | §5.I |
| `stable-model-identity.ts` | Stable model identity (David 2026-07-06 directive). | §5.BG |
| `stale-while-revalidate-cache.ts` | A tiny stale-while-revalidate cache: a `get()` always returns immediately with the last computed value (or the | §5.AI |
| `startup-orphan-reconcile.ts` | Move every `in_progress` card WITHOUT a live session to the Review lane. | W2.2 W2.2a |
| `stateful-responses-gate.ts` | F4.45 — stateful LM Studio responses, gated on VERIFICATION (pure core + injectable probe). | F4.45 |
| `strategy-effectiveness-ledger.ts` | The §5.AA adaptive strategy-effectiveness ledger — !Klein learns, per model, WHICH remedy rung actually recovers it, | §5.AA §5.AF |
| `stream-derivation.ts` | §5.AU STEP 2 — derive STREAMS (epics) from the board's existing structure. | §5.AU |
| `stream-events-api-contract.ts` | (no docblock) | §5.X |
| `stream-rollup.ts` | §5.AU STEP 3 — roll a STREAM's member cards up into one status the main chat can show at "group altitude". | §5.AU |
| `structural-retrieval-guidance.ts` | §5.AR/§5.B — the "prefer the code-graph over grep" nudge. | §5.AR §5.B |
| `structured-ingestion-parse.ts` | F12.10 structured tool-output parsing channel (DRIFT-style) — PURE core. | F12.10 |
| `structured-output-request-plan.ts` | §5.AN structured-output ENVELOPE plan (pure) — turn a chosen {@link StructuredOutputStrategy} + a target JSON Schema | §5.AN |
| `structured-output-strategy.ts` | Reasoning-aware STRUCTURED-OUTPUT strategy (todo §5.AN) — the PURE decision of *how* to coax a JSON object out of a | §5.AN |
| `stubborn-failure-escalation.ts` | F3.29 — automatic stubborn-failure escalation (pure). | F3.29 |
| `stuck-task-analysis.ts` | (no docblock) | §5.AB §5.AG |
| `swarm-guardrails.ts` | (no docblock) | — |
| `swarm-role-selection.ts` | W2.5 role auto-assignment (todo §5.0.5, decided 2026-07-02: auto is the DEFAULT) — the PIN-vs-AUTO layer for a | W0.4 W2.5 §5.AB §5.AQ |
| `swarm-roster-config.ts` | §5.AB / §5.U — the USER's real swarm fleet, loaded from their own config file so the shipped `swarm-roster.ts` | §5.AB §5.U |
| `swarm-roster-load-plan.ts` | Pure planning for effectful swarm-roster loads. | — |
| `swarm-roster.ts` | Named swarm rosters (todo §5.AB per-machine pools, user 2026-06-29). | §5.AA §5.AB §5.AL §5.O §5.Z |
| `swarm-tool-capability.ts` | Swarm-tool capability lookup (§5.L decision-4) — the PER-TOOL STATIC manifest + output-taint for the autonomous | F1.21 §5.L |
| `sweep-resource-governance.ts` | §5.AI/§10 sweep resource governance (operational) — the pure deciders that keep a background model-sweep from | §5.AB §5.AI |
| `synthetic-task-id.ts` | Synthetic task-id conventions (todo §5.U — consolidates a `::` magic-string check that had drifted across ~5 files). | §5.U |
| `sysprompt-level.ts` | §5.AQ A+B+C — the TIERED SYSPROMPT: a user-facing "sysprompt size" ladder, an AUTO selector, and the intent-mode knob. | §5.AE §5.AQ §5.O |
| `taint-content-scan.ts` | §5.L content-scan `secret_like` source — the owed SCANNER that turns raw content into taint labels. | §5.L |
| `taint-labels.ts` | Taint-label model (todo §5.L — "assume prompt injection SUCCEEDS, protect the sinks") — PURE decision core. | §5.AC §5.L §5.M |
| `taint-provenance.ts` | Taint PROVENANCE ledger (Phase 7S / S5) — PURE decision core. | — |
| `task-board-lane-reconcile.ts` | Where a *running* card should be, keyed by the lane it is in now. | §5.B |
| `task-board-mutations.ts` | The lane EVERY started card enters first (todo §5.B — Planning/Refinement). | F1.9 §5.AU §5.B |
| `task-board-ready-sweep.ts` | The READY-SWEEP (live-found across fleet runs 12/14/15, 2026-07-02): list every waiting card that is startable | §5.AU |
| `task-chat-api-contract.ts` | (no docblock) | §5.X |
| `task-complexity.ts` | Task-complexity classifier (todo §5.AQ item B) — the signal that drives AUTO sysprompt-level selection | §5.AQ |
| `task-context-estimate.ts` | Task context-need estimator (todo §5.AQ item G) — the `taskNeededTokens` signal that feeds `planLoadContextLength` | §5.AQ |
| `task-context-import.ts` | (no docblock) | — |
| `task-difficulty-estimate.ts` | §5.AB task-difficulty estimate (pure) — score how hard a card is, so automatic role→model selection can match it to | §5.AB |
| `task-evidence-capture.ts` | (no docblock) | — |
| `task-field-normalization.ts` | Pure task-field normalizers/cloners extracted from task-board-mutations. | — |
| `task-file-overlap.ts` | The normalized paths two tasks both list in `filesLikelyTouched` (sorted, deduped) — the concrete reason an auto-start | F1.9 §5.AF §5.AK |
| `task-id.ts` | (no docblock) | — |
| `task-lifecycle-api-contract.ts` | (no docblock) | F1.5 F1.6 F12.55 §5.X |
| `task-session-api-contract.ts` | (no docblock) | F1.9b F2.17b §5.O §5.X |
| `task-session-guards.ts` | A task session summary that is awaiting review for a reason the runtime should act on: an agent hook handoff, a | §5.U |
| `task-title.ts` | (no docblock) | — |
| `task-tool-cards.ts` | Authored {@link ToolCard}s for the kanban task tool set (§5.O — small-model output robustness). | §5.O |
| `task-trouble-signal.ts` | §5.AA/§5.AG unified TROUBLE signal — the single first-class read the worker + runtime both watch, composing the | §5.AA §5.AF §5.AG |
| `telemetry-stats-api-contract.ts` | (no docblock) | §5.Q §5.X |
| `temporal-awareness.ts` | Intrinsic temporal awareness — the "knows today" lighthouse (todo §5.AC). | §5.AC §5.AE §5.AQ |
| `temporal-claim-consistency.ts` | Temporal-consistency checker for DATED CLAIMS — the anachronism guard of the "knows today" lighthouse (todo §5.AC). | §5.AC |
| `temporal-context-injection.ts` | §5.AC "knows-today" temporal-context INJECTION decision (user guidance 2026-07-01). | §5.AC §5.AQ |
| `terminal-api-contract.ts` | (no docblock) | §5.X |
| `terminal-redrive-escalation.ts` | §5.AG Layer-1 automatic escalation, planned at the terminal-redrive seam (the #24 dead-card one-shot restart is the | §5.AF §5.AG |
| `test-driven-delivery.ts` | §5.AI — test-driven mode: the pure delivery-gate decision. | F1.34 §5.AI |
| `test-misinterpretation-detector.ts` | F12.15b test-misinterpretation detector — the daplab failure pattern where a worker "fixes" a RED test run by | F12.15b |
| `test-regression-verdict.ts` | §5.AI dev-test rail — flake/REGRESSION attribution + a decisive verdict (pure). | §5.AI |
| `test-selection-priority.ts` | §5.AI dev-test rail — CHANGED-FILE test-selection PRIORITIZER (pure). | §5.AI |
| `time-tracking.ts` | F1.40 — per-card and per-project TIME tracking (pure). | F1.40 §5.Q |
| `tool-argument-repair.ts` | §5.AA — decide what to do with a PARSED-but-imperfect tool-call ARGUMENTS object against the tool's schema: | §5.AA |
| `tool-capability-manifest.ts` | Tool-capability manifest (todo §5.AF — unify the 3 drifted gating mechanisms) — PURE decision core. | F1.20 §5.AF §5.L §5.V |
| `tool-card.ts` | ToolCard: deliberately SHORT descriptor of one tool, shown to small models so a long verbose tool schema | §5.O |
| `tool-catalog-retrieval-gate.ts` | F12.18 — retrieval-gate the tool catalog to a small, relevant set per turn. | F12.18 |
| `tool-error-contract.ts` | Typed semantic error contract for small-model tool-call failures (todo §5.O). | §5.AA §5.O |
| `tool-output-cap.ts` | F12.65 tool-output cap — PURE core. | F12.65 |
| `tool-replay-policy.ts` | F1.17 (§5.AF) — replay POLICIES over the F1.16 per-tool idempotency substrate: what a replayed/resumed run does | F1.16 F1.17 §5.AF |
| `tool-result-record.ts` | F1.16 (§5.AF) — per-tool idempotency identity + durable result evidence, the substrate the F1.17 replay policies | F1.16 F1.17 §5.AF |
| `tool-trust-decay.ts` | F12.24 per-tool trust decay — PURE core. | F12.24 F3.30 |
| `topic-aware-freshness.ts` | Topic-aware freshness — the composition that makes source-age judgment SHELF-LIFE aware (todo §5.AC, the "knows | §5.AC |
| `trajectory-quality-projection.ts` | Trajectory-quality projection (F12.42 mount) — project the F12.42 process signals off the PERSISTED agent ledger and | F12.42 |
| `trajectory-quality-score.ts` | Trajectory-quality scorer — Ideal / Solid / Lucky (F12.42, todo §5.AF / Phase 12). | F12.42 F12.94 §5.AF |
| `transcript-distractor-pruning.ts` | P18.3 — prune superseded messages from the TRANSCRIPT before compaction compresses it. | P18.3 §5.AD |
| `transient-error.ts` | Transient (retryable) network/inference error classification (todo §5.AF scout signal 3 — transient survivability). | §5.AF |
| `trigger-intake.ts` | F12.106 external-trigger intake — the PURE half. | F12.106 |
| `truncation-diagnostics-summary.ts` | F4.12 — pure glue + read-side for truncation diagnostics: build a {@link StoredTruncationObservation} from a | F4.12 |
| `turn-budget-allocator.ts` | §5.M / §5.AD — the turn-budget allocator (pure core). | §5.AD §5.M |
| `turn-thinking-directive.ts` | §5.AA — bridge the reasoning-control POLICY ({@link ./reasoning-control.decideReasoningControl}) to the model-specific | §5.AA |
| `two-phase-tool-pick.ts` | Pure interpreter for the phase-1 output of two-phase tool selection (todo §5.O — narrow tool interface for small | §5.O |
| `unified-diff-added-lines.ts` | Unified-diff added-line extractor (pure) — parses a `git diff` (unified format) into the ADDED lines per file, the | — |
| `untrusted-content-boundary.ts` | Phase 7S / S2 — the instruction/data ISOLATION boundary (the CORE anti-injection defense). | — |
| `untrusted-content-prescreen.ts` | Phase 7S / S4 — surface-agnostic injection PRE-SCREEN for ANY untrusted ingested content (web-fetch/research results, | F12.10 |
| `unwired-core-audit.ts` | P15.1 (mechanism registry, generated half) — find exported core functions with NO non-test consumer. | P15.1 |
| `verification-first-gate.ts` | F12.36 deterministic-verification-FIRST acceptance gate — PURE core. | F12.36 |
| `verification-rubric.ts` | F12.5 rubric-guided verification lens — PURE core. | F12.5 §5.AW |
| `verifier-ensemble.ts` | F12.97 (ensemble half) — combine INDEPENDENT verifier verdicts into one acceptance decision. | F12.97 §5.AF |
| `visual-verification-gate.ts` | Deterministic visual-verification gate (F12.87) — PURE core. | F12.87 |
| `vlm-screenshot-lens.ts` | F12.88 — the local-VLM screenshot review lens. | F12.87 F12.88 |
| `web-search-contract.ts` | Pure contract + result normalizer for the egress-gated web_search tool (todo §5.AC). | §5.AC |
| `windows-cmd-launch.ts` | (no docblock) | — |
| `work-package-card-shape.ts` | F1.8 (§5.AK) — emit WORK-PACKAGE-SHAPED cards BY CONSTRUCTION: the pure derivation that turns a decomposed task | F1.8 F1.9 §5.AK |
| `work-package-conflict-resolution.ts` | Work-package conflict-RESOLUTION suggester (todo.md §5.AK — parallel-dispatchable architecture + the work-package | §5.AK |
| `work-package-dispatch.ts` | Work-package dispatch classifier + parallel-dispatch planner (todo.md §5.AK — parallel-dispatchable architecture + | §5.AK |
| `work-package-integration-order.ts` | Work-package MERGE / integration-order policy (todo.md §5.AK — parallel-dispatchable architecture + the work-package | §5.AK |
| `work-package-merge-readiness.ts` | Work-package MERGE-READINESS admission gate (todo.md §5.AK — parallel-dispatchable architecture + the work-package | §5.AK |
| `workflow-board-bridge.ts` | (no docblock) | §5.AF §5.AG §5.B |
| `workflow-command-queue.ts` | F1.27 (§5.AF) — the workflow-kernel/DURABLE-QUEUE interface: the typed command/event seam CLI/tRPC/UI adapters | F1.27 F1.27b §5.AF |
| `workflow-kernel.ts` | (no docblock) | F1.27b §5.AF §5.AK §5.B |
| `workspace-files-api-contract.ts` | (no docblock) | §5.X |
| `workspace-projects-api-contract.ts` | (no docblock) | §5.X |
| `workspace-scope.ts` | (no docblock) | — |
| `zero-touch-kpis.ts` | F12.108 zero-touch autonomy KPIs — PURE projection over the attempt ledger. | F1.27b F12.108 F12.42 F12.48 |
