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

---

## Small-model build guide (3B-ready)

This section makes the spec mechanically buildable by a ~3B parameter local model. Every card below is small enough to implement and verify in isolation. Follow the dependency order exactly — do not skip ahead.

### 1. Glossary & ground rules

**Domain terms:**

- **Site** — a named physical jobsite with a unique id; contains zones and hosts crews.
- **Zone** — a named spatial sub-region of a site; has an id, adjacency list (other zone ids it borders), and no coordinate data.
- **Crew** — a named group of workers operating at a site under a contractor; has a typed role (foreman, competent-person, attendant, entry-supervisor, operator).
- **Worker** — an individual with an id, name, role, and certifications list.
- **Permit** — a typed authorization (hot-work | confined-space | loto | excavation | crane-lift | roof-work) with fields: id, type, siteId, zoneIds[], crewId, authorizedRosterIds[], issuedAt (number/epoch), expiresAt (number/epoch), workWindowStart, workWindowEnd, controlState (object), prerequisitePermitIds[], checklistVersionId, and status (projection-only — never a stored field; always computed from the authorization predicate).
- **Inspection** — versioned checklist run against a site/zone; has checklistVersionId, completedAt, items (id, passed, severity, evidenceRef?), signoffById.
- **Observation** — a hazard or near-miss observation; has id, siteId, zoneId, reporterId, observedAt (clock), severity, corrective actions, and closeoutAt?.
- **CorrectiveAction** — linked to an Observation or Incident; has id, dueAt (clock), assigneeId, closedAt?.
- **Incident** — any harm or near-miss event; has id, siteId, zoneId, occurredAt (clock), type (near-miss | first-aid | recordable | dart | fatality), timeline (event fold), witnesses[], equipmentIds[], evidenceRefs[], permitIdAtTime?, icamFactors.
- **Command** — an immutable field action carrying: id (uuid-style string), actor (workerId), causalStamp (version-vector object), targetEntityId, targetBaseVersion (number), payload (typed union by command kind), clientCreatedAt (device wall-clock, metadata only — never used for ordering).
- **AcceptanceDecision** — typed server response to a Command: `Accepted | AcceptedReordered | ConflictHeld | RejectedSafetyGate`. Stored as an event in the log.
- **Version vector** — a `Record<string, number>` mapping actor id → logical clock; used for causal ordering without trusting device wall-clocks.
- **Virtual clock** — an injected `Clock` object with a single method `now(): number` returning milliseconds since epoch. All permit expiry, window checks, escalation timers, and corrective-action aging use `clock.now()`, never `Date.now()`.
- **Safety-critical field** — a field whose divergent concurrent edit must never be silently resolved: sign-offs, chosen controls, acceptable-entry-conditions, atmospheric readings, LOTO isolation-point verification status.
- **TRIR** — Total Recordable Incident Rate = (recordable cases × 200,000) / hours worked.
- **DART rate** — Days Away, Restricted, or Transferred rate = (DART cases × 200,000) / hours worked.
- **ICAM** — Incident Cause Analysis Method; four factor buckets: Absent/Failed Defences, Individual/Team Actions, Task/Environmental Conditions, Organisational Factors.
- **Hierarchy of controls** — Elimination > Substitution > Engineering > Administrative > PPE.
- **HoC rank** — integer 1–5 matching the above order (1 = strongest).
- **1904 recordable** — an OSHA-defined injury/illness category; includes death, days-away, restricted duty/transfer, medical treatment beyond first aid, loss of consciousness.
- **Checklist version** — a string id (e.g. `"cs-confined-space-v2"`) that is immutable once issued; a new version gets a new id.

**Stack:**

- Language: TypeScript (strict mode, no `any`).
- Runtime: Node.js 20+.
- Test runner: Vitest (`npm test` runs `vitest run`).
- No build step required for tests (ts-node or `vitest` with `@vitest/runner` handles TypeScript directly via `vite.config.ts` or `vitest.config.ts`).
- No external runtime dependencies beyond Node built-ins and `vitest`; all domain logic is pure functions.
- Fixture data lives in `src/fixtures/` as `.ts` files exporting typed constants — never JSON files (keep type-safety).
- Adapter interfaces live in `src/adapters/`; deterministic implementations live in `src/adapters/fixture/`.

**Acceptance command (exact steps):**

```
cd <project-root>
npm install        # first time only
npm test           # runs vitest run — must exit 0 with all suites green
```

No network, no GPS, no camera, no live LLM, no `Date.now()` on any rule path.

**Determinism rules (imperative):**

1. Never call `Date.now()`, `new Date()`, or `Math.random()` in any domain module. Use the injected `Clock` for time and the seeded PRNG from `src/lib/prng.ts` for any randomness.
2. Never import from a network adapter in a test. Use the fixture adapter in `src/adapters/fixture/`.
3. Every command is identified by its id. Replaying an already-applied command id is a no-op (idempotency).
4. The command log is append-only. Projections are folds over the log; they never mutate log entries.
5. A safety-critical field that diverges must produce `ConflictHeld`; no code path may auto-resolve it.

---

### 2. The explicit task graph for the first vertical slice

The first vertical slice covers E7 items 1–6: domain core, confined-space authorization engine, offline reconciler, 1904 classifier, incident timeline, and risk-ranking dashboard view-model. Build exactly these 16 cards in order.

---

**`S01` — Project scaffold and virtual clock**

dependsOn: none

