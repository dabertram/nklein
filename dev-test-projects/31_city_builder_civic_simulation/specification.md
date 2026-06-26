# 31 - City Builder Civic Simulation

Complexity tier: 31/35 game block
Expected decomposition size: 140-170 dependent implementation cards before coding.
Domain pressure: city simulation, zoning, transportation, utilities, land value, budgets, public services, disasters, civic dashboards, SimCity-like presentation.
Acceptance command: npm test

## How to use this challenge
This is a game dev-test project specification for evaluating whether an autonomous coding agent can decompose real game systems, implement deterministic simulation logic, and build a polished presentation layer that makes the game understandable and desirable. The goal is not to finish the whole game. The goal is to build a product-grade foundation that proves the agent understands rules, simulation state, player experience, rendering, and verification.

The agent must read this entire specification before planning. It must create a dependency-linked plan, record domain knowledge debt, identify engine and presentation invariants, and choose a release slice that exercises the highest-risk mechanics. For game projects, visual presentation is mandatory, not a stretch goal. A correct simulation hidden behind ugly placeholder UI is not enough.

## Product vision
Build a city builder in the spirit of classic SimCity, but with a modern simulation foundation and polished presentation. Players zone districts, build infrastructure, manage services, respond to disasters, and read the city through overlays and citizen feedback. The hard part is coherent systems interaction, not just painting tiles.

## Target players and users
- City-builder fans who want readable cause-and-effect and satisfying growth.
- Simulation players who tune traffic, utilities, budgets, land value, and services.
- Scenario designers creating city goals, disasters, and constraints.
- Players who care about visual beauty, civic storytelling, and understandable dashboards.

## Foundation release scope
The first serious buildout must include:
- City, tile, parcel, zone, building, road, transit stop, utility network, citizen group, household, business, service, budget, policy, event, disaster, metric, and save-game models.
- Zoning and growth simulation for residential, commercial, industrial, civic, parks, density, land value, desirability, abandonment, redevelopment, and building upgrades.
- Traffic and transit model with road capacity, intersections, commute demand, congestion, public transit routes, walking catchments, and freight access.
- Utility systems for power, water, sewage, garbage, fire coverage, police coverage, healthcare, education, and parks with capacity, coverage, and budget constraints.
- Economic and population model with jobs, unemployment, household wealth, business demand, tax rates, service cost, city debt, and migration.
- Policy and budget system where service funding, taxes, zoning policy, pollution controls, transit fares, and emergency response change simulation outcomes.
- Disaster and incident system for fire, flood, blackout, traffic pileup, disease outbreak placeholder, pollution spike, and budget crisis.
- Advisor and citizen feedback system that summarizes problems from metrics with evidence and does not hallucinate causes.
- Scenario and save system with seeded maps, objectives, milestones, disasters, and deterministic replay of mayor actions.
- Seed city with growing suburb, industrial pollution, traffic congestion, underfunded fire service, transit expansion, and floodplain risk.

## Gameplay requirements
- Every player action should create systemic tradeoffs across growth, traffic, services, budget, land value, and citizen satisfaction.
- Overlays and advisors must explain the city without replacing player judgment.
- The city should feel alive through growth, traffic movement, service calls, and changing neighborhoods.
- Disasters must test infrastructure and emergency response rather than act as random punishment.

## Presentation requirements
Very nice presentation is mandatory for this challenge. The agent must treat rendering, animation, interaction feedback, and layout polish as core acceptance criteria. Required presentation work:
- A very nice presentation is mandatory: attractive terrain, roads, buildings, zones, moving traffic, service vehicles, utility overlays, weather/disaster effects, and polished zoom levels.
- The first playable screen must look like a city builder, not a spreadsheet: build toolbar, budget panel, time controls, map overlays, advisors, and animated city view.
- Overlays must be clear and beautiful: land value, traffic, pollution, power, water, fire, police, education, health, zoning, and budget pressure.
- Buildings should have readable states such as construction, thriving, abandoned, burned, flooded, unpowered, and upgraded.
- UI panels must be dense but elegant, with no oversized marketing-style cards or raw debug tables as primary gameplay.

## Architecture requirements
- Separate tile map, zoning/growth simulation, transport simulation, utility networks, services, economy, policy, events/disasters, advisors, save/replay, and renderer.
- Use deterministic simulation ticks and seeded scenario events.
- Make overlays derived projections over simulation state.
- Represent budgets and service capacity as systems, not UI-only labels.

## Domain knowledge debt to surface
The agent should not pretend to know every game design, simulation, AI, rendering, or balancing detail perfectly. It should mark assumptions, build deterministic subsets, and preserve extension points for future designers, artists, balance passes, and live integrations. Required knowledge areas:
- City builders are interconnected simulations; isolated meters create fake gameplay.
- Traffic, land value, jobs, services, utilities, and budgets feed back into each other.
- Advisor messages need causal evidence from simulation metrics.
- Presentation is part of comprehension because players reason spatially through overlays.

## Required challenge scenarios
The implementation plan and fixtures should be shaped around scenarios like these. They do not all need full UI coverage in the first slice, but the core model and presentation should be capable of representing them:
- Industrial growth boosts jobs but lowers nearby residential land value through pollution.
- A new transit line reduces congestion but creates budget pressure and increases downtown desirability.
- Underfunded fire coverage turns a small fire into a district incident.
- A blackout cascades through water pumps and hospital service quality.
- A flood event reveals that cheap development in floodplains created long-term risk.

## Decomposition pressure
This challenge should force decomposition across rules or simulation engine, deterministic fixtures, AI or policy layers, replay/save state, player-facing presentation, UI interaction, diagnostics, and test harnesses. The plan should include dependency links so core state, commands, invariants, and golden tests are built before rendering depends on them. Avoid starting with a visual mock that cannot play the game; also avoid building a correct but lifeless engine with no usable presentation.

The agent should maintain a visible knowledge-debt list covering unclear rules, balance assumptions, AI limitations, rendering tradeoffs, asset gaps, accessibility concerns, performance constraints, and future designer review checkpoints. Knowledge debt is not a failure; hiding it is.

## Acceptance criteria
- Growth tests cover zoning, land value, services, pollution, abandonment, redevelopment, and density upgrades.
- Traffic tests cover road capacity, commute demand, intersections, transit catchments, freight access, and congestion.
- Utility tests cover power, water, sewage, garbage, fire, police, healthcare, education, and parks capacity/coverage.
- Budget tests cover taxes, service funding, debt, operating costs, and policy changes.
- Disaster tests cover fire, flood, blackout, traffic incident, and service response.
- Presentation checks verify animated city map, build tools, overlays, advisor panel, time controls, and responsive layout.
- The project passes npm test without external map or asset services.

## Explicit non-goals
- Do not build a city-themed tile painter without simulation feedback.
- Do not make advisors invent causes that are not in metrics.
- Do not use static icons instead of a polished city presentation.
- Do not hide utility and traffic systems behind single aggregate scores.

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

> Added 2026-06-26 via deep domain research. **The single hardest, most-defining property of this project:** a city builder is a *deterministic, fixed-timestep simulation of interdependent cellular and agent fields* — population density, land value, pollution, traffic, crime, utility coverage, and budget — that **feed back into each other** with stable invariants (money is conserved, population is conserved across migration, every advisor claim is provable from a metric), and where a recorded sequence of mayor actions replays bit-identically. Isolated meters are fake gameplay; the whole challenge is the *coupling* between systems and proving it stays deterministic and explainable.

This section adds the load-bearing architecture the base spec implies but does not pin down. It is grounded in how the genre's reference implementations actually work — the original SimCity / **Micropolis** simulation (whose source is open and whose algorithms are documented), SimCity 4's tile-based traffic simulator, and Cities: Skylines' agent-based citizen model.

## C0. The meta-test: what "interconnected civic simulation" actually demands

The base spec is explicit: "City builders are interconnected simulations; isolated meters create fake gameplay … traffic, land value, jobs, services, utilities, and budgets feed back into each other," and "advisor messages need causal evidence from simulation metrics" (and a non-goal forbids advisors that "invent causes that are not in metrics"). Make those testable:

1. **Conservation.** Money is double-entry: every tax credit and service-funding debit posts to a ledger; the treasury is a fold, never a free number. Population is conserved across migration: residents who leave a zone arrive in another zone, leave the city, or are recorded as out-migration — never silently vanish.
2. **Determinism.** `simulate(seed, mayorActionLog, N_ticks)` twice ⇒ byte-identical state hashes at every checkpoint. Growth, disasters, migration, and disease all draw from the seeded clock/PRNG; no `Date.now()`, no unseeded randomness, no float drift in the authoritative core.
3. **Explainability (no hallucinated causes).** Every advisor/citizen-feedback message is a *typed claim backed by specific metric deltas* — "fire risk high in district 3 because fire-station coverage there is 0.2 and building density is high" — traceable to the exact map cells and values that produced it. A redact-the-prose test asserts the structured evidence alone justifies every message.
4. **Systemic tradeoffs.** "Every player action should create systemic tradeoffs across growth, traffic, services, budget, land value, and citizen satisfaction" — so a single action (zone industry, build transit, cut a budget) must propagate measurably through multiple coupled fields, deterministically.

Everything below serves these four.

## C1. The fixed-point logical-time kernel (the foundation under the foundation)

