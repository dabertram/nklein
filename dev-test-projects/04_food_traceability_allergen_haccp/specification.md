# 04 - Food Traceability, Allergen, and HACCP Platform

Complexity tier: 4/20
Expected decomposition size: 18-22 dependent implementation cards before coding.
Domain pressure: food manufacturing, HACCP, allergen controls, lot genealogy, recalls, supplier quality, labeling.
Acceptance command: npm test

## How to use this challenge
This is a dev-test project specification for evaluating whether an autonomous coding agent can decompose a real domain, identify knowledge gaps, build a correct foundation, and verify it with deterministic tests. The goal is not to finish the entire product. The goal is to build a durable foundation that proves the agent understood the domain boundaries and can implement the highest-risk core behaviors without hiding behind placeholders.

The agent must read this entire specification before planning. It must create a dependency-linked plan, record domain knowledge debt, and choose a narrow release slice that still exercises the real hard parts. Prefer fewer production-quality vertical slices over many shallow labels.

## Product vision
Build a food safety platform for small manufacturers that can trace ingredients from supplier lots through batches, packaging, labels, shipments, and recalls. It must support HACCP-style control points and allergen risk, with enough rigor to expose weak agent reasoning.

## Foundation release scope
The first serious buildout must include:
- Supplier, ingredient, lot, batch, recipe, production run, equipment, sanitation event, label, finished good, shipment, and customer models.
- Lot genealogy graph that supports forward trace, backward trace, partial consumption, rework, and co-mingled batches.
- Allergen matrix that detects undeclared allergen risk across recipes, shared equipment, rework, and label selection.
- Critical control point workflow with monitoring readings, limits, corrective actions, verification, and release holds.
- Recall simulator that identifies affected finished goods, customers, inventory, and open shipments from a contaminated supplier lot.
- Label validation against recipe allergens, claims, net quantity, and versioned approval state.
- Sanitation scheduling and line-clearance checks before allergen changeovers.
- Seed incident involving a supplier lot contaminant, rework, mislabeled packaging, and mixed shipment state.

## Architecture requirements
- Represent lot genealogy as an explicit graph with quantities and transformation edges.
- Keep HACCP checks as versioned rule definitions with evidence and release decisions.
- Separate physical production events from quality disposition state.
- Make recall reports reproducible from immutable events.

## Domain knowledge debt to surface
The agent should not pretend to know every regulation, standard, or numerical model perfectly. It should implement a defensible deterministic subset, mark assumptions explicitly, and create extension points where real-world integrations or expert-reviewed rule packs would live. Required knowledge areas:
- Traceability is quantity-aware; a lot can be partially consumed across multiple production runs.
- Allergen safety involves recipe content, cross-contact, sanitation, rework, and labeling.
- A hold/release decision requires evidence, authority, and auditability.
- Recall scope must be conservative when genealogy is incomplete.

## Decomposition pressure
This project should force decomposition across domain modeling, calculation or policy engines, workflow state, deterministic fixtures, auditability, and UI/view-model boundaries. The plan should include dependency links so shared primitives and invariants are built before dependent workflow features. Avoid starting with screens. Start with the domain model, invariants, and tests that would make later screens trustworthy.

The agent should maintain a visible knowledge-debt list covering unclear standards, units, legal or safety constraints, numerical assumptions, terminology, fixture limitations, and future expert-review checkpoints. Knowledge debt is not a failure; hiding it is.

## Acceptance criteria
- Forward and backward traces produce correct affected lots for co-mingled and rework cases.
- Allergen checks catch recipe, equipment, rework, and label mismatch risks.
- CCP readings outside critical limits create holds and corrective-action requirements.
- Recall summaries are stable golden outputs from fixture events.
- The project passes npm test with no database server.

## Explicit non-goals
- Do not reduce traceability to search by lot string.
- Do not make allergen safety a static checkbox on a product.
- Do not skip quantity conservation tests.

## Quality bar
- Use typed domain objects and pure core modules wherever practical.
- Keep deterministic fixtures in the repository and do not depend on live APIs for acceptance tests.
- Test edge cases before building broad UI coverage.
- Every risk score, recommendation, workflow transition, or generated report must be explainable from source facts.
- Stubs are acceptable only at external integration boundaries and must be named as adapters with deterministic fixture implementations.
- The foundation should be extensible into a real product if later teams add integrations, expert-reviewed rule packs, and production UI.

---

# Extended scope & deep-reasoning extensions (v2)

> Added 2026-06-26 via deep domain research. **The single defining property of this project: it is a *quantity-conserving genealogy graph that must answer "where did this go / where did this come from" conservatively and completely, from immutable events, when an allergen or a contaminant is involved and people can get hurt.*** The hard part is not "search by lot string" (the base spec explicitly forbids that mental model); it is that mass must be conserved across split/merge/rework/commingle transformations, allergen risk must propagate through *physical* paths (shared equipment, sequence, rework) not just recipe text, and a recall trace must **over-include rather than under-include** when genealogy is incomplete — all reproducible as golden output from an append-only event log.

## E0. Thesis: why food traceability is a determinism + conservation + safety-conservatism problem

A demo build models a "product → ingredient" lookup and a boolean `containsAllergen` flag on each product. It passes a happy-path test and is **dangerous in every realistic scenario**: it cannot tell you *how much* of supplier lot X went into which finished goods (so the recall is either wildly over-broad or misses cases), it treats allergens as static recipe facts (missing cross-contact from shared lines, rework, and changeover failures — the dominant real-world allergen recall cause), and it has no audit trail for a hold/release decision that a regulator can subpoena. The disciplined build is three coupled systems: a **quantity-aware genealogy graph** (a DAG of lots and transformation edges with conserved mass), an **allergen propagation engine** over both recipe content *and* physical equipment/sequence/rework paths, and an **event-sourced quality/HACCP ledger** where every hold/release is an authorized, evidenced, replayable event. The grading rubric:

1. **Quantity conservation** — across every transformation, `Σ(inputs consumed) == Σ(outputs produced) + yield_loss`, and a backward/forward trace returns *quantitatively correct* affected lots through split, merge, partial-consumption, rework, and commingling.
2. **Conservative recall scope** — when genealogy is incomplete or ambiguous, the recall set **expands** (includes the uncertain) rather than silently dropping; incompleteness is surfaced, never hidden.
3. **Allergen propagation through physical reality** — undeclared-allergen risk is detected through recipe, shared equipment, sequence-since-changeover, rework, *and* label selection — not a static checkbox.
4. **Determinism & audit totality** — recall summaries and trace results are byte-identical golden outputs from the immutable event log; every quality disposition has an authorized, evidenced audit event.

Everything below serves those four.

## E1. Research-grounded domain authenticity (the standards & the regs)