files: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/lib/clock.ts`, `test/lib/clock.test.ts`

interface:
```ts
// src/lib/clock.ts
export interface Clock { now(): number }
export class RealClock implements Clock { now() { return Date.now() } }
export class ManualClock implements Clock {
  constructor(private _now: number) {}
  now() { return this._now }
  advance(ms: number) { this._now += ms }
  set(ts: number) { this._now = ts }
}
```

how to implement:
1. Create `package.json` with `{ "type": "module", "scripts": { "test": "vitest run" }, "devDependencies": { "vitest": "^1.6.0", "typescript": "^5.4.0" } }`.
2. Create `tsconfig.json` with `strict: true`, `moduleResolution: bundler`, `target: ES2022`.
3. Create `vitest.config.ts` that simply exports `defineConfig({})`.
4. Create `src/lib/clock.ts` with the two classes above.
5. Create `test/lib/clock.test.ts`.

acceptance: `test/lib/clock.test.ts` asserts: `new ManualClock(1000).now() === 1000`; after `advance(500)`, `now() === 1500`; after `set(0)`, `now() === 0`. Run `npm test` → green.

---

**`S02` — Seeded PRNG**

dependsOn: `S01`

files: `src/lib/prng.ts`, `test/lib/prng.test.ts`

interface:
```ts
// src/lib/prng.ts
export class SeededRng {
  constructor(seed: number) {}
  next(): number          // returns float in [0,1), deterministic
  nextInt(max: number): number  // integer in [0, max)
  shuffle<T>(arr: T[]): T[]     // Fisher-Yates in-place, returns same array
}
```

how to implement:
1. Use a simple LCG (linear congruential generator): `state = (state * 1664525 + 1013904223) & 0xFFFFFFFF`.
2. `next()` returns `state / 0x100000000`.
3. `nextInt(max)` returns `Math.floor(this.next() * max)`.
4. `shuffle` applies Fisher-Yates using `nextInt`.

acceptance: `test/lib/prng.test.ts` asserts: `new SeededRng(42).next()` is the same value across three separate calls with seed 42; `shuffle([1,2,3,4,5])` with seed 99 produces a specific known permutation (hard-code it in the test after computing it once). Run `npm test` → green.

---

**`S03` — Core domain types**

dependsOn: `S01`

files: `src/domain/types.ts`, `test/domain/types.test.ts`

interface (excerpt — write all fields listed in the glossary):
```ts
// src/domain/types.ts
export type PermitType = 'hot-work' | 'confined-space' | 'loto' | 'excavation' | 'crane-lift' | 'roof-work'
export type WorkerRole = 'foreman' | 'competent-person' | 'attendant' | 'entry-supervisor' | 'operator' | 'worker'
export type ControlHierarchyRank = 1 | 2 | 3 | 4 | 5  // 1=Elimination...5=PPE
export type CommandKind =
  | 'sign-pretask' | 'update-control' | 'update-acceptable-entry-conditions'
  | 'update-atmospheric-reading' | 'verify-loto-point' | 'log-incident' | 'close-corrective-action'

export interface Site { id: string; name: string; zoneIds: string[] }
export interface Zone { id: string; siteId: string; name: string; adjacentZoneIds: string[] }
export interface Worker { id: string; name: string; role: WorkerRole; certifications: string[] }
export interface Crew { id: string; siteId: string; contractorName: string; memberIds: string[]; foremanId: string }

export interface AtmosphericReading {
  o2Percent: number; lelPercent: number; coAsPpm: number; h2sAsPpm: number
  testedBy: string; testedAt: number; testerInitials: string
}

export interface ConfinedSpaceControlState {
  lotoPointsVerified: Record<string, boolean>   // isolationPointId -> verified
  atmosphericReadings: AtmosphericReading[]
  attendantId: string | null
  entrySupId: string | null
  authorizedEntrantIds: string[]
  periodicRetestIntervalMs: number
}

export interface Permit {
  id: string; type: PermitType; siteId: string; zoneIds: string[]
  crewId: string; authorizedRosterIds: string[]
  issuedAt: number; expiresAt: number
  workWindowStart: number; workWindowEnd: number
  controlState: ConfinedSpaceControlState  // union with other types later
  prerequisitePermitIds: string[]
  checklistVersionId: string
}

export interface VersionVector { [actorId: string]: number }

export type CommandPayload =
  | { kind: 'sign-pretask'; signerId: string; planId: string }
  | { kind: 'update-control'; permitId: string; controlHocRank: ControlHierarchyRank; description: string }
  | { kind: 'update-acceptable-entry-conditions'; permitId: string; conditions: string }
  | { kind: 'update-atmospheric-reading'; permitId: string; reading: AtmosphericReading }
  | { kind: 'verify-loto-point'; permitId: string; isolationPointId: string; verifiedBy: string }
  | { kind: 'log-incident'; incident: Omit<Incident, 'id'> }
  | { kind: 'close-corrective-action'; caId: string; closedBy: string }

export interface Command {
  id: string; actor: string; causalStamp: VersionVector
  targetEntityId: string; targetBaseVersion: number
  payload: CommandPayload; clientCreatedAt: number
}

export type AcceptanceStatus = 'Accepted' | 'AcceptedReordered' | 'ConflictHeld' | 'RejectedSafetyGate'
export interface AcceptanceDecision {
  commandId: string; status: AcceptanceStatus
  conflictingVersionA?: CommandPayload; conflictingVersionB?: CommandPayload
  reason?: string; resolvedBy?: string; resolvedAt?: number
}

export interface Incident {
  id: string; siteId: string; zoneId: string; occurredAt: number
  type: 'near-miss' | 'first-aid' | 'recordable' | 'dart' | 'fatality'
  witnessIds: string[]; equipmentIds: string[]; evidenceRefs: EvidenceRef[]
  permitIdAtTime?: string; icamFactors: IcamFactors; timeline: IncidentEvent[]
}
export interface EvidenceRef {
  id: string; contentHash: string; captureTime: number; capturingActor: string
  mimeType: string; sizeBytes: number; description: string
}
export interface IcamFactors {
  absentFailedDefences: string[]; individualTeamActions: string[]
  taskEnvironmentalConditions: string[]; organisationalFactors: string[]
}
export interface IncidentEvent {
  eventId: string; occurredAt: number; learnedAt: number
  learnedLate: boolean; description: string; evidenceRefs: EvidenceRef[]
}

export interface CorrectiveAction {
  id: string; linkedToId: string; dueAt: number; assigneeId: string
  description: string; closedAt?: number
}

