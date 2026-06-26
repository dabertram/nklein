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

---

## Small-model build guide (3B-ready)

> This section is a mechanical build guide for a ~3B-parameter model running via !Klein. Every card is small enough to implement and verify in isolation. Follow the cards in order; never skip a dependency. The parent section (E6) listed 11 high-level steps; this guide expands the first vertical slice into 14 small cards (S01–S14) and gives repeatable recipes for the remaining breadth.

---

### 1. Glossary & ground rules

**Domain terms**

| Term | Meaning in this project |
|---|---|
| IN | RxNorm Ingredient concept (e.g. Fluoxetine). Duplicate-ingredient and allergy rules key off IN. |
| PIN | Precise Ingredient (salt/isomer form, e.g. Fluoxetine Hydrochloride). Child of IN. |
| MIN | Multiple Ingredients — a combination product. Must be decomposed into its constituent INs before any rule runs. |
| SCD | Semantic Clinical Drug = ingredient + strength + dose form (e.g. "Acetaminophen 500 MG Oral Tablet"). Max-dose math keys off SCD. |
| SBD | Semantic Branded Drug (e.g. "Tylenol 500 MG Oral Tablet"). Patient/brand names normalize up to SCD then IN. |
| NDC | National Drug Code package identifier. Maps one-to-one to an RxCUI which maps to an SCD. |
| RxCUI | RxNorm concept unique identifier. The stable pivot for all normalization. |
| BPMH | Best Possible Medication History. The reconciliation input from patient interview. |
| DDI | Drug–Drug Interaction. |
| Alert | A typed, evidence-bearing, severity-graded output of the rule engine. Always suppressible (within ceiling). |
| ReferencePack | Versioned bundle of reference data: interaction pairs, class map, cross-reactivity table, dose ceilings. Never inline constants. |
| Clock | An injected interface `{ now(): Date }`. Every time-dependent calculation reads this, never `Date.now()`. |
| Suppression | A recorded clinician decision to demote/hide an alert, with provenance and a severity ceiling above which suppression is refused. |
| Reconciliation | Comparing imported, patient-reported, and clinician-approved medication lists and classifying each delta as intentional or unintentional discrepancy. |
| AuditEvent | An append-only record of every safety decision: reconciliation, alert fired/suppressed, task created. Never mutated or deleted. |

**Stack**

- Language: TypeScript (strict mode, no `any`).
- Runtime: Node.js.
- Test runner: Vitest (or Jest; whatever `npm test` is wired to in the project root).
- Assertion style: `expect(x).toBe(y)` / `expect(x).toEqual(y)`.
- No external runtime dependencies beyond the project's own `package.json`. No live APIs, no network in tests.
- All fixtures live under `src/fixtures/` as plain TypeScript objects exported from `.ts` files.

**Acceptance command (run after every card)**

```
npm test
```

Must exit 0. Zero network calls. No randomness. Deterministic on any machine.

**Determinism rules (imperative)**

1. Never call `Date.now()`, `new Date()` with no argument, or `Math.random()` in any production module.
2. All time reads go through the injected `Clock` interface defined in `src/core/clock.ts`.
3. All reference data lives in `src/fixtures/reference-pack.ts`; no inline numeric constants for dose ceilings, interaction pairs, or class memberships.
4. Audit events are appended to an in-memory array; tests assert the full array, not just the last entry.
5. Sort any collection before asserting its contents so insertion-order variance does not break tests.

---

### 2. The explicit task graph for the first vertical slice

The first slice covers E6 steps 1–11. Cards S01–S14 below implement them in strict dependency order.

---

**S01 — Core type definitions**
dependsOn: none
files: `src/core/types.ts`

interface (write these exact exports):
```ts
export type PatientId = string & { readonly __brand: 'PatientId' };
export type MedicationConceptId = string & { readonly __brand: 'MedicationConceptId' };
export type PrescriberId = string & { readonly __brand: 'PrescriberId' };
export type PharmacyId = string & { readonly __brand: 'PharmacyId' };
export type CaregiverId = string & { readonly __brand: 'CaregiverId' };
export type RuleId = string & { readonly __brand: 'RuleId' };
export type ReferencePack = {
  version: string;
  source: string;
  confidence: 'illustrative' | 'expert-reviewed';
  interactions: InteractionPair[];
  therapeuticClasses: TherapeuticClassEntry[];
  betaLactamSideChains: BetaLactamSideChainEntry[];
  doseCeilings: DoseCeiling[];
  rxNormGraph: RxNormNode[];
};
export type InteractionPair = { drugA: MedicationConceptId; drugB: MedicationConceptId; severity: AlertSeverity; evidence: string };
export type TherapeuticClassEntry = { className: string; members: MedicationConceptId[] };
export type BetaLactamSideChainEntry = { drug: MedicationConceptId; sideChainGroup: string; crossReactivityRisk: 'low' | 'moderate' | 'high' };
export type DoseCeiling = { ingredient: MedicationConceptId; maxDailyMg: number; source: string };
export type RxNormNode = { rxcui: MedicationConceptId; termType: 'IN' | 'PIN' | 'MIN' | 'SCD' | 'SBD' | 'BN' | 'NDC'; name: string; parentRxcuis: MedicationConceptId[]; ingredients?: MedicationConceptId[] };
export type AlertSeverity = 'contraindicated' | 'serious' | 'moderate' | 'informational';
export type DiscrepancyClass = 'intentional-documented' | 'intentional-undocumented' | 'unintentional';
export type AdherenceState = 'taken' | 'missed' | 'skipped-by-instruction' | 'held-by-clinician' | 'unknown';
export type TaskType = 'caregiver-follow-up' | 'clinician-review' | 'refill-request' | 'patient-education';
```