**FSMA 204 — the FDA Food Traceability Rule** is the regulatory spine and gives the build its real event model. It defines **Critical Tracking Events (CTEs)** and the **Key Data Elements (KDEs)** each requires, anchored by a **Traceability Lot Code (TLC)** ([FDA Food Traceability Final Rule](https://www.fda.gov/food/food-safety-modernization-act-fsma/fsma-final-rule-requirements-additional-traceability-records-certain-foods); [FDA Traceability Lot Code page](https://www.fda.gov/food/food-safety-modernization-act-fsma/traceability-lot-code); [Trustwell FSMA 204 guide](https://www.trustwell.com/resources/fsma-204-the-food-traceability-final-rule/)):
- **The seven CTEs:** harvesting, cooling, initial packing, first land-based receiving (seafood), shipping, receiving, and **transformation** (manufacturing/processing, or commingling/repacking/relabeling that yields a Food-Traceability-List food).
- **TLC lifecycle (a real state machine):** a **new TLC is assigned** at *initial packing*, *first land-based receiving*, and **transformation** (a transformed output gets a *new* TLC); a TLC is **preserved** through *shipping* and *receiving* (no new code). The **Traceability Lot Code Source** (and Source Reference) records *who* assigned it and where — so a trace can hop firm-to-firm. Industry practice composes a TLC from **GTIN + lot code**.
- **KDEs** vary by CTE but include location (name/description), date/time, **quantity + unit of measure**, reference-document type/number, and the TLC. Quantity + UOM being mandatory is *why* the genealogy must be quantity-aware.
- **The 24-hour electronic sortable spreadsheet:** on an outbreak/recall request, records must be producible to FDA **within 24 hours in an electronic sortable spreadsheet** — a concrete, testable output format the system must be able to emit deterministically. Records retained 24 months. (Compliance date Jan 20 2026 with an FDA-announced intent to extend to 2028 — a knowledge-debt/date item to track.)

**GS1 EPCIS 2.0 + CBV — the interoperable event grammar.** The genealogy events map cleanly onto EPCIS, which is the right model to build toward (and a natural extension point), capturing the **what / where / when / why** of every supply-chain step ([GS1 EPCIS standard](https://www.gs1.org/standards/epcis); [OpenEPCIS event model](https://openepcis.io/docs/epcis/); [GS1 EPCIS/CBV implementation guideline](https://ref.gs1.org/guidelines/epcis-cbv/)):
- **what** = `epcList` (instance, SGTIN) / `quantityList` (class-level, **LGTIN with lot/batch + quantity + UOM**) — small manufacturers live in the *lot-level* (LGTIN) world, which is exactly the quantity-aware case.
- **where** = `readPoint` (where it happened) + `bizLocation` (where it rests after).
- **when** = `eventTime` + `eventTimeZoneOffset` + `recordTime`.
- **why** = `bizStep` + `disposition` (the CBV-vocabulary object state *after* the event — e.g. `in_progress`, `recalled`, `destroyed`).
- **Event types that ARE the genealogy:** **TransformationEvent** (`inputEPCList/inputQuantityList` consumed → `outputEPCList/outputQuantityList` produced; **irreversible**; a `TransformationID` links *partial* transformation events so split-across-time batches share lineage) — this is the production-run/recipe node. **AggregationEvent** (`parentID` + `childEPCs`, `action` ADD/DELETE/OBSERVE) — palletizing/casing, reversible. **ObjectEvent** — receiving/shipping/observing. **ILMD** (instance/lot master data: production date, expiry, lot) attaches at ObjectEvent/TransformationEvent. The build's internal genealogy graph should be **EPCIS-shaped** so an EPCIS import/export adapter is a later addition, not a rewrite.

**HACCP — the seven Codex/FDA principles** are the CCP-workflow spine and must be modeled as the actual principles, not a generic "checklist" ([FDA HACCP Principles & Application Guidelines](https://www.fda.gov/food/hazard-analysis-critical-control-point-haccp/haccp-principles-application-guidelines); [FAO/Codex HACCP, y1579e](https://www.fao.org/4/y1579e/y1579e03.htm)): **(1)** hazard analysis → **(2)** determine CCPs → **(3)** establish **critical limits** (the measurable boundary separating acceptable from unacceptable) → **(4)** monitoring procedures → **(5)** corrective actions (triggered the moment monitoring shows a deviation) → **(6)** verification (auditing the plan, reviewing deviations + product dispositions, validation) → **(7)** record-keeping. A **CCP reading outside its critical limit must auto-create a hold + a corrective-action requirement** — the base spec's core CCP behavior is principle 3→5 made executable. Critical limits are **versioned rule definitions** (the base spec demands this): the limit that applied at the time of a reading is the one that governs its verdict, immutably.

**Allergens — the real control model, not a flag.** US recognizes **nine major allergens** (Big 9 = milk, egg, fish, crustacean shellfish, tree nuts, peanuts, wheat, soy, **sesame** — added by the **FASTER Act**, mandatory Jan 1 2023), declared per **FALCPA** in the ingredient list or a "Contains" statement ([FDA FALCPA](https://www.fda.gov/food/food-allergensgluten-free-guidance-documents-regulatory-information/food-allergen-labeling-and-consumer-protection-act-2004-falcpa); [Eurofins Big 8→Big 9](https://www.eurofinsus.com/food-testing/resources/food-allergens-the-big-8-is-now-the-big-9/)). The danger is **cross-contact**, not just recipe content: shared equipment/lines, **production sequence since the last validated changeover**, and **rework** carry allergens into products whose recipe doesn't list them — undeclared-allergen cross-contact is a leading recall cause. **Sanitation/line-clearance validation** between allergen changeovers is the control, and it must be *validated/verified*, not assumed ([Allergen Control Program guide](https://www.alleratech.com/blog/allergen-control-program); [Certified Labs, avoiding cross-contact](https://certified-laboratories.com/blog/food-allergen-testing-avoiding-allergen-cross-contact/)). **Precautionary Allergen Labeling ("may contain") is voluntary, must be risk-assessment-based, and can NEVER substitute for a required FALCPA declaration or for cGMP controls** — a subtle rule the label-validation engine must encode (PAL is not a get-out-of-jail flag).

**Recall vs. withdrawal vs. stock recovery, and the hazard classes.** These are legally distinct and the system must not conflate them ([FDA Recalls Background & Definitions](https://www.fda.gov/safety/industry-guidance-recalls/recalls-background-and-definitions); [FDA Regulatory Procedures Manual ch.7](https://www.fda.gov/media/71814/download); [NC State food-recall plan](https://content.ces.ncsu.edu/food-recalls)): **Class I** (reasonable probability of serious adverse health consequences or death), **Class II** (temporary/medically-reversible), **Class III** (unlikely to cause adverse consequences); a **market withdrawal** is a minor violation not subject to FDA legal action; a **stock recovery** is product still under the firm's control that never entered commerce. **Effectiveness checks** (and their depth) scale with class. A **mock recall / traceability exercise** with a **reconciliation %** (units accounted-for vs. produced) is the standard readiness drill — a perfect deterministic test target.

**Hold/release & supplier verification (FSMA 117 preventive controls).** A disposition decision needs **evidence, authority, and auditability** (base spec). Lot acceptance is gated on **supplier status + Certificate of Analysis (COA) + required verifications**; a failure **auto-quarantines** the lot and opens corrective action ([FDA Preventive Controls for Human Food](https://www.fda.gov/food/food-safety-modernization-act-fsma/fsma-final-rule-preventive-controls-human-food); [PSU FSMA/HARPC](https://extension.psu.edu/understanding-fsma-haccp-harpc-and-the-preventive-controls-for-human-food-rule)). **Physical production events and quality disposition state are separate** (base spec): a batch physically exists the moment it's made; whether it's *releasable* is an independent, evidenced quality state that can change (hold → released, or released → recalled).

## E2. The hardest technical seams (named)

1. **The quantity-aware genealogy graph (the load-bearing data structure).** A directed acyclic graph whose nodes are **lots** (supplier lots, intermediate/WIP lots, finished-good lots) and whose edges are **transformation/consumption edges carrying a quantity + UOM**. A production run is a TransformationEvent: inputs (each a partial draw from a supplier/WIP lot, with quantity) → outputs (new TLC lots, with quantity) and a **yield/loss** term so mass closes. Splitting one lot across many runs, merging many lots into one (commingling), and rework (an output fed back as an input) must all be representable — and **traversable both directions with quantities**. This is the seam every weak build collapses into "product has ingredients."

2. **Conservative trace under incomplete genealogy.** Backward trace ("which supplier lots are in finished good F?") and forward trace ("which finished goods / customers / open shipments contain supplier lot X?") must be **monotone-conservative**: a missing or ambiguous edge means the trace **includes** the potentially-affected node and **flags the gap**, never silently prunes. The base spec's "recall scope must be conservative when genealogy is incomplete" is a hard, testable property — the recall set is a *superset* of ground truth, with explicit uncertainty, not a best-guess subset.

3. **Allergen propagation over the union of recipe + physical paths.** The allergen engine computes, per finished-good lot, the set of *present* allergens from: (a) **recipe content** (declared ingredients' allergens), (b) **shared-equipment cross-contact** (what ran on this line/equipment before, and whether a *validated* line-clearance separated them), (c) **rework** (allergens carried by reworked inputs), and (d) **label selection** (which versioned label was applied). The output is checked against the **declared** allergens on the chosen label; any **present-but-undeclared** allergen is an undeclared-allergen risk → hold + label-mismatch finding. PAL handling: a "may contain" statement is allowed only with a risk basis and never satisfies a *required* declaration.

4. **Event-sourcing with separated physical vs. quality state.** Physical events (received, produced, packed, shipped) and quality dispositions (hold, release, reject, recall) are **distinct event streams over the same lots**. The current releasability of a lot is a fold over its quality events; the current physical location/quantity is a fold over its physical events. Recall reports are reproducible because they're a pure projection of the immutable log at a point in time. (Base spec: "make recall reports reproducible from immutable events," "separate physical production events from quality disposition state.")

5. **Versioned HACCP rule definitions + critical-limit verdicts.** Critical limits, CCP definitions, and label specs are **versioned and immutable once used**; a monitoring reading is judged against the limit version in force at its event time. A label approval is a versioned state machine (draft → approved → superseded); shipping a finished good under a non-approved or stale label version is a finding.

6. **The recall/trace engine as a deterministic graph algorithm.** Forward/backward closure over the genealogy DAG, intersected with shipment/customer/inventory state, producing the affected-set + a reconciliation (produced vs. accounted-for) + the **electronic-sortable-spreadsheet** export — all golden-testable from fixtures.

## E3. Determinism & testability strategy

- **Event-sourced core, no DB server** (base spec: "passes npm test with no database server"). The authoritative state is an append-only, in-memory/file event log; all genealogy, allergen, HACCP, and recall state are **pure folds/projections** over it.
- **Virtual clock + deterministic IDs.** No `Date.now()`/random TLCs in core: event times come from fixtures; TLC/lot IDs are generated from a seeded, deterministic scheme so golden outputs are byte-stable.
- **Fixture adapters at every boundary,** named as adapters: `SupplierFeedAdapter` (incoming lots + COAs), `EpcisAdapter` (import/export EPCIS events), `LabelRegistryAdapter` (versioned label specs), `RulePackAdapter` (versioned HACCP critical limits + allergen equipment-matrix), `ShipmentAdapter` (customers/open shipments). Acceptance never hits a network.
- **Golden recall + trace outputs.** The seed incident (supplier-lot contaminant → rework → mislabeled packaging → mixed shipment) produces a **golden recall summary** and golden forward/backward trace sets; the **sortable-spreadsheet** export is golden-tested column-for-column.
- **The seed incident is the flagship scenario** and must exercise: partial consumption, rework, commingling, a label mismatch, an in-transit shipment, and an incomplete-genealogy gap — proving conservative scope.

## E4. Adversarial / failure / edge-case fixture pack (the suite that separates real from demo)

Ship these as deterministic fixtures the engine must handle correctly:

- **Commingled supplier lots** — two supplier lots of the same ingredient feed one batch; a recall of *one* must implicate every finished good from that batch (can't disambiguate which physical grains came from which lot → conservative include).
- **Partial consumption across runs** — one supplier lot is drawn into five production runs over three days; forward trace must find **all five** outputs with correct quantities, and mass must reconcile (consumed ≤ received).
- **Rework loop** — yesterday's out-of-spec output is reworked into today's batch; allergens and the original contaminant must **propagate forward through the rework edge**, and the genealogy must not create a cycle (DAG with a time-ordered rework edge).
- **Undeclared-allergen via shared equipment** — a peanut product runs, line-clearance is *recorded but not validated* (or skipped), then a "peanut-free" product runs → cross-contact risk detected, hold raised, even though the recipe is peanut-free.
- **Sequence-since-changeover** — the allergen carryover depends on how many runs since the last *validated* clearance; a fixture with a failed clearance mid-sequence must taint everything after it until the next valid clearance.
- **Label mismatch** — recipe/cross-contact present allergen Z, but the *selected label version* omits "Contains Z" → label-validation finding + hold; separately, a stale (superseded) label version applied to a shipped good → finding.
- **PAL misuse** — a "may contain milk" precautionary statement used in place of a *required* milk declaration (milk is an actual recipe ingredient) → rejected as non-compliant (PAL ≠ FALCPA declaration).
- **CCP excursion + corrective action** — a cook-step temperature reading below the versioned critical limit → automatic hold on the affected lot + corrective-action requirement + the lot's releasability blocked until corrective action + verification close.
- **COA/supplier failure** — a received lot arrives without a passing COA or from a supplier in suspended status → auto-quarantine, cannot be consumed; any batch that *did* consume it (out-of-order data arrival) retro-flags downstream.
- **Incomplete genealogy** — a transformation event references an input lot with no upstream receiving event (data gap) → trace marks the branch *unbounded/uncertain* and the recall scope **widens** to include all plausibly-affected outputs, surfacing the gap rather than dropping it.
- **Mixed shipment state** — affected finished goods split across delivered, in-transit, and on-hand inventory → recall report must segment by disposition (delivered-to-customer vs. recoverable stock vs. open shipment) and compute reconciliation %.
- **Out-of-order / late events** — a receiving event arrives *after* the production run that consumed it; the fold must be order-independent (event-time, not arrival-time, governs) and converge to the same golden state.

## E5. Rigorous acceptance criteria — property-based / invariant tests

Beyond the base spec's example tests, assert **domain invariants** as property-based tests over randomized + scripted genealogies:

1. **Mass conservation per transformation.** For every TransformationEvent, `Σ(input quantities consumed) == Σ(output quantities produced) + declared_yield_loss` (within UOM-consistent tolerance); no transformation creates or destroys mass silently. Fuzz random valid production DAGs.
2. **Trace conservativeness (superset property).** For any contaminated lot, the computed affected-set ⊇ the ground-truth affected-set in the fixture; under injected genealogy gaps the affected-set may only **grow**, never shrink, and every gap is flagged. (This is the safety-critical invariant — a *missed* case is the failure mode that hurts people.)
3. **Forward/backward inverse consistency.** If forward-trace(lot X) contains finished good F, then backward-trace(F) contains X — the two directions are consistent over the same DAG. Fuzz both.
4. **Allergen soundness.** Declared allergens on a shipped finished good ⊇ the set of allergens *present* via recipe ∪ validated-cross-contact ∪ rework; any present-but-undeclared allergen forces a hold (no false "safe" releases). PAL never reduces a required declaration.
5. **Quality/physical separation.** A lot's physical existence is independent of its releasability; releasability is a pure fold over quality events; no physical event ever silently changes a hold state and no quality event ever changes quantity/location.
6. **Critical-limit version pinning.** Every monitoring reading is judged by the critical-limit version in force at the reading's event time; changing a limit version never retroactively alters a past verdict.
7. **Audit/authority totality.** Every hold/release/reject/recall disposition has exactly one audit event with actor, authority, evidence reference, timestamp, and (for release) the passing-verification reference; no disposition without authority + evidence.
8. **Reproducibility / determinism.** Replaying the same event log (in any arrival order) yields byte-identical genealogy, allergen verdicts, HACCP holds, and recall summaries; the sortable-spreadsheet export is byte-stable.
9. **Reconciliation totality.** A recall's reconciliation accounts for 100% of produced units across {recovered, delivered, in-transit, destroyed, unaccounted}; "unaccounted" is surfaced, never absorbed.

## E6. Concrete first vertical slice (the on-ramp — build THIS first, ~18–22 cards as scoped)

Prove the spine end-to-end on **one finished product made from two supplier ingredients on a shared line, with one rework and one mislabel**, before any breadth:

1. **Typed-unit + quantity kernel** (mass/count/UOM, no stringly quantities) + deterministic ID/TLC generation + virtual clock.
2. **Event-log primitive** (append-only) + the **EPCIS-shaped event types** (ObjectEvent / TransformationEvent / AggregationEvent) with `bizStep`/`disposition`.
3. **Genealogy graph** built as a fold over events: lot nodes + quantity-carrying transformation/consumption edges; split/merge/partial-consumption/rework; **mass-conservation check**.
4. **Backward + forward trace** as deterministic DAG closure, **with the conservative-on-gaps behavior** and gap flagging.
5. **Supplier receiving + COA/supplier-status gate** → auto-quarantine on failure (separated quality state).
6. **CCP workflow**: versioned critical limits, monitoring readings, **out-of-limit → hold + corrective-action requirement**, verification close.
7. **Allergen engine v1**: recipe-content allergens + shared-equipment cross-contact (with validated-changeover gating) + rework propagation → present-vs-declared check.
8. **Label registry** (versioned approval state) + **label validation** against present allergens, claims, net quantity → findings.
9. **Recall simulator**: from a contaminated supplier lot, compute affected finished goods + customers + inventory + open shipments, segmented by disposition, with **reconciliation %**.
10. **The 24-hour electronic sortable spreadsheet export** (deterministic columns) as the recall's machine-readable output.
11. **The seed incident** (supplier-lot contaminant → rework → mislabeled packaging → mixed shipment) as a **golden recall + golden trace** test, asserting the global invariants (E5) hold.
12. **Replay/order-independence test**: shuffle event arrival order → identical golden state.

If that slice is real, supplier-quality breadth, sanitation scheduling, full EPCIS import/export, and richer HACCP plans are additions on a proven spine.

## E7. Domain knowledge-debt to track (surface, don't bluff)

Each debt item gets an owner, a risk level, and an **expert-review-needed** flag; several are **action-gating** (an output is withheld until resolved):

- **FSMA 204 scope & dates** — the Food Traceability List membership, exemptions, and the (FDA-signaled) compliance-date shift toward 2028 are regulatory and moving; the rule pack must be expert-reviewed and dated. *(Expert: food-safety/regulatory; **action-gating** for compliance claims.)*
- **CTE/KDE conformance** — exact KDE fields per CTE and the sortable-spreadsheet schema are FDA-specified; the implemented subset is defensible-but-partial and needs conformance review against the official record templates. *(Expert: traceability/EPCIS implementer.)*
- **Critical limits & hazard analysis** — actual CCPs and critical limits are *process- and product-specific* and must come from a qualified HACCP/PCQI plan; shipped values are placeholders for an expert rule pack. *(Expert: PCQI / process authority; **action-gating** for release decisions.)*
- **Allergen cross-contact modeling fidelity** — the equipment-sharing/changeover-validation model is a simplification; real validation depends on swab/ATP/ELISA testing and line geometry. Carryover coefficients are placeholders. *(Expert: allergen-control program owner.)*
- **PAL / labeling law** — precautionary-statement legality, "Contains" formatting, and gluten/cross-grain rules vary and are legally binding; label-validation rules need legal/regulatory review. *(Expert: labeling/regulatory; **action-gating** for label approval.)*
- **Recall classification & effectiveness** — assigning Class I/II/III and the required effectiveness-check depth is an FDA/firm judgment, not an algorithm; the system *organizes evidence and scope*, it does not assign legal class autonomously. *(Expert: recall coordinator/QA.)*
- **Supplier verification sufficiency** — what COA/audit/verification satisfies a given hazard is risk-based; the gate logic is a defensible default pending the supply-chain program. *(Expert: supply-chain PC.)*
- **Units & reconciliation tolerances** — UOM conversions (weight↔count↔volume for a given product density/pack) and acceptable yield-loss/reconciliation tolerances are product-specific. *(Expert: operations.)*

## E8. Why this is a great !Klein challenge

It is a compact but unforgiving test of exactly what !Klein must prove with weak local models: **graph-shaped domain modeling with conservation invariants** (the genealogy DAG with mass conservation is a natural, fuzzable property test a shallow agent cannot fake — "product has ingredients" *visibly* fails the partial-consumption/commingle tests), **safety-conservatism as a typed property** (trace must over-include on incomplete data — the opposite of the optimistic shortcut a weak model defaults to, and a beautiful place to test whether the agent encodes "when unsure, widen scope"), **immutability + reproducibility under out-of-order events** (event-sourced folds that converge regardless of arrival order — a determinism discipline that rewards the agent for *not* mutating state in place), and **honest regulatory knowledge-debt with action-gating** (refusing to assign a recall class or claim FSMA-204 compliance it can't substantiate is the food-safety analogue of the master colossus's authority gates). A swarm decomposes it cleanly: the quantity/ID/event-log primitives gate everything; the genealogy graph, allergen engine, and HACCP ledger parallelize behind them; the recall simulator and sortable-spreadsheet export are projections — legible work, with conservation + conservativeness tests that make the output trustworthy *because people can get hurt if it isn't.*

---

## Small-model build guide (3B-ready)

### 1. Glossary & ground rules

**Domain terms:**
- **TLC** — Traceability Lot Code. A unique identifier assigned to a lot of food at initial packing, first land-based receiving, or transformation. Composed of GTIN + lot code in real systems; in this build, a deterministic string generated from a seeded counter.
- **CTE** — Critical Tracking Event (FSMA 204). The seven event types: harvesting, cooling, initial packing, first land-based receiving (seafood), shipping, receiving, transformation.
- **KDE** — Key Data Element. The mandatory fields for each CTE type (location, date, quantity+UOM, reference document, TLC).
- **Transformation** — A CTE where inputs (ingredient lots, quantities) are consumed and new output lots (finished goods, WIP) are created with new TLCs. The genealogy DAG node.
- **Lot** — A traceable quantity of food with a single TLC. Can be a supplier lot, WIP lot, or finished-good lot.
- **DAG** — Directed Acyclic Graph. The genealogy structure: nodes are lots, edges are transformation/consumption edges carrying quantity+UOM.
- **Backward trace** — Given a finished good lot, find all supplier lots that contributed to it (and their quantities).
- **Forward trace** — Given a supplier lot, find all finished goods (and shipments) that contain it.
- **Conservative recall** — When genealogy is incomplete (a gap), the affected set *expands* to include all plausibly-affected lots, and the gap is surfaced as a flag.
- **HACCP** — Hazard Analysis Critical Control Points. The seven-principle food-safety management system.
- **CCP** — Critical Control Point. A step in the process where a control measure is applied. Has a versioned critical limit.
- **Critical limit** — The measurable boundary (e.g. "internal temp ≥ 74°C") separating acceptable from unacceptable at a CCP. Versioned and immutable once applied.
- **Hold** — A quality disposition: a lot cannot be shipped or consumed until cleared.
- **Release** — A quality disposition: a lot is cleared for use (requires evidence + authorized actor).
- **Cross-contact** — Physical transfer of an allergen to a product that doesn't contain it as an ingredient (via shared equipment, sequence since last validated changeover, rework).
- **Validated line-clearance** — A sanitation event that has been confirmed (via testing/inspection) to have removed allergen carryover from a previous production run.
- **PAL** — Precautionary Allergen Labeling ("may contain..."). Voluntary; cannot substitute for a required FALCPA declaration; never makes a present allergen "declared."
- **Big 9** — The nine major US allergens under FALCPA + FASTER Act: milk, egg, fish, crustacean shellfish, tree nuts, peanuts, wheat, soy, sesame.
- **COA** — Certificate of Analysis. A supplier document attesting to testing results for an incoming lot.
- **Physical state** — Where a lot is, how much exists, when it was created/received. Determined by physical events only.
- **Quality state** — Whether a lot is held, released, or recalled. Determined by quality events only. Independent of physical state.
- **Disposition** — The EPCIS concept for the object state after an event (e.g. `in_progress`, `recalled`, `destroyed`, `in_transit`).

**Stack (explicit):**
- Language: TypeScript (strict mode, no `any`)
- Runtime: Node.js
- Test runner: `npm test` → Vitest (or Jest — check `package.json`; if neither exists, use Vitest)
- No external services, no database server in tests; in-memory event log only
- Key patterns: append-only event log, pure folds for state projection, branded types for quantities, virtual clock for deterministic IDs

**Acceptance command — plain steps:**
1. `cd` to the project root.
2. Run `npm test`.
3. All tests must pass with exit code 0.
4. No network calls, no database server, no `Date.now()`, no `Math.random()` outside the seeded PRNG.

**Determinism rules (imperative):**
- Never call `Date.now()`, `new Date()`, `Math.random()`, or any network function inside core modules or tests.
- Virtual clock is injected. TLC IDs are generated from a seeded counter, not UUIDs or timestamps.
- All event times come from the virtual clock fixture; event arrival order must not affect the final projected state.
- Recall summaries must be byte-identical golden outputs from replaying the same event log.
- Use the seeded PRNG for any randomness needed in fuzz tests.

---

### 2. The explicit task graph for the first vertical slice

The first vertical slice covers E6 items 1–12 exactly. Build cards in dependency order; only start a card when all its `dependsOn` cards are green.

---

**F01 — Typed quantity kernel + deterministic ID/TLC generation + virtual clock**
dependsOn: none
files: `src/quantity.ts`, `src/identity.ts`, `src/clock.ts`, `test/quantity.test.ts`, `test/identity.test.ts`
interface:
```typescript
// src/quantity.ts
export type Kg = number & { readonly __unit: 'kg' }
export type Grams = number & { readonly __unit: 'g' }
export type Units = number & { readonly __unit: 'units' }  // count
export type Liters = number & { readonly __unit: 'L' }

export type UOM = 'kg' | 'g' | 'units' | 'L'
export interface Quantity { value: number; uom: UOM }

export function kg(v: number): Kg
export function grams(v: number): Grams
export function units(v: number): Units
export function liters(v: number): Liters
export function quantityKg(v: number): Quantity  // { value: v, uom: 'kg' }

// Convert same-dimension quantities: only kg↔g; units and L are not interchangeable
export function convertQuantity(q: Quantity, toUom: UOM): Quantity  // throws if incompatible

// src/identity.ts
export interface TlcCounter { next(): string }
export function createTlcCounter(prefix: string, startAt?: number): TlcCounter
// Generates "PREFIX-0001", "PREFIX-0002", etc. — deterministic, never random

// src/clock.ts
export interface VirtualClock { today(): number; advance(days?: number): void; reset(): void }
export function createClock(startDay?: number): VirtualClock
```
how to implement:
1. Brand each quantity type as shown; constructor functions cast via `as`.
2. `convertQuantity`: only allow kg↔g (multiply/divide by 1000); throw `Error('incompatible UOM')` for kg↔units, L↔kg, etc.
3. `createTlcCounter`: store counter internally; `next()` increments and returns `${prefix}-${String(counter).padStart(4, '0')}`.
4. `createClock`: same pattern as the irrigation project's virtual clock.
acceptance: `test/quantity.test.ts` asserts:
- `kg(1.5)` has value 1.5
- `convertQuantity({ value: 1, uom: 'kg' }, 'g')` returns `{ value: 1000, uom: 'g' }`
- `convertQuantity({ value: 500, uom: 'g' }, 'kg')` returns `{ value: 0.5, uom: 'kg' }`
- `convertQuantity({ value: 5, uom: 'kg' }, 'units')` throws
`test/identity.test.ts` asserts:
- `createTlcCounter('LOT').next()` returns `'LOT-0001'`
- Subsequent calls return `'LOT-0002'`, `'LOT-0003'`
- Two counters with the same prefix produce the same sequence independently

---

**F02 — Append-only event log + EPCIS-shaped event types**
dependsOn: F01
files: `src/event-log.ts`, `src/events.ts`, `test/event-log.test.ts`
interface:
```typescript
// src/events.ts
export type BizStep =
  | 'receiving' | 'shipping' | 'producing' | 'packing' | 'storing'
  | 'sanitation' | 'quality_check' | 'rework'
export type Disposition =
  | 'in_progress' | 'active' | 'on_hold' | 'recalled'
  | 'destroyed' | 'in_transit' | 'available_for_sale'

export interface LotQuantity { lotId: string; quantity: Quantity }

export interface ObjectEvent {
  readonly eventId: string        // deterministic ID from counter
  readonly eventType: 'object'
  readonly bizStep: BizStep
  readonly disposition: Disposition
  readonly epcList: readonly string[]   // lot IDs
  readonly eventTime: number            // virtual clock day
  readonly location: string
}

export interface TransformationEvent {
  readonly eventId: string
  readonly eventType: 'transformation'
  readonly bizStep: BizStep
  readonly disposition: Disposition
  readonly inputLots: readonly LotQuantity[]   // consumed inputs with quantities
  readonly outputLots: readonly LotQuantity[]  // produced outputs with quantities
  readonly declaredYieldLossKg: number         // expected loss (>= 0)
  readonly eventTime: number
  readonly location: string
  readonly transformationId: string            // links partial transformation events
}

export interface AggregationEvent {
  readonly eventId: string
  readonly eventType: 'aggregation'
  readonly bizStep: BizStep
  readonly disposition: Disposition
  readonly parentId: string        // pallet/case lot ID
  readonly childEpcs: readonly string[]
  readonly action: 'ADD' | 'DELETE' | 'OBSERVE'
  readonly eventTime: number
  readonly location: string
}

export type FoodEvent = ObjectEvent | TransformationEvent | AggregationEvent

// src/event-log.ts
export interface EventLog {
  append(event: FoodEvent): void
  getAll(): readonly FoodEvent[]
  getByLot(lotId: string): readonly FoodEvent[]   // events mentioning this lot
  getByType(eventType: FoodEvent['eventType']): readonly FoodEvent[]
  replayInEventTimeOrder(): readonly FoodEvent[]  // sorted by eventTime (not arrival order)
}
export function createEventLog(): EventLog
// Idempotent: appending an event with duplicate eventId is a no-op
```
how to implement:
1. Create `src/events.ts` with the interfaces above.
2. Create `src/event-log.ts`. Store events in an array.
3. `append`: check `eventId` for duplicates; skip if duplicate.
4. `getByLot`: scan all events; for ObjectEvent check `epcList`; for TransformationEvent check both `inputLots` and `outputLots`; for AggregationEvent check `childEpcs` and `parentId`.
5. `replayInEventTimeOrder`: return `[...store].sort((a,b) => a.eventTime - b.eventTime)`.
acceptance: `test/event-log.test.ts` asserts:
- Append 3 events with different IDs → `getAll().length === 3`
- Append duplicate eventId → length stays 3
- `replayInEventTimeOrder()` returns events sorted by eventTime regardless of append order
- `getByLot('lot-A')` returns only events that reference `'lot-A'`
- `getByType('transformation')` returns only TransformationEvents

---

**F03 — Genealogy graph (fold over events)**
dependsOn: F01, F02
files: `src/genealogy.ts`, `test/genealogy.test.ts`
interface:
```typescript
export interface LotNode {
  lotId: string
  tlc: string
  description: string
  totalReceivedOrProducedKg: number
  totalConsumedKg: number           // sum of all consumption edges out
  availableKg: number               // totalReceived - totalConsumed (>= 0)
}

export interface TransformEdge {
  fromLotId: string
  toLotId: string
  quantityKg: number
  transformationId: string
  eventTime: number
}

export interface GenealogyGraph {
  lots: Map<string, LotNode>
  edges: TransformEdge[]            // directed: from input lot → output lot
}

// Build the genealogy graph by folding over events in event-time order
export function buildGenealogyGraph(log: EventLog): GenealogyGraph

// Mass conservation check per TransformationEvent
export interface MassConservationResult {
  transformationId: string
  totalInputKg: number
  totalOutputKg: number
  declaredYieldLossKg: number
  discrepancyKg: number        // |inputs - outputs - yieldLoss|; should be ~0
  passes: boolean              // discrepancyKg < tolerance (0.001)
}
export function checkMassConservation(
  log: EventLog,
  toleranceKg?: number         // default 0.001
): MassConservationResult[]
```
how to implement:
1. Create `src/genealogy.ts`.
2. `buildGenealogyGraph`: iterate `log.replayInEventTimeOrder()`. For each `TransformationEvent`: (a) add/update LotNode for each inputLot (increment `totalConsumedKg`); (b) add/update LotNode for each outputLot (set `totalReceivedOrProducedKg`); (c) add a `TransformEdge` for each input→output pair. For `ObjectEvent` with `bizStep='receiving'`: create LotNode entries.
3. `checkMassConservation`: group TransformationEvents by `transformationId`; for each group sum inputs and outputs; compute discrepancy.
4. `availableKg = totalReceivedOrProducedKg - totalConsumedKg`; never negative (clamp at 0 for display but flag if actual is negative).
acceptance: `test/genealogy.test.ts` asserts:
- After receiving 100 kg of lot A and consuming 80 kg into lot B: `graph.lots.get('lot-A')!.availableKg === 20`.
- TransformationEvent with 80 kg in, 75 kg out, 5 kg yieldLoss → `checkMassConservation` returns `passes: true`.
- TransformationEvent with 80 kg in, 75 kg out, 2 kg yieldLoss → `discrepancyKg === 3`, `passes: false`.
- Out-of-order event arrival (append day-5 before day-3 event) → `buildGenealogyGraph` produces identical result as in-order arrival.
- Two supplier lots commingled into one output: both appear as edges into the output lot.

---

**F04 — Backward and forward trace with conservative-on-gaps behavior**
dependsOn: F03
files: `src/trace.ts`, `test/trace.test.ts`
interface:
```typescript
export type TraceStatus = 'complete' | 'incomplete_gap' | 'unbounded'

export interface TraceNode {
  lotId: string
  quantityKg: number
  depth: number               // hops from the query lot
  status: TraceStatus         // 'complete' = fully resolved; 'incomplete_gap' = ancestor/descendant unknown
}

export interface TraceResult {
  queryLotId: string
  direction: 'backward' | 'forward'
  affectedLots: TraceNode[]
  gaps: string[]              // lot IDs where the trace hit a missing upstream event
  isConservative: boolean     // always true — if any gap, affected set is a superset of ground truth
}

// Backward trace: from a finished-good lot, find all supplier lots that contributed to it
export function backwardTrace(lotId: string, graph: GenealogyGraph): TraceResult

// Forward trace: from a supplier lot, find all downstream lots (finished goods, shipments)
export function forwardTrace(lotId: string, graph: GenealogyGraph): TraceResult
```
how to implement:
1. Create `src/trace.ts`.
2. `backwardTrace(lotId, graph)`: BFS/DFS from `lotId` following edges *backwards* (toLotId → fromLotId). For each visited lot, if it has no incoming edges → leaf (supplier lot). If it is expected to have an upstream (was produced via a transformation) but no `TransformEdge` is found → mark as `incomplete_gap`, add to `gaps[]`, **include the lot in affectedLots with `status: 'incomplete_gap'`** (do not prune).
3. `forwardTrace(lotId, graph)`: BFS/DFS from `lotId` following edges *forward* (fromLotId → toLotId). Same gap logic.
4. `isConservative: true` always (document that any gap causes the set to be a strict superset).
5. Never throw for missing lots; treat them as gap nodes and widen scope.
acceptance: `test/trace.test.ts` asserts:
- Simple chain A → B → C: `backwardTrace('C')` returns A and B; `forwardTrace('A')` returns B and C.
- Commingled: A1 and A2 → B: backward trace from B includes both A1 and A2.
- Partial consumption: A → B (80kg consumed), A → C (20kg consumed): `forwardTrace('A')` includes both B and C.
- Gap: B references input lot X but X has no receiving event: `backwardTrace('B')` includes X with `status: 'incomplete_gap'`, X is in `gaps[]`.
- `isConservative === true` in all results.
- Forward/backward consistency: if `forwardTrace('A').affectedLots` contains lot F, then `backwardTrace('F').affectedLots` contains 'A'.

---

**F05 — Supplier receiving + COA/supplier-status gate → separated quality state**
dependsOn: F02, F03
files: `src/supplier-gate.ts`, `src/quality-state.ts`, `test/supplier-gate.test.ts`
interface:
```typescript
// src/quality-state.ts
export type QualityDisposition = 'unreleased' | 'on_hold' | 'released' | 'rejected' | 'recalled'

export interface QualityEvent {
  readonly eventId: string
  readonly lotId: string
  readonly disposition: QualityDisposition
  readonly actor: string
  readonly authorityRef: string         // e.g. 'QA-MANAGER', 'PCQI-CERT-001'
  readonly evidenceRef: string          // e.g. 'COA-2025-001', 'CCP-DEVIATION-007'
  readonly eventTime: number
  readonly notes: string
}

export interface QualityLedger {
  appendQualityEvent(e: QualityEvent): void
  currentDisposition(lotId: string): QualityDisposition   // fold: last event wins
  getHistory(lotId: string): readonly QualityEvent[]
  isReleasable(lotId: string): boolean   // true only if currentDisposition === 'released'
}
export function createQualityLedger(): QualityLedger

// src/supplier-gate.ts
export interface SupplierStatus { supplierId: string; approved: boolean; suspendedReason?: string }
export interface CoaResult { lotId: string; passed: boolean; failureReason?: string }

export interface SupplierGateResult {
  lotId: string
  supplierId: string
  passed: boolean
  failureReason: string | null
  qualityEventEmitted: QualityEvent    // auto-quarantine if !passed
}

export function evaluateSupplierGate(
  lotId: string,
  supplierId: string,
  coa: CoaResult,
  supplierStatus: SupplierStatus,
  actor: string,
  eventTime: number
): SupplierGateResult
// If supplier suspended OR coa.passed === false → qualityEvent.disposition = 'on_hold'
// If passes → qualityEvent.disposition = 'unreleased' (awaiting explicit release)
```
how to implement:
1. Create `src/quality-state.ts`: QualityLedger stores quality events in an array; `currentDisposition` scans in event-time order and returns the last disposition; `getHistory` returns all events for a lot; `isReleasable` checks `currentDisposition === 'released'`.
2. Create `src/supplier-gate.ts`: `evaluateSupplierGate` checks `supplierStatus.approved` and `coa.passed`; constructs and returns a `QualityEvent` (does not append it — the caller decides when to persist).
3. Physical events (receiving) and quality events are in separate stores — do not mix them.
acceptance: `test/supplier-gate.test.ts` asserts:
- Approved supplier + passing COA → `passed: true`, `disposition: 'unreleased'`.
- Suspended supplier → `passed: false`, `disposition: 'on_hold'`.
- Failing COA → `passed: false`, `disposition: 'on_hold'`.
- Quality event has actor, authorityRef, evidenceRef (all non-empty).
- `ledger.currentDisposition('lot-X')` starts as `'unreleased'`; after appending an on-hold event → `'on_hold'`; after a release event → `'released'`.
- `isReleasable` returns `false` for `'on_hold'` and `'unreleased'`; `true` only for `'released'`.

---

**F06 — CCP workflow: versioned critical limits, monitoring readings, out-of-limit → hold**
dependsOn: F05
files: `src/ccp.ts`, `test/ccp.test.ts`
interface:
```typescript
export interface CriticalLimitVersion {
  readonly versionId: string
  readonly ccpId: string
  readonly parameter: string       // e.g. 'internal_temp_c'
  readonly minValue: number | null
  readonly maxValue: number | null
  readonly unit: string
  readonly effectiveFrom: number   // virtual clock day
  readonly supersededBy: string | null  // next versionId, or null if current
}

export interface MonitoringReading {
  readonly readingId: string
  readonly ccpId: string
  readonly lotId: string
  readonly value: number
  readonly unit: string
  readonly eventTime: number
}

export interface CcpVerdict {
  readonly readingId: string
  readonly lotId: string
  readonly limitVersionId: string   // the version in force at eventTime
  readonly inLimit: boolean
  readonly deviationAmount: number | null   // how far out (null if in limit)
  readonly holdEventEmitted: QualityEvent | null  // non-null if out-of-limit
}

// Returns the critical limit version that was in force at the given eventTime
export function getLimitVersionAtTime(
  ccpId: string,
  eventTime: number,
  versions: CriticalLimitVersion[]
): CriticalLimitVersion | null

export function evaluateMonitoringReading(
  reading: MonitoringReading,
  versions: CriticalLimitVersion[],
  actor: string
): CcpVerdict
```
how to implement:
1. Create `src/ccp.ts`.
2. `getLimitVersionAtTime`: filter versions where `effectiveFrom <= eventTime` and either `supersededBy === null` or the superseding version has `effectiveFrom > eventTime`; return the most recent by `effectiveFrom`. Return `null` if no version applies.
3. `evaluateMonitoringReading`: call `getLimitVersionAtTime`; check `minValue`/`maxValue` against `reading.value`; if out-of-limit, construct a `QualityEvent` with `disposition: 'on_hold'`, `evidenceRef: reading.readingId`, `authorityRef: 'CCP-AUTO'`.
4. Never change a past verdict when a new limit version is added (the version is pinned at `reading.eventTime`).
acceptance: `test/ccp.test.ts` asserts:
- Reading within limits → `inLimit: true`, `holdEventEmitted: null`.
- Reading below minimum → `inLimit: false`, `deviationAmount > 0`, `holdEventEmitted` is a valid QualityEvent with `disposition: 'on_hold'`.
- Adding a new limit version after the reading → re-evaluating the *same reading* still uses the old version (version pinning).
- `getLimitVersionAtTime` with two versions (old: day 0, new: day 10) and a reading on day 8 → returns the old version.

---

**F07 — Allergen engine v1: recipe + equipment cross-contact + rework propagation**
dependsOn: F03, F05
files: `src/allergens.ts`, `src/allergen-engine.ts`, `test/allergen-engine.test.ts`
interface:
```typescript
// src/allergens.ts
export type Allergen =
  | 'milk' | 'egg' | 'fish' | 'crustacean_shellfish'
  | 'tree_nuts' | 'peanuts' | 'wheat' | 'soy' | 'sesame'
export const BIG_9: readonly Allergen[]  // all nine

// src/allergen-engine.ts
export interface RecipeAllergenProfile {
  lotId: string   // finished-good or WIP lot
  recipeAllergens: Set<Allergen>   // from declared recipe ingredients
}

export interface EquipmentRunRecord {
  equipmentId: string
  lotId: string              // lot that ran on this equipment
  allergens: Set<Allergen>   // allergens present in that lot
  eventTime: number
  lineClearanceValidated: boolean  // was a validated clearance done AFTER this run?
}

export interface AllergenAnalysisResult {
  lotId: string
  presentAllergens: Set<Allergen>   // recipe + cross-contact + rework
  crossContactSources: Array<{ source: 'equipment' | 'rework'; description: string }>
  undeclaredRisk: Allergen[]        // presentAllergens that are NOT in declaredAllergens
  holdRequired: boolean
}

export function computePresentAllergens(
  lotId: string,
  graph: GenealogyGraph,          // for rework propagation
  recipeProfile: RecipeAllergenProfile,
  equipmentHistory: EquipmentRunRecord[],  // sorted ascending by eventTime
  lotEventTime: number
): AllergenAnalysisResult
// Step 1: start with recipeProfile.recipeAllergens
// Step 2: rework — find all rework edges (edges from a prior output lot into this lot via TransformEdge with bizStep='rework'); union their allergens into presentAllergens
// Step 3: equipment cross-contact — find all EquipmentRunRecord for the same equipment *before* lotEventTime without a validated line-clearance *after* those runs; union their allergens
// Step 4: holdRequired = undeclaredRisk.length > 0

export function validateAllergenLabel(
  analysis: AllergenAnalysisResult,
  labelDeclaredAllergens: Set<Allergen>
): { valid: boolean; undeclaredFindings: Allergen[]; palMisuse: boolean }
// undeclaredFindings = presentAllergens \ labelDeclaredAllergens
// palMisuse: true if a "may contain X" PAL is present but X is actually in presentAllergens (not just cross-contact risk)
```
how to implement:
1. Create `src/allergens.ts` with the `Allergen` type and `BIG_9` constant.
2. Create `src/allergen-engine.ts`.
3. `computePresentAllergens`:
   a. Recipe: clone `recipeProfile.recipeAllergens` as starting set.
   b. Rework: find TransformEdge objects in `graph.edges` where `toLotId === lotId`; for each such edge, look up its source lot's allergen profile (caller must ensure rework source allergens are pre-computed and provided — or simplify: the function accepts an optional `reworkAllergens: Map<string, Set<Allergen>>` parameter).
   c. Equipment: filter `equipmentHistory` for records with `eventTime < lotEventTime`; group by `equipmentId`; for each group, find the latest record; if `lineClearanceValidated === false`, add that record's allergens to presentAllergens.
   d. Build `crossContactSources` with human-readable descriptions.
   e. `undeclaredRisk`: present allergens not in `labelDeclaredAllergens` (pass empty set here; caller passes the actual label set to `validateAllergenLabel`).
4. `validateAllergenLabel`: straightforward set difference; `palMisuse` is true when the label has a PAL for allergen X but X is actually in `presentAllergens` (should have been a full declaration).
acceptance: `test/allergen-engine.test.ts` asserts:
- Recipe with peanuts → `presentAllergens` includes `'peanuts'`.
- No equipment sharing → no cross-contact allergens.
- Peanut product ran on equipment, no validated clearance, then peanut-free product runs → cross-contact `'peanuts'` detected.
- Validated clearance between runs → no cross-contact.
- Rework of a milk-containing lot into a "milk-free" product → `'milk'` appears in `presentAllergens`.
- `validateAllergenLabel` with undeclared peanut → `undeclaredFindings: ['peanuts']`, `valid: false`.
- PAL "may contain peanuts" when peanuts are a recipe ingredient → `palMisuse: true`.

---

**F08 — Label registry + label validation**
dependsOn: F07
files: `src/label-registry.ts`, `test/label-registry.test.ts`
interface:
```typescript
export type LabelApprovalState = 'draft' | 'approved' | 'superseded'

export interface LabelVersion {
  readonly labelId: string
  readonly versionId: string
  readonly approvalState: LabelApprovalState
  readonly declaredAllergens: Set<Allergen>
  readonly claims: string[]         // e.g. ['gluten-free', 'organic']
  readonly netQuantityG: number
  readonly effectiveFrom: number    // virtual clock day
}

export interface LabelRegistry {
  addVersion(v: LabelVersion): void
  getCurrentVersion(labelId: string): LabelVersion | null  // highest effectiveFrom with state='approved'
  getVersionAtTime(labelId: string, eventTime: number): LabelVersion | null
}
export function createLabelRegistry(): LabelRegistry

export interface LabelValidationFinding {
  findingId: string
  lotId: string
  labelVersionId: string
  findingType: 'undeclared_allergen' | 'stale_label' | 'pal_misuse' | 'claim_mismatch'
  description: string
}

export function validateLotLabel(
  lotId: string,
  appliedLabelVersionId: string,
  allergenAnalysis: AllergenAnalysisResult,
  registry: LabelRegistry,
  appliedAtTime: number
): LabelValidationFinding[]
```
how to implement:
1. Create `src/label-registry.ts`.
2. `getCurrentVersion`: filter for `approvalState === 'approved'`; return the one with highest `effectiveFrom`.
3. `getVersionAtTime`: find approved version effective at the given time (same logic as CCP limit versioning).
4. `validateLotLabel`: (a) fetch the label version by `appliedLabelVersionId`; (b) if that version is not the current approved version → add `'stale_label'` finding; (c) call `validateAllergenLabel(allergenAnalysis, version.declaredAllergens)` → add `'undeclared_allergen'` findings for each; (d) add `'pal_misuse'` if `palMisuse === true`.
acceptance: `test/label-registry.test.ts` asserts:
- Approved label version → `getCurrentVersion` returns it.
- After superseding, `getCurrentVersion` returns the new version.
- Applying a superseded label version → `stale_label` finding.
- Undeclared allergen on applied label → `undeclared_allergen` finding.
- PAL misuse → `pal_misuse` finding.

---

**F09 — Recall simulator: affected lots + customers + disposition segments + reconciliation**
dependsOn: F04, F05, F08
files: `src/recall-simulator.ts`, `test/recall-simulator.test.ts`
interface:
```typescript
export type ShipmentDisposition = 'delivered' | 'in_transit' | 'on_hand'

export interface ShipmentRecord {
  shipmentId: string
  finishedGoodLotId: string
  customerId: string
  quantityKg: number
  disposition: ShipmentDisposition
  eventTime: number
}

export interface RecallScope {
  contaminatedLotId: string
  affectedFinishedGoodLotIds: string[]
  gaps: string[]
  customersByLot: Map<string, string[]>       // lotId → customerIds
  segmentedByDisposition: {
    delivered: ShipmentRecord[]
    inTransit: ShipmentRecord[]
    onHand: ShipmentRecord[]
  }
  totalProducedKg: number
  totalAccountedKg: number                    // delivered + inTransit + onHand + destroyed
  unaccountedKg: number                       // totalProduced - totalAccounted
  reconciliationPct: number                   // totalAccounted / totalProduced * 100
}

export function runRecallSimulator(
  contaminatedLotId: string,
  graph: GenealogyGraph,
  shipments: readonly ShipmentRecord[],
  qualityLedger: QualityLedger
): RecallScope
```
how to implement:
1. Create `src/recall-simulator.ts`.
2. Call `forwardTrace(contaminatedLotId, graph)` to get `affectedLotIds` (use the conservative forward trace from F04).
3. Filter `shipments` to those where `finishedGoodLotId` is in the affected set.
4. Segment by `disposition`.
5. `totalProducedKg`: sum `graph.lots.get(lotId)!.totalReceivedOrProducedKg` for all affected finished-good lots.
6. `totalAccountedKg`: sum all shipment quantities.
7. `unaccountedKg = totalProducedKg - totalAccountedKg` (may be > 0 if some inventory has no shipment record).
8. `reconciliationPct = totalAccountedKg / totalProducedKg * 100` (cap at 100).
acceptance: `test/recall-simulator.test.ts` asserts:
- Contaminated lot A → forward trace finds finished good F; `recallScope.affectedFinishedGoodLotIds` includes F.
- Shipment of F to customer C (delivered) → `segmentedByDisposition.delivered` contains that shipment.
- Mass reconciliation: `totalAccountedKg + unaccountedKg === totalProducedKg`.
- `reconciliationPct` is between 0 and 100.
- Gaps from forward trace appear in `recallScope.gaps`.
- Conservative scope: a commingled lot (ambiguous which input contributed) → both source lots' downstream is included.

---

**F10 — The 24-hour electronic sortable spreadsheet export**
dependsOn: F09
files: `src/recall-export.ts`, `test/recall-export.test.ts`
interface:
```typescript
export interface RecallSpreadsheetRow {
  tlc: string                  // Traceability Lot Code
  description: string
  cteType: string              // e.g. 'transformation', 'receiving', 'shipping'
  eventTime: number            // virtual clock day
  location: string
  quantityKg: number
  uom: string                  // 'kg'
  referenceDocId: string       // e.g. shipmentId or eventId
  disposition: string
  customerId: string | null
}

// Generate the FDA-style sortable spreadsheet rows for a recall
export function generateRecallSpreadsheet(
  scope: RecallScope,
  graph: GenealogyGraph,
  log: EventLog
): RecallSpreadsheetRow[]
// Rows are sorted by eventTime ascending (the "sortable" requirement)
// Each row corresponds to one CTE event in the affected lot chain
```
how to implement:
1. Create `src/recall-export.ts`.
2. For each affected lot, gather all events from `log.getByLot(lotId)`.
3. Map each event to one `RecallSpreadsheetRow`: extract tlc from the lot, event type, location, quantity.
4. Sort all rows by `eventTime` ascending.
5. This function is pure (no I/O).
acceptance: `test/recall-export.test.ts` asserts:
- Rows are sorted by `eventTime` ascending.
- Every row has a non-empty `tlc`, `cteType`, `location`.
- Row count equals the number of CTE events in the affected lot chain.
- Running `generateRecallSpreadsheet` twice on the same inputs produces byte-identical results (determinism).

---

**F11 — The seed incident golden test**
dependsOn: F03, F04, F07, F08, F09, F10
files: `src/fixtures/seed-incident.ts`, `test/seed-incident.test.ts`
interface: (no new exports — fixture + golden test)
how to implement:
1. Create `src/fixtures/seed-incident.ts`. Build the following scenario as a fixed event sequence:
   - Day 0: Supplier lot SL-001 (wheat, 200kg, supplierId: ACME) received. COA passes. Approved.
   - Day 1: Supplier lot SL-002 (wheat, 100kg, same supplier) received. COA FAILS (contaminant found). Auto-hold.
   - Day 2: Production run: TransformationEvent, inputs: SL-001 (150kg) + SL-002 (50kg, but SL-002 is on hold — this is the error!), output: FG-001 (190kg finished crackers), yieldLoss: 10kg. TLC: `FG-LOT-0001`.
   - Day 2: 40kg of FG-001 out-of-spec → rework into FG-002 (new production run). TLC: `FG-LOT-0002`.
   - Day 3: FG-001 shipped to customer CUST-A (100kg, delivered), CUST-B (50kg, in_transit). FG-002 shipped to CUST-C (39kg, on_hand).
   - Day 3: Label applied to FG-001: label version LBL-V1 which omits sesame allergen that was added via a cross-contact (equipment ran a sesame product day 1 without validated clearance).
   Export this as an ordered array of events and the fixture shipments, equipment history, and label data.
2. In `test/seed-incident.test.ts`:
   a. Build the event log and genealogy graph from the fixture.
   b. Run `forwardTrace('SL-002', graph)` → must include FG-001 and FG-002 (rework propagation).
   c. Run `computePresentAllergens('FG-001', graph, recipeProfile, equipmentHistory, day3)` → must include sesame cross-contact.
   d. Run `validateLotLabel('FG-001', 'LBL-V1', analysis, registry, day3)` → must return at least one `undeclared_allergen` finding for sesame.
   e. Run `runRecallSimulator('SL-002', graph, shipments, qualityLedger)` → affected set includes FG-001 and FG-002; segmentation shows delivered+inTransit+onHand; reconciliation % correct.
   f. Run `generateRecallSpreadsheet(scope, graph, log)` → non-empty, sorted, deterministic (golden check: store output hash or row count + first row's fields as expected values).
   g. Check mass conservation: `checkMassConservation(log).every(r => r.passes)`.
acceptance: All assertions in step 2 pass. Run `npm test` → green. No network, no `Date.now()`.

---

**F12 — Replay/order-independence test**
dependsOn: F11
files: `test/replay-order-independence.test.ts`
interface: (no new exports)
how to implement:
1. Take the seed-incident fixture events from F11.
2. Create two event logs: one with events appended in original order, one with events appended in a shuffled order (use the seeded PRNG to shuffle deterministically).
3. Build genealogy graphs from both.
4. Assert: `graph1.lots` and `graph2.lots` have the same lot IDs, quantities, and available kg.
5. Assert: `forwardTrace('SL-002', graph1).affectedLots.map(n => n.lotId).sort()` equals the same from `graph2`.
6. Assert: `runRecallSimulator('SL-002', graph1, ...)` and `...(graph2, ...)` produce identical `reconciliationPct`.
acceptance: All assertions pass. Confirms event-time ordering, not arrival-order, governs state.

---

### 3. The decomposition method for the rest of the spec

After the first slice (F01–F12) is green, apply this recipe to expand remaining features (supplier-quality breadth, sanitation scheduling, full EPCIS import/export, richer HACCP plans) into the same card shape.

**Recipe:**
1. Identify the feature's primary output type — a new TypeScript interface or function.
2. Trace its inputs back to existing modules; each dependency is a `dependsOn`.
3. Separate physical-event cards from quality-event cards. They are never in the same module.
4. Write the interface (types + function signatures) first; do not implement until the interface compiles.
5. Write the acceptance test before the implementation. Conservative-scope tests always include a "gap" case.
6. One card = one new source file + its test file (or one edit to an existing file + tests).

**Worked example 1 — Sanitation scheduling:**
- **SS01** — SanitationEvent type and `SanitationSchedule`: `interface SanitationEvent { equipmentId: string; scheduledDay: number; performedDay: number | null; validatedBy: string | null; allergenTarget: Allergen[] }`. dependsOn: F01, F02. files: `src/sanitation.ts`, `test/sanitation.test.ts`. Acceptance: scheduled event with no performed day → `pending`; performed + validated → can be used as a `lineClearanceValidated: true` record in the allergen engine.
- **SS02** — Line-clearance validator: `function isLineClearanceValid(event: SanitationEvent): boolean`. dependsOn: SS01. Acceptance: only returns `true` when `performedDay !== null && validatedBy !== null`.
- **SS03** — Wire SS02 into allergen engine: `computePresentAllergens` now accepts `sanitationEvents: SanitationEvent[]` and calls `isLineClearanceValid` to determine whether each equipment run's allergens carry over. dependsOn: SS02, F07. files: edit `src/allergen-engine.ts`. Acceptance: re-run the seed incident test with a valid sanitation event → sesame cross-contact is no longer flagged.

**Worked example 2 — Partial-consumption across multiple runs:**
- **PC01** — `partialConsumptionCheck(lotId, graph)`: verifies that sum of all consumption edges ≤ `totalReceivedOrProducedKg`. Returns `{ overConsumed: boolean; consumedKg: number; availableKg: number }`. dependsOn: F03. files: `src/consumption-check.ts`, `test/consumption-check.test.ts`. Acceptance: 100kg lot consumed in 5 runs of 20kg each → not over-consumed; a 6th run consuming 5kg → over-consumed.
- **PC02** — Enforce at consumption time: `validateConsumption(lotId, requestedKg, graph, qualityLedger)` → throws if over-consuming or lot is on hold. dependsOn: PC01, F05. files: edit `src/genealogy.ts`. Acceptance: consuming from an on-hold lot → error; over-consuming → error.

**Worked example 3 — EPCIS export adapter:**
- **EP01** — `EpcisExportAdapter`: `interface EpcisExportAdapter { exportEvent(event: FoodEvent): string }` (returns JSON string). dependsOn: F02. files: `src/adapters/epcis-export-adapter.ts`, `test/epcis-export-adapter.test.ts`. Acceptance: a `TransformationEvent` exports with `epcisType: 'TransformationEvent'`, `inputQuantityList` and `outputQuantityList` present; a round-trip (export → re-parse) produces the same event structure.

---

### 4. Per-task implementation conventions

**File/folder layout:**
```
src/
  quantity.ts          # branded quantity types
  identity.ts          # deterministic TLC/ID generation
  clock.ts             # virtual clock
  events.ts            # EPCIS-shaped event types
  event-log.ts         # append-only physical event log
  genealogy.ts         # DAG fold
  trace.ts             # backward/forward trace
  supplier-gate.ts     # COA + supplier-status gate
  quality-state.ts     # quality event ledger
  ccp.ts               # HACCP CCP workflow
  allergens.ts         # allergen type definitions
  allergen-engine.ts   # propagation engine
  label-registry.ts    # versioned label approval
  recall-simulator.ts  # affected-set + reconciliation
  recall-export.ts     # sortable-spreadsheet export
  adapters/
    epcis-export-adapter.ts
    supplier-feed-adapter.ts
  fixtures/
    seed-incident.ts
test/
  quantity.test.ts
  identity.test.ts
  event-log.test.ts
  genealogy.test.ts
  trace.test.ts
  supplier-gate.test.ts
  ccp.test.ts
  allergen-engine.test.ts
  label-registry.test.ts
  recall-simulator.test.ts
  recall-export.test.ts
  seed-incident.test.ts
  replay-order-independence.test.ts
```

**Naming conventions:**
- Source files: kebab-case (`recall-simulator.ts`).
- Test files: same name + `.test.ts`.
- Types: PascalCase (`TransformationEvent`).
- Functions: camelCase (`buildGenealogyGraph`).
- Constants: SCREAMING_SNAKE_CASE (`BIG_9`).

**How to write a test in this stack (Vitest example):**
```typescript
import { describe, it, expect } from 'vitest'
import { buildGenealogyGraph } from '../src/genealogy.js'
import { createEventLog } from '../src/event-log.js'

describe('GenealogyGraph', () => {
  it('tracks available kg after partial consumption', () => {
    const log = createEventLog()
    // append a receiving event and a transformation consuming 80 of 100 kg
    // ... build events ...
    const graph = buildGenealogyGraph(log)
    expect(graph.lots.get('lot-A')!.availableKg).toBe(20)
  })
})
```

**How to keep tests deterministic:**
- Use `createClock()` and advance it; never `Date.now()`.
- All event IDs come from `createTlcCounter` or a fixed string — never `crypto.randomUUID()`.
- `replayInEventTimeOrder()` is the only ordering that matters for state; tests may append events in any order.
- Use `expect(x).toEqual(y)` for structural equality on objects; `===` for primitives.

**How to wire a fixture adapter:**
```typescript
import { SEED_INCIDENT_EVENTS } from '../src/fixtures/seed-incident.js'
const log = createEventLog()
for (const event of SEED_INCIDENT_EVENTS) { log.append(event) }
const graph = buildGenealogyGraph(log)
```

**Definition of done for any card:**
1. All files in the card's `files` list exist.
2. All interfaces/functions in `interface` are exported and TypeScript-compiles cleanly.
3. All acceptance assertions pass under `npm test`.
4. No `Date.now()`, `Math.random()`, `fetch`, or `crypto.randomUUID()` in the new source files.
5. No `any` types.
6. Quality events and physical events are in separate stores — never merged.

---

### 5. Common pitfalls for a weak model on this project

**Pitfall 1 — Modeling genealogy as "product has ingredients" (array of ingredient names).**
A 3B model will write `interface Product { ingredients: string[] }` and call `product.ingredients.includes(allergen)`. This collapses quantity conservation, partial consumption, and commingling — the most important behaviors. Fix: genealogy is a `Map<string, LotNode>` with `TransformEdge[]`. There is no `ingredients` array on a product. If the model writes one, reject the card.

**Pitfall 2 — Forward/backward trace returning an over-optimistic (under-broad) result.**
A model tends to stop traversal at the first missing edge, effectively pruning the result. This is the exact opposite of the required behavior. Fix: when a traversal hits a lot with no upstream/downstream edge, *include the lot* in the result with `status: 'incomplete_gap'` and add its ID to `gaps[]`. Never prune; always widen. Check the gap fixture test.

**Pitfall 3 — Merging physical state and quality state into a single `status` field.**
A model may write `interface Lot { status: 'received' | 'on_hold' | 'shipped' }` mixing physical and quality into one field. This makes it impossible to represent "physically shipped but quality-recalled." Fix: physical state is a fold over `ObjectEvent`/`TransformationEvent`; quality state is a fold over `QualityEvent`. They are separate stores. Test: append a shipping event and a hold event in different orders; verify physical and quality state are independent.

**Pitfall 4 — Using `Set<Allergen>` incorrectly (losing allergens on assignment).**
A model may write `presentAllergens = recipeAllergens` (reference assignment) then mutate the original when adding cross-contact allergens. Fix: always clone: `new Set(recipeAllergens)`. Test: after calling `computePresentAllergens`, the original `recipeProfile.recipeAllergens` must be unchanged.

**Pitfall 5 — Treating PAL ("may contain") as a valid allergen declaration.**
A model may mark `undeclaredRisk = []` when a "may contain milk" PAL is present, assuming it covers the declaration. PAL is never a substitute for a FALCPA declaration. Fix: `undeclaredRisk` is the set of *present* allergens not in `declaredAllergens` (the explicit "Contains" statement). A PAL for an allergen that is actually *present via recipe* is a `palMisuse` finding.

**Pitfall 6 — Critical limit version pinning broken by using the current version for past readings.**
A model may call `getCurrentVersion(ccpId)` when evaluating a past reading instead of `getLimitVersionAtTime(ccpId, reading.eventTime, versions)`. This means re-evaluating past readings with today's limits — a regulatory violation. Fix: always use `getLimitVersionAtTime`. Test: add a new stricter limit after a reading; re-evaluating the reading should still use the old limit.

**Pitfall 7 — Mass conservation check ignores yield loss.**
A model computes `Σinputs === Σoutputs` without accounting for `declaredYieldLossKg`. This makes every real-world production run fail the conservation check. Fix: `discrepancyKg = |Σinputs - Σoutputs - declaredYieldLossKg|`. Only flag if `discrepancyKg > tolerance`.

**Pitfall 8 — Event log arrival order affecting state.**
A model builds the genealogy graph by iterating `log.getAll()` (arrival order) instead of `log.replayInEventTimeOrder()`. Out-of-order events then produce a different graph. Fix: always fold over `log.replayInEventTimeOrder()`. The replay-order-independence test (F12) catches this.

**Pitfall 9 — Recall simulator missing in-transit and on-hand shipments.**
A model may only count `delivered` shipments in the recall scope, ignoring recoverable `in_transit` and `on_hand` stock. Fix: segment by all three dispositions. `totalAccountedKg` sums all three. `unaccountedKg = totalProduced - totalAccounted`. Test: fixture with one delivered and one in-transit shipment → both appear in the output.

**Pitfall 10 — Allergen equipment cross-contact: using the wrong "last run" logic.**
A model may check whether the *most recent* run before the current lot was a validated clearance, ignoring that a non-validated run *after the last clearance* taints everything after it. Fix: scan the equipment history; find the last *validated* clearance event; any run between that clearance and the current lot that had allergens → cross-contact. If there is no validated clearance at all → all prior allergens carry over. Test the `sequence-since-changeover` fixture.
