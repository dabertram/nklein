# 18 - Semiconductor Fab MES and Yield Analysis Platform

Complexity tier: 18/20
Expected decomposition size: 46-50 dependent implementation cards before coding.
Domain pressure: semiconductor manufacturing, MES, wafer lots, process routes, equipment state, SPC, genealogy, yield analysis, hold/release.
Acceptance command: npm test

## How to use this challenge
This is a dev-test project specification for evaluating whether an autonomous coding agent can decompose a real domain, identify knowledge gaps, build a correct foundation, and verify it with deterministic tests. The goal is not to finish the entire product. The goal is to build a durable foundation that proves the agent understood the domain boundaries and can implement the highest-risk core behaviors without hiding behind placeholders.

The agent must read this entire specification before planning. It must create a dependency-linked plan, record domain knowledge debt, and choose a narrow release slice that still exercises the real hard parts. Prefer fewer production-quality vertical slices over many shallow labels.

## Product vision
Build a semiconductor fab manufacturing execution and yield-analysis foundation. It should track wafer lots through process routes, equipment, recipes, holds, metrology, SPC, genealogy, and yield excursions with enough rigor to stress planning and domain modeling.

## Foundation release scope
The first serious buildout must include:
- Product, wafer, lot, carrier, route, operation, recipe, equipment, chamber, reticle, process run, metrology result, SPC rule, hold, disposition, bin map, and excursion models.
- Route engine supporting rework, split lots, merge lots, sampling plans, engineering holds, queue time constraints, and recipe qualification.
- Equipment state model for productive, standby, engineering, scheduled down, unscheduled down, qualification, and chamber-specific availability.
- SPC evaluation using deterministic fixtures for control limits, Western Electric-style rules, trend, shift, outlier, and missing sample handling.
- Genealogy graph connecting wafers, lots, process runs, recipes, reticles, chambers, operators, metrology, and downstream bins.
- Dispatch priority engine balancing due date, queue time, bottleneck equipment, hold state, recipe qualification, and sampling needs.
- Yield excursion workflow that scopes impacted wafers, quarantines suspect material, links evidence, and proposes containment.
- Seed fab week with split lot rework, chamber drift, missed metrology, reticle contamination suspicion, and downstream yield loss.

## Architecture requirements
- Separate MES transactional state, genealogy graph, equipment state, SPC evaluation, dispatch policy, and yield-analysis workflows.
- Represent wafer-level identity and lot-level actions carefully; do not collapse everything to lots.
- Use immutable process-run records and explicit disposition events.
- Make SPC rules data-driven and testable over deterministic numeric series.

## Domain knowledge debt to surface
The agent should not pretend to know every regulation, standard, or numerical model perfectly. It should implement a defensible deterministic subset, mark assumptions explicitly, and create extension points where real-world integrations or expert-reviewed rule packs would live. Required knowledge areas:
- Semiconductor lots can split, merge, rework, and carry wafer-level histories.
- Equipment and chamber history matters for yield, not just operation name.
- SPC rules detect process behavior before final test yield confirms it.
- Containment decisions must be conservative under incomplete genealogy.

## Decomposition pressure
This project should force decomposition across domain modeling, calculation or policy engines, workflow state, deterministic fixtures, auditability, and UI/view-model boundaries. The plan should include dependency links so shared primitives and invariants are built before dependent workflow features. Avoid starting with screens. Start with the domain model, invariants, and tests that would make later screens trustworthy.

The agent should maintain a visible knowledge-debt list covering unclear standards, units, legal or safety constraints, numerical assumptions, terminology, fixture limitations, and future expert-review checkpoints. Knowledge debt is not a failure; hiding it is.

## Acceptance criteria
- Route tests cover split, merge, rework, hold, queue-time, and recipe qualification cases.
- SPC tests cover limit breach, trend, shift, outlier, and missing data.
- Genealogy queries identify impacted wafers for chamber drift and reticle suspicion.
- Dispatch ranking is deterministic and explains bottleneck and hold decisions.
- The project passes npm test locally.

## Explicit non-goals
- Do not make this a generic factory kanban board.
- Do not ignore wafer-level identity.
- Do not use opaque ML predictions instead of traceable SPC and genealogy.

## Quality bar
- Use typed domain objects and pure core modules wherever practical.
- Keep deterministic fixtures in the repository and do not depend on live APIs for acceptance tests.
- Test edge cases before building broad UI coverage.
- Every risk score, recommendation, workflow transition, or generated report must be explainable from source facts.
- Stubs are acceptable only at external integration boundaries and must be named as adapters with deterministic fixture implementations.
- The foundation should be extensible into a real product if later teams add integrations, expert-reviewed rule packs, and production UI.

---

# Extended scope & deep-reasoning extensions (v2)

> Added 2026-06-26 via deep domain research. **The single defining property of this project:** a wafer fab's truth is a **wafer-level genealogy graph over immutable process-run records** — so the hard problem is making *every* downstream decision (SPC verdict, dispatch priority, hold/disposition, excursion containment) **provably reconstructable from that graph**, and making **containment conservative under incomplete genealogy** — when you don't know which wafers saw the drifting chamber, you quarantine the superset, not a guess. Build the immutable-genealogy + equipment-state spine first; SPC, dispatch, and yield analysis are folds over it.

## E0. Why this is the right shape of challenge

This is a tier-18 challenge — near the top — and the failure modes are *architectural*, not cosmetic. A weak swarm will (a) collapse wafer identity into lots, (b) make process-run records mutable, (c) treat SPC as a single limit check, and (d) "contain" an excursion by scoping the lots it's sure about. Every one of those is wrong in a way that, in a real fab, scraps the wrong wafers and ships the bad ones. The grading question is whether the agents discover that:

1. **Wafers have identity and divergent histories.** Lots **split, merge, and rework**; a single wafer carries its *own* per-operation history (which chamber, which reticle, which recipe, which metrology). "Do not ignore wafer-level identity" and "do not collapse everything to lots" are explicit non-goals. A 25-wafer lot can have 3 wafers reworked through a *different* chamber — and that's exactly the population an excursion must resolve.
2. **Equipment/chamber history is a yield variable.** The same operation on chamber A vs. chamber B is not the same event; chamber-specific state and drift matter "for yield, not just operation name" (explicit). This demands a real **SEMI E10 equipment-state model** and per-**chamber** genealogy edges.
3. **SPC detects trouble *before* final-test yield confirms it.** SPC rules (Western Electric / Nelson) fire on *patterns* (trend, shift, runs), not just out-of-limit points — catching chamber drift while wafers are still in-line, before bins prove the loss. [https://lab-wizard.com/en/resources/knowledge/spc-western-electric-rules/]
4. **Containment must be conservative under uncertainty.** "Containment decisions must be conservative under incomplete genealogy" (explicit). Missing metrology, ambiguous reticle exposure, partial genealogy → **quarantine the superset of possibly-affected material**, and only *narrow* as evidence arrives, never *widen the risk* by guessing optimistically.

## E1. Research-grounded domain authenticity (what a fab engineer / SEMI-standards person will check for)

- **MES + GEM300 standards vocabulary (model the *concepts*, not the wire protocol):**
  - **SEMI E10 — equipment RAM & utilization:** the **six mutually-exclusive basic states** — **Productive (PRD), Standby (SBY), Engineering (ENG), Scheduled Downtime (SDT), Unscheduled Downtime (UDT), Non-Scheduled Time (NST)** — with **UDT = the "failed" state**. From these, compute **availability, utilization, MTBF, MTTR, OEE**. State time-accounting must be **mutually exclusive and exhaustive** over the observation period (a state-machine invariant). [https://www.peergroup.com/definition-of-standard/semi-e10/ ; https://www.systema.com/blog/e10-unmasked] The spec's required states (productive/standby/engineering/scheduled-down/unscheduled-down/qualification + chamber-level availability) map directly onto E10 with a qualification sub-state.
  - **SEMI E90 — substrate tracking:** every **substrate (wafer)** movement and location inside equipment is tracked — this is the genealogy data source at wafer granularity. [https://en.wikipedia.org/wiki/SECS/GEM]
  - **SEMI E87 — carrier (FOUP/cassette) management;** **E40 — Process Jobs** (material list + recipe); **E94 — Control Jobs** (manage a set of Process Jobs); **E39/E116 — equipment metrics / EPT** (state durations feed E10); **E30 (GEM)** ties it together with **collection events, status variables, equipment constants, and state models**. The build models these as **typed domain events and state machines**, with a live SECS/GEM driver as a *future production adapter*. [https://en.wikipedia.org/wiki/SECS/GEM ; https://www.agileo.com/en/resources/gem300-introduction]
- **Route / process-flow semantics (the transactional core):**
  - A **route** is an ordered set of **operations**; each operation binds a **recipe** + qualified **equipment/chamber** + sampling plan. Real routes support **rework loops**, **split** (a lot fractions into child lots/wafer-subsets), **merge**, **engineering holds**, **queue-time (Q-time) constraints**, and **recipe qualification** gating.
  - **Q-time constraints** are first-class and *consequential*: the **maximum allowable wait between two operations** (e.g. pre-clean→deposition to avoid native-oxide regrowth); a **violation forces rework or scrap** — total loss of all prior processing investment. [https://flexciton.com/blog-news/scheduling-time-constraints-in-wafer-fabs ; https://www.appitsoftware.com/blog/semiconductor-production-planning-wafer-to-package] The Q-time clock must be on the **virtual clock**, evaluated at the *consuming* operation.
  - **Recipe qualification:** a recipe is runnable on a chamber only if that chamber is **qualified** for it (and the qual hasn't expired); dispatch and route-advance must both gate on qualification.
  - **Immutable process-run records + explicit disposition events** (explicit architecture requirement): a **process run** (this wafer-set × this recipe × this chamber × this reticle × this operator × this time) is **append-only and never mutated**; corrections happen via *new* disposition/hold/rework events, preserving the historical record. This is what makes genealogy trustworthy.
- **SPC, grounded in the real rule sets (data-driven, testable over numeric series):**
  - **Western Electric rules (the original 4)** + **Nelson rules (8 total)**: (1) 1 point beyond 3σ; (2) **2 of 3 beyond 2σ** (same side); (3) **4 of 5 beyond 1σ**; (4) **8/9 consecutive on one side** (shift); (5) **6 in a row trending**; (6/7/8) oscillation, stratification, mixture patterns. Rules **2, 3, 5 are especially valuable for catching gradual chamber degradation** before a limit breach. [https://metricgate.com/docs/control-chart-rules/ ; https://www.qimacros.com/control-chart/western-electric-rules/] Each rule is a **pure function over a numeric series with control limits supplied as fixtures**; **missing-sample handling** must be explicit (a gap is not a zero, and a rule window must not silently span a gap).
  - **Capability:** **Cpk targets — ≥1.33 standard, ≥1.67 critical parameters**; report capability per parameter. [https://www.appitsoftware.com/blog/semiconductor-spc-statistical-quality-control-erp]
  - **Run-to-run (R2R) context** (advanced extension, optional in slice): SPC *reacts* to violations; **R2R / EWMA** *proactively* tunes the next run's recipe settings from the last lot's metrology, **threaded by context** (product×operation×chamber). Modeling the threading is a genuine seam: an EWMA controller's state must be keyed by the right context or it corrupts unrelated lots. [https://www.sciencedirect.com/science/article/abs/pii/S0019057818303355]
- **Yield / excursion + disposition, grounded in real fab practice:**
  - **Excursion workflow:** detect (SPC pattern, metrology fail, defect spike) → **scope impacted wafers via genealogy** → **quarantine suspect material (hold)** → link evidence → **commonality analysis** (what do the bad wafers share — a chamber? a reticle? a Q-time violation? a time window?) → propose **containment/disposition**. [https://flexciton.com/blog-news/scheduling-time-constraints-in-wafer-fabs]
  - **Hold / disposition / MRB (Material Review Board):** a **hold blocks moves and consumption** at lot/carrier/wafer granularity; **disposition** decisions (release / rework / scrap / use-as-is / engineering-eval) are **explicit events** by authorized roles, conservative under uncertainty; **MRB** is the governed nonconformance path. [https://sgsystemsglobal.com/glossary/material-review-board-mrb/]
  - **Bin maps + genealogy → yield-loss attribution:** downstream **bin** results connect back through the genealogy to the chambers/reticles/recipes that touched each die/wafer, enabling "which chamber correlates with the bin-7 cluster" queries — the payoff of wafer-level genealogy.

## E2. The hardest technical seam #1 — the immutable wafer-level genealogy graph

This is the spine everything folds over. Model it explicitly:

- **Identity at two levels, never collapsed.** A **wafer** is a durable identity; a **lot** is a (time-varying) *grouping* of wafers. Split/merge/rework change *groupings and histories*, not wafer identity. A genealogy query must answer at **wafer** granularity: "for *this specific wafer*, every process run, chamber, reticle, recipe, operator, metrology result, and downstream bin, in order."
- **Append-only event log; the graph is a projection.** Process-run records, hold/disposition events, split/merge/rework events are **immutable**; the genealogy graph and all MES state are **folds** over the log. Corrections are new events. This guarantees the "reconstructable from source" property and gives free time-travel/audit.
- **Edges carry context, not just sequence.** A genealogy edge encodes *which chamber*, *which reticle*, *which recipe revision*, *which Q-time window* — because "equipment and chamber history matters for yield, not just operation name."
- **The split/merge/rework algebra is the trap.** Splitting a lot must give each child the correct **inherited prefix** of wafer histories; merging must **union** histories without losing any wafer's divergent past; rework must **append** a loop without erasing the original path (so "this wafer went through etch twice, the 2nd time on a different chamber" is queryable). Property-test conservation: **no split/merge/rework ever loses or duplicates a wafer**, and the union of children's wafer-sets equals the parent's.

## E3. The hardest technical seam #2 — conservative excursion scoping & containment under incomplete genealogy

When a chamber is found to have drifted (or a reticle is suspected contaminated), the question is *which wafers are at risk* — and the answer is frequently **uncertain**:

- **Scope = the superset of possibly-affected wafers.** Given "chamber C drifted starting in window [t0,t1]," the impacted set is **every wafer whose genealogy includes a run on C within [t0,t1] — plus any wafer with missing/ambiguous metrology that *cannot be proven outside* the window.** Conservative means: **unknown ⇒ included**, never excluded. [explicit: "containment decisions must be conservative under incomplete genealogy"]
- **Commonality analysis** computes what the confirmed-bad wafers share (chamber, reticle, recipe rev, operator, Q-time breach, time window) and *ranks candidate root causes* — but a *suspicion* (e.g. reticle contamination) widens, not narrows, the quarantine until disproven.
- **Quarantine is a hold that blocks moves + consumption** at the right granularity (wafer/lot/carrier); narrowing the scope (as metrology arrives proving wafers clean) is an **explicit disposition event**, auditable — you can always reconstruct *why* a wafer was held and *why* it was later released.
- **The missed-metrology case is the crux:** if the metrology that *would* have proven a wafer in/out of scope was **skipped** (sampling plan, or a missed-measurement), the wafer **stays in the conservative superset** and the system flags the metrology gap — it does **not** assume clean. Test this directly (the seed week's "missed metrology" + "reticle contamination suspicion" → downstream yield loss).
- **Invariant:** the quarantined set is **monotone under uncertainty** — new *exonerating* evidence can shrink it (via a disposition event); new *incriminating or ambiguous* evidence can only hold/grow it. No code path silently shrinks the quarantine without an evidence-backed disposition.

## E4. Determinism & testability strategy

- **Virtual clock** for **Q-time** evaluation, equipment-state durations (E10 accounting), dispatch tie-breaks, qual expiry, and excursion time-windows. No wall-clock anywhere.
- **Seeded entropy** for sampling-plan selection and any randomized dispatch tie-break; runs reproducible from `(seed, event-log)`.
- **Event-sourced MES core:** immutable process-run/hold/disposition/split/merge/rework events; genealogy, equipment state, SPC series, dispatch queue, and yield views are **projections** that re-fold byte-identically.
- **Fixture adapters, named, deterministic:** the **equipment/GEM event stream** (replays E10 state transitions, E90 substrate moves, process-run completions, metrology results as scripted events), **control-limit / SPC-rule fixtures** (control limits + rule config supplied as data, evaluated over deterministic numeric series), a **clock**, a **dispatch-policy config**, and a **metrology/defect-result** fixture. `npm test` touches no live tool, no SECS/GEM connection, no network.
- **The seed fab-week is the flagship integration fixture** (build it deterministically): **split-lot rework**, **chamber drift** (an SPC trend/shift fires before bins confirm), **missed metrology**, **reticle-contamination suspicion**, and **downstream yield loss** — exercising genealogy, SPC, equipment state, dispatch, hold/disposition, and conservative containment together.

## E5. Adversarial, failure, and edge-case scenarios (ship them as fixtures)

1. **The split-lot divergence.** A 25-wafer lot splits; 3 wafers rework through a *different* chamber, then the lot merges back. A later excursion on the original chamber must scope the **22** wafers that saw it — and a *different* excursion on the rework chamber must scope the **3** — proving wafer-level genealogy isn't lot-level approximation.
2. **The pre-confirmation chamber drift.** Chamber C's metrology parameter drifts gradually: no single point breaches 3σ, but **Nelson rule 5 (6-in-a-row trend)** and **rule 3 (4-of-5 beyond 1σ)** fire. The system must raise the SPC signal and enable proactive scoping **before** final-test bins confirm the loss. The negative companion: a *noisy-but-in-control* series must **not** trip the rules (no false excursion).
3. **The missed-metrology conservative hold.** Sampling skips the measurement that would exonerate a sub-population during the drift window. Those wafers **remain quarantined** (unknown ⇒ included); the system flags the metrology gap rather than releasing on optimism.
4. **The Q-time violation.** A lot waits past the pre-clean→deposition Q-time limit (virtual clock). At the consuming operation the system **detects the breach** and routes to **rework or scrap** per policy — and the genealogy records the violation as a possible excursion-commonality factor.
5. **The reticle-contamination suspicion (widening).** A reticle is *suspected* (not confirmed) contaminated. Every lot exposed with that reticle is **held conservatively**; the quarantine **grows** to the full exposure population and only narrows via disposition as wafers are cleared — it never optimistically excludes.
6. **The unqualified-recipe block.** A dispatch attempt routes a lot to a chamber whose qualification for that recipe **expired**. Both the dispatcher and the route-advance **refuse**, with an explainable reason (qual-expired), not a silent run.
7. **The equipment-state accounting trap.** A tool transitions PRD→UDT (failure)→SDT (repair PM)→SBY. The E10 time-accounting must remain **mutually exclusive + exhaustive** (no double-counted or unaccounted seconds), and MTBF/MTTR/availability must compute correctly from the transitions.
8. **The dispatch tie + bottleneck.** Two lots contend for the bottleneck tool; dispatch must rank **deterministically** by the documented policy (due-date, Q-time urgency, bottleneck criticality, hold-state, recipe-qual, sampling need) and **explain** the bottleneck + hold reasoning — same inputs ⇒ same ranking.
9. **The merge that would lose history.** A merge of two lots with divergent wafer histories must **union** all wafer pasts; a bug that takes only one parent's history is caught by the conservation property test.

## E6. Rigorous acceptance criteria (invariant + property-based)

Beyond the base criteria:

- **Genealogy conservation (property):** across any sequence of split/merge/rework events, **no wafer is lost or duplicated**; the union of a parent's children's wafer-sets equals the parent's; every wafer's history is the correct fold of the runs that touched it. Fuzz random route sequences.
- **Immutability (invariant):** **no** process-run record is ever mutated; all corrections are new disposition/hold events. (Differential test: process-run records are append-only; re-folding the log reproduces identical genealogy.)
- **Conservative-containment monotonicity (invariant/property):** the quarantined set never shrinks except via an evidence-backed disposition event; ambiguous/missing evidence keeps a wafer **in** scope. The missed-metrology fixture keeps the affected wafers held.
- **SPC rule correctness (property + examples):** each Western-Electric/Nelson rule fires **iff** its pattern is present over the numeric series; **missing samples never fabricate or suppress** a rule incorrectly; limit-breach, trend, shift, outlier, and missing-data fixtures all pass; the in-control noisy series trips **nothing**.
- **Equipment-state exhaustiveness (invariant):** E10 state durations are mutually exclusive and sum to the observation period exactly; MTBF/MTTR/availability match hand-worked fixtures.
- **Dispatch determinism + explainability:** same inputs ⇒ identical ranking; each ranking explains bottleneck + hold + qual decisions from source facts.
- **Q-time correctness:** a breach is detected at the consuming operation per the virtual clock and routed per policy; a within-limit wait is not flagged.
- **Totality of reconstruction (the headline invariant):** redact all human-readable prose; the **structured genealogy + event log alone** must answer the full audit battery — "which wafers did chamber C touch in [t0,t1]?", "why is wafer W held?", "why did this SPC signal fire?", "why this dispatch rank?", "which chambers/reticles correlate with the bin-7 cluster?".

## E7. The concrete first vertical slice (the on-ramp — ~46–50 cards, build THIS first)

Given the tier-18 budget, prove the **genealogy + equipment-state + SPC + conservative-containment spine** on a focused fab-week before fanning out:

1. **Immutable MES core + event log (E2):** typed entities (Product, Wafer, Lot, Carrier, Route, Operation, Recipe, Equipment, Chamber, Reticle, ProcessRun, MetrologyResult, SPCRule, Hold, Disposition, BinMap, Excursion) + append-only event log + virtual clock + seeded PRNG. (~8 cards)
2. **Route engine with the split/merge/rework algebra + Q-time + recipe-qualification gating** — the conservation-safe groupings, immutable runs, explicit dispositions. (~8 cards)
3. **SEMI E10 equipment-state machine** (six states + qualification sub-state, chamber-level availability) with mutually-exclusive/exhaustive time-accounting → availability/MTBF/MTTR/OEE. (~6 cards)
4. **Wafer-level genealogy graph projection (E2)** + the core genealogy queries (per-wafer history; "which wafers did chamber C touch in window"; bin-cluster→chamber/reticle correlation). (~7 cards)
5. **Data-driven SPC engine (E1):** Western-Electric/Nelson rules over numeric series with fixture control limits, explicit missing-sample handling, Cpk; the chamber-drift detection (rules 3/5 fire pre-bin) + the in-control negative test. (~6 cards)
6. **Conservative excursion + hold/disposition workflow (E3):** detect → genealogy-scope the **superset** → quarantine → commonality analysis → disposition events; the missed-metrology conservative-hold and reticle-suspicion widening. (~6 cards)
7. **Deterministic dispatch priority engine** (due-date, Q-time urgency, bottleneck, hold-state, recipe-qual, sampling) — deterministic + explainable. (~3 cards)
8. **The seed-fab-week integration fixture + the full invariant battery** (genealogy conservation, immutability, containment monotonicity, SPC correctness, E10 exhaustiveness, dispatch determinism, totality-of-reconstruction redaction test) — all green. (~4 cards)

If that spine holds, run-to-run/EWMA control, richer yield analytics, bin-map visualizations, and the operator UI are *breadth on a provably-reconstructable core*. If wafer identity or immutability is wrong, none of the rest can be trusted — which is exactly why they come first.

## E8. Domain knowledge-debt to track (surface, don't bluff)

- **SEMI standards are licensed and detailed** (E10, E30/GEM, E40, E87, E90, E94, E116/E39); the build models the **concepts and state machines** from public summaries and flags the **wire-level SECS-II/HSMS protocol** + exact state-transition tables as **expert/standard-review-needed** before any live integration.
- **SPC rule parameterization** (which rules enabled per parameter, σ-zone definitions, subgroup size, control-limit derivation) is a process-engineering decision; the engine is data-driven, the *rationalized config* is expert-supplied. Cpk targets (1.33/1.67) are common but parameter-specific.
- **Q-time limits** are recipe/step-specific empirical values; encode a defensible subset, flag for process-integration review.
- **Disposition authority + MRB governance** (who may scrap/release/use-as-is) is a quality-system matter (intersecting customer + ISO/IATF requirements); model the roles, defer the policy specifics.
- **Commonality / root-cause attribution** is statistically subtle (confounded chambers, multi-factor excursions); implement transparent commonality ranking and mark causal *certainty* as engineering judgment the system *supports*, not decides — never an opaque ML verdict (explicit non-goal).
- **R2R/EWMA controller tuning** (gains, context-threading granularity, deadband) is advanced APC expertise; if attempted beyond the slice, flag the control-theory assumptions for review.
- **Yield-model specifics** (defect-density models, bin definitions, kill-ratio) are product/tech-node-specific; record assumptions, defer to yield engineers.

## E9. Why this is a great !Klein challenge

It is one of the most *decomposition-punishing* domains available: the right build is **strictly dependency-ordered** — immutable event log → genealogy graph → equipment state → SPC → containment → dispatch → UI — and any shortcut (lot-level identity, mutable runs, optimistic containment, single-limit SPC) **silently corrupts everything downstream** while still looking plausible to a weak model. Because the entire thing is **deterministic** (virtual clock + event-sourced re-folding + data-driven SPC over numeric fixtures) and **reconstructable-from-source** (redact the prose; the genealogy answers the audit battery), a swarm of small local models is graded on **getting the architecture and the conservative-under-uncertainty invariants right**, not on cleverness. That is precisely the !Klein thesis — that governed decomposition and hard invariants let weak models build a genuinely rigorous system — at the top end of the tier ladder.

---

## Small-model build guide (3B-ready)

This section makes the spec mechanically buildable by a ~3B parameter local model. Every card below is small enough to implement and verify in isolation. Follow the dependency order exactly — do not skip ahead.

### 1. Glossary & ground rules

**Domain terms:**

- **Wafer** — a durable physical entity with a unique id; carries its own per-operation history. A wafer's identity never changes. Do NOT collapse wafer identity into its current lot.
- **Lot** — a time-varying *grouping* of wafers. A lot has an id, a `waferIds: string[]`, and a route pointer. Split/merge/rework change lot groupings; they do not change wafer identities.
- **Carrier** — a FOUP or cassette that physically holds wafers; has an id and `waferIds[]`.
- **Route** — an ordered list of `Operation` ids; supports rework loops, splits, and merges.
- **Operation** — one step in a Route; has an id, name, `recipeId`, `qualifiedChamberIds[]`, a sampling plan, and a `qTimeConstraint?` (max wait before the *next* operation in ms).
- **Recipe** — a set of process parameters; has an id, version, and name. A recipe is runnable on a chamber only when that chamber is qualified for it.
- **Equipment** — a tool; has an id and `chamberIds[]`.
- **Chamber** — the processing unit inside a tool; has an id, equipmentId, and a `qualifications: Record<recipeId, { expiresAt: number }>`.
- **Reticle** — a lithography mask; has an id and `suspectedContaminated: boolean`.
- **ProcessRun** — an immutable record of one lot-subset processing event: id, lotId, waferIds (subset), operationId, recipeId, chamberId, reticleId?, operatorId, startAt (virtual clock), endAt, metrology results link. **ProcessRun records are NEVER mutated.** Corrections happen via new disposition events.
- **MetrologyResult** — measurement data for a wafer/lot: id, lotId, waferIds, operationId, parameterId, value, unit, measuredAt (virtual clock), skipped: boolean (for sampling gaps).
- **Hold** — blocks all moves and consumption for a lot/carrier/wafer: id, targetId, targetType (`'lot' | 'carrier' | 'wafer'`), reason, placedAt, placedBy, disposition? (set when released/resolved).
- **Disposition** — an explicit event releasing/resolving a hold: id, holdId, decision (`'release' | 'rework' | 'scrap' | 'use-as-is' | 'engineering-eval'`), authorizedBy, decidedAt, evidenceRefs.
- **BinMap** — downstream yield test result: id, waferId, lotId, binResults: `Record<string, number>` (binName → die count), measuredAt.
- **Excursion** — a detected yield/quality event: id, type (`'spc-violation' | 'metrology-fail' | 'defect-spike'`), detectedAt, impactedWaferIds (the conservative superset), chamberId?, reticleId?, qTimeViolation: boolean, holdIds[].
- **SpcRule** — one Western Electric / Nelson rule: id, name, description, `evaluate(series: number[], controlLimits: ControlLimits): boolean`.
- **ControlLimits** — `{ ucl: number; lcl: number; mean: number; sigma: number }` — supplied as fixture data, never computed at runtime in the slice.
- **EquipmentState** — the SEMI E10 state of an equipment or chamber: `'PRD' | 'SBY' | 'ENG' | 'SDT' | 'UDT' | 'NST'` (Productive, Standby, Engineering, Scheduled Downtime, Unscheduled Downtime, Non-Scheduled). States are mutually exclusive and exhaustive.
- **Virtual clock** — injected `Clock` with `now(): number`. Used for Q-time evaluation, equipment state durations, dispatch tie-breaks, qualification expiry, excursion time windows. Never `Date.now()`.
- **Append-only event log** — the authoritative record; process-run records, hold/disposition/split/merge/rework events are immutable entries. All MES state, genealogy, SPC series, dispatch queue, and yield views are **projections** (folds over the log).
- **Wafer conservation** — across any split/merge/rework sequence, no wafer is lost or duplicated; the union of children's wafer-sets equals the parent's.
- **Conservative superset** — when scoping excursion impact: unknown ⇒ included. A wafer with missing or ambiguous metrology stays in the quarantine set until a disposition event explicitly releases it.
- **Q-time violation** — the lot waited longer than `operation.qTimeConstraint` between two operations; detected at the consuming operation using the virtual clock.

**Stack:**

- Language: TypeScript (strict, no `any`).
- Runtime: Node.js 20+.
- Test runner: Vitest (`npm test` = `vitest run`).
- No build step for tests; `vitest.config.ts` handles TypeScript via Vite.
- No runtime dependencies beyond Node built-ins and `vitest`.
- Fixture data in `src/fixtures/*.ts` (typed constants).
- Adapter interfaces in `src/adapters/`; deterministic implementations in `src/adapters/fixture/`.

**Acceptance command:**

```
cd <project-root>
npm install
npm test           # vitest run — must exit 0 with all suites green
```

No live SECS/GEM connection, no network, no `Date.now()`.

**Determinism rules (imperative):**

1. Never call `Date.now()` or `Math.random()`. Use injected `Clock` and `SeededRng`.
2. ProcessRun records are never mutated. All corrections are new disposition/hold events.
3. Split/merge/rework must pass wafer conservation (property-tested: union of children = parent).
4. Quarantine is monotone: it only shrinks via a disposition event. Missing metrology keeps wafers in scope.
5. SPC rule functions are pure: `evaluate(series, controlLimits) → boolean`. No side effects, no wall-clock.
6. Equipment state transitions must be mutually exclusive and exhaustive: no overlap, no unaccounted time.

---

### 2. The explicit task graph for the first vertical slice

The first vertical slice covers E7 items 1–8 from the spec: MES core, route engine, E10 equipment-state machine, genealogy projection, SPC engine, conservative excursion + hold/disposition, dispatch priority engine, and the seed-fab-week integration fixture + invariant battery. Build these 48 cards in order.

---

**`F01` — Project scaffold and virtual clock**

dependsOn: none

files: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/lib/clock.ts`, `test/lib/clock.test.ts`

interface:
```ts
export interface Clock { now(): number }
export class ManualClock implements Clock {
  constructor(private _now: number) {}
  now() { return this._now }
  advance(ms: number) { this._now += ms }
  set(ts: number) { this._now = ts }
}
```

how to implement: `package.json` with `vitest`, `typescript`; `tsconfig.json` strict; `vitest.config.ts` empty `defineConfig({})`.

acceptance: ManualClock(1000).now() === 1000; advance(500) → 1500; set(0) → 0. `npm test` → green.

---

**`F02` — Seeded PRNG**

dependsOn: `F01`

files: `src/lib/prng.ts`, `test/lib/prng.test.ts`

interface:
```ts
export class SeededRng {
  constructor(seed: number) {}
  next(): number; nextInt(max: number): number; shuffle<T>(arr: T[]): T[]
}
```

how to implement: LCG `state = (state * 1664525 + 1013904223) >>> 0`.

acceptance: seed stability + known shuffle for seed 99. `npm test` → green.

---

**`F03` — Core MES domain types (Part 1: entities)**

dependsOn: `F01`

files: `src/domain/types.ts`, `test/domain/types.test.ts`

interface:
```ts
export interface Wafer { id: string; productId: string; createdAt: number }
export interface Lot {
  id: string; waferIds: string[]; routeId: string
  currentOperationId: string | null; status: LotStatus
}
export type LotStatus = 'active' | 'on-hold' | 'completed' | 'scrapped'
export interface Carrier { id: string; waferIds: string[] }
export interface Operation {
  id: string; routeId: string; stepIndex: number; name: string
  recipeId: string; qualifiedChamberIds: string[]
  qTimeConstraintMs?: number    // max ms wait before next operation
  samplingPlan: SamplingPlan
}
export interface SamplingPlan {
  type: 'all' | 'every-nth' | 'first-of-batch'
  n?: number
}
export interface Route { id: string; name: string; operationIds: string[] }
export interface Recipe { id: string; version: number; name: string }
export interface Equipment { id: string; name: string; chamberIds: string[] }
export interface Chamber {
  id: string; equipmentId: string
  qualifications: Record<string, { expiresAt: number }>  // recipeId → expiry
}
export interface Reticle { id: string; name: string; suspectedContaminated: boolean }
export interface ProcessRun {
  id: string; lotId: string; waferIds: string[]; operationId: string
  recipeId: string; chamberId: string; reticleId?: string; operatorId: string
  startAt: number; endAt: number
}
export interface MetrologyResult {
  id: string; lotId: string; waferIds: string[]; operationId: string
  parameterId: string; value: number; unit: string; measuredAt: number
  skipped: boolean
}
export interface Hold {
  id: string; targetId: string; targetType: 'lot' | 'carrier' | 'wafer'
  reason: string; placedAt: number; placedBy: string
  dispositionId?: string
}
export interface Disposition {
  id: string; holdId: string
  decision: 'release' | 'rework' | 'scrap' | 'use-as-is' | 'engineering-eval'
  authorizedBy: string; decidedAt: number; evidenceRefs: string[]
}
export interface BinMap {
  id: string; waferId: string; lotId: string
  binResults: Record<string, number>; measuredAt: number
}
```

acceptance: `tsc --noEmit`; trivial `satisfies Wafer` assignment test. `npm test` → green.

---

**`F04` — Core MES domain types (Part 2: events, SPC, excursion, dispatch)**

dependsOn: `F03`

files: `src/domain/types.ts` (extend), `src/domain/event-types.ts`, `test/domain/event-types.test.ts`

interface (add to `src/domain/event-types.ts`):
```ts
export type MesEventKind =
  | 'process-run-completed' | 'metrology-recorded' | 'hold-placed' | 'disposition-recorded'
  | 'lot-split' | 'lot-merge' | 'lot-rework-started' | 'lot-rework-completed'
  | 'equipment-state-changed' | 'spc-rule-fired' | 'excursion-detected'
  | 'q-time-checked'

export interface MesEvent {
  id: string; kind: MesEventKind; occurredAt: number; payload: MesEventPayload
}

export type MesEventPayload =
  | { kind: 'process-run-completed'; run: ProcessRun }
  | { kind: 'metrology-recorded'; result: MetrologyResult }
  | { kind: 'hold-placed'; hold: Hold }
  | { kind: 'disposition-recorded'; disposition: Disposition }
  | { kind: 'lot-split'; parentLotId: string; childLotIds: string[]; waferAssignments: Record<string, string> }
    // waferAssignments: waferId → childLotId
  | { kind: 'lot-merge'; parentLotIds: string[]; mergedLotId: string; allWaferIds: string[] }
  | { kind: 'lot-rework-started'; lotId: string; waferIds: string[]; targetOperationId: string; reason: string }
  | { kind: 'lot-rework-completed'; lotId: string; waferIds: string[] }
  | { kind: 'equipment-state-changed'; equipmentId: string; chamberId?: string; from: EquipmentE10State; to: EquipmentE10State; at: number }
  | { kind: 'spc-rule-fired'; parameterId: string; ruleId: string; lotId: string; operationId: string; at: number }
  | { kind: 'excursion-detected'; excursion: Excursion }
  | { kind: 'q-time-checked'; lotId: string; operationId: string; waitMs: number; violated: boolean; constraintMs: number }

export type EquipmentE10State = 'PRD' | 'SBY' | 'ENG' | 'SDT' | 'UDT' | 'NST'

export interface Excursion {
  id: string; type: 'spc-violation' | 'metrology-fail' | 'defect-spike'
  detectedAt: number; impactedWaferIds: string[]
  chamberId?: string; reticleId?: string; qTimeViolation: boolean; holdIds: string[]
}

export interface ControlLimits { ucl: number; lcl: number; mean: number; sigma: number }
```

acceptance: `tsc --noEmit`; trivial discriminated-union narrowing test. `npm test` → green.

---

**`F05` — Append-only MES event log**

dependsOn: `F03`, `F04`

files: `src/domain/event-log.ts`, `test/domain/event-log.test.ts`

interface:
```ts
export class MesEventLog {
  append(event: MesEvent): void
  events(): readonly MesEvent[]                      // all events, chronological by occurredAt
  eventsOfKind<K extends MesEventKind>(kind: K): readonly MesEvent[]
  eventsForLot(lotId: string): readonly MesEvent[]   // events whose payload references lotId
  eventsForChamber(chamberId: string): readonly MesEvent[]
}
```

how to implement:
1. Private `MesEvent[]` array (append-only).
2. `events()` returns a frozen shallow copy sorted by `occurredAt`.
3. `eventsOfKind`: filter by `event.kind`.
4. `eventsForLot`: filter events where payload contains lotId (check known payload shapes).
5. `eventsForChamber`: filter `process-run-completed` events where `run.chamberId === chamberId`, plus `equipment-state-changed` events.

acceptance: `test/domain/event-log.test.ts`:
- Append 3 events; `events().length === 3`.
- `eventsOfKind('hold-placed')` returns only hold events.
- `eventsForLot('lot-1')` returns only events referencing lot-1.
- Append order does not matter; results sorted by occurredAt.
`npm test` → green.

---

**`F06` — Fixtures: seed fab-week entities**

dependsOn: `F03`, `F04`

files: `src/fixtures/fab-week.ts`

interface: exports all typed constants needed by the slice.

```ts
export const CLOCK_EPOCH = 1_700_000_000_000  // ms epoch for all tests

// Products
export const PRODUCT_A = { id: 'product-a', name: 'Logic IC Rev 2' }

// Wafers: 25-wafer lot
export const WAFER_IDS: string[] = Array.from({ length: 25 }, (_, i) => `w-${String(i+1).padStart(3,'0')}`)
export const WAFER_IDS_MAIN = WAFER_IDS.slice(0, 22)  // 22 stay in lot-main path
export const WAFER_IDS_REWORK = WAFER_IDS.slice(22)   // 3 reworked through alt chamber

// Lots
export const LOT_A: Lot = {
  id: 'lot-a', waferIds: [...WAFER_IDS], routeId: 'route-1',
  currentOperationId: 'op-etch', status: 'active'
}

// Routes + Operations
export const OP_PRECLEAN: Operation = {
  id: 'op-preclean', routeId: 'route-1', stepIndex: 0,
  name: 'Pre-Clean', recipeId: 'recipe-preclean-v1',
  qualifiedChamberIds: ['chamber-c1', 'chamber-c2'],
  qTimeConstraintMs: 4 * 3600 * 1000,  // 4h max wait before deposition
  samplingPlan: { type: 'all' }
}
export const OP_DEPOSITION: Operation = {
  id: 'op-deposition', routeId: 'route-1', stepIndex: 1,
  name: 'CVD Deposition', recipeId: 'recipe-cvd-v1',
  qualifiedChamberIds: ['chamber-c1'],
  samplingPlan: { type: 'every-nth', n: 5 }
}
export const OP_ETCH: Operation = {
  id: 'op-etch', routeId: 'route-1', stepIndex: 2,
  name: 'Dry Etch', recipeId: 'recipe-etch-v1',
  qualifiedChamberIds: ['chamber-c3', 'chamber-c4'],  // c4 = alt chamber for rework
  samplingPlan: { type: 'all' }
}

// Equipment + Chambers
export const EQUIP_CVD: Equipment = { id: 'equip-cvd', name: 'CVD Tool 1', chamberIds: ['chamber-c1','chamber-c2'] }
export const CHAMBER_C1: Chamber = {
  id: 'chamber-c1', equipmentId: 'equip-cvd',
  qualifications: { 'recipe-cvd-v1': { expiresAt: CLOCK_EPOCH + 30 * 24 * 3600 * 1000 } }
}
export const CHAMBER_C2: Chamber = {
  id: 'chamber-c2', equipmentId: 'equip-cvd',
  qualifications: { 'recipe-preclean-v1': { expiresAt: CLOCK_EPOCH + 30 * 24 * 3600 * 1000 } }
}
export const CHAMBER_C3: Chamber = {
  id: 'chamber-c3', equipmentId: 'equip-etch',
  qualifications: { 'recipe-etch-v1': { expiresAt: CLOCK_EPOCH + 30 * 24 * 3600 * 1000 } }
}
export const CHAMBER_C4: Chamber = {
  id: 'chamber-c4', equipmentId: 'equip-etch',
  qualifications: { 'recipe-etch-v1': { expiresAt: CLOCK_EPOCH + 30 * 24 * 3600 * 1000 } }
}

// Reticle (suspected contaminated in seed scenario)
export const RETICLE_R1: Reticle = { id: 'reticle-r1', name: 'Metal-1 Mask', suspectedContaminated: false }

// SPC control limits for deposition parameter (fixture values)
export const SPC_LIMITS_CVD_THICKNESS: ControlLimits = {
  mean: 100.0, sigma: 1.5, ucl: 104.5, lcl: 95.5  // ±3σ limits
}

// Metrology parameter
export const PARAM_CVD_THICKNESS = 'cvd-thickness-nm'
```

acceptance: compile check; trivial import test. `npm test` → green.

---

**`F07` — Lot split algebra**

dependsOn: `F03`, `F04`, `F05`, `F06`

files: `src/domain/route/lot-split.ts`, `test/domain/route/lot-split.test.ts`

interface:
```ts
export interface SplitResult {
  childLots: Lot[]
  event: MesEvent    // kind: 'lot-split'
}

export function splitLot(
  parent: Lot,
  waferAssignments: Record<string, string>,   // waferId → new childLotId
  newLotIds: string[],
  clock: Clock
): SplitResult
```

how to implement:
1. Validate: every waferId in assignments must be in `parent.waferIds`; every childLotId must be in `newLotIds`; every wafer in `parent.waferIds` must appear in assignments exactly once.
2. If validation fails, throw a descriptive Error (not a silent no-op).
3. Build each child lot with `waferIds` from the assignments and same `routeId` as parent.
4. Emit `lot-split` event with `parentLotId, childLotIds, waferAssignments, occurredAt: clock.now()`.
5. The parent lot is now conceptually "split"; callers must not use it further (represent this by setting `parent.status = 'completed'` in the returned event payload only — do not mutate the input).

acceptance: `test/domain/route/lot-split.test.ts`:
- Split 25-wafer LOT_A into two children (22 + 3 wafers): children have correct waferIds; union = original 25; no wafer duplicated.
- Wafer conservation: `new Set([...child1.waferIds, ...child2.waferIds])` has exactly 25 members equal to `new Set(LOT_A.waferIds)`.
- Missing wafer in assignment → throws.
- Duplicate wafer assignment → throws.
`npm test` → green.

---

**`F08` — Lot merge algebra**

dependsOn: `F03`, `F04`, `F05`, `F06`

files: `src/domain/route/lot-merge.ts`, `test/domain/route/lot-merge.test.ts`

interface:
```ts
export interface MergeResult {
  mergedLot: Lot
  event: MesEvent    // kind: 'lot-merge'
}

export function mergeLots(
  parents: Lot[],
  mergedLotId: string,
  clock: Clock
): MergeResult
```

how to implement:
1. Validate: no wafer appears in more than one parent.
2. Union all `waferIds` into the merged lot.
3. The merged lot inherits `routeId` from the first parent (they must all be on the same route — validate this too).
4. Emit `lot-merge` event.

acceptance: `test/domain/route/lot-merge.test.ts`:
- Merge two child lots (22 + 3) back into one: merged lot has 25 waferIds; union matches original; no duplicates.
- Wafer conservation property: merged waferIds set equals the union of parents' waferIds sets.
- Duplicate wafer (appears in both parents) → throws.
`npm test` → green.

---

**`F09` — Lot rework algebra**

dependsOn: `F03`, `F04`, `F05`, `F06`

files: `src/domain/route/lot-rework.ts`, `test/domain/route/lot-rework.test.ts`

interface:
```ts
export interface ReworkResult {
  reworkStartEvent: MesEvent    // kind: 'lot-rework-started'
  reworkEndEvent: MesEvent      // kind: 'lot-rework-completed'
}

export function recordRework(
  lotId: string,
  waferIds: string[],
  targetOperationId: string,
  reason: string,
  clock: Clock
): { startEvent: MesEvent }  // endEvent emitted separately when rework completes
```

how to implement:
1. Emit `lot-rework-started` event with lotId, waferIds, targetOperationId, reason, occurredAt.
2. The rework-started event marks the wafers as re-routed to `targetOperationId` without erasing prior history.
3. Provide a separate `completeRework(lotId, waferIds, clock): { endEvent }` function that emits `lot-rework-completed`.

acceptance: `test/domain/route/lot-rework.test.ts`:
- `recordRework` returns a `lot-rework-started` event with correct waferIds and targetOperationId.
- `completeRework` returns a `lot-rework-completed` event.
- Events do not mutate the input lot (immutable input contract: the caller appends to the log separately).
`npm test` → green.

---

**`F10` — Wafer-conservation property test**

dependsOn: `F07`, `F08`, `F09`, `F02`

files: `test/domain/route/wafer-conservation.test.ts`

interface: no new exports; test-only.

how to implement:
1. Generate a random sequence of 5 splits + 3 merges using `SeededRng(42)` over 25 initial wafers.
2. After each operation, assert the union of all active lots' waferIds equals the original 25-wafer set.
3. After a rework, assert the reworked wafers still appear in exactly one lot.

acceptance: all assertions pass across 5 random sequences. `npm test` → green.

---

**`F11` — Q-time constraint checker**

dependsOn: `F03`, `F04`, `F05`, `F06`

files: `src/domain/route/q-time.ts`, `test/domain/route/q-time.test.ts`

interface:
```ts
export interface QTimeCheckResult {
  violated: boolean
  waitMs: number
  constraintMs: number
  lotId: string
  operationId: string
}

export function checkQTime(
  lotId: string,
  consumingOperationId: string,
  priorOperationCompletedAt: number,
  consumingOperationStartAt: number,
  constraintMs: number
): QTimeCheckResult
```

how to implement:
1. `waitMs = consumingOperationStartAt - priorOperationCompletedAt`.
2. `violated = constraintMs !== undefined && waitMs > constraintMs`.
3. Return the result object.

acceptance: `test/domain/route/q-time.test.ts`:
- `waitMs = 3h`, `constraintMs = 4h` → `violated: false`.
- `waitMs = 5h`, `constraintMs = 4h` → `violated: true`.
- Both cases return correct `waitMs` and `constraintMs`.
`npm test` → green.

---

**`F12` — Recipe qualification gate**

dependsOn: `F03`, `F06`

files: `src/domain/route/recipe-qual.ts`, `test/domain/route/recipe-qual.test.ts`

interface:
```ts
export interface QualificationCheckResult {
  qualified: boolean
  reason?: string   // 'not-qualified' | 'qual-expired' | 'qualified'
  expiresAt?: number
}

export function checkRecipeQualification(
  chamber: Chamber,
  recipeId: string,
  atTime: number
): QualificationCheckResult
```

how to implement:
1. If `recipeId` not in `chamber.qualifications` → `{ qualified: false, reason: 'not-qualified' }`.
2. If `chamber.qualifications[recipeId].expiresAt < atTime` → `{ qualified: false, reason: 'qual-expired' }`.
3. Otherwise → `{ qualified: true, reason: 'qualified', expiresAt: ... }`.

acceptance: `test/domain/route/recipe-qual.test.ts`:
- CHAMBER_C1 qualified for recipe-cvd-v1 at CLOCK_EPOCH → qualified.
- CHAMBER_C1 at CLOCK_EPOCH + 31 days (past expiry) → qual-expired.
- CHAMBER_C1 for 'recipe-unknown' → not-qualified.
- Route advance must call this check; dispatch must call this check. (Tested in later integration cards.)
`npm test` → green.

---

**`F13` — Process run recording**

dependsOn: `F03`, `F04`, `F05`, `F11`, `F12`

files: `src/domain/route/process-run.ts`, `test/domain/route/process-run.test.ts`

interface:
```ts
export interface ProcessRunResult {
  run: ProcessRun
  event: MesEvent    // kind: 'process-run-completed'
  qTimeCheck?: QTimeCheckResult
  qualCheck: QualificationCheckResult
}

export function recordProcessRun(
  args: {
    lotId: string; waferIds: string[]; operationId: string
    recipeId: string; chamber: Chamber; reticleId?: string
    operatorId: string; startAt: number; endAt: number
    priorOperationCompletedAt?: number; qTimeConstraintMs?: number
  }
): ProcessRunResult
```

how to implement:
1. Call `checkRecipeQualification(chamber, recipeId, args.startAt)`. If not qualified → throw `Error("Cannot run: ${qualCheck.reason}")`.
2. If `priorOperationCompletedAt` provided, call `checkQTime`.
3. Build the `ProcessRun` object (immutable — the id is a caller-supplied or uuid-style string).
4. Emit `process-run-completed` event.
5. Return all three.

acceptance: `test/domain/route/process-run.test.ts`:
- Valid run on CHAMBER_C1 with recipe-cvd-v1 → run recorded, event emitted.
- Unqualified recipe → throws (no run recorded).
- Q-time violation with constraint → check result has `violated: true`; run still recorded (violation is flagged, not blocked here — the dispatch layer blocks before it starts).
`npm test` → green.

---

**`F14` — SEMI E10 equipment-state machine**

dependsOn: `F03`, `F04`, `F05`

files: `src/domain/equipment/e10-state.ts`, `test/domain/equipment/e10-state.test.ts`

interface:
```ts
export interface E10StateRecord {
  equipmentId: string; state: EquipmentE10State
  enteredAt: number; exitedAt?: number
}

export interface E10AccountingResult {
  equipmentId: string
  observationStart: number; observationEnd: number
  stateDurations: Record<EquipmentE10State, number>   // ms in each state
  totalMs: number       // must equal observationEnd - observationStart
  availability: number  // PRD / (PRD + SDT + UDT)
  utilization: number   // PRD / (PRD + SBY + ENG)
  mtbfMs: number | null
  mttrMs: number | null
}

export function computeE10Accounting(
  equipmentId: string,
  stateRecords: E10StateRecord[],
  observationStart: number,
  observationEnd: number
): E10AccountingResult
```

how to implement:
1. Sort state records by `enteredAt`.
2. For each pair of consecutive records (or the last record's exit = observationEnd), compute duration in state.
3. Sum durations by state. Assert (in implementation): `Object.values(stateDurations).reduce((a,b) => a+b, 0) === totalMs`.
4. `availability = stateDurations.PRD / (stateDurations.PRD + stateDurations.SDT + stateDurations.UDT)`.
5. `utilization = stateDurations.PRD / (stateDurations.PRD + stateDurations.SBY + stateDurations.ENG)`.
6. Count UDT entries as failures for MTBF; sum UDT durations for MTTR.

acceptance: `test/domain/equipment/e10-state.test.ts`:
- Transition sequence PRD(2h)→UDT(1h)→SDT(2h)→SBY(1h) over 6h: stateDurations sums to exactly 6h (21600000ms); availability = 2/(2+2+1); mtbfMs = 2h (2h of uptime before 1 failure).
- Exhaustiveness invariant: assert `totalMs === observationEnd - observationStart` (any rounding error → test fails).
- PRD→UDT→SDT→SBY scenario from E5 item 7 — E10 time-accounting remains mutually exclusive + exhaustive.
`npm test` → green.

---

**`F15` — E10 state-transition event emitter**

dependsOn: `F04`, `F05`, `F14`

files: `src/domain/equipment/e10-transition.ts`, `test/domain/equipment/e10-transition.test.ts`

interface:
```ts
export function recordEquipmentStateChange(
  equipmentId: string,
  from: EquipmentE10State,
  to: EquipmentE10State,
  chamberId: string | undefined,
  clock: Clock
): MesEvent   // kind: 'equipment-state-changed'
```

how to implement: build and return the event (the caller appends to the log). No state mutation.

acceptance: calling `recordEquipmentStateChange('equip-cvd', 'PRD', 'UDT', undefined, clock)` returns an event with kind `'equipment-state-changed'` and correct payload fields. `npm test` → green.

---

**`F16` — Wafer-level genealogy projection**

dependsOn: `F03`, `F04`, `F05`, `F07`, `F08`, `F09`, `F13`

files: `src/domain/genealogy/genealogy.ts`, `test/domain/genealogy/genealogy.test.ts`

interface:
```ts
export interface WaferHistory {
  waferId: string
  runs: Array<{
    operationId: string; recipeId: string; chamberId: string
    reticleId?: string; startAt: number; endAt: number
    lotId: string
  }>
  metrologyResults: MetrologyResult[]
  holdIds: string[]
  reworkedAtOperationIds: string[]
}

export interface GenealogyIndex {
  forWafer(waferId: string): WaferHistory
  wafersInChamberWindow(chamberId: string, windowStart: number, windowEnd: number): string[]
  wafersInReticleExposures(reticleId: string): string[]
}

export function buildGenealogyIndex(log: MesEventLog): GenealogyIndex
```

how to implement:
1. Fold over all `process-run-completed` events; for each wafer in `run.waferIds`, append a run record.
2. Fold over `metrology-recorded` events; for each wafer in `result.waferIds`, append the result.
3. Fold over `hold-placed` events; for each event, record the holdId against the lot's wafers.
4. Fold over rework events to record `reworkedAtOperationIds`.
5. `wafersInChamberWindow`: return wafer ids whose runs include `chamberId` with `startAt >= windowStart && endAt <= windowEnd`.
6. `wafersInReticleExposures`: return wafer ids whose runs include `reticleId`.

acceptance: `test/domain/genealogy/genealogy.test.ts`:
- Record two process runs for 25 wafers (22 on chamber-c1, 3 on chamber-c4); `forWafer('w-001').runs.length === 1` (for a wafer that saw only c1); `forWafer('w-023').runs[0].chamberId === 'chamber-c4'`.
- `wafersInChamberWindow('chamber-c1', ...)` returns exactly 22 wafer ids.
- `wafersInChamberWindow('chamber-c4', ...)` returns exactly 3.
- Split/merge conservation: after split + 2 process runs on children + merge, every wafer's history has exactly the runs that touched it (22 wafers have run on c1 only; 3 have runs on c4).
`npm test` → green.

---

**`F17` — Genealogy conservation property test**

dependsOn: `F16`, `F07`, `F08`, `F09`, `F02`

files: `test/domain/genealogy/genealogy-conservation.test.ts`

interface: no new exports; test-only.

how to implement: generate a random sequence of splits + merges + reworks over 25 wafers using `SeededRng(42)`; record process runs at each operation; build genealogy index; assert every wafer has a continuous history from its creation; no wafer's history has a run on a lot it was never part of.

acceptance: all assertions pass across 3 random sequences. `npm test` → green.

---

**`F18` — SPC rule: Rule 1 (point beyond 3σ)**

dependsOn: `F04`

files: `src/domain/spc/rule1.ts`, `test/domain/spc/rule1.test.ts`

interface:
```ts
// src/domain/spc/rule1.ts
export function checkRule1(series: number[], limits: ControlLimits): boolean
  // returns true if the last point is beyond UCL or below LCL
```

how to implement: `return series.length > 0 && (series[series.length-1] > limits.ucl || series[series.length-1] < limits.lcl)`.

acceptance:
- `[99, 100, 105]` with `ucl=104.5` → true (last point = 105 > 104.5).
- `[99, 100, 101]` → false.
- Empty series → false.
`npm test` → green.

---

**`F19` — SPC rule: Rule 2 (2 of 3 beyond 2σ, same side)**

dependsOn: `F04`

files: `src/domain/spc/rule2.ts`, `test/domain/spc/rule2.test.ts`

interface:
```ts
export function checkRule2(series: number[], limits: ControlLimits): boolean
```

how to implement:
1. Need at least 3 points; check last 3.
2. Above 2σ means `value > limits.mean + 2 * limits.sigma`.
3. Below 2σ means `value < limits.mean - 2 * limits.sigma`.
4. Return true if at least 2 of the last 3 points are above 2σ, or at least 2 of the last 3 are below 2σ.

acceptance:
- `[100, 103.5, 104.0]` with sigma=1.5 → 2σ boundary = 103.0; last 3 = [103.5, 104.0] are both above 2σ (2 of last 3) → true.
- `[100, 100, 100]` → false.
- Fewer than 3 points → false.
`npm test` → green.

---

**`F20` — SPC rule: Rule 3 (4 of 5 beyond 1σ, same side)**

dependsOn: `F04`

files: `src/domain/spc/rule3.ts`, `test/domain/spc/rule3.test.ts`

interface:
```ts
export function checkRule3(series: number[], limits: ControlLimits): boolean
```

how to implement: check last 5 points; count how many are above `mean + sigma` (same side); return true if >= 4 on same side. Mirror for below.

acceptance:
- `[100, 101.6, 101.7, 101.8, 101.9]` sigma=1.5, mean=100 → 4 of last 5 above mean+1σ (101.5) → true.
- `[100, 100, 100, 100, 100]` → false.
- Fewer than 5 points → false.
`npm test` → green.

---

**`F21` — SPC rule: Rule 4 (8/9 on same side — shift) and Rule 5 (6 in a row trending)**

dependsOn: `F04`

files: `src/domain/spc/rule4-5.ts`, `test/domain/spc/rule4-5.test.ts`

interface:
```ts
export function checkRule4(series: number[], limits: ControlLimits): boolean
  // 8 or more consecutive points on the same side of the mean
export function checkRule5(series: number[], limits: ControlLimits): boolean
  // 6 consecutive points all increasing or all decreasing
```

how to implement:
- `checkRule4`: check last 8 points; all above `mean` or all below `mean` → true.
- `checkRule5`: check last 6 points; all strictly increasing or all strictly decreasing → true.

acceptance: `test/domain/spc/rule4-5.test.ts`:
- Rule 4: 9 values all 101 (above mean=100) → true; alternating above/below → false.
- Rule 5: `[100.0, 100.5, 101.0, 101.5, 102.0, 102.5]` → true (strictly increasing). `[100, 99, 101, 100, 99, 98]` → false (not monotone).
- Missing sample handling: a `NaN` in the series must not silently produce a false positive; rule functions must skip or treat a NaN as a gap and return false for windows containing it.
`npm test` → green.

---

**`F22` — SPC rule dispatcher**

dependsOn: `F18`, `F19`, `F20`, `F21`

files: `src/domain/spc/spc-engine.ts`, `test/domain/spc/spc-engine.test.ts`

interface:
```ts
export interface SpcRuleViolation {
  ruleId: 'rule-1' | 'rule-2' | 'rule-3' | 'rule-4' | 'rule-5'
  ruleName: string; seriesLength: number
}

export function evaluateSpcRules(
  series: number[],
  limits: ControlLimits,
  enabledRules?: Array<'rule-1' | 'rule-2' | 'rule-3' | 'rule-4' | 'rule-5'>
): SpcRuleViolation[]
```

how to implement: call each enabled rule check; collect violations. Default enables all 5 rules.

acceptance: `test/domain/spc/spc-engine.test.ts`:
- A chamber-drift series (gradual rise, rules 3 and 5 fire before rule 1) → violations include rule-3 and rule-5 but NOT rule-1.
- In-control flat series (all within ±1σ) → empty violations array.
- Rule 1 with a point beyond 3σ → only rule-1 violation.
- Series with a NaN gap → rule that spans the NaN returns false (no spurious violation).
`npm test` → green.

---

**`F23` — SPC series projection from event log**

dependsOn: `F04`, `F05`, `F22`

files: `src/domain/spc/spc-projection.ts`, `test/domain/spc/spc-projection.test.ts`

interface:
```ts
export function buildSpcSeries(
  log: MesEventLog,
  parameterId: string,
  chamberId: string,
  operationId: string
): number[]   // sorted by measuredAt; NaN inserted for skipped measurements
```

how to implement:
1. Fold over `metrology-recorded` events for the given `parameterId` + `operationId`.
2. For each result, cross-reference the process run (via `eventsForLot`) to get the chamberId.
3. Include results where `run.chamberId === chamberId`.
4. Sort by `measuredAt`; for `skipped: true` results, insert `NaN`.

acceptance: `test/domain/spc/spc-projection.test.ts`:
- 5 metrology results for chamber-c1 + 1 skipped → series has 5 numeric values + 1 NaN.
- Re-folding with same log → identical series.
`npm test` → green.

---

**`F24` — Conservative excursion scoping**

dependsOn: `F04`, `F05`, `F16`, `F22`, `F23`

files: `src/domain/excursion/scope.ts`, `test/domain/excursion/scope.test.ts`

interface:
```ts
export interface ExcursionScope {
  excursionId: string
  conservativeWaferIds: string[]   // superset: unknown ⇒ included
  confirmedImpactedIds: string[]   // proven impacted
  ambiguousIds: string[]           // missing metrology; stay in scope
  rootCandidates: Array<{ kind: 'chamber' | 'reticle' | 'q-time'; id?: string; confidence: number }>
}

export function scopeExcursion(
  excursion: Excursion,
  log: MesEventLog,
  genealogy: GenealogyIndex,
  clock: Clock
): ExcursionScope
```

how to implement:
1. If `excursion.chamberId` is set: `wafersInChamberWindow(chamberId, windowStart, windowEnd)` → confirmed candidates.
2. Add wafers with skipped metrology in the window → `ambiguousIds` (they cannot be proven outside scope).
3. `conservativeWaferIds = confirmedImpactedIds ∪ ambiguousIds`.
4. If `excursion.reticleId` is set: `wafersInReticleExposures(reticleId)` union into `conservativeWaferIds`.
5. Root candidates: rank chamber (if chamberId set) and reticle (if set) by coverage; Q-time violation if flagged.

acceptance: `test/domain/excursion/scope.test.ts`:
- Chamber drift on chamber-c1 in window [t0, t1]: 22 wafers in scope, 3 rework wafers on c4 NOT in scope.
- Missed metrology: one wafer had skipped measurement → stays in `ambiguousIds` and `conservativeWaferIds`.
- Reticle suspicion widening: add reticle to the excursion → all wafers that saw the reticle join conservativeWaferIds.
- Invariant: `conservativeWaferIds.length >= confirmedImpactedIds.length` always.
`npm test` → green.

---

**`F25` — Hold placement**

dependsOn: `F03`, `F04`, `F05`

files: `src/domain/excursion/hold.ts`, `test/domain/excursion/hold.test.ts`

interface:
```ts
export function placeHold(
  targetId: string,
  targetType: Hold['targetType'],
  reason: string,
  placedBy: string,
  clock: Clock
): { hold: Hold; event: MesEvent }

export function isHeld(targetId: string, log: MesEventLog): boolean
  // true if there is an active hold (hold-placed event with no disposition)
```

how to implement:
1. `placeHold`: build `Hold` object and `hold-placed` event; return both.
2. `isHeld`: scan log for `hold-placed` events for `targetId`; for each, check if there is a `disposition-recorded` event referencing `hold.id`; if none found, it is still held.

acceptance: `test/domain/excursion/hold.test.ts`:
- `placeHold` returns event; `isHeld` before appending the event → false; after appending → true.
- After appending a `disposition-recorded` event → `isHeld` returns false.
`npm test` → green.

---

**`F26` — Disposition recording (conservative narrowing)**

dependsOn: `F03`, `F04`, `F05`, `F25`

files: `src/domain/excursion/disposition.ts`, `test/domain/excursion/disposition.test.ts`

interface:
```ts
export function recordDisposition(
  holdId: string,
  decision: Disposition['decision'],
  authorizedBy: string,
  evidenceRefs: string[],
  clock: Clock
): { disposition: Disposition; event: MesEvent }
```

how to implement: build Disposition and `disposition-recorded` event; return both.

acceptance: `test/domain/excursion/disposition.test.ts`:
- `recordDisposition` returns event with correct holdId and decision.
- After appending the disposition event, `isHeld(targetId, log)` returns false.
- Monotonicity invariant: a wafer in the conservative scope stays held until a disposition event explicitly releases it. (Test: scope 3 wafers; place hold; release 2 via disposition; third wafer without disposition remains held.) `isHeld` for the third wafer → true.
`npm test` → green.

---

**`F27` — Containment monotonicity property test**

dependsOn: `F24`, `F25`, `F26`, `F02`

files: `test/domain/excursion/containment-monotonicity.test.ts`

interface: no new exports; test-only.

how to implement:
1. Build an excursion scope of 10 wafers.
2. Assert: the scope does not shrink unless a disposition event is present.
3. Add a new `metrology-recorded` event that *confirms* one more wafer in scope → scope can only grow or stay; never shrink from adding ambiguous evidence.
4. Release one wafer via disposition → scope shrinks by exactly 1.
5. Assert: there is no code path that narrows `conservativeWaferIds` without a corresponding `disposition-recorded` event.

acceptance: all assertions pass. `npm test` → green.

---

**`F28` — Dispatch priority engine**

dependsOn: `F03`, `F04`, `F05`, `F11`, `F12`, `F25`

files: `src/domain/dispatch/prioritizer.ts`, `test/domain/dispatch/prioritizer.test.ts`

interface:
```ts
export interface DispatchCandidate {
  lotId: string; operationId: string; recipeId: string; chamberId: string
  dueAt: number   // virtual clock target completion time
  qTimeUrgent: boolean   // close to Q-time limit
  isBottleneckEquipment: boolean
  isHeld: boolean
  recipeQualified: boolean
  needsSamplingThisLot: boolean
}

export interface DispatchResult {
  rankedLots: Array<{ lotId: string; rank: number; score: number; explanation: string[] }>
  refused: Array<{ lotId: string; reason: string }>
}

export function dispatch(
  candidates: DispatchCandidate[],
  clock: Clock
): DispatchResult
```

how to implement:
1. Refuse held lots (`isHeld: true`) and unqualified-recipe lots (`recipeQualified: false`).
2. For non-refused candidates, compute score:
   - Q-time urgent: +40 (act now or scrap).
   - Due date urgency: `+max(0, 30 - (dueAt - clock.now()) / 3600000)` (extra points for closer due date).
   - Bottleneck equipment: +20.
   - Sampling needed: +10.
3. Sort by score descending; assign rank.
4. Build explanation from the score components.

acceptance: `test/domain/dispatch/prioritizer.test.ts`:
- Held lot → refused with reason "lot on hold".
- Unqualified recipe → refused with reason "qual-expired" or "not-qualified".
- Q-time urgent lot ranks above non-urgent lot with same health.
- Bottleneck + due-date-close → highest score.
- Same inputs → identical ranking (determinism assertion: call twice, compare).
`npm test` → green.

---

**`F29` — Dispatch bottleneck + unqualified-recipe block test (E5 items 6 + 8)**

dependsOn: `F28`

files: `test/domain/dispatch/dispatch-edge-cases.test.ts`

interface: no new exports; test-only.

how to implement:
1. Scenario A (unqualified-recipe block): attempt dispatch of a lot to CHAMBER_C1 with recipe-etch-v1 (not qualified on c1) → `refused` list contains the lot with reason "not-qualified".
2. Scenario B (bottleneck tie): two lots contend for the same bottleneck tool; one has `qTimeUrgent: true`, the other does not → Q-time-urgent lot ranks 1.
3. Determinism: call `dispatch` twice with same inputs; assert `JSON.stringify(result1) === JSON.stringify(result2)`.

acceptance: all assertions pass. `npm test` → green.

---

**`F30` — Cpk capability computation**

dependsOn: `F04`

files: `src/domain/spc/cpk.ts`, `test/domain/spc/cpk.test.ts`

interface:
```ts
export function computeCpk(
  series: number[],
  limits: ControlLimits
): { cpk: number; cpu: number; cpl: number } | null   // null if fewer than 2 non-NaN points
```

how to implement:
1. Filter out NaN values; if < 2 remaining → return null.
2. Compute sample mean and sample std dev.
3. `cpu = (limits.ucl - mean) / (3 * stdDev)`.
4. `cpl = (mean - limits.lcl) / (3 * stdDev)`.
5. `cpk = Math.min(cpu, cpl)`.

acceptance: `test/domain/spc/cpk.test.ts`:
- 5-point series [99.5, 100.0, 100.5, 99.8, 100.2] with limits from SPC_LIMITS_CVD_THICKNESS: hand-compute cpk, assert within 0.001.
- Series with NaN entries → NaN excluded from computation.
- Fewer than 2 non-NaN → null.
`npm test` → green.

---

**`F31` — MES Cpk target gate**

dependsOn: `F30`

files: `src/domain/spc/cpk-gate.ts`, `test/domain/spc/cpk-gate.test.ts`

interface:
```ts
export function checkCpkTarget(
  cpk: number,
  isCriticalParameter: boolean
): { passes: boolean; target: number; gap: number }
```

how to implement: `target = isCriticalParameter ? 1.67 : 1.33`; `passes = cpk >= target`; `gap = cpk - target`.

acceptance:
- `cpk=1.5, standard` → passes: true (1.5 >= 1.33).
- `cpk=1.5, critical` → passes: false (1.5 < 1.67).
- `cpk=1.33, standard` → passes: true (boundary included).
`npm test` → green.

---

**`F32` — Genealogy queries: bin-cluster→chamber/reticle correlation**

dependsOn: `F16`, `F03`

files: `src/domain/genealogy/bin-correlation.ts`, `test/domain/genealogy/bin-correlation.test.ts`

interface:
```ts
export interface BinCorrelationResult {
  parameterId: string   // e.g. 'bin-7'
  candidateRoots: Array<{
    kind: 'chamber' | 'reticle'; id: string
    affectedWaferCount: number; totalWafersWithBin: number
    coverageFraction: number
  }>
}

export function correlateBinToRoots(
  binResults: BinMap[],
  binName: string,
  minCount: number,   // minimum die count to be "affected"
  genealogy: GenealogyIndex
): BinCorrelationResult
```

how to implement:
1. Find wafers where `binResults[binName] >= minCount`.
2. For each such wafer, use `genealogy.forWafer(waferId)` to get its runs.
3. Count how many "affected" wafers touched each chamber or reticle.
4. Sort candidates by `coverageFraction` descending.

acceptance: `test/domain/genealogy/bin-correlation.test.ts`:
- 5 wafers with high bin-7 count, all passed through chamber-c1; 20 wafers with low bin-7 count, some on c1; correlation → chamber-c1 ranks first with `coverageFraction = 5/5 = 1.0`.
- Zero affected wafers → empty `candidateRoots`.
`npm test` → green.

---

**`F33` — Seed fab-week fixture events**

dependsOn: `F04`, `F05`, `F06`, `F07`, `F08`, `F09`, `F13`, `F14`, `F15`

files: `src/fixtures/seed-fab-week-events.ts`

interface: a function `buildSeedFabWeekEvents(clock: ManualClock): MesEvent[]` that produces the full scripted event sequence:

1. Equipment state: EQUIP_CVD starts in PRD at CLOCK_EPOCH.
2. Process run: LOT_A (all 25 wafers) on OP_PRECLEAN / CHAMBER_C2 at t=0→t+1h.
3. Metrology: all 25 wafers measured for a dummy parameter.
4. Process run: LOT_A on OP_DEPOSITION / CHAMBER_C1 at t+1h→t+5h (within 4h Q-time from preclean).
5. Metrology (chamber drift): 10 metrology results for CVD thickness gradually rising (values 100.0, 100.3, 100.6, ..., 103.0) — this will trigger Nelson rule 5 (6-in-a-row trend).
6. Split: LOT_A splits into LOT_MAIN (22 wafers) and LOT_REWORK (3 wafers).
7. Process run: LOT_REWORK on OP_ETCH / CHAMBER_C4 at t+5h→t+6h.
8. Process run: LOT_MAIN on OP_ETCH / CHAMBER_C3 at t+5h→t+6h.
9. Merge: LOT_MAIN + LOT_REWORK → LOT_MERGED (all 25 wafers).
10. Equipment state: EQUIP_CVD transitions PRD→UDT at t+6h (simulating a failure).
11. Missed metrology: LOT_MERGED has a skipped metrology result (`skipped: true`) for one wafer.
12. Reticle suspicion: RETICLE_R1.suspectedContaminated is noted in an excursion event.
13. Hold: place a hold on LOT_MERGED due to reticle suspicion.

Return all events sorted by `occurredAt`.

acceptance: compile check; `buildSeedFabWeekEvents` returns an array of events; first event is `equipment-state-changed`; last event is `hold-placed`. `npm test` → green.

---

**`F34` — Seed fab-week integration test (full invariant battery)**

dependsOn: `F01`–`F33`

files: `test/integration/seed-fab-week.test.ts`

how to implement: this is the flagship integration test. Do the following assertions in order:

1. **Wafer conservation:** build log from seed events; build genealogy; assert `WAFER_IDS.every(id => genealogy.forWafer(id).runs.length >= 1)` (every wafer has at least one run recorded).
2. **Split-lot divergence (E5 item 1):** `wafersInChamberWindow('chamber-c4', t0, t1)` returns exactly 3 wafer ids; `wafersInChamberWindow('chamber-c3', t0, t1)` returns exactly 22.
3. **Pre-confirmation drift (E5 item 2):** build SPC series for chamber-c1 from the metrology events; run `evaluateSpcRules`; assert `violations.some(v => v.ruleId === 'rule-5')` (trend fires). Run the in-control series (flat values); assert zero violations.
4. **Missed-metrology conservative hold (E5 item 3):** build excursion scope; the wafer with skipped metrology is in `ambiguousIds` and in `conservativeWaferIds`; `isHeld(ambiguousWaferId, log)` → true after hold placement.
5. **Reticle-suspicion widening (E5 item 5):** add a reticle-based excursion to the scope; assert `conservativeWaferIds.length >= wafersInChamberWindow` count (scope grew or stayed, never shrunk).
6. **Unqualified-recipe block (E5 item 6):** attempt dispatch of a lot to a chamber with expired qual; assert the lot is in `refused`.
7. **E10 exhaustiveness (E5 item 7):** call `computeE10Accounting` for EQUIP_CVD over the observation window; assert `totalMs === observationEnd - observationStart`; assert `stateDurations.PRD + stateDurations.UDT + ... === totalMs`.
8. **Dispatch determinism (E5 item 8):** call `dispatch` twice with same candidates; assert `JSON.stringify(r1) === JSON.stringify(r2)`.
9. **Immutability invariant:** scan all `process-run-completed` events in the log; assert none have been modified (re-fold the log and compare ids — if any run differs, something mutated it).
10. **Totality-of-reconstruction (redaction test):** build an `AuditReport` object containing: the answer to "which wafers did chamber-c1 touch in [t0,t1]?" and "why is LOT_MERGED held?" from structured data only (genealogy + hold/disposition events + SPC violations). Assert both answers are non-empty strings derivable from structured fields alone.

acceptance: all 10 assertions pass. `npm test` → all suites green.

---

### 3. The decomposition method for the remaining breadth

After the first 34 cards are green, expand to run-to-run control, richer yield analytics, operator UI, and MRB workflows using this recipe:

**Recipe for any new card cluster:**

1. **Identify the invariant** — what must this feature never violate? (wafer conservation, immutability, conservative containment, dispatch determinism).
2. **Check if it needs the genealogy** — almost every feature in this project does; start with `buildGenealogyIndex(log)` before building feature logic.
3. **Write the pure function first** — SPC rules, Cpk, containment scoping are all pure; define the signature before the implementation.
4. **Write the negative/adversarial test first** — what should the feature refuse/flag/hold rather than silently pass?
5. **Append events; never mutate** — all corrections are new events in the log.

**Worked example A — Richer excursion: commonality analysis:**

> After scoping impacted wafers, rank candidate root causes by how many confirmed-bad wafers share a factor.

- `X01` — `computeCommonality(impactedWaferIds, genealogy): CommonalityResult[]`. For each factor (chamber, reticle, Q-time breach), count coverage. dependsOn: `F16`, `F24`.
- `X02` — Test: 5 impacted wafers all share chamber-c1; 20 non-impacted wafers include 15 on c1 → chamber-c1 ranks first with high coverage. dependsOn: `X01`.
- `X03` — Widening test: add a reticle suspicion; assert `conservativeWaferIds` grows or stays, never shrinks. dependsOn: `X01`, `F26`.

**Worked example B — Lot-level dispatch with Q-time urgency cascade:**

> A lot approaching its Q-time limit must be dispatched before any non-urgent lot, regardless of due date.

- `Q01` — Extend `DispatchCandidate` with `qTimeRemainingMs?: number`. dependsOn: `F28`.
- `Q02` — Extend score in `dispatch`: if `qTimeRemainingMs < 30 * 60 * 1000` (30 min), score += 100 (preempts all). Test: lot with 20 min Q-time remaining outranks all others. dependsOn: `Q01`.
- `Q03` — Integration: seed a lot with a 4h Q-time; advance clock to t+3.5h; dispatch → lot is Q-time-urgent and ranks 1. dependsOn: `Q02`, `F11`.

**Worked example C — BinMap genealogy linkage for yield attribution:**

> Given a cluster of bin-7 failures, attribute them to chambers/reticles via genealogy.

- `B01` — Generate BinMap fixtures for 10 wafers (5 with high bin-7, 5 with low). dependsOn: `F03`, `F06`.
- `B02` — `correlateBinToRoots` (already in `F32`); wire it to use the genealogy index from the seed fab week. Assert chamber-c1 correlation fraction >= 0.8. dependsOn: `F32`, `B01`.
- `B03` — Integration: after chamber drift SPC fires AND bin-7 correlation shows chamber-c1 → generate excursion with both evidence types; assert both appear in `rootCandidates`. dependsOn: `B02`, `F24`.

---

### 4. Per-task implementation conventions

**File/folder layout:**
```
src/
  lib/             # clock.ts, prng.ts
  domain/
    route/         # lot-split.ts, lot-merge.ts, lot-rework.ts, q-time.ts, recipe-qual.ts, process-run.ts
    equipment/     # e10-state.ts, e10-transition.ts
    genealogy/     # genealogy.ts, bin-correlation.ts
    spc/           # rule1.ts, rule2.ts, rule3.ts, rule4-5.ts, spc-engine.ts, spc-projection.ts, cpk.ts, cpk-gate.ts
    excursion/     # scope.ts, hold.ts, disposition.ts
    dispatch/      # prioritizer.ts
  event-log.ts     # MesEventLog
  types.ts         # entity types
  event-types.ts   # event union types
  fixtures/        # fab-week.ts, seed-fab-week-events.ts
  adapters/
    fixture/
test/
  lib/
  domain/
    route/ equipment/ genealogy/ spc/ excursion/ dispatch/
  integration/
```

**Naming:** source files `kebab-case.ts`; test files `<source-name>.test.ts`; functions `camelCase`; types `PascalCase`; fixture constants `SCREAMING_SNAKE_CASE`.

**How to write a test (minimal template):**
```ts
// test/domain/route/lot-split.test.ts
import { describe, it, expect } from 'vitest'
import { splitLot } from '../../../src/domain/route/lot-split.js'
import { LOT_A, WAFER_IDS, CLOCK_EPOCH } from '../../../src/fixtures/fab-week.js'
import { ManualClock } from '../../../src/lib/clock.js'

describe('splitLot', () => {
  it('produces conservation-safe children', () => {
    const clock = new ManualClock(CLOCK_EPOCH)
    const assignments = Object.fromEntries([
      ...WAFER_IDS.slice(0, 22).map(id => [id, 'lot-main']),
      ...WAFER_IDS.slice(22).map(id => [id, 'lot-rework'])
    ])
    const { childLots } = splitLot(LOT_A, assignments, ['lot-main', 'lot-rework'], clock)
    const childWafers = new Set([...childLots[0].waferIds, ...childLots[1].waferIds])
    expect(childWafers.size).toBe(25)
    expect([...childWafers].sort()).toEqual([...WAFER_IDS].sort())
  })
})
```

**Definition of done for any card:**
1. `tsc --noEmit` passes (no `any`).
2. `npm test` → green.
3. No `Date.now()`, `Math.random()`, or network calls in source.
4. ProcessRun records never mutated (no `run.field = value` after creation).
5. Wafer conservation property tested on any split/merge/rework card.

---

### 5. Common pitfalls for a weak model on this project

**Pitfall 1 — Collapsing wafer identity into lots.**
A 3B will use `lotId` everywhere wafer-level granularity is needed, answering "which lot touched chamber-c1?" instead of "which wafers?" The genealogy index in `F16` operates per wafer-id, not per lot. The split-lot divergence test in `F34` directly catches this: it asserts that exactly 22 wafers (not lot-main as a whole) touched c3, and exactly 3 (not lot-rework as a whole) touched c4. Mitigation: `ProcessRun.waferIds` is a `string[]` — the wafer subset that ran, not the full lot.

**Pitfall 2 — Mutating a ProcessRun record.**
A 3B will do `processRun.status = 'corrected'` or `processRun.endAt = newTime` to fix a mistake. The immutability test in `F34` re-folds the log and compares run ids; any mutation is caught. Mitigation: `ProcessRun` has no mutable status field; it is a plain record. Corrections are new `disposition-recorded` events.

**Pitfall 3 — Optimistic containment (excluding wafers with missing metrology).**
A 3B will see that a wafer's metrology was skipped and assume it is fine (not in scope). The missed-metrology conservative-hold test in `F34` directly asserts: skipped-metrology wafer stays in `ambiguousIds` and in `conservativeWaferIds`. Mitigation: `scopeExcursion` explicitly treats `skipped: true` metrology as ambiguous — unknown ⇒ included.

**Pitfall 4 — SPC rules firing on NaN gaps as if they were zero.**
A 3B will coerce a missing sample (NaN) to 0 before running SPC rules, producing false violations (a "zero" is always below the LCL in a high-value process). The NaN-handling test in `F21` checks rule functions return false for windows containing NaN. Mitigation: SPC rule functions use `Number.isNaN(value)` checks and return false if any point in the required window is NaN.

**Pitfall 5 — Single-threshold SPC (only rule 1).**
A 3B will implement only a limit-breach check (rule 1) and miss the gradual-drift rules (3 and 5). The pre-confirmation drift test (`F34` assertion 3) specifically asserts that rules 3 and 5 fire on the gradually rising chamber drift series *before* rule 1 would fire. Mitigation: the SPC engine dispatcher (`F22`) enables all 5 rules by default; the seed metrology series is designed so that no point exceeds 3σ but a 6-in-a-row trend is visible.

**Pitfall 6 — Dispatch with non-deterministic tie-breaking.**
A 3B will break dispatch ties with something that varies between calls (e.g. insertion order, object key enumeration order). The dispatch determinism test in `F34` calls `dispatch` twice with the same inputs and asserts `JSON.stringify(r1) === JSON.stringify(r2)`. Mitigation: the `dispatch` function sorts by score descending and breaks ties by `lotId` string (lexicographic, stable); the `SeededRng` is only used when an explicit randomized tie-break is needed.

**Pitfall 7 — Genealogy that only tracks lot-level edges.**
A 3B will store edges as `(lotId, chamberId)` pairs and answer "which lots touched chamber-c1?" The bin-correlation and excursion-scoping functions require wafer-level answers. The `forWafer(waferId)` function returns per-wafer runs, not lot runs. Mitigation: the genealogy index is built from `process-run-completed` events where `run.waferIds` is explicitly the per-run wafer subset.

**Pitfall 8 — Equipment state overlap (double-counting time in two states).**
A 3B will record a PRD→UDT transition but forget to close the PRD interval, leading to both states being counted over the same time window. The E10 exhaustiveness test in `F34` (assertion 7) asserts `stateDurations.PRD + ... === totalMs`. Any overlap produces a sum greater than totalMs. Mitigation: `computeE10Accounting` in `F14` iterates consecutive state records; each state's duration is `nextRecord.enteredAt - thisRecord.enteredAt` — the intervals are naturally mutually exclusive by construction.
