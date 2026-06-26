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
