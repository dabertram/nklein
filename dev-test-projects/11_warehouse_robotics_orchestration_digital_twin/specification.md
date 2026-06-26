# 11 - Warehouse Robotics Orchestration and Digital Twin Platform

Complexity tier: 11/20
Expected decomposition size: 32-36 dependent implementation cards before coding.
Domain pressure: robotics orchestration, warehouse management, task allocation, traffic control, digital twin, safety zones, inventory movement.
Acceptance command: npm test

## How to use this challenge
This is a dev-test project specification for evaluating whether an autonomous coding agent can decompose a real domain, identify knowledge gaps, build a correct foundation, and verify it with deterministic tests. The goal is not to finish the entire product. The goal is to build a durable foundation that proves the agent understood the domain boundaries and can implement the highest-risk core behaviors without hiding behind placeholders.

The agent must read this entire specification before planning. It must create a dependency-linked plan, record domain knowledge debt, and choose a narrow release slice that still exercises the real hard parts. Prefer fewer production-quality vertical slices over many shallow labels.

## Product vision
Build a warehouse robotics control foundation for autonomous mobile robots moving inventory between pick, pack, storage, and replenishment areas. The product must coordinate tasks, traffic, safety, and inventory truth without assuming perfect robots.

## Foundation release scope
The first serious buildout must include:
- Warehouse map, node, aisle, zone, robot, charger, tote, SKU, order, pick task, move task, reservation, obstacle, and incident models.
- Task allocation engine that assigns robots based on location, battery, payload, priority, zone permissions, order wave, and charger availability.
- Traffic manager with path reservations, one-way aisles, intersection locks, deadlock detection, and replanning.
- Digital twin simulation that replays robot telemetry, task state, inventory movement, and exception events.
- Inventory movement ledger connecting physical totes, SKU quantities, source/destination, scan evidence, and exception correction.
- Safety-zone policy for human-only areas, maintenance lockout, emergency stop, speed-limited zones, and blocked aisles.
- Battery and charger scheduler with queueing, opportunity charging, and degraded robot behavior.
- Seed scenario with rush orders, blocked aisle, low-battery robot, lost tote, and deadlock-prone crossing.

## Architecture requirements
- Separate world model, planner, traffic reservations, inventory ledger, and telemetry ingestion.
- Make path planning deterministic over map fixtures and reservation timelines.
- Use command acknowledgement and telemetry as separate truths; robots may reject or fail commands.
- Keep safety policy central and unskippable.

## Domain knowledge debt to surface
The agent should not pretend to know every regulation, standard, or numerical model perfectly. It should implement a defensible deterministic subset, mark assumptions explicitly, and create extension points where real-world integrations or expert-reviewed rule packs would live. Required knowledge areas:
- Warehouse orchestration is a multi-agent planning problem with physical constraints.
- Inventory accuracy depends on evidence, not robot intent.
- Deadlock and livelock need explicit detection and recovery.
- Safety zones override throughput optimization.

## Decomposition pressure
This project should force decomposition across domain modeling, calculation or policy engines, workflow state, deterministic fixtures, auditability, and UI/view-model boundaries. The plan should include dependency links so shared primitives and invariants are built before dependent workflow features. Avoid starting with screens. Start with the domain model, invariants, and tests that would make later screens trustworthy.

The agent should maintain a visible knowledge-debt list covering unclear standards, units, legal or safety constraints, numerical assumptions, terminology, fixture limitations, and future expert-review checkpoints. Knowledge debt is not a failure; hiding it is.

## Acceptance criteria
- Task allocation changes when battery, blocked aisles, or priority changes.
- Traffic tests detect and resolve reservation conflicts and deadlocks.
- Inventory ledger remains balanced through tote moves and corrections.
- Simulation replay reproduces world state from telemetry fixtures.
- The project passes npm test without robot hardware.

## Explicit non-goals
- Do not model robots as instant task-completing workers.
- Do not let inventory mutate without movement evidence.
- Do not bury safety constraints in UI-only warnings.

## Quality bar
- Use typed domain objects and pure core modules wherever practical.
- Keep deterministic fixtures in the repository and do not depend on live APIs for acceptance tests.
- Test edge cases before building broad UI coverage.
- Every risk score, recommendation, workflow transition, or generated report must be explainable from source facts.
- Stubs are acceptable only at external integration boundaries and must be named as adapters with deterministic fixture implementations.
- The foundation should be extensible into a real product if later teams add integrations, expert-reviewed rule packs, and production UI.

---

# Extended scope & deep-reasoning extensions (v2)

> Added 2026-06-26 via deep domain research. The single hardest, most-defining property of this project is **a deterministic, replayable multi-agent orchestration core in which physical reality and intent are two separate, reconcilable truths**: robots reject, delay, and fail commands; inventory only moves on *evidence*, not on plan; and safety is a hard constraint that pre-empts throughput — all of it reproducible bit-for-bit from a seeded telemetry/event log so a deadlock, a lost tote, or a near-miss can be replayed and proven-resolved without a single robot or live WMS.

## E0. The meta-test: why determinism + the intent/reality split is the whole challenge

