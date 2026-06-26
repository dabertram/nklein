# 01 - Clinical Medication Safety and Adherence Platform

Complexity tier: 1/20
Expected decomposition size: 12-16 dependent implementation cards before coding.
Domain pressure: outpatient medication safety, drug interaction rules, caregiver workflows, refill logistics, audit trails.
Acceptance command: npm test

## How to use this challenge
This is a dev-test project specification for evaluating whether an autonomous coding agent can decompose a real domain, identify knowledge gaps, build a correct foundation, and verify it with deterministic tests. The goal is not to finish the entire product. The goal is to build a durable foundation that proves the agent understood the domain boundaries and can implement the highest-risk core behaviors without hiding behind placeholders.

The agent must read this entire specification before planning. It must create a dependency-linked plan, record domain knowledge debt, and choose a narrow release slice that still exercises the real hard parts. Prefer fewer production-quality vertical slices over many shallow labels.

## Product vision
Build a serious medication safety and adherence platform for small clinics, home-care nurses, and family caregivers. It should help reconcile medication lists, detect obvious interaction and duplicate-therapy risks, track adherence, and produce explainable action queues without pretending to replace a licensed clinician.

## Foundation release scope
The first serious buildout must include:
- A patient, medication, schedule, prescriber, pharmacy, caregiver, and adherence-event domain model with stable IDs and audit history.
- Medication reconciliation workflow that can compare imported lists, patient-reported changes, and clinician-approved active regimens.
- Rule engine for duplicate active ingredients, max daily dose warnings, therapeutic class duplication, allergy conflicts, and simple contraindication notes.
- Adherence calendar that distinguishes taken, missed, skipped by instruction, held by clinician, and unknown states.
- Refill risk forecast based on dose schedule, remaining quantity, pharmacy fill date, and known pauses.
- Task queue for caregiver follow-up, clinician review, refill request, and patient education items.
- Patient-facing summary output that uses plain language and never exposes raw internal risk scores as medical advice.
- Deterministic seed data for at least five patients with conflicting medication histories and edge cases.

## Architecture requirements
- Separate clinical facts, rule evaluation, workflow state, and presentation formatting so medical logic is testable without UI assumptions.
- Use typed rule definitions with explanations, severity, evidence, suppressions, and review state.
- Make audit events append-only; never overwrite the history that produced a safety decision.
- Design import adapters around normalized medication concepts, not around one CSV shape.

## Domain knowledge debt to surface
The agent should not pretend to know every regulation, standard, or numerical model perfectly. It should implement a defensible deterministic subset, mark assumptions explicitly, and create extension points where real-world integrations or expert-reviewed rule packs would live. Required knowledge areas:
- Drug identifiers differ across RxNorm-like concepts, NDC packages, brand names, and patient free text.
- An alert is not useful unless it has evidence, severity, suppressibility, and a clear next action.
- Clinical software must avoid presenting generated content as diagnosis or treatment instruction.
- Dose calculations must consider unit normalization and schedule frequency.

## Decomposition pressure
This project should force decomposition across domain modeling, calculation or policy engines, workflow state, deterministic fixtures, auditability, and UI/view-model boundaries. The plan should include dependency links so shared primitives and invariants are built before dependent workflow features. Avoid starting with screens. Start with the domain model, invariants, and tests that would make later screens trustworthy.

The agent should maintain a visible knowledge-debt list covering unclear standards, units, legal or safety constraints, numerical assumptions, terminology, fixture limitations, and future expert-review checkpoints. Knowledge debt is not a failure; hiding it is.

## Acceptance criteria
- Medication reconciliation preserves source provenance for every active and rejected item.
- Rule tests cover duplicate therapy, allergy conflict, high dose, refill exhaustion, and temporarily held medication.
- Adherence summaries are deterministic across time zones when a test clock is injected.
- Every generated safety task can be traced back to patient facts and rule evidence.
- The project passes npm test with no network calls.

## Explicit non-goals
- Do not integrate real drug databases in the foundation; model import boundaries and deterministic fixtures instead.
- Do not implement diagnosis, prescribing, or autonomous treatment decisions.
- Do not fake safety checks with hard-coded UI labels.