export interface ObservationRecord {
  id: string; siteId: string; zoneId: string; reporterId: string
  observedAt: number; severity: 'low' | 'medium' | 'high' | 'critical'
  description: string; correctiveActionIds: string[]
}
```

how to implement:
1. Create `src/domain/types.ts` with all types above.
2. Create `test/domain/types.test.ts` that imports each type and asserts a few literal assignments compile (use `satisfies` keyword to catch shape errors without runtime overhead).

acceptance: `test/domain/types.test.ts` constructs one `Command` literal and one `Permit` literal using `satisfies Command` / `satisfies Permit`; TypeScript compilation with `tsc --noEmit` succeeds; `npm test` → green.

---

**`S04` — Append-only command/event log**

dependsOn: `S03`

files: `src/domain/event-log.ts`, `test/domain/event-log.test.ts`

interface:
```ts
// src/domain/event-log.ts
export interface LogEntry {
  seqNo: number          // monotone, assigned at append time
  command: Command
  decision: AcceptanceDecision
}
export class EventLog {
  append(command: Command, decision: AcceptanceDecision): LogEntry
  entries(): readonly LogEntry[]           // chronological by seqNo
  findByCommandId(id: string): LogEntry | undefined
  entriesForEntity(entityId: string): readonly LogEntry[]
}
```

how to implement:
1. Store entries in a private `LogEntry[]`.
2. `append` assigns the next seqNo (start at 1), pushes, and returns the entry.
3. `entries()` returns a frozen copy (use `Object.freeze` on the array reference).
4. `findByCommandId` does a linear scan (acceptable at this scale).
5. `entriesForEntity` filters where `command.targetEntityId === entityId`.

acceptance: `test/domain/event-log.test.ts` asserts: appending two commands yields seqNos 1 and 2; `entries()` length is 2; `findByCommandId` with the first id returns the right entry; `findByCommandId` with an unknown id returns `undefined`; `entriesForEntity` returns only the matching entry. Run `npm test` → green.

---

**`S05` — Fixtures: confined-space permit scenario**

dependsOn: `S03`, `S04`

files: `src/fixtures/confined-space-scenario.ts`

interface: exports typed constants used by authorization, reconciler, and incident tests.

```ts
// src/fixtures/confined-space-scenario.ts
export const CLOCK_EPOCH = 1_700_000_000_000   // fixed ms epoch for all tests

export const SITE_A: Site = { id: 'site-a', name: 'Alpha Construction Site', zoneIds: ['zone-1','zone-2'] }
export const ZONE_1: Zone = { id: 'zone-1', siteId: 'site-a', name: 'Utility Vault', adjacentZoneIds: ['zone-2'] }
export const ZONE_2: Zone = { id: 'zone-2', siteId: 'site-a', name: 'Adjacent Excavation', adjacentZoneIds: ['zone-1'] }

export const WORKER_ATTD: Worker = { id: 'w-attd', name: 'Alice Attendant', role: 'attendant', certifications: ['confined-space-entry'] }
export const WORKER_ENTSUP: Worker = { id: 'w-sup', name: 'Bob Supervisor', role: 'entry-supervisor', certifications: ['confined-space-entry'] }
export const WORKER_ENTRANT: Worker = { id: 'w-ent', name: 'Carol Entrant', role: 'worker', certifications: ['confined-space-entry'] }
export const WORKER_COMP: Worker = { id: 'w-comp', name: 'Dan Competent', role: 'competent-person', certifications: ['confined-space-entry','loto'] }

// A valid confined-space permit: issued at epoch, expires 8h later, window is the full 8h
export const PERMIT_CS_VALID: Permit = {
  id: 'permit-cs-1', type: 'confined-space',
  siteId: 'site-a', zoneIds: ['zone-1'],
  crewId: 'crew-1',
  authorizedRosterIds: ['w-attd','w-sup','w-ent','w-comp'],
  issuedAt: CLOCK_EPOCH,
  expiresAt: CLOCK_EPOCH + 8 * 3600 * 1000,
  workWindowStart: CLOCK_EPOCH,
  workWindowEnd: CLOCK_EPOCH + 8 * 3600 * 1000,
  controlState: {
    lotoPointsVerified: { 'iso-pt-1': true, 'iso-pt-2': true },
    atmosphericReadings: [{
      o2Percent: 20.9, lelPercent: 0, coAsPpm: 0, h2sAsPpm: 0,
      testedBy: 'w-comp', testedAt: CLOCK_EPOCH, testerInitials: 'DC'
    }],
    attendantId: 'w-attd', entrySupId: 'w-sup',
    authorizedEntrantIds: ['w-ent'],
    periodicRetestIntervalMs: 30 * 60 * 1000   // 30 min
  },
  prerequisitePermitIds: ['permit-loto-1'],
  checklistVersionId: 'cs-confined-space-v1'
}
```

how to implement:
1. Create `src/fixtures/confined-space-scenario.ts`.
2. Import all types from `src/domain/types.ts`.
3. Define each constant above, plus a `PERMIT_LOTO_VALID` (type: `'loto'`) with `issuedAt: CLOCK_EPOCH, expiresAt: CLOCK_EPOCH + 8h`, both isolation points verified.
4. Export everything; no logic, just data.

acceptance: compile check: `tsc --noEmit` passes; a trivial test `import { PERMIT_CS_VALID } from '../src/fixtures/confined-space-scenario'; expect(PERMIT_CS_VALID.type).toBe('confined-space')` passes. `npm test` → green.

---

**`S06` — Temporal-spatial authorization predicate (confined-space)**

dependsOn: `S03`, `S05`

files: `src/domain/authorization.ts`, `test/domain/authorization.test.ts`

interface:
```ts
// src/domain/authorization.ts
export type AuthorizationResult =
  | { status: 'Valid' }
  | { status: 'Invalid'; reasons: string[] }
  | { status: 'Conflicting'; otherPermitId: string; overlapDescription: string }

export interface AuthorizationContext {
  atTime: number                          // clock.now() at the moment of action
  inZoneId: string
  byWorkerId: string
  byCrewId: string
  otherLivePermits: Permit[]              // for conflict check
  clock: Clock
  prereqPermits: Permit[]                 // permits that are prerequisites
}

