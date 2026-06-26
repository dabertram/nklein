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