## Quality bar
- Use typed domain objects and pure core modules wherever practical.
- Keep deterministic fixtures in the repository and do not depend on live APIs for acceptance tests.
- Test edge cases before building broad UI coverage.
- Every risk score, recommendation, workflow transition, or generated report must be explainable from source facts.
- Stubs are acceptable only at external integration boundaries and must be named as adapters with deterministic fixture implementations.
- The foundation should be extensible into a real product if later teams add integrations, expert-reviewed rule packs, and production UI.

---

# Extended scope & deep-reasoning extensions (v2)

> Added 2026-06-26 via deep domain research. **The single hardest, most-defining property of this project is not detecting interactions — it is detecting *useful* ones: a medication-safety engine that fires an alert a clinician will respect (severity-graded, evidence-cited, patient-contextualized, suppressible-with-memory) rather than one more dismissable popup in a world where ~90% of drug–drug interaction alerts are already overridden.** Every extension below serves that one thesis: an alert is a *false alarm by default* until the engine has earned the interruption.

## E0. The clinical reality this must respect (why a naive interaction checker is worse than nothing)

The defining empirical fact of this domain: drug–drug interaction (DDI) alerts in real clinical decision support are overridden ~90% of the time (a systematic review/meta-analysis put physician DDI-alert override at 90%, CI95 85–95%), and high-priority DDI override rates of 60–91% are reported across inpatient and outpatient settings ([Felisberto et al., systematic review/meta-analysis](https://journals.sagepub.com/doi/10.1177/14604582241263242); [high-priority DDI override appropriateness study, PMC7647273](https://pmc.ncbi.nlm.nih.gov/articles/PMC7647273/)). Worse, >50% of overrides are *clinically appropriate* — the alert was noise — yet inappropriate overrides cause ~6× more adverse drug events than appropriate ones ([PMC7647273](https://pmc.ncbi.nlm.nih.gov/articles/PMC7647273/)). The literature is explicit that many DDI alerts should be **non-interruptive** to reduce alert fatigue ([Phansalkar et al., PMC3628052](https://pmc.ncbi.nlm.nih.gov/articles/PMC3628052/)), and that specificity improves only when the engine considers **route, lab values, age, and patient context** — not just "drug A + drug B both present" ([PMC9218784](https://pmc.ncbi.nlm.nih.gov/articles/PMC9218784/)).

**Design consequence (the spine of this project):** alerting is a *signal-to-noise* problem, not a *coverage* problem. The engine must (a) grade severity into interruptive vs. passive tiers, (b) attach machine-checkable evidence to every alert, (c) incorporate patient context (route, renal function placeholder, age band, indication) so it can *suppress* an alert that the context defuses, and (d) remember per-patient/per-clinician suppressions with provenance so the same dismissed alert does not re-nag. The acceptance suite must prove **the engine fires the right alerts AND stays silent on the defused ones** — a checker that only proves "it fires on the textbook pair" has failed the actual brief.

## E1. Research-grounded domain authenticity (fold these real models in)

**Drug identity is a graph, not a string** ([RxNorm Technical Documentation](https://www.nlm.nih.gov/research/umls/rxnorm/docs/techdoc.html); [TTY appendix 5](https://www.nlm.nih.gov/research/umls/rxnorm/docs/appendix5.html)). Model the RxNorm term-type lattice as first-class typed concepts, because *every* safety rule keys off the right level of this graph:
- **IN** (Ingredient, e.g. Fluoxetine) and **PIN** (Precise Ingredient, salt/isomer, e.g. Fluoxetine Hydrochloride) — duplicate-active-ingredient and allergy rules key off IN/PIN.
- **MIN** (Multiple Ingredients) — combination products; a duplicate-therapy check must *decompose* a MIN into its ingredients or it will miss "patient on a combo pill + the same ingredient standalone."
- **SCDC** (ingredient + strength), **SCDF** (ingredient + dose form), **SCD** (Semantic Clinical Drug = ingredient + strength + dose form, e.g. *Acetaminophen 500 MG Oral Tablet*) — max-daily-dose math keys off SCD/SCDC strength.
- **SBD** (Semantic Branded Drug, e.g. *Tylenol 500 MG Oral Tablet*) and **BN** (Brand Name) — patient free text and brand names normalize *up* to SCD/IN before any rule runs.
- **NDC** packages map *up* to an RxCUI (a single NDC → one RxCUI; a RxCUI → many NDCs) — remaining-quantity/refill math starts from the dispensed NDC package size ([RxNorm FAQ](https://www.nlm.nih.gov/research/umls/rxnorm/faq.html)).
- **TMSY** (Tall-Man lettering) and look-alike/sound-alike (LASA) — a confusable-name surfacing rule is a real, cheap, high-value safety feature.

**The rules a real engine ships, grounded:**
- **Duplicate active ingredient** and **therapeutic-class duplication** (two drugs in the same class, e.g. two NSAIDs, two SSRIs) — class membership is itself reference data; decompose MINs first.
- **Drug–allergy with cross-reactivity**, *not* exact-match. Beta-lactam allergy is the canonical hard case: penicillin allergy implies all penicillins, but cross-reactivity *between* beta-lactam classes is driven by R1 **side-chain similarity**, not the shared beta-lactam ring — aminopenicillin↔aminocephalosporin cross-reactivity can exceed 30%, while penicillin↔aztreonam/carbapenem is <1% ([β-lactam cross-reactivity clinician guide, PMC7822086](https://pmc.ncbi.nlm.nih.gov/articles/PMC7822086/); [AAAAI Drug Allergy 2022 practice parameter](https://www.aaaai.org/Aaaai/media/Media-Library-PDFs/Allergist%20Resources/Statements%20and%20Practice%20Parameters/Drug-Allergy-2022.pdf)). So the allergy model needs a **cross-reactivity table keyed by side-chain group**, with graded likelihood — *the engine that just string-matches "penicillin" will both over- and under-warn.*
- **Max daily dose** with **unit normalization** — convert lb→kg (1 kg = 2.2 lb), reconcile mg vs mg/kg vs mg/kg/day vs mg/m², and fold the **frequency** in (a "10 mg q6h" is 40 mg/day) before comparing to the ceiling ([pediatric dosing, NBK541104 Clark's Rule](https://www.ncbi.nlm.nih.gov/books/NBK541104/); [Pharmaguideline age/weight/BSA dosing](https://www.pharmaguideline.com/2021/10/pediatric-dose-calculations.html)). Weight-based and renal-adjusted dosing are where unit bugs become overdoses; pediatric and renal patients are the highest-risk ([renal interval adjustment by GFR](https://www.droracle.ai/articles/534851/what-are-the-guidelines-for-pediatric-drug-dosing)).
- **Reconciliation as a discipline, not a diff.** Real med-rec is the **Best Possible Medication History (BPMH)** vs. orders, classifying each delta as an *intentional* (documented) vs. *unintentional* discrepancy — the MARQUIS work found 2.35–4.67 unintentional discrepancies per patient at baseline, most from **history errors** (~2.12/patient) rather than reconciliation errors (~1.23/patient) ([MARQUIS, PMC3698100](https://pmc.ncbi.nlm.nih.gov/articles/PMC3698100/); [MARQUIS2 site analysis, AHRQ PSNet](https://psnet.ahrq.gov/issue/what-works-medication-reconciliation-treatment-and-site-analysis-marquis2-study)). The Joint Commission has required med-rec at admission/transfer/discharge since 2005. So the reconciliation model must carry **source provenance** (imported list vs. patient-reported vs. clinician-approved) and a **discrepancy classification** (intentional-documented / intentional-undocumented / unintentional) — not just "in list A, not in list B."

**Interoperability shape (for the import/export adapter, deterministic fixtures only).** Mirror FHIR R4 `MedicationRequest`/`MedicationStatement`/`AllergyIntolerance` so the foundation can later speak real FHIR ([MedicationRequest R4](https://hl7.org/fhir/R4/medicationrequest.html); [MedicationStatement R4](https://www.hl7.org/fhir/R4/medicationstatement.html)). Specifically model: `status` (active|on-hold|stopped|completed|...), `intent` (order|plan|...), `dosageInstruction` → `Dosage` with `timing.repeat` (`frequency`, `period`, `periodUnit`, `boundsDuration`), `doseAndRate`, `route`, `asNeeded`; and `dispenseRequest` (`quantity`, `expectedSupplyDuration`, `numberOfRepeatsAllowed`) — refill-exhaustion forecasting is exactly `quantity` ÷ (daily dose from `timing`) anchored to the last fill date. Allergy substance should bind to RxNorm IN and to an allergen-class for cross-reactivity.

## E2. The hardest technical seams (where this stops being CRUD)

1. **The normalization boundary (everything depends on it).** Patient free text ("my little white water pill"), a brand name, an NDC on a bottle, and a clinician's SCD must all resolve to the same canonical concept *before* any rule fires — or rules silently miss. This is a typed adapter (`MedicationConceptResolver`) over a fixture RxNorm-shaped graph: text/brand/NDC → SCD → {IN…}. Ambiguous/unresolved input must be a **first-class state** (an unmatched item that *blocks* confident reconciliation and raises a "needs human identification" task), never a silent drop. This is the single most load-bearing module; build it first.
2. **The rule engine as typed, evidence-bearing, suppressible policy.** Each rule is a pure function `(PatientFacts, Regimen, ReferencePack) → Alert[]` where an `Alert` carries `{ruleId, severity, interruptive: boolean, evidence: EvidenceRef[], suppressible, suppressionScope, recommendedAction}`. Severity tiering (e.g. contraindicated / serious / moderate / informational) **decides interruptive vs. passive** — the engine must be able to *demote* an alert to passive based on context (route makes it irrelevant, lab placeholder in range, allergy is "intolerance" not "allergy"). Reference data (interaction pairs, class maps, cross-reactivity, dose ceilings) is a **versioned `ReferencePack`** with `source`, `version`, and `confidence`, never inline constants — so a future expert-reviewed pack swaps in without touching engine code.
3. **Dose arithmetic with explicit units (a correctness minefield).** A `Dose`/`Quantity` value type that *carries its unit* and refuses cross-unit comparison without an explicit, audited conversion. Frequency folding, weight/BSA basis, and renal interval adjustment all live here as pure, property-tested functions. A unit mismatch must be a type error or an explicit `UnitConversionRequired`, never a silent numeric coercion.
4. **Suppression memory with provenance (the anti-fatigue engine).** When a clinician dismisses an alert, record *who*, *when*, *scope* (this patient / this regimen / always-for-this-pair-by-this-clinician), and *reason*. Future evaluations consult this store and **demote or hide** matching alerts — but the suppression itself is an append-only audit fact with its own provenance, and a *severity ceiling* prevents suppressing a contraindication. This is the concrete mechanism that turns the 90%-override problem into a learning loop.
5. **Refill-exhaustion forecasting against a virtual clock.** `daysRemaining = remainingQuantity / dailyDose(schedule)`, anchored to last pharmacy fill date, adjusted for known clinician-ordered **holds/pauses**, projected forward on an **injected clock** so "runs out in 3 days" is deterministic and timezone-stable.

## E3. Determinism & testability strategy

- **No `Date.now()` / `setTimeout` anywhere.** All time (adherence windows, refill projection, suppression expiry, "overdue" tasks) flows from an injected `Clock`. Adherence summaries must be **byte-identical across timezones** when the test clock is fixed (this is already an acceptance criterion — make it a property, not an example): the same event log + same clock ⇒ same summary, for a battery of TZ offsets and DST boundaries.
- **Reference data is fixtures, versioned.** Ship a small deterministic `ReferencePack` (interaction pairs, therapeutic-class map, beta-lactam side-chain cross-reactivity table, dose ceilings, NDC→RxCUI→SCD→IN graph) **in the repo**, tagged with `version`/`source`/`confidence`. No live RxNorm/FDB/Medi-Span calls in `npm test`; the live drug DB is a *production adapter behind the same interface*. (`First Databank`/`Medi-Span` are the real-world commercial sources — name them as the production-adapter targets in the knowledge-debt ledger; do not fabricate their content.)
- **Append-only audit + event-sourced safety state.** Every reconciliation decision, alert fired/suppressed, and task created is an append-only event with provenance; the action queue and adherence calendar are *projections* over that log. This gives free traceability ("trace this task back to patient facts + rule evidence" is a graph walk that must terminate at source facts) and free time-travel for tests.
- **Seeded entropy** only if any ordering jitter exists; otherwise the system should be fully deterministic by construction.
- **The flagship test:** a multi-patient seed run that asserts (1) every fired alert is reproducible and evidence-grounded, (2) every *defused* alert stays silent, (3) every safety task traces to facts+evidence, (4) no money/PHI/network touched, (5) reconciliation provenance is total.

## E4. Adversarial, failure, and edge-case scenarios (ship these as fixtures)

Make these concrete, named test fixtures the engine must handle deterministically:
- **The combo-pill blind spot:** patient on a MIN (combination tablet) *and* a standalone of one of its ingredients → duplicate-ingredient alert must fire only after MIN decomposition. (A string checker misses it.)
- **The beta-lactam false alarm vs. true risk:** penicillin-allergic patient prescribed (a) aztreonam → *no* serious cross-reactivity alert (<1%), (b) an aminocephalosporin sharing the R1 side chain → graded cross-reactivity alert (>30%). The engine must distinguish these by side-chain group, not by "it's a beta-lactam."
- **The unit-trap overdose:** an order written in mg/kg/day for a patient whose weight is recorded in lb; the dose engine must convert and fold frequency, and flag the ceiling breach — and must *refuse* to compare across units silently.
- **The free-text ghost:** patient reports "a water pill and a blood-thinner" — unresolved concepts that must become *blocking* unmatched items + identification tasks, not be dropped, and must *not* be silently treated as "no interaction."
- **The alert-fatigue replay:** the same moderate DDI is dismissed by a clinician with scope "always for this pair"; on the next evaluation it is demoted to passive — but a *contraindicated* pair with an attempted "always suppress" is refused (severity ceiling).
- **The held-medication reconciliation:** a drug clinician-held (not stopped) must read as `held`, must not generate a refill task, and must not be reconciled away as "discontinued."
- **The refill cliff with a pause:** remaining quantity says 10 days, but a 7-day clinician hold is recorded → refill-exhaustion projection shifts; assert the new date deterministically.
- **The stale brand/NDC:** an NDC that maps to a repackaged equivalent must still resolve to the right SCD/IN so duplicate detection holds.

## E5. Rigorous acceptance criteria, including invariants (property-based)

Add these to the existing criteria as **property tests** over randomized + scripted patient fixtures:
1. **Evidence totality:** every `Alert` and every safety `Task` has a non-empty evidence chain that, traversed, terminates only at patient facts, regimen items, or named `ReferencePack` entries — never at a bare constant. (Redact all human-readable prose; the structured record alone must answer "why did this alert fire?")
2. **No-silent-drop (totality of reconciliation):** for every input item across imported/patient-reported/clinician-approved sources, the reconciliation output contains either an accepted item *or* a rejected/unmatched item *with* preserved source provenance. `inputs == accepted ⊎ rejected ⊎ unmatched`. Nothing vanishes.
3. **Unit soundness:** dose comparison never coerces across units; `assertNoCrossUnitCoercion` fuzz over random unit pairs. Round-trip lb↔kg and frequency-folding are property-checked.
4. **Suppression monotonicity & ceiling:** a suppression may only *lower or hold* an alert's interruptiveness, never raise severity; and no suppression can hide an alert above the contraindication ceiling. Fuzz it.
5. **Adherence determinism:** `summarize(events, clock)` is timezone-invariant and idempotent; two runs with the same clock yield byte-identical summaries across a battery of TZ/DST inputs.
6. **Refill monotonicity:** adding a clinician hold never *shortens* projected days-of-supply; removing remaining quantity never *lengthens* it.
7. **Patient-facing safety:** the plain-language summary generator provably never emits a raw internal risk score or anything phrased as diagnosis/treatment instruction (assert against a denylist of clinical-directive phrasings + a "no numeric internal score leaks" check).

## E6. The concrete first vertical slice (the on-ramp — build THIS first, ~12–16 cards)

Prove the spine end-to-end on the 5 seeded patients before any breadth:
1. **Typed domain model + stable IDs + append-only audit log** (patient, medication-as-concept, schedule, prescriber, pharmacy, caregiver, adherence-event).
2. **`MedicationConceptResolver`** over a fixture RxNorm-shaped graph (text/brand/NDC → SCD → {IN}), with the **unmatched-item blocking state**.
3. **`Dose`/`Quantity` value type** with unit-safe arithmetic + frequency folding + lb↔kg.
4. **Versioned `ReferencePack`** (interaction pairs, therapeutic-class map, beta-lactam side-chain cross-reactivity, dose ceilings).
5. **Rule engine** for the five required rules (duplicate ingredient, therapeutic-class duplication, max daily dose, allergy-with-cross-reactivity, simple contraindication note), each emitting **evidence-bearing, severity-tiered, interruptive-or-passive** alerts.
6. **Reconciliation workflow** producing the discrepancy classification with full provenance.
7. **Suppression memory** with provenance + severity ceiling.
8. **Adherence calendar** (taken/missed/skipped-by-instruction/held/unknown) + **refill-exhaustion forecast**, both on the injected clock.
9. **Task queue** (caregiver follow-up / clinician review / refill / education) where every task traces to facts+evidence.
10. **Plain-language patient summary** that leaks no internal score and no medical directive.
11. The **adversarial fixtures (E4)** all green; the **invariants (E5)** all green; `npm test` with zero network.

If that slice holds, screens are pure projection over a proven, evidence-grounded core.

## E7. Domain knowledge-debt to track (surface, don't bluff)

Maintain a live, *action-gating* knowledge-debt ledger (each item: owner, risk, "trigger that forces resolution," expert-review-needed flag):
- **Reference content is licensed and expert-curated.** The fixture interaction/class/cross-reactivity/dose data is an *illustrative deterministic subset*, **not** clinical truth; real deployments license `First Databank (FDB)`/`Medi-Span`/`Multum` and require pharmacist sign-off. Mark every ReferencePack entry with `confidence` and an `expertReviewNeeded` flag; **block** any "this is clinically validated" claim until signed off.
- **Beta-lactam cross-reactivity is an active, evolving area** — recent evidence says historical estimates over-stated cross-reactivity ([PMC7822086](https://pmc.ncbi.nlm.nih.gov/articles/PMC7822086/)); the side-chain table is a starting model needing allergist review, and suppressing cross-sensitivity alerts needs balancing measures ([PMC12791359](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12791359/)).
- **RxNorm/NDC mapping has real ambiguity** (obsolete NDCs, repackagers, multi-RxCUI edge cases) — the resolver's "unmatched/ambiguous" path is a feature, and its limits are debt.
- **Renal/hepatic/pregnancy/age dose adjustment** is modeled only as a placeholder hook; real adjustment needs lab integration (eGFR) and pharmacist rules.
- **Scope of practice / regulatory:** this is *decision support*, not prescribing or diagnosis; the plain-language boundary and the "never present generated content as diagnosis/treatment" rule are legal/safety constraints, not stylistic ones.

## E8. Why this is a great !Klein challenge

It looks like a tier-1 CRUD app and is secretly a *signal-quality* problem under weak models. It stresses: **deterministic, evidence-grounded reasoning** (every alert must be explainable from typed facts, which is exactly what keeps a small/quantized model honest — it can't bluff an evidence chain); **typed-units discipline** (where weak models love to silently coerce); a **normalization-graph seam** that punishes hand-waving; and a **suppression/learning loop** that turns the real-world alert-fatigue failure mode into a testable invariant. The win condition is not "more alerts" — it is a system that *earns* each interruption, which is precisely the discipline that makes a fallible model safe and useful in a life-safety domain. Build the resolver + dose-units + evidence-bearing rule engine first; the rest is projection.
