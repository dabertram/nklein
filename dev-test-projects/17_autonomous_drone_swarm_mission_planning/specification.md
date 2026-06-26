# 17 - Autonomous Drone Swarm Mission Planning and UTM Platform

Complexity tier: 17/20
Expected decomposition size: 44-48 dependent implementation cards before coding.
Domain pressure: autonomous drones, mission planning, airspace constraints, battery models, collision avoidance, UTM coordination, geofencing.
Acceptance command: npm test

## How to use this challenge
This is a dev-test project specification for evaluating whether an autonomous coding agent can decompose a real domain, identify knowledge gaps, build a correct foundation, and verify it with deterministic tests. The goal is not to finish the entire product. The goal is to build a durable foundation that proves the agent understood the domain boundaries and can implement the highest-risk core behaviors without hiding behind placeholders.

The agent must read this entire specification before planning. It must create a dependency-linked plan, record domain knowledge debt, and choose a narrow release slice that still exercises the real hard parts. Prefer fewer production-quality vertical slices over many shallow labels.

## Product vision
Build a drone fleet mission platform for inspection, mapping, and emergency response missions. It must coordinate multiple drones, airspace constraints, safety rules, battery limits, sensor payloads, and contingency planning with deterministic simulation.

## Foundation release scope
The first serious buildout must include:
- Drone, payload, battery, mission, waypoint, geofence, airspace volume, operator, telemetry frame, command, contingency, obstacle, and approval models.
- Mission planner for survey grids, corridor inspections, point-of-interest orbits, search patterns, launch/recovery sites, and payload coverage requirements.
- Flight feasibility engine using battery reserve, wind penalty, climb/descent, payload mass, communication range, no-fly zones, altitude bands, and return-to-home policy.
- Multi-drone deconfliction with time-expanded airspace reservations, separation minima, priority, and conflict resolution.
- Telemetry simulator that replays position, battery, link quality, payload status, command acknowledgement, and deviation events.
- Contingency manager for lost link, low battery, geofence breach risk, obstacle, weather deterioration, and emergency landing.
- UTM-style approval workflow with mission intent, airspace conflict checks, amendments, cancellation, and audit evidence.
- Seed mission involving bridge inspection, emergency search overlay, wind shift, low battery, and conflicting airspace reservation.

## Architecture requirements
- Separate mission intent, feasibility analysis, deconfliction, telemetry, command state, and contingency policy.
- Use explicit geospatial and temporal primitives with deterministic fixture maps.
- Represent safety policy as hard constraints before optimization.
- Make simulation and plan verification repeatable without real drones.

## Domain knowledge debt to surface
The agent should not pretend to know every regulation, standard, or numerical model perfectly. It should implement a defensible deterministic subset, mark assumptions explicitly, and create extension points where real-world integrations or expert-reviewed rule packs would live. Required knowledge areas:
- Drone missions are constrained by airspace, energy, communications, payload coverage, and emergency behavior.
- Collision avoidance must reason in time as well as space.
- A valid plan needs contingency routes and reserves, not just waypoints.
- Telemetry and command acknowledgements can diverge from intended plan state.

## Decomposition pressure
This project should force decomposition across domain modeling, calculation or policy engines, workflow state, deterministic fixtures, auditability, and UI/view-model boundaries. The plan should include dependency links so shared primitives and invariants are built before dependent workflow features. Avoid starting with screens. Start with the domain model, invariants, and tests that would make later screens trustworthy.

The agent should maintain a visible knowledge-debt list covering unclear standards, units, legal or safety constraints, numerical assumptions, terminology, fixture limitations, and future expert-review checkpoints. Knowledge debt is not a failure; hiding it is.

## Acceptance criteria
- Feasibility tests catch battery reserve, wind, payload, no-fly, altitude, and comms violations.
- Deconfliction tests detect time-space conflicts between drones and external reservations.
- Contingency tests produce safe actions for lost link, low battery, and geofence risk.
- Mission coverage reports show completed, missed, and invalid survey areas.
- The project passes npm test without hardware or live maps.

## Explicit non-goals
- Do not provide instructions for unsafe real-world operation.
- Do not use external map or flight-control APIs in the foundation.
- Do not treat waypoints as sufficient proof of mission safety.

## Quality bar
- Use typed domain objects and pure core modules wherever practical.
- Keep deterministic fixtures in the repository and do not depend on live APIs for acceptance tests.
- Test edge cases before building broad UI coverage.
- Every risk score, recommendation, workflow transition, or generated report must be explainable from source facts.
- Stubs are acceptable only at external integration boundaries and must be named as adapters with deterministic fixture implementations.
- The foundation should be extensible into a real product if later teams add integrations, expert-reviewed rule packs, and production UI.

---

# Extended scope & deep-reasoning extensions (v2)

> Added 2026-06-26 via deep domain research. The single hardest, most-defining property of this project is **safety reasoning in 4D (space × time) under hard constraints, with a deterministic, replayable simulation core**: a valid mission is not a list of waypoints but a set of *time-bounded airspace volumes* that are strategically deconflicted before flight, conformance-monitored during flight, and backed by energy reserves and contingency routes — and the entire flight (telemetry, link loss, wind shift, geofence breach) must replay bit-for-bit from a seed so a near-miss or a lost-link emergency is a reproducible test, never a real-world incident.

## E0. The meta-test: why 4D deconfliction + determinism is the whole challenge

