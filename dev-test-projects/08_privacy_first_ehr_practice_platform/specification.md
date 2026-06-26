# 08 - Privacy-First EHR and Practice Operations Platform

Complexity tier: 8/20
Expected decomposition size: 26-30 dependent implementation cards before coding.
Domain pressure: electronic health records, scheduling, clinical notes, FHIR-like resources, consent, privacy auditing, care plans.
Acceptance command: npm test

## How to use this challenge
This is a dev-test project specification for evaluating whether an autonomous coding agent can decompose a real domain, identify knowledge gaps, build a correct foundation, and verify it with deterministic tests. The goal is not to finish the entire product. The goal is to build a durable foundation that proves the agent understood the domain boundaries and can implement the highest-risk core behaviors without hiding behind placeholders.

The agent must read this entire specification before planning. It must create a dependency-linked plan, record domain knowledge debt, and choose a narrow release slice that still exercises the real hard parts. Prefer fewer production-quality vertical slices over many shallow labels.

## Product vision
Build an EHR foundation for a small specialty clinic that combines appointments, clinical documentation, care plans, orders, results, consent, and privacy-aware access. The product must separate clinical truth, workflow state, and generated summaries.

## Foundation release scope
The first serious buildout must include:
- Patient, practitioner, appointment, encounter, observation, condition, medication statement, order, result, care plan, consent, access event, and message models.
- Scheduling engine with provider availability, room constraints, visit type duration, cancellation, waitlist, and overbook policy.
- Encounter note workflow with structured sections, versioning, amendments, signatures, and problem-list updates.
- FHIR-inspired resource mapping layer that can import and export deterministic JSON fixtures without claiming full FHIR compliance.
- Consent and role-based access policy that filters sensitive notes, reproductive health flags, behavioral health notes, and minor proxy access scenarios.
- Results inbox for lab or imaging results with abnormal flags, acknowledgment, patient notification, and follow-up task creation.
- Care plan tracker with goals, interventions, due dates, barriers, outcomes, and patient-facing summary.
- Seed clinic with overlapping appointments, sensitive notes, amended encounters, and abnormal results.

## Architecture requirements
- Separate resource model, access policy, clinical workflow, and UI view-model generation.
- Use immutable note versions and explicit amendments after signature.
- Make access checks central and testable; do not scatter role checks in screens.
- Represent clinical coding as typed concepts with source system placeholders.

## Domain knowledge debt to surface
The agent should not pretend to know every regulation, standard, or numerical model perfectly. It should implement a defensible deterministic subset, mark assumptions explicitly, and create extension points where real-world integrations or expert-reviewed rule packs would live. Required knowledge areas:
- EHR data changes meaning depending on encounter context and authoring state.
- Privacy policy requires purpose, role, relationship, consent, and auditability.
- FHIR is a resource model and interoperability pattern, not a generic JSON dump.
- Clinical notes must support correction without history loss.

## Decomposition pressure
This project should force decomposition across domain modeling, calculation or policy engines, workflow state, deterministic fixtures, auditability, and UI/view-model boundaries. The plan should include dependency links so shared primitives and invariants are built before dependent workflow features. Avoid starting with screens. Start with the domain model, invariants, and tests that would make later screens trustworthy.

The agent should maintain a visible knowledge-debt list covering unclear standards, units, legal or safety constraints, numerical assumptions, terminology, fixture limitations, and future expert-review checkpoints. Knowledge debt is not a failure; hiding it is.

## Acceptance criteria
- Access policy tests cover clinician, billing staff, patient proxy, revoked consent, and break-glass paths.
- Signed note amendment preserves original content and creates traceable deltas.
- Scheduling detects room, provider, duration, and waitlist conflicts.
- Result inbox creates follow-up tasks only under tested abnormal/overdue rules.
- The project passes npm test with deterministic fixtures.

## Explicit non-goals
- Do not build diagnosis or medical advice automation.
- Do not claim regulatory certification.
- Do not bypass access policy for convenience in tests.

## Quality bar
- Use typed domain objects and pure core modules wherever practical.
- Keep deterministic fixtures in the repository and do not depend on live APIs for acceptance tests.
- Test edge cases before building broad UI coverage.
- Every risk score, recommendation, workflow transition, or generated report must be explainable from source facts.
- Stubs are acceptable only at external integration boundaries and must be named as adapters with deterministic fixture implementations.
- The foundation should be extensible into a real product if later teams add integrations, expert-reviewed rule packs, and production UI.

---

# Extended scope & deep-reasoning extensions (v2)

> Added 2026-06-26 via deep domain research. **The single hardest, most-defining property of this project is that a clinical fact's *visibility* is a computed function of {who is asking, in what role, for what purpose, under what consent, in what relationship, with what break-glass} — and that the decision, the data it touched, and the data it *withheld* must all be auditable forever, without history loss.** This is an EHR whose center of gravity is not the notes but the **policy decision point** in front of them. Build the access-control + consent + audit spine first; everything else is resources behind a gate.

## E0. The reframing (why this is an authorization engine wearing an EHR costume)