export function authorizeConfinedSpaceEntry(
  permit: Permit,
  ctx: AuthorizationContext
): AuthorizationResult
```

how to implement:
1. **Temporal check:** if `ctx.atTime < permit.issuedAt` return Invalid(`"permit not yet active"`); if `ctx.atTime > permit.expiresAt` return Invalid(`"permit expired"`); if `ctx.atTime < permit.workWindowStart || ctx.atTime > permit.workWindowEnd` return Invalid(`"outside authorized work window"`).
2. **Atmospheric freshness check:** find the latest reading in `permit.controlState.atmosphericReadings` (sort by `testedAt`); if `ctx.atTime - latestReading.testedAt > permit.controlState.periodicRetestIntervalMs` return Invalid(`"atmospheric retest overdue"`); check `o2Percent` in [19.5, 23.5], `lelPercent <= 10`, return Invalid with cited values if outside.
3. **Spatial check:** if `!permit.zoneIds.includes(ctx.inZoneId)` return Invalid(`"work in unauthorized zone zone-X"`).
4. **Roster/role check:** if `!permit.authorizedRosterIds.includes(ctx.byWorkerId)` return Invalid(`"worker not on authorized roster"`); if `permit.controlState.attendantId === null` return Invalid(`"no attendant assigned"`); if `permit.controlState.entrySupId === null` return Invalid(`"no entry supervisor assigned"`).
5. **LOTO prerequisite:** for each `prereqPermitId` in `permit.prerequisitePermitIds`, find it in `ctx.prereqPermits`; for each, check all `lotoPointsVerified` values are `true`; if any false return Invalid(`"LOTO isolation point not verified: iso-pt-X"`).
6. **Conflict check:** for each permit in `ctx.otherLivePermits` that is not this permit, check if it is a `'confined-space'` type with overlapping `zoneIds` and overlapping `[issuedAt, expiresAt]` time windows; if so return `Conflicting(otherPermitId, "zone+time overlap")`.
7. If all checks pass, return `{ status: 'Valid' }`.

acceptance: `test/domain/authorization.test.ts` tests (each is an independent `it` block):
- Valid: valid permit + `atTime = CLOCK_EPOCH + 1h` + correct zone/roster → `'Valid'`.
- Expired: `atTime = CLOCK_EPOCH + 9h` (past `expiresAt`) → `Invalid` with reason containing `"expired"`.
- Stale retest: modify `testedAt` to `atTime - 31min` (past 30min interval) → Invalid with `"retest overdue"`.
- Bad O₂: reading with `o2Percent = 18.0` → Invalid with `"o2"` in reason.
- Wrong zone: `inZoneId = 'zone-2'` → Invalid with `"unauthorized zone"`.
- Not on roster: `byWorkerId = 'unknown-w'` → Invalid.
- LOTO not verified: prereq permit has `lotoPointsVerified: { 'iso-pt-1': false, ... }` → Invalid with `"LOTO"` in reason.
- Monotonicity invariant: start from Valid; add atmospheric reading outside threshold → result becomes Invalid (never Valid again from that blocked fact). Verified by: run `authorizeConfinedSpaceEntry` with valid context, confirm Valid; add blocking fact to the same permit copy, run again, confirm Invalid.
Run `npm test` → green.

---

**`S07` — Zone-time conflict check (conflicting-work)**

dependsOn: `S06`

files: `src/domain/conflict-check.ts`, `test/domain/conflict-check.test.ts`

interface:
```ts
// src/domain/conflict-check.ts
export interface ConflictCheckResult {
  conflicting: boolean
  otherPermitId?: string
  reason?: string
}
export function checkConflictingWork(
  permit: Permit,
  zone: Zone,
  otherPermits: Permit[],
  zoneMap: Record<string, Zone>
): ConflictCheckResult
```

how to implement:
1. Build a set of zone ids to check: `permit.zoneIds` plus all adjacent zone ids found in `zoneMap`.
2. For each `otherPermit` in `otherPermits` (exclude same id): if any of `otherPermit.zoneIds` is in the expanded set AND the time windows `[permit.issuedAt, permit.expiresAt]` and `[otherPermit.issuedAt, otherPermit.expiresAt]` overlap (i.e. `permit.issuedAt < otherPermit.expiresAt && otherPermit.issuedAt < permit.expiresAt`), return `{ conflicting: true, otherPermitId: otherPermit.id, reason: "zone-time overlap with permit-X" }`.
3. Otherwise return `{ conflicting: false }`.

acceptance: `test/domain/conflict-check.test.ts`:
- No conflict: hot-work permit in zone-1 with no overlapping permits in zone-1 or zone-2 → `conflicting: false`.
- Same-zone overlap: add an excavation permit also in zone-1 with overlapping time → `conflicting: true`.
- Adjacent-zone overlap: hot-work in zone-1, excavation in zone-2 (adjacent) with overlapping time → `conflicting: true` (the seed scenario's "excavation permit conflict").
- No overlap (different time): same zones but `otherPermit.issuedAt > permit.expiresAt` → `conflicting: false`.
Run `npm test` → green.

---

**`S08` — Version-vector causal ordering**

dependsOn: `S02`, `S03`

files: `src/domain/version-vector.ts`, `test/domain/version-vector.test.ts`

interface:
```ts
// src/domain/version-vector.ts
export type VV = Record<string, number>

export function vvMerge(a: VV, b: VV): VV          // element-wise max
export function vvIncrement(vv: VV, actorId: string): VV  // returns new VV
export function vvCausallyBefore(a: VV, b: VV): boolean   // a happened-before b
export function vvConcurrent(a: VV, b: VV): boolean       // neither before the other
```

how to implement:
1. `vvMerge`: for all keys in both, take `Math.max`.
2. `vvIncrement`: returns `{ ...vv, [actorId]: (vv[actorId] ?? 0) + 1 }`.
3. `vvCausallyBefore(a, b)`: true if for every key in `a`, `a[key] <= (b[key] ?? 0)`, and there exists at least one key where `a[key] < (b[key] ?? 0)`.
4. `vvConcurrent(a, b)`: `!vvCausallyBefore(a, b) && !vvCausallyBefore(b, a) && a !== b` (use deep compare of values).

acceptance: `test/domain/version-vector.test.ts`:
- `vvMerge({a:1, b:2}, {a:3, b:1})` → `{a:3, b:2}`.
- `vvCausallyBefore({a:1}, {a:2})` → true; `vvCausallyBefore({a:2}, {a:1})` → false.
- `vvConcurrent({a:1}, {b:1})` → true (neither actor knows the other).
- `vvConcurrent({a:1,b:1}, {a:1,b:1})` → false (identical).
Run `npm test` → green.

---

**`S09` — Offline command reconciler**

dependsOn: `S04`, `S08`

files: `src/domain/reconciler.ts`, `test/domain/reconciler.test.ts`

interface:
```ts
// src/domain/reconciler.ts
const SAFETY_CRITICAL_KINDS: Set<CommandKind> = new Set([
  'update-control', 'update-acceptable-entry-conditions',
  'update-atmospheric-reading', 'verify-loto-point', 'sign-pretask'
])

