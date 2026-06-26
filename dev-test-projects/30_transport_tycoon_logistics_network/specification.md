# 30 - Transport Tycoon Logistics Network Simulation

Complexity tier: 30/35 game block
Expected decomposition size: 120-145 dependent implementation cards before coding.
Domain pressure: transport networks, vehicle scheduling, cargo economics, pathfinding, timetables, infrastructure planning, logistics simulation, map presentation.
Acceptance command: npm test

## How to use this challenge
This is a game dev-test project specification for evaluating whether an autonomous coding agent can decompose real game systems, implement deterministic simulation logic, and build a polished presentation layer that makes the game understandable and desirable. The goal is not to finish the whole game. The goal is to build a product-grade foundation that proves the agent understands rules, simulation state, player experience, rendering, and verification.

The agent must read this entire specification before planning. It must create a dependency-linked plan, record domain knowledge debt, identify engine and presentation invariants, and choose a release slice that exercises the highest-risk mechanics. For game projects, visual presentation is mandatory, not a stretch goal. A correct simulation hidden behind ugly placeholder UI is not enough.

## Product vision
Build a transport tycoon simulation where players design rail, road, ship, and air logistics networks across towns and industries. The challenge is to model infrastructure, schedules, capacity, cargo demand, vehicle economics, and a beautiful map presentation that makes network flow legible.

## Target players and users
- Simulation players who enjoy building profitable networks over decades.
- Optimization players who tune timetables, cargo flows, and vehicle fleets.
- Scenario designers creating maps with regional economies and constraints.
- Spectators who want readable animated logistics systems.

## Foundation release scope
The first serious buildout must include:
- Map, tile, terrain, town, industry, station, depot, route, line, timetable, vehicle, cargo, passenger, demand, contract, company, finance, and event models.
- Transport modes for rail, road, ship, and air with infrastructure placement, stations, depots, vehicle compatibility, speed, capacity, running cost, and maintenance.
- Pathfinding over transport graphs with signals, one-way tracks, road congestion, station transfer penalties, water routes, and airport slots.
- Demand model for passengers, mail, raw materials, intermediate goods, finished goods, perishables, and time-sensitive cargo.
- Vehicle scheduler with timetables, headways, loading rules, wait conditions, breakdowns, servicing, and fleet replacement.
- Economic model for construction cost, operating cost, cargo revenue, town growth, industry production, subsidies, loans, and bankruptcy risk.
- Infrastructure planning tools for bridges, tunnels, signals, station catchment, route overlays, and capacity bottlenecks.
- Analytics panels for profit, cargo waiting, vehicle utilization, congestion, missed transfers, town satisfaction, and emissions placeholder.
- Seed scenarios for mountain rail, island shipping, commuter rail, congested trucking, airport hub, and supply-chain shock.

## Gameplay requirements
- Network decisions must involve tradeoffs between capacity, cost, speed, reliability, and future expansion.
- Cargo and passenger demand must respond to service quality, not simply spawn fixed payments.
- Timetables and routing should support player intent without requiring micromanagement for every vehicle.
- Scenario events should create operational stress without invalidating deterministic tests.

## Presentation requirements
Very nice presentation is mandatory for this challenge. The agent must treat rendering, animation, interaction feedback, and layout polish as core acceptance criteria. Required presentation work:
- The map must be beautiful and readable: terrain, water, towns, industries, stations, animated vehicles, route colors, cargo icons, and day/night or era presentation hooks.
- Players need polished placement tools for tracks, roads, stations, depots, bridges, tunnels, and signals with previews and cost feedback.
- Network overlays must show demand, congestion, profit, route coverage, station catchment, and timetable adherence without visual chaos.
- Vehicle details should include animated state, cargo load, schedule, profit, maintenance, and next stop in a compact professional panel.
- A transport sim without animated vehicles, route overlays, and pleasing map presentation does not pass.

## Architecture requirements
- Separate map model, infrastructure graph, pathfinding, demand simulation, vehicle scheduler, economy, scenario events, analytics projections, and rendering.
- Use deterministic simulation ticks and seedable event generation.
- Make infrastructure placement rules independent of UI tools.
- Represent timetables and routes structurally so analytics can reason about them.

## Domain knowledge debt to surface
The agent should not pretend to know every game design, simulation, AI, rendering, or balancing detail perfectly. It should mark assumptions, build deterministic subsets, and preserve extension points for future designers, artists, balance passes, and live integrations. Required knowledge areas:
- Transport games are graph simulations with economics layered on top.
- Congestion, capacity, transfers, and timetable adherence are core mechanics.
- Cargo demand should have origins, destinations, time sensitivity, and service quality effects.
- Presentation clarity is required because players debug networks visually.

## Required challenge scenarios
The implementation plan and fixtures should be shaped around scenarios like these. They do not all need full UI coverage in the first slice, but the core model and presentation should be capable of representing them:
- A commuter line improves town growth but loses money due to poor headway and low capacity.
- A freight route backs up because one station platform creates a capacity bottleneck.
- A ship route is profitable but slow enough that perishables decay before delivery.
- A rail signal placement creates deadlock and the diagnostics identify the blocked section.
- An airport hub shifts demand away from long-distance rail and changes network profit.

## Decomposition pressure
This challenge should force decomposition across rules or simulation engine, deterministic fixtures, AI or policy layers, replay/save state, player-facing presentation, UI interaction, diagnostics, and test harnesses. The plan should include dependency links so core state, commands, invariants, and golden tests are built before rendering depends on them. Avoid starting with a visual mock that cannot play the game; also avoid building a correct but lifeless engine with no usable presentation.

The agent should maintain a visible knowledge-debt list covering unclear rules, balance assumptions, AI limitations, rendering tradeoffs, asset gaps, accessibility concerns, performance constraints, and future designer review checkpoints. Knowledge debt is not a failure; hiding it is.

## Acceptance criteria
- Pathfinding tests cover rail signals, road congestion, transfers, water routes, airport slots, and invalid infrastructure.
- Demand tests cover cargo generation, passenger satisfaction, time sensitivity, service quality, and town/industry feedback.
- Scheduler tests cover timetables, loading rules, breakdowns, servicing, fleet replacement, and missed transfers.
- Economy tests cover costs, revenue, loans, subsidies, profit/loss, and bankruptcy thresholds.
- Presentation checks verify animated map, placement previews, route overlays, vehicle panels, and no overlapping controls.
- The project passes npm test without live map data.

## Explicit non-goals
- Do not build only route lines on a static map.
- Do not ignore capacity and congestion.
- Do not make cargo payments independent of origin, destination, and service quality.
- Do not use external map APIs in foundation tests.

## Quality bar
- Use typed domain objects and pure core modules wherever practical.
- Keep deterministic fixtures in the repository and do not depend on live APIs, live LLMs, or wall-clock randomness for acceptance tests.
- Test edge cases, replay determinism, command validation, and simulation invariants before broad content expansion.
- Build a polished first playable slice with coherent visual style, responsive layout, clear feedback, and no raw debug UI as the primary experience.
- Every AI decision, simulation transition, score, economy change, or generated narrative must be explainable from source facts and evidence.
- Stubs are acceptable only at external integration, asset, or live-provider boundaries and must be named as adapters with deterministic fixture implementations.
- The foundation should be extensible into a real game if later teams add content, art, sound, balancing, multiplayer, and production UI.

---

# Extended scope & deep-reasoning extensions (v2)

> Added 2026-06-26 via deep domain research. **The single hardest, most-defining property of this project:** a transport tycoon is a *deterministic, fixed-timestep simulation of cargo flowing over a graph under capacity, signaling, and economic constraints* — where **cargo and money are conserved exactly, no rail junction can deadlock undetected, and the routing/economy layer is a multi-commodity flow problem layered on top of physical vehicle movement.** Everything visible (the beautiful animated map, the vehicle panels, the route overlays) is a projection of that graph-simulation spine.

This section adds the load-bearing architecture the base spec implies but does not pin down. It is grounded in how the genre's reference implementation actually works — OpenTTD's pathfinding (YAPF), its path-based signaling and reservation model, its realistic-acceleration physics, its town/cargo economy, and its *cargodist* link-graph (a real multi-commodity-flow demand model).

## T0. The meta-test: what "deterministic logistics simulation" actually demands

The base spec says "use deterministic simulation ticks and seedable event generation" and "represent timetables and routes structurally." Make those concrete and testable:

1. **Conservation.** Cargo is neither created nor destroyed in transit: `Σ(cargo at sources) = Σ(in vehicles) + Σ(waiting at stations) + Σ(delivered) + Σ(decayed/expired)` at every tick. Money is double-entry: every revenue/cost has a matching ledger movement; the company balance is a fold over the ledger, never a free-floating number.
2. **No silent deadlock.** A rail network either makes progress or *the diagnostics identify the exact blocked section* (a base-spec required scenario). Deadlock is a detected, reported state — never a frozen game with no explanation.
3. **Determinism.** `simulate(seed, commandLog, N_ticks)` twice ⇒ byte-identical state hashes at every checkpoint. Pathfinding, demand distribution, breakdowns, and events all draw from the seeded clock/PRNG; no `Date.now()`, no unseeded randomness, no float drift in the authoritative core.
4. **Service-responsive demand.** Cargo/passenger volume responds to *service quality* (frequency, speed, reliability, transfer penalties), not fixed spawn-and-pay (an explicit base-spec non-goal: "do not make cargo payments independent of origin, destination, and service quality").

Everything below serves these four.

## T1. The fixed-point logical-time kernel (the foundation under the foundation)

Decades-long economic simulations diverge under floating point: rounding differs per CPU/compiler and compounds — the classic lockstep-desync failure mode ([Gaffer On Games — Floating Point Determinism](https://gafferongames.com/post/floating_point_determinism/); deterministic frameworks use fixed-point math for exactly this, e.g. [Klotho](https://github.com/xpTURN/Klotho)). So:

- **Injected virtual clock; fixed tick.** A logical tick (and a calendar layer of day/month/year mapped onto ticks) drives vehicle movement, loading timers, breakdowns, servicing intervals, town growth cadence, demand recompute cadence, and event scheduling. Tests advance ticks; the renderer interpolates vehicle positions between authoritative ticks for smooth motion but never feeds back.
- **Fixed-point physics & economy.** Vehicle speed/position, acceleration, cargo amounts, prices, and balances are integer/fixed-point in the authoritative core. The renderer may use floats; a typed `Fixed` newtype + an architecture test keeps float arithmetic out of state-affecting core paths.
- **Seeded entropy tree.** Breakdowns, event timing, demand jitter, and procedural map/scenario generation draw from one seeded splittable PRNG, so every run is reproducible from `(seed, commandLog)`.

This kernel is the first ~10–12 cards and gates everything.

## T2. The infrastructure graph + pathfinding (the genre's core data structure)

A transport game *is* a graph simulation with economics on top (the base spec says so). The reference design is OpenTTD's **YAPF — a templated A\*** where the same search core is specialized per mode via "node followers" ([OpenTTD/OpenTTD DeepWiki — Pathfinding System](https://deepwiki.com/OpenTTD/OpenTTD/5.6-pathfinding-system); [OpenTTD Wiki — Yet Another Pathfinder](https://wiki.openttd.org/en/Archive/Manual/Yet%20Another%20Pathfinder)):

- **One A\* core, per-mode followers.** Rail, road, ship, and air share an abstract A* loop (open/closed sets, f = g + h, lowest-f expansion) but plug in mode-specific successor functions and costs: rail follows valid track connections, rail types, and **signal state**; road handles one-way segments, tram tracks, and **congestion**; ship uses a coarse **water-region** decomposition (connected-component-labeled water patches, corridor pathfinding) then tile-level navigation; air uses airport-slot graphs. Build the templated core once; specialize.
- **Mode-specific cost factors are real gameplay.** Reproduce the kinds of penalties OpenTTD uses: rail slope/curve (`curve90`/`curve45`)/level-crossing/signal look-ahead costs; road slope/curve/crossing/road-stop occupancy; ship octile-distance; **station transfer penalties** (base-spec requirement). Costs — not just distance — decide routes; "shortest time, not shortest distance" is the SimCity-4/NAM lesson too ([SC4 NAM Traffic Simulator](https://www.sc4nam.com/docs/feature-guides/the-nam-traffic-simulator/)).
- **Caching with determinism.** Pathfinding caches (water regions, segment costs) are an optimization that must be invalidated deterministically on infrastructure edits; a cached path and a freshly-computed path must agree. Pathfinding is CPU-heavy and in OpenTTD runs partly off the main thread — if you ever parallelize, the *result must be deterministic and merged in a fixed order* (mirroring how the link-graph thread is joined deterministically — see T4).

## T3. Rail signaling, reservation, and deadlock (the highest-risk seam)

This is the seam most likely to break and the one the base spec calls out explicitly ("a rail signal placement creates deadlock and the diagnostics identify the blocked section"). The correct model is **path-based signaling with reservation**, not block signals alone ([OpenTTD Wiki — Signals](https://wiki.openttd.org/en/Manual/Signals); [Realistic Path Based Signalling](https://wiki.openttd.org/en/Archive/Community/Realistic%20Path%20Based%20Signalling); [JGRennison OpenTTD-patches — Signalling](https://github.com/JGRennison/OpenTTD-patches/wiki/Signalling)):

- **Reservation as state.** A train **reserves a path through to the next signal before committing to enter**; a path signal lets a second train into the same block on a *different* track if it can reserve a conflict-free path. Reservations are explicit, owned, released-on-exit simulation state — the single source of truth for "is this section claimed."
- **Deadlock detection, not deadlock-by-design.** Because reservations can mutually block (two trains each needing track the other holds), you must **detect** the cycle and surface it: the diagnostics name the blocked section, the trains involved, and the conflicting reservations. (OpenTTD's own docs warn that certain pathfinder-penalty/signal choices *cause* deadlocks — e.g. a slow train stalling on the mainline waiting for a siding — so deadlock-proneness is a real, modelable property of a layout.) A "deadlock detector" over the reservation graph is a required subsystem with golden tests.
- **Determinism of contention.** When two trains can reserve the same junction in the same tick, resolution is by a documented stable priority (e.g. train id / arrival order), never iteration accident. Test both that valid PBS layouts *never* deadlock and that a deliberately-broken layout deadlocks *and is correctly diagnosed*.

## T4. The demand & cargo-routing model as multi-commodity flow (cargodist)

The base spec demands cargo with "origins, destinations, time sensitivity, and service quality effects" — and forbids fixed spawn-and-pay. The genre's authentic answer is OpenTTD's **cargodist / link graph**: cargo is given a *destination* and routed across the network of links the player's services create, solved as a **multi-commodity flow (MCF)** ([OpenTTD docs/linkgraph.md](https://github.com/OpenTTD/OpenTTD/blob/master/docs/linkgraph.md); [OpenTTD Wiki — Passenger and cargo distribution](https://wiki.openttd.org/en/Manual/Passenger%20and%20cargo%20distribution)):

- **Three-stage pipeline.** (1) The **link graph** records nodes (stations) and edges (links the player's vehicles actually serve, with capacity = throughput offered). (2) The **MCF solver** distributes demand between node pairs over those edges respecting capacity — this is **NP-hard** and OpenTTD runs it on a background thread with a *configurable accuracy and a recalculation window*, then **joins the thread deterministically** so the result folds into the game state reproducibly. (3) **Flow mapping** turns the solved flows into per-station "send this cargo toward that destination" routing decisions; at a station, cargo boards only vehicles heading toward its destination.
- **Why this is the right hard problem.** It makes routing *and* load-balancing inseparable (cargodist's explicit design stance), it makes transfers and hub-and-spoke emergent, and it makes "an airport hub shifts demand away from long-distance rail and changes network profit" (a base scenario) a *computed* consequence of changing edge capacities, not a scripted event.
- **Determinism strategy.** The MCF is the single biggest determinism risk (background thread + iterative solver). Pin it: fixed iteration budget, fixed-point arithmetic, deterministic node/edge ordering, and a deterministic thread-join. A "run the MCF twice, assert identical flows" test is mandatory. Provide a **synchronous fixture solver** for acceptance tests so no real threading is needed to verify behavior.
- **Time-sensitivity & perishables.** Cargo carries an age/decay clock; perishables that exceed transit time decay before delivery (a base scenario: "a ship route is profitable but slow enough that perishables decay before delivery"). Decay is a deterministic function of the virtual clock and route time — and decayed cargo is *accounted for* in the conservation invariant (T0.1), not silently dropped.

## T5. Vehicle physics, scheduling, and timetables

- **Realistic acceleration.** Reproduce OpenTTD's realistic-acceleration model: net force = tractive effort − (rolling friction + air drag + slope/tangential force), with acceleration high at low speed and tapering toward top speed; speed/position integrate in fixed-point ([OpenTTD Wiki — Tractive Effort](https://wiki.openttd.org/en/Manual/Game%20Mechanics/Tractive%20Effort); [TT-Wiki — RealisticAcceleration](https://www.tt-wiki.net/wiki/RealisticAcceleration)). This makes mountain rail (a base scenario) genuinely hard: an underpowered train on a grade crawls, changing throughput and profit.
- **Scheduler & timetables.** Timetables, headways, loading rules, *wait conditions* (full-load vs timed), breakdowns, servicing intervals, and fleet replacement are explicit state. The scheduler must "support player intent without micromanagement" (base spec): a line with a target headway self-spaces vehicles. **Missed transfers** (a base requirement) emerge when a feeder arrives after its connection departs — a measurable, diagnosable event.
- **Capacity bottleneck = platform contention.** "A freight route backs up because one station platform creates a capacity bottleneck" (a base scenario) is modeled as station-platform reservation queues — the road/rail analog of the F-series belt backpressure. Throughput of a line is bounded by its scarcest resource (platform, signal block, or vehicle count), and the analytics must name it.

## T6. The economy: double-entry ledger, town/industry feedback, service quality

The base spec wants "construction cost, operating cost, cargo revenue, town growth, industry production, subsidies, loans, and bankruptcy." Ground it:

- **Double-entry money.** Every transaction (build, maintenance tick, cargo payment, loan draw/repay, subsidy) posts to a ledger; balance is a fold. Loans have limits; crossing a debt/insolvency threshold triggers bankruptcy state. **Money conservation** is an invariant (no revenue without a payer, no cost without a recipient).
- **Distance/time-priced revenue.** Cargo payment depends on amount × distance × *speed of delivery* (faster delivery pays more, slow delivery decays the rate) and on cargo type — never a flat per-unit constant. This directly encodes the base non-goal against origin/destination/quality-independent payments.
- **Town growth driven by service.** Model OpenTTD's town behavior: a town with no served cargo stagnates; delivering cargo to it (any type, plus passengers/mail) grows it, *faster in proportion to volume transported*; towns expand by building roads then houses, and growth depends on travel distance to the town center ([OpenTTD Wiki — Towns](https://wiki.openttd.org/en/Manual/Towns); [openttdcoop — Town Growth Mechanics](https://wiki.openttdcoop.org/User:Mfb/Towns)). A "commuter line improves town growth but loses money due to poor headway and low capacity" (base scenario) is then an emergent tension, not a script.
- **Station rating / catchment.** Station catchment (which tiles' cargo a station collects) and a **station rating** (driven by frequency, waiting time, vehicle speed, reliability) gate how much waiting cargo a station actually offers — the formal expression of "demand responds to service quality."
- **Industry production chains.** Industries produce/accept along chains (raw → intermediate → finished, plus perishables); production responds to whether output is being carried away. Subsidies are time-boxed seeded events on specific routes.

## T7. Seeded scenario events (stress without breaking determinism)

"Scenario events should create operational stress without invalidating deterministic tests" (base spec). So every event — breakdown, supply-chain shock, subsidy offer, disaster — is drawn from the seeded clock/PRNG with a logged schedule, making the run reproducible. A "supply-chain shock" (base scenario) is a scheduled drop in an industry's production at tick T; its downstream profit effect is a computed, replayable consequence.

## T8. The presentation layer is gameplay (and must not break determinism)

"Players debug networks visually" (base spec), so presentation is comprehension:

- **Interpolated rendering.** Vehicles animate by interpolating between authoritative tick positions; the sim runs fixed-step via an accumulator ([Gaffer On Games — Fix Your Timestep](https://gafferongames.com/post/fix_your_timestep/)). Terrain, water, towns, industries, stations, animated vehicles, route colors, and cargo icons all derive from sim state.
- **Placement tools** for track/road/station/depot/bridge/tunnel/signal with previews and *cost feedback* (the cost is the real T6 construction cost). Signal placement previews must show reservation/block implications.
- **Overlays as projections** (demand, congestion, profit, route coverage, station catchment, timetable adherence, and a **link-graph flow overlay** echoing cargodist's edge-load coloring) — derived from authoritative state, never recomputed approximations. A vehicle panel shows animated state, cargo load, schedule, profit, maintenance, next stop. Presentation checks assert no overlapping controls and legible overlays.

## T9. Adversarial / edge-case fixture pack (what separates a sim from a demo)

Ship as deterministic fixtures, each asserting an invariant:

- **The deadlock layout** (base scenario): a signal arrangement that deadlocks — assert the detector identifies the exact blocked section, trains, and conflicting reservations, and the game does not silently freeze.
- **The platform bottleneck** (base scenario): a freight route into a single-platform station — assert throughput is capped at the platform's service rate and the analytics name it as the bottleneck.
- **The perishable-decay route** (base scenario): a profitable-but-slow ship line carrying perishables — assert deterministic decay before delivery and that decayed cargo is accounted in conservation.
- **The hub demand shift** (base scenario): add an airport hub — assert MCF flows re-distribute and network profit changes as a *computed* result.
- **The commuter-loss line** (base scenario): a town-growing but money-losing line — assert town growth rises while the ledger shows the loss.
- **The MCF determinism canary:** solve demand distribution twice on the same network — assert identical flows; assert the synchronous fixture solver matches the (notionally) threaded one.
- **The bankruptcy edge:** drive the company past its debt threshold — assert deterministic bankruptcy state with conserved money throughout.
- **The save/load equivalence:** snapshot mid-decade, restore from snapshot + remaining command log — assert identical final finances, town sizes, and network state vs the uninterrupted run.

## T10. Global invariants (property-based — this is how the foundation is graded)

Over randomized + scripted runs:

1. **Cargo conservation** — `Σ sourced = Σ in-transit + waiting + delivered + decayed` every tick; no cargo created/destroyed by a transfer, a reservation, or a save/load.
2. **Money conservation (double-entry)** — every ledger movement balances; company balance equals the fold of the ledger; no unpayered revenue, no unrecipiented cost.
3. **Determinism** — `simulate(seed, log, N)` twice ⇒ identical state hashes; the MCF solver is reproducible and order-independent in its inputs but fixed in its tie-breaks.
4. **No undetected deadlock** — for any rail state, the network either makes progress within a bounded horizon or the deadlock detector flags the precise blocked section.
5. **Service-monotone demand** — improving a route's frequency/speed/reliability never *decreases* the demand/rating it earns, all else equal (catches inverted-incentive bugs).
6. **Capacity respected** — no edge/platform/signal-block ever carries more than its capacity in a tick; vehicles never overlap on a reserved block.
7. **Replay fidelity** — command-log replay reproduces identical finances and network metrics (base-spec determinism elevated to an invariant).

Plus a **chaos pass**: randomized build/destroy/reroute/timetable-edit streams interleaved with seeded breakdowns and save/load, asserting 1–7 hold throughout.

## T11. The concrete first vertical slice (the on-ramp — build THIS first, ~45–60 cards)

Prove the spine on **one mode done deeply (rail)** before breadth:

- **Kernel (T1):** virtual clock + calendar, seeded PRNG, fixed-point, world-state hashing.
- **Rail infrastructure graph + YAPF-style A\* (T2)** with signal-aware costs.
- **Path-based signaling + reservation + deadlock detector (T3)** — the highest-risk seam, proven first, with the deadlock fixture green.
- **Realistic-acceleration train physics + scheduler/timetable (T5)** including a single-platform bottleneck.
- **A minimal cargodist MCF (T4)** over a few stations with a *synchronous fixture solver*, demand responding to service, and perishable decay on one cargo.
- **Double-entry economy (T6)**: construction/operating costs, distance-and-speed-priced revenue, one town that grows with delivered cargo, a loan + bankruptcy threshold.
- **One seeded event (T7):** a supply-chain shock with a computed downstream profit effect.
- **Replay/save (T0/T10):** command-log record + replay reaching identical finances; snapshot/restore equivalence.
- **Polished rail slice view (T8):** beautiful readable map, animated trains interpolated between ticks, track/signal placement with cost + reservation preview, a route/profit overlay and a link-graph flow overlay, a professional vehicle panel.
- **Green:** the T9 deadlock + platform-bottleneck + perishable + MCF-determinism fixtures and the T10 cargo + money conservation + determinism + no-deadlock invariants, under `npm test` with zero wall-clock/random/network/live-map dependence.

Road, ship, and air then reuse the same A* core, reservation/queue patterns, and economy.

## T12. Domain knowledge-debt to track (surface, don't bluff)

- **Pathfinding fidelity vs cost:** YAPF-style A* with full per-tile costs is expensive; document the network-size budget the first slice targets and where region/segment abstraction (like ship water-regions) or caching is required — and the determinism cost of any threading.
- **MCF accuracy/perf tradeoff:** the multi-commodity-flow solver is NP-hard; the chosen accuracy/iteration budget is a balance knob with gameplay consequences — flag it as designer-tunable and document that the fixture solver is a deterministic stand-in for a threaded production solver.
- **Economic constants** (cargo prices, decay rates, town-growth thresholds, maintenance costs, loan terms) are *balance numbers* borrowed from a reference; flag as tunable with cited provenance, not as ground truth.
- **Signal semantics scope:** the first slice models path-based signaling; pre-signals, two-way/one-way block signals, and advanced junction patterns are future work — name the boundary.
- **Map representation:** tile-grid vs node-link is a foundational choice with downstream cost; document why the slice chose what it chose and the migration cost if it must change.
- **Accessibility:** route colors and overlay heatmaps need colorblind-safe palettes and redundant (non-color) encoding for flow/congestion; flag for a11y review.

## T13. Why this is a great !Klein challenge

This stresses precisely what !Klein must prove with small local models: **decomposition** of a layered system (kernel → graph → signaling → MCF demand → physics → economy → presentation) where the dependency order is unforgiving and the hardest seam (rail reservation/deadlock) must be proven first, not last; **determinism under weak models** (the conservation, no-deadlock, and replay invariants are pass/fail and catch any fuzzy shortcut — a model cannot bluff "the trains mostly don't crash"); **non-trivial algorithmic correctness** (a real A* and a real multi-commodity-flow solver, not CRUD); and **legible, evidence-backed reasoning** (every profit number traces to distance × speed × ledger, every routing decision to the solved flow, every deadlock to a named reservation cycle). The graph-simulation spine is rich enough to be a genuine test yet bounded enough for a swarm to build incrementally. Build the kernel, rail graph, signaling/deadlock, and conservation invariants first (T1–T3, T10–T11); earn the rest.

---

## Small-model build guide (3B-ready)

This section makes the spec mechanically buildable by a tiny (~3B-parameter) local model. Every card is sized for one focused implementation step. Follow it literally; do not infer unstated requirements.

### 1. Glossary & ground rules

**Domain terms:**
- **Tick** — one logical simulation step. The virtual clock is the only time source in `src/`. Never call `Date.now()` or `performance.now()` in simulation code.
- **Fixed** — a branded integer type (`number & { __fixed: true }`) representing real values scaled by 1000 (i.e. `Fixed(1000)` = 1.0 real unit). Use it for positions, speeds, and money. Never mix raw `number` arithmetic with `Fixed` in `src/core/` or `src/sim/`.
- **Calendar** — a logical year/month/day counter mapped onto ticks. `TICKS_PER_DAY = 74` (balance constant, designer-tunable; document provenance).
- **Rail graph** — a directed multigraph where nodes are junctions/stations and edges are track segments. Each edge has: length (Fixed), track type, max speed, and a `signalState: 'clear'|'reserved'|'danger'`.
- **Reservation** — when a train commits to entering a track segment, it creates a `Reservation { trainId, segmentId, entryTick }`. The reservation is released when the train exits the segment. Only one train may hold a reservation on a segment at any tick.
- **Path-based signal (PBS)** — a signal that grants entry to a *path* (series of segments) reserved ahead by the entering train, not just to the next block. A second train may share the same block if its reserved path is conflict-free.
- **Deadlock** — a state where two or more trains each hold a reservation the other needs, forming a cycle in the reservation wait-graph. The deadlock detector finds this cycle and reports it.
- **YAPF A\*** — the pathfinding algorithm. One open/closed A* search loop, specialized per transport mode via a `NodeFollower` interface. Cost = time (distance / speed), not distance.
- **MCF (multi-commodity flow)** — the demand solver. Given a set of (origin, destination) cargo pairs and a capacity-limited network of links, it solves the flow distribution that maximizes delivered cargo. The first-slice version uses a synchronous fixture solver (no threads).
- **Link graph** — nodes = stations, edges = routes actually served by the player's vehicles. MCF runs on the link graph, not the rail graph.
- **Cargo conservation** — `Σ sourced = Σ in-transit + waiting_at_stations + delivered + decayed` at every tick. No cargo created or destroyed by a transfer, a reservation, or a save/load.
- **Double-entry ledger** — every financial event posts both a debit and a credit. `company.balance = fold(ledger)`, never a free-floating counter.
- **Perishable** — cargo with a `decayTicksMax` field. If `currentTick - sourcedTick > decayTicksMax`, the cargo decays in transit and is accounted as `decayed` in the conservation invariant (not silently dropped).
- **Station rating** — a derived metric [0–100] driven by service frequency, average waiting time, vehicle speed, and reliability. Gates how much waiting cargo is offered to vehicles.
- **Command log** — the append-only list of player-issued commands (`PlaceTrack`, `BuildStation`, `SetRoute`, `OrderTrain`, …) with tick timestamps. The log + seed is the save file.

**Stack:**
- Language: TypeScript (strict mode, no `any`).
- Runtime: Node.js (current LTS).
- Test runner: Vitest (`npm test` runs `vitest run`).
- No DOM or canvas in `src/core/` or `src/sim/`. The renderer is in `src/renderer/`.
- All acceptance tests: pure in-memory, no network, no `Date.now()`, no `Math.random()`. Use the seeded PRNG adapter.

**Acceptance command (plain steps):**
1. `cd` to the project root.
2. Run `npm test`.
3. All Vitest test suites must pass with exit code 0. No test may call the network, read the filesystem, or use wall-clock time.

**Determinism rules (imperative):**
- Never call `Math.random()` anywhere in `src/`. Use `createSeededPrng(seed)` from `src/core/prng.ts`.
- Never call `Date.now()` in `src/`. Use `world.tick`.
- Never iterate a Map or Set for update order without first sorting the keys.
- All money and position values in `src/core/` use the `Fixed` type; never raw `number` arithmetic.
- The MCF solver (T4) runs synchronously in tests; it must produce identical output for identical inputs. Sort node/edge ids before every solver pass.

---

### 2. The explicit task graph for the first vertical slice

The first slice covers T1 (kernel) + T2 (rail graph + A*) + T3 (PBS + deadlock) + T5 (train physics + scheduler) + T4 (MCF MVP) + T6 (economy) + T7 (one seeded event) + T0/T10 replay/save + T8 polished view. Target: ~46 cards. Build in the order below.

---

**`R01` — Fixed-point newtype and money helpers**
dependsOn: none
files: `src/core/fixed.ts`, `test/core/fixed.test.ts`
interface:
```ts
export type Fixed = number & { __fixed: true };
export function toFixed(n: number): Fixed;       // Math.round(n * 1000) as Fixed
export function fromFixed(f: Fixed): number;     // f / 1000
export function addFixed(a: Fixed, b: Fixed): Fixed;
export function subFixed(a: Fixed, b: Fixed): Fixed;
export function mulFixed(a: Fixed, scalar: number): Fixed; // scalar is integer
export function divFixed(a: Fixed, divisor: number): Fixed; // divisor is integer, truncates
export const ZERO_FIXED: Fixed;
export const ONE_FIXED: Fixed;   // 1000
```
how to implement:
1. Scale factor = 1000 (milliunits): 1 km = 1000 Fixed, 1 credit = 1000 Fixed.
2. `toFixed(n)` = `(Math.round(n * 1000)) as Fixed`.
3. All arithmetic is integer; no float in the result.
acceptance: `test/core/fixed.test.ts` asserts:
- `toFixed(1.5) === 1500`
- `addFixed(toFixed(1), toFixed(2)) === 3000`
- `subFixed(toFixed(3), toFixed(1)) === 2000`
- `mulFixed(toFixed(2), 3) === 6000`
- `divFixed(toFixed(6), 4) === 1500`
Run `npm test` → green.

---

**`R02` — Seeded PRNG**
dependsOn: none
files: `src/core/prng.ts`, `test/core/prng.test.ts`
interface:
```ts
export interface SeededPrng { next(): number; nextInt(lo: number, hi: number): number; }
export function createSeededPrng(seed: number): SeededPrng;
```
how to implement: xorshift32 or mulberry32; `next()` returns float in [0,1); `nextInt` = `Math.floor(lo + next() * (hi - lo + 1))`.
acceptance:
- Two `createSeededPrng(7)` instances produce identical 10-call sequences.
- `nextInt(0, 99)` in range for 20 calls.
Run `npm test` → green.

---

**`R03` — World state and virtual clock**
dependsOn: `R01`, `R02`
files: `src/core/world.ts`, `test/core/world.test.ts`
interface:
```ts
export interface WorldState {
  tick: number;
  seed: number;
  calendar: { day: number; month: number; year: number };
  entities: Map<number, Entity>;
  nextEntityId: number;
  railSegments: Map<number, RailSegment>;
  nextSegmentId: number;
  stations: Map<number, Station>;
  nextStationId: number;
  ledger: LedgerEntry[];
  companyBalance: Fixed;
}
export type Entity = TrainEntity; // union expanded in later cards
export interface RailSegment { id: number; /* fields added in R05 */ }
export interface Station { id: number; /* fields added in R07 */ }
export interface LedgerEntry { tick: number; amount: Fixed; description: string; }
export function createWorld(seed: number): WorldState;
export function advanceTick(world: WorldState): void; // just increments tick; full logic in R14
export const TICKS_PER_DAY = 74; // balance constant
```
how to implement: factory creates empty maps/arrays, tick = 0, seed = seed, calendar starts at year 1, month 1, day 1. `advanceTick` increments tick; every `TICKS_PER_DAY` ticks, advance calendar.
acceptance:
- `createWorld(5).tick === 0`
- After 74 `advanceTick` calls, `world.calendar.day === 2`
Run `npm test` → green.

---

**`R04` — World-state hash**
dependsOn: `R03`
files: `src/core/hash.ts`, `test/core/hash.test.ts`
interface:
```ts
export function hashWorldState(world: WorldState): string;
```
how to implement: stable JSON (sort Map entries by key), djb2/FNV-1a hash, hex string. No crypto dependency.
acceptance:
- Two identical worlds → identical hash.
- Worlds at tick 0 and tick 1 → different hash.
- Hash is stable across two calls on same world.
Run `npm test` → green.

---

**`R05` — Rail segment graph (directed multigraph)**
dependsOn: `R03`, `R01`
files: `src/core/rail-graph.ts`, `test/core/rail-graph.test.ts`
interface:
```ts
export interface RailSegment {
  id: number;
  fromNodeId: number;
  toNodeId: number;
  length: Fixed;        // in km (Fixed units)
  maxSpeedKmh: Fixed;   // design constant for this segment
  trackType: 'single' | 'double';
  signalIds: number[];  // PBS signal ids on this segment
}
export interface RailNode {
  id: number;
  x: number; y: number;   // map tile coordinates
  kind: 'junction' | 'station';
  stationId?: number;
}
export function addRailNode(world: WorldState, id: number, x: number, y: number, kind: RailNode['kind']): RailNode;
export function addRailSegment(world: WorldState, id: number, fromNodeId: number, toNodeId: number, lengthKm: number, maxSpeedKmh: number): RailSegment;
export function getSegmentNeighbors(world: WorldState, nodeId: number): RailSegment[]; // outgoing from nodeId
```
how to implement: store `railSegments` and `railNodes` maps. `getSegmentNeighbors` filters segments by `fromNodeId`.
acceptance:
- Add 3 nodes and 2 segments forming A→B→C; `getSegmentNeighbors(B)` returns the B→C segment.
- Segment lengths round-trip correctly through Fixed.
Run `npm test` → green.

---

**`R06` — YAPF A* pathfinder (rail mode)**
dependsOn: `R05`, `R01`
files: `src/core/pathfinder.ts`, `test/core/pathfinder.test.ts`
interface:
```ts
export interface PathResult {
  segmentIds: number[];   // ordered list of segment ids from origin to destination
  totalCostTicks: Fixed;  // total estimated travel time in ticks
}
export interface NodeFollower {
  neighbors(nodeId: number): { segmentId: number; nextNodeId: number; costTicks: Fixed }[];
}
export function runAstar(
  follower: NodeFollower,
  startNodeId: number,
  goalNodeId: number,
  heuristic: (nodeId: number) => Fixed,  // admissible: never overestimates
): PathResult | null;
export function makeRailFollower(world: WorldState, trainSpeedKmh: Fixed): NodeFollower;
// Edge cost = segment.length / min(trainSpeed, segment.maxSpeed) * TICKS_PER_KM
export function makeRailHeuristic(world: WorldState, goalNodeId: number): (nodeId: number) => Fixed;
// Euclidean distance / max rail speed → admissible lower bound
```
how to implement:
1. `runAstar`: standard A* with a min-heap (use a sorted array for simplicity). Open/closed sets. Break ties by stable node id.
2. `makeRailFollower`: returns a NodeFollower whose `neighbors` calls `getSegmentNeighbors` and computes cost = `length / speed * TICKS_PER_KM` (all Fixed arithmetic).
3. Define `TICKS_PER_KM = TICKS_PER_DAY / 100` as a balance constant.
acceptance:
- A→B→C straight line: `runAstar` finds path of 2 segments in correct order.
- A graph with no route from A to D returns null.
- The path is deterministic: same graph + same parameters → same path, regardless of call count.
- A graph with two routes (short-but-slow and long-but-fast): A* returns the faster route by tick cost.
Run `npm test` → green.

---

**`R07` — Station entity and platform reservation queue**
dependsOn: `R05`
files: `src/core/station.ts`, `test/core/station.test.ts`
interface:
```ts
export interface Station {
  id: number;
  nodeId: number;
  name: string;
  platforms: Platform[];
  waitingCargo: CargoUnit[];  // queued cargo waiting to board
}
export interface Platform {
  id: number;
  capacity: number;           // max trains that can be serviced simultaneously
  occupyingTrainIds: number[];
}
export interface CargoUnit {
  id: number;
  itemType: string;
  qty: number;
  sourcedTick: number;
  decayTicksMax: number | null;  // null = non-perishable
  destinationStationId: number;
}
export function addStation(world: WorldState, id: number, nodeId: number, name: string, platformCount: number): Station;
export function tryOccupyPlatform(station: Station, trainId: number): boolean;
export function releasePlatform(station: Station, trainId: number): void;
export function countWaitingCargo(station: Station): number;
```
how to implement:
1. Platforms start with empty `occupyingTrainIds` arrays.
2. `tryOccupyPlatform`: if any platform has `occupyingTrainIds.length < capacity`, push trainId, return true; else return false.
3. `releasePlatform`: find platform with trainId, remove it.
acceptance:
- A 1-platform station with capacity 1: first `tryOccupyPlatform` returns true; second returns false.
- After `releasePlatform`, a new `tryOccupyPlatform` returns true.
- `countWaitingCargo` returns correct count after pushing to `waitingCargo`.
Run `npm test` → green.

---

**`R08` — PBS reservation system**
dependsOn: `R05`, `R06`
files: `src/core/reservation.ts`, `test/core/reservation.test.ts`
interface:
```ts
export interface Reservation {
  trainId: number;
  segmentId: number;
  entryTick: number;
}
export interface ReservationTable {
  bySegment: Map<number, Reservation>;  // segmentId → current holder (at most one)
}
export function createReservationTable(): ReservationTable;
export function tryReserveSegment(table: ReservationTable, trainId: number, segmentId: number, tick: number): boolean;
export function releaseSegment(table: ReservationTable, segmentId: number, trainId: number): void;
export function isSegmentReserved(table: ReservationTable, segmentId: number): boolean;
export function reservePath(table: ReservationTable, trainId: number, path: PathResult, tick: number): boolean;
// Atomically reserves all segments in path; if any is already reserved, reserves none and returns false.
```
how to implement:
1. `tryReserveSegment`: if segment not in `bySegment`, insert, return true; else if `bySegment.get(seg)!.trainId === trainId`, return true (idempotent); else return false.
2. `reservePath`: check all segments first (none reserved by another), then reserve all. Atomic: either all succeed or none (release any partially-reserved on failure).
acceptance:
- Two trains competing for the same segment: only one succeeds.
- `reservePath` for a 3-segment path: if segment 2 is taken, no segments are reserved.
- Release then re-acquire: succeeds.
Run `npm test` → green.

---

**`R09` — Deadlock detector**
dependsOn: `R08`
files: `src/core/deadlock.ts`, `test/core/deadlock.test.ts`
interface:
```ts
export interface DeadlockReport {
  detected: boolean;
  cycleTrainIds: number[];    // trains in the deadlock cycle, in cycle order
  blockedSegmentIds: number[]; // segments each train needs but cannot get
}
export function detectDeadlock(
  table: ReservationTable,
  waitingFor: Map<number, number[]>, // trainId → segmentIds it is trying to reserve
): DeadlockReport;
```
how to implement:
1. Build a wait-graph: node = train, directed edge from A to B if train A is waiting for a segment held by train B.
2. Run DFS cycle detection (iterative, not recursive, to avoid stack overflow). Visit nodes in ascending trainId order for determinism.
3. Return the first cycle found (ordered by trainId in the cycle).
acceptance:
- A→B→A wait cycle → `detected: true`, both train ids in `cycleTrainIds`.
- A→B→C (no cycle) → `detected: false`.
- The same inputs always produce the same cycle order (determinism test: call twice, compare).
Run `npm test` → green.

---

**`R10` — Train entity and realistic-acceleration physics**
dependsOn: `R05`, `R01`
files: `src/core/train.ts`, `test/core/train.test.ts`
interface:
```ts
export const TICKS_PER_KM = 74; // = TICKS_PER_DAY / 100; balance constant
export interface TrainEntity {
  kind: 'train';
  id: number;
  currentSegmentId: number | null;
  positionOnSegment: Fixed;   // 0..segment.length
  speedKmh: Fixed;
  maxSpeedKmh: Fixed;
  tractiveEffort: Fixed;      // max tractive force (Fixed units; balance constant)
  mass: Fixed;                // balance constant; affects acceleration
  cargo: CargoUnit[];
  cargoCapacity: number;
  scheduledRouteId: number | null;
  state: TrainState;
}
export type TrainState = 'moving' | 'loading' | 'waiting_platform' | 'waiting_signal' | 'stopped';
export function createTrain(world: WorldState, id: number, maxSpeedKmh: number, tractiveEffort: number, mass: number): TrainEntity;
export function trainPhysicsTick(train: TrainEntity, segment: RailSegment | null): void;
// Applies one tick of acceleration: F_net = tractiveEffort - rollingResistance; v += F_net/mass; v clamped to maxSpeedKmh and segment.maxSpeedKmh; position += v * (1/TICKS_PER_KM)
```
how to implement:
1. All arithmetic in Fixed. `rollingResistance` = `mulFixed(mass, 5)` (5 Fixed-millinewtons per kg; balance constant).
2. `trainPhysicsTick` when `train.state !== 'moving'` is a no-op.
3. Advance `positionOnSegment` by `divFixed(speedKmh, TICKS_PER_KM)` each tick (in Fixed arithmetic).
acceptance:
- A train starting at speed 0 on a 10 km segment reaches speed > 0 after 10 ticks.
- Speed is clamped to `min(maxSpeedKmh, segment.maxSpeedKmh)`.
- `positionOnSegment` advances monotonically while moving.
- Two identical trains on identical segments reach identical positions after 100 ticks (determinism).
Run `npm test` → green.

---

**`R11` — Train scheduler and timetable**
dependsOn: `R10`, `R07`, `R08`
files: `src/core/scheduler.ts`, `test/core/scheduler.test.ts`
interface:
```ts
export interface Route {
  id: number;
  stopStationIds: number[];   // ordered loop
  headwayTicks: number;       // target spacing between trains
  loadingCondition: 'timed' | 'full-load';
  loadingTimeTicks: number;   // max ticks to wait when condition = 'timed'
}
export interface ScheduleState {
  currentStopIndex: number;
  loadingTimer: number;
  pathToNextStop: PathResult | null;
  pathSegmentIndex: number;
}
export function createScheduleState(): ScheduleState;
export function schedulerTick(
  train: TrainEntity,
  schedule: ScheduleState,
  route: Route,
  world: WorldState,
  table: ReservationTable,
  follower: NodeFollower,
  heuristic: (nodeId: number) => Fixed,
): void;
// State machine: find path → reserve → move → arrive → load → depart
```
how to implement:
1. If `pathToNextStop` is null, compute A* to the next stop station; store path.
2. Try to reserve the next segment via `reservePath`; if failed, set `train.state = 'waiting_signal'` and return.
3. If reserved, advance train physics one tick; when `positionOnSegment >= segment.length`, release the segment reservation, move to the next segment in the path.
4. When the last segment arrives at the destination station, try `tryOccupyPlatform`; if failed, set `train.state = 'waiting_platform'`.
5. When platform acquired, enter `train.state = 'loading'`; decrement `loadingTimer`; when timer reaches 0 (or `full-load` condition met), advance `currentStopIndex`, release platform, set `pathToNextStop = null`.
acceptance:
- A train on a 2-stop A→B→A route completes one round trip in a bounded tick window (proportional to route length / speed). Exact tick count is deterministic and golden-locked.
- A second train on the same route does not deadlock (A* finds distinct reserved paths or waits).
Run `npm test` → green.

---

**`R12` — Cargo conservation invariant setup**
dependsOn: `R07`, `R10`
files: `src/core/cargo-conservation.ts`, `test/core/cargo-conservation.test.ts`
interface:
```ts
export function countCargoInWorld(world: WorldState): number;
// Sum of: cargo in all train entities + cargo waiting at all stations + delivered cargo total (pass as parameter)
export function assertCargoConservation(
  world: WorldState,
  sourcedTotal: number,
  deliveredTotal: number,
  decayedTotal: number,
): void; // throws if Σsourced !== Σin-transit + Σwaiting + deliveredTotal + decayedTotal
```
how to implement:
1. Walk all entities for trains; walk all stations.
2. `assertCargoConservation` computes `inTransitAndWaiting = countCargoInWorld(world)` and asserts `sourcedTotal === inTransitAndWaiting + deliveredTotal + decayedTotal`.
acceptance:
- A scenario where 10 cargo units are sourced, 4 delivered, 2 decayed: `assertCargoConservation(world, 10, 4, 2)` passes when 4 remain in-transit/waiting, throws when counts are wrong.
Run `npm test` → green.

---

**`R13` — Perishable decay**
dependsOn: `R12`
files: `src/core/perishable.ts`, `test/core/perishable.test.ts`
interface:
```ts
export function applyPerishableDecay(
  cargo: CargoUnit[],
  currentTick: number,
  decayedAccumulator: { count: number },
): CargoUnit[]; // returns surviving cargo; increments decayedAccumulator.count for each decayed unit
```
how to implement:
1. Filter the array: keep units where `decayTicksMax === null || currentTick - sourcedTick <= decayTicksMax`.
2. Increment `decayedAccumulator.count` for each removed unit.
3. This function is pure: takes and returns arrays; no world mutation.
acceptance:
- A perishable sourced at tick 0 with `decayTicksMax = 10` survives at tick 9, decays at tick 11.
- A non-perishable (`decayTicksMax = null`) never decays.
- Decayed count accumulates correctly.
Run `npm test` → green.

---

**`R14` — Full tick dispatcher**
dependsOn: `R11`, `R12`, `R13`
files: `src/core/tick.ts`, `test/core/tick-order.test.ts`
interface:
```ts
export function runTick(world: WorldState, routes: Map<number, Route>, table: ReservationTable, deliveryAccum: { count: number }, decayAccum: { count: number }): void;
// Phase order: (1) physics for all trains (ascending id), (2) scheduler for all trains, (3) perishable decay on all cargo in transit, (4) station ratings update, (5) world.tick++
```
how to implement:
1. Collect train entity ids into a sorted array; iterate.
2. Phase 1: call `trainPhysicsTick` for each.
3. Phase 2: call `schedulerTick` for each.
4. Phase 3: for each train's cargo, call `applyPerishableDecay`; for each station's waiting cargo, call `applyPerishableDecay`.
5. Phase 4: recompute station ratings (a simple formula: `rating = clamp(100 - waitingCargo * 2, 0, 100)` — balance constant; document).
6. Increment `world.tick` and update `world.calendar`.
acceptance: `test/core/tick-order.test.ts` asserts:
- Cargo conservation holds after every tick in a 200-tick scenario (using `assertCargoConservation`).
- Two replays of the same command log produce identical `hashWorldState` at ticks 50, 100, 200.
Run `npm test` → green.

---

**`R15` — Double-entry ledger**
dependsOn: `R03`, `R01`
files: `src/core/ledger.ts`, `test/core/ledger.test.ts`
interface:
```ts
export function postLedger(world: WorldState, amount: Fixed, description: string): void;
// Positive amount = revenue (credit), negative = cost (debit). Appends to world.ledger and updates world.companyBalance.
export function assertLedgerBalance(world: WorldState): void;
// Throws if world.companyBalance !== fold(world.ledger)
```
how to implement:
1. `postLedger`: push `{ tick: world.tick, amount, description }` to `world.ledger`; add amount to `world.companyBalance`.
2. `assertLedgerBalance`: fold `world.ledger` by summing `amount`; assert === `world.companyBalance`.
acceptance:
- Post +500, -200: balance = 300.
- `assertLedgerBalance` passes.
- Post -400: balance = -100; `assertLedgerBalance` passes.
- Manually corrupt `world.companyBalance` to 999: `assertLedgerBalance` throws.
Run `npm test` → green.

---

**`R16` — Distance-and-speed-priced cargo revenue**
dependsOn: `R15`, `R01`
files: `src/core/revenue.ts`, `test/core/revenue.test.ts`
interface:
```ts
export function computeCargoRevenue(
  qty: number,
  distanceKm: Fixed,
  deliverySpeedKmh: Fixed,  // average speed over the route
  cargoBaseRate: Fixed,     // balance constant per unit per km
): Fixed;
// revenue = qty * distanceKm * baseRate * speedFactor
// speedFactor = clamp(deliverySpeedKmh / REFERENCE_SPEED_KMH, 0.5, 2.0) (Fixed arithmetic)
export const REFERENCE_SPEED_KMH: Fixed; // = toFixed(60); balance constant
```
how to implement: pure function; all Fixed arithmetic; `speedFactor` computed as `divFixed(deliverySpeedKmh, fromFixed(REFERENCE_SPEED_KMH))` clamped to [500, 2000] in Fixed-milliunit terms.
acceptance:
- At reference speed, revenue = `qty * distanceKm * baseRate * 1.0`.
- At double reference speed, revenue = `qty * distanceKm * baseRate * 2.0`.
- At zero speed, revenue is clamped to 50% of base.
- Result is identical across two calls with same inputs (determinism).
Run `npm test` → green.

---

**`R17` — Town growth model**
dependsOn: `R15`, `R03`
files: `src/core/town.ts`, `test/core/town.test.ts`
interface:
```ts
export interface Town {
  id: number;
  name: string;
  population: number;
  cargoDeliveredThisMonth: number;  // reset each calendar month
  growthRate: Fixed;                // derived; updated in growth pass
}
export function updateTownGrowth(town: Town, worldTick: number): void;
// Each tick: town.population += round(town.growthRate * town.cargoDeliveredThisMonth / 1000)
// growthRate decays by 1% each tick if no cargo delivered (bounded convergence)
export function recordCargoDelivery(town: Town, qty: number): void;
```
how to implement:
1. `updateTownGrowth`: update population and decay `growthRate` if `cargoDeliveredThisMonth === 0`.
2. At each calendar month reset, zero `cargoDeliveredThisMonth`.
3. Population has a floor of 100 (never below 100).
acceptance:
- A town with 0 deliveries: population stays flat (growthRate decays toward 0).
- A town with 50 cargo/month: population grows each month.
- Population is conserved across save/load (no silent creation/destruction).
Run `npm test` → green.

---

**`R18` — MCF fixture solver (synchronous, T4 MVP)**
dependsOn: `R07`, `R05`
files: `src/core/mcf-solver.ts`, `test/core/mcf-solver.test.ts`
interface:
```ts
export interface LinkGraphEdge {
  fromStationId: number;
  toStationId: number;
  capacityUnits: number;   // max cargo units per tick this link can carry
}
export interface DemandPair {
  originStationId: number;
  destStationId: number;
  qty: number;
}
export interface McfSolution {
  flows: Map<string, number>; // key = `${fromId}→${toId}`, value = units routed per tick
}
export function solveMcfFixture(
  edges: LinkGraphEdge[],
  demands: DemandPair[],
): McfSolution;
// Greedy successive-shortest-path solver; deterministic: sort edges/demands by id before each pass.
```
how to implement:
1. Implement a greedy successive-shortest-path approximation: repeatedly route the highest-demand pair along the shortest available path (by segment count), decrement capacity, stop when no more demand or capacity. Sort `demands` by qty descending before each pass; sort `edges` by `fromStationId` then `toStationId` for determinism.
2. Note in a code comment: `KNOWLEDGE_DEBT: full MCF is NP-hard; this greedy solver is a deterministic approximation sufficient for the first slice; a production solver would use a min-cost-flow algorithm`.
3. Return the flow map.
acceptance:
- A 2-station, 1-edge network with demand 10 and capacity 10 routes all 10 units.
- A 3-station, 2-edge network routes demand along the higher-capacity path.
- Two calls with identical inputs return identical `McfSolution` (determinism).
Run `npm test` → green.

---

**`R19` — Command log and replay skeleton**
dependsOn: `R03`, `R04`
files: `src/core/command-log.ts`, `test/core/command-log.test.ts`
interface:
```ts
export type GameCommand =
  | { kind: 'PlaceTrack'; tick: number; fromNodeId: number; toNodeId: number; lengthKm: number }
  | { kind: 'BuildStation'; tick: number; stationId: number; nodeId: number; name: string; platforms: number }
  | { kind: 'OrderTrain'; tick: number; trainId: number; routeId: number }
  | { kind: 'SetRoute'; tick: number; routeId: number; stopStationIds: number[] };
export interface CommandLog { commands: GameCommand[]; seed: number; }
export function createCommandLog(seed: number): CommandLog;
export function appendCommand(log: CommandLog, cmd: GameCommand): void;
export function replayCommandLog(
  log: CommandLog,
  totalTicks: number,
  applyCommand: (world: WorldState, cmd: GameCommand) => void,
  routes: Map<number, Route>,
  table: ReservationTable,
  deliveryAccum: { count: number },
  decayAccum: { count: number },
): WorldState;
```
how to implement: same replay pattern as factory spec (create fresh world, loop ticks, apply commands by tick, call `runTick`).
acceptance:
- Empty log, 10 ticks → `world.tick === 10`.
- Two replays of same log → identical `hashWorldState`.
Run `npm test` → green.

---

**`R20` — Deadlock fixture (T9 adversarial)**
dependsOn: `R09`, `R11`
files: `test/core/deadlock-fixture.test.ts`
interface: (test only)
how to implement:
1. Build a minimal graph: two single-track segments A→B and B→A, two trains each trying to travel in opposite directions on the single track.
2. Advance ticks until either (a) both trains are in `waiting_signal` state and `detectDeadlock` returns `detected: true`, or (b) 500 ticks elapse.
3. Assert `detected === true` within 500 ticks.
4. Assert the `blockedSegmentIds` includes both segments (both trains are blocked).
5. Assert cargo conservation throughout (no cargo lost while deadlocked).
acceptance: All assertions pass. Run `npm test` → green.

---

**`R21` — Platform-bottleneck fixture (T9 adversarial)**
dependsOn: `R11`, `R07`
files: `test/core/platform-bottleneck.test.ts`
interface: (test only)
how to implement:
1. Build a 1-platform station with capacity 1; send 3 trains on the same route passing through it.
2. Assert that at any given tick, at most 1 train is in `loading` state at that station.
3. Assert throughput (deliveries per 300 ticks) is ≤ `floor(300 / loadingTimeTicks)` (bounded by platform).
acceptance: All assertions pass. Run `npm test` → green.

---

**`R22` — Perishable-decay route fixture (T9 adversarial)**
dependsOn: `R13`, `R14`
files: `test/core/perishable-route.test.ts`
interface: (test only)
how to implement:
1. Source 5 cargo units with `decayTicksMax = 50` at station A; route them via a slow train (maxSpeedKmh = 20) on a 3 km segment.
2. Assert: at least 1 unit decays before delivery (route is slow enough).
3. Assert `assertCargoConservation` holds: decayedAccum.count + deliveredAccum.count + in-transit = 5 at every tick.
acceptance: All assertions pass. Run `npm test` → green.

---

**`R23` — MCF determinism canary (T9)**
dependsOn: `R18`
files: `test/core/mcf-determinism.test.ts`
interface: (test only)
how to implement: call `solveMcfFixture` twice with identical inputs; assert flows are deeply equal.
acceptance: passes. Run `npm test` → green.

---

**`R24` — Bankruptcy edge fixture (T9)**
dependsOn: `R15`, `R14`
files: `test/core/bankruptcy.test.ts`
interface: (test only)
how to implement:
1. Post a series of large negative ledger entries to push `world.companyBalance` below a `BANKRUPTCY_THRESHOLD` constant (`toFixed(-1_000_000)`; balance constant).
2. Assert `assertLedgerBalance` still passes (money is conserved even in bankruptcy).
3. Assert the world has a detectable `bankrupt: boolean` flag set by a check in `runTick`.
acceptance: All assertions pass. Run `npm test` → green.

---

**`R25` — Save/load equivalence**
dependsOn: `R19`, `R14`
files: `test/core/save-load.test.ts`
interface: (test only)
how to implement:
1. Run a 100-tick scenario; snapshot `hashWorldState` at tick 100 as `hashA`.
2. Reset to tick 50 (replay the command log to tick 50); then continue with the remaining commands to tick 100; snapshot as `hashB`.
3. Assert `hashA === hashB`.
acceptance: passes. Run `npm test` → green.

---

**`R26` — Cargo conservation chaos pass (T10 invariant 1)**
dependsOn: `R14`, `R12`
files: `test/core/conservation-chaos.test.ts`
interface: (test only)
how to implement: 300-tick randomized scenario (seeded PRNG seed 99); use `assertCargoConservation` every tick.
acceptance: all 300 assertions pass. Run `npm test` → green.

---

**`R27` — Renderer abstraction boundary**
dependsOn: `R14`
files: `src/renderer/render-types.ts`, `test/renderer/render-boundary.test.ts`
interface:
```ts
export interface TrainRenderState { id: number; x: number; y: number; speedKmh: number; state: TrainState; cargoQty: number; }
export interface StationRenderState { id: number; x: number; y: number; waitingCargo: number; rating: number; }
export interface RenderSnapshot { tick: number; trains: TrainRenderState[]; stations: StationRenderState[]; balance: number; }
export function buildRenderSnapshot(world: WorldState): RenderSnapshot;
// Converts Fixed to float, never mutates world.
```
how to implement: read world, convert, return plain object.
acceptance: snapshot from a world with 2 trains and 1 station has correct counts; two calls = same result.
Run `npm test` → green.

---

**`R28` — Interpolated rendering and polished map scaffold (T8)**
dependsOn: `R27`
files: `src/renderer/interpolation.ts`, `src/renderer/canvas-renderer.ts`, `test/renderer/interpolation.test.ts`
interface:
```ts
export function interpolateSnapshot(prev: RenderSnapshot, next: RenderSnapshot, alpha: number): RenderSnapshot;
export interface MapRenderer { drawFrame(snap: RenderSnapshot, canvas: HTMLCanvasElement): void; }
export function createMapRenderer(): MapRenderer;
```
how to implement:
1. `interpolateSnapshot`: lerp train x/y between prev and next at alpha. Other fields copy from next.
2. `createMapRenderer`: draws colored shapes for trains (circles), stations (squares), routes (lines). Non-empty visuals. No `requestAnimationFrame` inside.
acceptance: `test/renderer/interpolation.test.ts` checks alpha=0 gives prev positions, alpha=1 gives next, alpha=0.5 is midpoint.
Run `npm test` → green.

---

**`R29` — Full slice integration test (T11 green gate)**
dependsOn: `R14`, `R20`, `R21`, `R22`, `R23`, `R24`, `R25`, `R26`, `R28`
files: `test/integration/slice.test.ts`
interface: (test only)
how to implement:
1. Build a 3-station, 2-train rail scenario; source 20 cargo units; run 400 ticks.
2. Assert cargo conservation every tick.
3. Assert two replays produce identical hash at ticks 100, 200, 400.
4. Assert at least 8 cargo units delivered (throughput lower-bound; golden-lock after first run).
5. Assert `assertLedgerBalance` holds throughout.
acceptance: all assertions pass. Run `npm test` → green.

---

### 3. The decomposition method for the rest

After the first slice is green, use this recipe for road, ship, air modes, full cargodist, and all remaining scenarios.

**Repeatable decomposition recipe:**
1. Name the feature in one sentence. Identify which first-slice types it builds on.
2. Write out the new TypeScript interfaces in full.
3. List the conservation/determinism invariants it must preserve.
4. Break into 2–5 focused cards: types first, pure logic second, integration third, acceptance last.
5. For each card: id, title, dependsOn, files, interface, numbered recipe, acceptance.
6. No card adds more than ~100 lines of production code.

**Worked example A — Road mode (T2 extension):**
- Card `RD01` — `RoadSegment` type: length, maxSpeedKmh, congestion (Fixed 0–1), one-way flag. files: `src/core/road-graph.ts`. Accept: type-checks.
- Card `RD02` — Road `NodeFollower`: cost includes `congestion * slowdown` penalty; implements the same A* interface. files: `src/core/road-graph.ts`. Accept: a congested road costs more than an uncongested road of equal length.
- Card `RD03` — Congestion update: `updateCongestion(segment, vehicleCount)` — congestion = `vehicleCount / capacity` clamped to [0,1]; deterministic (ascending segment-id order). Accept: conservation: total vehicles across road network = spawned − removed.

**Worked example B — Ship and perishable decay expansion (T4):**
- Card `SP01` — `WaterRegion` type: connected-component label for navigable water tiles; ships route between regions. files: `src/core/water-region.ts`. Accept: BFS flood-fill labels water tiles deterministically (sorted-coordinate order).
- Card `SP02` — Ship `NodeFollower`: uses water-region adjacency, not tile-by-tile; cost = region-to-region distance / ship speed. Accept: path avoids land tiles; deterministic.
- Card `SP03` — Perishable-revenue penalty: if cargo age > `decayTicksMax * 0.8` at delivery, revenue is halved. Accept: a slow-ship delivery gets half revenue vs a fast delivery.

**Worked example C — Full cargodist MCF thread-join simulation (T4):**
- Card `MC01` — Scheduled MCF recalculation: add a `mcfRecalcInterval = 300` tick cadence; every 300 ticks, re-run `solveMcfFixture` and update routing tables. Accept: routing table changes between period 0 and period 1 when a new link is added between recalc windows.
- Card `MC02` — MCF determinism with recalc: run two identical worlds through 3 recalc periods; assert identical flow maps at each recalc. Accept: deterministic.
- Card `MC03` — Hub demand shift fixture: add an airport hub midway through the simulation; assert MCF flows redistribute toward the hub and long-distance rail revenue drops. Accept: measurable rail-revenue decrease after hub added.

---

### 4. Per-task implementation conventions

**Folder layout:**
```
src/
  core/          # pure sim logic; no DOM, no canvas, no network
    fixed.ts
    prng.ts
    world.ts
    hash.ts
    command-log.ts
    tick.ts
    rail-graph.ts
    pathfinder.ts
    reservation.ts
    deadlock.ts
    train.ts
    station.ts
    scheduler.ts
    cargo-conservation.ts
    perishable.ts
    ledger.ts
    revenue.ts
    town.ts
    mcf-solver.ts
  renderer/      # view layer; may use floats; never writes WorldState
    render-types.ts
    interpolation.ts
    canvas-renderer.ts
test/
  core/
  renderer/
  integration/
```

**Naming conventions:**
- Types: PascalCase. Pure functions: camelCase verb-noun. Test files: mirror source, `.test.ts`. Constants: SCREAMING_SNAKE_CASE with a `// balance constant` comment.

**How to write a test (Vitest):**
```ts
import { describe, it, expect } from 'vitest';
import { toFixed, addFixed } from '../../src/core/fixed.js';

describe('Fixed arithmetic', () => {
  it('adds correctly', () => {
    expect(addFixed(toFixed(1), toFixed(2))).toBe(toFixed(3));
  });
});
```

**How to keep it deterministic:**
- Thread the seeded PRNG explicitly everywhere randomness is needed.
- Sort all Map/Set keys before iterating for update order.
- Use Fixed arithmetic in `src/core/`; convert to float only in `src/renderer/`.
- The renderer reads `RenderSnapshot`; it must never write into `WorldState`.

**Definition of done for any card:**
- All files in `files` compile with `tsc --noEmit`.
- All acceptance tests pass under `npm test`.
- No `Math.random()`, `Date.now()`, or `any` introduced in `src/core/`.
- No I/O in any test.
- `assertCargoConservation` and `assertLedgerBalance` still pass after integration.

---

### 5. Common pitfalls for a weak model on this project

**Pitfall 1 — Non-deterministic pathfinding.**
A 3B model will iterate the A* open set as a plain array and expand nodes in insertion order, which changes when segments are added in a different order. Fix: in `runAstar`, break ties by ascending node id. The determinism canary test (R23 analog for pathfinding: same graph → same path) catches this immediately.

**Pitfall 2 — Iterating reservations in Map order instead of sorted order.**
The deadlock detector (R09) visits trains in Map-insertion order, which is not stable after removes/re-inserts. Fix: `[...waitingFor.keys()].sort((a,b)=>a-b)` before the DFS. The deadlock fixture (R20) is flaky if this is wrong.

**Pitfall 3 — Atomicity failure in `reservePath`.**
A 3B model will implement `reservePath` as a loop that reserves segments one by one and returns false if one fails — but if segments 0 and 1 succeed and segment 2 fails, the model forgets to release segments 0 and 1, causing a phantom reservation that permanently blocks other trains. The `reservePath` test (R08) includes this exact partial-failure scenario.

**Pitfall 4 — Using floats for Fixed money and distances.**
A model will write `train.distanceTravelled += speed / TICKS_PER_KM` using raw division, which introduces float rounding. Fix: `divFixed(mulFixed(speedKmh, 1), TICKS_PER_KM)` — all in Fixed. The cargo revenue test (R16) computes exact revenues and catches any float drift.

**Pitfall 5 — MCF solver is non-deterministic due to Map iteration.**
A 3B model will iterate `demands` in insertion order, which changes when demands are added in a different order. Fix: sort `demands` by qty descending (then by id for ties) before every pass; sort `edges` by `fromStationId` then `toStationId`. The MCF determinism canary (R23) will fail immediately otherwise.

**Pitfall 6 — Cargo silently dropped instead of accounted as decayed.**
When perishable cargo expires, a weak model will call `array.splice` and not increment the `decayedAccumulator`. `assertCargoConservation` catches this: if `sourcedTotal !== inTransit + waiting + delivered + decayed`, it throws. Always pass the accumulator to `applyPerishableDecay` and increment it.

**Pitfall 7 — Train position advances past segment end without transitioning to next segment.**
If `positionOnSegment >= segment.length` is not checked after every physics tick, a train will accumulate a position value far beyond the segment end and "teleport" when it finally transitions. The scheduler (R11) must check and handle this after every `trainPhysicsTick` call, releasing the old reservation and reserving the next segment. The throughput golden-lock in R29 will be wrong if this is missed.

**Pitfall 8 — Ledger fold uses floating-point accumulation.**
A model may fold the ledger with `reduce((sum, e) => sum + fromFixed(e.amount), 0)` — using float addition. Fix: fold in Fixed integers: `ledger.reduce((sum, e) => addFixed(sum as Fixed, e.amount), ZERO_FIXED as Fixed)`. The `assertLedgerBalance` chaos pass (R29) finds this over many entries.