A coupled, long-running simulation diverges under floating point (per-CPU rounding compounds — the lockstep-desync failure mode: [Gaffer On Games — Floating Point Determinism](https://gafferongames.com/post/floating_point_determinism/); [Klotho fixed-point core](https://github.com/xpTURN/Klotho)). So:

- **Injected virtual clock; fixed tick + calendar.** Logical ticks (mapped to days/months/years) drive growth, migration, budget cycles (taxes collected per period), service calls, disaster timers, and demand recompute. Tests advance ticks; the renderer interpolates animated traffic/vehicles between authoritative states but never feeds back.
- **Fixed-point fields & economy.** Every map field (density, land value, pollution, traffic, crime, coverage) and every monetary value is integer/fixed-point in the authoritative core. A typed `Fixed` newtype + architecture test keeps float math out of state-affecting paths.
- **Seeded entropy tree.** Disasters, migration jitter, disease spread, and procedural map/scenario generation draw from one seeded splittable PRNG, reproducible from `(seed, mayorActionLog)`.

This kernel is the first ~10–12 cards and gates everything.

## C2. The cellular field model + phased map scans (the genre's core data structure)

The original SimCity engine is the canonical reference and it is *field-based*: it maintains a stack of named 2D maps and updates them on **staggered periodic scans** rather than all at once ([Don Hopkins — Inside The Simulator (SimCity manual)](http://www.donhopkins.com/home/catalog/simcity/manual/inside.html); open-source [Micropolis / MicropolisCore](https://github.com/SimHacker/MicropolisCore)). Reproduce this structure:

- **Named fields.** Maintain explicit maps: PopulationDensity, LandValue, Pollution, TrafficDensity, Crime, PowerGrid (powered/unpowered), RateOfGrowth, and service-coverage fields (Fire, Police, Health, Education, Parks). Overlays are these fields rendered — "make overlays derived projections over simulation state" (base spec).
- **Phased, staggered scans.** Not every field recomputes every tick. Define a documented schedule: the power scan, the traffic/trip pass, the land-value pass, the pollution/crime pass, and the growth/RCI pass run on their own cadences and in a fixed order. **The scan order and cadence are a documented constant**; changing them is a breaking change with a regression test. (This staggering is both the historical design and the performance strategy that makes a large map affordable.)
- **Field coupling is explicit and acyclic-per-tick.** Within a tick, each field reads the *previous* tick's values of its inputs (a fixed read/write generation) so the coupling graph cannot create order-dependent nondeterminism. Land value reads pollution/traffic/coverage from the prior generation; this is the standard cellular-update discipline and it is what makes the feedback *stable and deterministic*.

## C3. Land value, pollution, and crime (the coupled core loop)

These three fields plus density form SimCity's defining feedback loop, and the base scenarios depend on it ("industrial growth boosts jobs but lowers nearby residential land value through pollution"):

- **Land value** is computed from **terrain, accessibility (distance to city center/downtown), pollution, and proximity to amenities (water, trees, parks)** — *"the land value of an area is based on terrain, accessibility, pollution, and distance to downtown"* ([Inside The Simulator](http://www.donhopkins.com/home/catalog/simcity/manual/inside.html)). It is a smoothed field (neighborhood averaging), updated on the land-value scan.
- **Pollution** spreads from sources (industry — *"the primary cause of pollution is industrialized zones … increases with growth"* — plus traffic) as a diffusing field; it depresses adjacent land value and residential desirability.
- **Crime** is *"influenced by population density, local law enforcement, and land values,"* with the canonical feedback: **"lower land values cause crime rates to rise; higher crime rates cause land values to drop"** ([Inside The Simulator](http://www.donhopkins.com/home/catalog/simcity/manual/inside.html)). This loop must be a *stable* feedback (bounded, convergent), not a runaway — a property to test.
- **The coupling test:** placing industry near residential must, over a bounded number of ticks, raise local pollution, lower nearby residential land value, and shift residential growth/abandonment — *measurably and deterministically*, exactly as the base scenario specifies.

## C4. Traffic & transit: trip generation, capacity, and time-based routing (the highest-risk seam)

Traffic is the most failure-prone city-builder system and the base spec leans on it hard (congestion, intersections, transit catchments, freight, and "a new transit line reduces congestion"). Two reference models bracket the design space:

- **SimCity's trip-generation model (start here).** Each populated zone generates trips proportional to population; a trip seeks a destination zone of the appropriate type within a **trip range** that **heavy traffic shrinks**; roads have **capacity**, and exceeding it forms jams that *"drastically lower the capacity of a road."* Repeated *failed* trips (no reachable destination in range) cause the origin zone to decline/abandon ([Inside The Simulator](http://www.donhopkins.com/home/catalog/simcity/manual/inside.html)). This couples traffic directly to RCI growth and abandonment.
- **Time-based routing (the SimCity-4 refinement).** Real route choice minimizes **travel time, not distance** — SC4's simulator uses a Manhattan-A* with a **commute-trip max time** (≈6 minutes in the Maxis sim) and a max commute distance (≈93 tiles one-way); even with good pathfinding, **buildings abandon when commute time exceeds the cap despite available jobs**, and adding fast transit (subway ≈150 km/h) removes abandonment ([SC4D — Understanding the Traffic Simulator](https://wiki.sc4devotion.com/index.php?title=Tutorial:Understanding_the_Traffic_Simulator); [SC4 NAM Traffic Simulator](https://www.sc4nam.com/docs/feature-guides/the-nam-traffic-simulator/); [Commute Time and Pathfinding Report](https://community.simtropolis.com/omnibus/simcity-4/reference/commute-time-and-pathfinding-report-by-the-community-r45/)). Transit lines, walking catchments, and freight access plug in as alternative edges with their own speeds/capacities.
- **Agent vs aggregate — choose deliberately.** Cities: Skylines simulates *individual citizen agents* pathfinding with cost = f(time, comfort, money), which yields realistic emergent jams but is expensive ([CS2 pathfinding](https://pcgamespotlight.com/pc-games/cities-skylines-2-pathfinding-makes-simcity-look-like-childs-play)); the genre trend is *hybrid* — agents for visible transport, statistical fields elsewhere ([Agent-based traffic simulators survey](https://arxiv.org/pdf/2102.07505)). **Document the choice**: a deterministic aggregate trip-generation field for the first slice (cheaper, simpler to make deterministic), with an agent layer as an extension point. Either way, congestion → speed → travel-time → trip-success → growth is the required causal chain, and it must be deterministic.
- **The transit tradeoff test** (base scenario): a transit line reduces congestion on a corridor (measurable traffic-density drop), raises downtown desirability/land value, *and* adds operating cost (budget pressure) — all three effects, deterministically.

## C5. Utilities as networks with cascading failure (not meters)

The base spec forbids hiding utilities "behind single aggregate scores" and requires a **blackout that cascades through water pumps and hospital service quality** (a base scenario). So utilities are *networks*, following SimCity's power model:

- **Power as connectivity flood-fill.** *"The entire power grid is periodically checked for links to power; if a zone is connected (by zones or power lines) to a power plant, it is powered"* ([Inside The Simulator](http://www.donhopkins.com/home/catalog/simcity/manual/inside.html)). Power is a **graph-connectivity** problem (flood-fill from plants over conductive tiles) with **generation capacity vs draw** — exceed capacity and you get brownouts/rolling outages, deterministically.
- **Cascade dependencies are explicit.** Water pumps require power; hospitals/services require power and water; sewage and garbage have capacity and coverage. A blackout therefore propagates: plant fails → pumps unpowered → water coverage drops → hospital effectiveness drops → health metric drops → satisfaction drops. **This dependency chain is a typed graph**, and the cascade is the test (assert each downstream field degrades in the correct order on a deterministic blackout).
- **Service coverage fields** (fire, police, health, education, parks) are radial-influence fields from service buildings, bounded by funding (C6): an underfunded fire service has reduced coverage radius/response, so *"underfunded fire coverage turns a small fire into a district incident"* (a base scenario) becomes a computed consequence of coverage × funding × response, not a scripted punishment.

## C6. Budget, taxes, and policy as systems (the steering loop)

"Represent budgets and service capacity as systems, not UI-only labels" (base spec):

- **Double-entry treasury.** Taxes (by RCI class and rate) credit; service funding, maintenance, and construction debit; debt accrues interest; the treasury is a fold over the ledger. **Money conservation** is an invariant.
- **Policy knobs change simulation outcomes.** Tax rates shift RCI demand (high taxes suppress growth of that class); service-funding sliders scale coverage radius/effectiveness; pollution controls, transit fares, and emergency-response funding all feed measurable field changes. A policy change is a mayor action in the replay log; its downstream effects are computed and explainable.
- **Budget pressure feeds back.** Over-spending → debt → forced cuts → degraded services → lower satisfaction/land value → lower tax base — a stable (bounded) negative loop, tested for convergence not runaway.

## C7. RCI demand & growth (the economic heartbeat)

Reproduce SimCity's RCI valves: **residential, commercial, and industrial demand** balance against each other (*"commercial + industrial zones together should roughly equal residential"*); jobs vs residents drive **migration** (*"if jobs exceed residents, settlers are attracted; if the job market declines, people migrate away"*); commercial demand grows with population (internal market) ([Inside The Simulator](http://www.donhopkins.com/home/catalog/simcity/manual/inside.html)). Zones **grow, upgrade density, stagnate, abandon, and redevelop** based on land value + density + power + access + demand. The growth/RCI pass consumes the other fields (land value, traffic success, coverage, pollution) and is where the whole simulation's coupling converges.

## C8. The advisor / citizen-feedback engine (explainability as a data structure)

This is a flagship subsystem and a base-spec non-goal guardrail ("do not make advisors invent causes that are not in metrics"). Build it as an **evidence-backed claim engine**, not prose generation:

- **Typed claims from metric thresholds.** Each advisor message is generated by a rule that fires on specific field/metric conditions and **carries the supporting evidence**: the metric, its value, the threshold crossed, the implicated map cells/district, and the causal chain (e.g. abandonment → traced to commute-time-exceeded → traced to corridor congestion). No message exists without a metric backing it.
- **Causal tracing.** Because fields are coupled through a documented dependency graph (C2–C7), an advisor can *trace* a symptom to its driver: "land value falling in district 2 → pollution from the new industrial zone upwind." The trace is a graph traversal terminating at primary fields, not an LLM guess.
- **The anti-hallucination test:** redact all natural-language phrasing; the structured claim (metric + cells + threshold + causal edges) alone must justify every advisor message, and a fuzz test asserts no advisor fires without a satisfied metric condition.

## C9. Disasters & incidents (stress that tests infrastructure, not random punishment)

"Disasters must test infrastructure and emergency response rather than act as random punishment" (base spec). Each disaster (fire, flood, blackout, traffic pileup, disease-outbreak placeholder, pollution spike, budget crisis) is a **seeded, scheduled event** whose *outcome depends on the city's preparedness*: a fire's spread depends on fire-coverage and road access; a flood's damage depends on whether cheap development was placed in floodplains (a base scenario: "cheap development in floodplains created long-term risk"); a blackout's severity depends on grid redundancy. Determinism: same seed + same city ⇒ same disaster trajectory, so "did my fire coverage help?" is a reproducible experiment.

## C10. The presentation layer is gameplay (and must not break determinism)

"Players reason spatially through overlays" (base spec):

- **Interpolated rendering.** Animated traffic, service vehicles, growing/abandoning buildings, weather/disaster effects all derive from authoritative field state; the sim runs fixed-step via an accumulator ([Gaffer On Games — Fix Your Timestep](https://gafferongames.com/post/fix_your_timestep/)); the renderer interpolates for smoothness only.
- **Building states are readable** (construction, thriving, abandoned, burned, flooded, unpowered, upgraded) — each a function of the underlying fields.
- **Overlays are the C2 fields rendered legibly** (land value, traffic, pollution, power, water, fire, police, education, health, zoning, budget pressure) with colorblind-safe palettes. Build toolbar, budget panel, time controls, advisor panel, and animated city view make "the first playable screen look like a city builder, not a spreadsheet." Presentation checks assert dense-but-elegant panels, no overlapping controls, and overlays that toggle without layout shift.

## C11. Adversarial / edge-case fixture pack (what separates a sim from a demo)

Ship as deterministic fixtures, each asserting an invariant or a base scenario:

- **The pollution land-value coupling** (base scenario): industry near residential — assert pollution rises, nearby residential land value falls, residential growth shifts, over a bounded tick window, deterministically.
- **The transit tradeoff** (base scenario): a new transit line — assert congestion drop + downtown desirability rise + budget pressure, all three.
- **The underfunded-fire cascade** (base scenario): cut fire funding, ignite a fire — assert reduced coverage turns it into a district incident; restore funding and assert containment.
- **The blackout cascade** (base scenario): fail a plant — assert pumps→water→hospital→health degrade in the correct dependency order.
- **The floodplain risk** (base scenario): cheap floodplain development + a seeded flood — assert disproportionate damage traceable to the placement choice.
- **The advisor anti-hallucination canary:** force a city state with no triggering metric — assert *no* advisor fires; force a triggering state — assert the correct evidence-backed message.
- **The migration conservation canary:** drive mass abandonment — assert every departing resident is accounted as relocated or out-migrated (population conserved).
- **The save/load equivalence:** snapshot mid-game, restore from snapshot + remaining mayor-action log — assert identical final fields, treasury, and population vs the uninterrupted run.

## C12. Global invariants (property-based — this is how the foundation is graded)

Over randomized + scripted runs:

1. **Money conservation (double-entry)** — every ledger movement balances; treasury equals the ledger fold; no untaxed revenue, no unfunded debit.
2. **Population conservation** — residents are conserved across migration (born/immigrated in = resident + emigrated + out-of-city), never silently created/destroyed by abandonment, redevelopment, or save/load.
3. **Determinism** — `simulate(seed, log, N)` twice ⇒ identical state hashes; the staggered scan order is the only order producing the golden fields (regression-pinned).
4. **Advisor soundness** — every advisor/feedback message has a satisfied metric condition and a valid causal trace; no message without metric backing (the anti-hallucination invariant).
5. **Feedback-loop stability** — the crime↔land-value, budget↔services, and pollution↔desirability loops are bounded/convergent, not runaway, under sustained input (catches divergent-coupling bugs).
6. **Coupling causality** — a single mayor action propagates to the documented set of downstream fields within a bounded horizon (e.g. zoning industry *must* move pollution, land value, and growth), proving systems are connected, not isolated meters.
7. **Replay fidelity** — mayor-action-log replay reproduces identical fields, treasury, and population (base-spec determinism elevated to an invariant).

Plus a **chaos pass**: randomized zoning/build/policy/funding streams interleaved with seeded disasters and save/load, asserting 1–7 hold throughout.

## C13. The concrete first vertical slice (the on-ramp — build THIS first, ~50–65 cards)

Given the 140–170 card scope, prove the *coupled spine* on a small map with a focused subset before breadth:

- **Kernel (C1):** virtual clock + calendar, seeded PRNG, fixed-point, world-state hashing.
- **Cellular field engine + staggered scans (C2):** PopulationDensity, LandValue, Pollution, TrafficDensity, PowerGrid, RateOfGrowth, plus Fire coverage — with the documented scan order and prior-generation read discipline.
- **The land-value ↔ pollution ↔ (crime) ↔ density loop (C3)** proven stable and coupled.
- **Trip-generation traffic with capacity + trip-range + time-based abandonment (C4)** — the highest-risk seam — and one transit line as an alternative edge.
- **Power flood-fill + one cascade (C5):** plant → coverage → a service dependency (e.g. fire stations need power), with the blackout-cascade fixture green.
- **Double-entry budget + tax/funding policy (C6)** and **RCI demand/growth/abandonment (C7)** closing the economic loop.
- **The advisor claim engine (C8)** with the anti-hallucination test green on the slice's fields.
- **One seeded disaster (C9):** an underfunded-fire incident whose severity depends on coverage.
- **Replay/save (C0/C12):** mayor-action-log record + replay reaching identical fields/treasury/population; snapshot/restore equivalence.
- **Polished slice view (C10):** attractive map, animated traffic, readable building states, a build toolbar, budget panel, time controls, advisor panel, and at least the land-value/traffic/pollution/power overlays — "a city builder, not a spreadsheet."
- **Green:** the C11 pollution-coupling + transit-tradeoff + blackout-cascade + advisor-canary fixtures and the C12 money + population conservation + determinism + advisor-soundness + coupling-causality invariants, under `npm test` with zero wall-clock/random/external-map/asset dependence.

If the coupled spine is real on a small map, every later service, density tier, and disaster is breadth on a proven foundation.

## C14. Domain knowledge-debt to track (surface, don't bluff)

- **Agent vs aggregate traffic:** the first slice uses deterministic aggregate trip generation; the agent-based refinement (per-citizen pathfinding à la Cities: Skylines) is a documented extension with a real perf/determinism cost — name the boundary, don't silently pick.
- **Balance constants** (trip range, commute-time cap, road capacities, land-value weights, pollution diffusion rate, tax-elasticity of demand, coverage radii) are *design numbers* borrowed from SimCity/SC4 references; flag as tunable with cited provenance — a balance designer must re-derive them, not treat them as physics.
- **Field coupling fidelity:** the cellular/field model is a deliberate simplification of real urban dynamics (no full discrete-choice land-use model); mark where an urban-sim expert review would refine it.
- **Disease/health depth:** the disease-outbreak system is a placeholder in the base spec; document its boundary and the epidemiological review it would need to deepen.
- **Performance ceiling:** staggered scans make a large map affordable, but document the grid-size budget the slice targets and where spatial optimization or agent-LOD would be needed.
- **Accessibility & civic framing:** overlays need colorblind-safe palettes and non-color redundancy; and zoning/segregation/displacement dynamics carry real-world sensitivity — flag where designer/ethics review is warranted before shipping content that models them.

## C15. Why this is a great !Klein challenge

This stresses exactly what !Klein must prove with small local models: **decomposition** of a deeply-coupled system where the dependency order (kernel → fields → coupled loops → traffic → utilities → budget/RCI → advisors → presentation) is unforgiving and the coupling itself is the point; **determinism under weak models** (the conservation, stability, and replay invariants are pass/fail and catch any fuzzy shortcut — a model cannot bluff "the city kind of grows"); **explainability discipline** (the advisor-soundness invariant forces every generated claim to be metric-grounded, the precise antidote to LLM hallucination — a beautiful fit for proving a small model can be *honest*); and **stable feedback engineering** (the coupled loops must be bounded and convergent, not chaotic). The field/scan/coupling spine is rich enough to be a genuine master-tier test yet decomposable enough for a swarm to build a real coupled slice. Build the kernel, field engine, the land-value/pollution/traffic loop, the power cascade, the advisor soundness, and the conservation invariants first (C1–C5, C8, C12–C13); earn the rest.

---

## Small-model build guide (3B-ready)

This section makes the spec mechanically buildable by a tiny (~3B-parameter) local model. Every card is sized for one focused implementation step. Follow it literally; do not infer unstated requirements.

### 1. Glossary & ground rules

**Domain terms:**
- **Tick** — one logical simulation step. Never use `Date.now()` or `performance.now()` in `src/core/` or `src/sim/`. The virtual tick counter in `WorldState.tick` is the only time source.
- **Fixed** — a branded integer type (`number & { __fixed: true }`) with scale factor 100 (i.e. `toFixed(1.5) === 150`). All field values and budget figures in `src/core/` use Fixed. Never use raw `number` arithmetic in simulation code.
- **Calendar** — a day/month/year counter mapped onto ticks. `TICKS_PER_MONTH = 30` (balance constant; document). Budget ticks (tax collection, service-cost debit) happen at calendar month boundaries.
- **Tile** — the basic grid unit. Each tile has coordinates `(x, y)` (integer). A tile holds a `ZoneType` and a `BuildingState`. The map is a 2D array of tiles, never a live query.
- **Field** — a named 2D array of Fixed values, one entry per tile. The eight authoritative fields are: `PopulationDensity`, `LandValue`, `Pollution`, `TrafficDensity`, `PowerGrid`, `FireCoverage`, `RateOfGrowth`, `Crime`.
- **Scan** — a full pass over the field updating all tiles for that field. Scans happen on a fixed schedule (not every tick). The field reads the *previous generation* of its inputs, never the same-generation values, so coupling is stable and order-independent within a generation.
- **Generation** — even/odd tick-set. Field A and field B can read each other safely because they both read the `prev` (last committed) value, not the in-progress `next` value. After all scans in a generation complete, `prev = next`.
- **ZoneType** — `'none' | 'residential' | 'commercial' | 'industrial' | 'civic' | 'park'`.
- **BuildingState** — `'empty' | 'construction' | 'thriving' | 'stable' | 'declining' | 'abandoned' | 'burned' | 'flooded' | 'unpowered'`.
- **RCI demand** — three independent pressure gauges (residential, commercial, industrial) each a Fixed in [0, 1000]. Growth happens in zones where zone type matches the highest-pressure demand.
- **Power flood-fill** — a BFS from all powered plant tiles over conductive tiles. A tile is powered if reachable from a plant in the BFS. Run the flood-fill every `POWER_SCAN_INTERVAL` ticks.
- **Trip** — a demand unit: a residential zone tries to send a commuter to a commercial or industrial zone. A trip succeeds if a destination zone is reachable within the `TRIP_RANGE` tiles. A failed trip contributes to abandonment pressure.
- **Double-entry treasury** — `world.treasury = fold(world.ledger, ZERO_FIXED)`. Every tax credit and service-cost debit posts to the ledger. Never mutate `world.treasury` directly; always use `postLedger`.
- **Population conservation** — `Σ(residents in all zones) = total_population`. When a zone abandons, its population emigrates (added to `world.emigratedTotal`) or moves to another zone (increment another zone's population). Never silently drop population.
- **Advisor claim** — a typed record `{ ruleId: string; metric: string; value: Fixed; threshold: Fixed; implicatedCells: Coord[]; causalChain: string[] }`. No natural-language string without a backing claim. The anti-hallucination test asserts no message fires without a satisfied metric condition.
- **Mayor action log** — the append-only list of commands (`ZoneTile`, `BuildRoad`, `BuildPlant`, `SetBudget`, `SetTaxRate`, …) with tick timestamps. The log + seed is the save file.

**Stack:**
- Language: TypeScript (strict mode, no `any`).
- Runtime: Node.js (current LTS).
- Test runner: Vitest (`npm test` runs `vitest run`).
- No DOM or canvas in `src/core/` or `src/sim/`. Renderer in `src/renderer/`.
- All acceptance tests: pure in-memory, no network, no `Date.now()`, no `Math.random()`.

**Acceptance command (plain steps):**
1. `cd` to the project root.
2. Run `npm test`.
3. All Vitest suites pass; exit code 0. No test uses the network, filesystem, or wall-clock time.

**Determinism rules (imperative):**
- Never call `Math.random()` in `src/`. Use `createSeededPrng(seed)` threaded explicitly.
- Never call `Date.now()` in `src/`.
- Use Fixed arithmetic in `src/core/`; convert to float only in `src/renderer/`.
- All field scans iterate tiles in ascending `(y * width + x)` index order — never hash-iteration order.
- The double-generation (prev/next) discipline for fields is mandatory: scans read `prev`, write `next`; swap at generation boundary. Never read and write the same generation's values.
- Never mutate `world.treasury` directly. Use `postLedger`.

---

### 2. The explicit task graph for the first vertical slice

The first slice covers C1 (kernel) + C2 (cellular field engine) + C3 (land-value/pollution/crime loop) + C4 (trip-generation traffic + one transit line) + C5 (power flood-fill + cascade) + C6 (budget + tax) + C7 (RCI demand + growth) + C8 (advisor claim engine) + C9 (one seeded disaster) + C0/C12 (replay/save) + C10 (polished slice view). Target: ~47 cards.

---

**`C01` — Fixed-point newtype and field value helpers**
dependsOn: none
files: `src/core/fixed.ts`, `test/core/fixed.test.ts`
interface:
```ts
export type Fixed = number & { __fixed: true };
export function toFixed(n: number): Fixed;     // Math.round(n * 100) as Fixed
export function fromFixed(f: Fixed): number;   // f / 100
export function addFixed(a: Fixed, b: Fixed): Fixed;
export function subFixed(a: Fixed, b: Fixed): Fixed;
export function mulFixed(a: Fixed, scalar: number): Fixed; // scalar is integer
export function divFixed(a: Fixed, divisor: number): Fixed; // truncates
export function clampFixed(f: Fixed, lo: Fixed, hi: Fixed): Fixed;
export const ZERO_FIXED: Fixed;
export const FIELD_MAX: Fixed; // = toFixed(100) = 10000; max value for any field
```
how to implement: scale = 100. `toFixed(50.5) === 5050`. Integer arithmetic throughout.
acceptance:
- `toFixed(1) === 100`
- `addFixed(toFixed(30), toFixed(70)) === toFixed(100)`
- `clampFixed(toFixed(120), ZERO_FIXED, FIELD_MAX) === FIELD_MAX`
- `mulFixed(toFixed(3), 4) === toFixed(12)`
Run `npm test` → green.

---

**`C02` — Seeded PRNG**
dependsOn: none
files: `src/core/prng.ts`, `test/core/prng.test.ts`
interface:
```ts
export interface SeededPrng { next(): number; nextInt(lo: number, hi: number): number; }
export function createSeededPrng(seed: number): SeededPrng;
```
how to implement: xorshift32 or mulberry32. No `Math.random()`.
acceptance: identical sequences for two instances with same seed; `nextInt` always in range.
Run `npm test` → green.

---

**`C03` — World state, tile grid, and virtual clock**
dependsOn: `C01`, `C02`
files: `src/core/world.ts`, `src/core/tile.ts`, `test/core/world.test.ts`
interface:
```ts
// tile.ts
export type ZoneType = 'none' | 'residential' | 'commercial' | 'industrial' | 'civic' | 'park';
export type BuildingState = 'empty' | 'construction' | 'thriving' | 'stable' | 'declining' | 'abandoned' | 'burned' | 'flooded' | 'unpowered';
export interface Tile { x: number; y: number; zone: ZoneType; building: BuildingState; population: number; }
export type Coord = { x: number; y: number };

// world.ts
export interface WorldState {
  tick: number;
  seed: number;
  calendar: { tick: number; day: number; month: number; year: number };
  width: number; height: number;
  tiles: Tile[];    // flat array; index = y * width + x
  ledger: LedgerEntry[];
  treasury: Fixed;
  emigratedTotal: number;
  immigratedTotal: number;
  prng: SeededPrng;
}
export interface LedgerEntry { tick: number; amount: Fixed; description: string; }
export const TICKS_PER_MONTH = 30; // balance constant
export function createWorld(seed: number, width: number, height: number): WorldState;
export function getTile(world: WorldState, x: number, y: number): Tile;
export function setTile(world: WorldState, x: number, y: number, patch: Partial<Tile>): void;
export function advanceTick(world: WorldState): void; // increments tick; updates calendar; full logic in C15
```
how to implement: flat tile array, index = y * width + x. `createWorld` initializes all tiles to `{ zone:'none', building:'empty', population:0 }`.
acceptance:
- `createWorld(1, 10, 10).tiles.length === 100`
- `getTile(world, 5, 3) === world.tiles[3 * 10 + 5]`
- After `TICKS_PER_MONTH` advanceTick calls, `world.calendar.month` advances.
Run `npm test` → green.

---

**`C04` — World-state hash**
dependsOn: `C03`
files: `src/core/hash.ts`, `test/core/hash.test.ts`
interface:
```ts
export function hashWorldState(world: WorldState): string;
```
how to implement: stable JSON (arrays are already ordered; just skip the PRNG internal state from the hash by serializing `prng.next()` as a placeholder), djb2/FNV-1a hash.
acceptance: identical worlds → identical hash; tick 0 ≠ tick 1; stable on two calls.
Run `npm test` → green.

---

**`C05` — Named field engine (double-generation scan discipline)**
dependsOn: `C03`, `C01`
files: `src/core/fields.ts`, `test/core/fields.test.ts`
interface:
```ts
export type FieldName = 'PopulationDensity' | 'LandValue' | 'Pollution' | 'TrafficDensity' | 'PowerGrid' | 'FireCoverage' | 'RateOfGrowth' | 'Crime';
export interface FieldStore {
  prev: Map<FieldName, Fixed[]>;  // prev[name] is a flat array of length width*height
  next: Map<FieldName, Fixed[]>;
}
export function createFieldStore(width: number, height: number): FieldStore;
export function readField(store: FieldStore, name: FieldName, x: number, y: number, width: number): Fixed;
// reads from store.prev
export function writeField(store: FieldStore, name: FieldName, x: number, y: number, width: number, value: Fixed): void;
// writes to store.next
export function commitGeneration(store: FieldStore): void;
// swaps prev = next; resets next to zeros
export function assertFieldConservation(store: FieldStore, name: FieldName, expectedTotal: Fixed, width: number, height: number): void;
// throws if sum of prev[name] !== expectedTotal
```
how to implement:
1. `createFieldStore`: initialize both prev and next to zero-filled arrays for all 8 field names.
2. `readField` indexes `prev[name][y * width + x]`.
3. `writeField` indexes `next[name][y * width + x]`.
4. `commitGeneration`: for each name, `prev[name] = next[name].slice()`, then reset `next[name]` to all zeros.
5. `assertFieldConservation`: sum all entries in `prev[name]`; assert equals `expectedTotal`.
acceptance:
- Write 50 to (0,0) in `LandValue`; before commit: `readField('LandValue', 0, 0)` still reads 0 (prev is unchanged). After `commitGeneration`: reads 50.
- After commit, the `next` generation is all zeros.
- `assertFieldConservation` throws when sum is wrong.
Run `npm test` → green.

---

**`C06` — Scan schedule constant**
dependsOn: `C05`
files: `src/core/scan-schedule.ts`, `test/core/scan-schedule.test.ts`
interface:
```ts
export const SCAN_INTERVALS: Record<FieldName, number> = {
  PowerGrid: 10,
  TrafficDensity: 5,
  Pollution: 15,
  LandValue: 20,
  Crime: 20,
  FireCoverage: 10,
  PopulationDensity: 3,
  RateOfGrowth: 30,
};
// A field scan runs when: world.tick % SCAN_INTERVALS[name] === 0
export function shouldScanField(fieldName: FieldName, tick: number): boolean;
```
how to implement: trivial modulo. `SCAN_INTERVALS` is the single constant; reordering it is a breaking change.
acceptance:
- `shouldScanField('PowerGrid', 0) === true`
- `shouldScanField('PowerGrid', 5) === false`
- `shouldScanField('PowerGrid', 10) === true`
- `shouldScanField('TrafficDensity', 5) === true`
Run `npm test` → green.

---

**`C07` — Pollution diffusion scan**
dependsOn: `C05`, `C06`, `C03`
files: `src/core/scan-pollution.ts`, `test/core/scan-pollution.test.ts`
interface:
```ts
export function runPollutionScan(world: WorldState, fields: FieldStore): void;
// Reads industrial zone presence and traffic density from fields.prev;
// writes pollution to fields.next.
// Formula per tile:
//   source = (tile.zone === 'industrial') ? toFixed(40) : ZERO_FIXED
//   trafficContrib = mulFixed(readField(fields, 'TrafficDensity', x, y, world.width), 1) / 10  (integer division)
//   rawPollution = source + trafficContrib
//   diffused = average of rawPollution with 4 neighbors (clamped to map bounds)
//   writeField(fields, 'Pollution', x, y, world.width, clampFixed(diffused, ZERO_FIXED, FIELD_MAX))
// Iteration order: ascending index (y * width + x)
```
how to implement:
1. Loop tiles in index order.
2. Read industrial status from `world.tiles[idx].zone`.
3. Compute `diffused` using neighbor reads from `fields.prev`.
4. Write to `fields.next`.
acceptance:
- A 3×3 map with all industrial tiles: Pollution is > 0 everywhere after scan + commit.
- A map with no industrial, no traffic: Pollution stays 0.
- Two identical worlds run through 10 pollution scans → identical field values (determinism).
Run `npm test` → green.

---

**`C08` — Land-value scan (reads Pollution, FireCoverage, Terrain from prev)**
dependsOn: `C07`, `C06`
files: `src/core/scan-land-value.ts`, `test/core/scan-land-value.test.ts`
interface:
```ts
export function runLandValueScan(world: WorldState, fields: FieldStore): void;
// Formula per tile:
//   terrain = toFixed(50) // flat bonus; KNOWLEDGE_DEBT: terrain height map not in first slice
//   pollution_penalty = mulFixed(readField(fields,'Pollution',x,y,w), 1) (reads prev)
//   coverage_bonus = mulFixed(readField(fields,'FireCoverage',x,y,w), 1)
//   raw = terrain - pollution_penalty + coverage_bonus
//   writeField(fields,'LandValue',x,y,w, clampFixed(raw, ZERO_FIXED, FIELD_MAX))
// Iteration: ascending index order
```
how to implement: pure field-reads from `prev`, writes to `next`. Neighbors not needed (single-tile formula; neighborhood averaging is an extension).
acceptance:
- A tile with Pollution=0 and FireCoverage=0: LandValue = terrain_bonus = 5000 (toFixed(50)).
- A tile with high Pollution (100 ≈ toFixed(100) = 10000): LandValue is reduced.
- Deterministic across two runs.
Run `npm test` → green.

---

**`C09` — Crime scan (reads PopulationDensity, LandValue, police coverage stub)**
dependsOn: `C08`
files: `src/core/scan-crime.ts`, `test/core/scan-crime.test.ts`
interface:
```ts
export function runCrimeScan(world: WorldState, fields: FieldStore): void;
// Formula per tile:
//   density_factor = readField(fields,'PopulationDensity',x,y,w)
//   lv = readField(fields,'LandValue',x,y,w)
//   low_lv_bonus = subFixed(FIELD_MAX, lv)  // high crime when low land value
//   raw = divFixed(addFixed(density_factor, low_lv_bonus), 2)
//   writeField(fields,'Crime',x,y,w, clampFixed(raw, ZERO_FIXED, FIELD_MAX))
// Iteration: ascending index
```
how to implement: pure reads from prev, writes to next.
acceptance:
- A tile with LandValue = 0 and density > 0: Crime is high.
- A tile with LandValue = FIELD_MAX and low density: Crime is low.
- Crime↔LandValue feedback loop test: run 5 coupled scan cycles (crime scan → LV scan → repeat); assert values converge (do not oscillate past [ZERO_FIXED, FIELD_MAX]).
Run `npm test` → green.

---

**`C10` — Power flood-fill scan**
dependsOn: `C05`, `C06`, `C03`
files: `src/core/scan-power.ts`, `test/core/scan-power.test.ts`
interface:
```ts
export function runPowerScan(world: WorldState, fields: FieldStore): void;
// BFS from all tiles where tile.building === 'plant' (power plant).
// A tile is conductive if: tile.zone !== 'none' OR tile has a power-line marker (use tile.zone === 'civic' as proxy for power line in MVP).
// Sets PowerGrid field: powered tiles = FIELD_MAX (10000); unpowered = ZERO_FIXED.
// Iteration order for BFS queue: enqueue neighbors in ascending-index order.
```
how to implement:
1. Seed BFS with all plant tiles (ascending index order).
2. For each dequeued tile, mark `writeField('PowerGrid', ..., FIELD_MAX)`; enqueue conductive neighbors not yet visited, in ascending-index order.
3. All unvisited tiles get ZERO_FIXED.
acceptance:
- A plant at (0,0) in a 5×5 grid of civic tiles: all tiles powered after scan+commit.
- A non-conductive gap (zone='none', non-plant) breaks connectivity; tiles beyond the gap are unpowered.
- BFS is deterministic: same map → same PowerGrid field on two runs.
Run `npm test` → green.

---

**`C11` — Power cascade (unpowered service degrades coverage)**
dependsOn: `C10`
files: `src/core/cascade-power.ts`, `test/core/cascade-power.test.ts`
interface:
```ts
export function applyPowerCascade(world: WorldState, fields: FieldStore): void;
// For every tile with a fire-station building (tile.building === 'fire_station'):
//   if readField(fields,'PowerGrid',x,y,w) === ZERO_FIXED:
//     set FireCoverage for that tile and neighbors within FIRE_STATION_RANGE to ZERO_FIXED (unpowered)
export const FIRE_STATION_RANGE = 3; // tiles; balance constant
```
how to implement: iterate tiles ascending; for unpowered stations, zero-out FireCoverage in a radius in `fields.next`.
acceptance:
- A powered fire station covers its neighbors (FireCoverage > 0 after cascade + commit).
- An unpowered fire station: all tiles in its range have FireCoverage = 0 after cascade.
- `assertFieldConservation` does not need to hold for FireCoverage (it is a coverage field, not a conserved quantity) — document this.
Run `npm test` → green.

---

**`C12` — Trip-generation traffic scan**
dependsOn: `C05`, `C06`, `C03`
files: `src/core/scan-traffic.ts`, `test/core/scan-traffic.test.ts`
interface:
```ts
export const TRIP_RANGE = 8;    // tiles; balance constant
export const MAX_ROAD_CAPACITY = toFixed(80); // field units; balance constant
export function runTrafficScan(world: WorldState, fields: FieldStore): void;
// For each residential tile with population > 0:
//   generate 1 trip attempt; search for a commercial or industrial tile within TRIP_RANGE (Manhattan distance)
//   if found: success — contribute toFixed(10) to TrafficDensity on all tiles along the Manhattan path (ascending-index order)
//   if not found: record a failed trip on the tile (use a scratch counter; see below)
// After all residential tiles processed, for each tile:
//   if TrafficDensity > MAX_ROAD_CAPACITY: tile is congested (store as a boolean in world.congestionMap)
// Scratch counter: add 'tripFailures: number' to WorldState (initialized to 0; reset each scan)
```
how to implement:
1. Collect residential tiles with population > 0; sort by ascending index.
2. For each, BFS/scan within TRIP_RANGE tiles for a commercial or industrial tile.
3. On success, add toFixed(10) to each tile on the direct Manhattan path in `fields.next['TrafficDensity']`.
4. On failure, increment `world.tripFailures`.
5. After all trips, compute `congestionMap` (a `Set<number>` of tile indices where traffic > capacity); store in `WorldState`.
acceptance:
- A residential tile adjacent to a commercial tile: 0 trip failures; TrafficDensity > 0 on the path.
- A residential tile with no commercial/industrial within TRIP_RANGE: trip fails.
- Two identical worlds → identical TrafficDensity and identical `tripFailures` (determinism).
Run `npm test` → green.

---

**`C13` — RCI demand and growth/abandonment pass**
dependsOn: `C08`, `C12`, `C11`, `C03`
files: `src/core/scan-rci.ts`, `test/core/scan-rci.test.ts`
interface:
```ts
export interface RciDemand { residential: Fixed; commercial: Fixed; industrial: Fixed; }
export function computeRciDemand(world: WorldState, fields: FieldStore): RciDemand;
// residential demand = FIELD_MAX - average(TrafficDensity) + average(LandValue) (balance heuristic)
// commercial demand = population / 10 (simplified; KNOWLEDGE_DEBT: real model is more complex)
// industrial demand = toFixed(50) - average(Pollution) * 0.5 (industry dislikes own pollution)
// All values clamped to [ZERO_FIXED, FIELD_MAX]

export function runGrowthPass(world: WorldState, fields: FieldStore, demand: RciDemand, prng: SeededPrng): void;
// For each tile with a matching zone (residential/commercial/industrial):
//   if demand[zone] > toFixed(60) and tile.building in ['empty','stable','declining'] and powered:
//     if prng.nextInt(0, 9) < 3: grow building state one step (empty→construction→stable→thriving)
//   if demand[zone] < toFixed(30) and tile.building in ['thriving','stable']:
//     decline building state (thriving→stable→declining→abandoned)
//   on 'abandoned': population on tile → add to world.emigratedTotal; set tile.population = 0
// Iteration: ascending index; prng use is deterministic
```
how to implement: iterate tiles ascending index order. Use the passed `prng` (never `Math.random()`).
acceptance:
- A residential tile with demand=80 grows from 'empty' toward 'thriving' over 30 ticks.
- A residential tile with demand=20 declines from 'thriving' toward 'abandoned'.
- On abandonment, `world.emigratedTotal` increments by the tile's former population.
- Two runs with same seed → identical final tile states.
Run `npm test` → green.

---

**`C14` — Double-entry treasury and tax collection**
dependsOn: `C03`, `C01`
files: `src/core/ledger.ts`, `src/core/budget.ts`, `test/core/ledger.test.ts`
interface:
```ts
// ledger.ts
export function postLedger(world: WorldState, amount: Fixed, description: string): void;
// amount > 0 = revenue, < 0 = cost; updates world.treasury = world.treasury + amount; appends to world.ledger
export function assertLedgerBalance(world: WorldState): void;
// throws if world.treasury !== fold(world.ledger)

// budget.ts
export interface BudgetState {
  taxRates: { residential: Fixed; commercial: Fixed; industrial: Fixed }; // Fixed 0–100 (percentage)
  serviceAllocations: Record<string, Fixed>; // service name → funding as % of base cost
}
export function collectTaxes(world: WorldState, budget: BudgetState, fields: FieldStore): void;
// Revenue = Σ(tile.population * taxRate / 100) for each zone type; post to ledger
export function deductServiceCosts(world: WorldState, budget: BudgetState): void;
// Cost per service = baseCost * serviceAllocations[service] / 100; post negative amounts to ledger
```
how to implement:
1. `postLedger` never modifies `world.treasury` directly — it only appends to ledger and adds `amount` to treasury; the only source of truth for treasury is the fold.
2. `collectTaxes` iterates tiles ascending index; accumulates by zone type; one `postLedger` call per zone type per collection.
acceptance:
- Post +100, -30: treasury = 70; `assertLedgerBalance` passes.
- Corrupt treasury to 0: `assertLedgerBalance` throws.
- `collectTaxes` on a 10-tile residential map with 5 population each and 10% tax rate: total revenue = 10*5*0.10 = 5.0 → toFixed(5).
Run `npm test` → green.

---

**`C15` — Full phased tick dispatcher**
dependsOn: `C06`, `C07`, `C08`, `C09`, `C10`, `C11`, `C12`, `C13`, `C14`
files: `src/core/tick.ts`, `test/core/tick-order.test.ts`
interface:
```ts
export function runTick(world: WorldState, fields: FieldStore, budget: BudgetState, prng: SeededPrng): void;
// Ordered phases each tick:
// 1. For each field, if shouldScanField(name, world.tick): run its scan (reads prev, writes next)
// 2. applyPowerCascade (writes FireCoverage in next)
// 3. commitGeneration(fields)  ← ONLY after all scans are done for this tick
// 4. If world.tick % TICKS_PER_MONTH === 0: collectTaxes; deductServiceCosts
// 5. runGrowthPass (reads committed prev fields)
// 6. world.tick++; update calendar
```
how to implement:
1. All scans write to `fields.next`.
2. `commitGeneration` is called exactly once per tick, after ALL scan writes are done.
3. Growth pass reads `fields.prev` (which is now the committed next from step 3).
4. Budget ticks at calendar month boundary only.
acceptance: `test/core/tick-order.test.ts` asserts:
- Land value depends on pollution: zone an industrial tile; run 40 ticks; assert nearby residential tiles have lower LandValue than tiles far from industry.
- Population conservation: run 100 ticks with declining demand; assert `emigratedTotal + totalPopulationInTiles === initial_total`.
- Determinism: two worlds with identical setup → identical `hashWorldState` at ticks 10, 20, 50.
Run `npm test` → green.

---

**`C16` — Population conservation invariant**
dependsOn: `C15`, `C13`
files: `src/core/pop-conservation.ts`, `test/core/pop-conservation.test.ts`
interface:
```ts
export function totalPopulationInTiles(world: WorldState): number;
export function assertPopulationConservation(world: WorldState, initialTotal: number): void;
// throws if totalPopulationInTiles + world.emigratedTotal - world.immigratedTotal !== initialTotal
```
how to implement: sum `tile.population` across all tiles.
acceptance:
- After 200 ticks with mixed growth/decline: `assertPopulationConservation` holds at every tick check.
Run `npm test` → green.

---

**`C17` — Advisor claim engine (C8)**
dependsOn: `C15`, `C01`
files: `src/core/advisor.ts`, `test/core/advisor.test.ts`
interface:
```ts
export interface AdvisorClaim {
  ruleId: string;
  metric: string;
  value: Fixed;
  threshold: Fixed;
  implicatedCells: Coord[];
  causalChain: string[];      // ordered list of metric names, e.g. ['Pollution', 'LandValue', 'abandonment']
}
export type AdvisorRule = (world: WorldState, fields: FieldStore) => AdvisorClaim | null;

// Built-in rules:
export const RULE_HIGH_POLLUTION: AdvisorRule;
// Fires when any tile's Pollution > toFixed(70); implicatedCells = tiles above threshold; causalChain = ['Pollution']

export const RULE_LOW_FIRE_COVERAGE: AdvisorRule;
// Fires when any tile with population > 0 has FireCoverage === ZERO_FIXED; causalChain = ['FireCoverage']

export const RULE_ABANDONMENT_WAVE: AdvisorRule;
// Fires when world.emigratedTotal increased by > 50 in the last TICKS_PER_MONTH; causalChain = ['PopulationDensity','LandValue','tripFailures']

export function runAdvisorEngine(world: WorldState, fields: FieldStore, rules: AdvisorRule[]): AdvisorClaim[];
// Returns only claims for which the rule fired (returned non-null). Order: rules run in input-array order.
```
how to implement:
1. Each rule is a pure function: no side effects, no natural-language generation, just structured claims.
2. `runAdvisorEngine` maps over rules, filters nulls.
3. The `causalChain` is a hardcoded field-name sequence in each rule, not generated text.
acceptance:
- A city with no industry and no fire stations down: `RULE_HIGH_POLLUTION` fires = false; `RULE_LOW_FIRE_COVERAGE` fires = false.
- Force Pollution > toFixed(70) on tile (2,2): `RULE_HIGH_POLLUTION` fires, `implicatedCells` includes (2,2).
- A city with all fire stations powered: `RULE_LOW_FIRE_COVERAGE` fires = false.
- **Anti-hallucination test**: generate 20 random world states with seeded PRNG; assert every returned claim has `value >= threshold` for its metric.
Run `npm test` → green.

---

**`C18` — Seeded disaster: fire incident**
dependsOn: `C10`, `C11`, `C03`, `C02`
files: `src/core/disaster-fire.ts`, `test/core/disaster-fire.test.ts`
interface:
```ts
export interface FireEvent {
  tick: number;
  originTile: Coord;
}
export function scheduleFire(world: WorldState, tick: number, origin: Coord): FireEvent;
export function applyFireSpread(world: WorldState, fields: FieldStore, event: FireEvent): void;
// Each spread step: for each burning tile, neighbors with FireCoverage < toFixed(30) have a 30% chance (via world.prng) of catching fire (building state → 'burned').
// A tile with FireCoverage >= toFixed(30) never spreads fire (protected).
// Run one spread step per call.
```
how to implement:
1. Use `world.prng.nextInt(0, 9) < 3` for the 30% chance — deterministic via seeded PRNG.
2. Iterate neighbors in ascending-index order.
3. Only tiles with `building !== 'empty' && building !== 'burned'` can catch fire.
acceptance:
- A city with no fire coverage: fire spreads to neighbors after 3 spread steps.
- A city with full fire coverage (FireCoverage = FIELD_MAX): fire does not spread beyond origin.
- Two runs with same seed → identical spread pattern (determinism).
Run `npm test` → green.

---

**`C19` — Command log and replay skeleton**
dependsOn: `C03`, `C04`
files: `src/core/command-log.ts`, `test/core/command-log.test.ts`
interface:
```ts
export type MayorCommand =
  | { kind: 'ZoneTile'; tick: number; x: number; y: number; zone: ZoneType }
  | { kind: 'BuildRoad'; tick: number; x: number; y: number }
  | { kind: 'BuildPlant'; tick: number; x: number; y: number }
  | { kind: 'BuildFireStation'; tick: number; x: number; y: number }
  | { kind: 'SetTaxRate'; tick: number; zone: ZoneType; rate: Fixed }
  | { kind: 'SetServiceAllocation'; tick: number; service: string; pct: Fixed };
export interface CommandLog { commands: MayorCommand[]; seed: number; }
export function createCommandLog(seed: number): CommandLog;
export function appendCommand(log: CommandLog, cmd: MayorCommand): void;
export function replayCommandLog(
  log: CommandLog,
  totalTicks: number,
  applyCommand: (world: WorldState, fields: FieldStore, budget: BudgetState, cmd: MayorCommand) => void,
  width: number, height: number,
): { world: WorldState; fields: FieldStore };
```
how to implement: create fresh world + fields; loop ticks; apply commands at matching tick; call `runTick`.
acceptance:
- Empty log, 10 ticks → `world.tick === 10`.
- Two replays → identical `hashWorldState`.
Run `npm test` → green.

---

**`C20` — Coupling-causality fixture (C11 base scenario: industry near residential)**
dependsOn: `C15`, `C07`, `C08`
files: `test/core/coupling-causality.test.ts`
interface: (test only)
how to implement:
1. Create a 10×10 world; place industrial zone at (5,5); place residential zone at (5,3); run 60 ticks.
2. Assert that Pollution at (5,4) is higher than at (5,0) after 60 ticks (pollution diffuses toward residential).
3. Assert that LandValue at (5,3) (near industry) is lower than at (5,0) (far from industry) after 60 ticks.
4. Assert `assertPopulationConservation` holds throughout.
acceptance: all assertions pass. Run `npm test` → green.

---

**`C21` — Blackout cascade fixture (C11 base scenario)**
dependsOn: `C15`, `C10`, `C11`
files: `test/core/blackout-cascade.test.ts`
interface: (test only)
how to implement:
1. Build a city with a plant, 2 fire stations (powered), some residential zones.
2. At tick 20, remove the plant (set tile.building to 'empty'); run 10 more ticks.
3. Assert: after the power scan runs (tick 20 + SCAN_INTERVAL), PowerGrid is ZERO_FIXED everywhere.
4. Assert: after the cascade runs, FireCoverage is ZERO_FIXED for all tiles.
5. Assert: `assertLedgerBalance` still holds throughout.
acceptance: all assertions pass. Run `npm test` → green.

---

**`C22` — Underfunded fire incident fixture (C11 base scenario)**
dependsOn: `C18`, `C15`, `C14`
files: `test/core/fire-underfunded.test.ts`
interface: (test only)
how to implement:
1. Build a city with full funding: fire spreads origin→1 neighbor only (coverage stops it).
2. Repeat with fire service allocation set to 0% (no coverage): fire spreads to 3+ neighbors.
3. Assert the difference in spread is deterministic across two runs with same seed.
acceptance: all assertions pass. Run `npm test` → green.

---

**`C23` — Advisor anti-hallucination canary (C12 invariant 4)**
dependsOn: `C17`
files: `test/core/advisor-anti-hallucination.test.ts`
interface: (test only)
how to implement:
1. Run 50 randomized world states (seeded PRNG, seed 77); for each, call `runAdvisorEngine` with all built-in rules.
2. For every returned `AdvisorClaim`, assert `claim.value >= claim.threshold` (the condition that triggered it is real).
3. Force a world state with all metrics below their thresholds; assert 0 claims fire.
acceptance: all assertions pass. Run `npm test` → green.

---

**`C24` — Migration conservation chaos pass (C12 invariant 2)**
dependsOn: `C16`, `C15`
files: `test/core/migration-conservation.test.ts`
interface: (test only)
how to implement: 300-tick randomized run (seeded PRNG seed 55); call `assertPopulationConservation` every tick.
acceptance: all 300 assertions pass. Run `npm test` → green.

---

**`C25` — Determinism canary (C12 invariant 3)**
dependsOn: `C19`
files: `test/core/determinism.test.ts`
interface: (test only)
how to implement: replay same 200-tick command log twice; check `hashWorldState` at ticks 50, 100, 200 — identical.
acceptance: all assertions pass. Run `npm test` → green.

---

**`C26` — Save/load equivalence**
dependsOn: `C19`
files: `test/core/save-load.test.ts`
interface: (test only)
how to implement: run to tick 100 (hashA); replay to tick 50 then continue to tick 100 (hashB); assert hashA === hashB.
acceptance: passes. Run `npm test` → green.

---

**`C27` — Feedback-loop stability test (C12 invariant 5)**
dependsOn: `C15`, `C09`
files: `test/core/feedback-stability.test.ts`
interface: (test only)
how to implement:
1. Run a 200-tick scenario with heavy industrial zoning; collect Crime and LandValue for tile (3,3) each tick.
2. Assert both series stay within [ZERO_FIXED, FIELD_MAX] throughout (no runaway divergence).
3. Assert the series are eventually monotonically converging: the 20-tick moving average of Crime at tick 180-200 differs by less than 10% from the average at tick 160-180.
acceptance: all assertions pass. Run `npm test` → green.

---

**`C28` — Renderer abstraction boundary**
dependsOn: `C15`
files: `src/renderer/render-types.ts`, `test/renderer/render-boundary.test.ts`
interface:
```ts
export interface TileRenderState { x: number; y: number; zone: ZoneType; building: BuildingState; landValue: number; pollution: number; traffic: number; powered: boolean; }
export interface AdvisorRenderState { ruleId: string; message: string; cells: Coord[]; }
export interface RenderSnapshot { tick: number; tiles: TileRenderState[]; treasury: number; claims: AdvisorRenderState[]; }
export function buildRenderSnapshot(world: WorldState, fields: FieldStore, claims: AdvisorClaim[]): RenderSnapshot;
// Converts Fixed to float; never mutates world or fields.
```
how to implement: map tiles + fields → TileRenderState (convert Fixed to float via `fromFixed`); convert claims to display records.
acceptance: snapshot from world with 4 tiles returns 4 tile render states; two calls = same result.
Run `npm test` → green.

---

**`C29` — Polished city view scaffold (C10)**
dependsOn: `C28`
files: `src/renderer/interpolation.ts`, `src/renderer/canvas-renderer.ts`, `test/renderer/interpolation.test.ts`
interface:
```ts
export function interpolateSnapshot(prev: RenderSnapshot, next: RenderSnapshot, alpha: number): RenderSnapshot;
// No per-tile interpolation needed for fields (they snap at scan boundaries); interpolate advisory panel fade-in only.
export interface CityRenderer { drawFrame(snap: RenderSnapshot, canvas: HTMLCanvasElement): void; }
export function createCityRenderer(): CityRenderer;
// drawFrame: draw colored tile grid (zone colors), building state indicators, overlay toggle-able fields,
// time controls, budget panel, advisor panel. Non-empty visuals — not a letter grid.
```
how to implement: minimal colored tile-grid rendering with zone colors and building state overlays. No `requestAnimationFrame` inside the renderer.
acceptance: `interpolateSnapshot` returns prev at alpha=0, next at alpha=1; renderer does not throw on a valid snapshot.
Run `npm test` → green.

---

**`C30` — Full slice integration test (C13 green gate)**
dependsOn: `C15`, `C20`, `C21`, `C22`, `C23`, `C24`, `C25`, `C26`, `C27`, `C29`
files: `test/integration/slice.test.ts`
interface: (test only)
how to implement:
1. Build a 15×15 city with residential, commercial, industrial, a plant, and a fire station; run 300 ticks.
2. Assert coupling causality: industry near residential lowers LandValue within 30 ticks.
3. Assert population conservation at every tick.
4. Assert treasury = ledger fold at every tick.
5. Assert two replays → identical hash at ticks 100, 200, 300.
6. Assert advisor engine fires at least one valid claim with metric-backed evidence.
acceptance: all assertions pass. Run `npm test` → green.

---

### 3. The decomposition method for the rest

After the first slice is green, use this recipe for all remaining content (additional services, deeper transit, disasters, full RCI density upgrades, more advisor rules).

**Repeatable decomposition recipe:**
1. Name the feature in one sentence. Identify which first-slice types it builds on (field name, scan, entity type).
2. Write the new TypeScript interfaces in full.
3. List which conservation invariants (money, population) it must preserve.
4. Break into 2–5 focused cards: types first, scan/logic second, integration wiring third, acceptance last.
5. For each card: id, title, dependsOn, files, interface, numbered recipe, acceptance.
6. No card adds more than ~100 lines of production code.

**Worked example A — Police coverage field (C5 extension):**
- Card `PC01` — `PoliceCoverage` field scan: add 'PoliceCoverage' to `FieldName` union. Scan reads `Crime` and number of police station tiles; writes coverage radius as radial influence. Accept: a police station at (3,3) raises PoliceCoverage within 3 tiles of it.
- Card `PC02` — Crime suppression by police: update `runCrimeScan` to subtract `PoliceCoverage` from the raw crime value (reads prev generation). Accept: a fully-policed tile has Crime = 0 regardless of density.
- Card `PC03` — Power cascade for police: extend `applyPowerCascade` to also zero PoliceCoverage when a police station is unpowered. Accept: unpowered station → PoliceCoverage drops → Crime rises in that area (coupling test).

**Worked example B — Water/sewage utility (C5 extension):**
- Card `WT01` — `WaterCoverage` field: flood-fill from water pump tiles (similar to power scan). Pumps require power (read PowerGrid from prev). Accept: a powered pump covers tiles in a radius; an unpowered pump covers nothing.
- Card `WT02` — Service degradation: tiles without WaterCoverage have building health penalty (building state can degrade faster). Accept: unpowered pump cascades to zero WaterCoverage within the scan window.
- Card `WT03` — Conservation check: water coverage is not a conserved quantity; document explicitly. Hospital-coverage requires both power and water (a `HospitalCoverage` rule: reads `PowerGrid` AND `WaterCoverage` from prev). Accept: a powered but water-less hospital has zero effective coverage.

**Worked example C — Flood disaster (C9 extension):**
- Card `FL01` — `FloodEvent` type: `{ tick, affectedTiles: Coord[] }` — tiles in a designated floodplain. Seeded: the affected-tile set is drawn from `world.prng` at schedule time. Accept: type-checks; two schedules with same seed → same tiles.
- Card `FL02` — `applyFloodDamage(world, event)`: for each affected tile, set `building = 'flooded'`; population → emigrated. Accept: population conservation holds; tiles are flooded, not silently cleared.
- Card `FL03` — Floodplain risk fixture: place residential on designated floodplain tiles; trigger the flood; assert disproportionate damage vs identical city on non-floodplain tiles. Accept: flooded tiles ≥ non-flooded tiles by a measurable margin; conservation holds for both.

---

### 4. Per-task implementation conventions

**Folder layout:**
```
src/
  core/           # pure sim logic; no DOM, no network
    fixed.ts
    prng.ts
    world.ts
    tile.ts
    hash.ts
    fields.ts
    scan-schedule.ts
    scan-pollution.ts
    scan-land-value.ts
    scan-crime.ts
    scan-power.ts
    scan-traffic.ts
    scan-rci.ts
    cascade-power.ts
    advisor.ts
    ledger.ts
    budget.ts
    disaster-fire.ts
    command-log.ts
    tick.ts
    pop-conservation.ts
  renderer/       # view layer; float allowed; never writes WorldState
    render-types.ts
    interpolation.ts
    canvas-renderer.ts
test/
  core/
  renderer/
  integration/
```

**Naming conventions:**
- Types: PascalCase. Pure functions: camelCase verb-noun. Scan functions: `run<FieldName>Scan`. Constants: SCREAMING_SNAKE_CASE with `// balance constant` comment. Test files: mirror source, `.test.ts`.

**How to write a test (Vitest):**
```ts
import { describe, it, expect } from 'vitest';
import { createWorld, getTile } from '../../src/core/world.js';

describe('tile grid', () => {
  it('initial tile is empty', () => {
    const world = createWorld(1, 10, 10);
    expect(getTile(world, 0, 0).building).toBe('empty');
  });
});
```

**How to keep it deterministic:**
- Always iterate tiles in ascending `y * width + x` index order — never Object.keys or Map iteration without sort.
- Fields read from `prev`, write to `next`; `commitGeneration` is called exactly once per tick after all scans.
- Use `world.prng` (seeded) for any randomness in disasters or growth rolls.
- The renderer reads `RenderSnapshot` (plain converted floats); it never writes back into `WorldState` or `FieldStore`.
- Balance constants get a `// balance constant; KNOWLEDGE_DEBT: source = <reference>` comment.

**How to wire a fixture adapter:**
```ts
// Test setup: deterministic world with scripted initial state
const world = createWorld(42, 10, 10);
const fields = createFieldStore(10, 10);
const budget: BudgetState = { taxRates: { residential: toFixed(10), commercial: toFixed(10), industrial: toFixed(10) }, serviceAllocations: {} };
// Zone tile directly (no UI):
world.tiles[0].zone = 'industrial';
// Run the scan manually:
runPollutionScan(world, fields);
commitGeneration(fields);
```

**Definition of done for any card:**
- All files in `files` compile with `tsc --noEmit`.
- All acceptance tests pass under `npm test`.
- No `Math.random()`, `Date.now()`, or `any` introduced in `src/core/`.
- No I/O in any test.
- `assertLedgerBalance` and `assertPopulationConservation` still pass after integration.
- Every new balance constant has a `// balance constant` comment.

---

### 5. Common pitfalls for a weak model on this project

**Pitfall 1 — Reading `fields.next` instead of `fields.prev` in a scan.**
A 3B model will write a scan that reads the current tick's already-updated values ("seeing its own writes"), creating order-dependent nondeterminism. The double-generation discipline (C05) is the fix: scans always call `readField` (which reads `prev`) and `writeField` (which writes `next`). The determinism canary test (C25) catches this because two runs with different scan orderings will diverge.

**Pitfall 2 — Calling `commitGeneration` inside a scan instead of after all scans.**
If a model commits after each individual scan, later scans in the same tick see the current tick's outputs rather than the previous tick's. The tick dispatcher (C15) must call `commitGeneration` exactly once, after ALL scans have finished writing to `next`. The coupling-causality test (C20) fails if this is wrong.

**Pitfall 3 — Silently zeroing population on abandonment instead of moving it to `emigratedTotal`.**
A 3B model will set `tile.population = 0` on abandonment without incrementing `emigratedTotal`. `assertPopulationConservation` (C16) catches this immediately. Fix: always `world.emigratedTotal += tile.population; tile.population = 0`.

**Pitfall 4 — Mutating `world.treasury` directly instead of using `postLedger`.**
A model may write `world.treasury = addFixed(world.treasury, amount)` directly in a tax or cost function. This bypasses the ledger and breaks `assertLedgerBalance`. Fix: every financial change goes through `postLedger`. The chaos-pass test (C24) and the integration test (C30) run `assertLedgerBalance` every tick and will fail.

**Pitfall 5 — Advisor rules generating text without a backing `AdvisorClaim`.**
A 3B model will be tempted to return a string from an advisor rule ("Things look bad!"). The anti-hallucination test (C23) asserts that every returned `AdvisorClaim` has `claim.value >= claim.threshold`. Fix: rules return `null` or a fully-structured `AdvisorClaim`; never return a claim without checking the metric condition first.

**Pitfall 6 — Using `Math.random()` for disaster or growth probability rolls.**
A model will write `if (Math.random() < 0.3)` for fire spread. This breaks the determinism canary (C25) and the disaster tests. Fix: always use `world.prng.nextInt(0, 9) < 3` (exactly as documented in C18).

**Pitfall 7 — Non-deterministic tile iteration via `for...in` or unordered Map.**
A 3B model will iterate `world.tiles` or a Map with `for...in` or `Object.keys`, which may not be in insertion order in all engines. Fix: always `for (let i = 0; i < world.tiles.length; i++)` — the flat array guarantees ascending index order.

**Pitfall 8 — Feedback loop divergence from unclamped field writes.**
A model may write a scan that adds values without clamping, allowing Pollution or Crime to exceed `FIELD_MAX`. After many ticks, multiplication by an unclamped large value produces astronomically-large LandValue penalties, causing all land value to collapse to zero and all populations to abandon. Fix: every `writeField` call must wrap the value in `clampFixed(..., ZERO_FIXED, FIELD_MAX)`. The stability test (C27) catches this if missed.
