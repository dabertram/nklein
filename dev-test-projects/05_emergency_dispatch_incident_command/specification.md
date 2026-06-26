# 05 - Emergency Dispatch and Incident Command Platform

Complexity tier: 5/20
Expected decomposition size: 20-24 dependent implementation cards before coding.
Domain pressure: computer-aided dispatch, incident command, GIS, unit status, triage, mutual aid, radio log evidence.
Acceptance command: npm test

## How to use this challenge
This is a dev-test project specification for evaluating whether an autonomous coding agent can decompose a real domain, identify knowledge gaps, build a correct foundation, and verify it with deterministic tests. The goal is not to finish the entire product. The goal is to build a durable foundation that proves the agent understood the domain boundaries and can implement the highest-risk core behaviors without hiding behind placeholders.

The agent must read this entire specification before planning. It must create a dependency-linked plan, record domain knowledge debt, and choose a narrow release slice that still exercises the real hard parts. Prefer fewer production-quality vertical slices over many shallow labels.

## Product vision
Build a dispatch and incident command foundation for fire, EMS, and public works events. The challenge is to model time-critical operations, unit state, location uncertainty, escalation, and after-action evidence without pretending to be a complete public safety system.

## Foundation release scope
The first serious buildout must include:
- Incident, caller, location, hazard, agency, unit, crew, station, assignment, radio transmission, resource request, and command objective entities.
- Call intake workflow that captures uncertainty, caller updates, priority changes, and dispatch recommendations.
- Unit status state machine covering available, dispatched, en route, staged, on scene, transporting, at destination, out of service, and clear.
- Incident command board with objectives, divisions/groups, safety notes, evacuation zones, accountability, and resource staging.
- Routing and coverage approximation using deterministic fixtures, not external maps.
- Mutual aid workflow with requested, accepted, assigned, released, and declined states.
- Timeline reconstruction from call intake, radio logs, unit status changes, and command decisions.
- Seed scenario with mass-casualty triage, road closure, unit reassignment, and conflicting caller reports.

## Architecture requirements
- Use event sourcing for operational history and derive current unit/incident state from events.
- Separate geocoding/routing adapters from dispatch logic.
- Make priority calculation rule-based and explainable rather than a hidden numeric score.
- Protect against invalid unit transitions with a tested state machine.

## Domain knowledge debt to surface
The agent should not pretend to know every regulation, standard, or numerical model perfectly. It should implement a defensible deterministic subset, mark assumptions explicitly, and create extension points where real-world integrations or expert-reviewed rule packs would live. Required knowledge areas:
- Dispatch decisions are time-sensitive and must preserve uncertainty rather than overwrite it.
- Incident command uses roles, objectives, divisions, staging, and accountability, not just a task list.
- Unit coverage can worsen when resources are committed elsewhere.
- After-action review depends on exact timelines and decision provenance.

## Decomposition pressure
This project should force decomposition across domain modeling, calculation or policy engines, workflow state, deterministic fixtures, auditability, and UI/view-model boundaries. The plan should include dependency links so shared primitives and invariants are built before dependent workflow features. Avoid starting with screens. Start with the domain model, invariants, and tests that would make later screens trustworthy.

The agent should maintain a visible knowledge-debt list covering unclear standards, units, legal or safety constraints, numerical assumptions, terminology, fixture limitations, and future expert-review checkpoints. Knowledge debt is not a failure; hiding it is.

## Acceptance criteria
- Invalid unit transitions are rejected with actionable errors.
- Incident priority recalculates when caller facts change and explains why.
- Coverage and mutual-aid tests use deterministic map fixtures.
- After-action timeline output is stable and complete for the seed incident.
- The project passes npm test without network access.

## Explicit non-goals
- Do not make this a chat app or generic kanban board.
- Do not use live emergency service integrations.
- Do not erase earlier caller reports when new information arrives.

## Quality bar
- Use typed domain objects and pure core modules wherever practical.
- Keep deterministic fixtures in the repository and do not depend on live APIs for acceptance tests.
- Test edge cases before building broad UI coverage.
- Every risk score, recommendation, workflow transition, or generated report must be explainable from source facts.
- Stubs are acceptable only at external integration boundaries and must be named as adapters with deterministic fixture implementations.
- The foundation should be extensible into a real product if later teams add integrations, expert-reviewed rule packs, and production UI.