export interface ReconcilerState {
  entityVersions: Record<string, number>          // entityId -> current logical version
  acceptedCommands: Record<string, Command>       // commandId -> command (for idempotency)
}

export function reconcileCommand(
  cmd: Command,
  existing: ReconcilerState,
  log: EventLog,
  clock: Clock
): { decision: AcceptanceDecision; nextState: ReconcilerState }
```

how to implement:
1. **Idempotency:** if `cmd.id` is in `existing.acceptedCommands`, return `Accepted` immediately without modifying state (replay is a no-op).
2. **Retrieve concurrent commands:** get all log entries for `cmd.targetEntityId` where the entry's command's `causalStamp` is concurrent with `cmd.causalStamp` (use `vvConcurrent`).
3. **Safety-critical divergence check:** if any concurrent command has a `payload.kind` in `SAFETY_CRITICAL_KINDS` AND the same `payload.kind` as `cmd.payload`, and the payloads are not deep-equal → return `ConflictHeld` with both versions verbatim, no state change.
4. **Safe merge:** if concurrent commands exist but none conflict on safety-critical fields, return `AcceptedReordered`.
5. **Normal acceptance:** if no concurrent commands, return `Accepted`.
6. In all Accepted/AcceptedReordered cases: increment `entityVersions[cmd.targetEntityId]`; add to `acceptedCommands`.

acceptance: `test/domain/reconciler.test.ts`:
- Idempotency: submit same command twice; second returns `Accepted` immediately; `entityVersions` increments only once.
- Normal acceptance: sequential commands with causal dependency → all `Accepted`.
- Concurrent non-critical fields: two concurrent commands updating independent non-safety fields → both `AcceptedReordered`, no conflict.
- Safety-critical conflict: two concurrent commands both updating `acceptable-entry-conditions` to different values → first `Accepted`, second `ConflictHeld` with both payloads preserved verbatim.
- Shuffle determinism: take a fixed list of 5 commands (mix of concurrent and sequential), shuffle with `SeededRng(1).shuffle([...])`, replay; the set of held conflicts and the final `entityVersions` must be identical to the un-shuffled result. (Use `JSON.stringify` sorted-key compare.)
Run `npm test` → green.

---

**`S10` — OSHA 1904 recordability classifier**

dependsOn: `S03`

files: `src/domain/recordability.ts`, `test/domain/recordability.test.ts`

interface:
```ts
// src/domain/recordability.ts
export type TreatmentLevel =
  | 'first-aid-only'
  | 'medical-treatment'    // beyond first aid
  | 'restricted-duty'
  | 'days-away'
  | 'loss-of-consciousness'
  | 'fatality'

export type RecordabilityClass =
  | 'not-recordable'
  | 'recordable'
  | 'dart'                // Days Away, Restricted, or Transfer
  | 'fatality'

export interface IncidentClassificationInput {
  treatmentLevel: TreatmentLevel
  daysAwayFromWork: number
  restrictedDaysOrTransfer: number
  lossOfConsciousness: boolean
  privacyCase: boolean      // if true, omit worker name from 300-log
}

export interface RecordabilityResult {
  classification: RecordabilityClass
  isDart: boolean
  is300LogEntry: boolean
  privacyCase: boolean
  citedCriteria: string[]   // which criteria triggered classification
}

export function classifyRecordability(input: IncidentClassificationInput): RecordabilityResult
```

how to implement:
1. `'fatality'` → `{ classification: 'fatality', isDart: false, is300LogEntry: true, citedCriteria: ['fatality'] }`.
2. `'days-away'` with `daysAwayFromWork > 0` → `{ classification: 'dart', isDart: true, ... }`.
3. `'restricted-duty'` with `restrictedDaysOrTransfer > 0` → `{ classification: 'dart', isDart: true, ... }`.
4. `lossOfConsciousness === true` → `{ classification: 'recordable', isDart: false, ... }`.
5. `'medical-treatment'` → `{ classification: 'recordable', isDart: false, ... }`.
6. `'first-aid-only'` → `{ classification: 'not-recordable', isDart: false, is300LogEntry: false, ... }`.
7. Always populate `privacyCase` from input.

acceptance: `test/domain/recordability.test.ts`:
- First-aid-only → `not-recordable`.
- Medical-treatment → `recordable`, `isDart: false`.
- Days-away=2 → `dart`, `isDart: true`.
- Reclassification test: call classifier with `first-aid-only` → `not-recordable`; call again with same data but `treatmentLevel: 'medical-treatment'` (simulating a follow-up upgrade) → `recordable`; confirm the result changed and `citedCriteria` cites `'medical-treatment'`.
- Privacy case: same input with `privacyCase: true` → `privacyCase` in result is `true`.
Run `npm test` → green.

---

**`S11` — 300-Log projection**

dependsOn: `S10`, `S04`

files: `src/domain/log-300.ts`, `test/domain/log-300.test.ts`

interface:
```ts
// src/domain/log-300.ts
export interface Log300Entry {
  caseNo: number
  incidentId: string
  injuryDate: number           // clock timestamp
  recordedWithinWindow: boolean  // was it recorded within 7 calendar days?
  recordedAt: number
  classification: RecordabilityClass
  isDart: boolean
  privacyCase: boolean
  workerIdOrPrivate: string    // worker id, or 'PRIVACY' if privacyCase
  citedCriteria: string[]
}

export function projectLog300(
  log: EventLog,
  clock: Clock
): Log300Entry[]
```

how to implement:
1. Fold over `log.entries()` looking for commands with `payload.kind === 'log-incident'`.
2. For each, call `classifyRecordability` using the incident's data.
3. Skip `not-recordable` incidents.
4. Compute `recordedWithinWindow`: the command's `clientCreatedAt` minus `incident.occurredAt` <= `7 * 24 * 3600 * 1000`.
5. Assign monotone `caseNo` starting at 1.
6. For upgrade events (a second `log-incident` command for same incidentId with higher treatmentLevel), update the existing entry (find by incidentId, replace classification). Do not add a duplicate entry.

acceptance: `test/domain/log-300.test.ts`:
- One recordable incident → one 300-log entry; `caseNo === 1`.
- First-aid-only incident → zero entries.
- Upgrade scenario: first command logs `first-aid-only` → no entry; second command (same `targetEntityId`, later `causalStamp`) logs `medical-treatment` for same incident → one entry with `recordable` classification.
- 7-day window: incident at `CLOCK_EPOCH`, recorded at `CLOCK_EPOCH + 8 * 86400 * 1000` → `recordedWithinWindow: false`.
Run `npm test` → green.

---

**`S12` — Incident timeline builder**

dependsOn: `S03`, `S04`, `S05`

files: `src/domain/incident-timeline.ts`, `test/domain/incident-timeline.test.ts`

interface:
```ts
// src/domain/incident-timeline.ts
export interface IncidentTimeline {
  incidentId: string
  events: IncidentEvent[]        // chronological by occurredAt
  permitStateAtTime: Permit | null    // permit active at occurredAt
  icamFactors: IcamFactors
  learnedLateFacts: Array<{ factDescription: string; learnedAt: number; changedIcamBucket?: string }>
}