how to implement:
1. Create `src/core/types.ts`.
2. Copy the exact type definitions above; do not alter names or shapes.
3. Add any missing import-style aliases the rest of the project will need (all IDs are branded strings using the `& { readonly __brand: '...' }` pattern to prevent cross-assignment).
4. Export everything at the file level (no default exports).

acceptance: `test/types.test.ts` — compile-only test. Create the file, import every type, assign a literal value of each to a typed variable, run `npm test`. If TypeScript does not error, the card is done. No runtime assertions needed.

---

**S02 — Injected Clock interface**
dependsOn: S01
files: `src/core/clock.ts`, `src/core/fixed-clock.ts`, `test/fixed-clock.test.ts`

interface:
```ts
// src/core/clock.ts
export interface Clock { now(): Date; }

// src/core/fixed-clock.ts
export class FixedClock implements Clock {
  constructor(private readonly fixedTime: Date) {}
  now(): Date { return new Date(this.fixedTime.getTime()); }
}
```

how to implement:
1. Create `src/core/clock.ts` with the `Clock` interface.
2. Create `src/core/fixed-clock.ts` with `FixedClock` that always returns a clone of the fixed time.
3. Create `test/fixed-clock.test.ts`.

acceptance: `test/fixed-clock.test.ts` asserts:
- `new FixedClock(new Date('2025-01-15T08:00:00Z')).now().toISOString() === '2025-01-15T08:00:00.000Z'`
- Two calls to `.now()` on the same instance return equal values but different object references (cloned, not the same object).
Run `npm test` → green.

---

**S03 — Dose/Quantity value type with unit-safe arithmetic**
dependsOn: S01, S02
files: `src/core/dose.ts`, `test/dose.test.ts`

interface:
```ts
export type DoseUnit = 'mg' | 'mg/kg' | 'mg/kg/day' | 'mg/m2' | 'mcg' | 'g';
export type FrequencyUnit = 'daily' | 'twice-daily' | 'three-times-daily' | 'four-times-daily' | 'every-6h' | 'every-8h' | 'every-12h' | 'as-needed';
export type WeightUnit = 'kg' | 'lb';

export type Quantity = { value: number; unit: DoseUnit };
export type Weight = { value: number; unit: WeightUnit };

// Convert weight to kg (1 kg = 2.2 lb). Returns a new Weight in kg.
export function toKg(w: Weight): Weight;

// Convert frequency to a daily multiplier.
// 'daily'→1, 'twice-daily'→2, 'three-times-daily'→3, 'four-times-daily'→4,
// 'every-6h'→4, 'every-8h'→3, 'every-12h'→2, 'as-needed'→null (cannot fold)
export function frequencyToDailyMultiplier(f: FrequencyUnit): number | null;

// Compute total daily dose in mg, given dose per-administration, frequency, and optional patient weight.
// Throws UnitMismatchError if the dose unit requires weight but no weight is provided.
// Returns null if frequency is 'as-needed'.
export function dailyDoseMg(dose: Quantity, freq: FrequencyUnit, weightKg?: number): number | null;

export class UnitMismatchError extends Error { constructor(message: string) { super(message); this.name = 'UnitMismatchError'; } }
```

how to implement:
1. Create `src/core/dose.ts`.
2. Implement `toKg`: if `unit === 'lb'` return `{ value: w.value / 2.2, unit: 'kg' }`; else return a copy.
3. Implement `frequencyToDailyMultiplier` as a switch/map with the values above.
4. Implement `dailyDoseMg`:
   - If freq is `'as-needed'` return `null`.
   - Get multiplier from `frequencyToDailyMultiplier`.
   - If unit is `'mg/kg'` or `'mg/kg/day'`, require `weightKg`; if missing, throw `UnitMismatchError('weight required for mg/kg dosing')`.
   - Convert: `mg/kg` → `dose.value * weightKg * multiplier`; `mg/kg/day` → `dose.value * weightKg * 1` (multiplier already folded in "per day"); `mg` → `dose.value * multiplier`; `mcg` → `dose.value * multiplier / 1000`; `g` → `dose.value * multiplier * 1000`.
   - Do not accept cross-unit comparisons silently; any unit you cannot handle should throw `UnitMismatchError`.
5. Create `test/dose.test.ts`.

acceptance: `test/dose.test.ts` asserts (all deterministic, no I/O):
- `toKg({ value: 220, unit: 'lb' }).value` is approximately `100` (within 0.01).
- `frequencyToDailyMultiplier('every-6h') === 4`.
- `dailyDoseMg({ value: 500, unit: 'mg' }, 'four-times-daily') === 2000`.
- `dailyDoseMg({ value: 10, unit: 'mg/kg' }, 'twice-daily', 70) === 1400`.
- `dailyDoseMg({ value: 10, unit: 'mg/kg' }, 'twice-daily')` throws `UnitMismatchError`.
- `dailyDoseMg({ value: 5, unit: 'mg' }, 'as-needed') === null`.
Run `npm test` → green.

---

**S04 — RxNorm fixture graph + MedicationConceptResolver**
dependsOn: S01, S03
files: `src/fixtures/rxnorm-graph.ts`, `src/core/medication-concept-resolver.ts`, `test/medication-concept-resolver.test.ts`

interface:
```ts
// src/core/medication-concept-resolver.ts
export type ResolvedConcept = { rxcui: MedicationConceptId; termType: RxNormNode['termType']; name: string; ingredients: MedicationConceptId[] };
export type UnmatchedConcept = { inputText: string; reason: 'not-found' | 'ambiguous'; blocksReconciliation: true };
export type ResolutionResult = { matched: ResolvedConcept } | { unmatched: UnmatchedConcept };

export class MedicationConceptResolver {
  constructor(private readonly graph: RxNormNode[]) {}
  // Resolve by RxCUI (exact), brand name (case-insensitive), free text (case-insensitive fuzzy), or NDC code.
  resolve(input: string): ResolutionResult;
  // Given an SCD/SBD/MIN rxcui, return the set of IN-level rxcuis (decompose MIN → its ingredients).
  getIngredients(rxcui: MedicationConceptId): MedicationConceptId[];
}
```

