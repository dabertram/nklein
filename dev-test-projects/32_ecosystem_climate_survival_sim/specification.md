# 32 - Living Ecosystem and Climate Survival Simulation

Complexity tier: 32/35 game block
Expected decomposition size: 155-190 dependent implementation cards before coding.
Domain pressure: ecosystem simulation, climate systems, species behavior, food webs, resource cycles, survival strategy, procedural worlds, environmental presentation.
Acceptance command: npm test

## How to use this challenge
This is a game dev-test project specification for evaluating whether an autonomous coding agent can decompose real game systems, implement deterministic simulation logic, and build a polished presentation layer that makes the game understandable and desirable. The goal is not to finish the whole game. The goal is to build a product-grade foundation that proves the agent understands rules, simulation state, player experience, rendering, and verification.

The agent must read this entire specification before planning. It must create a dependency-linked plan, record domain knowledge debt, identify engine and presentation invariants, and choose a release slice that exercises the highest-risk mechanics. For game projects, visual presentation is mandatory, not a stretch goal. A correct simulation hidden behind ugly placeholder UI is not enough.

## Product vision
Build a survival strategy simulation where players manage a settlement inside a living ecosystem. Weather, seasons, water, soil, plants, animals, disease, fire, and human extraction interact. The game should look beautiful and teach systems thinking without becoming a static resource spreadsheet.

## Target players and users
- Simulation players who enjoy ecological cause-and-effect and survival pressure.
- Strategy players balancing settlement growth against ecosystem stability.
- Educators or designers who want visible food webs and climate feedback loops.
- Spectators who enjoy watching landscapes change over seasons and crises.

## Foundation release scope
The first serious buildout must include:
- World, biome, tile, elevation, soil, water, weather cell, season, plant species, animal species, population, disease, fire, settlement, building, worker, resource, policy, event, and scenario models.
- Climate and weather simulation with seasons, temperature, precipitation, drought, storms, wind, humidity placeholder, snowline, and climate trend modifiers.
- Hydrology and soil model for rainfall runoff, rivers, lakes, groundwater placeholder, irrigation, erosion, soil fertility, contamination, and flood risk.
- Plant simulation for growth, spread, seed banks, harvest, drought stress, fire susceptibility, invasive species, and habitat suitability.
- Animal population model with food needs, territory, migration, reproduction, predation, disease, hunting pressure, and carrying capacity.
- Settlement model with housing, food storage, water, fuel, tools, health, morale, labor assignment, construction, extraction, and waste.
- Resource policy system for hunting quotas, forestry, farming, irrigation, firebreaks, conservation zones, and emergency rationing.
- Event system for drought, flood, wildfire, disease outbreak, invasive species, overhunting collapse, crop blight, and migration surge.
- Ecosystem dashboards for food web, biodiversity, soil fertility, water stress, settlement resilience, and long-term trend warnings.
- Seed scenarios for river valley settlement, drought recovery, invasive predator, wildfire season, overfishing collapse, and climate migration pressure.

## Gameplay requirements
- Player success should depend on resilience and ecological balance, not only stockpiling resources.
- The simulation should expose delayed consequences and feedback loops.
- Policies should create tradeoffs between short-term survival and long-term ecosystem stability.
- Crisis events must be connected to underlying conditions when possible.

## Presentation requirements
Very nice presentation is mandatory for this challenge. The agent must treat rendering, animation, interaction feedback, and layout polish as core acceptance criteria. Required presentation work:
- The world must be visually rich: terrain elevation, water movement, seasonal color changes, vegetation spread, animal movement, smoke/fire, storms, settlement activity, and damage states.
- Overlays must make invisible systems legible: moisture, soil fertility, habitat, migration, disease, fire risk, food web pressure, and climate trend.
- The UI should include beautiful time controls, scenario goals, event timeline, ecosystem inspector, settlement dashboard, and policy panels.
- Transitions across seasons and disasters should be animated enough to communicate change and consequence.
- A static map with numbers does not satisfy the game presentation requirement.

## Architecture requirements
- Separate procedural world generation, climate/weather, hydrology/soil, plant simulation, animal simulation, settlement economy, policy engine, event system, analytics, save/replay, and renderer.
- Use deterministic seeded simulation and fixed-step updates for tests.
- Represent species and biomes as data definitions with testable parameters.
- Make dashboards and overlays derived from simulation state, not manually maintained UI values.

## Domain knowledge debt to surface
The agent should not pretend to know every game design, simulation, AI, rendering, or balancing detail perfectly. It should mark assumptions, build deterministic subsets, and preserve extension points for future designers, artists, balance passes, and live integrations. Required knowledge areas:
- Ecological systems involve feedback loops, thresholds, delayed effects, and uncertainty.
- Food webs require producer, herbivore, predator, decomposer/resource-cycle thinking even in a simplified game.
- Climate and hydrology need simplified but coherent unit assumptions.
- A survival sim must surface cause and effect without pretending to be a scientific model.

## Required challenge scenarios
The implementation plan and fixtures should be shaped around scenarios like these. They do not all need full UI coverage in the first slice, but the core model and presentation should be capable of representing them:
- Overhunting deer causes predator decline, plant overgrowth changes fire risk, and later crops suffer from pest pressure.
- A drought lowers groundwater, reduces crop yields, pushes animals to migrate, and increases fire risk.
- Irrigation saves farms but depletes river flow and damages downstream wetland habitat.
- An invasive species outcompetes native plants and changes animal carrying capacity.
- A wildfire spreads according to wind, vegetation, moisture, and firebreak policy.

## Decomposition pressure
This challenge should force decomposition across rules or simulation engine, deterministic fixtures, AI or policy layers, replay/save state, player-facing presentation, UI interaction, diagnostics, and test harnesses. The plan should include dependency links so core state, commands, invariants, and golden tests are built before rendering depends on them. Avoid starting with a visual mock that cannot play the game; also avoid building a correct but lifeless engine with no usable presentation.

The agent should maintain a visible knowledge-debt list covering unclear rules, balance assumptions, AI limitations, rendering tradeoffs, asset gaps, accessibility concerns, performance constraints, and future designer review checkpoints. Knowledge debt is not a failure; hiding it is.

## Acceptance criteria
- Climate tests cover seasons, precipitation, drought, storms, wind, and trend modifiers.
- Hydrology/soil tests cover runoff, flood risk, fertility, erosion, contamination, and irrigation effects.
- Species tests cover growth, spread, migration, predation, reproduction, disease, and carrying capacity.
- Settlement tests cover food, water, labor, construction, extraction, waste, health, morale, and resilience.
- Event tests cover drought, flood, wildfire, disease, invasive species, and overharvest collapse.
- Presentation checks verify animated ecosystem, overlays, inspectors, timeline, and no unreadable dashboard clutter.
- The project passes npm test with deterministic seeds.

## Explicit non-goals
- Do not make this a stockpile spreadsheet with nature-themed labels.
- Do not claim scientific precision beyond the simplified model.
- Do not hide ecosystem feedback behind one health score.
- Do not skip visual change over time.

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

> Added 2026-06-26 via deep domain research. **The single defining property of this project:** the world is a *long-running, coupled, nonlinear dynamical system* whose interesting behavior — collapse, recovery, regime shift, delayed pest cascade — only emerges over many simulated years, so the build lives or dies on a **deterministic, fixed-tick, conservation-respecting simulation core that produces byte-identical multi-decade histories from `(seed, command log)`** and surfaces its invisible feedback loops legibly. A pretty terrain with random numbers is the failure mode; a *replayable ecosystem that can collapse for traceable reasons* is the win.

## E0. The grading rubric (what actually makes this master-grade)

The naive version is "tiles with weather and animals that wander." That is untestable (no two runs agree), unfaithful (populations blow up or vanish for no reason), and unreadable (one health bar). The disciplined version treats the world as an **integrator of named ecological models** under a logical clock, where every state change is conserved, attributable, and replayable. Grade on:

1. **Determinism** — `simulate(seed, commands, years)` twice yields bit-identical state hashes at every checkpoint (the lockstep gold standard: only inputs + seed are stored; state is recomputed). [gafferongames.com/post/deterministic_lockstep](https://gafferongames.com/post/deterministic_lockstep/)
2. **Conservation** — energy through the food web, water through the hydrological cycle, biomass/nitrogen through the soil, and individuals through population transitions are never silently created or destroyed; every delta has a source and sink. This is the spine that separates an ecosystem from a spreadsheet of nature-themed counters.
3. **Causal legibility** — any population crash, fire, or famine is explainable as a traversal back to first causes (a drought reading, an overhunt command, a fuel-load threshold), not a die-roll.
4. **Emergence under weak authorship** — the model produces predator–prey oscillation, trophic cascades, invasion fronts, and regime shifts *from the rules*, not from scripted events. The events are *consequences*.

Everything below serves those four.

## E1. The deterministic simulation kernel (the foundation under the foundation)

Build this before a single species exists. ~15–20 cards.

- **Logical fixed-tick clock.** No `Date.now()`/`setTimeout` anywhere in core. The world advances in fixed simulation steps (e.g. 1 tick = 6 in-game hours → 4 ticks/day; a "day" and a "season" are integer tick counts). Decouple simulation rate from render rate exactly as in *Fix Your Timestep* — render interpolates between the last two simulation snapshots; the simulation never reads the wall clock. [gafferongames.com/post/fix_your_timestep](https://gafferongames.com/post/fix_your_timestep/)
- **Fixed-point or integer-quantized state for all conserved quantities.** Energy ledgers, water volumes, biomass, and populations are integers or fixed-point (Q16.16-style), never IEEE floats, because float results are *not* reproducible across machines/compilers/build modes and a 1-ULP drift desyncs an entire multi-year replay. Provide deterministic helpers (LUT-based trig for wind vectors, integer division with explicit rounding) rather than `Math.sin`/raw `/`. [gamedeveloper.com/programming/cross-platform-rts-synchronization-and-floating-point-indeterminism](https://www.gamedeveloper.com/programming/cross-platform-rts-synchronization-and-floating-point-indeterminism), [gafferongames.com/post/floating_point_determinism](https://gafferongames.com/post/floating_point_determinism/)
- **Single seeded PRNG tree.** One root seed forks named, reproducible sub-streams (weather, reproduction, mutation, migration jitter, disease ignition). A subsystem must never reach into another's stream; ordering of draws is part of the contract. Use a documented portable PRNG (e.g. xorshift/PCG with fixed integer arithmetic), never `Math.random()`.
- **Deterministic iteration order everywhere.** Entities (animals, plants, weather cells, fire cells) are processed in a stable, documented order (e.g. by tile index then by stable entity id). The classic determinism bug is hash-map iteration order; forbid it in core. [gafferongames.com/post/deterministic_lockstep](https://gafferongames.com/post/deterministic_lockstep/)
- **Event-sourced command + snapshot model.** Player commands (set hunting quota, place firebreak, build, ration) are an append-only log. Authoritative history = fold(initial world, command log) under the clock. A **state checksum** (hash of the conserved ledgers + entity table) is computed every checkpoint; two runs from the same seed must match every checksum. Snapshots are periodic compactions so a 50-year save loads fast and replay can fast-forward.
- **The flagship test — the time-machine harness.** `runWorld(seed, scenarioPack, years)` fast-forwards decades, snapshots at any tick, kills and restores from durable state mid-run, and asserts the global invariants (E9) held at *every* checkpoint. The headline acceptance is a **multi-decade deterministic run with two byte-identical replays and zero invariant violations.**

## E2. Conservation laws as the load-bearing model (energy, water, mass, individuals)

This is the section that makes a domain expert nod. Each subsystem is a *conserving flow*, grounded in the standard model:

- **Trophic energy flow.** Model the canonical producer → herbivore → carnivore → decomposer chain as an explicit energy ledger, in the lineage of the Wilensky NetLogo wolf–sheep–grass model: every actor spends a fixed energy cost per tick, gains energy only by eating (grass regrows at a bounded rate, herbivores convert plant energy, predators convert prey energy), reproduces only above an energy threshold, and dies at zero. Carrying capacity is then **emergent** from energy availability, not a hard cap. The **10% trophic transfer efficiency** rule (Lindeman) caps energy passed up each level; the rest is lost as metabolic heat to an explicit "dissipated" sink so the ledger still balances. [mesa.readthedocs.io/stable/examples/advanced/wolf_sheep.html](https://mesa.readthedocs.io/stable/examples/advanced/wolf_sheep.html), [ccl.northwestern.edu/netlogo/models/WolfSheepPredation](https://ccl.northwestern.edu/netlogo/models/WolfSheepPredation(DockedHybrid))
- **Continuous population dynamics where appropriate (Lotka–Volterra).** For aggregate (non-individual) populations, integrate the predator–prey system ẋ = αx − βxy, ẏ = −γy + δxy. **Choose the integrator deliberately:** plain explicit Euler injects energy and spirals populations to infinity (a real bug, not a feature); RK4 conserves the invariant to O(Δt⁴) but still drifts over decades; a **symplectic/structure-preserving integrator** keeps the closed orbit stable over long runs. The choice is a documented knowledge-debt decision with a property test on the conserved quantity. The coexistence equilibrium (γ/δ, α/β) is a neutral *center* with eigenvalues ±i√(αγ) — perturbations orbit, they do not damp — which is the mathematical reason populations *oscillate* rather than settle, and is itself testable. [shelvean.github.io/math-tools/lotkavolterra.html](https://shelvean.github.io/math-tools/lotkavolterra.html), [cfm.brown.edu/people/dobrush/am34/Mathematica/ch3/lotka.html](https://www.cfm.brown.edu/people/dobrush/am34/Mathematica/ch3/lotka.html)
- **Hydrological water balance (TOPMODEL-grounded).** Model the soil column as three reservoirs — root zone, unsaturated zone, saturated (groundwater) zone — with transfers governed by a Darcy-law approximation and a **topographic wetness index** (a function of upslope contributing area and local slope) deciding where saturation/overland flow occurs. Precipitation in must equal evapotranspiration + runoff + storage change out, every tick: ΔStorage = P − ET − Q. Irrigation withdraws from river/groundwater storage and *must* reduce downstream flow — this is how "irrigation saves the farm but kills the wetland" becomes an emergent consequence rather than a scripted penalty. [github.com/NOAA-OWP/topmodel](https://github.com/NOAA-OWP/topmodel), [hydrology.usu.edu/rrp/pdfs/ch6.pdf](https://hydrology.usu.edu/rrp/pdfs/ch6.pdf)
- **Soil fertility / nutrient mass.** Nitrogen/organic-matter is a conserved pool: harvest and erosion remove it, decomposers and fallow restore it, fertilizer adds a tracked external input. Continuous extraction without return must monotonically degrade fertility (a ratchet).
- **Population as conserved transitions (SIR/SEIR for disease).** Individuals move between compartments (susceptible → exposed → infectious → recovered/dead) by rate-governed flows; the sum across compartments changes only by explicit births/deaths, never by bookkeeping error — the well-mixed Kermack–McKendrick model as the testable backbone, with spatial contact for local outbreaks. [scielo.br/j/rbef/a/HsQxH85ndLXLy78vXTCfVct/?lang=en](http://www.scielo.br/j/rbef/a/HsQxH85ndLXLy78vXTCfVct/?lang=en)

**Anti-pattern to avoid (cite it):** Victoria 3 deliberately *does not* conserve goods — it wipes the slate each cycle and "creates or destroys value" when supply ≠ demand, which is a defensible design for that game but produces money/goods that appear from nowhere. This sim takes the opposite stance: **conservation is an invariant, and any non-conservation is a bug with a failing test.** [gamedeveloper.com/design/deep-dive-modeling-the-global-economy-in-victoria-3](https://www.gamedeveloper.com/design/deep-dive-modeling-the-global-economy-in-victoria-3)

## E3. Climate forcing, feedback, and the regime-shift engine (the emergent crux)

The most defining ecological behavior — and the hardest to fake — is **nonlinear feedback with thresholds, delays, and hysteresis.**

- **Climate as slow forcing on fast subsystems.** A multi-year climate trend (a drought-ward drift, a warming snowline) is a slow driver; weather is its fast, seeded realization (temperature, precipitation, wind, humidity per cell per season). Seasons are deterministic tick bands modulating growth, evaporation, and reproduction windows.
- **Feedback loops are explicit and signed.** Overgrazing → less ground cover → faster runoff → lower soil moisture → less regrowth (reinforcing collapse); predator loss → herbivore boom → vegetation loss → altered fuel load → fire-regime change (the "overhunting deer" scenario, end to end). These are wired as data, not scripted.
- **Alternative stable states + hysteresis.** Implement at least one subsystem that is **bistable**: e.g. vegetated vs. desertified soil, or clear vs. turbid water. Past a tipping point the system flips to the alternative basin and *does not return* when the stressor is relaxed to the same level — the forward and backward thresholds differ (hysteresis). This is the scientifically-grounded mechanism behind "irreversible collapse." [sciences.ucf.edu/biology/.../Scheffer-Carpenter-2003.pdf](https://sciences.ucf.edu/biology/d4lab/wp-content/uploads/sites/23/2024/08/Scheffer-Carpenter-2003.pdf), [nature.com/scitable/knowledge/library/alternative-stable-states-78274277](https://www.nature.com/scitable/knowledge/library/alternative-stable-states-78274277/)
- **Early-warning indicators as derived, testable telemetry.** Before a tipping point, resilience falls and the system shows **critical slowing down**: rising lag-1 autocorrelation and variance in the state variable. Compute these as overlay metrics — they make the dashboard a genuine forecasting tool *and* give a precise property test (the indicator must rise in the run-up to a scripted collapse). [pmc.ncbi.nlm.nih.gov/articles/PMC9234815](https://pmc.ncbi.nlm.nih.gov/articles/PMC9234815/)

## E4. The wildfire model (physically-grounded, deterministic, and the showpiece)

Fire is the most cinematic system *and* the most testable, because it has a real physical model.

- **Cellular-automaton spread on the tile grid**, where each cell's ignition probability/rate to its neighbors is a function of **fuel load, fuel moisture, wind speed + direction, and slope** — the standard CA-over-Rothermel approach used in operational simulators (Cell2Fire, PROPAGATOR). Rothermel's rate-of-spread is itself an **energy-conservation** model (a porous fuel bed with continuous flame spread), so fire ties back to E2: burning converts stored plant energy/biomass into heat (dissipated sink) and ash (a soil-nutrient input), conserving mass. [mdpi.com/2571-6255/3/3/26](https://www.mdpi.com/2571-6255/3/3/26), [frontiersin.org/articles/10.3389/ffgc.2021.692706/full](https://www.frontiersin.org/journals/forests-and-global-change/articles/10.3389/ffgc.2021.692706/full), [sciencedirect.com/science/article/pii/S2212420925002559](https://www.sciencedirect.com/science/article/pii/S2212420925002559)
- **Firebreaks, moisture, and wind are real controls.** A player-placed firebreak (zero-fuel cells) must measurably alter spread; a wet season must lower it; a wind shift must redirect the front. Each is a deterministic, asserted consequence.
- **The post-fire successional loop closes back to ecology:** cleared fuel resets fire risk, ash boosts fertility short-term, and the regrowth/invasion race determines the next regime — fire is not a one-shot disaster but a *recurring regime driver*.

## E5. Species, biomes, and behavior as data (legible, tunable, testable)

- **Species and biomes are pure data definitions** (energy costs, diet, reproduction thresholds, temperature/moisture tolerance envelopes, spread/migration rules), so a balance pass is data editing, not code surgery — and each parameter is a unit-typed, documented value with a test.
- **Habitat suitability** is a derived score per tile per species (from moisture, temperature, food, cover); animals migrate down suitability gradients deterministically. Invasive species are just a species with an aggressive spread rule and a tolerance edge — the "invasive outcompetes native" scenario is *emergent* from suitability + competition, not a scripted swap.
- **Behavior is explainable.** Every animal decision (forage / flee / migrate / reproduce) records its driving factors (energy level, local threat, suitability gradient) as a reasoning trace, so the inspector can answer "why did the herd move?" from facts.

## E6. Presentation that renders the invisible (mandatory, derived, never hand-maintained)

The spec demands beauty; the discipline is that **every visual is a pure projection of simulation state** — overlays are reads, not authored values.

- **Living world layer:** terrain elevation, animated water flow following the hydrology gradient, seasonal vegetation color driven by the actual biomass/season state, animal movement, smoke/fire fronts from the CA, storms, settlement activity, and damage/drought states.
- **Legibility overlays (the heart of "systems thinking"):** moisture, soil fertility, habitat suitability, migration pressure, disease prevalence (SIR compartment shading), fire-risk (fuel × dryness × wind), trophic/food-web pressure, and the **regime-shift early-warning heatmap** (E3). Each overlay states its units and links to its source facts.
- **Time + consequence:** smooth season transitions, a scrubbable event timeline where each crisis links to its causal chain, an ecosystem inspector (food web, biodiversity index, energy pyramid), a settlement dashboard, and policy panels with explicit tradeoff previews. **Animated change over time is acceptance, not decoration;** a static numeric map fails.

## E7. The policy / survival layer (tradeoffs with delayed teeth)

- **Policies are constraints on flows**, not instant outcomes: hunting quotas cap predation removal, forestry caps biomass extraction, irrigation reallocates water storage, firebreaks zero out fuel, conservation zones suppress extraction, rationing changes settlement consumption. Each creates a **short-term-survival vs. long-term-stability** tension with a *delayed* consequence (the pest cascade arrives seasons after the overhunt).
- **The settlement is itself a conserving node:** food/water/fuel/tools are stocks with inflows (harvest/extraction) and outflows (consumption/decay/waste); health and morale derive from whether needs are met. Resilience is a derived, multi-factor read, never a single hidden score (an explicit non-goal).

## E8. The adversarial / edge-case scenario pack (ship the hard cases as fixtures)

Concrete, seeded, deterministically-asserted situations the model must handle correctly — the difference between a sim and a demo:

- **Trophic cascade:** overhunt deer → predator starvation → vegetation overgrowth → fuel-load spike → larger fire next dry season → ash fertility pulse → pest-favoring regrowth → later crop pest pressure. Assert the *full causal chain* fires in order, conservation holds throughout, and the timeline links each link to the prior.
- **Drought → multi-system stress:** groundwater drawdown lowers crop yield, pushes animals to migrate along suitability gradients, and raises fire risk — three coupled subsystems from one forcing.
- **Irrigation downstream harm:** farm survives, river flow drops, wetland habitat suitability collapses — emergent from the water-balance, not a penalty table.
- **Invasion front:** invasive plant outcompetes natives, shifting herbivore carrying capacity and the whole energy pyramid.
- **Wind-driven wildfire vs. firebreak:** identical ignition, two wind seeds, with/without firebreak → measurably different burned area.
- **Determinism stressors:** integrator blow-up guard (Euler vs. symplectic on the same scenario), snapshot/restore mid-drought with identical continuation, and a **regime-shift hysteresis** case where relaxing the stressor does *not* restore the prior state.
- **The numerical-stability trap (knowledge-debt made testable):** a fixture that would explode under naive Euler must stay bounded under the chosen integrator, proving the team made the integrator choice consciously.

## E9. Global invariants (property-based — this is how the sim is graded)

Across randomized + scripted multi-year runs, assert system-wide properties, not just examples:

1. **Energy conservation** — Σ(energy in food web + dissipated sink) is constant up to explicit external solar input; no actor gains energy without a matching source debit.
2. **Water conservation** — per-watershed, ΔStorage == P − ET − Q every tick; irrigation/runoff move water, never mint it.
3. **Mass/nutrient conservation** — soil nutrient + biomass + ash + harvested-stock balances across growth, death, decomposition, fire, and extraction.
4. **Population continuity** — SIR/SEIR compartment sums change only via explicit birth/death flows; no individual teleports between compartments without a rate-governed transition.
5. **Monotone ratchets** — continuous over-extraction with no replenishment never *increases* the degraded stock (fertility, fish biomass) — degradation is monotone absent recovery inputs.
6. **Determinism** — equal `(seed, command log)` ⇒ byte-identical checkpoint hashes across two runs and across a snapshot/restore boundary.
7. **Causal totality** — every crisis event in the timeline has a non-empty evidence chain terminating in source facts (readings/commands), never a bare die-roll.
8. **Hysteresis correctness** — for the bistable subsystem, the forward and backward tipping thresholds differ; relaxing the driver to its pre-collapse value does not auto-restore the prior basin.

Plus a **chaos mode**: corrupt-then-recover from snapshot, reorder independent same-tick events (must not change outcome given the documented ordering rule), and run extreme forcings (perpetual drought, zero predators) asserting graceful, conserved degradation rather than NaN/overflow.

## E10. The concrete first vertical slice (the on-ramp — build THIS first, ~40–55 cards)

Do **not** spread the first release across all biomes and species. Prove the spine on **one river-valley map** with a minimal but *complete* food web:

- The **deterministic kernel** (E1): fixed-tick clock, fixed-point conserved ledgers, seeded PRNG tree, command log, state checksum, snapshot/restore.
- **Conservation core** (E2): grass → herbivore → predator energy ledger + the three-reservoir water balance + soil fertility pool, each with its conservation test.
- **One climate forcing** (E3): a seeded drought trend with seasons, plus the critical-slowing-down early-warning metric.
- **The wildfire CA** (E4) with fuel/moisture/wind/slope + firebreaks, closing the loop to fertility.
- **The "overhunting deer" trophic-cascade scenario** (E8) running end-to-end with its full causal chain asserted.
- **Presentation** (E6): animated terrain/water/seasons/fire + the moisture, habitat, fire-risk, and early-warning overlays + a scrubbable timeline whose crisis entries link to causes + an ecosystem inspector showing the live energy pyramid.
- **The multi-decade time-machine test** (E1/E9) green on this slice with all global invariants holding, including one snapshot/restore and one regime-shift-with-hysteresis.

If that slice is real — a valley that can be driven to a *traceable, replayable, conserved* collapse and recovery — every later biome, species, and disaster is breadth on a proven spine. If it isn't, no amount of terrain art saves it.

## E11. Domain knowledge-debt to track (surface, don't bluff)

Each item gets an owner, a risk note, and an **expert-review-needed** flag; some *gate* features until resolved:

- **Integrator choice & numerical stability** (Euler vs. RK4 vs. symplectic) — affects long-run conservation; needs a documented decision + property test before aggregate-population dynamics ship.
- **Ecological parameter realism** — energy costs, transfer efficiencies, reproduction thresholds, tolerance envelopes are simplified; flag where a real ecologist must validate, and never claim scientific precision (explicit non-goal).
- **Unit coherence** — climate/hydrology need consistent simplified units (energy, mm of water, °C, kg biomass); document the unit system and assert it.
- **Spatial resolution vs. performance** — CA fire and per-tile hydrology cost scales with grid size; record the resolution tradeoff and the performance budget for a decade-long run.
- **Fixture realism limits** — seeded weather/disease packs are *plausible*, not historical; mark them as adapters.
- **Accessibility** — overlays must not encode meaning by color alone (the colorblind-safe palette + secondary encoding is a tracked debt).

## E12. Why this is a great !Klein challenge

It stresses exactly the capabilities !Klein exists to prove with small, fallible local models: **deep decomposition** (a coupled multi-system simulation that *must* be built core-first, conservation-before-rendering, with dependency-ordered cards), **determinism under weak authorship** (the agents cannot hand-wave a fixed-tick conserving kernel — the property tests will catch float drift, energy leaks, and nondeterministic iteration immediately), **long-running stateful correctness** (decade-scale event-sourced replay with snapshot/restore), and **legible reasoning** (every crisis must be explainable from facts, mirroring !Klein's own evidence discipline). The reward is genuinely delightful to watch: a swarm of small models composing a *living valley* that oscillates, burns, recovers, and occasionally tips — for reasons you can always trace. Build the kernel + conservation laws + one trophic-cascade slice (E1, E2, E10) first; earn the rest.

---

## Small-model build guide (3B-ready)

> This section exists so a ~3B local model can follow the spec mechanically. Every card below is independently implementable and verifiable with `npm test`. The 3B must **follow** these instructions, not reason about them.

### 1. Glossary & ground rules

**Domain terms**

| Term | Meaning in this project |
|---|---|
| Tick | One fixed simulation step. 1 tick = 6 in-game hours. 4 ticks = 1 day. 120 ticks = 1 season. 480 ticks = 1 year. |
| Fixed-point (FP) | Integer math scaled by a power of 2. Use `Q16` = integer × 65536. All conserved quantities (energy, water, biomass, population) are FP, never `number` floats. |
| PRNG | Pseudo-random number generator. One per named stream. Never call `Math.random()`. |
| Seed | A 32-bit unsigned integer. All randomness derives from it. Same seed + same commands = same output, always. |
| Checksum | A hash of the full simulation state at a tick. Two runs from the same seed must produce identical checksums at every checkpoint. |
| Snapshot | A serialized copy of state at a tick, used to restore mid-run without re-simulating from tick 0. |
| Command log | The ordered list of player commands applied so far. Replay = apply log to initial state. |
| Energy ledger | The exact integer accounting of energy flowing through grass → herbivore → predator → dissipated sink. Every delta has a source and a sink. |
| Fuel load | Integer kg/m² of dry combustible biomass in a tile. Drives fire spread. |
| Trophic level | Producer (grass), herbivore (deer), predator (wolf). Each step loses 90% of energy (10% efficiency rule). |
| SIR | Susceptible → Infectious → Recovered. A disease compartment model. Sums across compartments change only by explicit birth/death flows. |
| Hysteresis | Forward and backward tipping thresholds differ. A desertified tile does NOT recover when moisture returns to its pre-collapse level. |
| CA | Cellular automaton. Fire spreads tick-by-tick; each burning cell may ignite neighbors based on fuel/moisture/wind/slope. |
| TWI | Topographic Wetness Index. Determines where overland water flow concentrates. Used for soil saturation. |
| Biome | A tile category with fixed base parameters (base temperature, moisture, fuel-load growth rate, species tolerances). |
| Settlement | The player's colony. Has food/water/fuel/health/morale stocks. Consumes and extracts from the ecosystem. |
| Policy | A player-issued constraint on extraction rate (hunting quota, forestry limit, irrigation cap). Applied to the command log. |

**Stack**

- Language: TypeScript (strict mode, no `any`)
- Runtime: Node.js 20+
- Test runner: `npm test` runs `vitest run`
- Key math helper: `src/fp.ts` — all FP arithmetic lives here (see `S02`)
- Key PRNG: `src/prng.ts` — xorshift32, one per named stream (see `S03`)
- File layout: `src/` for simulation core, `test/` for tests, `src/renderer/` for presentation, `src/adapters/` for fixture stubs

**Ground rules (imperative)**

1. Never call `Date.now()`, `Math.random()`, `setTimeout`, or `setInterval` inside `src/` core modules.
2. All conserved quantities are FP integers. Never store energy, water, biomass, or population as `number` floats in the simulation state.
3. Process entities (tiles, animals, fire cells) in ascending tile-index order, then by stable entity id within a tile. Never iterate a `Map` or `Set` for order-sensitive processing.
4. Every test must be self-contained: import only `src/` modules and fixtures; no network calls, no file I/O beyond reading fixtures from `test/fixtures/`.
5. `npm test` must pass offline. No live LLM, no network, no wall-clock randomness.
6. Stubs for external integrations (renderer, live data) go in `src/adapters/` and must have a deterministic fixture implementation alongside.
7. Acceptance = `npm test` green. Run this after every card.

---

### 2. The explicit task graph for the first vertical slice

The first slice targets **E1 (kernel) + E2 (conservation core: grass/deer/wolf + water balance + soil) + one drought forcing (E3) + the wildfire CA (E4) + the overhunting trophic-cascade scenario (E8) + time-machine replay test (E9)**. No renderer cards are in the slice; renderer depends on a stable sim core.

Cards are in strict dependency order. Each depends only on prior cards listed in `dependsOn`.

---

**`S01` — Project scaffold and TypeScript config**
dependsOn: none
files: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/types.ts`
interface:
```ts
// src/types.ts
export type FP = number; // brand: always Q16 integer, never raw float
export type Tick = number; // non-negative integer
export type Seed = number; // uint32
export type TileIndex = number; // 0-based row-major grid index
export type EntityId = number; // stable, monotonically assigned
```
how to implement:
1. Run `npm init -y` (or create `package.json` manually with `"type": "module"`).
2. Add `vitest` as a dev dependency in `package.json` with `"test": "vitest run"`.
3. Create `tsconfig.json` with `"strict": true`, `"noImplicitAny": true`, `"target": "ES2022"`, `"module": "NodeNext"`.
4. Create `vitest.config.ts` with default config pointing at `test/` glob.
5. Create `src/types.ts` with the four branded types above (comments as branding, not TS branded types — keep it simple for a 3B).
acceptance: `npm test` exits 0 with zero test files (vitest emits a warning but exits 0). Confirm `tsc --noEmit` has no errors.

---

**`S02` — Fixed-point arithmetic helpers**
dependsOn: `S01`
files: `src/fp.ts`, `test/fp.test.ts`
interface:
```ts
// src/fp.ts
export const FP_SCALE = 65536; // 2^16
export function toFP(n: number): FP     // round(n * FP_SCALE) — use only at boundaries
export function fromFP(fp: FP): number  // fp / FP_SCALE — use only for display/test assertions
export function fpAdd(a: FP, b: FP): FP // a + b
export function fpSub(a: FP, b: FP): FP // a - b; throws if result < 0 (conservation guard)
export function fpMul(a: FP, b: FP): FP // Math.trunc((a * b) / FP_SCALE)
export function fpDiv(a: FP, b: FP): FP // Math.trunc((a * FP_SCALE) / b); throws if b === 0
export function fpClamp(v: FP, lo: FP, hi: FP): FP
```
how to implement:
1. Create `src/fp.ts` with the functions above using only integer arithmetic (`Math.trunc`, `|0`, bitwise ops).
2. `fpSub` must throw `Error("Conservation violated: negative result")` if the result would be negative — this is the guard against energy/water leaks.
3. Create `test/fp.test.ts` with vitest `describe`/`it` blocks.
acceptance: `test/fp.test.ts` asserts:
- `fromFP(toFP(3.5)) ≈ 3.5` (within `1/FP_SCALE`)
- `fromFP(fpAdd(toFP(1), toFP(2))) === 3`
- `fromFP(fpMul(toFP(0.1), toFP(10))) ≈ 1` (within rounding)
- `fpSub(toFP(5), toFP(3))` does not throw; result is `toFP(2)`
- `fpSub(toFP(1), toFP(2))` throws with "Conservation violated"
- `fpDiv(toFP(10), toFP(4))` equals `toFP(2.5)` (within 1 ULP of Q16)
All passing, `npm test` green.

---

**`S03` — Seeded PRNG tree**
dependsOn: `S01`
files: `src/prng.ts`, `test/prng.test.ts`
interface:
```ts
// src/prng.ts
export type PrngStream = { name: string; state: number }; // mutable, call next() to advance
export function createPrngTree(rootSeed: Seed): PrngTree
export type PrngTree = {
  weather: PrngStream;
  reproduction: PrngStream;
  migration: PrngStream;
  disease: PrngStream;
  fire: PrngStream;
  // add more streams here as needed
};
export function nextUint32(stream: PrngStream): number  // advances stream, returns uint32 in [0, 2^32)
export function nextFloat01(stream: PrngStream): number // nextUint32 / 2^32, for display only — do NOT use in core sim
export function nextIntBelow(stream: PrngStream, n: number): number // [0, n)
```
how to implement:
1. Use xorshift32: `state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0`.
2. Fork each named stream from `rootSeed` by seeding it with `xorshift32(rootSeed + streamIndex)`.
3. `streamIndex` is the 0-based position in the object literal (weather=0, reproduction=1, …).
4. Streams are stateful objects — callers advance them in documented order; changing order changes output (that is intentional and must be documented).
acceptance: `test/prng.test.ts` asserts:
- Two `createPrngTree(42)` instances produce the same sequence of 100 values from `weather`.
- Weather and reproduction streams produce *different* sequences (different seeds).
- `nextIntBelow(stream, 10)` always returns a value in `[0, 9]` over 1000 calls.
- `npm test` green.

---

**`S04` — World grid and tile model**
dependsOn: `S01`, `S02`
files: `src/world.ts`, `test/world.test.ts`
interface:
```ts
// src/world.ts
export type Tile = {
  index: TileIndex;      // row * width + col
  elevation: FP;         // metres Q16
  moisture: FP;          // mm of water Q16
  soilFertility: FP;     // 0–100 Q16 scale
  fuelLoad: FP;          // kg/m² Q16
  biomass: FP;           // kg/m² Q16 (living plant material)
  fireState: "none" | "burning" | "burnt";
  biomeId: string;       // e.g. "river_valley"
};
export type WorldGrid = {
  width: number;
  height: number;
  tiles: Tile[];         // length === width * height, row-major
};
export function createWorldGrid(width: number, height: number, biomeId: string): WorldGrid
export function getTile(grid: WorldGrid, col: number, row: number): Tile
export function tileIndex(grid: WorldGrid, col: number, row: number): TileIndex
export function tileNeighbors(grid: WorldGrid, index: TileIndex): TileIndex[] // 4-connected
```
how to implement:
1. Create `src/world.ts`. `createWorldGrid` fills a flat `tiles` array of length `width * height`.
2. All FP fields initialize to `toFP(0)` except `elevation` and `moisture` which take biome defaults (hardcode for "river_valley": elevation=`toFP(50)`, moisture=`toFP(200)`, soilFertility=`toFP(60)`, fuelLoad=`toFP(2)`, biomass=`toFP(5)`).
3. `tileNeighbors` returns only valid indices (skip out-of-bounds).
acceptance: `test/world.test.ts` asserts:
- `createWorldGrid(4, 4, "river_valley")` has 16 tiles.
- `getTile(grid, 1, 1).index === 5` (row=1, col=1, width=4 → index=5).
- `tileNeighbors(grid, 0)` returns `[1, 4]` (top-left corner, 4-connected, no out-of-bounds).
- All tiles have `moisture === toFP(200)`.
- `npm test` green.

---

**`S05` — Simulation clock and tick driver**
dependsOn: `S01`, `S03`, `S04`
files: `src/clock.ts`, `test/clock.test.ts`
interface:
```ts
// src/clock.ts
export type SimClock = {
  tick: Tick;            // current tick, starts at 0
  season: "spring" | "summer" | "autumn" | "winter";
  year: number;
  dayOfSeason: number;   // 0–29 (each season is 30 days = 120 ticks)
};
export function createClock(): SimClock
export function advanceClock(clock: SimClock): SimClock  // immutable: returns new clock
export const TICKS_PER_DAY = 4;
export const TICKS_PER_SEASON = 120;
export const TICKS_PER_YEAR = 480;
```
how to implement:
1. `advanceClock` increments `tick` and recalculates `season`, `year`, `dayOfSeason` from `tick` using integer division.
2. Season order: spring (ticks 0–119 of a year), summer (120–239), autumn (240–359), winter (360–479).
3. Never mutate; always return a new `SimClock` object (spread + override).
acceptance: `test/clock.test.ts` asserts:
- `createClock()` starts at tick=0, season="spring", year=0, dayOfSeason=0.
- After 120 advances, season="summer".
- After 480 advances, year=1, season="spring", tick=480.
- `advanceClock` does not mutate the input.
- `npm test` green.

---

**`S06` — Energy ledger and trophic-level types**
dependsOn: `S01`, `S02`
files: `src/energy.ts`, `test/energy.test.ts`
interface:
```ts
// src/energy.ts
export type EnergyLedger = {
  grassEnergy: FP;        // total solar energy stored in grass biomass, FP
  herbivoreEnergy: FP;    // total energy stored in herbivore population, FP
  predatorEnergy: FP;     // total energy stored in predator population, FP
  dissipated: FP;         // cumulative metabolic heat lost (sink), FP — must only grow
  totalInput: FP;         // cumulative solar input added so far, FP
};
// Trophic transfer efficiency: herbivore gains 10% of energy eaten from grass.
// Predator gains 10% of energy eaten from herbivore.
export const TROPHIC_EFFICIENCY: FP;   // toFP(0.1)
export function totalEnergy(ledger: EnergyLedger): FP  // grassEnergy + herbivoreEnergy + predatorEnergy + dissipated
export function addSolarInput(ledger: EnergyLedger, input: FP): EnergyLedger   // totalInput += input; grassEnergy += input
export function transferHerbivoreEats(ledger: EnergyLedger, grassEaten: FP): EnergyLedger
  // grassEnergy -= grassEaten
  // herbivoreEnergy += fpMul(grassEaten, TROPHIC_EFFICIENCY)
  // dissipated += fpSub(grassEaten, fpMul(grassEaten, TROPHIC_EFFICIENCY))
export function transferPredatorEats(ledger: EnergyLedger, herbivoreEaten: FP): EnergyLedger
export function metabolicCost(ledger: EnergyLedger, level: "grass"|"herbivore"|"predator", cost: FP): EnergyLedger
  // deducts cost from the appropriate energy pool, adds to dissipated
```
how to implement:
1. Every function returns a new `EnergyLedger` (immutable update pattern).
2. `transferHerbivoreEats`: `grassEnergy -= grassEaten` (call `fpSub` — conservation guard fires if negative), `herbivoreEnergy += fpMul(grassEaten, TROPHIC_EFFICIENCY)`, `dissipated += grassEaten - herbivoreGain` (always positive).
3. `totalEnergy` is the conservation check: it must equal `totalInput` at all times (within rounding). Do NOT enforce this as a throw — just expose it so tests can assert it.
acceptance: `test/energy.test.ts` asserts:
- `totalEnergy` after `addSolarInput(..., toFP(100))` equals `toFP(100)`.
- After `transferHerbivoreEats(..., toFP(10))`, `herbivoreEnergy === toFP(1)`, `dissipated === toFP(9)`, `totalEnergy` unchanged.
- After `metabolicCost(..., "herbivore", toFP(0.5))`, `herbivoreEnergy` decreases by `toFP(0.5)` and `dissipated` increases by the same.
- `transferHerbivoreEats` with `grassEaten > grassEnergy` throws "Conservation violated".
- `npm test` green.

---

**`S07` — Water balance model (three-reservoir)**
dependsOn: `S01`, `S02`, `S04`
files: `src/hydrology.ts`, `test/hydrology.test.ts`
interface:
```ts
// src/hydrology.ts
export type SoilColumn = {
  rootZone: FP;         // mm water in root zone (plant-accessible)
  unsaturated: FP;      // mm water in unsaturated zone
  groundwater: FP;      // mm water in saturated zone
};
export type WaterBalance = {
  columns: SoilColumn[];   // one per tile, indexed by TileIndex
  totalPrecipIn: FP;       // cumulative precipitation added, mm
  totalETOut: FP;          // cumulative evapotranspiration lost, mm
  totalRunoffOut: FP;      // cumulative surface runoff out, mm
};
// ΔStorage = P − ET − Q must hold per tick (water conservation)
export function createWaterBalance(tileCount: number): WaterBalance
export function applyPrecipitation(wb: WaterBalance, tileIdx: TileIndex, mm: FP): WaterBalance
export function applyET(wb: WaterBalance, tileIdx: TileIndex, mm: FP): WaterBalance  // evapotranspiration
export function applyRunoff(wb: WaterBalance, tileIdx: TileIndex, mm: FP): WaterBalance
export function checkConservation(wb: WaterBalance): boolean  // totalPrecipIn === totalETOut + totalRunoffOut + sumAllStorage
```
how to implement:
1. All deltas use `fpAdd`/`fpSub`. `fpSub` throws on negative — conservation guard is built-in.
2. `applyPrecipitation`: `totalPrecipIn += mm`; `columns[tileIdx].rootZone += mm` (simple: all precip goes to root zone first; overflow passes to unsaturated in `applyRunoff`).
3. `checkConservation`: compute `sumAllStorage = sum of all rootZone + unsaturated + groundwater`; compare `totalPrecipIn` to `totalETOut + totalRunoffOut + sumAllStorage`. Return `true` if equal (within 1 FP unit for rounding).
acceptance: `test/hydrology.test.ts` asserts:
- `checkConservation` is `true` on a fresh `WaterBalance`.
- After `applyPrecipitation(wb, 0, toFP(50))` + `applyET(wb, 0, toFP(10))` + `applyRunoff(wb, 0, toFP(5))`, `checkConservation` still `true`.
- `applyET` on a tile with insufficient water throws "Conservation violated".
- `npm test` green.

---

**`S08` — Population model (grass / herbivore / predator) with Lotka–Volterra integration**
dependsOn: `S01`, `S02`, `S05`, `S06`
files: `src/population.ts`, `test/population.test.ts`
interface:
```ts
// src/population.ts
// Populations are FP (fixed-point individuals, e.g. toFP(100) = 100 individuals)
export type PopulationState = {
  grass: FP;       // "individuals" = biomass units
  herbivore: FP;   // count
  predator: FP;    // count
};
// Lotka–Volterra parameters (all FP)
export type LVParams = {
  grassGrowthRate: FP;        // α: grass regrowth per tick
  herbivoreGrazeRate: FP;     // β: herbivore consumption of grass per individual pair
  predatorHuntRate: FP;       // δ: predator energy gain from herbivore
  predatorDeathRate: FP;      // γ: predator natural death rate
};
export function stepPopulation(
  state: PopulationState,
  params: LVParams,
  prng: PrngStream,     // for any stochastic variance; draw from here, not Math.random()
  deltaT: FP,           // time step, usually toFP(1) for one tick
): PopulationState
// Uses symplectic Euler:
//   grass(t+1) = grass(t) + α*grass(t)*dt - β*grass(t)*herbivore(t)*dt
//   herbivore(t+1) = herbivore(t) + δ*β*grass(t)*herbivore(t)*dt - γ*herbivore(t)*dt
//   predator(t+1) = predator(t) + δ*predator(t)*herbivore(t)*dt - γ*predator(t)*dt
// Clamp all populations to toFP(0) minimum — extinction is allowed, negative isn't.
export function clampPopulation(state: PopulationState): PopulationState
```
how to implement:
1. All arithmetic via `fpMul`, `fpAdd`, `fpSub` (from `S02`). Use `fpClamp(v, toFP(0), toFP(1e6))` to prevent overflow.
2. Symplectic Euler: compute grass delta first, apply; then compute herbivore delta using the *new* grass; then predator delta using the *new* herbivore. This is the structure-preserving integration. Do NOT do all deltas from old state simultaneously (that is explicit Euler and it spirals).
3. Expose `clampPopulation` separately; call it at the end of `stepPopulation`.
acceptance: `test/population.test.ts` asserts:
- Starting at `{grass: toFP(200), herbivore: toFP(50), predator: toFP(5)}`, after 480 ticks (1 year) with balanced LV params, herbivore stays in `[1, 500]` (no extinction, no explosion).
- Removing all predators (set `predator = 0`) lets herbivore grow until grass depletes, then herbivore declines — a simple boom-bust. Assert herbivore peaks and then falls within 960 ticks.
- Populations are never negative after `clampPopulation`.
- Same seed, same params, same initial state → identical sequence (determinism check).
- `npm test` green.

---

**`S09` — Soil fertility and nutrient pool**
dependsOn: `S01`, `S02`, `S04`
files: `src/soil.ts`, `test/soil.test.ts`
interface:
```ts
// src/soil.ts
export type SoilState = {
  nutrient: FP;       // kg/m² nitrogen equivalent, FP
  harvestedTotal: FP; // cumulative removed by harvest/erosion
  addedTotal: FP;     // cumulative added by decomposition/fallow
};
export function createSoilState(initialNutrient: FP): SoilState
export function harvest(soil: SoilState, amount: FP): SoilState  // remove nutrients (harvest/erosion)
export function replenish(soil: SoilState, amount: FP): SoilState // add nutrients (decomp/fallow)
export function fertilityFraction(soil: SoilState): FP  // nutrient / (nutrient + toFP(50)), range 0–1 FP
// Conservation: nutrient + harvestedTotal - addedTotal === initialNutrient at all times
```
how to implement:
1. `harvest`: `nutrient -= amount` (fpSub — throws if negative), `harvestedTotal += amount`.
2. `replenish`: `nutrient += amount`, `addedTotal += amount`.
3. `fertilityFraction`: scaled sigmoid — use `fpDiv(soil.nutrient, fpAdd(soil.nutrient, toFP(50)))`. Returns FP in `[0, toFP(1)]`.
acceptance: `test/soil.test.ts` asserts:
- After `harvest(soil, toFP(10))` + `replenish(soil, toFP(3))`, `soil.nutrient === initialNutrient - toFP(7)`.
- `harvest` beyond `nutrient` throws "Conservation violated".
- `fertilityFraction` for `nutrient = toFP(50)` equals `toFP(0.5)` (within 1 FP unit).
- Repeated `harvest` without `replenish` monotonically decreases `nutrient` (ratchet property).
- `npm test` green.

---

**`S10` — Wildfire cellular automaton**
dependsOn: `S01`, `S02`, `S03`, `S04`, `S05`
files: `src/fire.ts`, `test/fire.test.ts`
interface:
```ts
// src/fire.ts
export type FireState = {
  burning: Set<TileIndex>;   // tiles currently on fire (use sorted array internally for determinism)
  burnt: Set<TileIndex>;     // tiles already consumed
};
export type WindVector = { directionDeg: number; speedFP: FP }; // direction 0=N, 90=E, etc.
export function createFireState(): FireState
export function ignite(fs: FireState, tileIdx: TileIndex): FireState  // start a fire at one tile
export function stepFire(
  fs: FireState,
  grid: WorldGrid,
  wind: WindVector,
  prng: PrngStream,   // fire stream from PRNG tree
): FireState
// Spread rule (per burning tile, per neighbor):
//   p_ignite = fuelFactor * moistureFactor * windFactor
//   fuelFactor = min(1, fuelLoad / toFP(5))
//   moistureFactor = max(0, 1 - moisture / toFP(300))
//   windFactor = 1.0 + 0.5 * cos(angle_to_neighbor - wind.direction) (use LUT, not Math.cos)
//   roll nextFloat01 from prng; if < p_ignite, neighbor ignites
// A burning tile that has spread to all non-burnt neighbors becomes "burnt" and is removed from burning.
export function applyFireToGrid(grid: WorldGrid, fs: FireState): WorldGrid
  // For each "burnt" tile: set tile.fuelLoad = toFP(0), tile.fireState = "burnt",
  //                        tile.biomass -= min(biomass, toFP(3)) (fire consumes biomass)
```
how to implement:
1. Process `burning` tiles in ascending tile-index order (sort the set to an array each tick; this is the determinism rule).
2. Use a simple 8-direction wind-factor LUT: precompute `cos` for the 8 neighbor directions (N/NE/E/SE/S/SW/W/NW in degrees) as FP constants at module load time. Store in a `const` array indexed by direction slot.
3. `p_ignite` is a FP value 0–1. Compare against `nextIntBelow(prng, FP_SCALE)` — if roll < `p_ignite`, ignite.
4. A tile cannot burn if `fireState === "burnt"`.
acceptance: `test/fire.test.ts` asserts:
- `ignite` on tile 5 sets `burning = {5}`.
- After several `stepFire` calls on a uniform grid with high fuel load, burning spreads to at least one neighbor.
- Two runs with the same seed and same wind produce the same burnt-tile set after 20 steps (determinism).
- A tile with `fuelLoad = toFP(0)` (firebreak) never ignites — `p_ignite === 0`.
- A tile with `moisture = toFP(300)` (very wet) never ignites — `moistureFactor = 0`.
- `npm test` green.

---

**`S11` — Command log and event-sourcing core**
dependsOn: `S01`, `S02`, `S04`, `S05`
files: `src/commands.ts`, `test/commands.test.ts`
interface:
```ts
// src/commands.ts
export type Command =
  | { type: "setHuntingQuota"; speciesId: string; quotaFP: FP; tick: Tick }
  | { type: "placeFirebreak"; tileIndex: TileIndex; tick: Tick }
  | { type: "setIrrigationRate"; tileIndex: TileIndex; rateFP: FP; tick: Tick };
export type CommandLog = Command[];
export function appendCommand(log: CommandLog, cmd: Command): CommandLog  // returns new log (immutable)
export function commandsAtTick(log: CommandLog, tick: Tick): Command[]    // filter by tick
```
how to implement:
1. `CommandLog` is a plain array. `appendCommand` returns `[...log, cmd]`.
2. `commandsAtTick` filters with `cmd.tick === tick`.
3. No validation here; validation is the sim's responsibility.
acceptance: `test/commands.test.ts` asserts:
- `appendCommand` does not mutate the original log.
- `commandsAtTick` on an empty log returns `[]`.
- After appending 3 commands at ticks 0, 0, 5, `commandsAtTick(log, 0)` returns 2 commands.
- `npm test` green.

---

**`S12` — State checksum and snapshot/restore**
dependsOn: `S01`, `S02`, `S03`, `S04`, `S06`, `S07`, `S08`, `S09`, `S11`
files: `src/snapshot.ts`, `test/snapshot.test.ts`
interface:
```ts
// src/snapshot.ts
export type SimState = {
  clock: SimClock;
  grid: WorldGrid;
  population: PopulationState;
  energyLedger: EnergyLedger;
  waterBalance: WaterBalance;
  soil: SoilState;          // per-tile soil — use SoilState[] indexed by TileIndex
  fireState: FireState;
  prngTree: PrngTree;
  commandLog: CommandLog;
};
export function checksumState(state: SimState): string  // JSON.stringify of conserved scalars, then hash with simple djb2
export function takeSnapshot(state: SimState): string   // JSON.stringify(state) — full serialized copy
export function restoreSnapshot(snap: string): SimState // JSON.parse(snap) — must reconstruct FP values as numbers (they already are)
```
how to implement:
1. `checksumState`: stringify a minimal object containing `{tick, grassEnergy, herbivoreEnergy, predatorEnergy, dissipated, totalPrecipIn, totalETOut, totalRunoffOut, population}` — hash with djb2 (a trivial deterministic string hash: `let h = 5381; for (const c of s) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0; return h.toString(16)`).
2. `takeSnapshot`: `JSON.stringify(state)`. Because all FP values are plain integers, they serialize faithfully.
3. `restoreSnapshot`: `JSON.parse(snap)`. Reconstruct `Set` fields for `FireState.burning`/`burnt` from their serialized arrays (serialize Sets as sorted arrays in `takeSnapshot`).
acceptance: `test/snapshot.test.ts` asserts:
- `checksumState(state)` is the same string when called twice on the same state.
- `restoreSnapshot(takeSnapshot(state))` produces a state with identical checksum.
- After modifying a copy, original's checksum is unchanged (immutability check).
- `npm test` green.

---

**`S13` — Drought forcing + critical-slowing-down metric**
dependsOn: `S01`, `S02`, `S05`, `S07`
files: `src/climate.ts`, `test/climate.test.ts`
interface:
```ts
// src/climate.ts
export type ClimateState = {
  droughtStrength: FP;  // 0 = normal, toFP(1) = maximum drought
  precipModifier: FP;   // multiplier applied to precipitation each tick: 1 = normal, <1 = less rain
};
export function createClimateState(): ClimateState
export function stepClimate(
  climate: ClimateState,
  clock: SimClock,
  prng: PrngStream,   // weather stream
): ClimateState
// Drought rule: droughtStrength ramps up 0.001 FP per tick in summer/autumn if below toFP(0.8).
// precipModifier = max(toFP(0.1), fpSub(toFP(1), droughtStrength))
// Early-warning metric (critical slowing down):
export type EarlyWarning = { lag1autocorr: FP; variance: FP };
export function computeEarlyWarning(moistureHistory: FP[]): EarlyWarning
// lag1autocorr: Pearson correlation of moistureHistory[i] vs moistureHistory[i-1] (FP approximation)
// variance: mean squared deviation from mean
```
how to implement:
1. `stepClimate`: ramp `droughtStrength` by `toFP(0.001)` per tick only if `clock.season` is `"summer"` or `"autumn"`. Cap at `toFP(1)`. Set `precipModifier` as specified.
2. `computeEarlyWarning`: use the last N values in `moistureHistory` (N ≥ 10). Compute mean, variance, and lag-1 autocorrelation using integer/FP arithmetic (avoid floats in the return value). Return FP values.
acceptance: `test/climate.test.ts` asserts:
- `stepClimate` in winter does not increase `droughtStrength`.
- After 120 summer ticks, `droughtStrength > toFP(0.1)`.
- `precipModifier` decreases as `droughtStrength` increases.
- `computeEarlyWarning([toFP(10), toFP(10), toFP(10)])` returns `variance === toFP(0)` (constant series has zero variance).
- `computeEarlyWarning` on a trending-down series returns `lag1autocorr > toFP(0.5)` (positive autocorrelation).
- `npm test` green.

---

**`S14` — Trophic cascade scenario fixture and replay test**
dependsOn: `S01` – `S13`
files: `src/scenarios/overhunting.ts`, `test/trophic_cascade.test.ts`
interface:
```ts
// src/scenarios/overhunting.ts
export type ScenarioResult = {
  checksums: string[];     // one per year checkpoint
  eventLog: Array<{ tick: Tick; event: string; cause: string }>;
};
export function runOverhuntingScenario(seed: Seed, years: number): ScenarioResult
// Scenario:
// - Start: grass=200, herbivore=50, predator=5, moisture=200, soilFertility=60, fuelLoad=2
// - At tick 480 (year 1): apply command setHuntingQuota("predator", toFP(0)) — zero predators allowed through hunting
// - Simulate forward:
//   - predator population should collapse within 2 years
//   - herbivore should boom after predator loss
//   - grass/biomass should deplete (herbivore overgrazing)
//   - fuelLoad on tiles should rise as biomass converts (biomass → fuelLoad when soil is dry)
// - Assert: at each year checkpoint, record checksum and append to checksums
// - eventLog entries are appended when: predatorNearZero, herbivoreBoomed, grassDepleted, fuelLoadSpike
```
how to implement:
1. Wire together all prior modules. `runOverhuntingScenario` creates a `SimState`, runs ticks in a loop, applies commands from the log at each tick, and records checksums every 480 ticks.
2. Detect events by threshold: `predatorNearZero` when `predator < toFP(1)`, `herbivoreBoomed` when `herbivore > toFP(200)`, `grassDepleted` when `grass < toFP(20)`, `fuelLoadSpike` when any tile's `fuelLoad > toFP(8)`.
3. Each event entry must include `cause`: a string identifying which state transition triggered it (e.g., `"predator < 1 after hunting quota applied at tick 480"`).
acceptance: `test/trophic_cascade.test.ts` asserts:
- `runOverhuntingScenario(42, 10)` completes without error.
- `result.checksums` has 10 entries (one per year).
- `result.eventLog` contains at least `predatorNearZero`, `herbivoreBoomed`, `grassDepleted`, `fuelLoadSpike` events, **in that order** (causal chain).
- Two calls with seed=42 produce identical `checksums` arrays (determinism).
- A run with seed=99 produces a different `checksums[0]` than seed=42 (different seeds differ).
- `npm test` green.

---

**`S15` — Multi-decade time-machine test (E9 headline test)**
dependsOn: `S14`, `S12`
files: `test/time_machine.test.ts`
interface: (test file only — no new `src/` modules)
how to implement:
1. Call `runOverhuntingScenario(42, 20)` twice. Assert all 20 checksums are identical.
2. Mid-run snapshot/restore: run 10 years, take snapshot, run 10 more, record `checksums[10..19]`. Restore snapshot, run 10 more from restored state, assert `checksums[10..19]` match.
3. Assert all global invariants at every checkpoint tick (year boundary):
   - `totalEnergy(ledger) ≈ ledger.totalInput` (within toFP(0.01) tolerance for rounding)
   - `checkConservation(waterBalance) === true`
   - `population.predator >= toFP(0)` (never negative)
4. Assert the event log from both runs matches exactly (same events, same ticks, same causes).
acceptance: test file passes with `npm test`. All assertions green. Snapshot/restore produces identical continuations. All conservation invariants hold at every year checkpoint.

---

### Summary of first-slice cards

| id | title |
|---|---|
| S01 | Project scaffold and TypeScript config |
| S02 | Fixed-point arithmetic helpers |
| S03 | Seeded PRNG tree |
| S04 | World grid and tile model |
| S05 | Simulation clock and tick driver |
| S06 | Energy ledger and trophic-level types |
| S07 | Water balance model (three-reservoir) |
| S08 | Population model with Lotka–Volterra integration |
| S09 | Soil fertility and nutrient pool |
| S10 | Wildfire cellular automaton |
| S11 | Command log and event-sourcing core |
| S12 | State checksum and snapshot/restore |
| S13 | Drought forcing and critical-slowing-down metric |
| S14 | Trophic cascade scenario fixture and replay test |
| S15 | Multi-decade time-machine test |

**15 first-slice cards.**

---

### 3. The decomposition method for the rest

After the first slice passes, every subsequent feature follows this recipe:

**Step 1 — Identify the new system's conserved quantity or typed invariant.**
Example: adding SIR disease → the conserved quantity is total population across S+I+R compartments. State this invariant before writing a single function.

**Step 2 — Write the types and interface first (one card).**
One card = one `src/<system>.ts` file with exported types and function signatures (no implementation). The test file can be created in the same card or the next. Keep the interface card small.

**Step 3 — Implement the core mechanic (one card).**
Pure functions on the new types. No side effects, no I/O. Reference `fp.ts` and `prng.ts` — never floats or `Math.random()`.

**Step 4 — Write the conservation/invariant test (one card if complex, same card otherwise).**
Assert the invariant holds before and after a step. This is the regression test for the whole system.

**Step 5 — Wire into `SimState` and the main tick loop (one card).**
Add the new state to `SimState`, call the new step function in the tick loop, and ensure the checksum covers the new state.

**Step 6 — Scenario fixture (one card per scenario).**
A self-contained function in `src/scenarios/` that drives the new mechanic to its intended result and returns a `ScenarioResult`-shaped record.

---

**Worked example 1: Adding SIR disease**
- `D01` — `src/disease.ts` types: `SirCompartments { susceptible: FP, infectious: FP, recovered: FP }`, functions `stepSir(state, params, prng)` → `SirCompartments`. dependsOn: S02, S03.
- `D02` — Implement `stepSir` with fixed-point rate-governed flows: `newInfected = β * S * I / N`, `newRecovered = γ * I`. All FP. dependsOn: D01.
- `D03` — Test: `susceptible + infectious + recovered` is constant after any step (conservation). Test that setting `infectious = 0` halts the epidemic. dependsOn: D02.
- `D04` — Add `diseaseState: SirCompartments` to `SimState`; call `stepSir` in the tick loop; checksum includes `infectious`. dependsOn: D03, S12.

**Worked example 2: Animal migration**
- `M01` — `src/migration.ts` types: `HabitatScore` per tile (derived from moisture, temperature, food); function `scoreHabitat(tile, climate): FP`. dependsOn: S04, S07, S13.
- `M02` — `migrateAnimals(population, grid, habitatScores, prng)`: animals move from low-score tiles to adjacent higher-score tiles deterministically (process tiles in ascending index order). dependsOn: M01, S08.
- `M03` — Test: in a uniform grid, no migration occurs. In a grid with one high-moisture tile, animals accumulate there. Same seed → same result. dependsOn: M02.
- `M04` — Wire into tick loop. dependsOn: M03, S12.

**Worked example 3: Settlement food balance**
- `T01` — `src/settlement.ts` types: `SettlementState { foodStock: FP, waterStock: FP, workers: FP, morale: FP }`. Functions `consumeFood(state, amount)`, `addFood(state, amount)`. dependsOn: S02.
- `T02` — Implement food production from harvest: `harvestTile(tile, soil, workers)` returns `FP` of food. Call `fpSub` — throws if we harvest more than available (conservation). dependsOn: T01, S09.
- `T03` — Test: food stock decreases by consumption, never negative, total food in + harvested = total consumed + current stock. dependsOn: T02.
- `T04` — Wire into tick loop; checksum covers `foodStock`. dependsOn: T03, S12.

---

### 4. Per-task implementation conventions

**File/folder layout**
```
src/
  types.ts          — FP, Tick, Seed, TileIndex, EntityId
  fp.ts             — fixed-point math
  prng.ts           — PRNG tree
  world.ts          — WorldGrid, Tile
  clock.ts          — SimClock
  energy.ts         — EnergyLedger
  hydrology.ts      — WaterBalance, SoilColumn
  population.ts     — PopulationState, LV step
  soil.ts           — SoilState
  fire.ts           — FireState, CA step
  commands.ts       — Command, CommandLog
  snapshot.ts       — SimState, checksum, snapshot/restore
  climate.ts        — ClimateState, EarlyWarning
  scenarios/        — one file per scenario
  adapters/         — renderer stub, live-data stubs
test/
  *.test.ts         — vitest test files, mirror src/ names
  fixtures/         — static JSON seed files for golden tests
```

**Naming**
- FP variables end in `FP` (e.g. `grassEnergyFP`) when there is ambiguity with display floats.
- PRNG streams are always passed as `PrngStream` arguments — never stored globally.
- Functions that return immutable updates are prefixed with a verb (e.g. `addSolarInput`, `applyPrecipitation`, `stepPopulation`).

**Writing a test (vitest snippet)**
```ts
// test/energy.test.ts
import { describe, it, expect } from "vitest";
import { toFP, fromFP } from "../src/fp.js";
import { addSolarInput, createEnergyLedger, totalEnergy } from "../src/energy.js";

describe("energy ledger conservation", () => {
  it("totalEnergy is unchanged by solar input", () => {
    const ledger = createEnergyLedger();
    const after = addSolarInput(ledger, toFP(100));
    expect(fromFP(totalEnergy(after))).toBeCloseTo(fromFP(after.totalInput), 2);
  });
});
```

**How to keep it deterministic**
- Pass `PrngStream` as an argument; never access a module-level stream directly from a function.
- Sort all `Set` iterations to arrays before processing.
- Never use object property iteration order as a tie-break.

**Fixture adapter wiring**
- Place the fixture file at `test/fixtures/<name>.json` or `src/adapters/<name>.fixture.ts`.
- The adapter exports a function with the same signature as the live version.
- The `src/adapters/renderer.fixture.ts` example: `export function renderFrame(state: SimState): void { /* no-op in tests */ }`.

**Definition of done (any card)**
1. `npm test` is green.
2. `tsc --noEmit` has zero errors.
3. The new function has at least one test asserting its key invariant (conservation, determinism, or boundary condition).
4. No `Math.random()`, `Date.now()`, or floats in conserved-quantity computations.
5. No `any` types.

---

### 5. Common pitfalls for a weak model on THIS project

**Pitfall 1: Using floats for conserved quantities**
The model will write `let grassEnergy = 0.5` or compute `herbivoreEnergy += eaten * 0.1`. This is wrong. IEEE float addition is not associative across machines. After 1000 ticks two implementations diverge and the checksum test fails. Fix: wrap every `+`, `-`, `*`, `/` on conserved quantities in `fpAdd`, `fpSub`, `fpMul`, `fpDiv`. The `fpSub` conservation guard will also catch any attempt to subtract more than the balance (an energy leak).

**Pitfall 2: Using `Math.random()` or `Date.now()` in core**
The model will write `Math.random() < probability` for fire spread or reproduction. This breaks determinism immediately. Fix: always pass `PrngStream` as an explicit argument and call `nextIntBelow(prng, FP_SCALE)` for probability rolls.

**Pitfall 3: Iterating `Map`/`Set` for order-sensitive logic**
The model may store tiles or animals in a `Map<TileIndex, Tile>` and iterate with `.forEach()`. JavaScript `Map` iteration order is insertion order — a subtle source of nondeterminism when entities are added in different orders across runs. Fix: store entities in plain arrays sorted by index; always process in ascending index order.

**Pitfall 4: Explicit Euler blow-up in Lotka–Volterra**
The model will implement `grass += α * grass * dt - β * grass * herbivore * dt` using the *old* values for all three variables simultaneously (explicit Euler). With any significant `dt` this injects energy and populations spiral to infinity within decades. Fix: use symplectic Euler — apply grass delta first, then compute herbivore delta using the *new* grass, then predator delta using the *new* herbivore. The test in `S08` will catch this because populations blow past `toFP(500)`.

**Pitfall 5: Fire CA with nondeterministic spread order**
The model may iterate `burning` as a `Set` directly. Fix: always `Array.from(burning).sort((a, b) => a - b)` before the spread loop. The test in `S10` asserts two seeds produce identical burnt-tile sets and will catch any ordering bug.

**Pitfall 6: Forgetting dependsOn edges (skipping a card)**
The model may try to implement `S14` (trophic cascade scenario) before `S12` (snapshot), producing a scenario that cannot checksum. Fix: implement cards strictly in the order listed. Do not start a card until all its `dependsOn` cards have green tests.

**Pitfall 7: Treating hysteresis as a hardcoded threshold**
The model may implement soil desertification as `if moisture < 100 → desertified = true` with a symmetric reverse threshold. The correct behavior is: forward threshold (collapse) at, say, `moisture < toFP(80)`, but backward threshold (recovery) only at `moisture > toFP(150)`. The time-machine test asserts that relaxing drought to pre-collapse levels does NOT restore the prior state — a symmetric threshold fails this test. Fix: store a `desertified` boolean in the tile and only clear it when moisture crosses the higher recovery threshold.
