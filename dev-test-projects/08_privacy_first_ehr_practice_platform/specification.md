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