A drone mission platform is trivial to fake (waypoints on a map, instant arrivals, infinite battery) and brutal to make *correct*, because every hard problem lives in **time-coupled space and energy**: "collision avoidance must reason in time as well as space," "a valid plan needs contingency routes and reserves, not just waypoints," "telemetry and command acknowledgements can diverge from intended plan state" (base spec). The disciplined version makes the *entire airspace a deterministic, event-sourced simulation* during tests — the way safety-critical infrastructure is tested: a single-threaded, seeded, discrete-event simulator where "replay the exact failure from a seed" is a capability and "fly a whole mission in milliseconds" is the unit test (https://antithesis.com/docs/resources/deterministic_simulation_testing/, https://pierrezemb.fr/posts/diving-into-foundationdb-simulation/). The grading rubric is therefore:

1. **Determinism / replay fidelity** — does replaying a seeded telemetry+command log reproduce flight state bit-for-bit (the base spec's "make simulation and plan verification repeatable without real drones")?
2. **Safety as hard constraints first** — are airspace, energy, comms, geofence, and altitude-band limits enforced as **hard constraints before optimization**, so an infeasible plan is *rejected*, not optimized into looking valid?
3. **4D deconfliction** — does the planner detect and resolve **space-time** conflicts between drones and against external reservations, not just spatial overlaps?
4. **Contingency completeness** — does every flyable plan carry energy reserves and contingency routes, and does the contingency manager produce a *safe* action for lost link, low battery, and geofence-breach risk?

Everything below serves those four.

## E1. The deterministic simulation kernel (the foundation under the foundation)

Build this before mission planning, deconfliction, or contingency. First ~6–8 cards.

- **Virtual clock + fixed tick.** No `Date.now()`/`setTimeout` in core. Time is integer ticks. Battery drain, wind evolution, link-quality changes, reservation windows, command timeouts, and contingency timers all read the virtual clock. Tests fly a mission in milliseconds; production wires the clock to wall time.
- **Seeded entropy, split by purpose.** Every stochastic element — telemetry/GPS jitter, wind gusts, link-quality dropouts, command-ack delays, sensor noise — draws from a single seeded PRNG split into per-system substreams, so a run is reproducible from `(seed, scenario)` (https://pierrezemb.fr/posts/diving-into-foundationdb-simulation/).
- **Fixed-point or carefully-bounded geospatial math.** Geospatial/temporal primitives (positions, distances, headings, separation checks) must be **deterministic across platforms** — prefer integer/fixed-point grid coordinates or a documented, deterministic projection so two runs never diverge on float rounding (cross-platform float determinism is effectively unattainable — https://gafferongames.com/post/deterministic_lockstep/). The base spec's "explicit geospatial and temporal primitives with deterministic fixture maps" is this requirement.
- **Event-sourced flight state.** Authoritative state (drone poses, battery SOC, link quality, payload status, mission/command state, reservations, conformance state, contingencies) is a **fold over an append-only event log**: `MissionSubmitted`, `DeconflictionResult`, `Cleared`, `CommandAcked`, `TelemetryFrame`, `Deviation`, `ReservationGranted`, `ConformanceStateChanged`, `ContingencyTriggered`, `GeofenceBreachRisk`, `EmergencyLanding`. State is a projection; the log is truth — giving free replay, audit, and crash recovery.
- **The replay/time-machine harness.** `flyMission(scenario, seed) -> { stateHash, eventLog, coverageReport }` runs a whole mission headless, snapshots at any tick, kills and restores, and asserts invariants throughout. **The flagship test is a deterministic mission replay whose final state hash and event-log hash are pinned and asserted identical across runs** — the base spec's "make plan verification repeatable without real drones," made byte-exact.
- **Deterministic ordering.** Drones, reservations, conflicts, and contingencies resolve in stable, explicitly-sorted order (by id with deterministic tiebreaks), never hash-map iteration order.

## E2. The UTM/U-space data model & conformance state machine (the airspace spine)

Ground the platform in the real **UAS Traffic Management** architecture; this is the domain authenticity that makes an expert nod.

- **Operation Volume / Operational Intent (4D).** A mission's airspace claim is a **4D Operational Intent Volume (OIV)**: 3D geometry + start/end times — "the 4D volume of airspace within which the operation is expected to occur" (FAA UTM ConOps v2; https://www.faa.gov/sites/faa.gov/files/2022-08/UTM_ConOps_v2.pdf, https://www.icao.int/sites/default/files/left-menu-pdfs/UTM%20Framework%20Edition%204.pdf). Plans are reasoned over **volumes in time**, not bare waypoints.
- **USS federation (as a deterministic fixture).** In real UTM, **UAS Service Suppliers (USS)** exchange operational intents to deconflict; interoperability is standardized by **ASTM F3548-21** (https://store.astm.org/f3548-21.html, https://www.unmannedairspace.info/uncategorized/standards-bodies-astm-and-rtca-collaborate-on-acas-sxu-detect-and-avoid-capability-for-drones/). Model **external reservations from a fixture "other-USS" feed** the planner must deconflict against — no live network.
- **The conformance state machine (load-bearing).** Adopt the standard states: an activated operation is **conforming** while inside its OIV; it becomes **nonconforming** on deviation beyond the volume, and **contingent** when it enters an unplanned/emergency situation — "the latter two are considered non-conforming" (ASTM F3548-21 framing; https://www.mdpi.com/2504-446X/7/10/597, https://www.icao.int/sites/default/files/left-menu-pdfs/UTM%20Framework%20Edition%204.pdf). Implement this as an explicit state machine driven by telemetry-vs-OIV conformance monitoring; the off-nominal lifecycle *is* the heart of the system.
- **Layered conflict management.** Encode UTM's three layers: **strategic deconfliction** (pre-flight, volume/schedule separation), **tactical separation/deconfliction** (in-flight adjustments), and **collision avoidance** as the last protective layer (https://www.icao.int/sites/default/files/left-menu-pdfs/UTM%20Framework%20Edition%204.pdf, https://www.mdpi.com/2076-3417/11/9/3995). Acceptance must distinguish strategic (planned conflict-free) from tactical (reactive) handling.
- **Remote ID & priority operations.** Model Remote-ID-style identity broadcast and **priority/public-safety operations** that can pre-empt volumes (emergency-response overlay), per ConOps (https://www.faa.gov/sites/faa.gov/files/2022-08/UTM_ConOps_v2.pdf) — directly serving the seed mission's "emergency search overlay."

## E3. Strategic deconfliction in 4D (the deconfliction spine)

"Collision avoidance must reason in time as well as space" (base spec). Implement real space-time deconfliction.

- **Time-expanded reservations + separation minima.** Detect conflicts as **4D operation-volume overlaps**: two volumes that intersect in space *and* overlap in time are a conflict (https://www.faa.gov/sites/faa.gov/files/2022-08/UTM_ConOps_v2.pdf). Enforce **separation minima** (a protective buffer around each trajectory). Strategic deconfliction "compares the proposed intended operation volumes with other operators' volumes to identify spatiotemporal conflicts" and approves only non-overlapping intents (https://www.researchgate.net/publication/332107751_UAS_Traffic_Management_UTM_Project_Strategic_Deconfliction_System_Requirements_Final_Report).
- **Resolution moves in 4D:** time-shift (delay launch / re-window), reroute (alter volume geometry), altitude-band change, or priority-based yield. Each resolution is deterministic and re-checked for new conflicts (the base spec's "amendments").
- **Acknowledge the hardness.** Full pairwise strategic deconfliction against all scheduled flights is computationally heavy — the FAA/NASA method "requires analysis comparing the new flight to every other flight already scheduled… a 4D P-SPACE-hard analysis" (https://www.researchgate.net/publication/332107751_UAS_Traffic_Management_UTM_Project_Strategic_Deconfliction_System_Requirements_Final_Report). Use bounded/windowed checks and record the scaling assumption as knowledge debt (E11).
- **DAA Well Clear for the tactical layer.** Where tactical separation is modeled, ground "well clear" in the standard: ASTM F3442/F3442M-23 specifies a **"hockey-puck" DAA Well Clear volume — ~2,000 ft horizontal × 250 ft vertical** around the aircraft (https://www.unmannedairspace.info/emerging-regulations/standards-bodies-astm-and-rtca-collaborate-on-acas-sxu-detect-and-avoid-capability-for-drones/), with RTCA DO-365C as the DAA MOPS reference (https://standards.globalspec.com/std/14562761/do-365c). Mark sensor-based DAA as a production adapter; the fixture models the *geometry/logic*, not live sensing.
- **Test:** deconfliction detects time-space conflicts between drones **and** against the fixture external-reservation feed (an explicit acceptance criterion), and the seed mission's "conflicting airspace reservation" is detected and resolved before clearance.

## E4. The flight-feasibility engine — hard constraints before optimization (the safety spine)

"Represent safety policy as hard constraints before optimization" (base spec). An infeasible plan must be **rejected**, never optimized into looking valid.

- **Energy model as a hard, segment-based constraint.** Battery SOC is consumed per **flight segment** (climb, cruise, hover, descent) scaled by **payload mass** and a **wind penalty** (head/tail/cross-wind relative-velocity term) — the factors real UAV energy models require (https://www.researchgate.net/publication/369011139_An_Overview_of_Drone_Energy_Consumption_Factors_and_Models, https://www.sciencedirect.com/science/article/pii/S1000936125002110). A plan is feasible only if it completes **with a reserve margin sufficient for return-to-home plus a contingency maneuver** — "reserve energy to manage unexpected situations… return-to-home, alternate landing, contingency maneuvers" (https://www.sciencedirect.com/science/article/pii/S2203...,  https://www.mdpi.com/2075-1702/14/6/624). Wind-coupled energy estimation materially changes range (errors of ~16% if wind is ignored — https://doi.org/10.3390/drones10050337), so wind is a first-class input, not a fudge factor.
- **Other hard constraints, all checked before any optimization:** **no-fly zones / geofences** (keep-out), **keep-in operating volume**, **altitude bands**, **communication range** (must stay within link budget or enter a planned lost-link procedure), and **return-to-home policy**. Each violation is an explicit, explainable rejection reason — the base spec's "feasibility tests catch battery reserve, wind, payload, no-fly, altitude, and comms violations."
- **Geofencing model.** Implement the three UTM geofence types — **keep-in** (must remain inside), **keep-out** (must never enter), and **dynamic** (time-varying, e.g. a TFR/emergency zone activating mid-mission) (https://www.icao.int/sites/default/files/left-menu-pdfs/UTM%20Framework%20Edition%204.pdf). A dynamic keep-out activating during flight must trigger conformance/contingency handling (E5).
- **Test:** feasibility rejects a plan that can't hold reserve under a wind penalty, one that clips a no-fly zone, one that exceeds comms range, and one that violates an altitude band — each with a distinct, source-explainable reason.

## E5. The contingency manager — the off-nominal lifecycle (the resilience spine)

"A valid plan needs contingency routes and reserves, not just waypoints"; "telemetry and command acknowledgements can diverge from intended plan state" (base spec). This is where fake versions collapse.

- **Contingency volume + planned procedures.** Each mission carries, alongside its OIV, a **contingency volume** and **pre-planned contingency procedures** for each off-nominal trigger — the UTM model of operations transitioning to a **contingent** state with a contingency volume (https://www.faa.gov/sites/faa.gov/files/2022-08/UTM_ConOps_v2.pdf).
- **Triggers → deterministic safe actions:** **lost link** (telemetry/command divergence) → execute pre-agreed lost-link procedure (hold, RTH, or land at a designated site) per planned timer; **low battery** → RTH or divert to nearest feasible recovery site while reserve still permits; **geofence-breach risk** (predicted exit of keep-in / entry of keep-out) → reroute or hold before the breach; **weather deterioration / wind shift** → re-evaluate feasibility, possibly RTH; **obstacle** → tactical avoid or hold; **emergency landing** when no safe alternative remains. The base spec's "contingency tests produce safe actions for lost link, low battery, and geofence risk" is the acceptance bar.
- **Telemetry-driven, not command-assumed.** Conformance monitoring compares telemetry to the OIV every tick; a deviation flips the state (conforming → nonconforming → contingent) and the manager acts on *observed* state — the operator "monitors for vehicle non-conformance and on-board equipment failures or degradation such as lost link" (https://www.mdpi.com/2504-446X/7/10/597). Command acks and telemetry are **separate truths**; state derives from telemetry.
- **Test:** the seed mission's **wind shift + low battery + lost link** each produce a *safe* action, the conformance state machine transitions correctly, and the drone never violates a hard constraint while contingent.

## E6. Mission planning & swarm task allocation (the coordination spine)

The base spec wants survey grids, corridor inspections, POI orbits, search patterns, launch/recovery sites, and payload-coverage requirements — coordinated across multiple drones.

- **Pattern generators → coverage obligations.** Mission patterns (**boustrophedon survey grid**, **corridor/linear inspection**, **POI orbit**, **search pattern**) generate waypoint sequences with **payload sensor-coverage requirements** (footprint × overlap), so a mission has an explicit *coverage obligation* the report (E8) checks against, not just a path.
- **Multi-drone task allocation via CBBA.** Allocate survey cells / inspection tasks / search sub-areas across the swarm with the **Consensus-Based Bundle Algorithm (CBBA)** — the benchmark distributed multi-UAV allocator: a **two-phase bundle-construction + consensus/conflict-resolution** auction where drones bid on task bundles and converge on a conflict-free assignment over peer communication (https://pmc.ncbi.nlm.nih.gov/articles/PMC7219066/, https://www.mdpi.com/2504-446X/9/8/530). Use **CBAA** for single-task and **CBBA** for multi-task assignment (https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12838631/). Allocation must respect each drone's feasibility (E4) and the deconfliction layer (E3) — a task isn't assigned to a drone that can't energy-feasibly reach it.
- **Determinism note.** CBBA is distributed/iterative; in the test harness run it **deterministically** (fixed agent order, seeded tie-breaks, synchronous consensus rounds) so allocations replay identically.
- **Emergency overlay & priority.** A priority emergency-search task (the seed mission's overlay) can pre-empt/re-allocate the swarm under the priority-operations model (E2).

## E7. The adversarial / failure fixture pack (red-team as a first-class test asset)

Ship the airspace's hostility in the repo as deterministic fixtures the system must survive — the seed mission's "bridge inspection, emergency search overlay, wind shift, low battery, conflicting airspace reservation," each made concrete:

- A **conflicting external reservation** (fixture other-USS volume) overlapping a proposed OIV in space *and* time (E3 must detect + resolve before clearance).
- A **mid-mission wind shift** that pushes a previously-feasible plan below reserve (E4/E5 must re-evaluate and act).
- A **lost-link event** (telemetry stops / command acks diverge) that must trigger the planned lost-link procedure, not a crash or an assumed-success (E5).
- A **dynamic geofence activation** (emergency TFR keep-out) intersecting an in-flight path (E4/E5 reroute-or-hold before breach).
- A **low-battery drone** that can no longer complete its survey and must divert to a recovery site with reserve intact (E4/E5).
- A **two-drone time-space near-conflict** at a shared corridor that strategic deconfliction must separate (E3), plus a tactical "well clear" check (DAA hockey-puck) if the strategic layer is bypassed.
- The system must, deterministically, for each: **detect, raise the correct event/conformance transition, produce a safe action, and continue or safely terminate** — and the replay must reproduce it exactly.

## E8. Mission coverage & explainability reports (the auditability spine)

"Mission coverage reports show completed, missed, and invalid survey areas" (acceptance criterion); "every recommendation, decision, state transition, score, or report must be explainable from source facts" (base spec).

- **Coverage report.** Per mission, compute **completed / missed / invalid** coverage against the pattern's coverage obligation (E6) — a cell is *completed* only if a drone flew it with the required payload footprint/overlap while conforming; *missed* if skipped (e.g. due to a contingency RTH); *invalid* if flown out of spec (wrong altitude band, sensor off, nonconforming).
- **Explainability graph.** Every feasibility rejection, deconfliction resolution, conformance transition, and contingency action traces to its **source facts** (the constraint violated, the conflicting volume, the telemetry deviation, the reserve shortfall) — reconstructable from the event log alone, not from prose.
- **Test:** golden coverage reports for canonical missions; redact the prose and the structured record alone answers "why was this rejected / rerouted / landed?"

## E9. Global invariants (property-based, this is how the platform is graded)

Beyond example tests, assert **system-wide invariants** across randomized + scripted missions (https://antithesis.com/docs/resources/property_based_testing/):

1. **Determinism / replay** — `flyMission(scenario, seed)` twice yields **identical** state and event-log hashes; snapshot+restore mid-mission changes nothing.
2. **Hard-constraint inviolability** — across *every tick of every run*, no drone violates a no-fly/keep-out geofence, exits its keep-in volume undetected, breaches an altitude band, exceeds comms range without a lost-link procedure, or drops below its reserve margin while a safe action existed.
3. **Separation / deconfliction correctness** (E3) — no two cleared operations' protective volumes overlap in space-time; no cleared operation overlaps an external reservation.
4. **Energy monotonicity & reserve** (E4) — SOC is monotone non-increasing in flight; a plan is never cleared without RTH+contingency reserve; a feasible-at-clearance plan that becomes infeasible (wind shift) triggers a contingency.
5. **Conformance correctness** (E2/E5) — state derives from telemetry vs. OIV; every deviation transitions conforming → nonconforming/contingent and raises the matching event; no contingent operation takes an unsafe action.
6. **Contingency completeness** (E5) — every cleared mission carries a contingency volume + procedures; every trigger yields a safe action.
7. **Totality of audit** — every decision (submission, deconfliction result, clearance, conformance transition, contingency, command) has exactly one ordered audit event; reports reconstructable from the log alone.

Plus a **chaos mode**: inject lost link, wind gusts, dropped/late telemetry, dynamic-geofence activation, corrupted-snapshot recovery, and a mid-flight reservation, and assert all invariants still hold.

## E10. The concrete first vertical slice (the on-ramp — build THIS first, ~20–26 of the 44–48 cards)

Do **not** spread the first slice across all patterns and panels. Prove the spine end-to-end on one small fixture map:

- The **deterministic kernel** (E1): virtual clock, seeded split-PRNG, deterministic geospatial primitives, event log, snapshot/restore, state hashing, replay harness.
- The **UTM data model + conformance state machine** (E2): 4D OIV, fixture other-USS reservations, conforming/nonconforming/contingent states.
- **Strategic deconfliction in 4D** (E3) with separation minima, proven on a two-drone time-space conflict and one external reservation.
- The **flight-feasibility engine** (E4): segment energy model + payload + wind penalty + reserve, no-fly/keep-in/keep-out/altitude/comms hard constraints, with explainable rejections.
- The **contingency manager** (E5): lost link, low battery, geofence-breach risk → safe actions, telemetry-driven.
- **One mission pattern (a small survey grid)** with a **payload coverage obligation** and a **coverage report** (E8), allocated across **2–3 drones via deterministic CBBA/CBAA** (E6).
- The **replay golden test + global invariants** (E9) and at least **three adversarial fixtures** (E7: conflicting reservation, wind-shift-into-low-battery, lost link) green on this slice.

If that slice is deterministic, hard-constraint-safe, 4D-deconflicted, and contingency-complete, every later pattern and panel is breadth on a proven spine.

## E11. Domain knowledge-debt to track (surface, don't bluff)

- **This is not authorization for real flight.** The base spec forbids "instructions for unsafe real-world operation." Regulatory reality (BVLOS waivers, Part 107, SORA risk assessment, U-space service certification) is **expert-and-regulator-reviewed** and out of scope to *claim*; the platform models the *logic* of UTM, not legal airworthiness.
- **Standards are evolving and partly proprietary.** ASTM F3548-21 (USS interop), ASTM F3442/F3442M-23 (DAA), RTCA DO-365C (DAA MOPS) define the real interfaces (https://store.astm.org/f3548-21.html, https://standards.globalspec.com/std/14562761/do-365c); the fixtures approximate their *geometry/logic*. Flag exact separation buffers, DAA Well Clear numbers, and OIV buffer sizes as fixtures needing aviation-safety review.
- **Strategic deconfliction scaling.** Full pairwise 4D deconfliction is "P-SPACE-hard" at scale (https://www.researchgate.net/publication/332107751_UAS_Traffic_Management_UTM_Project_Strategic_Deconfliction_System_Requirements_Final_Report); record the windowing/bounding assumption and the validated operation/drone-count ceiling.
- **Energy & wind models are approximations.** Real UAV energy depends on aerodynamics, temperature, battery aging, and turbulent wind fields (https://www.researchgate.net/publication/369011139_An_Overview_of_Drone_Energy_Consumption_Factors_and_Models, https://doi.org/10.3390/drones10050337); the fixture model uses documented segment coefficients and must mark per-airframe calibration, battery degradation, and high-fidelity wind as future expert-review items.
- **Localization/telemetry uncertainty.** Real GPS/INS has position error and dropout; the fixture models clean discretized telemetry and should flag sensor noise, GPS-denied operation, and clock-sync as deferred.
- **Tactical DAA needs real sensing.** Sensor-based detect-and-avoid (radar/ADS-B/optical) is a production adapter (https://www.unmannedairspace.info/uncategorized/faa-plans-major-overhaul-of-detect-and-avoid-regulations-to-extend-bvlos-operations/); the foundation models the deconfliction/well-clear *logic*, not live sensing.

## E12. Why this is a great !Klein challenge

This is a **4D-safety-reasoning crucible** that punishes exactly the shortcuts a small local model takes by default: it will want waypoints to equal a plan, batteries to be infinite, "collision avoidance" to be spatial-only, and "safety" to be a warning string — and here each of those turns a test red. The real value is "can good decomposition + hard-constraint gates + invariant tests make a *fallible* model produce a **deterministic, energy-feasible, 4D-deconflicted, contingency-complete** mission planner." It stresses multi-agent coordination (CBBA swarm allocation, 4D deconfliction), reasoning in time-coupled space (operation volumes, separation minima, conformance monitoring), hard-constraint-before-optimization discipline (feasibility rejection with explainable reasons), and the off-nominal lifecycle that defines real autonomy (lost link, low battery, geofence breach → safe action) — all replayable from a seed so a near-miss or an emergency landing is a reproducible test, not a crash. The reward is legible and serious: a headless mission that replays bit-for-bit, a feasibility engine that *rejects* the unsafe plan with a reason, a deconfliction layer that separates two drones in space-time, and a contingency manager that lands a low-battery drone safely. **Build the kernel + UTM/conformance model + 4D deconfliction + feasibility/contingency (E1–E5, E9) first; earn the rest.**

---

## Small-model build guide (3B-ready)

> This section is the mechanical on-ramp. A 3B model reading this must be able to follow it card-by-card without needing to be clever. Every card is independently implementable and verifiable. Read E1–E12 above first; this section operationalizes them.

---

### 1. Glossary & ground rules

**Domain terms:**
- **Tick** — integer logical time unit. Never use `Date.now()`, `performance.now()`, or `setTimeout` in any core module. A mission is simulated by advancing ticks.
- **Grid coordinate** — integer `(x, y, alt)` tuple. Positions are on a fixed integer grid, never floating-point. This is what "explicit geospatial and temporal primitives with deterministic fixture maps" means.
- **Altitude band** — an integer range `[minAlt, maxAlt]` (in grid units). Operations must remain within their assigned altitude band.
- **OIV (Operational Intent Volume)** — the 4D claim a mission makes on airspace: a 3D bounding box + a tick range `[startTick, endTick]`. Two OIVs conflict if they overlap in both space AND time.
- **Separation minimum** — the minimum spatial distance between two OIVs at any overlapping tick (an integer grid-unit buffer, e.g. 3 units). Two OIVs are deconflicted if their spatial extent plus the buffer never overlaps during their time overlap.
- **Conformance state** — `conforming | nonconforming | contingent`. A drone is conforming while inside its OIV; nonconforming if it deviates outside; contingent when executing an emergency procedure.
- **Contingency volume** — an additional 4D volume reserved alongside the OIV for use when the drone enters a contingency state (larger, to cover RTH or emergency procedures).
- **USS (UAS Service Supplier)** — in real UTM, the entity that manages a drone's OIV and communicates with other USSs. In tests, modeled as a fixture "other-USS" that provides external reservations (no live network).
- **Event log** — append-only array of typed events. Flight state is a fold over the log.
- **Telemetry frame** — a message from the drone reporting position, SOC, link quality, payload status, and conformance state. Flight state updates from telemetry, not from commands.
- **Command ack** — drone's acknowledgement of a command (may be rejected, delayed, or lost).
- **RTH (Return to Home)** — the drone autonomously returns to its launch/recovery site, triggered by contingency.
- **CBBA (Consensus-Based Bundle Algorithm)** — a distributed multi-drone task allocation algorithm. In tests, run synchronously with fixed agent order (deterministic).
- **CBAA** — CBBA variant for single-task assignment (simpler, use this for the first slice).
- **Coverage obligation** — a set of grid cells a mission pattern must fly over with the payload active. A cell is covered only if the drone was conforming and the payload was active at the required altitude.

**Stack:**
- Language: TypeScript (strict mode, `noImplicitAny: true`)
- Runtime: Node.js (no browser globals in core)
- Test runner: `npm test` runs Vitest or Jest (whichever is in `package.json`)
- No external geospatial libraries — all coordinate math uses integer arithmetic
- No network, no hardware I/O in tests — fixture maps, scenarios, and telemetry sequences are TypeScript objects in `test/fixtures/`

**Ground rules:**
1. Never use `Math.random()` in `src/core/` — use the seeded PRNG from `src/core/prng.ts`.
2. Never use `Date.now()` or wall-clock time in core.
3. All positions and distances are integer grid units — never JavaScript `number` floats for spatial math.
4. Flight state updates from telemetry events only, not from command dispatch.
5. Safety (geofence, altitude, comms) is checked as a hard constraint before any plan is approved.
6. Every acceptance test runs offline. No network, no hardware.
7. The acceptance command is `npm test`. It must pass green before a card is done.

---

### 2. The explicit task graph for the first vertical slice

The first vertical slice covers E1–E5, E8 (coverage report), and E9 from the v2 section. It has **18 cards** (D01–D18). Build them in order.

---

**D01 — Project scaffold & TypeScript config**
dependsOn: none
files: `package.json`, `tsconfig.json`, `src/core/.gitkeep`, `test/.gitkeep`

interface: configuration only.

how to implement:
1. Create `package.json` with `"type": "module"`, `"test": "vitest run"`, dev dependencies: `vitest`, `typescript`.
2. `tsconfig.json`: `"strict": true`, `"noImplicitAny": true`, `"target": "ES2022"`, `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`.

acceptance: `npm test` exits 0. No TypeScript errors.

---

**D02 — Seeded split-PRNG**
dependsOn: D01
files: `src/core/prng.ts`, `test/core/prng.test.ts`

interface:
```typescript
// src/core/prng.ts
export type PrngState = { s0: bigint; s1: bigint };
export type PrngStream = { state: PrngState; streamId: number };

export function createPrng(seed: bigint): PrngState;
export function splitStream(root: PrngState, streamId: number): PrngStream;
export function nextUint32(stream: PrngStream): { value: number; next: PrngStream };
export function nextIntBelow(stream: PrngStream, max: number): { value: number; next: PrngStream };
// nextIntIn(min, max): integer in [min, max]
export function nextIntIn(stream: PrngStream, min: number, max: number): { value: number; next: PrngStream };
```

how to implement:
1. SplitMix64 in bigints.
2. `splitStream`: seed from `root.s0 ^ BigInt(streamId)`.
3. All pure (return next state).

acceptance:
- `createPrng(7n)` called twice returns identical states.
- `nextUint32` called 50 times produces identical sequence on re-run.
- `splitStream(root, 1)` and `splitStream(root, 2)` produce different outputs.

---

**D03 — Integer geospatial primitives**
dependsOn: D01
files: `src/core/geo.ts`, `test/core/geo.test.ts`

interface:
```typescript
// src/core/geo.ts
export type GridCoord = { x: number; y: number; alt: number }; // all integers
export type BoundingBox3D = { minX: number; maxX: number; minY: number; maxY: number; minAlt: number; maxAlt: number };

// Integer Chebyshev distance (max of x/y/alt deltas) — never use Math.sqrt
export function chebyshevDist(a: GridCoord, b: GridCoord): number;
// Euclidean-squared distance (integer, no sqrt): (dx*dx + dy*dy + dz*dz)
export function euclideanSq(a: GridCoord, b: GridCoord): number;
// Axis-aligned bounding box for a list of coords
export function boundingBoxOf(coords: GridCoord[]): BoundingBox3D;
// Returns true if two bounding boxes overlap in all three dimensions
export function boxesOverlap3D(a: BoundingBox3D, b: BoundingBox3D): boolean;
// Returns true if point is inside box (inclusive)
export function pointInBox(p: GridCoord, box: BoundingBox3D): boolean;
// Separation check: do two 3D boxes maintain at least minSeparation in EVERY dimension?
export function separationSatisfied(a: BoundingBox3D, b: BoundingBox3D, minSeparation: number): boolean;
```

how to implement:
1. All integer arithmetic — no `Math.sqrt`, no floats.
2. `chebyshevDist`: `Math.max(|dx|, |dy|, |dz|)` — note: `Math.max` and `Math.abs` are pure deterministic functions on integers and are fine to use.
3. `separationSatisfied`: boxes are separated if `a.maxX + minSeparation <= b.minX` OR `b.maxX + minSeparation <= a.minX` (etc. for all axes).
4. Write `test/core/geo.test.ts`.

acceptance:
- `chebyshevDist({x:0,y:0,alt:0}, {x:3,y:1,alt:2})` returns `3`.
- `euclideanSq({x:0,y:0,alt:0}, {x:3,y:4,alt:0})` returns `25`.
- Two boxes that overlap in XY but not in alt: `boxesOverlap3D` returns `false`.
- Two boxes with a gap of exactly `minSeparation`: `separationSatisfied` returns `true`.
- Two boxes with a gap of `minSeparation - 1`: `separationSatisfied` returns `false`.

---

**D04 — Core domain types**
dependsOn: D03
files: `src/core/types.ts`

interface:
```typescript
// src/core/types.ts
export type Tick = number;
export type DroneId = string;
export type MissionId = string;
export type GeofenceId = string;
export type OperationId = string;
export type WaypointId = string;

export type ConformanceState = 'conforming' | 'nonconforming' | 'contingent';
export type DroneStatus = 'grounded' | 'preflight' | 'flying' | 'rthing' | 'landed' | 'fault' | 'lost-link';
export type PayloadStatus = 'off' | 'active' | 'fault';

export type Drone = {
  id: DroneId;
  position: GridCoord;
  altBand: { minAlt: number; maxAlt: number };
  soc: number;             // integer 0–100
  maxSoc: number;          // typically 100
  payloadMassKg: number;   // integer
  commsRangeUnits: number; // integer grid units
  status: DroneStatus;
  payloadStatus: PayloadStatus;
  conformanceState: ConformanceState;
  activeMissionId: MissionId | null;
};

export type Waypoint = { id: WaypointId; coord: GridCoord };
export type FlightSegmentKind = 'climb' | 'cruise' | 'hover' | 'descent';
export type FlightSegment = { from: Waypoint; to: Waypoint; kind: FlightSegmentKind; durationTicks: number };

export type OIV = {
  operationId: OperationId;
  droneId: DroneId;
  box: BoundingBox3D;     // spatial extent
  startTick: Tick;
  endTick: Tick;
};

export type ContingencyVolume = {
  operationId: OperationId;
  box: BoundingBox3D;
  startTick: Tick;
  endTick: Tick;
  procedures: ContingencyProcedure[];
};

export type ContingencyTrigger = 'lost-link' | 'low-battery' | 'geofence-breach-risk' | 'wind-shift' | 'obstacle' | 'emergency';
export type ContingencyAction = 'hold' | 'rth' | 'land-nearest' | 'reroute' | 'emergency-land';
export type ContingencyProcedure = { trigger: ContingencyTrigger; action: ContingencyAction; targetCoord?: GridCoord };

export type GeofenceKind = 'keep-out' | 'keep-in' | 'dynamic';
export type Geofence = { id: GeofenceId; kind: GeofenceKind; box: BoundingBox3D; activeTicks?: [Tick, Tick] };

export type MissionStatus = 'planning' | 'submitted' | 'approved' | 'active' | 'completed' | 'aborted';
export type Mission = {
  id: MissionId;
  droneId: DroneId;
  waypoints: Waypoint[];
  segments: FlightSegment[];
  oiv: OIV;
  contingencyVolume: ContingencyVolume;
  status: MissionStatus;
  coverageObligation: GridCoord[];  // cells that must be overflown with payload active
};

export type WindState = { direction: number; speedUnits: number }; // integer direction (0–7 compass) and integer speed

export type FlightEvent =
  | { type: 'MissionSubmitted'; tick: Tick; missionId: MissionId; droneId: DroneId }
  | { type: 'DeconflictionResult'; tick: Tick; missionId: MissionId; passed: boolean; conflictingOperationId?: OperationId }
  | { type: 'Cleared'; tick: Tick; missionId: MissionId }
  | { type: 'CommandAcked'; tick: Tick; droneId: DroneId; commandId: string }
  | { type: 'CommandRejected'; tick: Tick; droneId: DroneId; commandId: string; reason: string }
  | { type: 'TelemetryFrame'; tick: Tick; droneId: DroneId; position: GridCoord; soc: number; linkQuality: number; payloadStatus: PayloadStatus; status: DroneStatus }
  | { type: 'Deviation'; tick: Tick; droneId: DroneId; deviationVector: GridCoord }
  | { type: 'ConformanceStateChanged'; tick: Tick; droneId: DroneId; from: ConformanceState; to: ConformanceState }
  | { type: 'ContingencyTriggered'; tick: Tick; droneId: DroneId; trigger: ContingencyTrigger; action: ContingencyAction }
  | { type: 'GeofenceBreachRisk'; tick: Tick; droneId: DroneId; geofenceId: GeofenceId }
  | { type: 'EmergencyLanding'; tick: Tick; droneId: DroneId; coord: GridCoord }
  | { type: 'ReservationGranted'; tick: Tick; operationId: OperationId }
  | { type: 'CoverageCellCompleted'; tick: Tick; droneId: DroneId; cell: GridCoord };

export type FlightState = {
  tick: Tick;
  drones: Map<DroneId, Drone>;
  missions: Map<MissionId, Mission>;
  geofences: Map<GeofenceId, Geofence>;
  reservations: Map<OperationId, OIV>;
  externalReservations: OIV[];   // fixture "other-USS" feed
  wind: WindState;
  eventLog: FlightEvent[];
  prngStreams: Record<string, PrngStream>;
};

export type MissionScenario = {
  drones: Drone[];
  missions: Mission[];
  geofences: Geofence[];
  externalReservations: OIV[];
  wind: WindState;
  seed: bigint;
};
```

how to implement:
1. Create `src/core/types.ts` — types only.
2. Write trivial `test/core/types.test.ts` that creates one instance of each type.

acceptance: TypeScript compiles, `npm test` → green.

---

**D05 — Flight state initialization & event fold**
dependsOn: D02, D04
files: `src/core/state.ts`, `test/core/state.test.ts`

interface:
```typescript
// src/core/state.ts
export function initFlightState(scenario: MissionScenario): FlightState;
export function applyEvent(state: FlightState, event: FlightEvent): FlightState;
export function foldEvents(initial: FlightState, events: FlightEvent[]): FlightState;
export function hashFlightState(state: FlightState): string;
// Serialize Maps to sorted arrays, bigints to strings, then djb2/FNV-1a hash.
```

how to implement:
1. `initFlightState`: index drones/missions/geofences into Maps, tick=0, empty log, init PRNG streams.
2. `applyEvent`: pattern-match, return new state (never mutate).
   - `TelemetryFrame`: update drone position, soc, status, payloadStatus.
   - `ConformanceStateChanged`: update `drone.conformanceState`.
   - `CoverageCellCompleted`: mark the cell as done in the mission's coverage tracking.
3. `hashFlightState`: sorted-keys serialization.

acceptance:
- `initFlightState` with 2 drones has `state.drones.size === 2`.
- `hashFlightState` is identical on two calls with the same state.
- `TelemetryFrame` event correctly updates drone position.

---

**D06 — Snapshot / restore**
dependsOn: D05
files: `src/core/snapshot.ts`, `test/core/snapshot.test.ts`

interface:
```typescript
export type Snapshot = { tick: number; data: string };
export function takeSnapshot(state: FlightState): Snapshot;
export function restoreSnapshot(snap: Snapshot): FlightState;
```

how to implement: same pattern as warehouse W05 — serialize sorted Maps, bigints as strings; reconstruct on restore.

acceptance:
- `hashFlightState(restoreSnapshot(takeSnapshot(state))) === hashFlightState(state)`.
- Restore at tick 10, apply 5 more events, hash matches no-restore + same 5 events.

---

**D07 — OIV 4D overlap detector**
dependsOn: D03, D04
files: `src/core/deconfliction.ts`, `test/core/deconfliction.test.ts`

interface:
```typescript
// src/core/deconfliction.ts
export type ConflictResult =
  | { conflict: false }
  | { conflict: true; conflictingOperationId: OperationId; reason: string };

export function detectOIVConflict(
  proposed: OIV,
  existing: OIV,
  separationMinUnits: number
): ConflictResult;
// Conflict if time ranges overlap AND spatial boxes don't satisfy separation.
// Time overlap: proposed.startTick <= existing.endTick AND proposed.endTick >= existing.startTick.
// Spatial separation: separationSatisfied(proposed.box, existing.box, separationMinUnits) must be true.

export function checkAgainstAll(
  proposed: OIV,
  allReservations: OIV[],
  externalReservations: OIV[],
  separationMinUnits: number
): ConflictResult;
// Check against all existing + external. Return first conflict found.
// Check external first, then internal (deterministic: check in operationId sorted order).
```

how to implement:
1. Time overlap: `start1 <= end2 && end1 >= start2` (integer comparison).
2. Spatial: call `separationSatisfied` from D03.
3. `checkAgainstAll`: sort both lists by `operationId` before iterating — never iterate unsorted.
4. Write `test/core/deconfliction.test.ts`.

acceptance:
- Two OIVs that overlap in space but not time: `conflict: false`.
- Two OIVs that overlap in time but not space (separation satisfied): `conflict: false`.
- Two OIVs overlapping in both space and time: `conflict: true`.
- An OIV that overlaps an external reservation: `conflict: true` with the external operationId.
- Identical calls produce identical results (determinism).

---

**D08 — Flight feasibility engine**
dependsOn: D03, D04
files: `src/core/feasibility.ts`, `test/core/feasibility.test.ts`

interface:
```typescript
// src/core/feasibility.ts
export type FeasibilityViolation = {
  kind: 'battery-reserve' | 'no-fly-zone' | 'keep-in-violation' | 'altitude-band' | 'comms-range';
  reason: string;
  segmentIndex?: number;
  geofenceId?: string;
};

export type FeasibilityResult =
  | { feasible: true }
  | { feasible: false; violations: FeasibilityViolation[] };

// Energy model: each segment costs `segmentCostSoc(segment, windState, payloadMassKg)` SOC points.
// Reserve requirement: after all segments, must have soc > reserveSocPercent (e.g. 20)
//   PLUS enough to fly from last waypoint to home coord.
export function segmentCostSoc(
  segment: FlightSegment,
  wind: WindState,
  payloadMassKg: number
): number; // integer SOC points consumed

export function checkFeasibility(
  drone: Drone,
  mission: Mission,
  geofences: Map<GeofenceId, Geofence>,
  homeCoord: GridCoord,
  wind: WindState,
  reserveSocPercent: number
): FeasibilityResult;
// Checks in order (all violations collected, not just first):
// 1. Battery: sum segmentCostSoc for all segments + RTH cost >= drone.soc - reserveSocPercent.
// 2. No-fly zones (keep-out): any waypoint inside a keep-out geofence.
// 3. Keep-in: any waypoint outside the keep-in geofence (if one exists).
// 4. Altitude bands: any waypoint outside drone.altBand.
// 5. Comms range: any waypoint beyond drone.commsRangeUnits from homeCoord.
```

how to implement:
1. `segmentCostSoc`: base cost per segment kind (climb=3, cruise=2, hover=4, descent=1) per 10 ticks, multiplied by `1 + payloadMassKg / 20` (integer division), then add wind penalty `windSpeedUnits / 10` per 10 ticks for headwind (direction opposing segment direction). All integer.
2. `checkFeasibility`: collect all violations, return `{ feasible: false, violations }` if any found.
3. Check geofences by comparing waypoint coords to geofence boxes using `pointInBox`.
4. Write `test/core/feasibility.test.ts`.

acceptance:
- A drone with soc=30, reserve=20, segments costing 25 total: `feasible: false`, violation kind `'battery-reserve'`.
- A waypoint inside a keep-out geofence: `feasible: false`, kind `'no-fly-zone'`.
- A waypoint outside altitude band: `feasible: false`, kind `'altitude-band'`.
- A waypoint beyond comms range: `feasible: false`, kind `'comms-range'`.
- All four violations detected in a single plan.
- A plan with no violations: `feasible: true`.

---

**D09 — Conformance state machine**
dependsOn: D04, D05
files: `src/core/conformance.ts`, `test/core/conformance.test.ts`

interface:
```typescript
// src/core/conformance.ts
export function checkConformance(
  drone: Drone,
  mission: Mission,
  currentTick: Tick
): { inVolume: boolean; deviationVec: GridCoord | null };
// Checks if drone.position is inside mission.oiv.box at currentTick.
// Returns the deviation vector (position - nearest OIV boundary) if outside, else null.

export function transitionConformanceState(
  current: ConformanceState,
  inVolume: boolean,
  contingencyTriggered: boolean
): ConformanceState;
// conforming + inVolume=true → conforming
// conforming + inVolume=false → nonconforming
// nonconforming + contingencyTriggered → contingent
// contingent stays contingent (only manual reset)

export function monitorConformance(
  state: FlightState,
  missionId: MissionId
): FlightEvent[];
// Per tick: check conformance, emit ConformanceStateChanged if state changes, emit Deviation if outside.
```

how to implement:
1. `checkConformance`: use `pointInBox(drone.position, mission.oiv.box)`. Compute deviationVec as component-wise difference from the nearest boundary point.
2. `transitionConformanceState`: pure function, state machine transitions as above.
3. `monitorConformance`: call both, collect events.
4. Write `test/core/conformance.test.ts`.

acceptance:
- Drone inside OIV at the right tick: `inVolume: true`.
- Drone 1 unit outside OIV: `inVolume: false`, `deviationVec` points outward.
- Transition from conforming → nonconforming when drone exits OIV.
- Transition to contingent when contingency is triggered while nonconforming.
- A conforming drone stays conforming even with minor random telemetry jitter if the OIV has a buffer.

---

**D10 — Contingency manager**
dependsOn: D04, D05, D08, D09
files: `src/core/contingency.ts`, `test/core/contingency.test.ts`

interface:
```typescript
// src/core/contingency.ts
export function selectContingencyAction(
  drone: Drone,
  mission: Mission,
  trigger: ContingencyTrigger,
  currentTick: Tick,
  geofences: Map<GeofenceId, Geofence>,
  wind: WindState
): ContingencyAction;
// Deterministic decision tree:
// lost-link: use mission's pre-planned lost-link procedure action.
// low-battery: if RTH feasible (checkFeasibility with RTH segment), 'rth'; else 'land-nearest'.
// geofence-breach-risk: if reroutable (stub: always 'reroute' in this slice), 'reroute'; else 'rth'.
// wind-shift: re-check feasibility; if infeasible, 'rth'; else 'hold' (wait for re-plan).
// emergency: 'emergency-land'.

export function applyContingency(
  state: FlightState,
  droneId: DroneId,
  trigger: ContingencyTrigger,
  action: ContingencyAction,
  targetCoord: GridCoord | null,
  tick: Tick
): FlightState;
// Emits ContingencyTriggered event, updates drone status, emits ConformanceStateChanged to 'contingent'.
```

how to implement:
1. `selectContingencyAction`: pure decision tree using pre-planned procedures from `mission.contingencyVolume.procedures`.
2. `applyContingency`: emit events, return new state via `applyEvent`.
3. Write `test/core/contingency.test.ts`.

acceptance:
- A drone with `lost-link` trigger: action matches its pre-planned lost-link procedure.
- A drone with `low-battery` and enough SOC for RTH: action is `'rth'`.
- A drone with `low-battery` and SOC below RTH cost: action is `'land-nearest'`.
- After `applyContingency`, drone's `conformanceState === 'contingent'` and a `ContingencyTriggered` event is in the log.
- Two identical inputs produce the same action (determinism).

---

**D11 — Telemetry simulator (fixture transport)**
dependsOn: D02, D04, D05
files: `src/core/telemetry.ts`, `test/core/telemetry.test.ts`

interface:
```typescript
// src/core/telemetry.ts
export type TelemetryPolicy = {
  // Pure: given drone state and PRNG stream, produce the next telemetry frame.
  // Adds small integer jitter to position (±1 unit) and SOC (±1) from the PRNG stream.
  simulate(drone: Drone, tick: Tick, stream: PrngStream): { frame: TelemetryFrame; nextStream: PrngStream };
};

export type TelemetryFrame = {
  droneId: DroneId;
  tick: Tick;
  position: GridCoord;
  soc: number;
  linkQuality: number;   // integer 0–100
  payloadStatus: PayloadStatus;
  status: DroneStatus;
};

export function defaultTelemetryPolicy(scenario?: { lostLinkAtTick?: Tick; lostLinkDroneId?: DroneId }): TelemetryPolicy;
// Default: normal telemetry with ±1 integer jitter.
// If scenario provided: force link quality to 0 for lostLinkDroneId after lostLinkAtTick.
```

how to implement:
1. `simulate`: use `nextIntIn(stream, -1, 1)` three times for x/y/alt jitter (integer). SOC: use `nextIntIn(stream, -1, 0)` (drain only, never charge).
2. `defaultTelemetryPolicy`: if the lost-link scenario applies, return `linkQuality: 0` and `status: 'lost-link'` after the trigger tick.
3. Write `test/core/telemetry.test.ts`.

acceptance:
- Two runs with the same seed produce identical telemetry sequences.
- Jitter is within ±1 units of the drone's planned position.
- Lost-link policy: `linkQuality === 0` after the trigger tick for the specified drone.
- SOC decreases each tick (never increases in the fixture).

---

**D12 — CBAA single-task allocation (deterministic)**
dependsOn: D04, D05, D08
files: `src/core/allocation.ts`, `test/core/allocation.test.ts`

interface:
```typescript
// src/core/allocation.ts
export type AllocationTask = {
  taskId: string;
  requiredCoverage: GridCoord[];
  targetCoord: GridCoord;
  priority: number;
};

export type AllocationBid = {
  droneId: DroneId;
  taskId: string;
  score: number;       // higher = better fit
  feasible: boolean;
};

// CBAA: each drone bids on each task. Winner = highest feasible score. Tiebreak = droneId.
export function runCBAA(
  drones: Map<DroneId, Drone>,
  tasks: AllocationTask[],
  missions: Map<MissionId, Mission>,
  geofences: Map<GeofenceId, Geofence>,
  homeCoord: GridCoord,
  wind: WindState
): Map<string, DroneId>; // taskId -> winning droneId (only for feasible assignments)
// Score = 100 - chebyshevDist(drone.position, task.targetCoord) - (100 - drone.soc).
// Sort drones by droneId before iterating (deterministic).
// A drone that is infeasible for a task (per checkFeasibility) has bid score = -Infinity.
```

how to implement:
1. Compute all bids: for each drone (sorted by droneId), for each task, compute score and check feasibility.
2. Per task, choose the drone with the highest feasible score; tiebreak by droneId (lexicographically smallest).
3. Write `test/core/allocation.test.ts`.

acceptance:
- A drone with `soc=5` is never assigned a task requiring `battery-reserve`.
- The nearest feasible drone wins the task.
- Two identical inputs produce identical assignments.
- A task with no feasible drone produces no entry in the result map.

---

**D13 — Survey grid coverage pattern generator**
dependsOn: D03, D04
files: `src/core/patterns.ts`, `test/core/patterns.test.ts`

interface:
```typescript
// src/core/patterns.ts
export type SurveyGridParams = {
  minX: number; maxX: number;
  minY: number; maxY: number;
  altitude: number;    // integer, must be within drone's altBand
  stepSize: number;    // integer, distance between rows (boustrophedon pattern)
};

export function generateSurveyGrid(params: SurveyGridParams): { waypoints: Waypoint[]; coverageObligation: GridCoord[] };
// Boustrophedon (back-and-forth) pattern: rows at y = minY, minY+stepSize, ..., maxY.
// Alternates direction each row (left-to-right, then right-to-left, etc.).
// Deterministic: always starts at minX, row order is minY to maxY.
// Coverage obligation = all integer (x,y) grid cells within the surveyed rectangle at the given altitude.
```

how to implement:
1. Loop over y from minY to maxY step by stepSize.
2. Alternate x direction each row.
3. Each waypoint is `{coord: {x, y, alt: altitude}}`.
4. Coverage obligation = all `{x, y, alt}` cells within the bounding box.
5. Write `test/core/patterns.test.ts`.

acceptance:
- A 3×3 grid (minX=0, maxX=2, minY=0, maxY=2, stepSize=1) produces 9 waypoints covering all cells.
- Waypoints alternate direction each row.
- Two calls with same params produce identical waypoints (determinism).

---

**D14 — Coverage report**
dependsOn: D04, D05, D13
files: `src/core/coverage.ts`, `test/core/coverage.test.ts`

interface:
```typescript
// src/core/coverage.ts
export type CoverageReport = {
  completed: GridCoord[];   // cells confirmed covered (drone conforming + payload active + correct altitude)
  missed: GridCoord[];      // cells in obligation not yet covered
  invalid: GridCoord[];     // cells "covered" while nonconforming or payload off or wrong altitude
};

export function computeCoverage(
  mission: Mission,
  state: FlightState
): CoverageReport;
// Scan event log for CoverageCellCompleted events for this mission.
// A cell is completed only if a CoverageCellCompleted event exists AND the corresponding
// TelemetryFrame at that tick shows payloadStatus='active' AND the drone was 'conforming'.
// Remaining cells from coverageObligation are 'missed'.
// Any cell covered while nonconforming is 'invalid'.
```

how to implement:
1. Scan the event log for `CoverageCellCompleted` events matching this mission's droneId.
2. Cross-reference each with the `TelemetryFrame` at the same tick.
3. Build the three lists.
4. Write `test/core/coverage.test.ts`.

acceptance:
- A mission where the drone flew all cells conforming: `completed.length === coverageObligation.length`, `missed.length === 0`.
- A drone that diverted mid-mission: some cells appear in `missed`.
- A drone that flew a cell nonconforming: cell appears in `invalid`, not `completed`.

---

**D15 — Seed scenario fixture & adversarial fixtures**
dependsOn: D03, D04
files: `test/fixtures/seed-scenario.ts`, `test/fixtures/conflict-fixture.ts`, `test/fixtures/wind-shift-fixture.ts`, `test/fixtures/lost-link-fixture.ts`

interface: TypeScript `const` objects conforming to `MissionScenario`.

how to implement:
1. `seed-scenario.ts`: a 10×10×4-unit grid, 2 drones, a 4×4 survey area, one keep-out geofence (a 2×2 box), one keep-in geofence (the full grid), one external reservation (a fixture OIV that conflicts spatially with a naively-submitted mission), wind = speed 2 from the west, `seed = 77n`.
2. `conflict-fixture.ts`: two drones planning overlapping OIVs at the same ticks (strategic deconfliction must reject one and propose a time-shift).
3. `wind-shift-fixture.ts`: a drone mid-mission when wind speed jumps from 2 to 8 at tick 20 (feasibility check must re-evaluate and trigger RTH).
4. `lost-link-fixture.ts`: a drone that loses link at tick 15 (telemetry linkQuality drops to 0); contingency manager must trigger the pre-planned lost-link procedure.

acceptance: all fixtures compile cleanly as TypeScript.

---

**D16 — Mission flight simulation runner**
dependsOn: D07, D08, D09, D10, D11, D12, D13
files: `src/core/flight.ts`, `test/core/flight.test.ts`

interface:
```typescript
// src/core/flight.ts
export type FlightResult = { stateHash: string; eventLog: FlightEvent[]; coverageReports: Map<MissionId, CoverageReport> };

export function flyMission(
  scenario: MissionScenario,
  maxTicks: number
): FlightResult;
// Main simulation loop per tick:
// 1. Update wind (from scenario — deterministic, no stochastic wind in first slice).
// 2. Collect telemetry frames (from TelemetryPolicy), apply as TelemetryFrame events.
// 3. Monitor conformance (monitorConformance) for each active drone. Emit state change events.
// 4. Check geofence breach risk (any waypoint in next segment inside dynamic keep-out). Emit GeofenceBreachRisk if so.
// 5. Check contingency triggers: lost link (linkQuality=0), low battery (soc<20), geofence-breach-risk event just emitted.
// 6. Apply contingencies (applyContingency) for triggered drones.
// 7. Emit CoverageCellCompleted for any cell the drone flew over while conforming + payload active.
// 8. Advance tick.
```

how to implement:
1. Implement the 8-step tick loop.
2. All state updates via `applyEvent`.
3. Telemetry drives state; never update drone position directly.
4. Write `test/core/flight.test.ts` with the seed scenario.

acceptance:
- `flyMission(seedScenario, 50)` completes without error.
- `hashFlightState` is stable across two runs with the same seed.
- At least one `CoverageCellCompleted` event appears in the log.

---

**D17 — Adversarial fixture tests**
dependsOn: D07, D10, D14, D16, D15
files: `test/integration/adversarial.test.ts`

interface: tests only.

how to implement:
1. **Conflict test**: submit two missions from `conflictFixture`. Check that `DeconflictionResult` is emitted with `passed: false` for the conflicting mission, and a re-submitted version with time-shifted OIV passes.
2. **Wind-shift test**: run `flyMission(windShiftFixture, 60)`. Assert a `ContingencyTriggered` event with trigger `'wind-shift'` and action `'rth'` appears after tick 20.
3. **Lost-link test**: run `flyMission(lostLinkFixture, 40)`. Assert a `ContingencyTriggered` event with trigger `'lost-link'` appears at or after tick 15, and the drone never violates any geofence while contingent.

acceptance: all three tests pass green. `npm test` → green.

---

**D18 — Golden replay + global invariants integration test**
dependsOn: D16–D17
files: `test/integration/golden-replay.test.ts`

interface: tests only.

how to implement:
1. Run `flyMission(seedScenario, 80)` twice.
2. **Pin** `stateHash` and `eventLogHash` as constants.
3. Assert both hashes are identical across runs.
4. Assert invariants:
   a. **Hard-constraint inviolability**: no drone position (from any `TelemetryFrame`) is inside a keep-out geofence. Assert using `pointInBox` for every `TelemetryFrame` event.
   b. **Energy monotonicity**: drone SOC never increases (only decreases or stays same) during flight segments — scan `TelemetryFrame` events and assert each SOC <= prior SOC.
   c. **Conformance correctness**: after any `ConformanceStateChanged` to `'nonconforming'`, a `ContingencyTriggered` or further state change appears within 3 ticks.
   d. **No cleared OIV conflicts**: all OIVs that received a `Cleared` event have no mutual conflicts (check with `detectOIVConflict` over all pairs).
5. Run again from a snapshot taken at tick 40; assert final hash matches.

acceptance: all assertions pass. Pinned hashes are stable. `npm test` → green. Gate for the entire first slice.

---

### 3. The decomposition method for the rest

Use this repeatable recipe to expand remaining features into the same card shape:

**Recipe:**
1. Identify what **new types** the feature needs. Card cluster A (types-only card).
2. Identify what **pure spatial/temporal computation** it adds. Card cluster B (logic card).
3. Identify what **new event types** it emits and how `applyEvent` extends. Card cluster C.
4. Identify what **hard-constraint check** or **invariant** it must satisfy. Card cluster D.
5. Write one offline acceptance test per card before implementing.

**Worked example 1 — Full CBBA multi-task allocation (replacing CBAA, E6):**
- **CB01** (types): Add `DroneBundle = { taskIds: string[]; totalScore: number }` to `src/core/allocation.ts`. acceptance: TypeScript compiles.
- **CB02** (logic): Implement `buildBundle(drone, tasks, geofences, wind): DroneBundle` in `src/core/allocation.ts`. A drone greedily adds tasks to its bundle in order of marginal score gain, respecting feasibility after each addition. acceptance: a drone with soc=80 and 3 tasks can bundle 2 tasks before becoming infeasible; a drone with soc=20 bundles 0 tasks.
- **CB03** (logic + consensus): Implement `runCBBA(drones, tasks, geofences, wind, maxRounds): Map<string, DroneId>`. Each round: every drone builds its bundle; drones compare bundles (in sorted droneId order); conflicts resolved by highest-score bid wins. acceptance: 3 drones, 4 tasks — all tasks assigned, no two drones assigned the same task; identical inputs produce identical assignments.

**Worked example 2 — Dynamic geofence activation mid-mission (E4/E5):**
- **DG01** (types): Add `DynamicGeofenceActivated | DynamicGeofenceDeactivated` to `FlightEvent`. files: `src/core/types.ts`.
- **DG02** (logic): Extend `checkFeasibility` to accept `activeTick: Tick` and reject any waypoint whose arrival tick falls within a dynamic geofence's `activeTicks` window. acceptance: a plan that would arrive at a restricted node during the active window is rejected with `'no-fly-zone'` violation.
- **DG03** (integration): In `flyMission`, at each tick check if any `Geofence` with kind `'dynamic'` is now active (its `activeTicks` range contains the current tick). If so, check conformance immediately and emit `GeofenceBreachRisk` for any in-flight drone whose current segment intersects it. acceptance: the dynamic-geofence adversarial fixture produces a `GeofenceBreachRisk` event at the correct tick, followed by a `ContingencyTriggered`.

**Worked example 3 — Corridor inspection pattern (E6):**
- **CI01** (logic): Implement `generateCorridorInspection(start: GridCoord, end: GridCoord, altitude: number, sideOffsetUnits: number): { waypoints: Waypoint[]; coverageObligation: GridCoord[] }` in `src/core/patterns.ts`. The corridor follows a straight line from start to end, making passes at ±sideOffsetUnits perpendicular to the corridor axis. Tiebreak: when multiple cells have the same distance, process in x-then-y order. acceptance: a 10-unit corridor with sideOffset=1 produces waypoints covering a 3×10 strip; two calls with same params produce identical results.
- **CI02** (integration): Create a corridor-inspection fixture mission and run it through `flyMission`. Assert all corridor cells appear in `CoverageCellCompleted` events when the drone flies conforming. acceptance: `computeCoverage` on the corridor fixture returns `missed.length === 0`.

---

### 4. Per-task implementation conventions

**File/folder layout:**
```
src/
  core/
    prng.ts           # seeded PRNG (D02)
    geo.ts            # integer geospatial primitives (D03)
    types.ts          # domain types (D04)
    state.ts          # flight state init, event fold, hash (D05)
    snapshot.ts       # snapshot/restore (D06)
    deconfliction.ts  # OIV 4D overlap detector (D07)
    feasibility.ts    # flight feasibility engine (D08)
    conformance.ts    # conformance state machine (D09)
    contingency.ts    # contingency manager (D10)
    telemetry.ts      # fixture telemetry simulator (D11)
    allocation.ts     # CBAA/CBBA task allocation (D12)
    patterns.ts       # mission pattern generators (D13)
    coverage.ts       # coverage report (D14)
    flight.ts         # flight simulation runner (D16)
test/
  core/               # unit tests (one file per src/core/ module)
  integration/        # golden-replay.test.ts, adversarial.test.ts
  fixtures/           # TypeScript fixture objects — no file I/O
```

**Naming conventions:**
- Functions that return new state are named `apply*` (never mutate).
- Functions that check constraints are named `check*` and return a result type.
- Pattern generators are named `generate*`.
- Fixture files are TypeScript `const` objects conforming to the domain types.

**Minimal test snippet:**
```typescript
// test/core/deconfliction.test.ts
import { describe, it, expect } from 'vitest';
import { detectOIVConflict } from '../../src/core/deconfliction.js';

describe('OIV deconfliction', () => {
  it('finds conflict when space and time both overlap', () => {
    const a: OIV = { operationId: 'op1', droneId: 'd1', box: {minX:0,maxX:5,minY:0,maxY:5,minAlt:10,maxAlt:20}, startTick: 0, endTick: 10 };
    const b: OIV = { operationId: 'op2', droneId: 'd2', box: {minX:2,maxX:7,minY:2,maxY:7,minAlt:12,maxAlt:18}, startTick: 5, endTick: 15 };
    expect(detectOIVConflict(a, b, 0)).toMatchObject({ conflict: true });
  });
});
```

**Keeping it deterministic — checklist for every card:**
- [ ] No `Math.random()` in `src/core/` — `grep -r 'Math.random' src/core/`
- [ ] No `Date.now()` in `src/core/` — `grep -r 'Date.now' src/core/`
- [ ] All positions are integer grid coordinates — no `number` floats for spatial math.
- [ ] Flight state updates from `TelemetryFrame` events only, not from commands.
- [ ] Feasibility hard-constraint checks run before any deconfliction approval.
- [ ] All collection iteration is sorted before processing.

**Definition of done for any card:**
1. All listed files exist.
2. Exported types/functions match the card's interface exactly.
3. Card's acceptance tests pass green.
4. `npm test` (all tests) passes green.
5. `grep -r 'Math.random\|Date.now' src/core/` returns nothing.

---

### 5. Common pitfalls for a weak model on this project

**Pitfall 1 — Treating waypoints as sufficient for safety**
A 3B will check that each waypoint is outside a no-fly zone but will not check that the **path between waypoints** avoids it. A straight-line segment can clip a geofence corner.
Fix: `checkFeasibility` must check all waypoints AND check that the interpolated segment between consecutive waypoints doesn't cross a keep-out box. Use `boxesOverlap3D` on the bounding box of each segment against each geofence. The adversarial fixture includes a geofence that a waypoint-only check would miss.

**Pitfall 2 — Using floats for spatial math**
A 3B will compute distances with `Math.sqrt(dx*dx + dy*dy)` or angles with `Math.atan2`. These are float operations and diverge across platforms.
Fix: Use `euclideanSq` (integer) for distance-squared comparisons, and `chebyshevDist` for range checks. For separation checks, use axis-aligned bounding boxes with integer comparisons only. The golden-replay test will catch float-induced divergence because the state hash will differ across runs.

**Pitfall 3 — Flight state updating from commands instead of telemetry**
A 3B will set `drone.position = mission.waypoints[nextIdx].coord` when a waypoint command is dispatched, then a lost-link or wind-shift diverges from reality.
Fix: `drone.position` only updates when a `TelemetryFrame` event is applied by `applyEvent`. The lost-link adversarial test verifies that a drone with `linkQuality=0` is detected via telemetry, not assumed to be at its commanded position.

**Pitfall 4 — OIV conflict check skipping the external-USS feed**
A 3B implements `checkAgainstAll` but only checks internal reservations, missing the fixture `externalReservations`. The test will show a cleared mission that conflicts with the external reservation.
Fix: `checkAgainstAll` checks `externalReservations` first (sorted by operationId), then internal. The adversarial conflict test (D17) submits a mission that overlaps only an external reservation.

**Pitfall 5 — Battery reserve computed without the RTH leg**
A 3B sums segment costs and checks `soc > reserveSocPercent`, ignoring the cost of flying back to the home coord. A plan that exactly uses up the reserve while far from home will succeed the feasibility check but strand the drone.
Fix: `checkFeasibility` computes the RTH segment cost from the last waypoint to `homeCoord` and adds it to the total before comparing against reserve. The feasibility test includes a case where the plan is feasible without RTH but infeasible with it.

**Pitfall 6 — Conformance state machine bypassed mid-mission**
A 3B monitors conformance only at the start and end of a mission, missing deviations that happen during flight.
Fix: `monitorConformance` is called every tick in `flyMission`. The adversarial wind-shift test verifies that a deviation that starts at tick 20 produces a `ConformanceStateChanged` event at or before tick 21.

**Pitfall 7 — CBAA producing different assignments on re-run due to Map iteration**
A 3B computes bids by iterating `drones.values()` without sorting, producing different assignment orders on different runs.
Fix: Sort drones by `droneId` before iterating in `runCBAA`. The allocation test asserts identical assignments across two identical calls.

**Pitfall 8 — Contingency action not pre-planned (and thus undefined)**
A 3B implements `selectContingencyAction` but the mission fixture's `contingencyVolume.procedures` array is empty, so the function returns `undefined` for a lost-link trigger and the simulation crashes.
Fix: `generateSurveyGrid` (and all pattern generators) must also produce a `ContingencyVolume` with default procedures for every trigger type. The fixture scenario includes pre-planned procedures for all five trigger kinds. If `procedures` is empty for a trigger, fall back to `'emergency-land'` (the safest default), never `undefined`.

**Pitfall 9 — `hashFlightState` missing OIV serialization**
A 3B serializes `state.reservations` as `{}` because it is a `Map<OperationId, OIV>`. Two states with different reservations hash to the same value.
Fix: Convert every `Map` to a sorted `[key, value][]` array before stringifying. The snapshot test (D06) will catch this because `restoreSnapshot(takeSnapshot(state))` will produce a different hash.

**Pitfall 10 — Wind penalty computed using float division**
A 3B writes `windPenalty = windSpeed / 3.7 * segmentCost`, using decimal constants and float arithmetic for energy estimation.
Fix: All coefficients must be integer constants. Use integer division: `windPenalty = Math.floor((windSpeed * segmentCost) / 10)`. The `Math.floor` of an integer expression is deterministic. The golden-replay test will catch any float-induced divergence.