how to implement:
1. Create `src/fixtures/rxnorm-graph.ts` with a small, fully explicit `RxNormNode[]` fixture. Include at minimum:
   - Fluoxetine (IN), Fluoxetine Hydrochloride (PIN), Fluoxetine 20 MG Oral Capsule (SCD), Prozac (SBD/BN).
   - Acetaminophen (IN), Acetaminophen 500 MG Oral Tablet (SCD), Tylenol (SBD/BN).
   - A combination MIN: "Acetaminophen/Hydrocodone" whose `ingredients` list includes both Acetaminophen and Hydrocodone INs.
   - Hydrocodone (IN), Hydrocodone 5 MG Oral Tablet (SCD).
   - Amoxicillin (IN, beta-lactam), Amoxicillin 500 MG Oral Capsule (SCD).
   - Cephalexin (IN, beta-lactam aminocephalosporin), Cephalexin 500 MG Oral Capsule (SCD).
   - Aztreonam (IN, monobactam), Aztreonam 1 G Injectable (SCD).
   - An "unknown free text" entry is not in the graph (by design — the resolver must return `unmatched`).
2. Create `src/core/medication-concept-resolver.ts`. The `resolve` method:
   - Exact rxcui match first.
   - Then case-insensitive name match.
   - Then case-insensitive substring match.
   - If no match: return `{ unmatched: { inputText: input, reason: 'not-found', blocksReconciliation: true } }`.
   - If multiple substring matches with the same confidence: return `{ unmatched: { inputText: input, reason: 'ambiguous', blocksReconciliation: true } }`.
3. The `getIngredients` method walks the graph: if the node is an IN return `[rxcui]`; if it is a MIN/SCD/SBD walk `parentRxcuis` and `ingredients` up to IN nodes.
4. Create `test/medication-concept-resolver.test.ts`.

acceptance:
- `resolver.resolve('Tylenol')` returns a matched concept with `termType === 'SBD'` or `'BN'`.
- `resolver.resolve('fluoxetine 20 mg oral capsule')` (case-insensitive) returns the SCD.
- `resolver.resolve('a water pill')` returns `unmatched` with `blocksReconciliation: true`.
- `resolver.getIngredients(minRxcui)` for the combo MIN returns both Acetaminophen and Hydrocodone ingredient IDs.
Run `npm test` → green.

---

**S05 — Versioned ReferencePack fixture**
dependsOn: S01, S04
files: `src/fixtures/reference-pack.ts`, `test/reference-pack.test.ts`

interface:
```ts
// Exported constant of type ReferencePack (from S01 types)
export const FIXTURE_REFERENCE_PACK: ReferencePack;
```

how to implement:
1. Create `src/fixtures/reference-pack.ts`.
2. Populate `FIXTURE_REFERENCE_PACK` with:
   - `version: '0.1.0-fixture'`, `source: 'illustrative-fixture'`, `confidence: 'illustrative'`.
   - At least one `interactions` pair (e.g. Fluoxetine IN + Hydrocodone IN → `severity: 'serious'`, evidence string citing serotonin syndrome risk).
   - At least two `therapeuticClasses` entries: one for SSRIs (Fluoxetine IN), one for opioids (Hydrocodone IN).
   - `betaLactamSideChains` for Amoxicillin (`sideChainGroup: 'aminopenicillin'`, `crossReactivityRisk: 'high'`), Cephalexin (`sideChainGroup: 'aminocephalosporin'`, `crossReactivityRisk: 'moderate'`), Aztreonam (`sideChainGroup: 'monobactam'`, `crossReactivityRisk: 'low'`).
   - `doseCeilings` for Acetaminophen IN → `maxDailyMg: 4000`, source `'FDA label'`.
3. Create `test/reference-pack.test.ts`.

acceptance:
- `FIXTURE_REFERENCE_PACK.confidence === 'illustrative'`.
- `FIXTURE_REFERENCE_PACK.interactions.length >= 1`.
- `FIXTURE_REFERENCE_PACK.betaLactamSideChains.find(e => e.drug === aztreonamId)?.crossReactivityRisk === 'low'`.
- `FIXTURE_REFERENCE_PACK.doseCeilings.find(e => e.ingredient === acetaminophenId)?.maxDailyMg === 4000`.
Run `npm test` → green.

---

**S06 — Append-only AuditLog**
dependsOn: S01, S02
files: `src/core/audit-log.ts`, `test/audit-log.test.ts`

interface:
```ts
export type AuditEventType = 'reconciliation-decision' | 'alert-fired' | 'alert-suppressed' | 'task-created' | 'adherence-recorded';
export type AuditEvent = {
  id: string;
  type: AuditEventType;
  occurredAt: Date;
  patientId: PatientId;
  actorId: string;
  payload: Record<string, unknown>;
};

export class AuditLog {
  private readonly events: AuditEvent[] = [];
  append(event: Omit<AuditEvent, 'id'>): AuditEvent; // assigns a sequential id, pushes, returns the event
  getAll(): readonly AuditEvent[];
  getByPatient(patientId: PatientId): readonly AuditEvent[];
}
```

how to implement:
1. Create `src/core/audit-log.ts`.
2. `append` assigns an id using a simple counter (e.g. `String(++this.counter)`) so IDs are deterministic across test runs.
3. `getAll` returns a readonly copy.
4. `getByPatient` filters by `patientId`.
5. Create `test/audit-log.test.ts`.

acceptance:
- Appending two events produces ids `'1'` and `'2'` (or similar deterministic sequence).
- `getAll()` returns both in insertion order.
- `getByPatient(patientId)` returns only that patient's events.
- Mutating the returned array does not affect the internal state (return a spread or slice).
Run `npm test` → green.

