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
