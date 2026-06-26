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
