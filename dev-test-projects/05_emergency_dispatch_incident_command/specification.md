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

---

## Small-model build guide (3B-ready)

> This section is written for a ~3B parameter local model following !Klein's `decompose_project` workflow. Every term is defined, every card is spelled out step-by-step, and every acceptance check is a deterministic assertion that can run offline with `npm test`. The 3B should **follow**, not figure out.

---

### 1. Glossary & ground rules

**Domain terms**

| Term | Plain meaning |
|------|---------------|
| PSAP | Public Safety Answering Point — the call center that receives 9-1-1 calls |
| CAD | Computer-Aided Dispatch — software that tracks incidents + recommends units |
| ICS / NIMS | Incident Command System / National Incident Management System — the standardized command structure for multi-agency emergencies |
| Incident | A single emergency event (fire, EMS call, crash) with an ID, status, and growing evidence record |
| Unit | An apparatus (engine, ambulance, patrol car) with a current status |
| Unit status FSM | Finite state machine governing the legal transitions a unit may make |
| Determinant | MPDS-style priority code, format `<number>-<letter>-<suffix>` (e.g. `10-D-2`); letter `A–E` is response level, `E` = most severe |
| Caller claim | One caller's statement about location, patient count, or hazard — versioned and never deleted |
| PAR | Personnel Accountability Report — a roll-call of who is checked in/out on scene |
| Division / Group | An ICS organizational unit under a Branch; Divisions are geographic, Groups are functional |
| Span of control | Number of direct reports under one ICS supervisor — must stay 3–7 |
| START triage | Simple Triage And Rapid Treatment: four-step algorithm → RED/YELLOW/GREEN/BLACK |
| JumpSTART | Pediatric variant of START (patients ≤ 8 years old); normal RR is 15–45 instead of 30 |
| EXPECTANT | SALT-triage category for patients unlikely to survive given current resources |
| AVL | Automatic Vehicle Location — unit GPS position |
| Road-graph fixture | In-repo JSON/TS map: nodes (intersections), edges (road segments with travel-cost), no live map API |
| Event log | Append-only, monotonically-sequenced list of facts; current state = fold (reduce) over the log |
| Logical clock | A monotonic integer counter injected into every event — never `Date.now()` in tests |
| Virtual clock | An in-memory `Clock` object tests can advance deterministically |
| Golden master | A committed expected-output file; a test asserts byte-equality of a computed output against it |
| Knowledge-debt comment | `// KNOWLEDGE-DEBT: <tag> — <explanation>` inline marker; surface uncertainty, never hide it |

**Stack**

- Language: **TypeScript**
- Runtime: **Node.js**
- Test runner: **Vitest** (`npm test` runs `vitest run`)
- No external HTTP calls anywhere in `src/` or `test/`
- All random values drawn from a seeded PRNG (use `src/lib/prng.ts`)

**Acceptance command (plain steps)**

1. `npm test` — runs `vitest run` from the project root
2. Every test must pass; any `FAIL` is a blocker
3. No network calls: if a test imports a real API client, it fails
4. No `Date.now()` or `Math.random()` in core: use the injected clock and the seeded PRNG

**Determinism rules (imperative)**

- Never call the network in a test; use the fixture adapter in `src/adapters/`
- Never call `Date.now()`; accept a `Clock` parameter (see `S02`)
- Never call `Math.random()`; use `createPrng(seed)` from `src/lib/prng.ts`
- Event log entries are assigned sequence numbers by the log itself; never assign them in calling code
- Golden-master files live in `test/golden/`; regenerate with `REGEN_GOLDEN=1 npm test`, then commit

---

### 2. The explicit task graph for the first vertical slice

The first slice maps to V5 of this spec (items 1–8). It has **21 cards** (`S01`–`S21`).

---

**`S01` — TypeScript project scaffold + types barrel**
dependsOn: none
files: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/types/index.ts`

interface:
```ts
// src/types/index.ts — re-exports everything; start empty, grow it card-by-card
export {};
```

how to implement:
1. Create `package.json` with `"type":"module"`, `vitest` dev-dep, `"test":"vitest run"` script.
2. Create `tsconfig.json` with `"strict":true`, `"module":"NodeNext"`, `"outDir":"dist"`.
3. Create `vitest.config.ts` with `test: { environment: "node" }`.
4. Create `src/types/index.ts` as an empty barrel; add to it in each subsequent card.

acceptance: `npm test` exits 0 with no test files yet (Vitest prints "No test files found" — that is OK for this card).

---

**`S02` — Virtual clock + seeded PRNG**
dependsOn: `S01`
files: `src/lib/clock.ts`, `src/lib/prng.ts`, `test/lib/clock.test.ts`, `test/lib/prng.test.ts`

interface:
```ts
// src/lib/clock.ts
export interface Clock { now(): number; advance(ms: number): void; }
export function createClock(startMs?: number): Clock;

// src/lib/prng.ts
export function createPrng(seed: number): () => number; // returns float in [0,1)
```

how to implement:
1. `createClock(startMs=0)`: holds a mutable `let t = startMs`; `now()` returns `t`; `advance(ms)` sets `t += ms`.
2. `createPrng(seed)`: implement a simple [mulberry32](https://en.wikipedia.org/wiki/Mulberry32) or xorshift — four lines, no external dep, deterministic.
3. Write `test/lib/clock.test.ts`: assert `advance(1000)` makes `now()` return `startMs+1000`.
4. Write `test/lib/prng.test.ts`: assert `createPrng(42)()` equals the same value on every run (pin the first output in the test).

acceptance: `npm test` green; both test files pass; same PRNG seed always produces the same sequence.

---

**`S03` — Core domain types**
dependsOn: `S01`
files: `src/types/domain.ts`, `test/types/domain.test.ts`

interface:
```ts
// src/types/domain.ts
export type IncidentId = string;
export type UnitId = string;
export type AgencyId = string;
export type ClaimId = string;