---

# Extended scope & deep-reasoning extensions (v2)

> Added 2026-06-26 via deep domain research. **The single defining property of this project is *epistemic humility under a ticking clock*:** a dispatch + incident-command system must commit resources *now*, on uncertain and contradictory caller information, while *never destroying* the prior information it is superseding — every priority, recommendation, and unit move must be reconstructable, at after-action, from the exact facts known *at the instant the decision was made*. Build the time-ordered, append-only evidence spine first; the CAD and ICS board are projections over it.

This section raises the base spec to master-grade by grounding it in the real public-safety standards stack (NIMS/ICS, NENA i3 / NG9-1-1, NFPA 1710/1561, MPDS, START/SALT) and naming the hard architecture seams, the determinism strategy, the adversarial fixtures, and the invariant tests. The acceptance command stays `npm test`; nothing here may touch a live PSAP, CAD, radio, or map service.

## V0. Research-grounded domain authenticity (what a 9-1-1 veteran will check for)

The model must reflect how real emergency communications actually works, not a TV version. Ground these in the standards:

- **NG9-1-1 / NENA i3 call routing (NENA-STA-010).** A modern emergency call is routed over an **ESInet** by the **ECRF** (Emergency Call Routing Function), which maps the caller's **location** (civic *or* geodetic) to the correct **PSAP** using the authority's **GIS** data; locations are validated by the **LVF** (Location Validation Function) and carried as **PIDF-LO**. Legacy **ANI/ALI** (callback number + automatic location) is the prior generation being phased out. Source: https://cdn.ymaws.com/www.nena.org/resource/resmgr/standards/nena-sta-010.3b-2021_i3_stan.pdf and https://www.911.gov/assets/National_911_Program_NG911_Interstate_Playbook_Chapter-2.pdf — **Implication:** caller location is a *first-class uncertain quantity* with a **confidence radius / uncertainty geometry** (a wireless Phase-II fix is an ellipse, not a point; a re-bid can move it). The model must carry location *with* its provenance (ANI/ALI vs device-based hybrid vs caller-stated), accuracy estimate, and timestamp — and **routing/coverage must degrade gracefully** when the fix is a 300 m circle, not a rooftop.
- **Medical Priority Dispatch (MPDS / ProQA) determinant codes.** Calls are classified by a structured interrogation into a **number–letter–number** determinant (e.g. `10-D-2`): a chief-complaint **protocol number (1–36)**, a **response level letter** `Ω/A/B/C/D/E` (Omega = referral/no-send → Echo = immediate life threat), and a **suffix** for sub-condition. Source: https://en.wikipedia.org/wiki/Medical_Priority_Dispatch_System and https://www.emergencydispatch.org/what-we-do/emergency-priority-dispatch-system/medical-protocol — **Implication:** priority is a **rule-derived determinant**, not a hidden score (the base spec demands this); the letter level drives the response configuration. A dispatcher may **override upward** but the override must be an audited event with a reason.
- **NIMS / ICS command structure (FEMS/FEMA + NFPA 1561).** Incidents organize by **span of control 3–7 (5 ideal)**; tactical structure is **geographic Divisions** and **functional Groups** under **Branches**, with **Staging**, and **Personnel Accountability** (check-in/out, **PAR — Personnel Accountability Report**). Source: https://www.emsics.com/resources/reference-documents/14-management-characteristics-of-nims/ and https://en.wikipedia.org/wiki/National_Incident_Management_System — **Implication:** the incident-command board is a *constrained org tree* with a **span-of-control invariant** and an **accountability ledger**, not a flat task list. A Division with 9 direct reports is a *modeled rule violation surfaced to the IC*, exactly like a gate conflict.
- **Apparatus response standards (NFPA 1710).** Career systems target **first-engine travel ≤ 240 s** and **full first-alarm (Effective Response Force) ≤ 480 s**, each at the **90th percentile**, with an **80 s turnout** budget. Source: https://www.iaff.org/wp-content/uploads/English_Version_-_NFPA_1710_standards_DFSR_Summary_2022_new.pdf — **Implication:** a structure-fire **box alarm / run card** dispatches a *package* (e.g. 3 engines + 1 truck + 1 chief), and the model scores response against percentile targets, not a single average.
- **MCI triage (START / SALT / JumpSTART).** Field triage is a **deterministic decision tree** — exactly the kind of rule engine this challenge wants. **START** ("RPM 30-2-can-do"): walking → **MINOR/green**; apnea after a single airway-reposition → **DECEASED/black**; breathing but **RR > 30/min** → **IMMEDIATE/red**; **radial pulse absent OR cap-refill > 2 s** → **IMMEDIATE/red**; **cannot follow simple commands** → **IMMEDIATE/red**; otherwise → **DELAYED/yellow**. **JumpSTART** (pediatric ≤ 8): normal RR **15–45**, apneic-but-pulse gets **5 rescue breaths** before black, neuro via **AVPU**. **SALT** adds a *global sort* (walk / wave / still), four **lifesaving interventions** (control major hemorrhage, open airway, chest decompression, auto-injector antidotes), and an explicit **EXPECTANT** category for "unlikely to survive given resources." Sources: https://www.ncbi.nlm.nih.gov/books/NBK459369/ , https://chemm.hhs.gov/startadult.htm , https://chemm.hhs.gov/salttriage.htm — **Implication:** triage is a **pure, totally-specified, exhaustively-testable function** from vitals → category; it is the perfect first hard-seam to prove the rule-engine + golden-test discipline, and the EXPECTANT/black distinction is an *ethically loaded* output that must be explainable and resource-relative.
- **CAD unit recommendation (closest-unit + coverage).** Modern CAD recommends the **closest *capable* available unit** by AVL + estimated travel, and tracks **coverage holes** created when units commit, sometimes recommending **move-ups/system-status relocations**. Source: https://en.wikipedia.org/wiki/Computer-aided_dispatch — **Implication:** recommendation = **capability match × availability × travel estimate**, and committing a unit **degrades coverage elsewhere** (the base spec's "coverage can worsen" is the core network effect).