---

**S07 — Rule engine (five rules, evidence-bearing alerts)**
dependsOn: S01, S03, S04, S05, S06
files: `src/core/rule-engine.ts`, `test/rule-engine.test.ts`

interface:
```ts
export type EvidenceRef = { packVersion: string; source: string; description: string };
export type Alert = {
  ruleId: RuleId;
  severity: AlertSeverity;
  interruptive: boolean;    // true for 'contraindicated' | 'serious'; false otherwise
  evidence: EvidenceRef[];
  suppressible: boolean;    // false only for 'contraindicated'
  suppressionScope: 'this-patient' | 'always-for-pair' | null;
  recommendedAction: string;
  involvedDrugs: MedicationConceptId[];
};

export type PatientFacts = {
  patientId: PatientId;
  weightKg?: number;
  allergyIngredients: MedicationConceptId[];    // IN-level
  allergyClasses: string[];                     // e.g. 'penicillin'
};

export type RegimenItem = {
  conceptId: MedicationConceptId;    // may be MIN, SCD, SBD — resolver normalizes before rules
  resolvedIngredients: MedicationConceptId[];    // already decomposed to INs
  dose: Quantity;
  frequency: FrequencyUnit;
  status: 'active' | 'held' | 'stopped';
};

// Pure function: (facts, regimen, pack) → Alert[]
export function evaluateRules(facts: PatientFacts, regimen: RegimenItem[], pack: ReferencePack): Alert[];
```

The five rules to implement inside `evaluateRules`:
1. **duplicate-ingredient** (`ruleId: 'dup-ingredient'`): if two active regimen items share an IN after decomposition, fire `severity: 'moderate'`.
2. **therapeutic-class-duplication** (`ruleId: 'dup-class'`): if two active items share a therapeutic class in the ReferencePack, fire `severity: 'informational'`.
3. **max-daily-dose** (`ruleId: 'max-dose'`): for each active item, compute daily dose in mg via S03 `dailyDoseMg`; if it exceeds the pack's `doseCeilings` for that ingredient, fire `severity: 'serious'`.
4. **allergy-conflict** (`ruleId: 'allergy'`): for each active item, check allergyIngredients for exact IN match; also check beta-lactam cross-reactivity from pack. Exact match → `severity: 'serious'`. Cross-reactivity by side-chain: `high` → `'serious'`, `moderate` → `'moderate'`, `low` → `'informational'`.
5. **contraindication** (`ruleId: 'contraindication'`): check pack `interactions` for the pair; if severity in pack is `'contraindicated'`, fire with `severity: 'contraindicated'`, `suppressible: false`.

`interruptive` is derived: true if `severity === 'contraindicated' || severity === 'serious'`.
All alerts carry `evidence: [{ packVersion: pack.version, source: pack.source, description: '...' }]`.

how to implement:
1. Create `src/core/rule-engine.ts`.
2. Filter regimen to only `status: 'active'` items before applying rules.
3. For each rule, collect all matching item pairs or single items, build an `Alert` for each finding.
4. Return the full array; callers filter/suppress separately.
5. Create `test/rule-engine.test.ts` using the fixture reference pack.

acceptance (in `test/rule-engine.test.ts`):
- Regimen with two active SSRI items → alert with `ruleId: 'dup-class'`.
- Regimen with Acetaminophen 6000 mg/day (well above 4000 mg ceiling) → alert with `ruleId: 'max-dose'`, `severity: 'serious'`.
- Patient with penicillin allergy (Amoxicillin IN in `allergyIngredients`) prescribed Amoxicillin → alert with `ruleId: 'allergy'`, `severity: 'serious'`.
- Patient with Amoxicillin allergy prescribed Cephalexin (same side-chain group 'aminocephalosporin') → cross-reactivity alert `severity: 'moderate'`.
- Patient with Amoxicillin allergy prescribed Aztreonam (side-chain 'monobactam') → alert `severity: 'informational'` (low cross-reactivity), NOT 'serious'.
- Fluoxetine + Hydrocodone (from fixture interaction pair) → alert with `ruleId: 'contraindication'`, `suppressible: false`.
- A held medication does NOT trigger any alerts.
- Every alert has `evidence.length >= 1`.
Run `npm test` → green.

---

**S08 — Suppression memory with severity ceiling**
dependsOn: S01, S06, S07
files: `src/core/suppression-store.ts`, `test/suppression-store.test.ts`

interface:
```ts
export type SuppressionRecord = {
  id: string;
  ruleId: RuleId;
  involvedDrugs: MedicationConceptId[];
  scope: 'this-patient' | 'always-for-pair';
  suppressedBy: string;          // actor id
  suppressedAt: Date;
  reason: string;
  patientId?: PatientId;         // required when scope === 'this-patient'
};

export class SuppressionStore {
  private readonly records: SuppressionRecord[] = [];
  // Record a new suppression. Throws SuppressionCeilingError if alert.severity === 'contraindicated'.
  record(alert: Alert, scope: SuppressionRecord['scope'], suppressedBy: string, reason: string, patientId: PatientId | undefined, clock: Clock): SuppressionRecord;
  // Given an alert, return whether it is currently suppressed for this patient.
  isSuppressed(alert: Alert, patientId: PatientId): boolean;
  getAll(): readonly SuppressionRecord[];
}

export class SuppressionCeilingError extends Error {}
```

how to implement:
1. Create `src/core/suppression-store.ts`.
2. `record`: if `alert.severity === 'contraindicated'` throw `SuppressionCeilingError('contraindicated alerts cannot be suppressed')`.
3. Store the record with a deterministic id (counter).
4. `isSuppressed`: check records — if any record matches `ruleId` AND `involvedDrugs` (sorted set equality) AND (scope is `always-for-pair` OR scope is `this-patient` AND `record.patientId === patientId`) → return `true`.
5. Create `test/suppression-store.test.ts`.

