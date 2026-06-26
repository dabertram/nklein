# 02 - Construction Jobsite Safety and Compliance Control Room

Complexity tier: 2/20
Expected decomposition size: 14-18 dependent implementation cards before coding.
Domain pressure: jobsite safety, permits, hazard controls, incident reporting, offline field workflows, OSHA-style compliance evidence.
Acceptance command: npm test

## How to use this challenge
This is a dev-test project specification for evaluating whether an autonomous coding agent can decompose a real domain, identify knowledge gaps, build a correct foundation, and verify it with deterministic tests. The goal is not to finish the entire product. The goal is to build a durable foundation that proves the agent understood the domain boundaries and can implement the highest-risk core behaviors without hiding behind placeholders.

The agent must read this entire specification before planning. It must create a dependency-linked plan, record domain knowledge debt, and choose a narrow release slice that still exercises the real hard parts. Prefer fewer production-quality vertical slices over many shallow labels.

## Product vision
Build a real jobsite safety and compliance platform for general contractors managing multiple active sites. The product should turn permits, daily hazard assessments, toolbox talks, inspections, and incident evidence into an operational control room that works even when field devices are offline.

## Foundation release scope
The first serious buildout must include:
- Sites, contractors, crews, workers, equipment, zones, permits, inspections, observations, corrective actions, and incidents as first-class entities.
- Daily pre-task planning workflow with hazard identification, controls, sign-off, and missed-signature escalation.
- Permit lifecycle for hot work, confined space, energized work, excavation, crane lift, and roof work.
- Inspection engine with versioned checklists, failed item severity, required evidence, and due dates.
- Offline event log that can accept field updates out of order and reconcile them without losing provenance.
- Incident timeline builder that links witnesses, photos, equipment, weather, permit state, and corrective actions.
- Dashboard that prioritizes imminent permit expirations, high-risk zones, open corrective actions, and repeat offenders.
- Seed scenario with two sites, subcontractor handoffs, an excavation permit conflict, and a near-miss investigation.

## Architecture requirements
- Keep compliance rules separate from field-entry forms so new rule packs can be added without rewriting screens.
- Model offline sync as conflict-aware commands with server acceptance decisions and human review paths.
- Represent zones and equipment assignments independently from current UI maps.
- Make evidence attachments metadata-rich even if binary upload is stubbed by deterministic fixtures.

## Domain knowledge debt to surface
The agent should not pretend to know every regulation, standard, or numerical model perfectly. It should implement a defensible deterministic subset, mark assumptions explicitly, and create extension points where real-world integrations or expert-reviewed rule packs would live. Required knowledge areas:
- Construction compliance depends on traceability: who knew what, when, and which control was required.
- Offline conflict handling must preserve both versions when the merge is unsafe.
- Permits are temporal and spatial; a valid permit can still be invalid for the wrong zone or crew.
- Safety dashboards should rank operational risk, not simply count open items.

## Decomposition pressure
This project should force decomposition across domain modeling, calculation or policy engines, workflow state, deterministic fixtures, auditability, and UI/view-model boundaries. The plan should include dependency links so shared primitives and invariants are built before dependent workflow features. Avoid starting with screens. Start with the domain model, invariants, and tests that would make later screens trustworthy.

The agent should maintain a visible knowledge-debt list covering unclear standards, units, legal or safety constraints, numerical assumptions, terminology, fixture limitations, and future expert-review checkpoints. Knowledge debt is not a failure; hiding it is.

## Acceptance criteria
- Permit validation catches expired, wrong-zone, missing-signature, and conflicting-work cases.
- Offline command replay is deterministic and produces review conflicts for unsafe merges.
- Incident timelines are reconstructed from append-only events.
- Compliance reports cite exact checklist versions and sign-off evidence.
- The project passes npm test without external services.

## Explicit non-goals
- Do not build a generic todo app with safety-themed names.
- Do not require GPS, camera, or cloud upload for deterministic foundation tests.
- Do not flatten permits and inspections into untyped notes.