## V1. The hardest technical seams (named)

1. **The append-only incident event log with logical time (the spine).** Everything authoritative — call create, caller update, location re-bid, determinant assignment/override, recommendation, unit status change, ICS structure change, triage tag, mutual-aid message, command decision — is an **immutable, monotonically-sequenced event**. Current unit/incident/board state is a **left-fold projection**; no mutable row is ever overwritten. This is what makes the non-goal "do not erase earlier caller reports" *structurally impossible to violate*, and what makes after-action reconstruction a pure replay.
2. **Uncertainty-preserving caller knowledge.** Caller-stated facts (location, # patients, hazard, nature) are **versioned claims with provenance + confidence + timestamp**, never destructive updates. "House fire" at T+0 and "actually the neighbor's BBQ" at T+90 s **coexist** as two claims with a supersedes-edge; the *current* belief is a resolution over them that records *why*. Conflicting callers (the seed scenario) produce **divergent claim sets the dispatcher sees**, not a silently-overwritten field.
3. **The determinant/priority rule engine (transparent, re-entrant).** Priority is computed from the current claim set by an **explainable rule pack** that emits `(determinant, level, contributing-facts[])`. When a caller fact changes, priority **recomputes and the delta is explainable** ("upgraded `B`→`D`: caller now reports *ineffective breathing*"). Rule packs are versioned data; the engine is pure.
4. **The unit-status state machine (illegal-transition-proof).** `available → dispatched → en_route → staged → on_scene → transporting → at_destination → available`, plus `out_of_service` and `clear`, with only the legal edges (e.g. you cannot go `available → on_scene` without `en_route`; `transporting` is reachable only from `on_scene`). Every transition is an event with actor + timestamp; **invalid transitions are rejected with an actionable error** naming the legal set.
5. **The recommendation + coverage seam.** Given an incident's required apparatus package, recommend the closest *capable* available units over a **deterministic nautical-style road-graph fixture** (travel = graph cost, not haversine), and compute the **coverage delta** the commitment causes. This couples dispatch to a **demand/coverage model**, which is where the interesting tradeoffs live (commit the close engine and open a hole, or send a farther one and hold coverage).
6. **The ICS org tree under span-of-control + accountability invariants.** Divisions/Groups/Branches/Staging as a constrained tree; **span 3–7** enforced; an **accountability ledger** that always reconciles assigned vs checked-in personnel and can render a **PAR** at any instant. Evacuation zones + safety notes are first-class.
7. **Mutual-aid as a typed protocol, not a status.** `requested → accepted | declined`, then `assigned → released`, across agency boundaries, each step an audited inter-agency message — because mutual aid is exactly where authority, timing, and provenance get contested in real after-actions.

## V2. Determinism & testability strategy (acceptance stays `npm test`, no network)

- **Virtual clock everywhere.** No `Date.now()`/`setTimeout` in core. Turnout/travel timers, the 240 s/480 s NFPA windows, location re-bid intervals, HOT-style decay, and accountability check-in timeouts all read an **injected clock** tests advance explicitly. The seed incident is driven by a **scripted timeline of timestamped events**.
- **Seeded entropy.** Any jitter (caller-update arrival, travel-time noise within a fixture's stated tolerance) draws from one seeded PRNG so a scenario replays identically.
- **Deterministic fixture adapters at every external boundary, named as adapters:** `CallIntakeAdapter` (scripted ANI/ALI + device-based location with confidence geometry), `GeocodeAdapter` + `RoadGraphRoutingAdapter` (fixture map: nodes, edges, costs, closures, restricted/staging zones), `AvlAdapter` (unit positions over time), `RadioLogAdapter` (timestamped transmissions as evidence), `MutualAidAdapter` (neighboring-agency responses). Each has a live-production sibling interface but the test path never reaches the network.
- **Event-sourced + snapshot/replay.** State = fold over the log; a **snapshot/restore** lets a test kill and rebuild mid-incident and assert identical projections. The **after-action timeline is a deterministic projection** — same log ⇒ byte-identical report (golden master).
- **Golden masters for the loaded outputs:** the MCI triage tag set for a fixed casualty fixture, the priority-recompute explanation trace, the ICS board snapshot, and the seed-incident after-action report are all golden files.

## V3. Adversarial / failure / edge-case fixtures (ship the chaos in the repo)

- **Conflicting callers** (seed): three callers give three locations + three patient counts for one event; the system must **hold all three as live claims**, route on the best-confidence location, and never silently pick one — the after-action shows all three and *why* one grounded the dispatch.
- **The drifting wireless fix:** a Phase-II location arrives as a 280 m ellipse, then a re-bid snaps it 400 m away. Coverage/recommendation must **not thrash** illegitimately and must record both fixes.
- **The illegal-transition flood:** a fixture replays out-of-order status messages (a unit reports `on_scene` before any `en_route`); each is **rejected with an actionable error**, the log records the *attempt*, and projected state stays consistent.
- **Span-of-control breach:** a chief assigns a 9th Division to one Branch; the board **flags the rule violation** to the IC rather than accepting it.
- **The coverage cascade:** committing the two closest engines to a working fire opens a **coverage hole** in an adjacent area where a new call lands; the system must surface the hole and the move-up option.
- **Triage boundary cases:** a patient at **exactly RR = 30**, a child at the **JumpSTART RR 15/45 edges**, an apneic adult who **starts breathing after airway-reposition** (red, not black), and a **resource-relative EXPECTANT** call — each must land in the standard's exact category.
- **Mutual-aid declined-then-needed:** a neighboring agency **declines**, the incident escalates, and a second request must be a *new* audited event (no resurrecting the declined one).
- **Clock-skew radio log:** a radio transmission arrives with an earlier timestamp than an already-logged event; the log must order **deterministically and visibly** (and the after-action must not imply a false causality).

## V4. Rigorous acceptance criteria, incl. property-based / invariant tests

Beyond the base spec's example tests, assert **system invariants** as property tests over randomized + scripted runs:

1. **Append-only / no-erasure (totality of history).** No caller claim, location, or determinant version is ever destroyed or mutated in place; every "current value" has a traceable supersession chain back to its origin event. (Differential test: replay the log, diff against live state.)
2. **Triage totality + determinism.** The START/SALT/JumpSTART function is **total** (every vitals tuple maps to exactly one category) and **pure** (same input ⇒ same tag), property-fuzzed across the vitals space, with the documented boundaries pinned.
3. **Unit-FSM safety.** No event sequence can drive a unit through an illegal edge; reachability of `transporting` implies a prior `on_scene`; fuzz random event streams and assert the projection only ever holds legal states.
4. **Priority monotonic explainability.** Every priority value carries a non-empty contributing-facts set drawn from *current* claims; recompute is deterministic; an upgrade/downgrade always names the fact that moved it.
5. **Accountability reconciliation.** At every instant, `assigned personnel == checked-in + checked-out + unaccounted`, and a PAR can be produced; "unaccounted > 0" is always surfaced.
6. **Span-of-control invariant.** No Branch/Division/Group ever silently exceeds 7 direct reports; breaches are flagged, never absorbed.
7. **Coverage conservation.** Committing a unit reduces modeled coverage in its area by exactly its contribution; releasing restores it; coverage is never created from nothing.
8. **After-action stability (determinism).** The seed-incident timeline + report is **byte-identical** across two runs from the same seed, and is **sufficient alone** (prose redacted) to answer a fixed battery of "who/what/when/why" audit queries.

## V5. Concrete first vertical slice (the on-ramp — build THIS first, ~20–24 cards)

Do not start with screens. Prove the spine on one fully-worked incident:

1. **Event log + logical clock + seeded entropy + snapshot/restore** (the kernel).
2. **Typed domain model + the unit-status FSM** with rejection of illegal transitions (golden errors).
3. **Uncertainty-preserving caller-claim store** (versioned, provenance, confidence) over the log.
4. **The determinant/priority rule engine** (MPDS-style `number-letter-number`, explainable recompute on caller-fact change).
5. **The MCI triage rule engine** (START + JumpSTART + SALT global-sort + EXPECTANT) as a pure, totally-tested function — *this single card de-risks the whole rule-engine thesis.*
6. **Recommendation over the fixture road-graph** (closest *capable* available unit) + **coverage-delta** computation.
7. **A minimal ICS board** (Divisions/Groups + Staging + accountability ledger) with the span-of-control invariant.
8. **The seed scenario end-to-end** — MCI triage + road closure + unit reassignment + conflicting callers — driven by a scripted timeline, with a **golden after-action report** and **one adversarial fixture** (conflicting callers) surviving.

If that slice is real, the radio-log evidence views, mutual-aid breadth, and operator UI are breadth on a proven, auditable spine.

## V6. Domain knowledge-debt to track (surface, do not bluff)

- **Triage standard selection + liability:** START vs SALT vs local protocol is a **medical-director decision**; pediatric cutoffs and the EXPECTANT category are ethically/legally sensitive → mark `expert-review-needed (EMS medical director)`; never present a triage tag as clinical advice.
- **MPDS is a licensed proprietary protocol (IAED).** The deterministic rule pack here is a **defensible open approximation**, explicitly *not* certified ProQA → `licensing + expert-review` debt; the engine must be swappable for a licensed pack.
- **Location accuracy semantics** (Phase-II ellipse, device-based hybrid, dispatchable location) vary by carrier/jurisdiction and evolve under FCC/NG9-1-1 rules → `standards-currency` debt.
- **NFPA 1710 numbers are career-department targets**; volunteer/combination and rural systems differ → mark the percentile targets as a **configurable rule pack**, not universal truth.
- **Mutual-aid legal authority** (who can commit whom, cost recovery, MABAS-style agreements) is jurisdiction-specific → `legal/expert-review` debt.
- **Fixture limits:** the road graph, travel-time model, and coverage model are **deterministic approximations**, not a routing engine or a real demand model → state assumptions explicitly and keep adapters swappable.

## V7. Why this is a great !Klein challenge

It stresses exactly what small-local-LLM swarms are weakest at and the spec most wants to prove: **decomposition of a domain into a pure rule-engine + an append-only event spine + a constrained state machine**, where correctness is *checkable* (triage is a total function; the FSM rejects illegal edges; the log can't erase history) rather than vibes. The hard parts are legible and dependency-ordered (kernel → claims → rule engines → recommendation/coverage → ICS → seed scenario), the invariants are property-testable, and the "preserve uncertainty under a clock, explain every decision from source facts" mandate turns governance into enforced types — the same north star as exemplar 36, sized to a 20–24-card foundation.