acceptance:
- Record a suppression for a `'moderate'` alert → `isSuppressed` returns true for the same patient.
- Attempt to record a suppression for a `'contraindicated'` alert → throws `SuppressionCeilingError`.
- `isSuppressed` with a different patient id (scope `this-patient`) → returns false.
- After recording scope `always-for-pair`, `isSuppressed` returns true for any patient.
Run `npm test` → green.

---

**S09 — Medication reconciliation workflow**
dependsOn: S01, S04, S06
files: `src/core/reconciliation.ts`, `test/reconciliation.test.ts`

interface:
```ts
export type MedicationSource = 'imported' | 'patient-reported' | 'clinician-approved';
export type ReconciliationItem = {
  conceptId: MedicationConceptId | null;    // null if unmatched
  inputText: string;
  source: MedicationSource;
  provenance: { importedAt: Date; importedBy: string };
};
export type ReconciliationOutput = {
  accepted: ReconciliationItem[];   // in clinician-approved
  rejected: ReconciliationItem[];   // explicitly rejected by clinician
  unmatched: ReconciliationItem[];  // resolution failed; blocks confident reconciliation
  discrepancies: Discrepancy[];
};
export type Discrepancy = {
  item: ReconciliationItem;
  classification: DiscrepancyClass;
  reason?: string;
};

// Pure function: take all source items, resolve concepts, compute output.
export function reconcile(
  items: ReconciliationItem[],
  resolver: MedicationConceptResolver,
  clinicianApprovedIds: MedicationConceptId[],
  clock: Clock
): ReconciliationOutput;
```

how to implement:
1. Create `src/core/reconciliation.ts`.
2. For each item in `items`, call `resolver.resolve(item.inputText)`. If unmatched, put in `unmatched`.
3. A matched item whose resolved ID is in `clinicianApprovedIds` → `accepted`.
4. A matched item present in `imported` or `patient-reported` but absent from `clinicianApprovedIds` → `rejected` with a discrepancy record.
5. Classify discrepancies: an item present in `clinician-approved` but absent from all `imported` sources → `intentional-documented`. An item present in `imported` but absent from `clinician-approved` without explicit rejection note → `unintentional`. (For the fixture, classify conservatively as `unintentional` when in doubt.)
6. The invariant `inputs === accepted ⊎ rejected ⊎ unmatched` must hold: every input appears in exactly one output list.
7. Create `test/reconciliation.test.ts`.

acceptance:
- All inputs appear in exactly one output list (no item dropped, no item duplicated).
- A free-text item `'a water pill'` ends up in `unmatched` with `blocksReconciliation: true`.
- An item present in imported list but not in clinician-approved ends up in `rejected` with a discrepancy.
- A clinician-approved item not in any imported source creates an `intentional-documented` discrepancy.
Run `npm test` → green.

---

**S10 — Adherence calendar**
dependsOn: S01, S02, S06
files: `src/core/adherence-calendar.ts`, `test/adherence-calendar.test.ts`

interface:
```ts
export type AdherenceEvent = {
  patientId: PatientId;
  conceptId: MedicationConceptId;
  scheduledAt: Date;
  state: AdherenceState;
  recordedAt: Date;
  recordedBy: string;
};

// Returns a summary of adherence for a patient's medication between start and end on the given clock.
export type AdherenceSummary = {
  patientId: PatientId;
  conceptId: MedicationConceptId;
  periodStart: Date;
  periodEnd: Date;
  taken: number;
  missed: number;
  skippedByInstruction: number;
  heldByClinician: number;
  unknown: number;
  total: number;
};

export function summarizeAdherence(
  events: AdherenceEvent[],
  patientId: PatientId,
  conceptId: MedicationConceptId,
  periodStart: Date,
  periodEnd: Date
): AdherenceSummary;
```

how to implement:
1. Create `src/core/adherence-calendar.ts`.
2. Filter events to `patientId`, `conceptId`, and events whose `scheduledAt` is within `[periodStart, periodEnd)`.
3. Count each state. `total` is the count of all matching events.
4. Return the `AdherenceSummary`. All values are counts; no floating-point percentages.
5. Create `test/adherence-calendar.test.ts` with a fixed set of events and a fixed period (no `Date.now()`).

acceptance:
- A set of 10 events (4 taken, 3 missed, 2 held, 1 unknown) → summary counts match exactly.
- Running the same function twice with the same arguments returns deeply-equal results (determinism).
- Events outside the period are excluded.
Run `npm test` → green.

---

**S11 — Refill-exhaustion forecast**
dependsOn: S01, S02, S03, S10
files: `src/core/refill-forecast.ts`, `test/refill-forecast.test.ts`

interface:
```ts
export type RefillForecast = {
  conceptId: MedicationConceptId;
  lastFillDate: Date;
  remainingQuantityMg: number;
  dailyDoseMg: number | null;
  knownHoldDays: number;
  projectedExhaustionDate: Date | null;   // null if dailyDoseMg is null (as-needed)
  daysUntilExhaustion: number | null;
  isAtRisk: boolean;    // true if daysUntilExhaustion != null && daysUntilExhaustion <= 7
};

export function forecastRefill(
  conceptId: MedicationConceptId,
  lastFillDate: Date,
  remainingQuantityMg: number,
  dose: Quantity,
  frequency: FrequencyUnit,
  knownHoldDays: number,
  clock: Clock,
  weightKg?: number
): RefillForecast;
```