A naive EHR is "CRUD over clinical resources with a role check on each screen." That is exactly the failure this spec forbids ("do not scatter role checks in screens"). The disciplined version centralizes a single **Policy Decision Point (PDP)**: every read/write of a clinical resource is mediated by `authorize(principal, action, resource, context) → Permit | Deny | PermitWithObligations`, where `context` carries **purpose-of-use, relationship, consent state, sensitivity tags, and break-glass status**. This is **Attribute-Based Access Control (ABAC)** with **purpose-of-use** as a first-class attribute — the model real health systems converge on ([FHIR Security: ABAC + purpose-of-use](https://build.fhir.org/security.html); [Google Cloud Healthcare FHIR access-control model](https://docs.cloud.google.com/healthcare-api/docs/fhir-access-control-technical)). The defining tests in this spec — clinician vs. billing vs. patient-proxy vs. revoked-consent vs. break-glass — are *not five features; they are five evaluations of one PDP.* If the PDP is real, those are parametrized tests; if it isn't, they are five piles of scattered `if (role===...)`.

## E1. Research-grounded domain authenticity (fold these real models in)

**FHIR is a resource model, not a JSON dump.** Mirror R4 resource *shapes* (deterministic fixtures, "FHIR-inspired," no compliance claim) so the import/export adapter can later speak real FHIR: `Patient`, `Practitioner`, `Encounter`, `Observation`, `Condition`, `MedicationStatement`, `ServiceRequest` (order), `DiagnosticReport`/`Observation` (result), `CarePlan`, `Consent`, `Provenance`, `AuditEvent`, `Communication`. Each clinical resource carries `meta.security` labels and `meta.versionId` — these are load-bearing, not decoration ([FHIR Security: meta.security tags drive access decisions](https://build.fhir.org/security.html)).

**Consent is a computable policy, not a boolean.** Model the FHIR R4 `Consent` resource faithfully: a base `decision`/`provision.type` of **permit** or **deny**, with nested **`provision`** exceptions (each provision can have sub-provisions that are exceptions to the parent), scoped by `actor`, `action`, `purpose`, `class`/`code` (data category), and `period` ([FHIR Consent R4](https://fhir.hl7.org/fhir/consent.html); [HL7 Consent resource](http://hl7.org/fhir/consent.html)). This nesting is exactly how "share everything *except* behavioral-health notes with external providers, *but* permit the treating psychiatrist" is expressed. Use **IHE Privacy Consent on FHIR (PCF)** as the conceptual model for asserting/enforcing consent and the **Break-Glass (BTG)** override ([IHE PCF v1.1.0](https://profiles.ihe.net/ITI/PCF/volume-1.html); [PCF Appendix P: Privacy Access Policies](https://profiles.ihe.net/ITI/PCF/ch-P.html)).

**Sensitive-data segmentation is required and is *tag-driven*, not type-driven.** The mandated categories — substance-use, mental/behavioral health, reproductive/sexual health, HIV, genetics — are carried as **security/sensitivity labels on `meta.security`** so the PDP decides from the *classification*, not by hard-coding "if resource is a psych note" ([FHIR granular sensitive-data segmentation, PMC11839247](https://pmc.ncbi.nlm.nih.gov/articles/PMC11839247/); [FHIR Security: classification on meta.security](https://build.fhir.org/security.html)). This is the **Data Segmentation for Privacy (DS4P)** pattern. Reproductive-health flags and minor-proxy scenarios are explicit fixtures in the base spec — they are the *hard* labels (a parent's proxy access must be revocable as a minor reaches an age threshold, and reproductive/behavioral data may be withheld even from a proxy).

**Break-glass is a real, audited escape hatch — not a backdoor.** An authorized clinician may override consent restrictions in emergencies using `PurposeOfUse = BTG (Break-The-Glass)`; the override is *permitted* but generates a heightened audit obligation and (typically) post-hoc review ([FHIR Consent break-glass via BTG purpose-of-use](https://build.fhir.org/security.html); [IHE PCF break-glass](https://profiles.ihe.net/ITI/PCF/volume-1.html)). So break-glass is `PermitWithObligations(audit=heightened, notify=privacyOfficer, review=required)` — *the data flows, and the system shouts about it.*

**The audit log is FHIR `AuditEvent` and it is immutable.** Model `AuditEvent` (who/what/when/where/outcome, with a reference to the affected `Patient`) for **every** access — this is what powers HIPAA **accounting-of-disclosures** and access reports. Servers that support `AuditEvent` **do not accept update or delete** on it, because that would compromise audit integrity ([FHIR AuditEvent R4](https://hl7.org/fhir/R4/auditevent.html); [FHIR AuditEvent: immutability + patient-centric accounting of disclosures](https://build.fhir.org/auditevent.html)). `Provenance` is the *complementary* record — "how this resource came to be in its current state" (authoring, amendment, signature) — overlapping but distinct from `AuditEvent`'s "usage/access" record ([FHIR Provenance](https://build.fhir.org/provenance.html)). Model **both**.

**Clinical notes correct without history loss.** A signed note is immutable; corrections are **addenda/amendments** that create a new version and a traceable delta, never an in-place edit — this mirrors FHIR resource versioning (`meta.versionId`) and is a hard regulatory/medico-legal requirement, not a nicety. EHR data also *changes meaning* with encounter context and authoring state (a "draft" assessment is not a "signed" one).

**Clinical coding is typed concepts with terminology bindings.** Problems/conditions → **SNOMED CT** (and map to **ICD-10-CM** for billing via the NLM map), labs/observations → **LOINC**, medications → **RxNorm** ([FHIR terminology: SNOMED for diagnoses, LOINC for labs, ICD-10 for classification, RxNorm for meds](https://www.capminds.com/blog/fhir-terminology-services-architecture-managing-snomed-ct-loinc-icd-10-and-rxnorm-at-scale/); [SNOMED→ICD-10-CM NLM map](https://pmc.ncbi.nlm.nih.gov/articles/PMC6487871/)). Model these as typed `CodeableConcept`s with `system`/`code`/`display` and a `sourceSystemPlaceholder`, never bare strings.

**Results arrive as HL7 v2 in the real world.** The results inbox's production adapter ingests **HL7 v2 `ORU^R01`** (OBR/OBX with abnormal flags) and orders go out as `ORM^O01`/`ServiceRequest`; ADT `A08` carries demographic updates ([HL7 v2 ORU/ORM/ADT structure](https://healthcareintegrations.com/hl7-v2-messages-explained-adt-orm-and-oru-tutorial/)). The OBX **abnormal-flag** (`H`/`L`/`HH`/`LL`/`A`) is the seed of the abnormal-result rule. Model this as a fixture adapter; `npm test` ingests canned ORU JSON, never a live feed.

## E2. The hardest technical seams (where this stops being CRUD)

1. **The Policy Decision Point (the whole spine).** One pure `authorize(principal, action, resource, context)` with a **deny-by-default base** and a deterministic **conflict-resolution order** (explicit deny > break-glass-permit-with-obligations > consent provision > role grant). Every clinical read/write goes through it; no resource is reachable except via the PDP. The PDP returns **obligations** (filter these sections, redact these fields, emit heightened audit, notify privacy officer) that the caller *must* discharge — and discharging them is itself audited. This is the single highest-value module; build it first with the five required principals as its test matrix.
2. **Label-based field/section filtering (the `PermitWithObligations` muscle).** A "permit" is rarely all-or-nothing: a billing clerk sees the encounter for coding but **not** the behavioral-health section; an external provider sees the problem list **minus** reproductive-health-tagged conditions. The PDP must return a **redaction obligation** keyed by sensitivity label, and the view-model layer must apply it *provably* (no sensitive datum escapes into a view-model the principal wasn't permitted). Test: fuzz random (principal, resource-with-mixed-labels) and assert no label-violating field appears in the projection.
3. **Consent evaluation with nested provisions (a small policy interpreter).** Evaluating a `Consent` is walking the provision tree: base decision, then the most-specific matching provision wins, honoring `actor`/`purpose`/`class`/`period`. **Revocation** is a state transition with an effective time on the virtual clock — a revoked consent must flip subsequent decisions deterministically, and the *prior* permitted accesses remain in the audit (you don't un-disclose history).
4. **Immutable note versioning + amendment deltas.** A signature freezes a version; an amendment is an append that references its parent, carries author/time/reason, and produces a computable delta. The problem list updates as a *consequence* recorded in `Provenance`, never as a silent overwrite. Reconstructing "what did the note say when it was signed at T?" must be exact.
5. **Scheduling as a constraint solver.** Provider availability × room capacity × visit-type duration × cancellation/waitlist/overbook policy is a **conflict-detection** problem (double-booked provider, double-booked room, duration overrun, waitlist promotion on cancellation). Model it as typed constraints with explicit conflict types, on the virtual clock, so "overbook allowed up to policy N, then waitlist" is deterministic.
6. **Results→task rules (closed-loop, but only when warranted).** A result creates a follow-up task **only** under tested abnormal/overdue rules (abnormal flag present, or critical value, or unacknowledged past SLA on the clock). Acknowledgment, patient-notification, and follow-up are a small state machine — and creating a task that *shouldn't* exist (normal result → no task) is as important to test as the positive case.

## E3. Determinism & testability strategy

- **Virtual clock everywhere.** Consent periods, revocation effective-times, appointment slots, result-overdue SLAs, amendment timestamps, minor-proxy age thresholds — all read an injected `Clock`. Access decisions that depend on time (consent expired? proxy aged out? result overdue?) are deterministic for a fixed clock.
- **The PDP is a pure function over typed inputs** — no I/O, no globals — so its decision table is exhaustively unit-testable. The five required paths become a parametrized matrix; add the *cross-products* (break-glass over a revoked consent over a sensitive label) as the interesting cells.
- **Append-only `AuditEvent` + `Provenance`, event-sourced.** Clinical state, the problem list, the results inbox, and the schedule are **projections** over an append-only event log; `AuditEvent`/`Provenance` records are never mutated/deleted ([immutability is the FHIR rule](https://build.fhir.org/auditevent.html)). This yields free accounting-of-disclosures and free time-travel for tests.
- **Fixtures, no network.** FHIR-shaped JSON fixtures for resources; canned HL7 v2 `ORU` JSON for the results adapter; no live FHIR server, no live terminology service, no live HL7 feed in `npm test`. Terminology lookups hit an in-repo fixture `TerminologyService` (lookup/validate/translate) behind the same interface a real service would expose.
- **The flagship test:** seed the clinic (overlapping appointments, sensitive notes, amended encounters, abnormal results), run the five principals × the sensitivity matrix, and assert (1) every decision matches the expected permit/deny/redaction, (2) every access — including denials and break-glass — produced exactly one `AuditEvent`, (3) no sensitive datum leaked into a non-permitted projection, (4) amendment history is loss-free, (5) zero network.

## E4. Adversarial, failure, and edge-case scenarios (ship these as fixtures)

- **The billing-clerk peek:** billing staff opens an encounter for coding; the behavioral-health and reproductive-health sections must be **redacted** in their view-model, while the codes they need remain. Assert the sensitive fields never reach the projection.
- **The revoked-consent race:** patient revokes external-sharing consent at T; an external provider's read at T−1 was permitted (and stays in the audit), at T+1 is denied. The audit must show *both*, and the denial must carry a reason.
- **The break-glass that must shout:** an ED clinician break-glasses a consent-restricted record; access is **permitted**, but a heightened `AuditEvent` is emitted, the privacy officer is flagged, and the event is queued for post-hoc review. A break-glass with *no* emergency justification field is rejected.
- **The minor-proxy aging-out:** a parent proxy has access to a 12-year-old's record; at the policy age threshold (on the clock), reproductive/behavioral data is withheld from the proxy even though general access continues. Assert the transition fires from the clock alone.
- **The amendment-after-signature:** a signed note is "corrected"; the system must create a new version + delta + `Provenance`, preserve the signed original byte-for-byte, and update the problem list via a recorded event — never an in-place edit.
- **The double-book + waitlist:** two appointments collide on the same room/provider; overbook policy permits up to N then waitlists; a cancellation auto-promotes the waitlisted patient. All deterministic on the clock.
- **The normal-result non-event:** a normal (no abnormal flag) result must create **no** follow-up task; an abnormal one creates exactly one; an unacknowledged abnormal past SLA escalates. Test the negative as hard as the positive.
- **The scattered-check trap (meta-test):** a static assertion that **no clinical-resource read path bypasses the PDP** — every accessor routes through `authorize`. (Grep-as-test / architectural fitness function.)

## E5. Rigorous acceptance criteria, including invariants (property-based)

Add to the existing criteria as property tests over randomized principals/resources/consents:
1. **Mediation totality:** every clinical-resource access is preceded by exactly one PDP decision; there is no read or write that reaches a clinical resource without an `authorize` call. (Differential test: count accesses vs. decisions; they must match.)
2. **Audit totality + immutability:** every access (permit, deny, break-glass) emits exactly one `AuditEvent` referencing the affected patient; no `AuditEvent`/`Provenance` is ever mutated or deleted. Redact all prose — the structured audit alone must answer "who saw this patient's behavioral-health note, when, and under what purpose?" ([accounting-of-disclosures is the design target](https://build.fhir.org/auditevent.html)).
3. **No-leak (label soundness):** for any (principal, resource), no field/section whose sensitivity label the principal is not permitted for appears in the resulting view-model. Fuzz mixed-label resources.
4. **Deny-by-default:** an empty/unknown policy context yields `Deny`; a permit requires an affirmative grant. No "fail open."
5. **Consent monotonicity under revocation:** revoking a consent can only *remove or hold* permissions going forward, never add; and never retroactively alters past audit facts.
6. **History preservation:** for any signed note with K amendments, the original signed content is exactly reconstructable, and each amendment's delta + author + reason + time is intact.
7. **Result-rule soundness:** a follow-up task exists **iff** an abnormal/overdue rule matched; no spurious tasks, no missed escalations.
8. **Scheduling validity:** no committed schedule violates provider/room/duration constraints beyond the explicit overbook policy; waitlist promotion is deterministic.

## E6. The concrete first vertical slice (the on-ramp — build THIS first, ~26–30 cards)

Prove the policy spine end-to-end before breadth:
1. **Typed FHIR-shaped resource model** with `meta.security` sensitivity labels + `meta.versionId` (Patient, Practitioner, Encounter, Observation, Condition, MedicationStatement, ServiceRequest, DiagnosticReport, CarePlan, Consent, Provenance, AuditEvent, Communication).
2. **Append-only `AuditEvent` + `Provenance`** log (immutable) and the event-sourced projection layer.
3. **The PDP** — pure `authorize(principal, action, resource, context)`, deny-by-default, conflict-resolution order, returning **obligations** (redaction, heightened-audit, notify).
4. **Consent interpreter** — nested provisions, actor/purpose/class/period scoping, revocation on the virtual clock.
5. **Sensitivity-label redaction** in the view-model layer (the obligation-discharge path), proven leak-free.
6. **Break-glass** as `PermitWithObligations` with mandatory justification + heightened audit + privacy-officer flag + review queue.
7. **Immutable note workflow** — structured sections, signature, amendment/addendum with delta + `Provenance`, problem-list update as a recorded event.
8. **Results inbox** — fixture `ORU` ingestion, abnormal-flag rule, acknowledgment state machine, follow-up task only under tested rules.
9. **Scheduling engine** — provider/room/duration/cancellation/waitlist/overbook conflict detection on the clock.
10. **Care-plan tracker** (goals/interventions/due-dates/barriers/outcomes) + patient-facing summary that respects the same redaction obligations.
11. The **five principals × sensitivity matrix**, the **adversarial fixtures (E4)**, and the **invariants (E5)** all green; `npm test` with zero network.

If that slice holds, every screen is a view-model behind a PDP that already enforces the law.

## E7. Domain knowledge-debt to track (surface, don't bluff)

Maintain a live, *action-gating* knowledge-debt ledger (owner / risk / forcing-trigger / expert-review flag):
- **This is "FHIR-inspired," not FHIR-compliant, and not certified.** No ONC certification, no claim of regulatory compliance — the resource shapes are a deterministic subset. Block any "compliant/certified" claim until a real conformance pass + legal review.
- **Sensitivity labeling is a policy minefield.** Which data is "behavioral health" vs. "general," how 42 CFR Part 2 (US substance-use confidentiality) layers over HIPAA, how state minor-consent laws vary, and how reproductive-health data is treated post-*Dobbs* are **expert-and-jurisdiction-specific** — the label taxonomy is a starting model needing privacy-counsel review ([DS4P/segmentation is an active standards area, PMC11839247](https://pmc.ncbi.nlm.nih.gov/articles/PMC11839247/)).
- **Break-glass governance** (who may, post-hoc review SLA, sanctions for misuse) is org-policy + legal, not just code.
- **Consent semantics edge-cases** (conflicting consents, default policy when no consent on file, cascading provider relationships) follow IHE PCF conceptually but need a real privacy/consent SME ([IHE PCF](https://profiles.ihe.net/ITI/PCF/volume-1.html)).
- **Terminology bindings** are illustrative; real SNOMED/LOINC/ICD-10/RxNorm content is licensed and version-sensitive (the SNOMED→ICD-10-CM map is a real NLM artifact with maintenance burden).
- **No diagnosis/medical-advice automation** — care-plan and summary generation must never read as clinical direction; this is a safety/legal boundary.

## E8. Why this is a great !Klein challenge

It is the cleanest possible test of whether a swarm of weak models can build a system whose **correctness is an authorization invariant, not a vibe.** It stresses: **centralized policy reasoning** (the anti-pattern of scattered checks is exactly what small models drift into — the spec forces one PDP and the meta-test enforces it); **label-driven redaction** (provable non-leakage is a property, not a hope); **immutable, total audit** (you cannot fake "every access is logged" — the differential test catches it); and **time-dependent policy** (consent/proxy/SLA on a virtual clock, where determinism is the whole game). The win condition is that the *structured record alone* — prose redacted — answers any privacy-audit question about a week of clinic operation. That is the discipline that turns "an EHR a small model wrote" into "an EHR you could let a regulator inspect." Build the PDP + consent interpreter + immutable audit first; the resources are projection behind the gate.

---

## Small-model build guide (3B-ready)

> This section is a mechanical build guide for a ~3B-parameter model running via !Klein. Every card is small enough to implement and verify in isolation. Follow the cards in order; never skip a dependency. The parent section (E6) listed 11 high-level steps; this guide expands the first vertical slice into 16 small cards (P01–P16) and gives repeatable recipes for the remaining breadth.

---

### 1. Glossary & ground rules

**Domain terms**

| Term | Meaning in this project |
|---|---|
| PDP | Policy Decision Point. One pure function `authorize(principal, action, resource, context)` that returns `Permit`, `Deny`, or `PermitWithObligations`. All clinical resource access goes through it. |
| Principal | The entity requesting access: clinician, billing-staff, patient-proxy, external-provider, or break-glass. |
| Purpose-of-use | Why the access is being made: `treatment`, `billing`, `operations`, `break-glass`, `research`. First-class attribute in the PDP. |
| Sensitivity label | A tag on `meta.security` that classifies data: `behavioral-health`, `reproductive-health`, `substance-use`, `hiv`, `general`. The PDP decides from the label, not the resource type. |
| Obligation | A side-effect the PDP mandates when returning `Permit`: `redact-section`, `heightened-audit`, `notify-privacy-officer`, `queue-for-review`. |
| PermitWithObligations | A Permit that comes with mandatory obligations the caller must discharge before returning data. |
| AuditEvent | An immutable append-only record of every access (permit, deny, break-glass). Never updated or deleted. |
| Provenance | A record of how a clinical resource came to exist/change: authoring, amendment, signature. Distinct from AuditEvent. |
| Consent | A computable `Consent` resource with a base decision + nested provisions (exceptions). Not a boolean flag. |
| Provision | A node in the consent tree: `{ type: 'permit' | 'deny', actor?, purpose?, class?, period?, provisions?: Provision[] }`. Most-specific matching provision wins. |
| Break-glass | An emergency override: `PurposeOfUse = 'break-glass'`. Permitted but triggers heightened audit + privacy-officer notification. Cannot proceed without a justification field. |
| FHIR | HL7 FHIR R4 shape used for all resource models (deterministic fixtures; no compliance claim). |
| meta.security | FHIR field on every resource carrying sensitivity labels. PDP reads this; it is load-bearing, not decoration. |
| meta.versionId | FHIR field tracking resource version. Signatures freeze a version; amendments create a new versionId. |
| CodeableConcept | Typed clinical code: `{ system: string; code: string; display: string }`. Never bare strings for diagnoses, labs, or meds. |
| DS4P | Data Segmentation for Privacy. Sensitivity labels on `meta.security` drive the redaction model. |
| Clock | An injected interface `{ now(): Date }`. Every time-dependent check reads this, never `Date.now()`. |

**Stack**

- Language: TypeScript (strict mode, no `any`).
- Runtime: Node.js.
- Test runner: Vitest (or Jest; whatever `npm test` is wired to).
- No live APIs, no network calls in tests.
- All fixtures live under `src/fixtures/` as plain TypeScript objects.

**Acceptance command (run after every card)**

```
npm test
```

Must exit 0. Zero network calls. Fully deterministic.

**Determinism rules (imperative)**

1. Never call `Date.now()` or `new Date()` (without argument) in production modules. Use the injected `Clock`.
2. Consent periods, proxy age thresholds, result SLA deadlines, and amendment timestamps all come from the injected `Clock`.
3. AuditEvents are appended to an in-memory array; never update or delete an entry.
4. Sort collections before asserting.
5. All FHIR-shaped fixtures are static TypeScript objects in `src/fixtures/`; no JSON file reads, no HTTP.

---

### 2. The explicit task graph for the first vertical slice

The first slice covers E6 steps 1–11. Cards P01–P16 below implement them in strict dependency order.

---

**P01 — Core type definitions**
dependsOn: none
files: `src/core/types.ts`

interface (write these exact exports):
```ts
export type PatientId = string & { readonly __brand: 'PatientId' };
export type PractitionerId = string & { readonly __brand: 'PractitionerId' };
export type ResourceId = string & { readonly __brand: 'ResourceId' };
export type ResourceType = 'Patient' | 'Practitioner' | 'Encounter' | 'Observation' | 'Condition' |
  'MedicationStatement' | 'ServiceRequest' | 'DiagnosticReport' | 'CarePlan' | 'Consent' |
  'Provenance' | 'AuditEvent' | 'Communication';
export type SensitivityLabel = 'behavioral-health' | 'reproductive-health' | 'substance-use' | 'hiv' | 'genetics' | 'general';
export type PurposeOfUse = 'treatment' | 'billing' | 'operations' | 'break-glass' | 'research';
export type PrincipalRole = 'clinician' | 'billing-staff' | 'patient-proxy' | 'external-provider' | 'patient';
export type ClinicalAction = 'read' | 'write' | 'amend' | 'delete';
export type PolicyDecisionType = 'Permit' | 'Deny' | 'PermitWithObligations';
export type ObligationType = 'redact-section' | 'heightened-audit' | 'notify-privacy-officer' | 'queue-for-review';
export type Obligation = { type: ObligationType; details?: Record<string, string> };
export type PolicyDecision =
  | { decision: 'Permit' }
  | { decision: 'Deny'; reason: string }
  | { decision: 'PermitWithObligations'; obligations: Obligation[] };
export type CodeableConcept = { system: string; code: string; display: string };
export type Meta = { security: SensitivityLabel[]; versionId: string; lastUpdated: Date };
export type FhirResource = { resourceType: ResourceType; id: ResourceId; meta: Meta };
```

how to implement:
1. Create `src/core/types.ts`.
2. Copy the exact definitions above. All IDs are branded strings.
3. Export everything at file level, no default exports.

acceptance: `test/types.test.ts` — compile-only; import every type, assign a literal to each typed variable. `npm test` → green (zero type errors).

---

**P02 — Injected Clock + FixedClock**
dependsOn: P01
files: `src/core/clock.ts`, `src/core/fixed-clock.ts`, `test/fixed-clock.test.ts`

interface:
```ts
export interface Clock { now(): Date; }
export class FixedClock implements Clock {
  constructor(private readonly fixedTime: Date) {}
  now(): Date { return new Date(this.fixedTime.getTime()); }
}
```

how to implement: (same as S02 in project 01 — one interface, one class, one test)

acceptance: `new FixedClock(new Date('2025-03-01T00:00:00Z')).now().toISOString() === '2025-03-01T00:00:00.000Z'`. Two calls return equal values, distinct objects. `npm test` → green.

---

**P03 — Append-only AuditEvent + Provenance log**
dependsOn: P01, P02
files: `src/core/audit-log.ts`, `test/audit-log.test.ts`

interface:
```ts
export type AuditEventRecord = {
  id: string;
  type: 'access' | 'denial' | 'break-glass' | 'amendment' | 'consent-change';
  occurredAt: Date;
  patientId: PatientId;
  actorId: string;
  resourceType: ResourceType;
  resourceId: ResourceId;
  decision: PolicyDecisionType;
  purpose: PurposeOfUse;
  obligationsDischarged: ObligationType[];
  heightened: boolean;
};
export type ProvenanceRecord = {
  id: string;
  resourceType: ResourceType;
  resourceId: ResourceId;
  versionId: string;
  action: 'created' | 'amended' | 'signed';
  actorId: string;
  occurredAt: Date;
  reason?: string;
  previousVersionId?: string;
};
export class AuditLog {
  appendAccess(event: Omit<AuditEventRecord, 'id'>): AuditEventRecord;
  appendProvenance(prov: Omit<ProvenanceRecord, 'id'>): ProvenanceRecord;
  getAllEvents(): readonly AuditEventRecord[];
  getAllProvenance(): readonly ProvenanceRecord[];
  getEventsByPatient(patientId: PatientId): readonly AuditEventRecord[];
}
```

how to implement:
1. Create `src/core/audit-log.ts` with two private arrays and a shared counter.
2. `appendAccess` and `appendProvenance` assign sequential string IDs, push, return the record.
3. Neither `getAllEvents` nor `getAllProvenance` ever removes or modifies entries.
4. Create `test/audit-log.test.ts`.

acceptance:
- Appending two access events + one provenance event: IDs are `'1'`, `'2'`, `'3'` (or similar deterministic sequence).
- `getAllEvents()` returns all access events in insertion order.
- Calling `getEventsByPatient` with a different patientId returns 0 results.
- A returned array slice does not mutate the internal store.
Run `npm test` → green.

---

**P04 — FHIR-shaped resource model + sensitivity label fixture**
dependsOn: P01, P03
files: `src/core/resources.ts`, `src/fixtures/clinic-resources.ts`, `test/resources.test.ts`

interface:
```ts
// src/core/resources.ts — extend FhirResource into each concrete resource type
export type Patient = FhirResource & { resourceType: 'Patient'; name: string; birthDate: string; patientId: PatientId };
export type Encounter = FhirResource & { resourceType: 'Encounter'; patientId: PatientId; practitionerId: PractitionerId; status: 'planned' | 'in-progress' | 'finished'; sections: EncounterSection[] };
export type EncounterSection = { label: string; sensitivity: SensitivityLabel; content: string };
export type Condition = FhirResource & { resourceType: 'Condition'; patientId: PatientId; code: CodeableConcept; sensitivity: SensitivityLabel };
export type Observation = FhirResource & { resourceType: 'Observation'; patientId: PatientId; code: CodeableConcept; value: string; abnormalFlag?: 'H' | 'L' | 'HH' | 'LL' | 'A'; sensitivity: SensitivityLabel };
// (add MedicationStatement, ServiceRequest, DiagnosticReport, CarePlan, Communication at the same shape)
```

how to implement:
1. Create `src/core/resources.ts` with all 13 FHIR-shaped resource types.
2. Every resource has `meta.security: SensitivityLabel[]` (carried from `FhirResource`).
3. Create `src/fixtures/clinic-resources.ts` with at least:
   - 2 patients (one with a `behavioral-health`-tagged encounter section; one minor with a `reproductive-health`-tagged condition).
   - 1 encounter with mixed sections: one `'general'` section and one `'behavioral-health'` section.
   - 1 Observation with `abnormalFlag: 'HH'` and `sensitivity: 'general'`.
4. Create `test/resources.test.ts`.

acceptance:
- All fixture resources type-check.
- The encounter fixture has `sections.length >= 2` with distinct sensitivity labels.
- The `Observation` fixture has `abnormalFlag === 'HH'`.
Run `npm test` → green.

---

**P05 — Consent model + provision interpreter**
dependsOn: P01, P02, P04
files: `src/core/consent.ts`, `src/fixtures/consents.ts`, `test/consent.test.ts`

interface:
```ts
export type ConsentProvision = {
  type: 'permit' | 'deny';
  actor?: PrincipalRole;
  purpose?: PurposeOfUse;
  dataClass?: SensitivityLabel;
  periodEnd?: Date;
  provisions?: ConsentProvision[];  // nested exceptions
};
export type ConsentResource = FhirResource & {
  resourceType: 'Consent';
  patientId: PatientId;
  status: 'active' | 'revoked';
  revokedAt?: Date;
  baseDecision: 'permit' | 'deny';
  provision?: ConsentProvision;
};

// Walk the provision tree to find the most-specific matching provision.
// Most specific = deepest node that matches all of: actor (if set), purpose (if set), dataClass (if set), period (not expired per clock).
// Returns the matching provision's type, or the baseDecision if no provision matches.
export function evaluateConsent(
  consent: ConsentResource,
  actor: PrincipalRole,
  purpose: PurposeOfUse,
  dataClass: SensitivityLabel,
  clock: Clock
): 'permit' | 'deny';
```

how to implement:
1. Create `src/core/consent.ts`.
2. `evaluateConsent`:
   - If `consent.status === 'revoked'` and `clock.now() >= consent.revokedAt`, return `'deny'`.
   - Recursively walk `consent.provision`. At each node, check: does `actor` match (if set)? does `purpose` match (if set)? does `dataClass` match (if set)? is `periodEnd` not yet expired (per clock)?
   - The most-specific matching child takes precedence over its parent.
   - If no provision matches, return `consent.baseDecision`.
3. Create `src/fixtures/consents.ts` with at least:
   - A consent permitting treatment but denying external-provider access to `behavioral-health` data via a nested provision.
   - A consent that was active then revoked at a specific date.
4. Create `test/consent.test.ts`.

acceptance:
- Consent with base `'permit'` + nested `deny` for `{ actor: 'external-provider', dataClass: 'behavioral-health' }`: `evaluateConsent` for external-provider + behavioral-health → `'deny'`; same consent for clinician + treatment → `'permit'`.
- Revoked consent at clock time after revocation date → `'deny'`.
- Revoked consent at clock time before revocation date → `'permit'` (not yet revoked).
Run `npm test` → green.

---

**P06 — Policy Decision Point (PDP)**
dependsOn: P01, P02, P04, P05
files: `src/core/pdp.ts`, `test/pdp.test.ts`

interface:
```ts
export type Principal = { role: PrincipalRole; actorId: string; patientRelationship?: PatientId };
export type AccessContext = {
  purpose: PurposeOfUse;
  breakGlassJustification?: string;   // required if purpose === 'break-glass'
  consents: ConsentResource[];
};

// Deny-by-default. Conflict resolution:
// 1. explicit-deny in consent provision → Deny
// 2. purpose === 'break-glass' WITH justification → PermitWithObligations(heightened-audit, notify-privacy-officer, queue-for-review)
// 3. purpose === 'break-glass' WITHOUT justification → Deny('break-glass requires justification')
// 4. consent provision permits → Permit or PermitWithObligations(redact sections not permitted)
// 5. no matching consent → Deny('no affirmative grant')
export function authorize(
  principal: Principal,
  action: ClinicalAction,
  resource: FhirResource,
  context: AccessContext,
  clock: Clock
): PolicyDecision;
```

how to implement:
1. Create `src/core/pdp.ts`.
2. Step 1: if any consent provision returns `'deny'` for this (actor, purpose, each label in `resource.meta.security`) → return `{ decision: 'Deny', reason: 'consent-provision-deny' }`.
3. Step 2–3: if `purpose === 'break-glass'`, check `context.breakGlassJustification`; if absent → `Deny`; if present → `PermitWithObligations([{ type: 'heightened-audit' }, { type: 'notify-privacy-officer' }, { type: 'queue-for-review' }])`.
4. Step 4: evaluate all consents; if any returns `'permit'` for the relevant labels → check if any label in `resource.meta.security` is NOT permitted for this (actor, purpose) — if so, add a `redact-section` obligation for each such label.
5. Step 5: no permit found → `Deny('no affirmative grant')`.
6. Create `test/pdp.test.ts` with the five required principals.

acceptance (the five required paths as five `describe` blocks):
- Clinician + treatment + no sensitive labels → `Permit`.
- Billing-staff + billing + encounter with `behavioral-health` section → `PermitWithObligations` with a `redact-section` obligation for `behavioral-health`.
- Patient-proxy + treatment + minor's `reproductive-health` condition → verify consent provision controls (permit or deny based on fixture consent).
- Break-glass WITH justification → `PermitWithObligations` with `heightened-audit`, `notify-privacy-officer`, `queue-for-review`.
- Break-glass WITHOUT justification → `Deny`.
- Empty/no consent on file → `Deny` (deny-by-default).
Run `npm test` → green.

---

**P07 — Sensitivity-label redaction in view-model layer**
dependsOn: P01, P04, P06
files: `src/core/view-model.ts`, `test/view-model.test.ts`

interface:
```ts
// Apply obligations from a PermitWithObligations decision to an Encounter resource.
// Returns a new Encounter where sections whose sensitivity label appears in a redact-section obligation
// are replaced with a { label: section.label, sensitivity: section.sensitivity, content: '[redacted]' } stub.
// Does NOT mutate the original resource.
export function applyRedactionObligations(encounter: Encounter, obligations: Obligation[]): Encounter;

// Extract redaction targets from a list of obligations.
export function getRedactedLabels(obligations: Obligation[]): SensitivityLabel[];
```

how to implement:
1. Create `src/core/view-model.ts`.
2. `getRedactedLabels`: filter `obligations` where `type === 'redact-section'`, collect `details.label` values as `SensitivityLabel[]`.
3. `applyRedactionObligations`: create a shallow copy of the encounter with a new `sections` array; for each section, if `section.sensitivity` is in the redacted labels, replace `content` with `'[redacted]'`; else keep as-is.
4. Create `test/view-model.test.ts`.

acceptance:
- An encounter with sections `[{sensitivity:'behavioral-health',...}, {sensitivity:'general',...}]` + a `redact-section` obligation for `behavioral-health` → the returned encounter's `behavioral-health` section has `content === '[redacted]'`; the `general` section is unchanged.
- Original encounter is not mutated (the original's `behavioral-health` section still has the original content).
- No obligation → encounter returned unchanged.
Run `npm test` → green.

---

**P08 — Immutable note workflow (signature + amendment)**
dependsOn: P01, P03, P04
files: `src/core/note-workflow.ts`, `test/note-workflow.test.ts`

interface:
```ts
export type NoteStatus = 'draft' | 'signed' | 'amended';
export type EncounterNote = {
  id: ResourceId;
  encounterId: ResourceId;
  patientId: PatientId;
  authorId: PractitionerId;
  status: NoteStatus;
  versionId: string;
  sections: EncounterSection[];
  signedAt?: Date;
  amendments: NoteAmendment[];
};
export type NoteAmendment = {
  id: string;
  parentVersionId: string;
  authorId: PractitionerId;
  reason: string;
  amendedAt: Date;
  delta: { sectionLabel: string; oldContent: string; newContent: string }[];
};

// Sign a draft note. Throws if note is not in 'draft' status.
export function signNote(note: EncounterNote, signedBy: PractitionerId, clock: Clock, auditLog: AuditLog): EncounterNote;

// Amend a signed note. Creates a new version; original is preserved byte-for-byte.
// Throws if note is not 'signed'. Returns the new note (original unchanged).
export function amendNote(
  note: EncounterNote,
  authorId: PractitionerId,
  reason: string,
  sectionUpdates: { label: string; newContent: string }[],
  clock: Clock,
  auditLog: AuditLog
): EncounterNote;
```

how to implement:
1. Create `src/core/note-workflow.ts`.
2. `signNote`: if `note.status !== 'draft'` throw `Error('can only sign a draft note')`; return a new object with `status: 'signed'`, `signedAt: clock.now()`, incremented `versionId`. Append a `ProvenanceRecord` of type `'signed'` to `auditLog`. Do not mutate the input object.
3. `amendNote`: if `note.status !== 'signed'` throw `Error('can only amend a signed note')`; compute `delta` by comparing old section contents to new; return a new object with `status: 'amended'`, incremented `versionId`, the new amendment pushed to `amendments`. The original note object must remain identical. Append `ProvenanceRecord` of type `'amended'`.
4. Create `test/note-workflow.test.ts`.

acceptance:
- Signing a draft produces a new note object with `status: 'signed'`; original object still has `status: 'draft'`.
- Attempting to sign an already-signed note throws.
- Amending a signed note produces a new note with `status: 'amended'` and one `NoteAmendment` entry; original note object still has `status: 'signed'` and original content.
- `amendments[0].delta` describes the actual content change.
- Each operation appends exactly one `ProvenanceRecord` to the audit log.
Run `npm test` → green.

---

**P09 — Results inbox + abnormal-flag rule**
dependsOn: P01, P02, P03, P04, P06
files: `src/core/results-inbox.ts`, `src/fixtures/result-fixtures.ts`, `test/results-inbox.test.ts`

interface:
```ts
export type ResultStatus = 'pending' | 'acknowledged' | 'escalated';
export type InboxEntry = {
  id: string;
  patientId: PatientId;
  observation: Observation;
  receivedAt: Date;
  status: ResultStatus;
  acknowledgedAt?: Date;
  followUpTaskId?: string;
  slaDueAt: Date;   // receivedAt + 24h for critical (HH/LL), + 72h for abnormal (H/L/A)
};

// Ingest a result. Returns an InboxEntry. Creates a follow-up task ONLY if abnormalFlag is set.
export function ingestResult(obs: Observation, clock: Clock, auditLog: AuditLog): InboxEntry;

// Acknowledge a result. Updates status. No task created.
export function acknowledgeResult(entry: InboxEntry, actorId: string, clock: Clock, auditLog: AuditLog): InboxEntry;

// Check SLA: if status !== 'acknowledged' AND clock.now() > slaDueAt → return escalated entry.
export function checkSla(entry: InboxEntry, clock: Clock, auditLog: AuditLog): InboxEntry;
```

how to implement:
1. Create `src/core/results-inbox.ts`.
2. `ingestResult`: compute `slaDueAt` based on flag: `'HH' | 'LL'` → +24h, `'H' | 'L' | 'A'` → +72h, absent → no SLA (set `slaDueAt` to a far-future sentinel). Create `followUpTaskId` only if `obs.abnormalFlag` is set. Append an access AuditEvent.
3. `acknowledgeResult`: return new entry with `status: 'acknowledged'`, `acknowledgedAt: clock.now()`. Append AuditEvent.
4. `checkSla`: if not acknowledged and `clock.now() > entry.slaDueAt` → return new entry with `status: 'escalated'`. Append AuditEvent.
5. Create `src/fixtures/result-fixtures.ts` with at least one critical observation (`abnormalFlag: 'HH'`) and one normal observation (no flag).
6. Create `test/results-inbox.test.ts`.

acceptance:
- A normal result (no flag) → `ingestResult` returns entry with `followUpTaskId === undefined`.
- A `'HH'`-flagged result → `followUpTaskId` is set.
- `checkSla` on an unacknowledged critical entry with clock 25h after receipt → `status: 'escalated'`.
- `checkSla` on an acknowledged entry (any time) → status stays `'acknowledged'`, no escalation.
Run `npm test` → green.

---

**P10 — Scheduling engine (conflict detection)**
dependsOn: P01, P02, P03
files: `src/core/scheduling.ts`, `src/fixtures/schedule-fixtures.ts`, `test/scheduling.test.ts`

interface:
```ts
export type TimeSlot = { start: Date; end: Date };
export type Appointment = {
  id: string;
  patientId: PatientId;
  practitionerId: PractitionerId;
  roomId: string;
  slot: TimeSlot;
  visitType: string;
  durationMinutes: number;
  status: 'scheduled' | 'cancelled' | 'waitlisted';
  overbookAllowed: boolean;
};
export type ScheduleConflict = { type: 'provider-double-book' | 'room-double-book' | 'duration-overrun' | 'overbook-limit' | 'waitlisted'; details: string };

// Book an appointment. Returns the appointment if no conflict (or within overbook policy).
// Returns a conflict description if the slot cannot be booked.
export type BookingResult = { success: true; appointment: Appointment } | { success: false; conflict: ScheduleConflict };

export function bookAppointment(
  requested: Omit<Appointment, 'id' | 'status'>,
  existing: Appointment[],
  overbookLimit: number,
  clock: Clock,
  auditLog: AuditLog
): BookingResult;

// Cancel an appointment. Promotes the first waitlisted appointment for the same slot if any.
export function cancelAppointment(appointment: Appointment, all: Appointment[], clock: Clock, auditLog: AuditLog): Appointment[];
```

how to implement:
1. Create `src/core/scheduling.ts`.
2. `bookAppointment`: check for provider overlap (same `practitionerId`, overlapping slot among `'scheduled'` existing), room overlap (same `roomId`, overlapping slot), and overbook count. If provider conflict count = `overbookLimit` → return `waitlisted`. If > `overbookLimit` → return `overbook-limit` conflict.
3. `cancelAppointment`: mark the appointment as `'cancelled'`. Find first `'waitlisted'` appointment for the same `practitionerId` + overlapping slot, promote to `'scheduled'`.
4. Create `src/fixtures/schedule-fixtures.ts` with an overlapping appointment scenario.
5. Create `test/scheduling.test.ts`.

acceptance:
- Booking a slot with no conflicts → `{ success: true }`.
- Booking same provider + slot twice (overbookLimit=0) → second booking returns `conflict.type === 'provider-double-book'`.
- Cancelling an appointment with a waitlisted patient → the waitlisted patient's status becomes `'scheduled'`.
Run `npm test` → green.

---

**P11 — Care plan tracker**
dependsOn: P01, P02, P04, P07
files: `src/core/care-plan.ts`, `test/care-plan.test.ts`

interface:
```ts
export type GoalStatus = 'in-progress' | 'achieved' | 'not-achieved' | 'cancelled';
export type CarePlanGoal = { id: string; description: string; dueAt: Date; status: GoalStatus; barriers: string[]; outcomes: string[] };
export type CarePlanIntervention = { id: string; description: string; frequency: string; assignedTo: PrincipalRole };
export type CarePlan = FhirResource & {
  resourceType: 'CarePlan';
  patientId: PatientId;
  goals: CarePlanGoal[];
  interventions: CarePlanIntervention[];
};

// Generate a plain-language patient-facing summary of the care plan.
// Must NOT expose raw IDs, internal status codes as-is, or clinical directive language.
export function generateCarePlanSummary(plan: CarePlan, clock: Clock): string;
```

how to implement:
1. Create `src/core/care-plan.ts`.
2. `generateCarePlanSummary`: iterate goals and produce sentences like "Goal: [description]. Due [readable date]. Status: [human-readable status]." Interventions: "Your care team will [description] [frequency]." No raw UUIDs, no raw enum values.
3. Create `test/care-plan.test.ts`.

acceptance:
- A plan with 2 goals → summary string contains both goal descriptions.
- A plan with no overdue goals (clock before all due dates) → summary does not mention overdue.
- A plan with one past-due goal (clock after due date) → summary mentions that the goal is overdue.
Run `npm test` → green.

---

**P12 — Minor-proxy aging-out (clock-driven policy)**
dependsOn: P01, P02, P05, P06
files: `src/core/proxy-policy.ts`, `test/proxy-policy.test.ts`

interface:
```ts
// Return whether a proxy has access to the given data class for a minor patient at the given clock time.
// Proxy loses access to 'reproductive-health' and 'behavioral-health' at the policy age threshold.
export const PROXY_SENSITIVE_CUTOFF_YEARS = 14;

export function proxyMayAccess(
  patientBirthDate: Date,
  dataClass: SensitivityLabel,
  clock: Clock
): boolean;
```

how to implement:
1. Create `src/core/proxy-policy.ts`.
2. Compute patient age in years: `(clock.now().getTime() - patientBirthDate.getTime()) / (365.25 * 24 * 3600 * 1000)`.
3. If `dataClass === 'reproductive-health' || dataClass === 'behavioral-health'` AND age >= `PROXY_SENSITIVE_CUTOFF_YEARS` → return `false`.
4. Otherwise return `true`.
5. Create `test/proxy-policy.test.ts`.

acceptance:
- Patient born 14 years ago (clock exactly at cutoff) → `proxyMayAccess` returns `false` for `'reproductive-health'`.
- Patient 13 years old → returns `true` for `'reproductive-health'`.
- Patient 15 years old, dataClass `'general'` → returns `true` (general data always accessible to proxy).
Run `npm test` → green.

---

**P13 — FHIR fixture clinic: seed data**
dependsOn: P01 through P12
files: `src/fixtures/seed-clinic.ts`, `test/seed-clinic.test.ts`

interface: No new types. This card assembles all prior fixture pieces into one named export:
```ts
export const SEED_CLINIC: {
  patients: Patient[];
  practitioners: Practitioner[];
  encounters: Encounter[];
  conditions: Condition[];
  observations: Observation[];
  consents: ConsentResource[];
  carePlans: CarePlan[];
};
```

how to implement:
1. Create `src/fixtures/seed-clinic.ts`.
2. Include at minimum:
   - 2 patients.
   - 1 encounter with a `behavioral-health` section and a `general` section.
   - 1 condition tagged `reproductive-health` belonging to a minor patient.
   - 1 critical observation (abnormalFlag: `'HH'`).
   - 1 consent permitting treatment but restricting external-provider access to `behavioral-health`.
   - 1 consent that is active and then revoked at a fixture date.
3. Create `test/seed-clinic.test.ts`.

acceptance:
- `SEED_CLINIC` type-checks without error.
- `SEED_CLINIC.encounters.some(e => e.sections.some(s => s.sensitivity === 'behavioral-health'))` is true.
- `SEED_CLINIC.observations.some(o => o.abnormalFlag === 'HH')` is true.
Run `npm test` → green.

---

**P14 — PDP meta-test (no-bypass architectural fitness)**
dependsOn: P06, P13
files: `test/pdp-meta.test.ts`

interface: No production code. This card is a static/grep-based architectural assertion.

how to implement:
1. Create `test/pdp-meta.test.ts`.
2. The test reads `src/core/resources.ts` and all files that import from it. It asserts that no file outside `src/core/pdp.ts` directly returns a `FhirResource` (or any subtype) to a caller without having called `authorize`.
3. Practical implementation: since we cannot instrument all call sites easily in a unit test, use a simpler proxy: assert that `src/core/view-model.ts` only exports view-model types (redacted encounters), not raw `FhirResource`; and that every function in `src/core/results-inbox.ts`, `src/core/note-workflow.ts`, and `src/core/care-plan.ts` has an `auditLog` parameter (which is the enforcement marker for "went through a logging path"). This is not a full static-analysis pass — it is a test that the key exported functions have the right shape.

acceptance:
- `applyRedactionObligations` accepts an `Encounter` and `Obligation[]` — if the signature changes to accept a raw resource + no obligations, this test fails.
- `ingestResult`, `acknowledgeResult`, `checkSla` all accept `auditLog: AuditLog` in their signatures (verified by importing and checking `.length` of the function's parameter list via `Function.length` — or simply assert the function calls compile correctly with the right types in a typed call).
- The test file itself compiles and passes.
Run `npm test` → green.

---

**P15 — Five-principal × sensitivity-matrix integration test**
dependsOn: P01 through P14
files: `test/pdp-matrix.test.ts`

interface: No new production code. Integration test only.

how to implement:
1. Create `test/pdp-matrix.test.ts`.
2. Use `SEED_CLINIC` resources and consents.
3. Test every combination required by E6 step 3 and the adversarial fixtures (E4):
   - Billing clerk reads encounter with `behavioral-health` section → `PermitWithObligations`, `behavioral-health` section is `[redacted]` after applying obligations.
   - Revoked consent at a clock time after revocation → `Deny`.
   - Break-glass with justification → `PermitWithObligations` with `heightened-audit`.
   - Minor patient, proxy access to `reproductive-health` after age threshold (use `proxyMayAccess`) → `Deny`.
   - Empty consent context → `Deny`.
4. For each `Permit` or `PermitWithObligations` result, assert exactly one access AuditEvent is appended.
5. For each `Deny`, assert exactly one denial AuditEvent is appended.

acceptance: All 5+ matrix assertions pass. AuditEvent counts match access counts. Run `npm test` → green.

---

**P16 — Amendment + result-inbox adversarial fixtures + invariant test**
dependsOn: P01 through P15
files: `test/invariants.test.ts`

interface: No new production code. Property/invariant test.

how to implement:
1. Create `test/invariants.test.ts`.
2. Test the amendment-after-signature adversarial fixture: sign a note, attempt to directly mutate its `sections` (set a property), assert the original object is unchanged (TypeScript readonly should catch this at compile time; add a runtime check too).
3. Test the normal-result non-event: ingest a normal observation → no `followUpTaskId`.
4. Test the double-book + waitlist: book two appointments in the same slot with overbookLimit=1 → second is waitlisted; cancel the first → waitlisted becomes scheduled.
5. Test audit totality: after running the full P15 matrix, `auditLog.getAllEvents().length` equals the number of access attempts made in the test.
6. Test consent monotonicity: revoking a consent does not alter any existing AuditEvent (the array before revocation === the array after revocation, just with new events appended).

acceptance: All assertions pass. Run `npm test` → green.

---

### 3. Decomposition method for the rest of the spec

After the first slice (P01–P16) passes, expand remaining breadth using this repeatable recipe:

**Recipe: one feature cluster = one dependency group of 2–4 small cards**

For each remaining feature:
1. **Types extension card** (if new types needed): define them in `src/core/types.ts` or a new `src/core/<feature>-types.ts`. Always first.
2. **Pure-logic card**: the core function / class — no I/O, no UI, no network. Must import only from `src/core/` and `src/fixtures/`.
3. **Fixture card**: add named fixture objects to `src/fixtures/`.
4. **Acceptance card**: write the test file first if helpful — name it `test/<feature>.test.ts`.

**Worked example A — HL7 v2 ORU result adapter**

Break into 3 cards:
- `P17` — Add `HL7OruMessage` type: `{ messageType: 'ORU^R01'; patientId: string; observations: { obxCode: string; value: string; abnormalFlag?: string; units?: string }[] }`. dependsOn: P01. files: `src/core/hl7-types.ts`. Acceptance: type-checks.
- `P18` — `parseOruToObservations(msg: HL7OruMessage, patientId: PatientId): Observation[]`. Maps each OBX entry to an `Observation`, normalizing `abnormalFlag` to the typed union. dependsOn: P04, P17. files: `src/core/hl7-adapter.ts`, `src/fixtures/hl7-fixtures.ts`. Acceptance: fixture ORU with `abnormalFlag: 'HH'` → parsed `Observation` with `abnormalFlag: 'HH'`.
- `P19` — Wire the adapter into the results inbox: `ingestFromOru(msg, clock, auditLog)` calls `parseOruToObservations` then `ingestResult` for each. dependsOn: P09, P18. files: `src/core/results-inbox.ts` (edit). Acceptance: `ingestFromOru` for a fixture with one abnormal OBX + one normal OBX → two inbox entries, one with `followUpTaskId`, one without.

**Worked example B — Consent revocation race condition**

Break into 2 cards:
- `P20` — Extend `ConsentResource` with an `effectiveHistory: { status: ConsentResource['status']; changedAt: Date }[]` field. dependsOn: P05. files: `src/core/consent.ts` (edit). `revokeConsent(consent, clock) → ConsentResource`: appends to `effectiveHistory`, sets `status: 'revoked'`, `revokedAt: clock.now()`. Acceptance: revoking appends to `effectiveHistory` without altering past entries.
- `P21` — Test the race: an external provider accesses at T−1 (permitted, AuditEvent logged), revoke at T, external provider accesses at T+1 (denied, AuditEvent logged). Assert both AuditEvents exist in the log with correct decisions. dependsOn: P06, P20. files: `test/consent-revocation-race.test.ts`. Acceptance: `auditLog.getAllEvents().length === 2`; first has `decision: 'Permit'`; second has `decision: 'Deny'`.

**Worked example C — Break-glass that must shout**

Break into 2 cards:
- `P22` — The break-glass fixture: a `Consent` that restricts all non-treatment access to behavioral-health data + an ED clinician principal + `breakGlassJustification: 'Patient unresponsive, treatment required'`. dependsOn: P06. files: `src/fixtures/break-glass-fixtures.ts`. Acceptance: fixture type-checks.
- `P23` — Full break-glass path: `authorize(edClinician, 'read', behavioralHealthResource, breakGlassContext, clock)` → `PermitWithObligations`. Discharge obligations: heightened AuditEvent with `heightened: true`; privacy-officer notification task queued. Same call without `breakGlassJustification` → `Deny`. dependsOn: P06, P22. files: `test/break-glass.test.ts`. Acceptance: all assertions pass; `auditLog.getAllEvents().find(e => e.heightened)` is truthy for the permitted case.

---

### 4. Per-task implementation conventions

**File/folder layout**

```
src/
  core/             # pure domain logic — no I/O, no frameworks
    types.ts        # P01: all shared type definitions
    clock.ts        # P02: Clock interface
    fixed-clock.ts
    audit-log.ts    # P03
    resources.ts    # P04: FHIR-shaped resource types
    consent.ts      # P05
    pdp.ts          # P06: Policy Decision Point
    view-model.ts   # P07: redaction obligations
    note-workflow.ts  # P08
    results-inbox.ts  # P09
    scheduling.ts   # P10
    care-plan.ts    # P11
    proxy-policy.ts # P12
  fixtures/         # static deterministic data
    clinic-resources.ts
    consents.ts
    result-fixtures.ts
    schedule-fixtures.ts
    seed-clinic.ts
test/               # one file per card; mirror module names
```

**Naming conventions**
- All resource types: PascalCase matching FHIR names (`Patient`, `Encounter`, `Observation`).
- Branded IDs: `PatientId`, `PractitionerId`, `ResourceId`.
- PDP result: always return a `PolicyDecision` union; never return `true`/`false` directly.
- Obligations: always a typed `Obligation[]`; never a bare string.

**How to write a test (minimal working example)**

```ts
// test/example.test.ts
import { describe, it, expect } from 'vitest';
import { authorize } from '../src/core/pdp.js';
import { FixedClock } from '../src/core/fixed-clock.js';
import { SEED_CLINIC } from '../src/fixtures/seed-clinic.js';

describe('PDP - billing staff', () => {
  it('redacts behavioral-health section for billing', () => {
    const clock = new FixedClock(new Date('2025-06-01T12:00:00Z'));
    const result = authorize(
      { role: 'billing-staff', actorId: 'billing-01' },
      'read',
      SEED_CLINIC.encounters[0],
      { purpose: 'billing', consents: SEED_CLINIC.consents },
      clock
    );
    expect(result.decision).toBe('PermitWithObligations');
  });
});
```

**How to keep it deterministic**
- All fixture dates: `new Date('2025-MM-DDTHH:mm:ssZ')` — always UTC ISO strings.
- Never call `new Date()` without a literal argument in tests or fixtures.
- AuditLog is instantiated fresh per test (in `beforeEach` or at the top of each `it` block) so audit counts are isolated.
- Sort arrays before asserting contents.

**How to wire a fixture adapter**
The PDP + AuditLog are the two primary seams:
```ts
const auditLog = new AuditLog();
const clock = new FixedClock(new Date('2025-06-01T00:00:00Z'));
const decision = authorize(principal, action, resource, context, clock);
// Always record the access regardless of decision:
auditLog.appendAccess({ ... decision fields ... });
```

**Definition of done for any card**
1. `npm test` exits 0.
2. `tsc --noEmit` exits 0.
3. The test file for the card has at least one passing assertion per exported function/method.
4. No production module calls `Date.now()`, `Math.random()`, or makes any network call.
5. No `any` type in production files.

---

### 5. Common pitfalls for a weak model on this project

**Pitfall 1 — Scattering role checks instead of using the PDP**
The most common mistake: writing `if (principal.role === 'clinician') { return data; }` directly in resource-access functions instead of routing through `authorize`. The meta-test (P14) and the architectural rule in E0 catch this. The fix is always to call `authorize` first and apply the returned obligations before touching data.

**Pitfall 2 — Treating consent as a boolean flag**
A model that implements `consent.active = true/false` will break every nested-provision scenario (E4 billing-clerk peek, minor-proxy aging-out). The `ConsentResource` must have a `provision` tree, and `evaluateConsent` must walk it. If any E4 adversarial test fails, check whether the provision walker is implemented.

**Pitfall 3 — Forgetting the heightened-audit obligation in break-glass**
Break-glass returns `PermitWithObligations`; the caller must discharge the obligations (append a `heightened: true` AuditEvent, notify privacy officer). A model that returns `Permit` (not `PermitWithObligations`) for break-glass — or returns `PermitWithObligations` but never discharges the obligations — fails P15 and P23.

**Pitfall 4 — Mutating signed notes in place**
`amendNote` must return a new object; the original must be unchanged. A model that does `note.status = 'amended'` in place will fail P08 and P16. Always spread: `return { ...note, status: 'amended', amendments: [...note.amendments, newAmendment] }`.

**Pitfall 5 — Using `Date.now()` for consent revocation or SLA checks**
If `checkSla` or `evaluateConsent` calls `Date.now()` or `new Date()`, the test will be time-dependent and will pass or fail depending on when it runs. Every time read must go through the injected `Clock`. The tell-tale failure: a test that passes in the morning fails in the afternoon.

**Pitfall 6 — Creating follow-up tasks for normal results**
E4 explicitly tests the negative case ("normal-result non-event"). A model that creates a task for every ingested result — regardless of `abnormalFlag` — will fail P09 and P16. The guard is `if (obs.abnormalFlag) { entry.followUpTaskId = ... }`.

**Pitfall 7 — Losing the original note content on amendment**
The amendment must produce a new `NoteAmendment` with a `delta` that records both old and new content. If the model only stores the new content and discards the old, `P16` invariant test will fail (original content is not reconstructable). Store `oldContent` from `note.sections.find(s => s.label === update.label)?.content` before replacing.

**Pitfall 8 — Breaking deny-by-default with a permissive fallback**
E5 §4: "an empty/unknown policy context yields `Deny`." A model that returns `Permit` when `context.consents` is empty will fail the deny-by-default test. The PDP's Step 5 must be: "If no affirmative grant found after all checks → `Deny('no affirmative grant')`."