export function buildIncidentTimeline(
  incidentId: string,
  log: EventLog,
  permits: Permit[],
  clock: Clock
): IncidentTimeline
```

how to implement:
1. Gather all log entries for `incidentId` (by `targetEntityId`).
2. Build the events list from `payload.kind === 'log-incident'` entries; sort by `occurredAt`.
3. For each event, check if it arrived late: if its `command.causalStamp` is causally-before an already-processed event for the same incident, mark `learnedLate: true` and add to `learnedLateFacts`.
4. Find the permit active at `incident.occurredAt`: scan `permits` where `issuedAt <= occurredAt <= expiresAt` and `zoneIds` includes the incident's `zoneId`.
5. Return the assembled `IncidentTimeline`.

acceptance: `test/domain/incident-timeline.test.ts`:
- Simple timeline: two events for the same incident in causal order → `learnedLateFacts` is empty; events sorted by `occurredAt`.
- Late-learned fact: replay a sign-off command with an earlier causal stamp *after* the incident is logged → that event appears in `learnedLateFacts` with `learnedLate: true`.
- Permit linkage: include `PERMIT_CS_VALID` from fixtures; incident at `CLOCK_EPOCH + 1h` in zone-1 → `permitStateAtTime` is the permit.
- Re-fold determinism: fold the same log twice; both results are deep-equal.
Run `npm test` → green.

---

**`S13` — Zone risk-score view-model**

dependsOn: `S03`, `S04`, `S10`, `S12`

files: `src/domain/risk-dashboard.ts`, `test/domain/risk-dashboard.test.ts`

interface:
```ts
// src/domain/risk-dashboard.ts
export interface ZoneRisk {
  zoneId: string; siteId: string
  riskScore: number                 // higher = more urgent; computed, not stored
  openCorrectiveActionsCount: number
  agingCriticalActions: number      // critical actions past their dueAt
  pendingConflicts: number          // unresolved ConflictHeld decisions
  pendingPermitExpirations: number  // permits expiring within 2h
  repeatOffenderCrewId?: string     // crew with most missed-signature escalations
}