how to implement:
1. Create `src/core/refill-forecast.ts`.
2. Compute `dailyDoseMg` using S03's function; if null (as-needed), set `projectedExhaustionDate: null`, `daysUntilExhaustion: null`, `isAtRisk: false`.
3. `effectiveRemainingMg = remainingQuantityMg` — the hold days shift the exhaustion date forward (a held medication is not consumed), so adjust: `adjustedRemaining = remainingQuantityMg + knownHoldDays * dailyDoseMg`.
4. `daysOfSupply = adjustedRemaining / dailyDoseMg`.
5. `projectedExhaustionDate = new Date(lastFillDate.getTime() + daysOfSupply * 86400000)`.
6. `daysUntilExhaustion = (projectedExhaustionDate.getTime() - clock.now().getTime()) / 86400000`, rounded down.
7. `isAtRisk = daysUntilExhaustion != null && daysUntilExhaustion <= 7`.
8. Create `test/refill-forecast.test.ts` — use `FixedClock` from S02.

acceptance:
- 100 mg remaining, 10 mg/day, no holds, clock at lastFillDate+5days → `daysUntilExhaustion` is approximately 5 (100/10 = 10 days supply, 5 elapsed → 5 remaining).
- Adding `knownHoldDays: 7` shifts `projectedExhaustionDate` 7 days later.
- `isAtRisk` is true when `daysUntilExhaustion <= 7`.
- `forecastRefill` with `'as-needed'` frequency returns `projectedExhaustionDate: null`.
Run `npm test` → green.

---

**S12 — Task queue**
dependsOn: S01, S06, S07, S08, S11
files: `src/core/task-queue.ts`, `test/task-queue.test.ts`

interface:
```ts
export type SafetyTask = {
  id: string;
  type: TaskType;
  patientId: PatientId;
  createdAt: Date;
  evidenceAlertId?: string;          // references an Alert's ruleId
  evidenceRefillForecastId?: string; // references a refill forecast
  description: string;
  traceToFacts: string[];            // list of PatientFacts/RegimenItem fields that caused this
};

export class TaskQueue {
  private readonly tasks: SafetyTask[] = [];
  createFromAlert(alert: Alert, patientId: PatientId, clock: Clock, auditLog: AuditLog): SafetyTask;
  createFromRefillRisk(forecast: RefillForecast, patientId: PatientId, clock: Clock, auditLog: AuditLog): SafetyTask;
  getAll(): readonly SafetyTask[];
  getByPatient(patientId: PatientId): readonly SafetyTask[];
}
```

how to implement:
1. Create `src/core/task-queue.ts`.
2. `createFromAlert`: map alert severity and rule to a TaskType (`'contraindication'/'serious' → 'clinician-review'`, `'moderate' → 'caregiver-follow-up'`, `'informational' → 'patient-education'`). Set `traceToFacts` to `alert.involvedDrugs` as strings. Append an `AuditEvent` of type `'task-created'` to `auditLog`.
3. `createFromRefillRisk`: if `forecast.isAtRisk`, create a `'refill-request'` task. Append to `auditLog`.
4. Both methods assign deterministic IDs (counter).
5. Create `test/task-queue.test.ts`.

acceptance:
- A `'serious'` alert produces a `'clinician-review'` task.
- A refill-at-risk forecast produces a `'refill-request'` task.
- Each created task produces exactly one `AuditEvent` in the auditLog.
- `traceToFacts` is non-empty (the task traces back to evidence).
Run `npm test` → green.

---

**S13 — Patient-facing plain-language summary**
dependsOn: S01, S07, S08, S10, S12
files: `src/core/patient-summary.ts`, `test/patient-summary.test.ts`

interface:
```ts
export type PatientSummary = {
  patientId: PatientId;
  generatedAt: Date;
  activeCount: number;
  adherenceNote: string;   // e.g. "You took 8 of 10 scheduled doses this week."
  refillReminders: string[];  // e.g. "Acetaminophen may run low in 5 days. Contact your pharmacy."
  tasks: string[];         // plain-language description of open caregiver/patient-education tasks
};

// Denylist: the summary generator must NEVER emit these patterns.
export const SUMMARY_DENYLIST = [
  /\b\d+(\.\d+)?\s*(mg|mcg|g|score|risk|level)\b/i,  // no raw numeric scores
  /\b(diagnos|treat|prescri|medic(at)?e|administer)\b/i, // no clinical directive verbs
];

export function generatePatientSummary(
  patientId: PatientId,
  regimen: RegimenItem[],
  adherenceSummary: AdherenceSummary,
  forecasts: RefillForecast[],
  openTasks: SafetyTask[],
  clock: Clock
): PatientSummary;
```

how to implement:
1. Create `src/core/patient-summary.ts`.
2. `activeCount = regimen.filter(r => r.status === 'active').length`.
3. Build `adherenceNote` from the adherence summary counts — plain English only, no numbers that are raw scores.
4. Build `refillReminders` from `forecasts` where `isAtRisk === true` — use the concept name if available, otherwise the conceptId.
5. Build `tasks` from `openTasks` of type `'caregiver-follow-up'` or `'patient-education'` only — do not expose `'clinician-review'` tasks to the patient.
6. Before returning, run a check: for each text field and array, assert no match against any pattern in `SUMMARY_DENYLIST`; if any match is found throw `Error('summary contains prohibited content')`.
7. Create `test/patient-summary.test.ts`.

acceptance:
- The generated summary for a patient with 4/10 adherence contains a human-readable sentence about adherence (e.g. mentions doses taken).
- The summary for a patient with a refill-at-risk forecast contains a reminder string.
- Inject a `clinician-review` task only → it does not appear in the patient summary.
- Inject a raw score into a task description (e.g. `"risk score: 7.4"`) → `generatePatientSummary` throws on the denylist check.
Run `npm test` → green.

---

**S14 — Adversarial fixtures and flagship integration test**
dependsOn: S01 through S13
files: `src/fixtures/patients.ts`, `src/fixtures/adversarial-scenarios.ts`, `test/integration.test.ts`

interface: No new exported types. This card wires all prior cards together with the five seeded patients and all E4 adversarial scenarios.

