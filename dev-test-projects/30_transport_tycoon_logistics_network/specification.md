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
