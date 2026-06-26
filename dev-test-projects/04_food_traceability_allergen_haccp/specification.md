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