export function computeZoneRisk(
  zoneId: string,
  siteId: string,
  log: EventLog,
  permits: Permit[],
  clock: Clock
): ZoneRisk
```

how to implement:
1. Scan log entries for `targetEntityId` matching `zoneId` or for permits in this zone.
2. Count open corrective actions: `log-incident` commands that have no `close-corrective-action` paired.
3. Count aging critical actions: open corrective actions where `clock.now() > dueAt`.
4. Count pending `ConflictHeld` decisions: entries with `decision.status === 'ConflictHeld'` and `resolvedBy === undefined`.
5. Count permits expiring in next 2h: permits where `expiresAt - clock.now() <= 2 * 3600 * 1000 && expiresAt > clock.now()`.
6. Compute `riskScore`: `agingCriticalActions * 10 + pendingConflicts * 8 + openCorrectiveActionsCount * 2 + pendingPermitExpirations * 5`. (Configurable weights, but these are the defaults.)
7. Find `repeatOffenderCrewId`: across the log, count missed-signature escalations per crew; return the crew with the highest count if it exceeds zero.

acceptance: `test/domain/risk-dashboard.test.ts`:
- Empty log → all counts 0, riskScore 0.
- One aging critical action (`dueAt` in the past) → `agingCriticalActions === 1`, `riskScore >= 10`.
- Two zones: zone-1 has an aging critical action (score 10), zone-2 has no open items (score 0) → zone-1 sorts first.
- Repeat offender: same crewId accumulates 3 missed-signature events → `repeatOffenderCrewId` is set.
Run `npm test` → green.

---

**`S14` — Command-shuffle determinism property test**

dependsOn: `S09`, `S02`

files: `test/domain/reconciler-property.test.ts`

interface: no new exports; test-only.

how to implement:
1. Create a fixed multiset of 8 commands (mix of safe-merge and safety-critical-conflict pairs, including a duplicate command to test idempotency) using the fixtures from `S05`.
2. Use `SeededRng(42).shuffle([...commandList])` to get a shuffled order.
3. Replay the shuffled multiset through the reconciler, collecting decisions.
4. Replay the original order.
5. Assert: the final `entityVersions` from both replays are deep-equal; the set of `ConflictHeld` decision commandIds is identical (use `Set` comparison); the set of `Accepted` commandIds is identical.

acceptance: the test in `test/domain/reconciler-property.test.ts` passes with no `it.only` shortcuts. Run `npm test` → green.

---

**`S15` — No-silent-loss-of-safety-data invariant test**

dependsOn: `S09`, `S04`

files: `test/domain/no-silent-loss.test.ts`

interface: no new exports; test-only.

how to implement:
1. Enumerate all `ConflictHeld` decisions in a test log where two concurrent safety-critical commands diverged.
2. For each, assert that `decision.conflictingVersionA` and `decision.conflictingVersionB` are both non-null and not equal.
3. Assert that no `Accepted` or `AcceptedReordered` decision exists for a command that was concurrent with a safety-critical divergence on the same field (i.e., no silent auto-resolution).
4. Specifically: create the scenario from E5 item 3 (two foremen both offline, both change `acceptable-entry-conditions` to different values); run reconciler; scan log; assert exactly one `ConflictHeld` entry and zero entries where one version was silently discarded.

acceptance: `test/domain/no-silent-loss.test.ts` passes. This is the structural invariant test. Run `npm test` → green.

---

**`S16` — Seed scenario integration test (two sites, excavation conflict, near-miss)**

dependsOn: `S06`, `S07`, `S09`, `S10`, `S11`, `S12`, `S13`, `S14`, `S15`

files: `src/fixtures/seed-scenario.ts`, `test/integration/seed-scenario.test.ts`

interface: `src/fixtures/seed-scenario.ts` exports a second site (`SITE_B`), a second crew (`CREW_B` with subcontractor name), an excavation permit (`PERMIT_EXC`), and a sequence of commands that:
- Subcontractor handoff: `CREW_B` takes over zone-2 from `CREW_A`.
- Excavation permit conflict: `PERMIT_EXC` covers zone-2 during the same time window as `PERMIT_CS_VALID` in zone-1 (adjacent zone) → triggers conflicting-work.
- Near-miss: an incident in zone-1 with `type: 'near-miss'`, a valid confined-space permit active at time, and one late-arriving sign-off command.

how to implement:
1. In `src/fixtures/seed-scenario.ts`, define all above entities.
2. In `test/integration/seed-scenario.test.ts`:
   a. Check authorization of `PERMIT_CS_VALID` with `otherLivePermits: [PERMIT_EXC]` → `Conflicting`.
   b. Run the full near-miss command sequence through the reconciler; assert no `ConflictHeld` (no diverging edits) and no silent loss.
   c. Build the incident timeline; assert the late sign-off appears with `learnedLate: true`.
   d. Run the 300-log projection; assert the near-miss does NOT appear (near-miss is not an OSHA recordable unless it meets criteria — default: near-miss with no injury is `not-recordable`).
   e. Compute zone risk for zone-1; assert `pendingPermitExpirations >= 0` and the risk score is a number.
   f. Run the command-shuffle on the seed command sequence and assert deterministic output.

acceptance: all assertions in the integration test pass. `npm test` → all suites green.

---

### 3. The decomposition method for the remaining breadth

After the first slice is green, expand the remaining permit types, checklist engine, pre-task planning, and dashboard using this repeatable recipe:

**Recipe for any new card cluster:**

1. **Identify the rule/invariant** — what is the domain truth this feature must uphold? State it as a one-sentence invariant before writing any code.
2. **Define the interface first** — write the TypeScript function signature and return type in a new `src/domain/<feature>.ts` file before the implementation.
3. **Write the test before the implementation** — one test file per card, with the acceptance assertions named in the card.
4. **Wire to the event log** — if the feature depends on new command kinds, add them to `CommandPayload` in `src/domain/types.ts` first (that is a new S01-style card).
5. **Keep it a pure function** — no clock calls except via injected `Clock`; no network; no `Date.now()`.

**Worked example A — Hot-work permit (rule-pack breadth):**

> The hot-work permit adds fire-watch duration as a *configurable, jurisdiction-dependent* parameter (OSHA 30 min vs. NFPA 51B 60 min).

- `H01` — Add `'hot-work'` control state type (`hotWorkControlState: { fireWatchStartedAt: number | null; fireWatchEndedAt: number | null; fireWatchDurationRequiredMs: number }`). files: `src/domain/types.ts` (extend `ControlState` union). dependsOn: `S03`.
- `H02` — `authorizeHotWork(permit, ctx): AuthorizationResult` in `src/domain/authorization.ts`. Temporal/spatial/roster checks same as `S06`. Additional: if `ctx.atTime > permit.expiresAt` and `fireWatchEndedAt === null`, return Invalid(`"fire watch period still required"`); if `fireWatchDurationRequiredMs` elapsed without `fireWatchEndedAt`, return Invalid(`"fire watch not completed"`). test: `test/domain/authorization-hotwork.test.ts` with NFPA-60min and OSHA-30min variants. dependsOn: `H01`, `S06`.
- `H03` — Integration: hot-work permit inside a confined space requires `prerequisitePermitIds` to include a confined-space permit id. A test that creates both permits, wires the prerequisite, and confirms authorization passes only with both valid. dependsOn: `H02`, `S06`.

**Worked example B — Pre-task planning workflow:**

> Pre-task plan must capture hazards, assigned controls (with HoC rank), sign-offs, and flag any missed signatures as escalations.

- `P01` — Add types: `PreTaskPlan { id, siteId, zoneId, crewId, plannedAt, hazards: Hazard[], signoffs: Signoff[] }`, `Hazard { id, description, chosenControl: string, hocRank: ControlHierarchyRank }`, `Signoff { workerId, signedAt, commandId }`. Add `CommandPayload` variant `sign-pretask`. files: `src/domain/types.ts`. dependsOn: `S03`.
- `P02` — `evaluatePreTaskPlan(plan, expectedSigners, clock): PlanEvaluation` where `PlanEvaluation = { complete: boolean, missedSigners: string[], weakControls: Array<{hazardId, reason}> }`. Weak control: `hocRank === 5` (PPE only) when a higher-rank control was not documented as infeasible. test: `test/domain/pretask.test.ts`. dependsOn: `P01`.
- `P03` — Missed-signature escalation: if `clock.now() > plannedAt + escalationThresholdMs` and `missedSigners.length > 0`, emit escalation events. Tested by advancing the clock past threshold. dependsOn: `P02`.

**Worked example C — Corrective-action aging risk score:**

> Risk score must rise monotonically as high-severity corrective actions age past their due date.

- `R01` — Pure function `computeActionAgeScore(actions: CorrectiveAction[], clock: Clock): number`. Score = sum of `(clock.now() - action.dueAt) / 3600000` (hours overdue) × severity multiplier (critical=10, high=5, medium=2, low=1). test: two actions, one 3h overdue critical (30 pts), one 1h overdue medium (2 pts) → 32. dependsOn: `S03`.
- `R02` — Wire into `computeZoneRisk` (replace the hard-coded count with the aging score). Regression test: zone with 0 open actions → score 0; zone with 1 aging critical → score > 0. dependsOn: `R01`, `S13`.

---

### 4. Per-task implementation conventions

**File/folder layout:**
```
src/
  lib/           # clock.ts, prng.ts — zero-domain utilities
  domain/        # all pure domain functions and types
  fixtures/      # typed .ts constant files for test data
  adapters/      # interface definitions for external boundaries
    fixture/     # deterministic adapter implementations
test/
  lib/           # unit tests for lib modules
  domain/        # unit tests for domain modules (one file per domain module)
  integration/   # cross-module integration tests (seed scenario, etc.)