how to implement:
1. Create `src/fixtures/patients.ts` with 5 named patient fixtures (plain objects), each covering a distinct edge case:
   - Patient A: combo-pill (MIN) + standalone of one ingredient → duplicate-ingredient after MIN decomposition.
   - Patient B: Amoxicillin allergy + Cephalexin prescription → beta-lactam cross-reactivity (moderate), Amoxicillin allergy + Aztreonam → informational only.
   - Patient C: Acetaminophen 6000 mg/day (overdose) → max-dose alert.
   - Patient D: weight in lb, mg/kg dose → unit conversion required before dose check.
   - Patient E: same moderate DDI pair, suppressed with `'always-for-pair'` scope → alert demoted to passive on second evaluation.
2. Create `src/fixtures/adversarial-scenarios.ts` re-exporting the E4 fixture scenarios as named constants referencing the patient fixtures.
3. Create `test/integration.test.ts` which:
   - Runs `evaluateRules` for each patient.
   - For Patient A, asserts a `dup-ingredient` alert fires (proving MIN decomposition worked).
   - For Patient B Cephalexin case, asserts `severity: 'moderate'` cross-reactivity alert; for Aztreonam case asserts `severity: 'informational'`.
   - For Patient C, asserts `ruleId: 'max-dose'` fires.
   - For Patient D (weight in lb), asserts no `UnitMismatchError` is thrown and the dose comparison is correct.
   - For Patient E, records a suppression for the DDI alert, re-evaluates, and asserts the alert is still returned by `evaluateRules` but `suppressionStore.isSuppressed` returns true for it; also attempts to record a suppression for a `'contraindicated'` alert and asserts `SuppressionCeilingError` is thrown.
   - Asserts every alert has `evidence.length >= 1`.
   - Asserts reconciliation for Patient A (with the `'a water pill'` free-text entry) → item ends up in `unmatched`.
   - Runs `npm test` with the `FixedClock` — the same test run twice produces identical results.

acceptance: `test/integration.test.ts` — all assertions pass. `npm test` → green. Zero network calls.

---

### 3. Decomposition method for the rest of the spec

After the first slice (S01–S14) passes, expand the remaining spec features using this repeatable recipe:

**Recipe: one feature cluster = one dependency group of 2–4 small cards**

For each remaining feature from E6 steps (already covered: 1–11):
1. **Identify the pure-logic card** (no I/O, no UI): what is the data transformation / policy function? Define its input/output types first (always a one-card "types extension" if new types are needed).
2. **Identify the fixture card**: what seed data does it need? Add it to `src/fixtures/`.
3. **Identify the acceptance card**: what specific assertions prove it done? Write the test file name and the three most important assertions before coding.
4. Draw the `dependsOn` edges: does this card need the resolver? The dose module? The audit log? Make those explicit.

**Worked example A — Therapeutic-class duplication breadth (expanding beyond the two fixture classes)**

Break into 3 cards:
- `S15` — Extend `FIXTURE_REFERENCE_PACK` with 5 more therapeutic classes (beta-blockers, ACE inhibitors, statins, benzodiazepines, proton-pump inhibitors) with representative members. dependsOn: S05. files: `src/fixtures/reference-pack.ts` (edit), `test/reference-pack.test.ts` (edit). Acceptance: the pack's `therapeuticClasses.length >= 7`.
- `S16` — Add 3 more patient fixtures that each have a duplicate-class scenario (two statins, two beta-blockers, two benzodiazepines). dependsOn: S14, S15. files: `src/fixtures/patients.ts` (edit). Acceptance: `evaluateRules` for each fixture fires a `dup-class` alert with the correct class name in evidence.
- `S17` — Property test: for any regimen where all items share one therapeutic class, at least one `dup-class` alert fires. dependsOn: S07, S16. files: `test/rule-engine-property.test.ts`. Acceptance: 20 randomized same-class pairs all produce the alert.

**Worked example B — Suppression memory: scope and expiry**

Break into 3 cards:
- `S18` — Add an `expiresAt?: Date` field to `SuppressionRecord`. dependsOn: S08. files: `src/core/suppression-store.ts` (edit). `isSuppressed` now returns false if `clock.now() > expiresAt`. Acceptance: a suppression that expired yesterday no longer suppresses; one expiring tomorrow still does.
- `S19` — Audit-log integration: every suppression record call appends an `'alert-suppressed'` AuditEvent. dependsOn: S08, S06. files: `src/core/suppression-store.ts` (edit). Acceptance: recording a suppression produces exactly one audit event.
- `S20` — Invariant test: `suppressionStore` never returns `isSuppressed: true` for a `'contraindicated'` severity alert regardless of what records exist. dependsOn: S08, S19. files: `test/suppression-invariant.test.ts`. Acceptance: fuzz 50 random suppression/query pairs; no `'contraindicated'` alert is ever suppressed.

**Worked example C — Refill forecast: held-medication scenario**

Break into 2 cards:
- `S21` — Fixture: add Patient F who has a 7-day clinician hold on a medication with 10 days of remaining supply. dependsOn: S11, S14. files: `src/fixtures/patients.ts` (edit), `src/fixtures/adversarial-scenarios.ts` (edit). Acceptance: the fixture is importable and type-checks.
- `S22` — Assert the refill forecast for Patient F: `daysUntilExhaustion` accounts for the hold (must be > 10 days, not < 7, so not at risk). dependsOn: S11, S21. files: `test/refill-forecast-held.test.ts`. Acceptance: `forecast.isAtRisk === false`; `forecast.daysUntilExhaustion > 10`.

---

### 4. Per-task implementation conventions

**File/folder layout**

