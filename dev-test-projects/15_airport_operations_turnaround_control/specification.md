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
