# 15 - Airport Operations and Turnaround Control Center

Complexity tier: 15/20
Expected decomposition size: 40-44 dependent implementation cards before coding.
Domain pressure: airport operations, flight schedules, gate assignment, turnaround milestones, ground handling, baggage, disruption management.
Acceptance command: npm test

## How to use this challenge
This is a dev-test project specification for evaluating whether an autonomous coding agent can decompose a real domain, identify knowledge gaps, build a correct foundation, and verify it with deterministic tests. The goal is not to finish the entire product. The goal is to build a durable foundation that proves the agent understood the domain boundaries and can implement the highest-risk core behaviors without hiding behind placeholders.

The agent must read this entire specification before planning. It must create a dependency-linked plan, record domain knowledge debt, and choose a narrow release slice that still exercises the real hard parts. Prefer fewer production-quality vertical slices over many shallow labels.

## Product vision
Build an airport operations platform for a regional airport that coordinates gates, stands, baggage belts, ground crews, aircraft turnaround, disruptions, and passenger-impact decisions. It should behave like a real operations control tool with time-critical cascading constraints.

## Foundation release scope
The first serious buildout must include:
- Flight, aircraft, airline, gate, stand, belt, crew, equipment, turnaround task, passenger connection, delay code, NOTAM-like notice, and disruption models.
- Gate and stand assignment engine with aircraft size, domestic/international status, tow requirements, connection banks, maintenance holds, and gate conflicts.
- Turnaround milestone tracker for blocks-on, chocks, bridge, deplaning, cleaning, catering, fueling, boarding, baggage, pushback, and doors closed.
- Baggage belt planner with arrival waves, belt capacity, transfer bags, oversize handling, and failed equipment.
- Ground-crew rostering and equipment allocation for pushback tugs, belt loaders, fuel trucks, cleaners, and deicing trucks.
- Disruption manager for late inbound aircraft, weather ground stop, gate closure, equipment failure, and crew shortage.
- Passenger impact estimator for missed connections, gate changes, bus transfers, and minimum connection times.
- Seed day-of-operations scenario with snow delay, gate outage, missed inbound, belt failure, and competing recovery strategies.

## Architecture requirements
- Separate schedule truth, resource allocation, milestone events, disruption reasoning, and passenger impact projection.
- Use constraint evaluation with explainable reasons rather than opaque assignment magic.
- Model time windows, dependencies, and resource capacities explicitly.
- Make recovery plans comparable by delay minutes, passenger impact, crew/equipment feasibility, and rule violations.

## Domain knowledge debt to surface
The agent should not pretend to know every regulation, standard, or numerical model perfectly. It should implement a defensible deterministic subset, mark assumptions explicitly, and create extension points where real-world integrations or expert-reviewed rule packs would live. Required knowledge areas:
- Airport operations are cascading resource constraints under uncertainty.
- Turnaround cannot be represented as one flight status field.
- Gate assignment must consider aircraft, passengers, security boundaries, equipment, and future schedule.
- Recovery choices have different operational and passenger costs.

## Decomposition pressure
This project should force decomposition across domain modeling, calculation or policy engines, workflow state, deterministic fixtures, auditability, and UI/view-model boundaries. The plan should include dependency links so shared primitives and invariants are built before dependent workflow features. Avoid starting with screens. Start with the domain model, invariants, and tests that would make later screens trustworthy.

The agent should maintain a visible knowledge-debt list covering unclear standards, units, legal or safety constraints, numerical assumptions, terminology, fixture limitations, and future expert-review checkpoints. Knowledge debt is not a failure; hiding it is.

## Acceptance criteria
- Gate assignment tests catch size, security, overlap, closure, tow, and connection conflicts.
- Turnaround milestone tests compute critical path and propagated delay.
- Baggage and crew planners respect capacity and equipment outages.
- Recovery plan ranking is deterministic and explainable for the seed day.
- The project passes npm test without external flight feeds.

## Explicit non-goals
- Do not build only a timetable display.
- Do not use live airport data.
- Do not ignore downstream conflicts when resolving one delayed flight.

## Quality bar
- Use typed domain objects and pure core modules wherever practical.
- Keep deterministic fixtures in the repository and do not depend on live APIs for acceptance tests.
- Test edge cases before building broad UI coverage.
- Every risk score, recommendation, workflow transition, or generated report must be explainable from source facts.
- Stubs are acceptable only at external integration boundaries and must be named as adapters with deterministic fixture implementations.
- The foundation should be extensible into a real product if later teams add integrations, expert-reviewed rule packs, and production UI.


---

# Extended scope & deep-reasoning extensions (v2)

> Added 2026-06-26 via deep domain research. **The single defining property of this project is *coupled resource scheduling under cascading delay*:** an airport is a web of shared, capacity-limited resources (gates, stands, belts, tugs, crews, de-icing pads, ATFM slots) where every turnaround is a critical-path network and a single late inbound propagates through *gates it would have used, connections it would have made, and slots it would have hit* — so the system's worth is judged by whether it surfaces the **downstream conflicts** of any decision, not just the local fix. The right model is a constraint-and-milestone engine over a virtual clock, never a per-flight status field.

This section raises the base spec to master-grade by grounding it in the real airport-ops stack (EUROCONTROL/IATA **A-CDM** with the 16 milestones + TOBT/TSAT/CTOT, the IATA **AHM/IGOM** turnaround, gate/stand assignment as a quadratic-assignment problem, FAA/TC **de-icing holdover times**, and ATFM **slot-tolerance windows**) and naming the hard seams, the determinism strategy, the adversarial fixtures, and the invariant tests. The acceptance command stays `npm test`; nothing here may touch a live flight feed, A-CDM platform, or ATC system.

## V0. Research-grounded domain authenticity (what an APOC duty manager / A-CDM coordinator will check for)