```
src/
  core/           # pure domain logic — no I/O, no frameworks
    types.ts      # S01: all shared type definitions
    clock.ts      # S02: Clock interface
    fixed-clock.ts
    dose.ts       # S03
    medication-concept-resolver.ts  # S04
    rule-engine.ts   # S07
    suppression-store.ts  # S08
    reconciliation.ts  # S09
    adherence-calendar.ts  # S10
    refill-forecast.ts  # S11
    task-queue.ts  # S12
    patient-summary.ts  # S13
    audit-log.ts   # S06
  fixtures/       # static deterministic data — no network, no file system reads
    rxnorm-graph.ts
    reference-pack.ts
    patients.ts
    adversarial-scenarios.ts
test/             # one file per card; mirrors src/ module names
```

**Naming conventions**
- Exported types: PascalCase (e.g. `ReferencePack`, `Alert`).
- Exported functions: camelCase (e.g. `evaluateRules`, `summarizeAdherence`).
- Exported classes: PascalCase (e.g. `AuditLog`, `SuppressionStore`).
- Branded ID types: `PatientId`, `MedicationConceptId` etc. — always via the `& { readonly __brand: '...' }` pattern.
- Never use `as unknown as PatientId` to create a branded ID in test code; cast with a helper: `'pid-001' as unknown as PatientId` is acceptable only in fixture files.

**How to write a test (minimal working example)**

```ts
// test/example.test.ts
import { describe, it, expect } from 'vitest';
import { clampScore } from '../src/core/example.js';

describe('clampScore', () => {
  it('clamps above 100', () => {
    expect(clampScore(150)).toBe(100);
  });
  it('clamps below 0', () => {
    expect(clampScore(-5)).toBe(0);
  });
  it('passes through mid-range values', () => {
    expect(clampScore(42)).toBe(42);
  });
});
```

**How to keep it deterministic**
- All fixture objects are defined as `const` at module scope with literal values.
- All time values in fixtures use `new Date('2025-01-15T08:00:00Z')` (UTC ISO strings, never relative expressions).
- All randomized property tests use a seeded PRNG (e.g. `seed = 42`; implement a simple LCG or use the project's existing seeded random utility) — never `Math.random()`.
- Sort collections before asserting: `expect([...arr].sort()).toEqual([...expected].sort())`.

**How to wire a fixture adapter**
The `MedicationConceptResolver` and `ReferencePack` are the two primary fixture adapters. In every test file that needs them:
```ts
import { FIXTURE_RXNORM_GRAPH } from '../src/fixtures/rxnorm-graph.js';
import { FIXTURE_REFERENCE_PACK } from '../src/fixtures/reference-pack.js';
import { MedicationConceptResolver } from '../src/core/medication-concept-resolver.js';

const resolver = new MedicationConceptResolver(FIXTURE_RXNORM_GRAPH);
```

**Definition of done for any card**
A card is done when ALL of the following are true:
1. `npm test` exits 0.
2. The TypeScript compiler emits zero errors (`tsc --noEmit`).
3. The test file for the card exists and has at least one passing assertion for every interface function/method the card exports.
4. No production module contains `Date.now()`, `Math.random()`, or any network call.
5. No `any` type is used in the card's production file.

---

### 5. Common pitfalls for a weak model on this project

**Pitfall 1 — Silently coercing units in dose arithmetic**
A 3B model will write `return dose.value * multiplier` without checking the unit, producing a number that looks plausible but is wrong for `mg/kg` or `mcg` inputs. The guard is `UnitMismatchError`: add the throw-if-unit-requires-weight check *before* the arithmetic, and verify it in the acceptance test.

**Pitfall 2 — Forgetting MIN decomposition before rules**
The combo-pill fixture (Patient A: MIN + standalone ingredient) is specifically designed to catch this. A model that does `regimen.map(r => r.conceptId)` for duplicate-ingredient detection will miss the case where one item is a MIN. The rule engine must call `resolver.getIngredients` on every item before comparing. If the test for Patient A's `dup-ingredient` alert fails, this is the cause.

**Pitfall 3 — Using string equality for allergy/cross-reactivity matching**
String-matching `'penicillin'` against drug names will both over-fire (any drug with "penicillin" in the name) and under-fire (missing Amoxicillin if it is stored by trade name). The correct approach: normalize to IN-level RxCUI via the resolver, then check the cross-reactivity table by `sideChainGroup`. The Patient B beta-lactam fixtures test exactly this — the aztreonam/cephalexin divergence only works if the table is keyed by side-chain, not name.

**Pitfall 4 — Suppressing contraindicated alerts**
A 3B model may implement `SuppressionStore.record` without the severity ceiling check. This will cause the invariant test (E5 §4) to fail. The fix is one line: throw `SuppressionCeilingError` at the top of `record` if `alert.severity === 'contraindicated'`.

**Pitfall 5 — Calling `Date.now()` or `new Date()` directly**
Any production module that calls `Date.now()` will break the determinism property. The tell-tale failure: the same test passes on one run and fails on another (because "days until exhaustion" changes with real wall-clock time). The fix is to always inject and use the `Clock` interface from S02. Search for `Date.now` in production files and replace with `clock.now()`.

**Pitfall 6 — Dropping unmatched items silently**
The reconciliation totality invariant (`inputs === accepted ⊎ rejected ⊎ unmatched`) will catch this — count the items before and after. A model that filters out unmatched items (because it cannot resolve them) fails the invariant. Every input must appear in exactly one output list.

**Pitfall 7 — Emitting raw scores or clinical directives in the patient summary**
The denylist in S13 is the guard. A model that writes "Your interaction risk score is 7.4" or "You should take 500mg of..." will trigger the denylist throw. The fix is to re-read the prohibited patterns before writing any summary string and to use quantity-free, directive-free language ("Some of your medications may interact — your care team has been notified" instead of "DDI risk: 7.4").

**Pitfall 8 — Forgetting `dependsOn` ordering**
A model that tries to implement the rule engine (S07) before the dose module (S03) or the resolver (S04) will get compile errors. Follow the card order strictly. If TypeScript reports that a type or function is missing, check whether its card has been implemented yet before adding a workaround.