```

**Naming:**
- Source files: `kebab-case.ts`.
- Test files: `<source-name>.test.ts` in the parallel `test/` tree.
- Exported functions: `camelCase`; exported types/interfaces: `PascalCase`.
- Fixture constants: `SCREAMING_SNAKE_CASE`.
- Adapter interfaces: `I<Name>Adapter` (e.g. `IClockAdapter`, `INotificationSink`).
- Fixture adapters: `Fixture<Name>Adapter` (e.g. `FixtureClockAdapter` = `ManualClock`).

**How to write a test in Vitest (minimal template):**
```ts
// test/domain/authorization.test.ts
import { describe, it, expect } from 'vitest'
import { authorizeConfinedSpaceEntry } from '../../src/domain/authorization.js'
import { PERMIT_CS_VALID, CLOCK_EPOCH, ZONE_1, WORKER_ENTRANT } from '../../src/fixtures/confined-space-scenario.js'
import { ManualClock } from '../../src/lib/clock.js'

describe('authorizeConfinedSpaceEntry', () => {
  it('returns Valid for a fully-compliant context', () => {
    const clock = new ManualClock(CLOCK_EPOCH + 3600_000)
    const result = authorizeConfinedSpaceEntry(PERMIT_CS_VALID, {
      atTime: clock.now(), inZoneId: ZONE_1.id,
      byWorkerId: WORKER_ENTRANT.id, byCrewId: 'crew-1',
      otherLivePermits: [], prereqPermits: [], clock
    })
    expect(result.status).toBe('Valid')
  })
})
```

**Keeping tests deterministic:**
- Always pass a `ManualClock` with a known starting value.
- Never use `Math.random()` — use `SeededRng`.
- Never import from `src/adapters/` live adapters in tests — only `src/adapters/fixture/`.
- All fixture data is in `src/fixtures/*.ts` — import them directly.

**Definition of done for any card:**
1. All types compile with `tsc --noEmit` (no errors).
2. The card's test file runs green: `npm test` exits 0.
3. No `any` types in the card's source file.
4. No `Date.now()`, `Math.random()`, or network calls in the card's source.
5. Every function that takes a time argument accepts `number` (milliseconds epoch), not `Date`.

---

### 5. Common pitfalls for a weak model on this project

**Pitfall 1 — Modeling permit validity as a stored status flag.**
A 3B model will try to add a `status: 'valid' | 'expired' | 'invalid'` field to the `Permit` type and update it in a mutation. This is wrong: permit validity is a *predicate over a fact-set* evaluated at a specific time. The authorization functions (`S06`, `S07`) take a `Permit` (immutable data) and compute validity — they do not mutate it. Mitigation: the `Permit` type in `S03` has no `status` field; the comment in `S03`'s interface explicitly says "status is projection-only — never a stored field." If the model adds a `status` field, the type test in `S03` should fail to compile (do not add `status` to the type).

**Pitfall 2 — Using `Date.now()` or wall-clock ordering instead of version vectors.**
A 3B model will sort commands by `clientCreatedAt` (the device wall-clock) and use that as causal order. This is explicitly wrong: field devices have skewed clocks. Mitigation: the `Command` type in `S03` names the field `clientCreatedAt` and the docstring says "metadata only — never used for ordering." The reconciler (`S09`) uses `causalStamp` (version vector) for ordering. The clock-skewed adversarial fixture in `S05` (a device 40 minutes fast) specifically tests that wall-clock order disagrees with causal order and the system picks causal.

**Pitfall 3 — Auto-resolving a `ConflictHeld` with last-write-wins.**
A 3B will see two concurrent updates and pick the one with the higher logical clock or more recent `clientCreatedAt`, silently discarding the other. The no-silent-loss test (`S15`) directly catches this: it asserts that both versions are present in `ConflictHeld.conflictingVersionA` and `.conflictingVersionB`, and that no Accepted decision exists for either without a `resolvedBy` event. Mitigation: include the exact text "preserve both versions verbatim" in the reconciler docstring.

**Pitfall 4 — Forgetting that a `ConflictHeld` blocks authorization.**
After a safety-critical divergence produces a `ConflictHeld`, the permit's authorization must block (entry is not permitted while the conflict is unresolved). A 3B will compute authorization from just the `Permit` data without consulting pending conflicts. The authorization function in `S06` must accept the `EventLog` or a pre-computed conflict list as part of the `AuthorizationContext` and check for unresolved conflicts on the target permit. Mitigation: the `AuthorizationContext` type includes a `pendingConflicts: AcceptanceDecision[]` field; the authorization function checks it.

**Pitfall 5 — Forgetting atmospheric-retest freshness check.**
The adversarial scenario (E5 item 5: confined-space permit with lapsed periodic retest) requires checking that the *latest* atmospheric reading is within `periodicRetestIntervalMs` of `atTime`. A 3B will check the atmospheric *thresholds* (O₂, LEL) but forget the *staleness* check. Mitigation: the acceptance test for `S06` includes an explicit stale-retest case with `testedAt = atTime - 31min` when the interval is 30 min.

**Pitfall 6 — Collapsing zone-time conflict into a simple zone-intersection check.**
The conflicting-work check (`S07`) requires checking *adjacent* zones, not just the exact permit zones, because work drifts into adjacent areas. A model will only check `permit.zoneIds.includes(otherZoneId)`. Mitigation: the `checkConflictingWork` function explicitly expands the zone set with adjacency in step 2 of the implementation recipe, and the adjacent-zone test case in `S07` acceptance verifies it.

**Pitfall 7 — Treating `sign-pretask` commands as non-safety-critical.**
A 3B will classify `sign-pretask` as a safe-merge field (it is "just a signature"). But a sign-off is a safety-load-bearing field: if two foremen both sign-off to *different* plans, or one signs off and another rescinds, that is a safety-critical divergence. Mitigation: `SAFETY_CRITICAL_KINDS` in `S09` includes `'sign-pretask'`; the reconciler-property test (`S14`) includes a sign-pretask conflict case.

**Pitfall 8 — Missing the 300-Log upgrade path.**
The 1904 classifier is stateless (pure function), but the 300-Log projection must handle an upgrade event (first-aid → recordable). A 3B will create a new 300-Log entry on the second command instead of updating the existing one. Mitigation: the `S11` upgrade scenario test explicitly asserts `log300Entries.length === 1` after two commands for the same incident (not 2).