export type UnitStatus =
  | "available" | "dispatched" | "en_route" | "staged"
  | "on_scene" | "transporting" | "at_destination"
  | "out_of_service" | "clear";

export type TriageCategory = "IMMEDIATE" | "DELAYED" | "MINOR" | "DECEASED" | "EXPECTANT";
export type ResponseLevel = "Omega" | "A" | "B" | "C" | "D" | "E";

export interface Vitals {
  walking: boolean;          // can walk to assembly area?
  breathing: boolean;        // breathing (after one airway reposition attempt)?
  respiratoryRate: number;   // breaths per minute
  radialPulse: boolean;      // radial pulse present?
  capRefillSecs: number;     // capillary refill in seconds
  followsCommands: boolean;  // can follow simple commands?
  ageGroupAdult: boolean;    // true = adult (START); false = pediatric ≤8 (JumpSTART)
}

export interface Location {
  lat: number; lon: number;
  accuracyMeters: number;    // uncertainty radius
  provenance: "ANI_ALI" | "DEVICE_HYBRID" | "CALLER_STATED";
  timestamp: number;         // logical clock value
}

export type MutualAidStatus =
  | "requested" | "accepted" | "declined" | "assigned" | "released";
```

how to implement:
1. Write exactly the types above into `src/types/domain.ts`.
2. Export all from `src/types/index.ts`.
3. Write `test/types/domain.test.ts` — import each type and do a trivial assignment to check the file compiles; one `expect(true).toBe(true)` as a placeholder.

acceptance: `npm test` green; TypeScript compiles without errors.

---

**`S04` — Event log + logical clock**
dependsOn: `S02`, `S03`
files: `src/core/event-log.ts`, `test/core/event-log.test.ts`

interface:
```ts
// src/core/event-log.ts
export interface IncidentEvent {
  seq: number;       // monotonically assigned by the log
  type: string;      // e.g. "CALL_CREATED", "UNIT_STATUS_CHANGED"
  payload: unknown;
  clockMs: number;   // clock.now() at append time
}

export interface EventLog {
  append(type: string, payload: unknown): IncidentEvent;
  all(): readonly IncidentEvent[];
  snapshot(): readonly IncidentEvent[];   // returns a copy for replay
  restore(events: readonly IncidentEvent[]): void;
}

export function createEventLog(clock: Clock): EventLog;
```

how to implement:
1. Internal array `events: IncidentEvent[]`; `seq` counter starts at 1.
2. `append`: push `{ seq: seq++, type, payload, clockMs: clock.now() }`, return the event.
3. `all`: return `[...events]` (defensive copy).
4. `snapshot`: return `JSON.parse(JSON.stringify(events))` (deep clone).
5. `restore(evts)`: replace internal array with a deep clone of `evts`; reset seq to `max(evts.map(e=>e.seq))+1`.

acceptance (`test/core/event-log.test.ts`):
- Appended events have ascending `seq` values.
- `snapshot()` then `restore()` produces identical `all()` output.
- `restore` after additional appends resets correctly.

---

**`S05` — Unit-status finite state machine**
dependsOn: `S03`
files: `src/core/unit-fsm.ts`, `test/core/unit-fsm.test.ts`

interface:
```ts
// src/core/unit-fsm.ts
export type TransitionResult =
  | { ok: true;  nextStatus: UnitStatus }
  | { ok: false; error: string; legalTransitions: UnitStatus[] };

export function transition(
  current: UnitStatus,
  next: UnitStatus
): TransitionResult;