- **A-CDM and the 16-milestone approach (the operational spine).** Airport Collaborative Decision Making models a flight as **16 milestones in three phases** — *approach* (M1–6: ATC flight-plan activation, **EOBT−2 h**, take-off from origin, local radar update, **final approach**, **landed**), *turn-round/rotation* (M7–15: **in-blocks**, **ground-handling started**, boarding-related, **TSAT issued**, **boarding started**, off-block-related) and *take-off* (M16). Sources: https://www.eurocontrol.int/concept/airport-collaborative-decision-making and https://www.airportgurus.com/en/what-is-airport-collaborative-decision-making-a-cdm/ and https://www.icao.int/sites/default/files/WACAF/MeetingDocs/2025/Pre-Validation%20Workshop/Implementation-ACDM%20Generic%20Documents%20-%209%20juin%202025/A-CDM-Milestones-Procedure-Template.pdf — **Implication:** a turnaround is **not one status field** (the base spec's explicit demand); it is a **partially-ordered milestone graph** with predecessors, and operational truth is "which milestones are met, when, and what they unblock."
- **The departure time chain — EOBT → TOBT → TSAT → CTOT → TTOT (the heart of the seam).** **EOBT** = estimated off-block from the flight plan; **TOBT** = *Target Off-Block Time*, when the aircraft operator/handler expects to be ready for pushback (drives pre-departure sequencing); **TSAT** = *Target Start-up Approval Time*, when ATC will approve start-up, computed *from* TOBT/EOBT and the pre-departure sequence; **CTOT** = *Calculated Take-Off Time*, an ATFM slot from the Network Manager when the flight is regulated; **TTOT** = target take-off; **EXOT** = the variable/estimated taxi-out time linking off-block to take-off. Sources: https://www.iata.org/contentassets/5c1a116a6120415f87f3dadfa38859d2/iata-acdm-recommendations-v1.pdf and https://www.eurocontrol.int/sites/default/files/2025-01/eurocontrol-specification-for-acdm.pdf — **Implication:** these times form a **constraint chain with a clear dependency order**: a slipped TOBT re-sequences TSAT; a CTOT bounds TTOT and hence TSAT (= CTOT − EXOT, clamped by readiness). The engine must **recompute the chain** when any input moves and **explain the binding input** ("TSAT held by CTOT, not by readiness").
- **The ATFM slot-tolerance window (a hard, numeric legality gate).** A regulated flight's **CTOT** carries a **slot-tolerance window of [−5 min, +10 min]**: the actual take-off (ATOT) must fall in `[CTOT−5, CTOT+10]` or the slot is missed and must be re-coordinated. Sources: https://ext.eurocontrol.int/lexicon/index.php/Slot_Tolerance_Window and https://www.sesperformance.eu/dataportal/metadata/atfm-slot-adherence/ — **Implication:** slot adherence is a **precise, testable invariant**, and a recovery plan that pushes a regulated flight outside its window is a **modeled rule violation**, comparable in weight to a gate conflict.
- **The turnaround critical path (IATA AHM/IGOM).** Ground handling is a set of **parallel + sequential tasks** between **in-blocks (chocks on)** and **off-block (pushback)**: deplaning → (cabin cleaning ∥ catering ∥ fueling, with safety interlocks) → boarding; in parallel **baggage/cargo offload then load**; then **doors closed → pushback**. The **Minimum (Ground) Turnaround Time** is the **critical path** through this network — not the sum of tasks. Sources: https://www.iata.org/en/publications/manuals/airport-handling-manual/ and https://www.iata.org/en/publications/newsletters/iata-knowledge-hub/improve-efficiency-aircraft-turnaround/ — **Implication:** the turnaround is a **CPM/PERT network per flight**; delay on a critical-path task pushes off-block, delay on a non-critical task consumes float first. Safety interlocks (no boarding during fueling without fire cover; catering/cleaning sequencing) are **hard edges**, not preferences.
- **Gate/stand assignment is genuinely NP-hard.** The stand-assignment problem is a **binary quadratic assignment problem** (a stand's feasibility depends on its neighbors' assignments) with constraints: **aircraft size/wingspan vs stand category** (ICAO Code A–F), **adjacency** (two large aircraft can't occupy adjacent stands; a parked neighbor can block entry/exit), **domestic/international (security boundary / immigration) routing**, **MARS** (multi-aircraft ramp stands), **tow/RON** requirements, **maintenance holds**, and a **buffer/slack time** between consecutive uses of a stand. Real instances are solved by **heuristics**, not exact search. Sources: https://pmc.ncbi.nlm.nih.gov/articles/PMC4258332/ and https://onlinelibrary.wiley.com/doi/10.1155/2020/8880390 — **Implication:** the assignment engine must **detect and explain conflicts** (size, security, overlap-without-buffer, closure, tow, connection-bank) and treat assignment as **constraint satisfaction with explainable rejection**, exactly as the base spec demands — not "opaque assignment magic."
- **De-icing holdover time (a time-decaying safety resource).** **Holdover Time (HOT)** = how long anti-icing fluid stays effective; it **starts at the beginning of the final anti-icing application** and expires when protection is lost. Fluid **Types I/II/III/IV** have different HOT ranges (e.g. Type IV up to ~80 min in the lightest conditions) that shrink with precipitation, wind, and skin temperature; if HOT expires before take-off the aircraft **must be re-treated**. Sources: https://www.faa.gov/other_visit/aviation_industry/airline_operators/airline_safety/deicing/24-25_FAA_Holdover_Tables.pdf and https://skybrary.aero/articles/holdover-time-hot — **Implication:** de-icing couples a **time-decaying clock (HOT)** to the **pad/truck resource** and to the **TSAT/CTOT chain**: treat too early and HOT expires in the queue (re-treat, lose the slot); the snow-day seed scenario is exactly this triple-bind (resource + decay + slot).
- **Minimum Connection Time + passenger impact.** A connection holds only if `arrival_in_block + MCT ≤ departure_off_block`, where **MCT** varies by **domestic/international, terminal change, and bus transfer**; a gate change or late inbound can break banks of connections. **Implication:** the passenger-impact estimator is a **deterministic MCT feasibility + misconnect count** over the connection graph, re-evaluated on every gate/time change — explainable per passenger group.

## V1. The hardest technical seams (named)

1. **The milestone-graph engine with logical time (the spine).** Each flight is a **partially-ordered A-CDM milestone graph**; the airport state is a **fold over timestamped milestone events**. Milestones unblock successors; "ground-handling started" is a *fact with a time*, not a boolean toggled by a screen. This is what makes "turnaround ≠ one status field" structurally true.
2. **The departure-time constraint solver (the defining seam).** A pure recompute of the **EOBT→TOBT→TSAT→CTOT→TTOT** chain (with **EXOT** taxi time and the **[−5,+10] CTOT window**) that, on any input change, re-derives the chain and **names the binding constraint**. A slipped TOBT re-sequences the pre-departure order; a CTOT clamps TSAT to `CTOT − EXOT`. *This is the project's signature module* and the place small models will hand-wave — so it must be exhaustively golden-tested.
3. **The stand/gate assignment engine (CSP with explainable conflicts).** Constraint satisfaction over the QAP: size/category, adjacency, security (domestic/international), MARS, tow/RON, maintenance hold, **buffer/slack between uses**, and connection-bank co-location. It must **detect overlaps, catch every conflict class, and explain the rejection** — heuristic assignment is fine, opaque assignment is not.
4. **The turnaround critical-path computer (CPM/PERT).** Per-flight task network with durations, dependencies, **safety interlocks** (fueling/boarding/catering sequencing), and **float**; computes the **critical path → predicted off-block** and the **propagated delay** when a task slips. The base spec's "compute critical path and propagated delay" is a direct CPM requirement.
5. **The shared-resource allocators with capacity + outage.** **Baggage belts** (arrival waves vs belt capacity, transfer/oversize, **failed equipment**), **ground crews + GSE** (pushback tugs, belt loaders, fuel trucks, cleaners, **de-icing trucks/pads**) as **typed, capacity-limited, schedulable pools** with outages — each allocation can fail and must say why.
6. **The disruption propagation kernel (network effects, the whole point).** A late inbound / weather ground-stop / gate closure / equipment failure / crew shortage perturbs the milestone graph and **cascades** through the **stand it frees or holds, the connections it breaks, and the slots it shifts** — re-running assignment + the time chain + passenger impact. The non-goal "do not ignore downstream conflicts" is the core test.
7. **The recovery-plan ranker (multi-criteria, deterministic).** Candidate recovery actions (swap gates, delay a flight, tow to a remote stand, re-crew, re-sequence de-icing) scored on **total delay-minutes, passenger impact (misconnects), crew/equipment feasibility, and rule violations (incl. slot-window breaches)** — producing a **deterministic, explainable ranking** for the seed day.

## V2. Determinism & testability strategy (acceptance stays `npm test`, no live feeds)

- **Virtual clock everywhere.** No `Date.now()`/`setTimeout` in core. Milestone timing, TOBT/TSAT/CTOT, the **[−5,+10] slot window**, **HOT decay**, belt waves, buffer windows, and MCT all read an **injected clock** tests advance explicitly; the seed day is a **scripted timeline of timestamped milestone/disruption events**.
- **Seeded entropy.** Any modeled variability (taxi-time realization within EXOT tolerance, task-duration jitter inside a stated band, weather intensity steps that shrink HOT) draws from one seeded PRNG so the day-of-ops replays identically.
- **Deterministic fixture adapters, named as adapters:** `FlightScheduleAdapter` (the day's flights + aircraft/airline + EOBT/MCT), `MilestoneFeedAdapter` (scripted A-CDM events), `NetworkManagerAdapter` (CTOT issuance/updates for regulated flights), `WeatherAdapter` (ground-stop + de-icing-condition steps), `ResourceStateAdapter` (gate/stand/belt/GSE/crew availability + outages), `PassengerConnectionAdapter` (itineraries + MCT rules). Each has a live-production sibling but the test path never reaches the network.
- **Event-sourced + snapshot/replay.** Airport state = fold over the milestone/decision log; **snapshot/restore** lets a test kill and rebuild mid-day and assert identical projections. **Recovery-plan rankings, critical-path outputs, and passenger-impact reports are deterministic projections** ⇒ golden masters.
- **Golden masters** for: the seed day-of-ops (snow delay + gate outage + missed inbound + belt failure), each flight's critical path + propagated delay, the stand-conflict explanations, the TOBT/TSAT/CTOT recompute traces, and the ranked recovery plans.

## V3. Adversarial / failure / edge-case fixtures (ship the day-from-hell in the repo)

- **The snow-day triple-bind** (seed-critical): a **de-icing queue** + **HOT decay** + **CTOT windows** interact — treat a flight too early and **HOT expires before the slot** (re-treat ⇒ slip TSAT ⇒ risk **CTOT+10 breach** ⇒ slot re-coordination); the system must surface the bind and rank wait-vs-retreat-vs-reslot.
- **The missed inbound cascade** (seed): a late arriving aircraft is the **tail for an outbound** and **holds a stand the next arrival needs**; resolving the outbound delay must **re-evaluate the stand, the broken connections, and any shifted slot** — never fix the outbound in isolation.
- **The gate-outage reassignment** (seed): a contact gate closes; reassigning its flights must respect **size/security/adjacency/buffer**, and the fixture includes a case where the only free stand is **wrong security class** (domestic flight, international-only stand) → rejected with reason, forcing a bus-transfer passenger-impact tradeoff.
- **The belt-failure wave** (seed): a baggage belt fails during an **arrival bank**; the belt planner must **respect capacity**, reroute to remaining belts, and flag **transfer-bag misconnect risk** when capacity is exceeded.
- **The slot-window edge:** a regulated flight ready at exactly **CTOT−5** vs **CTOT+11** — the first adheres, the second is a **missed slot** requiring re-coordination; both pinned.
- **Adjacency trap:** two **Code-E** aircraft assigned to physically adjacent stands must be **rejected** even though each stand individually fits — the quadratic (neighbor-dependent) constraint the naive model misses.
- **Connection-bank break:** a 20-minute gate change pushes a bank of **tight-MCT international→domestic** connections below MCT; the passenger estimator must **count exactly** the now-infeasible connections and attribute the cause.
- **Crew-shortage interlock:** a fueling-during-boarding request without fire cover, or a turnaround missing a **de-icing truck**, must **block the dependent milestone** rather than silently proceed.

## V4. Rigorous acceptance criteria, incl. property-based / invariant tests

Beyond the base spec's example tests, assert **invariants** as property tests over randomized + scripted day-of-ops runs:

1. **Resource exclusivity (no double-booking).** No gate/stand/belt/tug/crew/de-icing pad is ever assigned to two flights in **overlapping windows minus the required buffer**; fuzz random schedules and assert the allocator never produces an overlap, or rejects with the conflicting flight named.
2. **Milestone-order soundness.** A successor milestone is never "met" before its predecessors; the milestone graph is a DAG and the projection only ever holds order-consistent states.
3. **Time-chain consistency.** `TSAT ≥ TOBT`, `TSAT ≤ CTOT − EXOT` for regulated flights (or the binding constraint is reported), and a recompute is **deterministic** and **names the binding input** on every input change.
4. **Slot-window adherence.** Any plan the system endorses keeps every **regulated** flight's projected take-off within `[CTOT−5, CTOT+10]`, or flags a **slot violation** with the overshoot — no silent breaches.
5. **Critical-path correctness & delay conservation.** Predicted off-block equals the **critical-path length** of the turnaround network; a slip on a critical task propagates **minute-for-minute** to off-block, a slip within float of a non-critical task does **not** (until float is exhausted) — property-tested against random task networks.
6. **HOT safety ratchet.** No flight is endorsed for take-off with an **expired HOT**; advancing the clock past HOT always forces a **re-treat** requirement, never a silent "still protected."
7. **Conflict-detection completeness.** Every injected conflict (size, security, adjacency, overlap-without-buffer, closure, tow, connection) is caught and **explained**; no accepted-but-conflicting assignment, no rejection without a reason.
8. **Recovery-ranking determinism & explainability.** The seed-day recovery ranking is **byte-identical** across two runs from the same seed, every ranked plan carries its (delay-min, pax-impact, feasibility, rule-violations) breakdown, and the structured record alone (prose redacted) answers a fixed battery of "why this plan / what did it cost" queries.

## V5. Concrete first vertical slice (the on-ramp — build THIS first, ~40–44 cards)

Do not start with a timetable display. Prove the spine on one fully-worked turnaround + one disruption:

1. **Typed domain model + event log + virtual clock + seeded entropy + snapshot/restore** (the kernel).
2. **The A-CDM milestone-graph engine** (partial order, predecessors, timestamped events) — turnaround as a graph, not a field.
3. **The departure-time constraint solver** (EOBT→TOBT→TSAT→CTOT→TTOT with EXOT + the [−5,+10] window), pure and golden-tested with the binding-constraint explanation — *this single seam de-risks the project's signature.*
4. **The turnaround critical-path computer** (CPM with safety interlocks + float) → predicted off-block + propagated delay.
5. **The stand/gate assignment engine** as CSP with **complete, explainable conflict detection** (size/security/adjacency/buffer/tow/closure/connection).
6. **The shared-resource allocators** (belt + crew/GSE + de-icing) with capacity + outage, including the **HOT decay clock** on de-icing.
7. **The disruption propagation kernel** wiring it together: a perturbation re-runs assignment + time chain + passenger MCT impact and surfaces **downstream conflicts**.
8. **The seed day-of-ops end-to-end** — snow delay + gate outage + missed inbound + belt failure — with **golden critical-path + recovery-ranking outputs** and **the snow-day triple-bind + missed-inbound-cascade adversarial fixtures** surviving.

If that slice is real, the full baggage/oversize handling, crew-rostering breadth, NOTAM-like notices, and operator UI are breadth on a proven, explainable spine.

## V6. Domain knowledge-debt to track (surface, do not bluff)

- **MCT, minimum ground times, and taxi (EXOT) values are airport/airline-specific** and confidential operational data → mark `numerical-assumption + expert-review (airport ops)`; the fixture values are illustrative and must be data-replaceable.
- **A-CDM milestone definitions + DPI messaging** vary by implementation (Frankfurt/Schiphol/Munich differ in local procedure); the EUROCONTROL spec is the reference but local rules bind → `standards-currency`; treat the 16 milestones as a configurable template.
- **De-icing HOT tables are seasonal, regulator-issued (FAA/Transport Canada/EASA), and fluid-brand-specific**, "for departure planning only" with a mandatory pre-take-off check → the HOT model is a **defensible approximation**, explicitly *not* an airworthiness authority → `safety/expert-review`.
- **Stand-assignment optimality is NP-hard**; the engine is a **heuristic + constraint checker**, not a proven optimum → `numerical-assumption`; document that conflict-*correctness* is guaranteed but assignment-*optimality* is not.
- **Slot/ATFM rules** (CTOT issuance, the [−5,+10] window, slot swaps, ground delay programs) are EUROCONTROL/region-specific and evolve → make the slot rules a **versioned rule pack**.
- **Fixture limits:** the resource pools, durations, and weather steps are **deterministic approximations**, not a real airport simulation → state assumptions explicitly and keep every feed behind a swappable adapter.

## V7. Why this is a great !Klein challenge

It is the purest "cascading constraints under uncertainty" domain in the set, and it punishes the two things small-local-LLM swarms do worst: collapsing a rich process into a single status field, and fixing one delay while ignoring its downstream blast radius. The spec *forces* the disciplined decomposition — a **milestone-graph spine** + a **time-chain constraint solver** + a **CSP assignment engine with explainable conflicts** + a **CPM critical-path computer** + a **disruption-propagation kernel** — where correctness is *checkable* (no double-booking; milestone DAG order; slot-window adherence; delay conservation; HOT ratchet; conflict completeness) rather than asserted. The hard parts are legible and dependency-ordered (kernel → milestones → time chain → critical path → assignment → resources → propagation → seed day), the invariants are property-testable, and "every recovery plan comparable and explainable by delay-minutes, passenger impact, feasibility, and rule violations" turns governance into enforced structure — the same north star as exemplar 36, sized to a 40–44-card foundation.

---

## Small-model build guide (3B-ready)

> This section is written for a ~3B parameter local model following !Klein's `decompose_project` workflow. Every term is defined, every card is spelled out step-by-step, and every acceptance check is a deterministic assertion that can run offline with `npm test`. The 3B should **follow**, not figure out.

---

### 1. Glossary & ground rules

**Domain terms**

| Term | Plain meaning |
|------|---------------|
| A-CDM | Airport Collaborative Decision Making — the 16-milestone operational framework |
| EOBT | Estimated Off-Block Time — scheduled departure from stand, from the flight plan |
| TOBT | Target Off-Block Time — when the handler/operator expects the aircraft to be ready for pushback |
| TSAT | Target Start-up Approval Time — when ATC will approve engine start (computed from TOBT) |
| CTOT | Calculated Take-Off Time — an ATFM slot issued by the Network Manager |
| TTOT | Target Take-Off Time — projected actual take-off (TSAT + EXOT) |
| EXOT | Estimated Taxi-Out Time — duration from off-block to take-off in minutes |
| Slot-tolerance window | CTOT±: take-off must occur in `[CTOT−5 min, CTOT+10 min]` |
| In-blocks | Aircraft arrives at stand, engines off, chocks on — milestone M7 |
| Off-block | Aircraft begins pushback — the output of the turnaround process |
| Minimum turnaround time | Critical-path length of the turnaround task network |
| Float | Slack time: a non-critical-path task can slip by this many minutes without delaying off-block |
| CPM | Critical Path Method — algorithm that identifies the longest dependency chain |
| HOT | Holdover Time — duration an anti-icing fluid remains effective after application |
| MCT | Minimum Connection Time — minimum minutes between an arrival in-blocks and a departure off-block for a connection to be feasible |
| ICAO Code | Aircraft size category A–F (A=smallest, F=largest A380-class); governs stand compatibility |
| Stand buffer | Minimum minutes between consecutive aircraft at the same stand (typically 10–15 min) |
| MARS | Multi-Aircraft Ramp Stand — one large stand accommodating two smaller aircraft |
| Connection bank | A set of inbound flights timed to allow onward connections on a wave of outbound flights |
| Disruption cascade | One delay spreading to gates, connections, and slots it touches |
| Event log / virtual clock | Append-only log + injected clock; never `Date.now()` in tests |
| Golden master | Committed expected-output file; test asserts byte-equality against it |
| Knowledge-debt comment | `// KNOWLEDGE-DEBT: <tag> — <explanation>` |

**Stack**

- Language: **TypeScript**
- Runtime: **Node.js**
- Test runner: **Vitest** (`npm test` runs `vitest run`)
- No external HTTP calls anywhere in `src/` or `test/`
- All random values drawn from a seeded PRNG (`src/lib/prng.ts`)

**Acceptance command (plain steps)**

1. `npm test` — runs `vitest run`
2. Every test must pass; any `FAIL` is a blocker
3. No network calls; no `Date.now()`; no `Math.random()` in core
4. Golden-master files in `test/golden/`; regenerate with `REGEN_GOLDEN=1 npm test`, then commit

**Determinism rules (imperative)**

- Never call the network; use fixture adapters in `src/adapters/`
- Never call `Date.now()`; accept a `Clock` parameter
- Never call `Math.random()`; use `createPrng(seed)`
- The slot-tolerance window `[CTOT−5, CTOT+10]` is a configurable rule pack constant, not a hardcoded magic number
- HOT values are a fixture table (fluid type × precipitation intensity); never hardcode a duration

---

### 2. The explicit task graph for the first vertical slice

The first slice maps to V5 of this spec (items 1–8). It has **24 cards** (`S01`–`S24`).

---

**`S01` — TypeScript project scaffold**
dependsOn: none
files: `package.json`, `tsconfig.json`, `vitest.config.ts`

interface: standard scaffold (`"type":"module"`, `vitest`, `"test":"vitest run"`, `strict:true`).

acceptance: `npm test` exits 0.

---

**`S02` — Virtual clock + seeded PRNG**
dependsOn: `S01`
files: `src/lib/clock.ts`, `src/lib/prng.ts`, `test/lib/clock.test.ts`, `test/lib/prng.test.ts`

interface:
```ts
export interface Clock { now(): number; advance(ms: number): void; }
export function createClock(startMs?: number): Clock;
export function createPrng(seed: number): () => number;  // mulberry32; float in [0,1)
```

acceptance: clock advances correctly; same seed → same PRNG sequence.

---

**`S03` — Core domain types**
dependsOn: `S01`
files: `src/types/domain.ts`, `test/types/domain.test.ts`

interface:
```ts
// src/types/domain.ts
export type FlightId    = string;
export type StandId     = string;
export type BeltId      = string;
export type CrewId      = string;
export type EquipmentId = string;

export type IcaoCode = "A" | "B" | "C" | "D" | "E" | "F";
export type SecurityBoundary = "domestic" | "international" | "mixed";

export type MilestoneId =
  | "M1_FLIGHT_PLAN_ACTIVATED"   | "M2_EOBT_MINUS_2H"
  | "M3_TAKEOFF_ORIGIN"          | "M4_RADAR_UPDATE"
  | "M5_FINAL_APPROACH"          | "M6_LANDED"
  | "M7_IN_BLOCKS"               | "M8_GROUND_HANDLING_STARTED"
  | "M9_BOARDING_RELATED"        | "M10_TSAT_ISSUED"
  | "M11_BOARDING_STARTED"       | "M12_OFF_BLOCK_RELATED"
  | "M13_TOBT_CONFIRMED"         | "M14_PUSHBACK_STARTED"
  | "M15_AIRBORNE"               | "M16_TAKEOFF";

export type ConflictReason =
  | "SIZE_MISMATCH"
  | "SECURITY_BOUNDARY"
  | "ADJACENCY_CONFLICT"
  | "OVERLAP_WITHOUT_BUFFER"
  | "STAND_CLOSED"
  | "TOW_REQUIRED_UNAVAILABLE"
  | "CONNECTION_BANK_MISMATCH";

export interface MilestoneEvent {
  milestoneId: MilestoneId;
  flightId: FlightId;
  actualTimeMs: number;     // clockMs when the milestone was met
}

export interface StandConflictResult {
  ok: boolean;
  conflicts: Array<{ reason: ConflictReason; detail: string }>;
}
```

acceptance: TypeScript compiles; trivial import test passes.

---

**`S04` — Event log + snapshot/restore**
dependsOn: `S02`, `S03`
files: `src/core/event-log.ts`, `test/core/event-log.test.ts`

interface:
```ts
export interface AirportEvent { seq: number; type: string; payload: unknown; clockMs: number; }
export interface EventLog {
  append(type: string, payload: unknown): AirportEvent;
  all(): readonly AirportEvent[];
  snapshot(): readonly AirportEvent[];
  restore(events: readonly AirportEvent[]): void;
}
export function createEventLog(clock: Clock): EventLog;
```

acceptance: ascending seq; snapshot/restore round-trips identically (same as project-05 `S04`).

---

**`S05` — A-CDM milestone-graph engine**
dependsOn: `S03`, `S04`
files: `src/core/milestone-graph.ts`, `test/core/milestone-graph.test.ts`

interface:
```ts
// src/core/milestone-graph.ts
export interface MilestoneNode {
  id: MilestoneId;
  predecessorIds: MilestoneId[];   // must all be met before this milestone can be met
}

// The standard 16-milestone DAG — export it as a constant.
export const ACDM_MILESTONE_DAG: MilestoneNode[];

export interface MilestoneTracker {
  meet(milestoneId: MilestoneId, flightId: FlightId, clock: Clock): MilestoneEvent;
  // Throws if any predecessor is not yet met.
  isMet(milestoneId: MilestoneId, flightId: FlightId): boolean;
  met(flightId: FlightId): MilestoneEvent[];      // all met milestones for this flight, sorted by actualTimeMs
  unmet(flightId: FlightId): MilestoneId[];        // unmet milestones remaining
  predecessorsOf(milestoneId: MilestoneId): MilestoneId[];
}

export function createMilestoneTracker(log: EventLog): MilestoneTracker;
```

how to implement the ACDM_MILESTONE_DAG:
```
M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8 → M9/M10/M11 → M12 → M13 → M14 → M15 → M16
```
Simplify: M7 (in-blocks) must precede M8; M8 precedes M9, M10, M11 (parallel); M9, M10, M11 all precede M12; M12 precedes M13; M13 precedes M14 (pushback).

how to implement:
1. `meet`: check predecessors via `isMet`; if any unmet, throw `"Predecessor ${pred} not met for milestone ${milestoneId}"`.
2. Append `MILESTONE_MET` event to log; store in internal map keyed by `(flightId, milestoneId)`.
3. `met` / `unmet`: scan the map.

acceptance (`test/core/milestone-graph.test.ts`):
- Meeting M8 before M7 throws.
- Meeting M7 then M8 succeeds.
- `met()` returns events in time order.
- `unmet()` decreases as milestones are met.
- Snapshot/restore: rebuild tracker from log → same `isMet` results.

---

**`S06` — Departure-time constraint solver (EOBT→TOBT→TSAT→CTOT→TTOT)**
dependsOn: `S03`, `S02`
files: `src/core/departure-time-chain.ts`, `test/core/departure-time-chain.test.ts`

interface:
```ts
// src/core/departure-time-chain.ts
export interface DepartureTimeInputs {
  eobtMs: number;
  tobtMs: number;              // handler's readiness time; overrides EOBT when set
  ctotMs?: number;             // ATFM slot, or undefined if not regulated
  exotMs: number;              // estimated taxi-out duration
  readinessMs: number;         // when the aircraft is physically ready for pushback
}

export interface SlotToleranceWindow {
  minMs: number;   // CTOT − 5 min
  maxMs: number;   // CTOT + 10 min
}

export interface DepartureTimeResult {
  tsatMs: number;
  ttotMs: number;
  slotWindow?: SlotToleranceWindow;
  bindingConstraint: "TOBT" | "CTOT" | "READINESS";
  explanation: string;   // e.g. "TSAT held by CTOT: CTOT=..., EXOT=..., TSAT=CTOT-EXOT"
  slotViolation?: { type: "MISSED"; overshootMs: number };
}

export function computeDepartureTimeChain(inputs: DepartureTimeInputs): DepartureTimeResult;
```

how to implement:
1. `tsatFromTobt = tobtMs`.
2. If `ctotMs` given: `tsatFromCtot = ctotMs - exotMs`; `tsatMs = max(tsatFromTobt, tsatFromCtot)`.
3. If no `ctotMs`: `tsatMs = max(tobtMs, readinessMs)`.
4. `ttotMs = tsatMs + exotMs`.
5. `bindingConstraint`: if `ctotMs` was the binding input (i.e. `tsatFromCtot > tsatFromTobt`) → `"CTOT"`, else if `readinessMs > tobtMs` → `"READINESS"`, else → `"TOBT"`.
6. `slotWindow`: `{ minMs: ctotMs-5*60000, maxMs: ctotMs+10*60000 }` if regulated.
7. `slotViolation`: if `ttotMs > slotWindow.maxMs` → `{ type:"MISSED", overshootMs: ttotMs - slotWindow.maxMs }`.

acceptance (`test/core/departure-time-chain.test.ts`) — pin every case:
- TOBT is binding (no CTOT, readiness before TOBT): `bindingConstraint="TOBT"`, `tsatMs=tobtMs`.
- CTOT is binding (ctot−exot > tobt): `bindingConstraint="CTOT"`, `tsatMs=ctotMs-exotMs`.
- Readiness is binding (aircraft not ready until after TOBT): `bindingConstraint="READINESS"`.
- `ttotMs = CTOT + 11 min` → `slotViolation.type="MISSED"` with correct overshoot.
- `ttotMs = CTOT + 10 min` → no violation (exactly at boundary).
- `ttotMs = CTOT − 5 min` → no violation (exactly at lower bound).
- `ttotMs = CTOT − 6 min` → `slotViolation` (before the window).
- `explanation` is a non-empty string on every result.

---

**`S07` — Turnaround CPM (critical-path computer)**
dependsOn: `S03`, `S02`
files: `src/core/turnaround-cpm.ts`, `test/core/turnaround-cpm.test.ts`

interface:
```ts
// src/core/turnaround-cpm.ts
export interface TurnaroundTask {
  id: string;
  label: string;
  durationMs: number;
  predecessorIds: string[];   // must complete before this task starts
  isSafetyInterlock?: boolean; // if true, cannot be overridden
}

// Standard turnaround task network (export as a factory — durations are parameters):
export function buildStandardTurnaroundNetwork(params: {
  deplaningMs: number;
  cleaningMs: number;
  cateringMs: number;
  fuelingMs: number;
  boardingMs: number;
  baggageOffloadMs: number;
  baggageLoadMs: number;
  doorsClosedMs: number;
}): TurnaroundTask[];
// Must encode: deplaning → (cleaning ∥ catering ∥ fueling) → boarding → doors-closed
// And: baggageOffload → baggageLoad → doors-closed
// Safety interlock: fueling must complete before boarding starts.

export interface CpmResult {
  criticalPath: string[];    // task ids on the critical path, in execution order
  criticalPathMs: number;    // total duration = minimum turnaround time
  taskEarliestStart: Map<string, number>;  // ms from in-blocks
  taskFloat: Map<string, number>;          // ms of slack for non-critical tasks
  predictedOffBlockMs: number;             // inBlocksMs + criticalPathMs
}

export function computeCriticalPath(inBlocksMs: number, tasks: TurnaroundTask[]): CpmResult;
```

how to implement:
1. Standard CPM forward pass: for each task in topological order, `earliestStart = max(predecessors' earliestFinish)`.
2. Backward pass: for each task in reverse, `latestStart = min(successors' latestStart) − duration`.
3. `float = latestStart − earliestStart`.
4. Critical path: tasks where `float === 0`.
5. Safety interlock: if `fueling.predecessorIds` contains `boarding` or vice versa, treat it as a hard edge — do not allow parallel execution.

acceptance (`test/core/turnaround-cpm.test.ts`):
- Standard network with deplaning=15, cleaning=20, catering=25 (critical), fueling=30 (critical), boarding=20, baggageOffload=20, baggageLoad=15, doorsClosed=5:
  - Critical path includes fueling (30 min is the longest parallel branch).
  - Cleaning (20 min) has float of 10 min vs fueling (30 min) — assert `taskFloat.get("cleaning") === 10*60000`.
- Slipping a critical task by 5 min: `predictedOffBlockMs` increases by 5 min.
- Slipping a non-critical task within its float: `predictedOffBlockMs` unchanged.
- Safety interlock: if boarding starts before fueling completes, the CPM still enforces the dependency (boarding's earliestStart ≥ fueling's earliestFinish).

---

**`S08` — Stand/gate assignment engine (CSP with conflict detection)**
dependsOn: `S03`, `S04`
files: `src/core/stand-assignment.ts`, `test/core/stand-assignment.test.ts`

interface:
```ts
// src/core/stand-assignment.ts
export interface Stand {
  id: StandId;
  icaoCode: IcaoCode;               // maximum aircraft category this stand accepts
  securityBoundary: SecurityBoundary;
  adjacentStandIds: StandId[];      // physically adjacent; two Code-D+ aircraft can't both be used
  closed: boolean;
  requiresTow: boolean;
  connectionBankIds: string[];       // which connection banks this stand serves
}

export interface FlightRequirement {
  flightId: FlightId;
  aircraftIcaoCode: IcaoCode;
  securityBoundary: SecurityBoundary;
  occupancyStartMs: number;
  occupancyEndMs: number;
  connectionBankId?: string;
}

export interface StandAssignment {
  flightId: FlightId;
  standId: StandId;
  result: StandConflictResult;
}

export interface StandAssignmentEngine {
  assign(stand: Stand, req: FlightRequirement): StandAssignment;
  // Does NOT mutate the stand — returns the conflict result; caller manages actual assignment.
  detectConflict(stand: Stand, req: FlightRequirement, existingAssignments: StandAssignment[]): StandConflictResult;
  // Checks: size, security, adjacency, overlap (with buffer), closure, tow, connection-bank.
}

export function createStandAssignmentEngine(bufferMs?: number): StandAssignmentEngine;
// bufferMs defaults to 15*60*1000 (15 minutes).
```

how to implement `detectConflict` (check each independently, collect all):
1. **Size**: `ICAO_RANK[req.aircraftIcaoCode] > ICAO_RANK[stand.icaoCode]` → `SIZE_MISMATCH`. (rank: A=1, B=2, C=3, D=4, E=5, F=6)
2. **Security**: `req.securityBoundary !== stand.securityBoundary && stand.securityBoundary !== "mixed"` → `SECURITY_BOUNDARY`.
3. **Closed**: `stand.closed` → `STAND_CLOSED`.
4. **Tow**: `stand.requiresTow && towEquipmentUnavailable` → `TOW_REQUIRED_UNAVAILABLE` (caller passes availability).
5. **Overlap**: check `existingAssignments` for the same stand; `req.occupancyStart < prev.occupancyEnd + bufferMs && req.occupancyEnd > prev.occupancyStart` → `OVERLAP_WITHOUT_BUFFER`.
6. **Adjacency**: for each adjacent stand, if another flight occupies it and both are Code-D or above → `ADJACENCY_CONFLICT`.
7. **Connection bank**: if `req.connectionBankId` set and `stand.connectionBankIds` doesn't include it → `CONNECTION_BANK_MISMATCH`.

acceptance (`test/core/stand-assignment.test.ts`):
- Correct stand, no conflicts → `{ ok:true }`.
- Aircraft Code-E on a Code-C stand → `SIZE_MISMATCH`.
- International flight on domestic stand → `SECURITY_BOUNDARY`.
- Two Code-E aircraft on adjacent stands → `ADJACENCY_CONFLICT` for the second.
- Overlap within buffer → `OVERLAP_WITHOUT_BUFFER`.
- Stand closed → `STAND_CLOSED`.
- All conflicts detected simultaneously (size+security) → both violations in result.

---

**`S09` — Resource allocators (belts + GSE + de-icing)**
dependsOn: `S03`, `S04`, `S02`
files: `src/core/resource-allocator.ts`, `test/core/resource-allocator.test.ts`

interface:
```ts
// src/core/resource-allocator.ts
export interface Resource {
  id: string;
  type: "BELT" | "TUG" | "FUEL_TRUCK" | "DEICING_TRUCK" | "CLEANER" | "BELT_LOADER";
  capacity: number;       // for belts: bags/hour; for others: 1 (single-use)
  available: boolean;
}

export interface AllocationRequest {
  resourceType: Resource["type"];
  flightId: FlightId;
  startMs: number;
  endMs: number;
  requiredCapacity?: number;  // for belts
}

export interface AllocationResult {
  ok: boolean;
  resourceId?: string;
  failReason?: "CAPACITY_EXCEEDED" | "ALL_OCCUPIED" | "EQUIPMENT_OUT";
}

export interface ResourceAllocator {
  markUnavailable(resourceId: string): void;
  allocate(request: AllocationRequest): AllocationResult;
  release(resourceId: string, flightId: FlightId): void;
  available(type: Resource["type"]): Resource[];
}

export function createResourceAllocator(resources: Resource[], log: EventLog): ResourceAllocator;
```

how to implement:
1. `allocate`: find a resource of the right type that is available and not occupied in `[startMs, endMs]`.
2. For belts: also check `capacity >= requiredCapacity`.
3. If none: return the appropriate `failReason`.
4. Log `RESOURCE_ALLOCATED` events.

acceptance (`test/core/resource-allocator.test.ts`):
- Two belt loaders available; allocate one → `ok:true`; allocate second → `ok:true`; allocate third → `ok:false, failReason:"ALL_OCCUPIED"`.
- Mark a belt unavailable → it is never returned by `available()`.
- Belt with capacity 200 bags/hr; request 300 → `CAPACITY_EXCEEDED`.

---

**`S10` — HOT decay clock (de-icing holdover)**
dependsOn: `S02`, `S03`
files: `src/core/hot-decay.ts`, `src/fixtures/hot-table.ts`, `test/core/hot-decay.test.ts`

interface:
```ts
// src/fixtures/hot-table.ts
// HOT = holdover time in minutes for (fluid type × precipitation intensity).
export type FluidType = "I" | "II" | "III" | "IV";
export type PrecipitationIntensity = "NONE" | "LIGHT" | "MODERATE" | "HEAVY";
export const HOT_TABLE: Record<FluidType, Record<PrecipitationIntensity, number>>;
// Example values (fictional for testing; must be configurable):
// IV/NONE=80, IV/LIGHT=45, IV/MODERATE=25, IV/HEAVY=10
// I/NONE=30, I/LIGHT=15, I/MODERATE=8, I/HEAVY=3

// src/core/hot-decay.ts
export interface HotState {
  flightId: FlightId;
  fluidType: FluidType;
  precipIntensity: PrecipitationIntensity;
  treatmentStartMs: number;
  hotMinutes: number;           // from HOT_TABLE
  expiresAtMs: number;          // treatmentStartMs + hotMinutes * 60 * 1000
}

export function computeHot(
  flightId: FlightId,
  fluidType: FluidType,
  precipIntensity: PrecipitationIntensity,
  treatmentStartMs: number
): HotState;

export function isHotExpired(hot: HotState, currentMs: number): boolean;
// Returns true when currentMs >= hot.expiresAtMs.

export function requiresRetreatment(hot: HotState, projectedTakeoffMs: number): boolean;
// Returns true when projectedTakeoffMs > hot.expiresAtMs.
```

how to implement:
1. `computeHot`: look up `HOT_TABLE[fluidType][precipIntensity]`; compute `expiresAtMs`.
2. `isHotExpired`: `currentMs >= hot.expiresAtMs`.
3. `requiresRetreatment`: `projectedTakeoffMs > hot.expiresAtMs`.

acceptance (`test/core/hot-decay.test.ts`):
- Type IV, NONE: expires in 80 minutes from treatment start.
- `isHotExpired` false at `treatmentStart + 79*60000`; true at `treatmentStart + 80*60000`.
- `requiresRetreatment` false when take-off is before expiry; true when after.
- Same inputs always produce the same result (pure function).

---

**`S11` — Passenger MCT + misconnect estimator**
dependsOn: `S03`, `S02`
files: `src/core/passenger-impact.ts`, `test/core/passenger-impact.test.ts`

interface:
```ts
// src/core/passenger-impact.ts
export interface Connection {
  paxGroupId: string;
  paxCount: number;
  inboundFlightId: FlightId;
  outboundFlightId: FlightId;
  mctMinutes: number;   // minimum required — varies by domestic/international/terminal change
}

export interface ConnectionFeasibility {
  paxGroupId: string;
  feasible: boolean;
  availableMinutes: number;
  requiredMinutes: number;
  shortfallMinutes: number;  // 0 if feasible
  cause?: string;            // e.g. "gate change extended transfer time"
}

export interface PaxImpactResult {
  totalMisconnected: number;
  feasibilities: ConnectionFeasibility[];
}

export function estimatePaxImpact(
  connections: Connection[],
  inblocksTimes: Map<FlightId, number>,   // actual in-blocks clockMs per inbound flight
  offblockTimes: Map<FlightId, number>,   // projected off-block clockMs per outbound flight
): PaxImpactResult;
```

how to implement:
1. For each connection: `availableMinutes = (offblockTimes[outbound] - inblocksTimes[inbound]) / 60000`.
2. `feasible = availableMinutes >= mctMinutes`.
3. `shortfallMinutes = max(0, mctMinutes - availableMinutes)`.
4. Sum misconnected pax across infeasible connections.

acceptance (`test/core/passenger-impact.test.ts`):
- Inbound lands 30 min before outbound off-block; MCT = 25 min → feasible.
- Inbound lands 20 min before outbound; MCT = 25 min → `shortfallMinutes = 5`.
- Gate change that adds 10 min to MCT: update the `mctMinutes` for those connections and re-run; formerly-feasible connections may now be infeasible.
- `totalMisconnected` = sum of `paxCount` for infeasible connections.

---

**`S12` — Disruption propagation kernel**
dependsOn: `S03`, `S04`, `S05`, `S06`, `S07`, `S08`, `S09`, `S10`, `S11`
files: `src/core/disruption-kernel.ts`, `test/core/disruption-kernel.test.ts`

interface:
```ts
// src/core/disruption-kernel.ts
export type DisruptionType =
  | "LATE_INBOUND"
  | "WEATHER_GROUND_STOP"
  | "STAND_CLOSURE"
  | "EQUIPMENT_FAILURE"
  | "CREW_SHORTAGE";

export interface Disruption {
  type: DisruptionType;
  flightId?: FlightId;
  standId?: StandId;
  resourceId?: string;
  delayMs?: number;
  effectiveFromMs: number;
}

export interface PropagationResult {
  affectedFlights: Array<{
    flightId: FlightId;
    newTobtMs?: number;
    newCtotMs?: number;
    standReassigned?: boolean;
    connectionsNowMissed: number;
    slotViolation?: { type: "MISSED"; overshootMs: number };
  }>;
  downstreamSummary: string;
}

export function propagateDisruption(
  disruption: Disruption,
  context: {
    milestoneTracker: MilestoneTracker;
    standEngine: StandAssignmentEngine;
    resourceAllocator: ResourceAllocator;
    connections: Connection[];
    schedule: FlightSchedule;   // see S13
    clock: Clock;
    log: EventLog;
  }
): PropagationResult;
```

how to implement:
1. For `LATE_INBOUND`: find the tail flight (the outbound using the same aircraft); compute new TOBT; recompute departure-time chain; check slot window; check connections.
2. For `STAND_CLOSURE`: find flights assigned to that stand; re-run stand assignment for each; detect new conflicts; propagate MCT impacts.
3. For `EQUIPMENT_FAILURE`: mark resource unavailable; find all flights that needed it; flag turnaround blockage.
4. All effects appended to the event log as `DISRUPTION_PROPAGATED` events.

acceptance (`test/core/disruption-kernel.test.ts`):
- Late inbound by 90 min: tail flight TOBT shifts 90 min; departure chain recomputed; `slotViolation` present if new TTOT exceeds CTOT+10.
- Stand closure: affected flights get `standReassigned:true` or a conflict listed.
- Equipment failure of the only de-icing truck: flights needing de-icing have a `"DEICING_TRUCK" ALL_OCCUPIED` failure noted.

---

**`S13` — Flight schedule + seed fixture**
dependsOn: `S03`, `S05`, `S06`, `S07`, `S08`, `S09`, `S10`, `S11`
files: `src/types/schedule.ts`, `src/fixtures/seed-day.ts`

interface:
```ts
// src/types/schedule.ts
export interface ScheduledFlight {
  id: FlightId;
  aircraftIcaoCode: IcaoCode;
  inboundFlightId?: FlightId;    // the tail — this aircraft is arriving as this flight first
  scheduledInBlocksMs: number;
  scheduledOffBlockMs: number;
  securityBoundary: SecurityBoundary;
  connectionBankId?: string;
  regulated: boolean;
  ctotMs?: number;
  eobtMs: number;
}

export interface FlightSchedule {
  flights: ScheduledFlight[];
  stands: Stand[];
  connections: Connection[];
  resources: Resource[];
}

// src/fixtures/seed-day.ts
export const SEED_SCHEDULE: FlightSchedule;
// Must include:
// - 8+ flights with varying sizes and security boundaries
// - at least 2 stands that are adjacent Code-D+
// - 1 regulated flight with a CTOT
// - 1 tail flight (inbound→outbound same aircraft)
// - 1 connection bank with tight MCT connections
// - 1 de-icing truck (only one)
// - 1 snow/de-icing scenario (SEED_SNOW_CONDITION)
export const SEED_SNOW_CONDITION: { precipIntensity: PrecipitationIntensity; groundStopStartMs: number };
export const SEED_DISRUPTIONS: Disruption[];
// At least: LATE_INBOUND (the tail flight), STAND_CLOSURE (the contact gate), EQUIPMENT_FAILURE (the belt)
```

how to implement: design the schedule so each seed disruption triggers a cascade; the gate outage should have the only available adjacent stand be the wrong security class; the late inbound should use the only available stand that the next arrival also needs.

acceptance: file compiles; `SEED_SCHEDULE.flights.length >= 8`; `SEED_DISRUPTIONS.length >= 3`.

---

**`S14` — Recovery-plan ranker**
dependsOn: `S06`, `S07`, `S08`, `S09`, `S11`, `S12`
files: `src/core/recovery-ranker.ts`, `test/core/recovery-ranker.test.ts`

interface:
```ts
// src/core/recovery-ranker.ts
export type RecoveryAction =
  | { type: "SWAP_STAND"; flightId: FlightId; newStandId: StandId }
  | { type: "DELAY_FLIGHT"; flightId: FlightId; delayMs: number }
  | { type: "TOW_TO_REMOTE"; flightId: FlightId; remoteStandId: StandId }
  | { type: "RESEQUENCE_DEICING"; flightIds: FlightId[] };

export interface RecoveryScore {
  totalDelayMinutes: number;
  paxMisconnected: number;
  feasible: boolean;
  ruleViolations: string[];  // e.g. "SLOT_WINDOW_MISSED on flight X"
}

export interface RankedRecoveryPlan {
  action: RecoveryAction;
  score: RecoveryScore;
}

export function rankRecoveryPlans(
  candidates: RecoveryAction[],
  context: {
    schedule: FlightSchedule;
    connections: Connection[];
    currentInBlocks: Map<FlightId, number>;
    clock: Clock;
  }
): RankedRecoveryPlan[];
// Sorted: feasible before infeasible; then by totalDelayMinutes ascending; then paxMisconnected ascending.
```

how to implement:
1. For each candidate action: simulate its effect on the relevant flight(s).
2. Recompute departure-time chain; check slot window; recompute MCT feasibility.
3. Score: `totalDelayMinutes` = sum of TOBT shifts across all affected flights; `paxMisconnected` from MCT; `feasible` = no `ruleViolations`.
4. Sort: feasible first, then by total delay minutes ascending.

acceptance (`test/core/recovery-ranker.test.ts`):
- Two candidates: one feasible/low-delay, one infeasible/low-delay → feasible one ranks first.
- Two feasible candidates: lower total delay wins.
- Rankings are deterministic: same inputs → same order across two calls.
- Every ranked plan has a non-null `score` with all four fields populated.

---

**`S15` — After-action projector + golden master**
dependsOn: `S04`, `S05`, `S06`, `S07`
files: `src/core/airport-projector.ts`, `test/core/airport-projector.test.ts`

interface:
```ts
export interface DayTimelineEntry { seq: number; clockMs: number; eventType: string; summary: string; payload: unknown; }
export function projectDayTimeline(log: EventLog): DayTimelineEntry[];
export function renderDayReport(timeline: DayTimelineEntry[]): string;
```

how to implement: switch over event types; join as text; no `Date.now()`.

acceptance: same log → identical `renderDayReport` string; golden master test.

---

**`S16` — Adversarial: slot-window edge cases**
dependsOn: `S06`
files: `test/adversarial/slot-window.test.ts`

how to implement the test:
1. CTOT=T; EXOT=15 min; readiness=T−30 min; TOBT=T−16 min.
2. `ttotMs = tsatMs + exotMs = (T−15) + 15 = T` → `ttotMs` is exactly at CTOT → within window (CTOT+0). Assert no violation.
3. TOBT shifts so `ttotMs = CTOT + 10 min` → no violation.
4. `ttotMs = CTOT + 11 min` → `slotViolation.type="MISSED"`, `overshootMs = 60000`.
5. `ttotMs = CTOT − 5 min` → no violation.
6. `ttotMs = CTOT − 6 min` → `slotViolation.type="MISSED"`.

acceptance: all 6 assertions pass.

---

**`S17` — Adversarial: snow-day triple-bind**
dependsOn: `S10`, `S06`, `S09`
files: `test/adversarial/snow-day-triple-bind.test.ts`

how to implement the test:
1. Regulated flight with CTOT=T. De-icing truck treats the aircraft at `T − 40 min` with Type IV fluid, LIGHT precipitation → HOT = 45 min → expires at `T + 5 min`.
2. Due to queue delays, TSAT slips to `T − 3 min` → `ttotMs = T − 3 + 15 (EXOT) = T + 12 min`.
3. `T + 12 > T + 10` → slot violation.
4. But `T + 12 > T + 5` (HOT expiry) → HOT also expired. `requiresRetreatment` returns `true`.
5. Re-treating takes 10 min → new TSAT = `T + 7 min` → `ttotMs = T + 22 min` → slot missed further.
6. Assert all three are surfaced: slot violation, HOT expiry, re-treat delays slot further.

acceptance: all three conditions detected without any being silently ignored.

---

**`S18` — Adversarial: missed-inbound cascade**
dependsOn: `S12`, `S13`
files: `test/adversarial/missed-inbound-cascade.test.ts`

how to implement the test:
1. Inbound flight (call it F1) is the tail for outbound flight F2.
2. F1 lands 90 min late; it holds the only stand that F3 (a different flight) also needs.
3. Apply `LATE_INBOUND` disruption for F1.
4. Assert: F2's TOBT shifts by at least 90 min; departure-time chain recomputed; if F2 is regulated, check for slot violation.
5. Assert: stand conflict for F3 (F1 still occupying the stand); F3 needs reassignment.
6. Assert: connections off F1 (tight MCT) are now missed; `paxMisconnected > 0`.
7. Assert: none of these are fixed silently — the propagation result lists all three.

acceptance: all three affected entities (F2, F3, connections) appear in `affectedFlights`.

---

**`S19` — Adversarial: gate-outage wrong-security-class rejection**
dependsOn: `S08`, `S13`
files: `test/adversarial/gate-outage-security.test.ts`

how to implement the test:
1. Close the contact gate serving an international flight.
2. The only free alternative stand is domestic-only.
3. `detectConflict` for the international flight on the domestic stand → `SECURITY_BOUNDARY` violation.
4. Assert the conflict is detected with `reason:"SECURITY_BOUNDARY"` before any assignment.
5. Assert `ok:false`; the assignment is NOT made; a bus-transfer option must be surfaced (just as a string in the result detail — no full UI needed).

acceptance: conflict detected; stand not assigned; reason is explicit.

---

**`S20` — Adversarial: adjacency trap (Code-E neighbor)**
dependsOn: `S08`
files: `test/adversarial/adjacency-trap.test.ts`

how to implement the test:
1. Define two Code-E stands that are adjacent.
2. Assign flight A (Code-E) to stand 1 → `ok:true`.
3. Now attempt to assign flight B (Code-E) to stand 2 (adjacent to stand 1) → `ADJACENCY_CONFLICT`.
4. Assert: stand 2 is valid for Code-E aircraft in isolation (size check passes); the conflict comes **only** from the adjacency check.
5. Assign flight B (Code-B) to stand 2 instead → `ok:true` (Code-B aircraft don't trigger the Code-D+ adjacency rule).

acceptance: adjacency conflict detected for Code-E+Code-E; not detected for Code-E+Code-B.

---

**`S21` — Adversarial: belt-failure wave**
dependsOn: `S09`, `S11`
files: `test/adversarial/belt-failure.test.ts`

how to implement the test:
1. Schedule 4 flights in an arrival bank, all needing the belt.
2. Two belts available; mark one unavailable (equipment failure) mid-bank.
3. After failure: only one belt remains; allocate flights 3 and 4 → one gets `ok:true`, the other `ok:false, failReason:"ALL_OCCUPIED"`.
4. Transfer-bag risk: the flight that lost its belt has connections; `estimatePaxImpact` called with updated times → `totalMisconnected > 0`.

acceptance: capacity limit enforced; misconnect risk attributed to belt failure.

---

**`S22` — Adversarial: connection-bank break**
dependsOn: `S11`, `S13`
files: `test/adversarial/connection-bank-break.test.ts`

how to implement the test:
1. A gate change adds 10 min to the transfer time for an international→domestic bank.
2. Before the gate change: 3 connections feasible (MCT=30, available=35 min).
3. After gate change: MCT effectively becomes 40 min (30 + 10 min transfer penalty); available=35 → `shortfallMinutes=5` for all 3.
4. Assert `totalMisconnected` jumps from 0 to `sum of paxCounts` across the 3 connections.
5. Assert the cause string on each infeasibility mentions "gate change."

acceptance: all three connections become infeasible; misconnect count correct.

---

**`S23` — Adversarial: crew-shortage interlock**
dependsOn: `S07`, `S09`
files: `test/adversarial/crew-shortage-interlock.test.ts`

how to implement the test:
1. A turnaround task network has fueling and boarding as separate tasks with the safety interlock (boarding cannot start until fueling complete).
2. De-icing truck is required for the de-icing task; set it unavailable.
3. Compute CPM: the de-icing task has no resource → mark it "blocked."
4. Assert: the CPM result lists the de-icing task as blocked; dependent tasks (doors-closed) are also delayed; `predictedOffBlockMs` shifts by the block duration.
5. Boarding is not started while fueling is in progress (verify by checking that `earliestStart("boarding") >= earliestFinish("fueling")`).

acceptance: safety interlock holds; resource block propagates through CPM.

---

**`S24` — Seed day-of-operations end-to-end**
dependsOn: `S13`, `S16`–`S23`, `S14`, `S15`
files: `test/integration/seed-day.test.ts`, `test/golden/seed-day-report.txt`

how to implement the test:
1. Import `SEED_SCHEDULE`, `SEED_SNOW_CONDITION`, `SEED_DISRUPTIONS`.
2. Create clock (start at 06:00 UTC = 21600000 ms), event log, milestone tracker, stand engine, resource allocator, disruption kernel, recovery ranker.
3. Script the timeline (advance clock per step):
   - t+0: Schedule all flights; assign stands; detect the adjacency conflict from the fixture.
   - t+30min: Snow starts; compute HOT for the regulated flight.
   - t+90min: Apply `LATE_INBOUND` disruption; propagate cascade; assert 3 entities affected.
   - t+120min: Apply `STAND_CLOSURE`; detect security-boundary rejection; surface bus-transfer option.
   - t+150min: Apply `EQUIPMENT_FAILURE` (belt); surface misconnect risk.
   - t+180min: HOT decay check; triple-bind surfaced.
   - t+210min: Generate candidate recovery plans; rank them; assert feasible plan first.
   - t+240min: Project day timeline; render report.
4. On `REGEN_GOLDEN=1`: write to `test/golden/seed-day-report.txt`.
5. On normal run: assert equality to golden file.

acceptance: all inline assertions pass; golden master matches; `npm test` green.

---

### 3. The decomposition method for the rest

After `S01`–`S24` pass, use this recipe to expand remaining breadth:

**Recipe**

1. **Pure function first**: every feature has a computation at its heart (CPM task, MCT check, slot recompute). Make it a card with no I/O.
2. **Event-source it second**: if the result changes state, emit a typed event; reconstruct state by folding the log.
3. **Adversarial fixture third**: the spec's invariants are testable — ship a dedicated adversarial card for each one.
4. **Adapter last**: fixture implementation first; live production sibling as a stub.
5. **dependsOn is mandatory**: list every card whose exported function or type the new card imports.

---

**Worked example A — Full baggage oversize handling**

Larger feature: "Oversize baggage (bikes, sports equipment) routed to dedicated belt/carousel."

Break into:

- **BA01** — `BaggageItem` type (`id`, `flightId`, `type: "standard"|"oversized"`, `weightKg`). dependsOn: `S03`.
- **BA02** — `BeltRoutingEngine.route(item, availableBelts) → { beltId, ok, reason }`. Oversize items require a belt with `oversizeCapable:true`. dependsOn: `BA01`, `S09`.
- **BA03** — `oversize-belt-full.test.ts`: all oversize-capable belts full → `ok:false, reason:"NO_OVERSIZE_BELT"`. dependsOn: `BA02`.
- **BA04** — Wire: `BAGGAGE_ROUTED` event appended per item; `BELT_CAPACITY_EXCEEDED` event when belt is full. dependsOn: `BA03`, `S04`.

**Worked example B — NOTAM-like operational notice**

Larger feature: "Publish a stand-closure notice that all flights planning to use that stand see."

Break into:

- **N01** — `OperationalNotice` type (`id`, `type:"STAND_CLOSURE"|"TAXIWAY_RESTRICTION"`, `affectedResourceId`, `effectiveFromMs`, `effectiveToMs`, `detail`). dependsOn: `S03`.
- **N02** — `NoticeBoard.publish(notice)` / `active(currentMs)` → active notices. dependsOn: `N01`, `S04`.
- **N03** — Wire: `detectConflict` in the stand engine checks `NoticeBoard.active()` for `STAND_CLOSURE` before the `stand.closed` field — so a notice alone triggers `STAND_CLOSED` even if the stand record is not updated. dependsOn: `N02`, `S08`.
- **N04** — Test: publish a notice for stand X; attempt to assign a flight to stand X within the notice window → `STAND_CLOSED`. After notice expires → assignment succeeds. dependsOn: `N03`.

**Worked example C — Fuel truck rostering**

Larger feature: "Multiple fuel trucks shared across flights; schedule them in the turnaround."

Break into:

- **F01** — `FuelTruckSchedule.plan(flightId, requiredLiters, startAfterMs): { truckId, startMs, endMs } | null`. dependsOn: `S09`.
- **F02** — Golden test: 3 flights need refueling in a 30-min window; only 2 trucks → third flight must wait → `startMs` of third is after one truck completes. dependsOn: `F01`.
- **F03** — Wire into CPM: fueling task duration = `(requiredLiters / truck.flowRateLitersPerMin)`; slot comes from `FuelTruckSchedule`; a truck conflict delays the task and may extend the critical path. dependsOn: `F02`, `S07`.

---

### 4. Per-task implementation conventions

**File/folder layout**
```
src/
  types/         domain.ts, schedule.ts
  lib/           clock.ts, prng.ts
  core/          milestone-graph.ts, departure-time-chain.ts, turnaround-cpm.ts,
                 stand-assignment.ts, resource-allocator.ts, hot-decay.ts,
                 passenger-impact.ts, disruption-kernel.ts, recovery-ranker.ts,
                 airport-projector.ts
  adapters/      flight-schedule.ts, milestone-feed.ts, network-manager.ts,
                 weather.ts, resource-state.ts, passenger-connection.ts
  fixtures/      seed-day.ts, hot-table.ts
  rule-packs/    slot-rules-v1.ts   (CTOT tolerance window as configurable constants)
test/
  lib/           clock, prng
  types/         domain
  core/          one file per core module
  adversarial/   slot-window, snow-day-triple-bind, missed-inbound, gate-outage,
                 adjacency-trap, belt-failure, connection-bank-break, crew-shortage-interlock
  integration/   seed-day
  golden/        seed-day-report.txt
```

**Named adapters (rule)**
Every file in `src/adapters/` exports an interface and a `createFixture<X>Adapter` factory. Live sibling is a stub with `// KNOWLEDGE-DEBT: live-production — <description>`.

**How to write a test in this stack (snippet)**
```ts
// test/core/departure-time-chain.test.ts
import { describe, it, expect } from "vitest";
import { computeDepartureTimeChain } from "../../src/core/departure-time-chain.js";

describe("departure-time-chain", () => {
  const BASE_MS = 0;
  const MIN = 60_000;
  it("CTOT is binding", () => {
    const r = computeDepartureTimeChain({
      eobtMs: BASE_MS + 120 * MIN,
      tobtMs: BASE_MS + 120 * MIN,
      ctotMs: BASE_MS + 125 * MIN,   // CTOT at +125; EXOT=15 → TSAT=110
      exotMs: 15 * MIN,
      readinessMs: BASE_MS + 100 * MIN,
    });
    expect(r.bindingConstraint).toBe("CTOT");
    expect(r.tsatMs).toBe(BASE_MS + 110 * MIN);
  });
});
```

**Definition of done for any card**
- All files listed exist; TypeScript compiles with `strict:true`; `npm test` green; no `Date.now()`, `Math.random()`, or HTTP; every acceptance assertion from the card passes.

---

### 5. Common pitfalls for a weak model on THIS project

**Pitfall 1 — Representing the turnaround as a single status field**
The spec explicitly states this is wrong (V0, V1). A 3B model will write `flight.status = "boarding"`. The acceptance tests in `S05` require milestone events with predecessors; `meet(M10_TSAT_ISSUED)` before `meet(M7_IN_BLOCKS)` must throw. If the model uses a status field, the predecessor check is impossible to test.

**Pitfall 2 — Computing TSAT without considering the CTOT binding**
The model will write `tsatMs = tobtMs` and stop. The `S06` card's acceptance tests pin the CTOT-binding case (`tsatMs = ctotMs − exotMs` when that is later than TOBT). The `bindingConstraint` field is the machine-readable proof that the right branch was taken; the model must return it correctly.

**Pitfall 3 — Slot window as > CTOT check only**
The slot window is `[CTOT−5, CTOT+10]`. Early departure (before CTOT−5) is also a violation. The model often only checks the upper bound. `S16` pins both the lower and upper boundaries (`CTOT−6` → missed, `CTOT−5` → ok, `CTOT+10` → ok, `CTOT+11` → missed).

**Pitfall 4 — CPM as sum of all durations instead of critical path**
`sum(all durations) > critical path` whenever there is parallelism. The model will write `totalMs = sum(tasks.map(t => t.durationMs))` and miss that cleaning and catering run in parallel with fueling. `S07`'s acceptance test directly checks that a non-critical task has non-zero float; if CPM is just a sum, all float values are 0.

**Pitfall 5 — Adjacency conflict only checking the stand's own size**
A Code-E aircraft on a Code-E stand is valid in isolation. The conflict arises only when an adjacent stand is also occupied by a Code-D+ aircraft. The model will check `aircraft.icao <= stand.icao` and miss the neighbor check. `S20` (`adjacency-trap.test.ts`) specifically tests that Code-E+Code-E adjacent is rejected while Code-E+Code-B adjacent is accepted.

**Pitfall 6 — HOT expiry not checked against projected take-off time**
The model will check `Date.now() > hot.expiresAtMs` (which is wrong anyway — no `Date.now()`) instead of checking whether the *projected take-off time* exceeds expiry. `requiresRetreatment(hot, projectedTakeoffMs)` is the correct predicate. `S17`'s snow-day test specifically puts HOT expiry between TSAT and TTOT; the model must check `ttotMs` not `now()`.

**Pitfall 7 — Disruption propagation fixing the primary flight only**
The missed-inbound cascade (`S18`) involves three distinct effects: the tail flight's TOBT slips, a different flight loses its stand, and connections off the inbound are missed. A 3B model will update the tail flight and stop. The `propagateDisruption` function's `affectedFlights` array must contain all three; the test asserts `affectedFlights.length >= 3`.

**Pitfall 8 — Recovery ranking without considering rule violations**
The model will sort only by `totalDelayMinutes` and declare the smallest delay the winner. A plan that avoids delay by missing the CTOT window is infeasible (a rule violation). `rankRecoveryPlans` must put feasible plans before infeasible ones regardless of delay; `S14`'s test pins this ordering explicitly.