A warehouse control system is easy to fake (instant-teleport robots, inventory that mutates on command) and brutal to make *correct*, because every hard problem lives in the gap between **what the planner intended** and **what physically happened**. The base spec already names the spine — "warehouse orchestration is a multi-agent planning problem with physical constraints," "inventory accuracy depends on evidence, not robot intent," "deadlock and livelock need explicit detection and recovery," "safety zones override throughput optimization." The disciplined version makes the *entire warehouse a deterministic, event-sourced simulation* during tests, the way modern infrastructure is tested: a single-threaded discrete-event simulator driven by a seeded PRNG, where "replay the exact failure from a seed" is a capability and "simulate a full shift in milliseconds" is the unit test (https://antithesis.com/docs/resources/deterministic_simulation_testing/, https://pierrezemb.fr/posts/diving-into-foundationdb-simulation/). The grading rubric is therefore:

1. **Determinism / digital-twin fidelity** — does replaying a seeded telemetry+command log reproduce world state bit-for-bit (the base spec's "simulation replay reproduces world state from telemetry fixtures")?
2. **Conservation of inventory** — is every SKU/tote movement a balanced, evidence-backed transfer such that totals are invariant (the warehouse analogue of double-entry accounting)?
3. **Safety supremacy** — can you *prove* no robot ever violated a protective field, a human-only zone, a lockout, or an e-stop, with safety pre-empting every throughput decision?
4. **Liveness** — are deadlock and livelock **detected and recovered**, never silently wedged, under adversarial maps?

Everything below serves those four.

## E1. The deterministic simulation / digital-twin kernel (the foundation under the foundation)

Build this before allocation, traffic, or inventory. First ~6–8 cards.

- **Virtual clock + fixed tick.** No `Date.now()`/`setTimeout` in core. Time is an integer tick advanced explicitly. Battery drain, charge rate, travel time, reservation windows, command timeouts, and degraded-robot slowdowns all read the virtual clock. Tests fast-forward a shift in milliseconds; production wires the clock to wall time.
- **Seeded entropy, split by purpose.** Every stochastic element — telemetry jitter, command-failure/rejection draws, pick-scan mismatch injection, robot fault timing — draws from a single seeded PRNG split into per-system substreams, so a run is reproducible from `(seed, scenario)` and adding a consumer can't shift another's sequence (https://pierrezemb.fr/posts/diving-into-foundationdb-simulation/).
- **Event-sourced world state = the digital twin.** The authoritative state (robot poses, battery SOC, tote locations, task states, reservations, incidents) is a **fold over an append-only event log**: `TaskAssigned`, `MoveCommanded`, `CommandAcked`, `CommandRejected`, `TelemetryFrame`, `ReservationGranted`, `ToteScanned`, `InventoryAdjusted`, `SafetyStop`, `IncidentRaised`. State is a *projection*; the log is truth. This is precisely what a warehouse digital twin is — a real-time-aligned model reconciled from telemetry into "a single piece of truth" (https://www.roboticstomorrow.com/article/2025/05/how-to-achieve-the-full-benefits-of-a-warehouse-digital-twin/24734) — and it gives free replay, audit, and crash recovery.
- **The replay/time-machine harness.** `runShift(scenario, seed) -> { worldHash, eventLog }` runs a whole shift headless, snapshots at any tick, kills and restores from durable state, and asserts invariants throughout. **The flagship test is a deterministic shift replay whose final world-state hash and event-log hash are pinned and asserted identical across runs** — this is the base spec's "simulation replay reproduces world state from telemetry fixtures," made byte-exact.
- **Deterministic ordering.** Robots, tasks, reservations, and conflicts resolve in stable, explicitly-sorted order (by id with deterministic tiebreaks), never hash-map iteration order — the classic silent-nondeterminism source in multi-agent loops.

## E2. The command/telemetry duality — intent vs. reality as separate truths (the realism spine)

The base spec's sharpest demand: "use command acknowledgement and telemetry as separate truths; robots may reject or fail commands." Model this as an explicit, industry-grounded protocol, not optimistic mutation.

- **Adopt the VDA 5050 mental model.** VDA 5050 is the real, vendor-neutral interface between a fleet master-control and AMRs/AGVs: JSON over MQTT, where an **order** is "a sequence of *nodes* and *edges* with stored *actions* (stop, pick load, release load, wait)," the vehicle **reports back its state**, and master-control coordinates (https://navitecsystems.com/what-is-vda-5050/, https://www.innok-robotics.de/en/news/vda-5050-standardisierte-schnittstelle-f%C3%BCr-fts-amr-und-leitsteuerung, https://www.hivemq.com/resources/architectural-proposal-for-the-vda5050/). Mirror this: orders decompose into node/edge/action sequences; a deterministic **fixture transport** (replacing the MQTT broker) delivers them; robots emit **state messages** (position, battery, action status, errors) that are the *only* thing the twin believes about physical reality.
- **Commands are proposals; telemetry is truth.** The planner *commands* a move; the robot may **ack, reject (zone permission, battery, fault), execute slowly, deviate, or fail mid-edge**. World state updates from telemetry/state messages, never from the command. A `Reservation` is held against *intent* but only *released* on telemetry-confirmed clearance.
- **Reconciliation, not assumption.** When telemetry diverges from intent (robot stalled on an edge, off its node, battery dropping faster than modeled), the twin raises a **conformance/deviation event** and the planner replans — it never assumes the command succeeded. Automated reconciliation of expected-vs-actual is exactly what real twins do ("reconcile inconsistent units, correct timestamp drift" before they propagate — https://acropolium.com/blog/digital-twins-warehouse-line/).

## E3. MAPF: the multi-agent traffic core (the planning spine)

"Warehouse orchestration is a multi-agent planning problem" — implement it as real **Multi-Agent Path Finding**, the field that powers Kiva/Amazon Robotics fulfillment (https://www.ri.cmu.edu/publications/lifelong-multi-agent-path-finding-in-large-scale-warehouses/).

- **Time-expanded reservations + explicit conflict types.** Plan over a **time-expanded graph**; detect and resolve the canonical MAPF conflicts — **vertex conflicts** (two robots at the same node at the same tick), **edge/swap conflicts** (two robots traversing the same edge in opposite directions), and **following conflicts** — via a reservation table keyed by (node/edge, time) (https://arxiv.org/pdf/2501.17661, https://arxiv.org/html/2501.17661v1).
- **Conflict-Based Search (CBS), with a bounded-suboptimal fallback.** CBS is the standard: a **two-level search** where the low level plans each robot individually and the high level resolves conflicts by adding constraints and replanning the affected robot, yielding complete, optimal solutions (https://www.researchgate.net/publication/278400742_Conflict-based_search_for_optimal_multi-agent_pathfinding). For scale, provide **ECBS / bounded-suboptimal** behavior (warehouse evaluations run CBS-family planners on ~10 concurrent agents with zero collisions, 98% success — https://arxiv.org/pdf/2501.17661) and a **prioritized-planning** fallback (plan robots in priority order against prior reservations) for the cheap, fast path.
- **Lifelong, windowed operation (RHCR) — and its known failure.** Real fulfillment is **lifelong MAPF**: robots are continuously assigned new goals, so plan in a **rolling horizon** — "decompose into a sequence of Windowed MAPF instances; the solver resolves collisions only within a bounded time horizon and ignores collisions beyond it" (RHCR — https://arxiv.org/pdf/2005.07371). Crucially, the spec must encode RHCR's **documented weakness**: windowed solvers are *theoretically incomplete* and "in practice get stuck in deadlock (agents waiting for each other) or livelock (agents revisiting the same locations) as the horizon leads to myopic behavior" (https://arxiv.org/pdf/2005.07371). That is *exactly* the hard part the base spec demands you detect and recover from — so make the deadlock/livelock detector (E4) a first-class, tested subsystem, not an afterthought.
- **Zone control & one-way aisles.** Support zone-control / private-zone schemes and one-way aisle topologies (real AGV deadlock-avoidance practice — https://www.semanticscholar.org/paper/Event-based-controller-to-avoid-deadlock-and-in-Fanti/199c052955798ccf0bc9826025087cae668a8aea), with intersection locks as single-occupancy reservations.

## E4. The deadlock & livelock detector/resolver (the liveness spine)

"Deadlock and livelock need explicit detection and recovery" (base spec). This is where most fake versions collapse.

- **Deadlock = a cycle in the wait-for graph.** Maintain a **resource wait-for graph** (robot → the reservation/robot it's blocked on). A directed **cycle is a deadlock** (the classic head-on / 4-way-crossing standoff). Detect every tick; this is the standard digraph-model approach to AGVS deadlock (https://www.sciencedirect.com/science/article/abs/pii/S156849462400499X, https://www.researchgate.net/publication/371019271_Hierarchical_Traffic_Management_of_Multi-AGV_Systems_With_Deadlock_Prevention_Applied_to_Industrial_Environments).
- **Livelock = bounded-progress violation.** Detect robots that move but make **no goal progress over a window** (oscillating, repeatedly yielding) — RHCR's "agents revisiting the same locations" (https://arxiv.org/pdf/2005.07371). A monotone "distance-to-goal must decrease within N ticks or escalate" watchdog.
- **Recovery ladder, deterministic and audited:** (1) priority-based yield (lower-priority robot backs off to a holding node), (2) targeted replan of the cycle members, (3) reservation rollback + re-auction, (4) escalate to a human/incident if unresolved within a bound. Every step is an event; the resolution is replayable and provably terminates.
- **Test:** the seed scenario's "deadlock-prone crossing" must be **injected, detected, and resolved** with the world reaching all goals, and a property test asserts **no run ends wedged** (every task eventually completes or is escalated).

## E5. The inventory ledger — conservation by construction (the truth spine)

"Inventory accuracy depends on evidence, not robot intent"; "do not let inventory mutate without movement evidence" (base spec). Model inventory as a **double-entry ledger**, the 800-year-old correctness discipline (https://www.odoo.com/blog/business-hacks-1/improve-supply-chain-and-inventory-management-183).

- **Every move is a balanced transfer.** A tote/SKU quantity leaving location X and arriving at location Y is **one event with a matching debit/credit** between locations; "the sums of the two accounts must have the same value — you can't give more than you receive; if it doesn't match, there's an error" (https://www.odoo.com/blog/business-hacks-1/improve-supply-chain-and-inventory-management-183). Locations include a **`discrepancy`/`lost` account** so an imbalance is *recorded*, never hidden.
- **Evidence-gated mutation.** Inventory only changes on **scan evidence** (pick scan, putaway scan, tote-id read) carried in the event — analogous to WMS scan-based flows that reach 95–99% accuracy through scan verification (https://packemwms.com/what-is-a-warehouse-management-software/). A commanded pick that the robot didn't scan-confirm does **not** decrement stock; it raises an **exception** (the seed scenario's "lost tote").
- **Cycle-count / reconciliation as compensating entries.** Corrections are **adjustment events posted against the discrepancy account** with provenance (who/what/why), never silent overwrites — exactly the base spec's "exception correction."
- **Conservation invariant (load-bearing property test):** across any shift, **Σ(quantity across all locations including discrepancy) is invariant** except at audited receiving/shipping boundaries; every quantity change has a matching balanced counter-entry and a scan-evidence reference. This is the warehouse twin of "conservation of money."

## E6. The safety kernel — central, unskippable, supreme (the safety spine)

"Keep safety policy central and unskippable"; "safety zones override throughput optimization"; "do not bury safety constraints in UI-only warnings" (base spec). Ground it in the real standard.

- **ISO 3691-4 is the governing standard** for driverless industrial trucks (AGV/AMR) (https://www.iso.org/standard/83545.html, https://blog.ansi.org/ansi/iso-3691-4-2023-driverless-industrial-trucks/). Encode its core duties as hard, central constraints:
  - **Personnel detection that pre-empts motion.** A robot must detect people across the **full width of the truck and its load in the direction of travel** and brake to a stop within the detection range; braking must engage automatically on loss of speed/steering control or power (https://blog.ansi.org/ansi/iso-3691-4-2023-driverless-industrial-trucks/).
  - **Warning field vs protective field (speed-dependent).** Model the safety-laser-scanner field model: an outer **warning field** triggers deceleration; an inner **protective field** triggers a **safety-rated stop**; field size **switches with speed** (faster ⇒ larger protective field ⇒ longer stopping distance), per real scanners that do speed-dependent field switching via encoder input (https://www.sick.com/us/en/the-perfect-size-of-the-protective-field-on-an-industrial-autonomous-vehicle/w/blog-size-protective-field-industrial-autonomous-vehicle). Such safety functions are typically **PLd (EN ISO 13849) / SIL2 (IEC 62061)** and the scanner is a Type 3 device under EN 61496-1 (https://www.digikey.com/en/articles/how-miniature-safety-laser-scanners-can-maximize).
  - **Zone policy:** human-only zones (no robot entry), speed-limited zones (safety-rated reduced speed), maintenance lockout/tagout (zone quarantine), blocked aisles, and **emergency stop** (fleet/zone/robot scope).
- **Safety pre-empts the planner, structurally.** Safety state is evaluated **before** any allocation/traffic decision can execute; a protective-field intrusion or e-stop **cannot be optimized away** by throughput logic. Encode this as a hard gate the planner cannot bypass, not a warning surfaced in UI.
- **Test:** property — **for every tick of every run, no robot occupies a human-only zone, exceeds a zone's safety-rated speed, moves under lockout, or fails to safety-stop on a protective-field intrusion.** A throughput-vs-safety conflict fixture must resolve in safety's favor every time.

## E7. Task allocation & battery/charge economics (the assignment spine)

"Task allocation engine that assigns robots based on location, battery, payload, priority, zone permissions, order wave, and charger availability"; "battery and charger scheduler with queueing, opportunity charging, and degraded robot behavior" (base spec).

- **Deterministic allocation with explicit, explainable scoring.** Assignment is a pure function of state: cost = travel time + battery-feasibility (can it finish *and* reach a charger on remaining SOC) + payload fit + zone permission + priority/wave + congestion estimate. Every assignment is **explainable from these factors** (an acceptance criterion) and changes when "battery, blocked aisles, or priority changes" (explicit acceptance test). Auction/bid-style allocation is the standard framing (robots bid on tasks by cost) and composes naturally with MAPF.
- **Battery model as a hard feasibility constraint.** SOC drains per tick by activity (move/lift/idle); a task is infeasible if it can't complete with a **reserve margin to reach a charger**. Support **opportunity charging** (top-ups during idle windows), **charger queueing** (single-occupancy charger reservations), and **degraded behavior** (a low/aging-battery robot moves slower, takes lighter loads, or is pulled from service) — all deterministic.
- **Test:** allocation flips correctly when the seed scenario's **low-battery robot** can no longer feasibly serve a rush order, and the charger scheduler queues it without deadlocking the charging area.

## E8. The adversarial / failure fixture pack (red-team as a first-class test asset)

Ship the warehouse's hostility in the repo as deterministic fixtures the system must survive — the seed scenario's "rush orders, blocked aisle, low-battery robot, lost tote, deadlock-prone crossing," each made concrete and testable:

- A **head-on deadlock** at a 4-way crossing and a **livelock** of two mutually-yielding robots (E4 must detect + resolve).
- A **blocked aisle** mid-shift (dynamic obstacle) forcing fleet-wide replanning around a now-invalid reservation set.
- A **lost/mis-scanned tote** (commanded pick with no confirming scan) that must become an inventory **exception**, not a silent decrement (E5).
- A **command-rejecting / stalling robot** (rejects on zone permission; stalls mid-edge; battery drops faster than modeled) that the twin must reconcile from telemetry, not assume succeeded (E2).
- A **human entering a protective field** and an **e-stop** that must pre-empt all throughput (E6).
- A **charger contention** burst where multiple low-battery robots converge (E7) without wedging the charging zone.
- The system must, deterministically, for each: **detect, raise the correct incident/exception event, recover (or safely escalate), and continue** — and the replay must reproduce it exactly.

## E9. Global invariants (property-based, this is how the platform is graded)

Beyond example tests, assert **system-wide invariants** across randomized + scripted shifts (https://antithesis.com/docs/resources/property_based_testing/):

1. **Determinism / twin fidelity** — `runShift(scenario, seed)` twice yields **identical** world-state and event-log hashes; snapshot+restore mid-shift changes nothing.
2. **Conservation of inventory** (E5) — SKU/tote totals invariant except at audited receiving/shipping; every change balanced + scan-evidenced.
3. **Safety supremacy** (E6) — no protective-field intrusion without a safety stop; no robot in a human-only/lockout zone; no over-speed in a limited zone; *for every tick*.
4. **No collisions** — no two robots share a vertex/edge at the same tick (reservation correctness, E3).
5. **Liveness / no wedge** (E4) — every task eventually completes or is escalated; no run ends in undetected deadlock/livelock.
6. **Intent/reality separation** (E2) — world state is a function of *telemetry*, never of un-acked commands; every divergence raises a reconciliation event.
7. **Totality of audit** — every external-classified action (command issued, reservation, scan, adjustment, safety stop, incident) has exactly one ordered audit event; reports are reconstructable from the log alone.

Plus a **chaos mode**: inject robot faults, dropped/late telemetry, corrupted-snapshot recovery, stale-lock cleanup, and a blocked aisle mid-plan, and assert all invariants still hold.

## E10. The concrete first vertical slice (the on-ramp — build THIS first, ~16–20 of the 32–36 cards)

Do **not** spread the first slice across all panels. Prove the spine end-to-end on a small map:

- The **deterministic twin kernel** (E1): virtual clock, seeded split-PRNG, event log, snapshot/restore, world-state hashing, replay harness.
- The **command/telemetry duality** (E2) over a fixture VDA-5050-style transport: orders as node/edge/action sequences, robots that ack/reject/stall, world state driven only by telemetry.
- A **small map (a few aisles, one crossing, one charger, one human-only zone)** with **3–4 robots**.
- **MAPF with reservations + CBS-or-prioritized planning** (E3) and the **deadlock/livelock detector + recovery** (E4), proven on the deadlock-prone crossing.
- The **double-entry inventory ledger** (E5) with one pick→putaway flow and the **lost-tote exception**.
- The **safety kernel** (E6) with the protective-field stop and human-only-zone enforcement, proven supreme over a rush-order throughput push.
- **Task allocation + battery/charger** (E7) with the low-battery reallocation.
- The **replay golden test + global invariants** (E9) and at least **three adversarial fixtures** (E8: deadlock, lost tote, protective-field intrusion) green on this slice.

If that slice is deterministic, conservative, safe, and live, every later panel is breadth on a proven spine.

## E11. Domain knowledge-debt to track (surface, don't bluff)

- **Safety certification is real and out of scope to *claim*.** ISO 3691-4 / EN ISO 13849 PLd / IEC 62061 SIL2 conformance is an **expert-reviewed, certified** activity (https://www.iso.org/standard/83545.html, https://www.digikey.com/en/articles/how-miniature-safety-laser-scanners-can-maximize). The simulation models the *logic* of protective fields and safety-rated stops; it must **not** imply real-world safety certification. Flag stopping-distance/field-size numbers as fixtures needing safety-engineer review.
- **MAPF optimality vs scale tradeoff.** CBS is optimal but exponential in conflicts; windowed/lifelong (RHCR) and bounded-suboptimal (ECBS) trade optimality for scale and reintroduce incompleteness ⇒ deadlock/livelock risk (https://arxiv.org/pdf/2005.07371). Record which regime the slice targets and the agent-count ceiling it's validated to.
- **Telemetry/localization uncertainty.** Real robots have position error, drift, and timestamp skew that twins must reconcile (https://acropolium.com/blog/digital-twins-warehouse-line/); the fixture twin models clean discretized telemetry and should mark continuous-space localization, sensor noise, and clock-sync as future expert-review items.
- **VDA 5050 is an interface, not a planner.** It standardizes order/state messaging (https://navitecsystems.com/what-is-vda-5050/) but leaves traffic management and allocation to the master-control — record which parts are modeled vs. stubbed as adapters.
- **WMS/ERP integration boundary.** Inventory truth in production reconciles against a WMS/ERP and physical cycle counts (https://www.roboticstomorrow.com/article/2025/05/how-to-achieve-the-full-benefits-of-a-warehouse-digital-twin/24734); the ledger is the foundation, but the system-of-record sync is an external adapter to flag.

## E12. Why this is a great !Klein challenge

This is a **multi-agent determinism-and-safety crucible** that punishes exactly the shortcuts a small local model takes by default: it will want robots to teleport, inventory to mutate on command, and "safety" to be a warning string — and here each of those turns a test red. The real value is "can good decomposition + invariant tests + a central safety kernel make a *fallible* model produce a **deterministic, conservative, provably-safe, deadlock-free** orchestrator." It stresses multi-agent coordination (MAPF/CBS, reservations), the intent-vs-reality discipline (command/telemetry duality, VDA 5050), conservation reasoning (double-entry inventory), liveness under adversarial maps (deadlock/livelock detection), and safety supremacy as a structural gate — all replayable from a seed so a deadlock or a near-miss is a reproducible test, not a field incident. The reward is legible and satisfying: a headless shift that replays bit-for-bit, an inventory ledger that *cannot* go unbalanced, a crossing that deadlocks and then provably un-wedges, and a protective-field stop that no throughput pressure can override. **Build the twin kernel + command/telemetry duality + safety kernel + conservation ledger (E1, E2, E5, E6, E9) first; earn the rest.**

---

## Small-model build guide (3B-ready)

> This section is the mechanical on-ramp. A 3B model reading this must be able to follow it card-by-card without needing to be clever. Every card is independently implementable and verifiable. Read E1–E12 above first; this section operationalizes them.

---

### 1. Glossary & ground rules

**Domain terms:**
- **Tick** — integer logical time unit; the only time the simulation knows. Never use `Date.now()`, `performance.now()`, or `setTimeout` in any core module.
- **Robot** — an autonomous mobile robot (AMR). It has a position (node), battery state-of-charge (SOC, integer 0–100), and a payload capacity.
- **Node** — a discrete location in the warehouse map (think intersection or bay). Robots move from node to node along edges.
- **Edge** — a directed connection between two nodes with a traversal cost (integer ticks). One-way aisles are modeled as edges in one direction only.
- **Reservation** — a claim that robot R will occupy node N (or traverse edge E) during tick range [t_start, t_end]. The reservation table is the global concurrency lock.
- **Event log** — append-only array of typed events. World state is a fold over the log. The log is truth; the projected world state is a derived view.
- **WorldState** — the fold of the event log: robot positions, SOC, task states, tote locations, reservations, incidents, safety state.
- **Telemetry frame** — a message from a robot reporting its current position, SOC, action status, and errors. World state updates from telemetry, not from commands.
- **VDA-5050-style order** — an order decomposed into a sequence of nodes and edges the robot must traverse, plus stored actions at each node (pick, drop, wait). Used as the command model (fixture transport, no MQTT needed in tests).
- **Command ack** — a robot's acknowledgement that it received and accepted an order. A command may be rejected (zone permission, low battery, fault).
- **Reservation table** — a data structure keyed by `(node/edge, tick)` → `robotId | null`. Used by the MAPF planner to check and claim slots.
- **CBS (Conflict-Based Search)** — a MAPF algorithm: plan each robot individually, then detect and resolve pairwise conflicts by adding constraints and replanning. Used for correctness on small maps.
- **Prioritized planning** — faster MAPF fallback: plan robots in priority order, each respecting prior reservations.
- **Deadlock** — a cycle in the resource wait-for graph: robot A waits for a node held by robot B, which waits for a node held by robot A (or a chain thereof).
- **Livelock** — robots move but make no progress toward their goals (oscillating, mutually yielding).
- **Double-entry ledger** — every SKU/tote quantity change is a balanced transfer: a debit from one location and a matching credit to another. The sum across all locations (including a `discrepancy` account) is invariant.
- **Scan evidence** — a `ToteScanned` event with a tote ID and location. Inventory only changes when scan evidence is present in the event log.
- **Safety field** — a virtual zone around a robot: outer warning field (triggers deceleration), inner protective field (triggers safety-rated stop). Size scales with speed.
- **E-stop** — emergency stop: a command or detection event that halts all robots in a zone or fleet-wide. Pre-empts all throughput decisions.

**Stack:**
- Language: TypeScript (strict mode, `noImplicitAny: true`)
- Runtime: Node.js (no browser globals in core)
- Test runner: `npm test` runs all tests (e.g. Vitest or Jest — use whichever is in `package.json`)
- No external planning libraries — CBS and Dijkstra are implemented from scratch
- No network, no hardware I/O in tests — fixture maps, robots, and telemetry sequences are TypeScript objects in `test/fixtures/`

**Ground rules (repeat these to yourself before every card):**
1. Never use `Math.random()` in `src/core/` — use the seeded PRNG from `src/core/prng.ts` only.
2. Never use `Date.now()` or wall-clock time in core.
3. World state never updates from a command — only from telemetry/state messages in the event log.
4. Inventory never changes without a `ToteScanned` event in the same transaction.
5. Safety checks run before any allocation or traffic decision; they cannot be bypassed.
6. Every acceptance test runs offline. No network, no robot hardware.
7. The acceptance command is `npm test`. It must pass green before a card is done.

---

### 2. The explicit task graph for the first vertical slice

The first vertical slice covers E1–E7, E9 from the v2 section. It has **17 cards** (W01–W17). Build them in order; each depends only on prior cards.

---

**W01 — Project scaffold & TypeScript config**
dependsOn: none
files: `package.json`, `tsconfig.json`, `src/core/.gitkeep`, `test/.gitkeep`

interface: none (configuration only)

how to implement:
1. Create `package.json` with `"type": "module"`, a `"test"` script that runs Vitest (`vitest run`), and dev dependencies: `vitest`, `typescript`.
2. Create `tsconfig.json` with `"strict": true`, `"noImplicitAny": true`, `"target": "ES2022"`, `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`.
3. Create placeholder directories.

acceptance: `npm test` runs and exits 0 with "no test files found" (or equivalent). No TypeScript errors.

---

**W02 — Seeded split-PRNG**
dependsOn: W01
files: `src/core/prng.ts`, `test/core/prng.test.ts`

interface:
```typescript
// src/core/prng.ts
export type PrngState = { s0: bigint; s1: bigint };
export type PrngStream = { state: PrngState; streamId: number };

export function createPrng(seed: bigint): PrngState;
export function splitStream(root: PrngState, streamId: number): PrngStream;
// Pure: returns next value and next stream state.
export function nextUint32(stream: PrngStream): { value: number; next: PrngStream };
export function nextIntBelow(stream: PrngStream, max: number): { value: number; next: PrngStream };
export function nextFloat01(stream: PrngStream): { value: number; next: PrngStream };
// nextFloat01 is ONLY for display/logging, never for engine decisions that affect state.
```

how to implement:
1. Implement SplitMix64 in bigints (standard mixing constants).
2. `splitStream`: derive a new state by seeding from `root.s0 ^ BigInt(streamId)`.
3. All functions are pure (return next state, never mutate).
4. Write `test/core/prng.test.ts`.

acceptance:
- Two calls to `createPrng(99n)` produce identical states.
- `nextUint32` called 50 times on the same stream produces the same sequence every run.
- `splitStream(root, 1)` and `splitStream(root, 2)` produce different sequences.

---

**W03 — Core domain types**
dependsOn: W01
files: `src/core/types.ts`

interface:
```typescript
// src/core/types.ts
export type Tick = number;         // integer, never fractional
export type RobotId = string;
export type NodeId = string;
export type EdgeId = string;       // "${fromNodeId}->${toNodeId}"
export type ToteId = string;
export type SkuId = string;
export type LocationId = string;   // node id or a named location ('discrepancy', 'shipping', 'receiving')
export type ZoneId = string;
export type TaskId = string;

export type NodeKind = 'aisle' | 'intersection' | 'pick-station' | 'pack-station' | 'charger' | 'storage' | 'human-only';
export type MapNode = { id: NodeId; kind: NodeKind; zoneIds: ZoneId[]; x: number; y: number };
export type MapEdge = { id: EdgeId; from: NodeId; to: NodeId; costTicks: number; oneWay: boolean };

export type RobotStatus = 'idle' | 'moving' | 'executing-action' | 'charging' | 'fault' | 'safety-stopped';
export type Robot = {
  id: RobotId;
  nodeId: NodeId;          // current node (last confirmed by telemetry)
  soc: number;             // integer 0–100
  maxSoc: number;          // typically 100
  payloadCapacity: number; // integer kg
  status: RobotStatus;
  speed: number;           // integer, units/tick (for safety field sizing)
};

export type ToteStatus = 'placed' | 'in-transit' | 'lost' | 'at-discrepancy';
export type Tote = { id: ToteId; locationId: LocationId; status: ToteStatus; skuQuantities: Record<SkuId, number> };

export type TaskKind = 'pick' | 'move' | 'charge';
export type TaskStatus = 'queued' | 'assigned' | 'in-progress' | 'completed' | 'failed' | 'escalated';
export type Task = { id: TaskId; kind: TaskKind; robotId: RobotId | null; status: TaskStatus; fromNodeId: NodeId; toNodeId: NodeId; priority: number; toteId?: ToteId };

export type ReservationKey = `${NodeId}@${number}` | `${EdgeId}@${number}`;
export type ReservationTable = Map<ReservationKey, RobotId>;

export type SafetyZoneKind = 'human-only' | 'speed-limited' | 'lockout' | 'emergency-stop';
export type SafetyZoneState = { zoneId: ZoneId; kind: SafetyZoneKind; active: boolean; maxSpeed?: number };

export type WorldEvent =
  | { type: 'TaskAssigned'; tick: Tick; taskId: TaskId; robotId: RobotId }
  | { type: 'MoveCommanded'; tick: Tick; robotId: RobotId; orderId: string; nodes: NodeId[] }
  | { type: 'CommandAcked'; tick: Tick; robotId: RobotId; orderId: string }
  | { type: 'CommandRejected'; tick: Tick; robotId: RobotId; orderId: string; reason: string }
  | { type: 'TelemetryFrame'; tick: Tick; robotId: RobotId; nodeId: NodeId; soc: number; speed: number; status: RobotStatus }
  | { type: 'ReservationGranted'; tick: Tick; robotId: RobotId; keys: ReservationKey[] }
  | { type: 'ToteScanned'; tick: Tick; toteId: ToteId; locationId: LocationId; robotId: RobotId }
  | { type: 'InventoryAdjusted'; tick: Tick; toteId: ToteId; fromLocation: LocationId; toLocation: LocationId; skuId: SkuId; qty: number }
  | { type: 'SafetyStop'; tick: Tick; robotId: RobotId; reason: string }
  | { type: 'IncidentRaised'; tick: Tick; subject: string; reason: string }
  | { type: 'DeadlockDetected'; tick: Tick; involvedRobots: RobotId[] }
  | { type: 'DeadlockResolved'; tick: Tick; involvedRobots: RobotId[] };

export type WorldState = {
  tick: Tick;
  robots: Map<RobotId, Robot>;
  nodes: Map<NodeId, MapNode>;
  edges: Map<EdgeId, MapEdge>;
  totes: Map<ToteId, Tote>;
  tasks: Map<TaskId, Task>;
  reservationTable: ReservationTable;
  safetyZones: Map<ZoneId, SafetyZoneState>;
  eventLog: WorldEvent[];
  prngStreams: Record<string, PrngStream>;
};

export type WarehouseScenario = {
  nodes: MapNode[];
  edges: MapEdge[];
  robots: Robot[];
  totes: Tote[];
  tasks: Task[];
  safetyZones: SafetyZoneState[];
  seed: bigint;
};
```

how to implement:
1. Create `src/core/types.ts` — types only, no logic.
2. Write a trivial `test/core/types.test.ts` that imports all types and creates one instance of each to confirm TypeScript compilation.

acceptance: `test/core/types.test.ts` compiles and passes. `npm test` → green.

---

**W04 — World state initialization & event fold**
dependsOn: W02, W03
files: `src/core/world.ts`, `test/core/world.test.ts`

interface:
```typescript
// src/core/world.ts
export function initWorldState(scenario: WarehouseScenario): WorldState;
export function applyEvent(state: WorldState, event: WorldEvent): WorldState;
export function foldEvents(initial: WorldState, events: WorldEvent[]): WorldState;
export function hashWorldState(state: WorldState): string;
// Deterministic hash: convert all Maps to sorted arrays, bigints to strings, then djb2/FNV-1a hash.
```

how to implement:
1. `initWorldState`: index nodes/edges/robots/totes/tasks into Maps, set tick=0, empty event log, initialize PRNG streams with `splitStream`.
2. `applyEvent`: pattern-match on `event.type`, return new state (never mutate).
   - `TelemetryFrame`: update `robots.get(event.robotId)` with new position, SOC, speed, status.
   - `CommandAcked`/`CommandRejected`: find task, update status.
   - `ToteScanned`: mark tote status, update locationId.
   - Other events: append to log only (effects applied by higher-level handlers).
3. `hashWorldState`: serialize Maps deterministically (sort by key), serialize bigints as strings, hash.
4. Write `test/core/world.test.ts`.

acceptance: `test/core/world.test.ts` asserts:
- `initWorldState` with a 3-robot scenario has `worldState.robots.size === 3`.
- `hashWorldState` returns identical strings on two calls with the same state.
- A `TelemetryFrame` event updates the robot's node and SOC correctly.

---

**W05 — Snapshot / restore**
dependsOn: W04
files: `src/core/snapshot.ts`, `test/core/snapshot.test.ts`

interface:
```typescript
// src/core/snapshot.ts
export type Snapshot = { tick: number; data: string };
export function takeSnapshot(state: WorldState): Snapshot;
export function restoreSnapshot(snap: Snapshot): WorldState;
// restoreSnapshot(takeSnapshot(state)) must produce a state with the same hashWorldState().
```

how to implement:
1. `takeSnapshot`: serialize Maps to sorted arrays, convert bigints to strings, `JSON.stringify`.
2. `restoreSnapshot`: parse, reconstruct Maps and bigints.
3. Write `test/core/snapshot.test.ts`.

acceptance:
- `hashWorldState(restoreSnapshot(takeSnapshot(state))) === hashWorldState(state)` for a non-trivial state (3 robots, 2 totes, 2 tasks).
- Snapshot + apply 5 events + hash equals no-snapshot + apply same 5 events + hash.

---

**W06 — Warehouse map & pathfinding**
dependsOn: W03
files: `src/core/pathfinding.ts`, `test/core/pathfinding.test.ts`

interface:
```typescript
// src/core/pathfinding.ts
export type PathResult = { path: NodeId[]; costTicks: number } | { path: null; costTicks: null };

export function findPath(
  from: NodeId,
  to: NodeId,
  nodes: Map<NodeId, MapNode>,
  edges: Map<EdgeId, MapEdge>,
  blockedNodes: Set<NodeId>,
  options?: { respectOneWay?: boolean }
): PathResult;
// Dijkstra over the node/edge graph. Edge cost = edge.costTicks.
// Blocked nodes are impassable (other robots currently at the node).
// One-way edges: if respectOneWay=true (default), only traverse edge.from→edge.to direction.
// Tiebreak: when costs are equal, pick the node with lexicographically smaller id.
```

how to implement:
1. Dijkstra with a min-heap (array + sort, or binary heap — no insertion-order-dependent Set).
2. Build adjacency from edges: edge.from → [edge.to] (if one-way respected, not reverse).
3. Tiebreak: on equal cost, sort by nodeId lexicographically.
4. Write `test/core/pathfinding.test.ts` with the small-map fixture below.

acceptance: `test/core/pathfinding.test.ts` uses a 4-node linear map (A→B→C→D):
- Straight path A→D = 3 edges, cost = sum of edge costs.
- Blocking node B forces A→... alternative route (add a bypass edge in the fixture).
- One-way edge D→C: `findPath(A, C, ..., {respectOneWay: true})` cannot use C→D in reverse.
- Two identical calls produce identical paths (determinism check).

---

**W07 — Fixture VDA-5050-style transport (command/telemetry duality)**
dependsOn: W03, W04
files: `src/core/transport.ts`, `test/core/transport.test.ts`

interface:
```typescript
// src/core/transport.ts
export type VdaOrder = {
  orderId: string;
  robotId: RobotId;
  nodes: Array<{ nodeId: NodeId; actions: Array<{ type: 'pick' | 'drop' | 'wait'; toteId?: ToteId }> }>;
  edges: EdgeId[];
};

export type RobotStateMessage = {
  robotId: RobotId;
  tick: Tick;
  nodeId: NodeId;
  soc: number;
  speed: number;
  status: RobotStatus;
  lastOrderId: string | null;
  orderStatus: 'none' | 'accepted' | 'rejected' | 'executing' | 'finished' | 'failed';
  rejectionReason?: string;
};

export type FixtureTransport = {
  // Deliver an order to a robot. Returns the robot's ack/reject synchronously (fixture: always synchronous).
  sendOrder(order: VdaOrder, robotPolicy: RobotPolicy): CommandAckResult;
  // Emit the robot's next telemetry frame given its current state and the scenario's PRNG.
  getTelemetry(robotId: RobotId, currentState: WorldState, stream: PrngStream): { msg: RobotStateMessage; nextStream: PrngStream };
};

export type CommandAckResult = { acked: true } | { acked: false; reason: string };

export type RobotPolicy = {
  // Pure function: given the order and the robot's state, decide to ack or reject.
  decide(order: VdaOrder, robot: Robot, zones: Map<ZoneId, SafetyZoneState>): CommandAckResult;
};

export function createFixtureTransport(): FixtureTransport;
// Default policy: ack always unless zone permission denied or soc < 10.
export function defaultRobotPolicy(): RobotPolicy;
```

how to implement:
1. `createFixtureTransport`: returns an object that applies `robotPolicy.decide()` for `sendOrder`, and for `getTelemetry` emits a `RobotStateMessage` with small PRNG-driven SOC jitter (e.g. ±1 from the expected value).
2. The key discipline: world state only updates when the test harness processes the `RobotStateMessage` into a `TelemetryFrame` event — not on `sendOrder`.
3. Write `test/core/transport.test.ts`.

acceptance:
- A robot with `soc < 10` rejects an order.
- A robot in a lockout zone rejects an order.
- An acked order does NOT update `worldState` until the test calls `applyEvent(state, { type: 'TelemetryFrame', ... })` with the robot's reported position.
- Two identical scenarios with the same seed produce the same telemetry sequences.

---

**W08 — Reservation table (MAPF prerequisite)**
dependsOn: W03, W04
files: `src/core/reservations.ts`, `test/core/reservations.test.ts`

interface:
```typescript
// src/core/reservations.ts
export function makeReservationKey(nodeOrEdgeId: string, tick: Tick): ReservationKey;
export function checkConflict(
  table: ReservationTable,
  nodeOrEdgeId: string,
  tick: Tick
): RobotId | null;  // returns the occupying robot or null
export function reservePath(
  table: ReservationTable,
  robotId: RobotId,
  path: NodeId[],
  startTick: Tick,
  edgeCostMap: Map<EdgeId, number>
): { table: ReservationTable; keys: ReservationKey[] };
// Pure: returns new table with reservations added. Each node is reserved for the arrival tick.
// Each edge is reserved for the traversal tick range.
export function releaseReservations(table: ReservationTable, keys: ReservationKey[]): ReservationTable;
```

how to implement:
1. `makeReservationKey`: returns `\`${nodeOrEdgeId}@${tick}\`` as a string.
2. `reservePath`: compute arrival ticks for each node (sum of edge costs up to that node), add entries to the Map.
3. All functions pure — return new Maps.
4. Write `test/core/reservations.test.ts`.

acceptance:
- Reserve node N at tick 5 for robot A. `checkConflict(table, N, 5)` returns `'A'`.
- Reserve node N at tick 5 for robot A, then attempt robot B at the same key. `checkConflict` returns `'A'` (no overwrite).
- `releaseReservations` removes exactly the released keys, leaving others.

---

**W09 — MAPF prioritized planner**
dependsOn: W06, W08
files: `src/core/mapf.ts`, `test/core/mapf.test.ts`

interface:
```typescript
// src/core/mapf.ts
export type PlanRequest = { robotId: RobotId; from: NodeId; to: NodeId; priority: number };
export type PlanResult = { robotId: RobotId; path: NodeId[]; reservations: ReservationKey[] } | { robotId: RobotId; path: null; reason: string };

export function planPrioritized(
  requests: PlanRequest[],
  nodes: Map<NodeId, MapNode>,
  edges: Map<EdgeId, MapEdge>,
  existingReservations: ReservationTable,
  startTick: Tick
): { results: PlanResult[]; finalTable: ReservationTable };
// Sorts requests by priority (higher first, then by robotId for tiebreak).
// Plans each robot with Dijkstra against the growing reservation table.
// A robot that cannot find a non-conflicting path gets path=null.
```

how to implement:
1. Sort `requests` by `priority` descending, then `robotId` ascending (deterministic tiebreak).
2. For each robot in sorted order: call `findPath` with currently-reserved nodes blocked; call `reservePath` to add its reservations; move to next robot.
3. Write `test/core/mapf.test.ts` with the crossing-fixture.

acceptance: `test/core/mapf.test.ts` uses a fixture with 2 robots approaching a single-node crossing:
- Both robots get valid, non-conflicting paths (one waits one tick, the higher-priority one goes first).
- Identical inputs produce identical plans across runs.
- A robot with no path returns `path: null` (unreachable scenario).

---

**W10 — Deadlock detector**
dependsOn: W08
files: `src/core/deadlock.ts`, `test/core/deadlock.test.ts`

interface:
```typescript
// src/core/deadlock.ts
export type WaitForGraph = Map<RobotId, RobotId>; // robot -> the robot whose reservation it's waiting for

export function buildWaitForGraph(
  robots: Map<RobotId, Robot>,
  reservationTable: ReservationTable,
  robotTargetNodes: Map<RobotId, NodeId>  // where each robot wants to go next
): WaitForGraph;

export type DeadlockResult = { hasDeadlock: false } | { hasDeadlock: true; cycle: RobotId[] };

export function detectDeadlock(graph: WaitForGraph): DeadlockResult;
// Finds a directed cycle using DFS. Returns the cycle nodes in order.

export function resolveDeadlock(
  cycle: RobotId[],
  robots: Map<RobotId, Robot>,
  nodes: Map<NodeId, MapNode>,
  edges: Map<EdgeId, MapEdge>
): { withdrawRobotId: RobotId; holdingNodeId: NodeId };
// Resolution: the lowest-priority robot in the cycle backs off to a holding node
// (nearest non-contested node, found via findPath with length-1 search).
```

how to implement:
1. `buildWaitForGraph`: for each robot whose target node is reserved by another robot, add an edge.
2. `detectDeadlock`: iterative DFS (not recursive — to avoid stack overflow on large graphs). Return the first cycle found.
3. `resolveDeadlock`: choose the robot with the smallest `priority` value (or lexicographically smallest id as tiebreak). Find it a nearby parking node via `findPath` limited to 2 hops.
4. Write `test/core/deadlock.test.ts`.

acceptance: `test/core/deadlock.test.ts` uses a 2-robot head-on fixture:
- Robot A at node X wants node Y; robot B at node Y wants node X. `detectDeadlock` returns `{ hasDeadlock: true, cycle: ['A', 'B'] }` (or `['B', 'A']` — both are valid; assert `cycle.length === 2`).
- A scenario with no cycle returns `{ hasDeadlock: false }`.
- `resolveDeadlock` returns a robot to withdraw and a reachable holding node.

---

**W11 — Double-entry inventory ledger**
dependsOn: W03
files: `src/core/ledger.ts`, `test/core/ledger.test.ts`

interface:
```typescript
// src/core/ledger.ts
export type LedgerEntry = {
  tick: Tick;
  toteId: ToteId;
  fromLocation: LocationId;
  toLocation: LocationId;
  skuId: SkuId;
  qty: number;
  scanEvidenceEventIndex: number; // index into eventLog of the ToteScanned event
};

export type Ledger = { entries: LedgerEntry[] };

export function postTransfer(
  ledger: Ledger,
  state: WorldState,
  toteId: ToteId,
  fromLocation: LocationId,
  toLocation: LocationId,
  skuId: SkuId,
  qty: number,
  scanEvidenceIndex: number
): Ledger;
// Returns new ledger with the entry appended.
// The caller must verify that a ToteScanned event at scanEvidenceIndex exists and matches.

export function verifyConservation(
  ledger: Ledger,
  totes: Map<ToteId, Tote>
): { balanced: boolean; discrepancy?: Record<SkuId, number> };
// For each SKU: sum all quantities across all location totes.
// Sum of all transfers should net to zero (each debit has a credit).
// Discrepancy account is a real location; imbalances are there, not hidden.

export function postException(
  ledger: Ledger,
  tick: Tick,
  toteId: ToteId,
  fromLocation: LocationId,
  skuId: SkuId,
  qty: number,
  reason: string
): Ledger;
// A commanded pick with no scan-confirm: posts a debit from source to 'discrepancy'.
```

how to implement:
1. `postTransfer`: append a `LedgerEntry`. Pure — return new ledger.
2. `verifyConservation`: iterate entries, compute per-SKU net at each location, verify debits == credits.
3. `postException`: debit from `fromLocation`, credit to `'discrepancy'` location.
4. Write `test/core/ledger.test.ts`.

acceptance: `test/core/ledger.test.ts` asserts:
- Post one transfer of 5 units SkuA from locationX to locationY. `verifyConservation` returns `{ balanced: true }`.
- Post a transfer without matching scan evidence (manually skip the check). `verifyConservation` catches the imbalance.
- Post an exception (lost tote). The discrepancy location's balance increases by the exception quantity.
- Total SKU quantity across all locations never changes from the initial inventory.

---

**W12 — Safety kernel**
dependsOn: W03, W04
files: `src/core/safety.ts`, `test/core/safety.test.ts`

interface:
```typescript
// src/core/safety.ts
export type SafetyCheckResult =
  | { allowed: true }
  | { allowed: false; reason: string; action: 'stop' | 'decelerate' };

// Called BEFORE any allocation or traffic decision can proceed.
export function checkSafetyPreMove(
  robot: Robot,
  targetNode: MapNode,
  zones: Map<ZoneId, SafetyZoneState>,
  nodeZoneIds: ZoneId[]  // zones the target node belongs to
): SafetyCheckResult;
// Rules:
// 1. If any zone containing target is 'human-only' and active → stop, not allowed.
// 2. If any zone is 'lockout' and active → stop, not allowed.
// 3. If any zone is 'emergency-stop' and active → stop, not allowed.
// 4. If any zone is 'speed-limited' and robot.speed > zone.maxSpeed → decelerate, not allowed at current speed.

export function checkProtectiveField(
  robot: Robot,
  obstaclePresent: boolean  // true if a person/obstacle is detected in the protective field
): SafetyCheckResult;
// If obstacle in protective field → { allowed: false, reason: '...', action: 'stop' }.

export function applyEmergencyStop(
  state: WorldState,
  scope: 'fleet' | ZoneId,
  tick: Tick
): WorldState;
// Emits SafetyStop events for all robots in scope and updates their status to 'safety-stopped'.
```

how to implement:
1. All functions pure; `applyEmergencyStop` returns new state with `SafetyStop` events applied.
2. `checkSafetyPreMove`: iterate `nodeZoneIds`, check each active zone, return on first violation.
3. Write `test/core/safety.test.ts`.

acceptance: `test/core/safety.test.ts` asserts:
- A robot attempting to enter a human-only zone gets `{ allowed: false, action: 'stop' }`.
- A robot under lockout gets `{ allowed: false, action: 'stop' }`.
- A robot in a normal zone gets `{ allowed: true }`.
- A protective-field intrusion triggers stop.
- `applyEmergencyStop('fleet', ...)` sets ALL robots to `status: 'safety-stopped'`.
- A throughput-vs-safety conflict fixture: even with a high-priority rush task pending, a human-only zone check returns `allowed: false` (safety wins).

---

**W13 — Task allocation engine**
dependsOn: W03, W04, W06, W12
files: `src/core/allocation.ts`, `test/core/allocation.test.ts`

interface:
```typescript
// src/core/allocation.ts
export type AllocationScore = {
  robotId: RobotId;
  taskId: TaskId;
  travelCostTicks: number;
  socAfterTask: number;    // estimated SOC remaining after task + return-to-charger
  feasible: boolean;       // false if SOC can't cover task + return-to-charger with reserve
};

export function scoreAllocations(
  tasks: Task[],
  robots: Map<RobotId, Robot>,
  nodes: Map<NodeId, MapNode>,
  edges: Map<EdgeId, MapEdge>,
  zones: Map<ZoneId, SafetyZoneState>
): AllocationScore[];
// For each (task, robot) pair: compute travel cost via findPath, estimate SOC cost (1 SOC per 10 ticks),
// check zone permissions, check feasibility (soc - estimatedCost >= 20% reserve).
// Sort results: feasible first, then by travelCostTicks ascending, then robotId ascending (tiebreak).

export function assignTask(
  state: WorldState,
  taskId: TaskId,
  robotId: RobotId
): WorldState;
// Emits TaskAssigned event, updates task.robotId and task.status = 'assigned'. Pure.
```

how to implement:
1. `scoreAllocations`: for each robot×task, call `findPath`, compute travel cost, subtract SOC estimate, check zone permissions via `checkSafetyPreMove`.
2. Sort the output array deterministically.
3. `assignTask`: emit `TaskAssigned` via `applyEvent`.
4. Write `test/core/allocation.test.ts`.

acceptance: `test/core/allocation.test.ts` asserts:
- A low-battery robot (soc=15, needed cost=20) is marked `feasible: false`.
- A high-priority task is scored but allocation still picks the nearest feasible robot.
- A robot in a zone it cannot enter is excluded from that task's scores.
- Allocation changes when a path is blocked (different robot wins when first-choice path is unavailable).

---

**W14 — Shift simulation runner**
dependsOn: W07, W09, W10, W11, W12, W13
files: `src/core/shift.ts`, `test/core/shift.test.ts`

interface:
```typescript
// src/core/shift.ts
export type ShiftResult = { worldHash: string; eventLog: WorldEvent[]; completedTasks: number };

export function runShift(
  scenario: WarehouseScenario,
  maxTicks: number
): ShiftResult;
// Main simulation loop:
// Each tick:
//   1. Safety check: if any e-stop pending, apply it before anything else.
//   2. Allocation: assign unassigned tasks to feasible robots.
//   3. Planning: MAPF plan for assigned robots with no current path.
//   4. Deadlock detection: if deadlock found, resolve (back off a robot, replan).
//   5. Command dispatch: send VDA-5050-style orders to robots via FixtureTransport.
//   6. Telemetry collection: get telemetry frames, apply as TelemetryFrame events.
//   7. Inventory: process ToteScanned events into LedgerEntry via postTransfer.
//   8. Tick increment.
```

how to implement:
1. Implement the 8-step tick loop using the modules from W07–W13.
2. All state updates go through `applyEvent` — never direct mutation.
3. The main loop is deterministic: all operations happen in a fixed, sorted order.
4. Write `test/core/shift.test.ts` with the small-map fixture (W15).

acceptance: `test/core/shift.test.ts` (using fixture from W15):
- `runShift` completes without error after 100 ticks.
- At least one task is marked `completed`.
- `hashWorldState` of the final state is stable across two runs with the same seed.

---

**W15 — Seed scenario fixture & adversarial fixtures**
dependsOn: W03
files: `test/fixtures/seed-scenario.ts`, `test/fixtures/deadlock-fixture.ts`, `test/fixtures/lost-tote-fixture.ts`, `test/fixtures/safety-fixture.ts`

interface: TypeScript `const` fixture objects conforming to `WarehouseScenario`.

how to implement:
1. `seed-scenario.ts`: a 5×4 grid of nodes, 4 edges forming a crossing (the deadlock-prone junction), 3 robots, 1 charger, 1 human-only zone, 2 totes, 3 tasks (pick/move/charge), 1 rush task. `seed = 42n`.
2. `deadlock-fixture.ts`: 2 robots, head-on at a single-node crossing — robot A at node X wants Y, robot B at Y wants X.
3. `lost-tote-fixture.ts`: a pick task where the robot's telemetry confirms arrival at the pick node but no `ToteScanned` event follows (the tote is "lost").
4. `safety-fixture.ts`: a human-only zone with a high-priority rush task targeting a node inside it.

acceptance: all fixtures import cleanly and produce valid `WarehouseScenario` objects. TypeScript compiles.

---

**W16 — Adversarial fixture tests**
dependsOn: W10, W11, W12, W14, W15
files: `test/integration/adversarial.test.ts`

interface: tests only.

how to implement:
1. **Deadlock test**: run `runShift(deadlockFixture, 50)`. Assert `DeadlockDetected` and `DeadlockResolved` events both appear in the event log. Assert all tasks eventually complete or are escalated (no wedge).
2. **Lost tote test**: run the lost-tote scenario for 30 ticks. Assert a `ToteScanned` event is missing for the commanded pick. Assert an `IncidentRaised` event appears. Assert `verifyConservation(ledger)` shows a discrepancy account balance > 0.
3. **Safety supremacy test**: run the safety fixture with a rush task targeting a human-only zone. Assert the robot never enters the human-only zone (no `TelemetryFrame` with that nodeId). Assert a `SafetyStop` event appears before any `TaskAssigned` to that node.

acceptance: all three tests pass green. `npm test` → green.

---

**W17 — Golden replay + global invariants integration test**
dependsOn: W14–W16
files: `test/integration/golden-replay.test.ts`

interface: tests only.

how to implement:
1. Run `runShift(seedScenario, 100)` twice with identical inputs.
2. **Pin** both `worldHash` and `eventLogHash` values as constants in the test.
3. Assert both hashes are identical across runs.
4. Assert invariants for every tick (requires storing per-tick snapshots during the run):
   a. **No collisions**: for every tick, no two robots share the same node (check reservations).
   b. **Conservation**: `verifyConservation(ledger)` returns `{ balanced: true }` at the final state.
   c. **Safety supremacy**: no robot with status other than `'safety-stopped'` is at a human-only node.
   d. **Liveness**: all tasks in the scenario are either `completed` or `escalated` within 100 ticks.
5. Run the same simulation from a snapshot taken at tick 50; assert the final hash matches.

acceptance: all assertions pass. Pinned hashes are stable. `npm test` → green. This is the gate for the entire first slice.

---

### 3. The decomposition method for the rest

Use this repeatable recipe to expand remaining features into the same card shape:

**Recipe:**
1. Identify what **new types** the feature needs. That is card cluster A (types-only).
2. Identify what **pure computation** it adds. That is card cluster B (logic, pure functions).
3. Identify what **new event types** it emits and how `applyEvent` extends. That is card cluster C (event/state).
4. Identify what **safety check** or **invariant** it must satisfy. That is card cluster D (validation/property test).
5. Write one offline acceptance test per card before implementing.

**Worked example 1 — Livelock detector (E4):**
- **LL01** (types): Add `LivelockDetected | LivelockResolved` to `WorldEvent`. files: `src/core/types.ts`. acceptance: TypeScript compiles.
- **LL02** (logic): Implement `detectLivelock(robotHistory: Map<RobotId, NodeId[]>, window: number): RobotId[]` in `src/core/livelock.ts`. A robot is livelocked if its last `window` positions contain repeats with no net movement toward its goal. acceptance: a robot oscillating A→B→A→B over 10 ticks with goal=C is detected; a robot making progress is not.
- **LL03** (integration): Call `detectLivelock` in the shift runner after deadlock resolution. If livelock detected, escalate task and re-auction. acceptance: a livelock fixture (two robots yielding to each other) eventually escalates, not wedges, within 50 ticks.

**Worked example 2 — Opportunity charging (E7):**
- **OC01** (types): Add `ChargeStarted | ChargeStopped | ChargerQueued` to `WorldEvent`. files: `src/core/types.ts`.
- **OC02** (logic): Implement `scoreChargingNeed(robot: Robot, chargers: MapNode[], edges: Map<EdgeId, MapEdge>): { needed: boolean; urgency: number }` in `src/core/battery.ts`. Urgency increases as SOC drops; needed=true if soc < 30. acceptance: robot at soc=20 has urgency > robot at soc=50.
- **OC03** (integration): In the allocation step, if a robot has `scoreChargingNeed.needed === true`, insert a charge task ahead of other tasks. Assert charger node has only one robot reserved at a time (single-occupancy charger reservation). acceptance: two low-battery robots converging on one charger: one gets the charger, the other queues without deadlocking.

**Worked example 3 — CBS planner (replacing prioritized planning, E3):**
- **CBS01** (types): Add `ConflictConstraint` type: `{ robotId, nodeOrEdge, tick }`. files: `src/core/mapf.ts` (extend).
- **CBS02** (logic): Implement `detectConflict(paths: Map<RobotId, PlanResult[]>): ConflictConstraint | null` that finds the first (robotId, node, tick) collision across all planned paths. acceptance: given two paths that share node N at tick T, returns the conflict.
- **CBS03** (integration): Implement `planCBS(requests, nodes, edges, reservations, startTick)` using CBS two-level search: plan all, find first conflict, add constraint to one robot, replan it, repeat until no conflicts (up to max iterations). acceptance: a 2-robot crossing scenario that prioritized-planning handles incorrectly (or leaves a conflict) resolves with CBS.

---

### 4. Per-task implementation conventions

**File/folder layout:**
```
src/
  core/
    prng.ts           # seeded PRNG (W02)
    types.ts          # domain types (W03)
    world.ts          # world state init, event fold, hash (W04)
    snapshot.ts       # snapshot/restore (W05)
    pathfinding.ts    # Dijkstra (W06)
    transport.ts      # fixture VDA-5050-style transport (W07)
    reservations.ts   # reservation table (W08)
    mapf.ts           # MAPF prioritized/CBS planner (W09)
    deadlock.ts       # deadlock detector/resolver (W10)
    ledger.ts         # double-entry inventory ledger (W11)
    safety.ts         # safety kernel (W12)
    allocation.ts     # task allocation (W13)
    shift.ts          # shift simulation runner (W14)
test/
  core/               # unit tests (one file per src/core/ module)
  integration/        # golden-replay.test.ts, adversarial.test.ts
  fixtures/           # TypeScript fixture objects — no file I/O
```

**Naming conventions:**
- Functions that return new state are named `apply*` (never mutate in-place).
- Functions that check a rule are named `check*` and return a result type, never throw.
- Fixture files are TypeScript `const` objects, not JSON files.

**Minimal test snippet:**
```typescript
// test/core/ledger.test.ts
import { describe, it, expect } from 'vitest';
import { postTransfer, verifyConservation } from '../../src/core/ledger.js';

describe('Inventory ledger', () => {
  it('stays balanced after a transfer', () => {
    let ledger = { entries: [] };
    ledger = postTransfer(ledger, /* ... */, 'toteA', 'pickBay1', 'packStation2', 'SKU-X', 3, 0);
    expect(verifyConservation(ledger, /* totes */)).toEqual({ balanced: true });
  });
});
```

**Keeping it deterministic — checklist for every card:**
- [ ] No `Math.random()` in `src/core/` — `grep -r 'Math.random' src/core/`
- [ ] No `Date.now()` — `grep -r 'Date.now' src/core/`
- [ ] No `Set`/`Map` iteration for state-affecting order — convert to sorted arrays.
- [ ] World state updates only from telemetry events, never from command dispatch.
- [ ] Inventory only changes when `ToteScanned` event is present.
- [ ] Safety check called before any allocation decision in every tick.

**Wiring a fixture adapter:**
Fixtures are TypeScript `const` objects in `test/fixtures/`. Import them directly:
```typescript
import { seedScenario } from '../fixtures/seed-scenario.js';
```
No `fs.readFile`, no network. The fixture is code.

**Definition of done for any card:**
1. All listed files exist.
2. Exported types/functions match the card's interface exactly (TypeScript check).
3. Card's acceptance tests pass green.
4. `npm test` (all tests) passes green.
5. `grep -r 'Math.random\|Date.now' src/core/` returns nothing.

---

### 5. Common pitfalls for a weak model on this project

**Pitfall 1 — Robots teleporting (world state updates from commands, not telemetry)**
A 3B will write `robot.nodeId = order.nodes[lastIndex]` when dispatching an order. This breaks the intent/reality separation: a robot that rejects or stalls mid-edge would still appear at the destination.
Fix: `robot.nodeId` only updates when a `TelemetryFrame` event is applied by `applyEvent`. The transport test (W07) and global invariant test (W17) both verify this by asserting that no-acked-order state change occurs without a subsequent telemetry event.

**Pitfall 2 — Inventory mutating without scan evidence**
A 3B will write `tote.locationId = destinationNode` when a pick task is assigned. The tote would "move" even if the robot stalls.
Fix: `postTransfer` requires a `scanEvidenceIndex` pointing to a `ToteScanned` event. The lost-tote adversarial test (W16) verifies that a missing scan produces an exception, not a silent inventory update.

**Pitfall 3 — Deadlock not detected because wait-for-graph uses Map iteration order**
A 3B may build the wait-for-graph using `Map.entries()` iteration in indeterminate order, causing the DFS to miss cycles depending on insertion order.
Fix: `buildWaitForGraph` must sort its traversal order (by robotId). The deadlock test (W16) uses a 2-robot fixture where the cycle must always be found within 1 tick regardless of insertion order.

**Pitfall 4 — Safety check bypassed when allocation is "urgent"**
A 3B may add an `if (task.priority === 'emergency') skip_safety_check()` path. This is exactly the antipattern the spec forbids.
Fix: `checkSafetyPreMove` is called unconditionally before any movement decision in the shift runner (W14). The safety supremacy test (W16) verifies that even with a rush task, a human-only zone violation is rejected.

**Pitfall 5 — Seeded PRNG drifts because a consumer was added**
A 3B adding a new PRNG consumer (e.g. telemetry jitter for a new sensor) calls `nextUint32(sharedStream)` directly on a shared stream, shifting all subsequent rolls for other systems.
Fix: Use `splitStream(rootState, uniqueStreamId)` for every new consumer. The golden replay test (W17) will catch drift: if the hash changes after adding a consumer, the consumer is sharing a stream it shouldn't.

**Pitfall 6 — Ledger double-counting (transfer deducted twice)**
A 3B may call `postTransfer` and also call `postException` for the same tote movement, creating two debit entries.
Fix: `postTransfer` is only called when both a ToteScanned pick AND a ToteScanned putaway event exist. `postException` is only called when a pick scan exists but no putaway scan. `verifyConservation` will catch double-debits immediately.

**Pitfall 7 — MAPF prioritized planner produces different orderings on different runs**
A 3B sorts `PlanRequest` by `priority` but forgets the tiebreak when priorities are equal. Two robots with the same priority may plan in different order across runs.
Fix: Sort by `priority` descending, then `robotId` ascending. The MAPF test (W09) asserts identical plans across two identical calls.

**Pitfall 8 — `hashWorldState` serializing Maps as `{}`**
`JSON.stringify(new Map())` returns `"{}"`. The hash of a state with 5 robots looks identical to one with 3 robots.
Fix: Convert every `Map` to a sorted `[key, value][]` array before serializing. The snapshot test (W05) will catch this because `restoreSnapshot(takeSnapshot(state))` will produce a different hash if maps are lost.

**Pitfall 9 — Deadlock resolution re-introduces deadlock**
A 3B resolves a deadlock by backing off a robot to a holding node, but the holding node is already reserved by a third robot, creating a new deadlock.
Fix: `resolveDeadlock` must check reservations on the candidate holding node before committing. Call `checkConflict(table, holdingNode, currentTick)` and try the next nearest node if conflicted. The deadlock adversarial test verifies the world eventually reaches all goals.

**Pitfall 10 — Bigint serialization failing with `JSON.stringify`**
`JSON.stringify({ seed: 42n })` throws `TypeError`. A 3B will hit this in snapshot/hash.
Fix: Replace all bigints with `.toString()` before serializing; reconstruct with `BigInt(str)` on restore. The snapshot test (W05) will catch any serialization failure.