## Quality bar
- Use typed domain objects and pure core modules wherever practical.
- Keep deterministic fixtures in the repository and do not depend on live APIs for acceptance tests.
- Test edge cases before building broad UI coverage.
- Every risk score, recommendation, workflow transition, or generated report must be explainable from source facts.
- Stubs are acceptable only at external integration boundaries and must be named as adapters with deterministic fixture implementations.
- The foundation should be extensible into a real product if later teams add integrations, expert-reviewed rule packs, and production UI.

---

# Extended scope & deep-reasoning extensions (v2)

> Added 2026-06-26 via deep domain research. **The single defining property of this project:** a jobsite-safety record is only as good as its *traceability under contested, out-of-order, partially-offline reality* — so the hard problem is not the forms, it is reconciling a **temporally and spatially scoped authorization model** (permits valid for *this* zone, *this* crew, *this* window, *this* checklist version) against an **append-only event log that arrives late, out of order, and sometimes conflicting**, while never silently losing a signature, a control, or a provenance link. Build that spine; the screens are downstream.

## E0. Why this is the right shape of challenge (despite the modest tier)

This is a tier-2 challenge, so the *breadth* is bounded — but the **depth of the two load-bearing seams is not.** A weak swarm will model permits as rows with a `status` column and "merge" offline edits with last-write-wins. Both are wrong in ways that, in the real world, *get people killed and fail audits*. The grading question is whether the agents discover that:

1. **Authorization is a 4-axis predicate, not a status flag.** A permit is valid only at the intersection of `(time-window ∧ zone ∧ crew/role ∧ control-state ∧ checklist-version)`. A "valid" hot-work permit is *invalid* the moment work moves 30 feet into an un-permitted zone, or the fire-watch signs off late, or the crane swing-radius overlaps the same zone in the same window (conflicting-work). [OSHA permit-required confined space §1910.146: a permit "may not exceed the time required to complete the assigned task," is space-specific, and must be cancelled when *any* prohibited condition arises in or near the space — https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.146]
2. **Offline is a distributed-systems problem, not a UI sync spinner.** Field devices accept entries out of order and offline; the server must reconcile **causally** and **preserve both versions when the merge is unsafe** rather than collapsing to a winner. This is the CRDT/causal-ordering problem applied to a *safety* domain where "eventually consistent" must never mean "a signature quietly vanished."

Everything below makes those two seams testable, conservative, and explainable.

## E1. Research-grounded domain authenticity (the standards a domain expert will check for)

The model must speak the real regulatory language, with these grounded specifics baked into fixtures and rule packs:

- **Permit-to-work taxonomy with real gating data:**
  - **Hot work** — fire watch required *during and after*; minimum **30 minutes** post-work per OSHA 1910.252, but **NFPA 51B** (the standard most jurisdictions now adopt) requires **60 minutes**; the rule pack must make this a *configurable, cited* parameter, not a magic constant. [https://www.osha.gov/etools/oil-and-gas/general-safety/hot-work-welding ; https://fastfirewatchguards.com/what-are-osha-hot-work-permit-requirements/] Hot work *inside* a confined space requires **both** a hot-work permit **and** a confined-space permit, jointly. [https://www.osha.gov/etools/shipyard/shipbuilding/hot-work/confined-spaces]
  - **Permit-required confined space (§1910.146 / Construction Subpart AA §1926.1200s)** — entry permit must name the space, authorized entrants (by name or roster), the **attendant**, the **entry supervisor**, hazards, isolation/controls, **acceptable entry conditions**, **initial + periodic atmospheric test results with tester initials**, and rescue-service contact. Atmospheric thresholds are hard numbers: **O₂ acceptable 19.5%–23.5%** (below = deficient, above = enriched), **flammables ≤ 10% LEL**, toxics within PELs; testing order is O₂ → flammables → toxics. [https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.146]
  - **Control of hazardous energy / LOTO (§1910.147)** — documented energy-control procedure, per-isolation-point lock/tag, verification of zero-energy state; LOTO is frequently a *prerequisite* of confined-space entry, so the model must support **permit dependencies** (entry blocked until the LOTO permit's isolation points are all verified). [https://www.osha.gov/laws-regs/standardinterpretations/1996-01-11-1]
  - **Excavation / trenching (§1926 Subpart P)** — **competent-person inspection daily and after any change (rain, vibration, soil movement)** before entry; **protective system required at ≥ 5 ft** unless stable rock; **soil classification** Stable Rock / Type A (cohesive, unconfined compressive strength **≥ 1.5 tsf**) / Type B / Type C; **egress (ladder/ramp) within 25 ft** for trenches **≥ 4 ft**; spoil-pile setback; atmospheric testing where a hazardous atmosphere could exist. [https://www.osha.gov/laws-regs/regulations/standardnumber/1926/1926.651 ; https://www.osha.gov/sites/default/files/publications/OSHA2226.pdf] Note the "competent person" is a *typed role with authority to stop work*, not a name field.
  - **Crane / critical lift (§1926.1400s)** — operator certification (**NCCCO/NCCER** per §1926.1427); **pre-shift inspection** (§1926.1412); a **critical-lift plan** triggered when a lift exceeds **75% of rated capacity**, lifts over personnel, or uses multiple cranes; ground-bearing/stability assessment. [https://jsabuilder.com/job-safety-analysis/crane-operations/]
- **Pre-task planning chain:** JHA/JSA → toolbox talk → daily pre-task plan with **hazard identification, the chosen control, sign-off, and missed-signature escalation**. The control chosen must be expressible on the **hierarchy of controls** (Elimination → Substitution → Engineering → Administrative → PPE) — an ISO 45001 / NIOSH mandate; a plan that mitigates a fall hazard with "PPE: be careful" when an engineering control was available is a *flaggable* weakness, not just a note. [https://www.iso.org/obp/ui/en/#!iso:std:63787:en]
- **Incident / near-miss model grounded in real regimes:**
  - **ISO 45001** treats a **near-miss / close-call** (potential-but-no-harm) as a first-class incident; investigation must reach **immediate causes → underlying causes → root causes (management-system deficiencies)**. [https://www.iso.org/obp/ui/en/#!iso:std:63787:en ; https://www.assurx.com/aligning-incident-management-with-iso-45001-requirements/]
  - **ICAM** (Incident Cause Analysis Method) is the construction-standard investigation frame: four causal categories — **Absent/Failed Defences, Individual/Team Actions, Task/Environmental Conditions, Organisational Factors** — explicitly *systems-focused, not blame-focused*. The incident timeline must support classifying contributing factors into these buckets. [https://sitemate.com/resources/articles/safety/icam-investigation/]
  - **OSHA recordkeeping (29 CFR 1904):** the **300 Log**, **300A annual summary**, **301 incident report**; recordability criteria (death, days away, restricted work / job transfer = **DART**, medical treatment beyond first aid, loss of consciousness); **record within 7 calendar days**; **retain 5 years**. The classification engine (recordable? DART? first-aid-only?) is a *pure, testable rule function*. [https://www.osha.gov/recordkeeping/forms ; https://www.osha.gov/recordkeeping/recording]
- **Safety analytics grounded in real metrics:** lagging — **TRIR** = (recordable cases × 200,000) / hours worked; **DART rate** similarly; leading — near-miss reporting rate, **observation-to-action close-out latency** (target close-out 24–72 h for critical), toolbox-talk attendance/coverage, corrective-action closure %. The dashboard must **rank operational risk, not count open items** — a per-zone risk score that *rises* when a high-severity corrective action ages past its window. [https://www.highwire.com/blog/leading-indicators ; ANSI/ASSP Z10.0 OHSMS leading/lagging guidance]

## E2. The hardest technical seam #1 — the 4-axis temporal-spatial authorization engine

Model a permit's validity as a **pure predicate over a fact-set**, never a stored boolean:

```
isAuthorized(action, atTime, inZone, byCrew, given facts) →
   Valid | Invalid(reasons[]) | Conflicting(otherPermitId, overlap)
```

Required to compute, each as an independently-testable rule, returning *cited* reasons:

- **Temporal:** is `atTime` inside `[issuedAt, expiresAt]` *and* inside the assigned work window? Has a required time-bound control fired (fire-watch start, periodic re-test interval for confined space)? **Expired** and **prematurely-active** are distinct reasons.
- **Spatial:** is `inZone` within the permit's authorized zone-set? Zones are modeled **independently of any UI map** (a zone is an identity + adjacency, not pixels). Work that drifts into an adjacent un-permitted zone → invalid-wrong-zone.
- **Crew/role:** is `byCrew` (or the named entrant/competent-person/certified-operator) on the permit's authorized roster, with the *required role* present (an excavation entry with no competent-person on shift → invalid)?
- **Control-state:** are all prerequisite controls satisfied — LOTO isolation points all verified-zero, atmosphere within thresholds on the latest test, fire watch posted? A permit with a stale atmospheric test (older than the periodic-retest interval) is invalid even inside its time window.
- **Conflicting-work (the subtle one):** two individually-valid permits whose `(zone × time-window)` overlap in an **incompatible** way (crane swing-radius over a confined-space entry; hot work adjacent to an open excavation venting flammables). This requires a **zone-time interval-overlap check** against *other live permits*, classified by a compatibility matrix. The seed scenario's "excavation permit conflict" lives here.

**Invariant:** authorization is **monotone in evidence** — adding a *blocking* fact can only move a permit toward Invalid/Conflicting, never toward Valid; clearing a permit to Valid requires the *positive* facts to be present, not merely the absence of negatives. Property-test it.

## E3. The hardest technical seam #2 — conflict-aware offline reconciliation that never loses provenance

Field reality: devices are offline, entries arrive **out of order**, two foremen edit the same pre-task plan, a signature syncs *after* the incident that depended on it. The server is the reconciler.

- **Commands, not state, sync.** Every field action is an **immutable command** carrying: a stable client-generated id, the **actor**, a **causal stamp** (a hybrid-logical-clock / version-vector entry so the server can order causally without trusting device wall-clocks — devices in the field have skewed clocks), the **target entity + base-version it observed**, and payload. [Causal ordering via HLC/version vectors — https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type] Consider a small **CRDT toolkit** for the convergent fields (e.g. an observation's tag-set, a last-writer-wins register for a free-text note) rather than hand-rolling merge — but only where convergence is *safe*. [https://medium.com/@2nick2patel2/typescript-crdt-toolkits-for-offline-first-apps-conflict-free-sync-without-tears-df456c7a169b]
- **Server acceptance is a typed decision**, recorded as its own event: `Accepted | AcceptedReordered | ConflictHeld(bothVersions, reason) | RejectedSafetyGate`. The acceptance policy is the heart of the system.
- **Safe-merge vs. unsafe-merge is domain-specific, not generic LWW.** Concurrent edits to *independent* fields (one foreman adds a hazard, another adds attendees) auto-merge. Concurrent edits to a **safety-load-bearing field** — a sign-off, a chosen control, a permit's acceptable-entry-conditions, an atmospheric reading — that **diverge** must produce a **ConflictHeld** that preserves **both versions verbatim** with full provenance and routes to **human review**. *"When the merge is unsafe, preserve both versions"* is a hard requirement, property-tested: no reconciliation path may ever leave only one of two conflicting safety-critical values without an explicit human resolution event.
- **Late-arriving causality must not rewrite history dishonestly.** If a signature command arrives with a causal stamp *prior* to an incident that has already been built, the incident timeline must **re-project** to reflect the now-known fact **and record that it was learned late** (an `evidence-learned-late` annotation) — never silently backdate as if it had always been there. The append-only log is truth; projections fold over it.
- **Determinism:** given the same multiset of commands in *any* delivery order, the reconciled state + the set of held conflicts is **identical**. This is the offline acceptance test: shuffle the command stream with a seeded permutation, replay N times, assert byte-identical projected state and identical conflict set.

## E4. Determinism & testability strategy

- **Virtual clock everywhere.** Permit expiry, fire-watch post-work windows, confined-space periodic-retest intervals, corrective-action aging, escalation timers — all read an injected clock. Tests advance it explicitly. No `Date.now()` on any rule path.
- **Seeded entropy** for the command-shuffle reconciliation tests and for any sampled ordering — a run is reproducible from `(seed, command-log)`.
- **Event-sourced core.** The authoritative state is a fold over the append-only command/acceptance/decision log. Incident timelines, permit state, dashboard risk scores are **projections**. Free time-travel + audit + crash recovery.
- **Fixture adapters at every external boundary**, named as adapters with deterministic implementations: **evidence-attachment store** (metadata-rich — content hash, capture time, capturing actor, geo *as data not requirement*, mime, size — even though binary upload is stubbed), **weather provider** (scripted per-site/per-time so incident timelines can cite "rain → trench re-inspection trigger"), **notification/escalation sink** (records would-be notifications, never sends), **clock**, and **device-sync transport** (delivers commands in scripted/shuffled order, including duplicates and drops). The acceptance command (`npm test`) never touches a network, camera, or GPS.
- **No GPS/camera/cloud dependency** for the foundation tests (explicit non-goal honored); zones and evidence are pure data.

## E5. Adversarial, failure, and edge-case scenarios (ship them as fixtures)

A real jobsite is messy and occasionally dishonest. Encode these as deterministic fixtures the system must handle correctly:

1. **The phantom signature.** A pre-task sign-off command is duplicated (retry over flaky connectivity). Idempotency on command-id must collapse it to **one** signature, not two — and not lose it.
2. **The clock-skewed device.** A device with a wall-clock 40 minutes fast submits a permit-extension that *looks* like it precedes the original issue. Causal stamps (not device wall-clock) order it correctly; the wall-clock is retained as metadata, never used for ordering.
3. **The unsafe concurrent control change.** Two foremen, both offline, change a confined-space entry's "acceptable entry conditions" to *different* values. Reconciliation must **hold both**, block entry authorization while held, and demand human resolution — not pick the later timestamp.
4. **The wrong-zone drift.** A valid hot-work permit; work logged in an adjacent zone. Authorization flips to invalid-wrong-zone; if the adjacent zone has an open excavation venting flammables, it escalates to **conflicting-work** with the excavation permit.
5. **The expired-but-active near-miss.** A confined-space permit whose periodic atmospheric retest lapsed; an entrant is still inside per the attendant's count. The system flags an **active prohibited condition** and the incident builder can later reconstruct exactly when the permit went stale vs. when the entrant entered.
6. **The late-learned causal fact.** An incident timeline is built; *then* a sign-off command arrives with an earlier causal stamp showing the required control was actually absent at incident time. The timeline re-projects and annotates the fact as learned-late — changing the ICAM "Absent/Failed Defence" classification, **with both the before and after states auditable.**
7. **The recordability trap.** An injury initially logged as first-aid-only; a follow-up command upgrades it to "required sutures" (medical treatment beyond first aid). The 1904 classifier must **reclassify to recordable/DART** and the 300-Log projection must update, citing the upgrading event — within the 7-day window, with the window itself tracked.
8. **The repeat-offender pattern.** The same subcontractor crew accumulates missed-signature escalations across two sites; the dashboard's risk ranking must surface them above sites with more *but lower-severity* open items.

## E6. Rigorous acceptance criteria (invariant + property-based, not just examples)

In addition to the base acceptance criteria, the following must hold:

- **Reconciliation determinism (property):** for any seeded permutation of a fixed command multiset (with injected duplicates/drops-then-redeliveries), the projected state and the held-conflict set are **byte-identical** across runs.
- **No-silent-loss-of-safety-data (invariant):** there exists **no** reconciliation path that resolves a divergent safety-critical field to a single value without a corresponding human-resolution event in the log. (Differential test: scan the log; every safety-critical convergence is justified by either non-divergence or an explicit resolution.)
- **Authorization monotonicity (property):** adding a blocking fact never moves a permit toward Valid; fuzz random fact-sets.
- **Totality of provenance (invariant):** every dashboard risk score, every authorization decision, every recordability classification, and every report line is reconstructible to source commands/events; **redact the human-readable prose and the structured record alone still answers** "why was this permit invalid / why is this zone high-risk / why is this case DART?".
- **Checklist-version citation (invariant):** every compliance report line cites the **exact checklist version** and the specific sign-off evidence used; a checklist that was versioned mid-week must show old-version evidence for items completed before the bump.
- **Append-only incident reconstruction:** incident timelines are pure folds over events; re-folding yields the identical timeline; late-learned facts appear with their learned-late annotation.
- **Idempotency:** replaying any command by id is a no-op on state.

## E7. The concrete first vertical slice (the on-ramp — ~14–18 cards, build THIS first)

Per the spec's own tier-2 budget, prove the spine end-to-end on **one permit type + one incident**, not breadth across all six permit types:

1. **Domain core + event log:** typed entities (Site, Zone w/ adjacency, Crew, Worker, Permit, Inspection, Observation, CorrectiveAction, Incident) + the append-only command/acceptance/decision log + virtual clock + seeded PRNG. (~4 cards)
2. **The authorization engine (E2)** for **confined-space entry** specifically (richest gating: roster, attendant/supervisor roles, O₂/LEL thresholds, periodic-retest interval, LOTO-prerequisite dependency) as a pure predicate with cited reasons + the conflicting-work zone-time overlap check. (~3 cards)
3. **The offline reconciler (E3):** command ingestion, causal ordering via version-vector/HLC, the typed acceptance decision, safe-merge vs. ConflictHeld-on-unsafe with both-version preservation, idempotency. (~3 cards)
4. **The 1904 recordability classifier** + 300-Log/300A projection for one incident, with the first-aid→recordable reclassification path. (~2 cards)
5. **Incident timeline builder** as an event fold linking witnesses, evidence-metadata, equipment, weather-fixture, permit-state-at-time, and corrective actions; ICAM contributing-factor classification; late-learned-fact annotation. (~2 cards)
6. **The risk-ranking dashboard view-model** (operational risk, not counts) + the deterministic test battery: the command-shuffle property test, the no-silent-loss invariant, authorization monotonicity, and the totality-of-provenance redaction test — all green on this slice including the seed scenario (two sites, subcontractor handoff, excavation-permit conflict, near-miss investigation). (~2 cards)

If that slice holds, the other five permit types are *rule-pack breadth on a proven engine*; the additional screens are projections of an already-trustworthy core.

## E8. Domain knowledge-debt to track (surface, don't bluff)

The agents must keep a live, *action-gating* knowledge-debt ledger (hiding debt is the failure, per the spec). Genuine unknowns to flag for expert review:

- **Fire-watch duration** (30 min OSHA 1910.252 vs. 60 min NFPA 51B) is jurisdiction-dependent — parameterize + flag, never hard-code one as universal truth.
- **Confined-space periodic-retest interval** and **acceptable-entry-condition specifics** vary by space and substance; the fixtures encode *a defensible subset*, marked as expert-review-needed before production.
- **State-plan OSHA states** (e.g. Cal/OSHA) impose stricter or different rules; the rule-pack architecture must admit a jurisdiction dimension.
- **1904 recordability** has genuinely subtle cases (work-relatedness, pre-existing-condition aggravation, mental-health, COVID-era guidance) — implement a conservative subset; flag the gray zones for safety-professional review rather than guessing.
- **Soil classification** (Subpart P Appendix A) requires competent-person field judgment; the system can record the *classification claimed* and flag when a protective system appears mismatched, but must not pretend to *make* the geotechnical call.
- **ICAM contributing-factor taxonomy** mapping is interpretive; the structured buckets are provided, but final causal classification is a human-investigator judgment the system *supports*, not *replaces*.
- **PII / worker-privacy:** the 300-Log has a **privacy-case** concept (certain injuries omit the employee name); model the privacy flag even though full HIPAA/PII handling is future work.

## E9. Why this is a great !Klein challenge

It is small enough to *finish a real slice* yet it punishes the two failure modes weak agents fall into hardest: **(a) modeling a safety authorization as a status flag** instead of a multi-axis temporal-spatial-control predicate, and **(b) treating offline sync as last-write-wins** instead of a causal, conflict-preserving, provenance-total reconciliation. Both are *deterministically testable* (virtual clock + seeded command-shuffle), so a swarm of small local models is graded on **discovering the right invariants and refusing to lose safety data**, not on cleverness. The whole thing is explainable-from-source-facts by construction (event-sourced + cited rule reasons), which is exactly the auditability discipline !Klein exists to prove — at a tier where a governed small model can plausibly land the entire spine green.