export function legalNextStatuses(current: UnitStatus): UnitStatus[];
```

how to implement:
1. Define the adjacency map as a `const` object:
   ```ts
   const EDGES: Record<UnitStatus, UnitStatus[]> = {
     available:       ["dispatched", "out_of_service"],
     dispatched:      ["en_route", "available", "out_of_service"],
     en_route:        ["staged", "on_scene", "out_of_service"],
     staged:          ["on_scene", "available", "out_of_service"],
     on_scene:        ["transporting", "available", "out_of_service"],
     transporting:    ["at_destination", "out_of_service"],
     at_destination:  ["available", "clear", "out_of_service"],
     out_of_service:  ["available", "clear"],
     clear:           ["available", "dispatched"],
   };
   ```
2. `transition(current, next)`: look up `EDGES[current]`; if `next` is in the list return `{ ok:true, nextStatus:next }`; else return `{ ok:false, error: \`Cannot go ${current}→${next}\`, legalTransitions: EDGES[current] }`.
3. `legalNextStatuses(current)`: return `EDGES[current]`.

acceptance (`test/core/unit-fsm.test.ts`):
- `transition("available","dispatched")` → `{ ok:true }`.
- `transition("available","on_scene")` → `{ ok:false }` with `legalTransitions` including `"dispatched"`.
- `transition("transporting","available")` → `{ ok:false }` (must go to `at_destination` first).
- All legal edges: one `expect` per edge in `EDGES` asserting `ok:true`.

---

**`S06` — Caller-claim store (versioned, uncertainty-preserving)**
dependsOn: `S03`, `S04`
files: `src/core/caller-claims.ts`, `test/core/caller-claims.test.ts`

interface:
```ts
// src/core/caller-claims.ts
export interface CallerClaim {
  id: ClaimId;
  callerId: string;
  field: "location" | "patient_count" | "hazard" | "nature";
  value: unknown;
  confidence: number;          // 0–1
  timestamp: number;           // clockMs
  supersededById?: ClaimId;    // set when a later claim overrides this one
}

export interface CallerClaimStore {
  add(claim: Omit<CallerClaim, "id" | "supersededById">): CallerClaim;
  supersede(oldId: ClaimId, newClaim: Omit<CallerClaim, "id" | "supersededById">): CallerClaim;
  active(): CallerClaim[];      // claims not yet superseded
  all(): CallerClaim[];         // every claim ever added (append-only)
  forField(field: CallerClaim["field"]): CallerClaim[];  // all claims for that field, newest first
}

export function createCallerClaimStore(): CallerClaimStore;
```

how to implement:
1. Internal array; `add` generates a UUID-like ID (`"claim-" + counter++`); never delete.
2. `supersede(oldId, newClaimData)`: find the old claim, set its `supersededById` to the new ID, push the new claim.
3. `active()`: filter where `!claim.supersededById`.
4. `forField(field)`: filter by field, sort descending by timestamp.

acceptance (`test/core/caller-claims.test.ts`):
- Adding three claims for `patient_count` and superseding the first: `all()` length = 3; `active()` length = 2; `active()` does not include the superseded claim.
- The original claim is still in `all()` (non-destructive, append-only).
- Conflicting callers: two claims for `"location"` with different values both appear in `forField("location")`.

---

**`S07` — MPDS-style determinant + priority rule engine**
dependsOn: `S03`, `S06`
files: `src/core/priority-engine.ts`, `test/core/priority-engine.test.ts`

interface:
```ts
// src/core/priority-engine.ts
export interface Determinant {
  protocol: number;          // 1–36 chief-complaint protocol number
  level: ResponseLevel;      // Omega | A | B | C | D | E
  suffix: string;            // sub-condition suffix, e.g. "2"
  code: string;              // full code string, e.g. "10-D-2"
}

export interface PriorityResult {
  determinant: Determinant;
  contributingFacts: string[];   // human-readable list of facts that drove this level
  overrideReason?: string;       // present only when dispatcher manually upgraded
}

export function computePriority(
  activeClaims: CallerClaim[],
  rulePackVersion: string
): PriorityResult;
```

how to implement:
1. Write a minimal rule pack in `src/core/rule-packs/base-v1.ts`:
   - Nature "cardiac_arrest" → protocol 9, level D.
   - Nature "chest_pain" + hazard absent → protocol 10, level C.
   - Nature "structure_fire" → protocol 69, level E.
   - Nature "trauma_minor" → protocol 30, level B.
   - Default fallback → protocol 1, level B, suffix "0".
2. `computePriority` extracts the `nature` and `hazard` claims with highest confidence, applies the rule pack, and returns the result with `contributingFacts` naming the claims used.
3. `rulePackVersion` is stamped on the result for auditability; `"base-v1"` is the only pack for now.

acceptance (`test/core/priority-engine.test.ts`):
- Claims `[{ field:"nature", value:"cardiac_arrest" }]` → level `"D"`, `contributingFacts` mentions `"cardiac_arrest"`.
- Claims `[{ field:"nature", value:"structure_fire" }]` → level `"E"`.
- Adding a new claim that changes nature: recompute returns a new level; `contributingFacts` updated.
- `contributingFacts` is always non-empty.

---

**`S08` — START / JumpSTART / SALT triage engine (pure function)**
dependsOn: `S03`
files: `src/core/triage.ts`, `test/core/triage.test.ts`

interface:
```ts
// src/core/triage.ts
export function triageSTART(v: Vitals): TriageCategory;
// Adult (ageGroupAdult=true): START RPM-30-2-can-do algorithm.

export function triageJumpSTART(v: Vitals): TriageCategory;
// Pediatric (ageGroupAdult=false): JumpSTART; normal RR range 15–45.

export function triage(v: Vitals): TriageCategory;
// Dispatcher: calls triageSTART if ageGroupAdult, else triageJumpSTART.

export function triageSALTSort(patients: Vitals[]): { index: number; category: TriageCategory }[];
// Global sort: walking→MINOR, waving→DELAYED, still→IMMEDIATE; then apply triage() for refinement.
```

how to implement (triageSTART):
1. If `v.walking` → return `"MINOR"`.
2. If `!v.breathing` → return `"DECEASED"` (adult; no rescue breaths in START).
3. If `v.respiratoryRate > 30` → return `"IMMEDIATE"`.
4. If `!v.radialPulse || v.capRefillSecs > 2` → return `"IMMEDIATE"`.
5. If `!v.followsCommands` → return `"IMMEDIATE"`.
6. Return `"DELAYED"`.

how to implement (triageJumpSTART):
1. If `v.walking` → return `"MINOR"`.
2. If `!v.breathing && !v.radialPulse` → return `"DECEASED"`.
3. If `!v.breathing && v.radialPulse` → return `"IMMEDIATE"` (would-give-rescue-breaths; mark as IMMEDIATE for resource reasons).
4. If `v.respiratoryRate < 15 || v.respiratoryRate > 45` → return `"IMMEDIATE"`.
5. If `!v.radialPulse` → return `"IMMEDIATE"`.
6. If `!v.followsCommands` → return `"IMMEDIATE"`.
7. Return `"DELAYED"`.

acceptance (`test/core/triage.test.ts`) — pin every boundary case:
- Walking adult → `"MINOR"`.
- Non-breathing adult (no airway attempt) → `"DECEASED"`.
- RR=31, adult → `"IMMEDIATE"`.
- RR=30, adult, radial pulse present, cap-refill=1, follows commands → `"DELAYED"` (exact boundary: 30 is NOT > 30).
- Cap-refill=2.1 s adult → `"IMMEDIATE"`.
- Pediatric, RR=14 → `"IMMEDIATE"`.
- Pediatric, RR=46 → `"IMMEDIATE"`.
- Pediatric, RR=30, pulse present, follows commands → `"DELAYED"`.
- All inputs: `triage()` never throws, always returns a `TriageCategory` (total function).

---

**`S09` — Road-graph fixture + routing adapter**
dependsOn: `S03`
files: `src/adapters/road-graph-routing.ts`, `src/fixtures/road-graph.ts`, `test/adapters/road-graph-routing.test.ts`

interface:
```ts
// src/adapters/road-graph-routing.ts
export interface RoadNode { id: string; lat: number; lon: number; }
export interface RoadEdge { from: string; to: string; costSeconds: number; closed?: boolean; }
export interface RoadGraph { nodes: RoadNode[]; edges: RoadEdge[]; }

export interface RoutingAdapter {
  shortestPath(fromNodeId: string, toNodeId: string): { path: string[]; costSeconds: number } | null;
}

export function createRoadGraphRoutingAdapter(graph: RoadGraph): RoutingAdapter;
```

how to implement:
1. Implement Dijkstra over the graph; skip edges where `closed===true`.
2. Return `null` if no path exists.
3. The fixture in `src/fixtures/road-graph.ts` must define at least 6 nodes and 8 edges in a shape that has one forced detour when an edge is closed.

acceptance (`test/adapters/road-graph-routing.test.ts`):
- Direct path exists and returns the correct cost.
- When the direct edge is marked `closed:true`, the path takes the detour and cost is higher.
- No path between disconnected nodes returns `null`.

---

**`S10` — AVL adapter + coverage-delta computation**
dependsOn: `S03`, `S09`
files: `src/adapters/avl.ts`, `src/core/coverage.ts`, `test/core/coverage.test.ts`

interface:
```ts
// src/adapters/avl.ts
export interface UnitPosition { unitId: UnitId; nodeId: string; timestamp: number; }
export interface AvlAdapter { getPosition(unitId: UnitId): UnitPosition | null; }
export function createFixtureAvlAdapter(positions: UnitPosition[]): AvlAdapter;

// src/core/coverage.ts
export interface UnitProfile { unitId: UnitId; capability: string; status: UnitStatus; }
export interface CoverageDelta { coverageReduced: boolean; affectedArea: string[]; }
export function computeCoverageDelta(
  committedUnitId: UnitId,
  allUnits: UnitProfile[],
  avl: AvlAdapter,
  graph: RoadGraph
): CoverageDelta;
```

how to implement:
1. `createFixtureAvlAdapter`: find the matching `UnitPosition` by `unitId`.
2. `computeCoverageDelta`: identify the node where the committed unit was (via AVL); find all nodes that were within 2 hops of that node; if no other `available` unit covers those nodes, mark `coverageReduced:true` and list the affected node IDs.
3. Keep the coverage model simple: "a node is covered if at least one available unit is within 2 graph-hops."

acceptance (`test/core/coverage.test.ts`):
- Committing the only unit near a cluster of nodes → `coverageReduced:true`, affected nodes listed.
- Committing one of two available units near the same area → `coverageReduced:false` (the other unit still covers).

---

**`S11` — Unit recommender (closest capable available)**
dependsOn: `S09`, `S10`
files: `src/core/recommender.ts`, `test/core/recommender.test.ts`

interface:
```ts
// src/core/recommender.ts
export interface RecommendationRequest {
  incidentNodeId: string;
  requiredCapability: string;
}
export interface UnitRecommendation {
  unitId: UnitId;
  travelCostSeconds: number;
  coverageDeltaIfCommitted: CoverageDelta;
}
export function recommendUnits(
  req: RecommendationRequest,
  units: UnitProfile[],
  avl: AvlAdapter,
  routing: RoutingAdapter,
  graph: RoadGraph
): UnitRecommendation[];   // sorted by travelCostSeconds ascending
```

how to implement:
1. Filter `units` to those with `status=="available"` and `capability == req.requiredCapability`.
2. For each: get position from AVL; compute `shortestPath(unit.nodeId, req.incidentNodeId)`.
3. Compute `coverageDeltaIfCommitted` via `S10`.
4. Sort ascending by `travelCostSeconds`; return the full ranked list.

acceptance (`test/core/recommender.test.ts`):
- Three available units at different distances: closest returned first.
- Unit with wrong capability excluded.
- Unit with status `"dispatched"` excluded.
- Recommendation list includes `coverageDeltaIfCommitted` for each entry.

---

**`S12` — Minimal ICS board (Divisions/Groups + span-of-control)**
dependsOn: `S03`
files: `src/core/ics-board.ts`, `test/core/ics-board.test.ts`

interface:
```ts
// src/core/ics-board.ts
export type IcsNodeType = "Branch" | "Division" | "Group" | "Staging";

export interface IcsNode {
  id: string;
  type: IcsNodeType;
  label: string;
  parentId?: string;
  directReports: string[];   // child IcsNode ids
}

export interface SpanViolation { nodeId: string; count: number; max: 7; }

export interface IcsBoard {
  addNode(node: Omit<IcsNode, "directReports">): IcsNode;
  assignUnit(unitId: UnitId, divisionGroupId: string): void;
  getSpanViolations(): SpanViolation[];
  assignedUnits(nodeId: string): UnitId[];
}

export function createIcsBoard(): IcsBoard;
```

how to implement:
1. `addNode`: add to internal map; if `parentId` given, add this node's id to the parent's `directReports`.
2. `getSpanViolations`: scan all nodes; any with `directReports.length > 7` is a violation.
3. `assignUnit`: associate unitId with the node (internal map `nodeId → UnitId[]`).

acceptance (`test/core/ics-board.test.ts`):
- Adding 8 Divisions to one Branch → `getSpanViolations()` returns one violation with `count:8`.
- Adding 7 Divisions → no violation.
- Assigned units appear in `assignedUnits(nodeId)`.

---

**`S13` — Accountability ledger + PAR**
dependsOn: `S12`
files: `src/core/accountability.ts`, `test/core/accountability.test.ts`

interface:
```ts
// src/core/accountability.ts
export type PersonnelStatus = "assigned" | "checked_in" | "checked_out";

export interface PersonnelRecord {
  personnelId: string;
  name: string;
  status: PersonnelStatus;
  divisionGroupId?: string;
}

export interface AccountabilityLedger {
  checkin(personnelId: string, divisionGroupId: string): void;
  checkout(personnelId: string): void;
  assign(record: Omit<PersonnelRecord, "status">): void;
  par(): { checkedIn: string[]; checkedOut: string[]; unaccounted: string[] };
  // Invariant: checkedIn + checkedOut + unaccounted = all assigned
}

export function createAccountabilityLedger(): AccountabilityLedger;
```

how to implement:
1. Internal `Map<string, PersonnelRecord>`.
2. `assign`: add with `status:"assigned"`; `checkin`: set `status:"checked_in"` + divisionGroupId; `checkout`: set `status:"checked_out"`.
3. `par()`: partition all records by status; `unaccounted` = those with status `"assigned"` (neither checked in nor out).

acceptance (`test/core/accountability.test.ts`):
- Assign 3, check in 2, check out 1 → PAR: checkedIn=[2 ids], checkedOut=[1 id], unaccounted=[0]. Wait — re-check: assign 3, check in 2, don't touch the third → unaccounted=[1 id].
- `checkedIn.length + checkedOut.length + unaccounted.length === all assigned` always.

---

**`S14` — Mutual-aid workflow**
dependsOn: `S03`, `S04`
files: `src/core/mutual-aid.ts`, `test/core/mutual-aid.test.ts`

interface:
```ts
// src/core/mutual-aid.ts
export interface MutualAidRequest {
  id: string;
  requestingAgency: AgencyId;
  respondingAgency: AgencyId;
  status: MutualAidStatus;
  history: { status: MutualAidStatus; reason?: string; timestamp: number }[];
}

export interface MutualAidWorkflow {
  request(requestingAgency: AgencyId, respondingAgency: AgencyId, clock: Clock): MutualAidRequest;
  accept(requestId: string, clock: Clock): MutualAidRequest;
  decline(requestId: string, reason: string, clock: Clock): MutualAidRequest;
  assign(requestId: string, clock: Clock): MutualAidRequest;
  release(requestId: string, clock: Clock): MutualAidRequest;
  get(requestId: string): MutualAidRequest | undefined;
}

export function createMutualAidWorkflow(): MutualAidWorkflow;
```

how to implement:
1. Map of requests by ID.
2. Each method validates the expected current status (e.g., `accept` only works on `"requested"`), throws on invalid transition.
3. Always appends to `history` before updating `status`.
4. A declined request can never be accepted/assigned (that attempt must throw).

acceptance (`test/core/mutual-aid.test.ts`):
- Full happy-path: request → accept → assign → release.
- Decline path: request → decline; attempting `accept` on a declined request throws.
- Re-request after decline creates a **new** request with a new ID (the old declined one is unchanged).

---

**`S15` — Seed fixture: road graph + units + initial positions**
dependsOn: `S09`, `S10`
files: `src/fixtures/seed-scenario.ts`

interface:
```ts
// src/fixtures/seed-scenario.ts
// Exports static fixture data for the seed MCI scenario.
export const SEED_ROAD_GRAPH: RoadGraph;     // 8+ nodes, 12+ edges, one closed edge
export const SEED_UNITS: UnitProfile[];       // at least 4 units: 2 engines, 1 ambulance, 1 chief
export const SEED_AVL: UnitPosition[];        // initial positions for all seed units
export const SEED_CALLERS: Array<{
  callerId: string;
  claims: Array<{ field: CallerClaim["field"]; value: unknown; confidence: number }>;
}>;  // 3 conflicting callers with different locations and patient counts
export const SEED_INCIDENT_NODE = "node-mci-scene";  // the incident location
```

how to implement:
1. Define a plausible mini-map: nodes like `"station-1"`, `"station-2"`, `"intersection-A"`, `"mci-scene"`, `"hospital"`.
2. Define units: `{ unitId:"E1", capability:"fire", status:"available" }`, etc.
3. Position each unit at a node.
4. Define 3 callers: caller-A says `patient_count:15`, caller-B says `patient_count:8`, caller-C says `patient_count:22`; all give slightly different location confidences.

acceptance: file compiles; a simple import test asserts `SEED_UNITS.length >= 4` and `SEED_CALLERS.length === 3`.

---

**`S16` — Unit-status events wired to event log**
dependsOn: `S04`, `S05`
files: `src/core/unit-registry.ts`, `test/core/unit-registry.test.ts`

interface:
```ts
// src/core/unit-registry.ts
export interface UnitState { unitId: UnitId; status: UnitStatus; }

export interface UnitRegistry {
  register(unitId: UnitId, initialStatus: UnitStatus): void;
  transition(unitId: UnitId, next: UnitStatus): TransitionResult;
  current(unitId: UnitId): UnitState | undefined;
  history(unitId: UnitId): IncidentEvent[];   // all transition events for this unit
}

export function createUnitRegistry(log: EventLog): UnitRegistry;
```

how to implement:
1. On `transition` success: append `{ type:"UNIT_STATUS_CHANGED", payload:{unitId,from,to} }` to the log; update internal state map.
2. On `transition` failure: do NOT append to log; return the error from the FSM.
3. `history(unitId)`: filter `log.all()` by `payload.unitId`.

acceptance (`test/core/unit-registry.test.ts`):
- Legal transition: event appended, `current()` updated.
- Illegal transition: no event appended, error returned, `current()` unchanged.
- History returns only events for the specified unit.
- Snapshot/restore: restore the log and recreate the registry from `log.all()` → same `current()` state.

---

**`S17` — Incident manager (create, update, resolve)**
dependsOn: `S04`, `S06`, `S07`
files: `src/core/incident-manager.ts`, `test/core/incident-manager.test.ts`

interface:
```ts
// src/core/incident-manager.ts
export interface IncidentRecord {
  id: IncidentId;
  status: "open" | "closed";
  location: Location;
  priority: PriorityResult;
  unitIds: UnitId[];        // currently assigned
}

export interface IncidentManager {
  create(location: Location, initialClaim: Omit<CallerClaim,"id"|"supersededById">, clock: Clock): IncidentRecord;
  addClaim(incidentId: IncidentId, claim: Omit<CallerClaim,"id"|"supersededById">, clock: Clock): void;
  recomputePriority(incidentId: IncidentId): PriorityResult;
  assignUnit(incidentId: IncidentId, unitId: UnitId): void;
  close(incidentId: IncidentId, clock: Clock): void;
  get(incidentId: IncidentId): IncidentRecord | undefined;
}

export function createIncidentManager(log: EventLog, claimStore: CallerClaimStore): IncidentManager;
```

how to implement:
1. `create`: append `INCIDENT_CREATED` event; store IncidentRecord internally.
2. `addClaim`: pass to the claim store; append `CLAIM_ADDED` event; call `recomputePriority` and append `PRIORITY_RECOMPUTED` event.
3. `recomputePriority`: call `computePriority` with the incident's active claims; update stored priority.
4. `close`: append `INCIDENT_CLOSED` event; set status `"closed"`.

acceptance (`test/core/incident-manager.test.ts`):
- Creating an incident: `INCIDENT_CREATED` in log, `get()` returns the record.
- Adding a claim that changes nature: priority recomputed and different from initial; `PRIORITY_RECOMPUTED` event in log.
- `contributingFacts` is non-empty on every recomputed result.
- Snapshot/restore: re-create the manager from the restored log and assert identical `get()` output.

---

**`S18` — After-action timeline projector**
dependsOn: `S04`, `S16`, `S17`
files: `src/core/after-action.ts`, `test/core/after-action.test.ts`

interface:
```ts
// src/core/after-action.ts
export interface TimelineEntry {
  seq: number;
  clockMs: number;
  eventType: string;
  summary: string;   // human-readable one-liner
  payload: unknown;
}

export function projectTimeline(log: EventLog): TimelineEntry[];
// Returns all events in seq order with a summary string for each known event type.

export function renderAfterActionReport(timeline: TimelineEntry[]): string;
// Returns a deterministic text report; same timeline ⇒ identical string.
```

how to implement:
1. `projectTimeline`: iterate `log.all()`; for each event type produce a `summary` string using a switch; unknown types get `"[unknown event type]"`.
2. `renderAfterActionReport`: join entries as `"[${e.seq}] t=${e.clockMs}ms ${e.eventType}: ${e.summary}\n"`; no timestamps from `Date.now()`.

acceptance (`test/core/after-action.test.ts`):
- Build a small log with 3 known event types; `projectTimeline` returns 3 entries in seq order.
- Same log input → `renderAfterActionReport` output is identical across two calls (deterministic).
- Golden master test: write the report to `test/golden/after-action.txt` on first run with `REGEN_GOLDEN=1`; on normal run assert `===` to the file content.

---

**`S19` — Adversarial fixture: illegal-transition flood**
dependsOn: `S16`
files: `src/fixtures/adversarial-transitions.ts`, `test/adversarial/illegal-transitions.test.ts`

interface:
```ts
// src/fixtures/adversarial-transitions.ts
// A scripted sequence of out-of-order status messages for one unit.
export const ILLEGAL_TRANSITION_SEQUENCE: Array<{ unitId: UnitId; next: UnitStatus }>;
// At least 5 entries; several are illegal (e.g. available→on_scene).
```

how to implement:
1. Define a mix of legal and illegal transitions for unit `"E1"`, e.g.:
   ```
   available→dispatched (legal)
   dispatched→on_scene  (illegal — must go through en_route)
   dispatched→en_route  (legal)
   en_route→on_scene    (legal)
   on_scene→at_destination (illegal — must go through transporting)
   ```
2. In the test: apply each in sequence; legal ones must succeed; illegal ones must return `{ ok:false }` with a non-empty `legalTransitions`; the unit's `current()` status must never hold an illegal state.

acceptance (`test/adversarial/illegal-transitions.test.ts`):
- Every illegal attempt returns `{ ok:false }`.
- Every legal attempt returns `{ ok:true }`.
- After the whole sequence, the unit's `current().status` matches the last successful transition.

---

**`S20` — Adversarial fixture: conflicting callers**
dependsOn: `S06`, `S15`, `S17`
files: `test/adversarial/conflicting-callers.test.ts`

no new source files — test only.

how to implement the test:
1. Create a ClaimStore; add all three SEED_CALLERS claims for `"location"` and `"patient_count"`.
2. Assert `all().length === 6` (3 callers × 2 fields each).
3. Assert `active().length === 6` (none superseded yet — all three are active divergent claims).
4. Assert `forField("location").length === 3` (all three locations present).
5. Supersede caller-A's location with caller-B's; assert `active().length === 5`; caller-A's location claim is in `all()` but NOT in `active()`.

acceptance: test passes; no claims are silently deleted.

---

**`S21` — Seed scenario end-to-end**
dependsOn: `S15`, `S16`, `S17`, `S18`, `S19`, `S20`, `S11`, `S12`, `S13`, `S14`, `S08`
files: `test/integration/seed-scenario.test.ts`, `test/golden/seed-after-action.txt`

how to implement the test:
1. Import all fixtures from `src/fixtures/seed-scenario.ts`.
2. Create clock (start at 0), event log, claim store, incident manager, unit registry, ICS board, accountability ledger, mutual-aid workflow, routing adapter, AVL adapter.
3. Script the following timeline (advance clock by 30 s each step):
   - t=0: Create incident at `SEED_INCIDENT_NODE`; add all 3 conflicting caller claims.
   - t=30: Call `recommendUnits` for capability `"fire"` → assert top recommendation is the closest unit.
   - t=60: Transition E1: `available→dispatched→en_route→on_scene`; assert all succeed.
   - t=90: Triage 3 patients: `{walking:true}` (GREEN), `{respiratoryRate:32, breathing:true, ...}` (IMMEDIATE), `{breathing:false}` (DECEASED).
   - t=120: Add an ICS Branch with 8 Divisions → assert `getSpanViolations()` returns one violation.
   - t=150: Request mutual aid from agency `"B"`; decline; assert re-request creates a new ID.
   - t=180: `computePriority` with updated claims → assert `contributingFacts` non-empty.
   - t=210: Close incident; render after-action report.
4. On `REGEN_GOLDEN=1` write report to `test/golden/seed-after-action.txt`.
5. On normal run: assert report equals golden-master content.

acceptance: all assertions pass; golden master matches across two runs; `npm test` green.

---

### 3. The decomposition method for the rest

After the first slice (`S01`–`S21`) is passing, apply this recipe to expand the remaining breadth:

**Recipe — turning a feature description into a card cluster**

1. **Name the pure core first.** Every feature has a pure computation at its heart (a rule, a calculation, a projection). Make that a standalone card with no I/O.
2. **Wire it to the event log second.** If the computation changes state, add a card that appends the right events and projects state from the log.
3. **Add the adversarial fixture third.** Every spec invariant has a pathological input that breaks naive implementations. Ship it as a fixture + a dedicated test card.
4. **Add the adapter last.** Adapters wrap external boundaries; implement the fixture version first, stub the production version.

**dependsOn discipline:** every card must list the ids of cards whose types or functions it calls. A 3B model must not guess; the list must be exact.

---

**Worked example A — Radio log evidence (V1 seam: append-only, clock-skew)**

Larger feature: "Radio transmission evidence with clock-skew handling."

Break into:

- **R01** — `RadioTransmission` type (fields: `id`, `timestamp`, `actorId`, `body`). dependsOn: `S03`.
- **R02** — `RadioLogAdapter` (fixture: array of pre-scripted transmissions, sorted by fixture-timestamp). dependsOn: `R01`.
- **R03** — `appendRadioTransmission(log, radio, clock)` — appends the transmission as an event; if `transmission.timestamp < clock.now()`, marks it `clockSkew:true` in the payload but still appends it. dependsOn: `S04`, `R01`.
- **R04** — Adversarial: `clock-skew-radio.test.ts` — appends a transmission whose timestamp is earlier than the last event; asserts it is appended (not dropped), marked `clockSkew:true`, and `projectTimeline` still orders by `seq` not `timestamp`. dependsOn: `R03`, `S18`.

**Worked example B — NFPA 1710 response-time scoring**

Larger feature: "Score response against NFPA 1710 240 s / 480 s targets."

Break into:

- **N01** — `ResponseTimeTargets` type (`firstArrivalTargetMs:240000`, `erfTargetMs:480000`, `turnoutBudgetMs:80000`; configurable, not hardcoded). dependsOn: `S03`.
- **N02** — `computeResponseTimeScore(dispatchedAt, firstArrivalAt, erfArrivalAt, targets)` → `{ firstArrivalMet:boolean, erfMet:boolean, turnoutMs:number }`. Pure function, no I/O. dependsOn: `N01`.
- **N03** — Wire into `UnitRegistry`: when unit transitions to `on_scene`, compute score against the incident's dispatch time and emit a `RESPONSE_TIME_SCORED` event. dependsOn: `N02`, `S16`, `S17`.
- **N04** — Golden test: scripted timeline where clock puts first arrival at t=235 s (meets target) and a second unit at t=490 s (misses ERF). Assert both booleans. dependsOn: `N03`.

**Worked example C — Mutual aid breadth: declined-then-needed**

Larger feature: "Declined mutual aid must be re-requested as a new audited event."

Break into:

- **M01** — Extend `MutualAidWorkflow.newRequest(respondingAgency, reason)` that creates a second request explicitly. dependsOn: `S14`.
- **M02** — Adversarial: `declined-then-needed.test.ts` — request A from agency B → decline; incident escalates (priority upgraded to E); create a new request B from agency B; assert request A still has `status:"declined"` and request B has `status:"requested"` with a different ID; no resurrection of A. dependsOn: `M01`, `S14`.

---

### 4. Per-task implementation conventions

**File/folder layout**
```
src/
  types/         domain types (S03)
  lib/           utilities: clock, prng (S02)
  core/          pure domain logic: fsm, triage, priority, coverage, recommender, ics-board, accountability, mutual-aid, event-log, incident-manager, after-action, unit-registry
  adapters/      external boundary wrappers: road-graph-routing, avl, call-intake
  fixtures/      static deterministic data: road-graph, seed-scenario, adversarial-*
test/
  lib/           unit tests for utilities
  core/          unit tests for each core module
  adapters/      tests for adapter contracts
  adversarial/   dedicated tests for adversarial fixtures
  integration/   seed-scenario end-to-end
  golden/        committed golden-master output files
```

**Naming conventions**
- Files: `kebab-case.ts`
- Types/interfaces: `PascalCase`
- Functions: `camelCase`; factory functions start with `create`
- Adapters: suffix `Adapter`; fixtures suffix `Adapter` + live sibling suffix `LiveAdapter`
- Knowledge-debt: inline `// KNOWLEDGE-DEBT: <tag> — <explanation>`

**How to write a test in this stack (snippet)**
```ts
// test/core/unit-fsm.test.ts
import { describe, it, expect } from "vitest";
import { transition } from "../../src/core/unit-fsm.js";

describe("unit-fsm", () => {
  it("allows available → dispatched", () => {
    const r = transition("available", "dispatched");
    expect(r.ok).toBe(true);
  });
  it("rejects available → on_scene", () => {
    const r = transition("available", "on_scene");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.legalTransitions).toContain("dispatched");
    }
  });
});
```

**Keeping tests deterministic**
- Inject clock: `const clock = createClock(0); clock.advance(5000);` — never `Date.now()`.
- Inject PRNG: `const rng = createPrng(42);` — never `Math.random()`.
- Import only from `src/fixtures/` or `src/adapters/` inside tests — never HTTP.

**Wiring a fixture adapter**
```ts
// create the fixture routing adapter
import { SEED_ROAD_GRAPH } from "../../src/fixtures/seed-scenario.js";
import { createRoadGraphRoutingAdapter } from "../../src/adapters/road-graph-routing.js";
const routing = createRoadGraphRoutingAdapter(SEED_ROAD_GRAPH);
```

**Definition of done for any card**
- All files listed in the card exist.
- `npm test` green (no existing test broken).
- TypeScript compiles with `strict:true` and no `any` types (except where a `// KNOWLEDGE-DEBT: any` comment explains why).
- Every acceptance assertion from the card passes.
- No `Date.now()`, `Math.random()`, or HTTP in the changed files.

---

### 5. Common pitfalls for a weak model on THIS project

**Pitfall 1 — Mutating caller claims instead of appending**
A 3B model will instinctively overwrite a field when "new information arrives." This violates the core invariant. The fix is structural: the `CallerClaimStore` has no `update` method, only `add` and `supersede`. The `supersede` method sets `supersededById` on the old claim but never removes it from `all()`. Write the test for `S06` first; it proves non-mutation before any other code touches claims.

**Pitfall 2 — Using `Date.now()` in event-log timestamps**
The model will write `clockMs: Date.now()` because that is the obvious thing. This breaks determinism and makes golden masters non-reproducible. The fix: `EventLog` accepts a `Clock` in its constructor; the clock's `now()` is called at `append` time. Never pass a `Clock` as an optional parameter that defaults to `Date.now()`.

**Pitfall 3 — Implementing the FSM as an `if-else` chain without the adjacency map**
A 3B model often writes `if (current==="available" && next==="dispatched") return ok` for a few cases and forgets others. The adjacency map in `S05` is the complete truth; the `transition` function is just a map lookup. Write one test assertion per edge in `EDGES`; if the map is wrong, those tests fail immediately.

**Pitfall 4 — Conflating triage boundary conditions**
RR=30 in START is NOT `> 30`, so it does NOT trigger IMMEDIATE — the model will often write `>=`. The acceptance tests in `S08` pin the exact boundary (`RR=30 → DELAYED` for an otherwise-stable adult). Do not write "about 30" — use the exact numeric literal in the test.

**Pitfall 5 — Forgetting `dependsOn` edges**
A 3B model will implement `S17` (incident manager) before `S04` (event log) is done because it looks like an independent entity. Without the explicit `dependsOn: S04, S06, S07` in the card, it will try to build state into a mutable object instead of folding over the log. Always implement cards in their dependency order; the card IDs enforce this.

**Pitfall 6 — Making the coverage model round-trip through the network**
The model may try to call a live map API or use haversine distance. `S09` establishes the road-graph fixture adapter as the only source of spatial truth. The `computeCoverageDelta` function uses only `graph` and `avl` — no HTTP, no haversine. If the model reaches for a geo library, redirect it to the fixture graph.

**Pitfall 7 — Reporting `EXPECTANT` without a resource-relative check**
START does not produce `EXPECTANT`; only SALT does, and it requires knowing current resource availability. If the model inserts `EXPECTANT` into `triageSTART`, the `S08` acceptance tests will fail. `EXPECTANT` is only produced by `triageSALTSort` when `ageGroupAdult` is irrelevant and the patient's survival probability given *current resources* is low — which requires an additional `resourcesAvailable:boolean` parameter. The base triage functions (`triageSTART`, `triageJumpSTART`) never return `EXPECTANT`.

**Pitfall 8 — Snapshot/restore not tested before golden-master cards**
If `S04`'s snapshot/restore is untested, `S18` and `S21`'s golden master tests will silently pass on the first run (they regenerate) and fail on the second (the restored log has different seq numbers). Test snapshot/restore in `S04` before building anything that depends on log replay.
