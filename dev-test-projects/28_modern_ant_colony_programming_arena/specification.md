# 28 - Modern Ant Colony Programming Arena

Complexity tier: 28/35 game block
Expected decomposition size: 90-110 dependent implementation cards before coding.
Domain pressure: programmable agents, swarm simulation, ant-colony behavior, DSL design, tournament judging, pheromone fields, ecosystem hazards, visual simulation.
Acceptance command: npm test

## How to use this challenge
This is a game dev-test project specification for evaluating whether an autonomous coding agent can decompose real game systems, implement deterministic simulation logic, and build a polished presentation layer that makes the game understandable and desirable. The goal is not to finish the whole game. The goal is to build a product-grade foundation that proves the agent understands rules, simulation state, player experience, rendering, and verification.

The agent must read this entire specification before planning. It must create a dependency-linked plan, record domain knowledge debt, identify engine and presentation invariants, and choose a release slice that exercises the highest-risk mechanics. For game projects, visual presentation is mandatory, not a stretch goal. A correct simulation hidden behind ugly placeholder UI is not enough.

## Product vision
Build a modern successor to AntMe!: a programmable ant-colony arena where players write colony behavior, run tournaments, inspect swarm decisions, and watch beautiful real-time simulations. The product should teach emergent behavior, programming, and competitive AI without becoming a toy script runner.

## Target players and users
- Students learning programming through visible swarm behavior.
- Competitive players writing colony strategies for tournaments.
- Teachers who need safe sandboxes, assignments, and replayable results.
- Spectators who want readable colony battles, overlays, and highlight replays.

## Foundation release scope
The first serious buildout must include:
- Arena, tile, terrain, ant, colony, queen, role, food, nest, pheromone, enemy, hazard, script, command, sensor, tournament, replay, score, and judge models.
- Swarm simulation with discrete ticks, ant energy, carrying capacity, sensory radius, movement, collision, food pickup/drop, nest deposit, attack, death, spawning, and queen health.
- Pheromone system with multiple channels, diffusion, evaporation, intensity caps, colony ownership, and sensor queries.
- Player programming DSL or restricted behavior tree format for ant decisions, with validation, execution budgets, deterministic errors, and safe APIs.
- Tournament judge that runs multiple maps and seeds, computes scores for food, survival, combat, exploration, efficiency, and rule violations.
- Scenario generator with terrain, food clusters, hazards, predators, rival colonies, blocked passages, weather events, and map objectives.
- Debugging tools for script step traces, sensor reads, command decisions, pheromone overlays, path trails, and per-ant state inspection.
- Replay system that can scrub through thousands of ticks, show colony metrics, and export shareable match summaries.
- Seed tournaments with beginner forager, aggressive raider, defensive gardener, scout swarm, and buggy infinite-loop script fixtures.

## Gameplay requirements
- The strategy layer must reward emergent colony behavior, not direct micromanagement.
- The scripting API must be safe, deterministic, resource-limited, and understandable by beginners.
- Tournament results must be reproducible across seeds and maps.
- Debug overlays are core gameplay because players learn by seeing why ants acted.

## Presentation requirements
Very nice presentation is mandatory for this challenge. The agent must treat rendering, animation, interaction feedback, and layout polish as core acceptance criteria. Required presentation work:
- The arena must look alive: animated ants, nest activity, food chunks, pheromone heatmaps, terrain variety, predator movement, weather or hazard effects, and smooth camera controls.
- Presentation must include overlays for pheromones, paths, vision cones, script decisions, colony scores, and time controls without cluttering the main scene.
- The code/script panel must feel like a real programming environment with validation, examples, error locations, simulation run controls, and diffable strategy versions.
- Tournament playback must have spectator polish: colony colors, scoreboard, timeline, speed control, highlights, and readable final summary.
- No blank canvas with dots, raw coordinate tables, or unstyled textareas are acceptable as final presentation.

## Architecture requirements
- Separate simulation engine, DSL validation/execution, map generation, tournament judging, replay storage, debug projection, and renderer.
- Use deterministic tick scheduling and seeded random fixtures.
- Run player scripts through a safe interpreter or constrained data model, not host eval.
- Make overlays derived projections so visual debugging does not affect simulation state.

## Domain knowledge debt to surface
The agent should not pretend to know every game design, simulation, AI, rendering, or balancing detail perfectly. It should mark assumptions, build deterministic subsets, and preserve extension points for future designers, artists, balance passes, and live integrations. Required knowledge areas:
- Swarm behavior emerges from local rules and environment feedback, especially pheromone gradients.
- Educational programming games need fast feedback and clear error reporting.
- Tournaments require fair maps, repeated seeds, resource limits, and anti-cheat boundaries.
- A modern AntMe-like game lives or dies on visual explanation of invisible colony state.

## Required challenge scenarios
The implementation plan and fixtures should be shaped around scenarios like these. They do not all need full UI coverage in the first slice, but the core model and presentation should be capable of representing them:
- A beginner script follows food pheromones but gets trapped by an evaporating trail.
- A scout strategy discovers a remote food source and recruits foragers through pheromone channels.
- An aggressive colony raids another nest but loses because of energy and spawn timing.
- A buggy script exceeds its execution budget and the judge records a deterministic violation.
- A replay shows the exact tick where a predator disrupted the winning route.

## Decomposition pressure
This challenge should force decomposition across rules or simulation engine, deterministic fixtures, AI or policy layers, replay/save state, player-facing presentation, UI interaction, diagnostics, and test harnesses. The plan should include dependency links so core state, commands, invariants, and golden tests are built before rendering depends on them. Avoid starting with a visual mock that cannot play the game; also avoid building a correct but lifeless engine with no usable presentation.

The agent should maintain a visible knowledge-debt list covering unclear rules, balance assumptions, AI limitations, rendering tradeoffs, asset gaps, accessibility concerns, performance constraints, and future designer review checkpoints. Knowledge debt is not a failure; hiding it is.

## Acceptance criteria
- Simulation tests cover movement, carrying, nest deposit, pheromone diffusion/evaporation, combat, hazards, spawning, and death.
- DSL tests cover valid commands, invalid syntax, budget exhaustion, deterministic script errors, and safe API restrictions.
- Tournament tests rank strategies reproducibly across maps and seeds.
- Replay tests scrub to arbitrary ticks and reconstruct colony state.
- Presentation checks verify ant rendering, overlays, code panel, scoreboard, timeline, and no unreadable clutter.
- The project passes npm test without host eval or network calls.

## Explicit non-goals
- Do not execute arbitrary player JavaScript with host permissions.
- Do not reduce ants to moving dots without explanatory overlays.
- Do not make tournaments depend on wall-clock timing.
- Do not hide script errors in generic failure messages.

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

> Added 2026-06-26 via deep domain research. **The single hardest, most-defining property of this project is *fair, sandboxed, byte-identical determinism across many untrusted player programs sharing one tick*: this is a competitive arena, so the simulation must be reproducible to the bit (or tournament results are meaningless), player code must be resource-limited and incapable of host access or of perturbing rivals, and the whole thing must replay from `(seed, scripts)` exactly. Build the deterministic tick kernel + the safe interpreter + the intent-then-resolve order first; pheromones, AI, and presentation are downstream of a referee you can *prove* fair and reproducible.**

This section adds the load-bearing rigor that separates a real programming-arena from "dots that wander." It is grounded in how shipped programmable-bot games actually achieve determinism, sandboxing, and fairness — **Screeps' isolated-VM + CPU-bucket + intent-then-resolve tick model**, **CodinGame's referee/replay architecture**, **AntMe!'s heritage**, and **ant-colony / stigmergy theory** — and it makes determinism + fairness + safety the `npm test` backbone the prompt demands.

## A0. The grading thesis: a programming arena is a deterministic referee with an untrusted-code sandbox

The naive version `eval()`s player scripts, mutates a shared world as each ant "acts," diffuses pheromones with floats, and ranks bots by whoever-ran-when. It is **unfair** (order-dependent, float-divergent), **unsafe** (host eval), and **unreproducible** (results won't replay). The disciplined version is:

1. **Determinism** — `runMatch(seed, scripts, map)` produces **byte-identical** tick history and final scores on every machine, every run.
2. **Fairness** — no player's outcome depends on real wall-clock timing, on script *execution order* leaking into world state, or on another player's CPU usage; equal seeds + equal maps ⇒ equal conditions.
3. **Safety** — player code runs in a **resource-limited, capability-restricted sandbox** with **no host access**, no real `eval`, deterministic budget-exhaustion errors, and no ability to break the engine or other players (base spec non-goal: "do not execute arbitrary player JavaScript with host permissions").
4. **Explainability** — every ant decision, sensor read, command, pheromone value, score, and rule violation is inspectable and traceable (debug overlays are *core gameplay*, per the base spec).

Everything below serves those four. The flagship test is **a seeded tournament (the required "beginner forager / aggressive raider / defensive gardener / scout swarm / buggy infinite-loop" fixtures) producing reproducible rankings across multiple maps+seeds, with the buggy script deterministically flagged for budget violation, replayable byte-for-byte.**

## A1. The deterministic tick kernel (intent-then-resolve — the fairness seam)

The defining architectural decision, and the one that makes the arena fair.

- **Two-phase tick (Screeps' model).** Each discrete tick runs in two strictly ordered phases: **(1) Sense+Decide** — every colony's script runs against a *read-only snapshot* of the world and **emits intents** (move, pick up, drop, deposit, attack, lay pheromone), without mutating anything; **(2) Resolve** — the trusted engine applies all collected intents in a **fixed, deterministic order** (by ant id / colony id), arbitrating conflicts (two ants grabbing the same food, two moving into the same cell). Screeps does exactly this — scripts run and *collect commands*, then "all planned activities are executed" in a batched resolve, with each room "processed synchronously by one core" to "rule out various race conditions." ([Screeps server architecture](https://docs.screeps.com/architecture.html)) **This separation is non-negotiable**: it makes a script's effect independent of *when* it ran relative to rivals, which is the whole basis of fairness and of byte-identical replay.
- **Deterministic conflict resolution.** Define explicit, total tie-breaks (lowest ant id wins the contested cell/food; simultaneous attacks both apply then deaths resolve). The order is the spec; document and test it. CodinGame's referee model similarly collects each player's moves and the engine "tells the referee when a game is over," seeded so "initialization persists between runs." ([CodinGame referee system](https://github.com/mdelorme/cg_referee); [RefereeCollection](https://github.com/eulerscheZahl/RefereeCollection))
- **Fixed-point pheromone math (no floats in the sim).** Diffusion/evaporation are the float-determinism trap: **IEEE-754 results differ across engines/CPUs**, desyncing replays ([Gaffer On Games, "Floating Point Determinism"](https://gafferongames.com/post/floating_point_determinism/); [gamedeveloper, "Cross platform RTS synchronization and floating point indeterminism"](https://www.gamedeveloper.com/programming/cross-platform-rts-synchronization-and-floating-point-indeterminism)). Represent pheromone intensities as **fixed-point integers (e.g. Q16.16)**; define evaporation as an integer decay (multiply-by-fraction-then-shift, or subtract-floor) and diffusion as an integer stencil with a **defined rounding/conservation rule**, so two runs produce identical fields bit-for-bit.

## A2. The safe scripting sandbox (the safety + determinism seam)

Player code is *untrusted and adversarial* (one required fixture is a deliberately buggy infinite loop). This is the second hardest seam.

- **Never host `eval`.** Two viable designs, both acceptable if they're deterministic + safe:
  - **(a) A restricted behavior-tree / data-model DSL** the engine interprets — the safest, most beginner-legible option (the base spec's "restricted behavior tree format"), with a typed, validated schema and a small deterministic instruction set.
  - **(b) A sandboxed mini-interpreter** for a tiny scripting language (parse → AST → step a bytecode/AST interpreter the engine controls), giving each script its **own isolated state, no host globals, no I/O, no clock, no `Math.random`** — the engine supplies a seeded RNG and sensor API. This mirrors Screeps' **isolated-vm** approach: "completely isolated environments… truly separated sandboxes to players that don't affect each other," each with its own heap. ([Screeps isolated VM PTR changelog](https://screeps.com/forum/topic/2073/ptr-changelog-2018-01-18-isolated-vm); [Screeps optimizations roadmap](https://blog.screeps.com/2017/06/optimizations/)) For a TS/JS acceptance suite, a **pure interpreter over a constrained AST is the recommended deterministic path** (no native isolate dependency, fully reproducible, easy to budget).
- **Deterministic execution budget (Screeps' CPU model, made tick-deterministic).** Each colony gets a **per-tick instruction/operation budget** (count *steps*, not wall-clock ms — wall-clock is non-deterministic and unfair). Exceeding it raises a **deterministic, well-located error** and the ant/colony forfeits the remainder of its turn; the judge records a **rule violation** (base spec scenario: "a buggy script exceeds its execution budget and the judge records a deterministic violation"). Screeps bounds runaway scripts (CPU limit, a bucket of saved CPU, and "force restart" if a script can't finish) — adapt the *concept* (bounded work + graceful termination) but key it to a **deterministic step counter** so the same script always violates at the same step. ([Screeps CPU limit](https://docs.screeps.com/cpu-limit.html); [Screeps CPU wiki](https://wiki.screepspl.us/index.php/CPU))
- **Safe sensor API only.** Scripts read the world solely through a **constrained, deterministic sensor interface** (local cell contents within sensory radius, own pheromone channels, own energy/carry state) — never the global world object, never another colony's internals, never the file system or network. Validation rejects invalid programs with **specific, located error messages** (base spec non-goal: "do not hide script errors in generic failure messages") — educational games "need fast feedback and clear error reporting."

## A3. Stigmergy, pheromones & the simulation model (research-grounded, deterministic)

Make the colony behavior emerge from local rules + environment feedback, the way real ant systems do.

- **Stigmergy is the mechanism.** Ants coordinate not via a leader but by **leaving and sensing chemical traces** that prompt others' actions — *stigmergy* ("mark"+"work"), the foundation of ant-colony optimization. Trails **accumulate** as ants traverse and **evaporate** over time; shorter/more-traveled paths stay stronger, which is how colonies find efficient routes. ([Wikipedia, "Ant colony optimization algorithms"](https://en.wikipedia.org/wiki/Ant_colony_optimization_algorithms); [Dorigo & Stützle, *Ant Colony Optimization* (book PDF)](https://web2.qatar.cmu.edu/~gdicaro/15382/additional/aco-book.pdf)) The base spec's pheromone channels + diffusion + evaporation + intensity caps + colony ownership + sensor queries are the discrete, deterministic encoding of this — and the required scenarios ("follows food pheromones but gets trapped by an evaporating trail," "scout recruits foragers through pheromone channels") are *direct stigmergy demonstrations*.
- **Multi-channel, colony-owned fields with caps.** Separate channels (e.g. food-trail, home-trail, danger, recruit) per colony; **evaporation** prevents premature convergence (encourages exploration); **intensity caps** bound the field; **diffusion** spreads gradients to neighboring cells — all in fixed-point integer math (A1) with **conservation/decay invariants** (total pheromone is non-increasing absent deposits; deposits are accounted).
- **The full agent model (deterministic, integer-valued).** Ant energy, carrying capacity, sensory radius, movement, collision, food pickup/drop, nest deposit, attack, death, spawning, queen health — all integers, all resolved in the deterministic resolve phase. Predators, hazards, weather events, and rival colonies are seeded fixtures.

## A4. Tournament judging & rating (reproducible competition)

A competitive arena lives or dies on **fair, reproducible** results.

- **Multi-map, multi-seed, reproducible scoring.** The judge runs each strategy across a fixed set of **maps × seeds**, scoring food gathered, survival, combat, exploration, efficiency, and **rule violations** (base spec). Because the sim is byte-deterministic, **rankings are reproducible** (base spec: "tournament results must be reproducible across seeds and maps"; non-goal: "do not make tournaments depend on wall-clock timing").
- **Pairing / format & rating (extension-pointed, grounded).** For round-robin or **Swiss** formats, the judge can compute standings with standard tie-breaks (Buchholz / Sonneborn-Berger) and ratings; for *strength estimation between strategies*, the rigorous tool is **SPRT** (sequential probability ratio test) — the method "virtually all top [chess] engines" use to decide whether one bot is stronger within bounded error rates, far more sample-efficient than fixed-N. ([Sequential Probability Ratio Test, Chess Programming Wiki](https://www.chessprogramming.org/Sequential_Probability_Ratio_Test); [Proper Chess Engine Testing — SPRT](https://dannyhammer.github.io/engine-testing-guide/sprt.html)) Model this as a **rating/pairing adapter** behind deterministic fixtures (the matches it consumes are seed-reproducible), so a production ladder is a swap-in.
- **Anti-cheat = the sandbox + the budget + determinism.** Fairness "requires fair maps, repeated seeds, resource limits, and anti-cheat boundaries" (base spec) — which is precisely the A1/A2 machinery: no host access, deterministic step budget, identical conditions per seed.

## A5. Replay: scrub thousands of ticks, reconstruct exactly

- **Seed+script-sourced replay.** The authoritative record is `(seed, map, scripts, config)`; the engine **re-derives** every tick from seeded entropy + the deterministic kernel. The replay can **scrub to any tick and reconstruct full colony state** (base spec) — proven by a **golden-master test**: serialize tick-N state for a canonical match and assert byte-stability; assert `state(N)` reached by replay equals `state(N)` reached by stepping.
- **Overlays are pure projections.** Pheromone heatmaps, path trails, vision cones, script-decision traces, and per-ant inspection are **derived views over immutable tick state** — "overlays [are] derived projections so visual debugging does not affect simulation state" (base spec). Tested: enabling an overlay does not change the simulation (run with overlays on vs. off ⇒ identical tick history).
- **Step traces for learning.** Per-tick, per-ant: which sensors were read, which command was chosen, why (the matched DSL/behavior node) — the educational core. This is the ant-arena analogue of the exemplar's evidence graph: every decision traces to the sensor inputs + the script rule that fired.

## A6. Determinism & testability strategy (no host eval, no network, no wall clock, no floats)

- **No `eval`, no host globals in scripts** (A2); the only randomness scripts can access is an engine-provided **seeded** stream.
- **No wall-clock anywhere in sim or judging** — budgets count steps, not milliseconds; "into the breach"-style fairness requires time never leaks into outcome.
- **Integer / fixed-point everything** in the sim core (positions, energy, pheromones), per A1, so cross-platform replays are byte-identical.
- **Everything external is a fixture adapter** — maps, scenarios, predators, weather, and the rating/pairing system are deterministic in-repo fixtures; "run player scripts through a safe interpreter or constrained data model, not host eval" (base spec).
- **Scenario generation is pure over the seed** — terrain, food clusters, hazards, predators, rival colonies, blocked passages, weather, objectives all derive from the map seed reproducibly.

## A7. Property-based invariants & acceptance (beyond example tests)

Assert system-wide invariants across **randomized + scripted** runs (the rubric the exemplar sets):

1. **Determinism** — `runMatch(seed, scripts, map)` twice ⇒ identical tick history *and* identical final scores; `generateScenario(seed)` twice ⇒ identical maps.
2. **Sandbox safety** — no script can read/write outside its sensor API, reach host globals, or affect another colony's script state; a hostile fixture script attempting escape fails deterministically with a located error and zero host effect.
3. **Budget determinism** — the buggy/infinite-loop fixture violates its budget at the **same step every run** and is flagged identically; partial work up to the budget is well-defined.
4. **Order-independence of decisions** — permuting the *script execution order* within the Sense phase does **not** change the resolved world (because decisions read a snapshot and only intents are applied) — the fairness invariant; fuzz the permutation.
5. **Pheromone conservation/decay** — total field intensity is non-increasing absent deposits; evaporation+diffusion conserve or decay per the defined rule; intensity never exceeds caps; no negative intensities.
6. **Resource bounds** — ant energy/carry within limits; food conserved (food picked up == food removed from source; deposited == nest gain); no ant in two cells; deaths remove ants exactly once.
7. **Overlay non-interference** — overlays on vs. off ⇒ identical tick history (A5).
8. **Replay sufficiency** — the structured tick log reconstructs colony scores and the violation record for a canonical match.

Plus a **chaos pass**: random (and deliberately adversarial) fixture scripts against random seeds/maps, asserting (1)–(7) never break — fuzzing untrusted scripts is how you prove the sandbox and the fairness, not hope them.

## A8. Adversarial / edge-case fixture pack (the "competitive integrity" suite)

- **Infinite-loop / budget-bomb script** — must terminate deterministically at the budget, flagged as a violation, without hanging the tick or the judge.
- **Sandbox-escape attempt** — a fixture script trying to reach a host global / mutate the world directly / read another colony's state — must fail safely with a located error and no effect.
- **Evaporating-trail trap** — a forager fixture that gets stranded when its trail evaporates (a stigmergy demonstration), reproducibly at the documented tick.
- **Scout-recruitment** — a scout finds remote food and recruits via pheromone channels; the recruitment wave is seed-deterministic.
- **Contested resource / cell** — two ants (same or rival colonies) target one food/cell on the same tick; the documented tie-break resolves it identically every run.
- **Raid lost to timing/energy** — an aggressive colony raids but loses due to spawn timing/energy (a required scenario) — deterministic outcome.
- **Predator-disrupts-route** — a replay pinpoints the exact tick a predator broke the winning route (a required scenario).
- **Float-trap regression** — a pheromone field that, under naive float math, would diverge across platforms — asserted bit-identical under the fixed-point implementation.

## A9. The concrete first vertical slice (the on-ramp — build THIS first, ~35–50 cards)

1. **The deterministic two-phase tick kernel** (Sense→snapshot→intents→Resolve→apply, with documented tie-breaks) + seeded entropy (A1).
2. **Fixed-point pheromone field** (multi-channel, colony-owned, integer evaporation+diffusion+caps) with the conservation/decay invariants (A1, A3).
3. **The safe interpreter / behavior-DSL** with a typed schema, a seeded sensor+RNG API, **no host access**, validation with located errors, and the **deterministic step budget** (A2).
4. **Core ant model** (energy/carry/sense/move/pickup/drop/deposit/attack/death/spawn/queen) resolved deterministically, integer-valued (A3).
5. **Match runner + judge** scoring food/survival/combat/exploration/efficiency/violations, reproducible across a maps×seeds fixture set (A4).
6. **Seed+script-sourced replay** with golden-master byte-stability + **pure overlay projections** (heatmap, trails, vision, decision trace) (A5).
7. **The polished arena UI**: animated ants/nest/food, **pheromone heatmap overlay**, terrain variety, predators, time/speed controls, **scoreboard + timeline**, and a **real code/script panel** (validation, examples, located errors, run controls) — rendering from immutable state, with presentation tests (readable overlays, no clutter, legible code panel).
8. **The flagship seeded tournament** (beginner forager / aggressive raider / defensive gardener / scout swarm / buggy infinite-loop) producing reproducible rankings with the buggy script flagged, replayable byte-for-byte, all invariants green.

If that slice is real, richer DSL features, more scenarios/hazards/weather, Swiss/SPRT ladders, and spectator highlights are **breadth on a proven, fair, reproducible spine.**

## A10. Domain knowledge-debt to surface (track, don't bluff)

- **DSL vs. interpreter scope** — how expressive the player language should be (beginner-legible behavior-tree vs. a small Turing-ish interpreter) is a design/education tradeoff; flag the chosen point and its budget model.
- **Sandbox hardening for production** — a pure interpreter is safe in-repo; a real online arena running JS would need genuine isolation (isolated-vm/WASM) — flagged as the production swap-in with security review needed.
- **Balance & fairness tuning** — map generation fairness, food/predator/energy balance, score weightings — a designer/playtest pass; flag where tuning is needed.
- **Rating/pairing rigor** — Swiss tie-breaks, Elo/Glicko, and SPRT bounds are extension points; the math (and how many seeds/maps suffice for a stable ranking) needs a stats review.
- **Float-determinism boundary** — documented decision to use fixed-point in the sim, with the rounding/conservation rules for evaporation/diffusion spelled out.
- **Accessibility & performance** — colorblind-safe colony colors and overlays, reduced-motion mode, and performance with thousands of ants over thousands of ticks (the base spec's scale) — flagged for review.

## A11. Why this is a great !Klein challenge

A programming arena is an outstanding small-local-LLM decomposition target because every load-bearing property is **externally checkable**: a swarm of weak agents builds the kernel, the sandbox, and the judge incrementally and *knows* they're right when a match replays byte-identically, the budget bomb violates at the same step, and permuting script order changes nothing — no human judgment, no flaky oracle, no live dependency. The hard seams (intent-then-resolve fairness, an untrusted-code sandbox with a deterministic step budget, fixed-point stigmergy, reproducible tournaments) are legible, dependency-ordered, and each gated by a property-based test. It stresses **determinism under weak models, safe execution of untrusted code, multi-agent fairness, and visual explanation of invisible (pheromone) state** — and it is genuinely *delightful* to watch the colony of agents make a colony of ants find food through emergent stigmergy, then prove it fair tick-for-tick.

---

## Small-model build guide (3B-ready)

> This section is a mechanical execution guide. Assume the reader is a literal-minded 3B model that cannot infer unstated knowledge. Every card is independently verifiable. The deterministic tick + sandbox step budget are the acceptance backbone — nothing advances until the byte-identical replay and the budget-bomb test pass.

---

### 1. Glossary & ground rules

**Domain terms:**

- **Arena**: the game map. A discrete 2D grid of `cols × rows` tiles.
- **Tile**: one cell at `{col: number, row: number}` (integers only). A tile has a `TerrainType` and may hold food, pheromone values, and at most one unit.
- **TerrainType**: `'floor' | 'wall' | 'nest' | 'food-source' | 'hazard'`. Walls block movement. Nests are colony spawn points. Food-sources generate food.
- **Colony**: a named player entity. Has a `colonyId`, a script (DSL behavior definition), a queen, a set of ants, and a score.
- **Queen**: the colony's health. If queen HP reaches 0, colony is eliminated.
- **Ant**: one unit in the arena. Has `antId`, `colonyId`, `energy`, `carry` (how much food it holds), `maxCarry`, `senseRadius`, `tile`, and `isDead`.
- **Pheromone field**: per-colony, per-channel, per-tile integer values stored in a flat array. Channels: `'food-trail' | 'home-trail' | 'danger' | 'recruit'`. Represented as fixed-point integers (see below).
- **Fixed-point integer**: a real number stored as an integer scaled by a constant factor. We use Q16 (scale=65536): value `v` stores the real number `v / 65536`. Evaporation and diffusion work entirely in integer math. No `float` ever used in the simulation.
- **Evaporation**: each tick, every pheromone value is multiplied by `(EVAP_NUMERATOR / EVAP_DENOMINATOR)` where both are integers, using integer floor. Example: `newValue = Math.floor(value * 253 / 256)` — this decays by ~1.2% per tick.
- **Diffusion**: a fraction of each tile's pheromone spreads to its 4 orthogonal neighbors. Implemented as integer stencil: `spread = Math.floor(value * DIFF_NUMERATOR / DIFF_DENOMINATOR)`. Conservation rule: total pheromone is non-increasing absent deposits.
- **Intent**: what an ant will do this tick, computed from the sensor snapshot and the DSL script. Recorded before any state mutation. The resolve phase applies intents, not re-runs the scripts.
- **Two-phase tick**: (1) Sense phase — every colony's script runs on a read-only world snapshot, emitting intent records; (2) Resolve phase — the engine applies all intents in a fixed, deterministic order (by `antId`).
- **Step budget**: maximum number of DSL operations a script may execute in the Sense phase for one ant. Exceeding it raises a `BudgetViolation` error at the same step every run (deterministic).
- **DSL**: the player scripting language. A restricted behavior tree defined as a JSON/TypeScript data structure — NOT host JavaScript evaluated with `eval`. Contains nodes: `Sequence`, `Selector`, `Condition`, `Action`. Actions are drawn from a closed list of safe operations.
- **DSL interpreter**: a pure TypeScript function that executes a DSL behavior tree against a sensor snapshot, counts steps, and returns an intent (or throws `BudgetViolation`).
- **Sensor**: the read-only view an ant gets of the world. Contains: own state (energy, carry, position, colonyId), tiles within `senseRadius`, pheromone values at those tiles, nearby food and nest positions. Never the whole world.
- **Intent record**: the output of a script execution for one ant. `{ antId, colonyId, type: IntentType, ... }`.
- **IntentType**: `'move' | 'pick-up' | 'drop' | 'deposit' | 'attack' | 'lay-pheromone' | 'idle'`.
- **Conflict resolution**: if two ants target the same food/cell, the ant with the lowest `antId` wins. Documented, tested.
- **Match**: one run of the arena. `runMatch(seed, scripts, map)` → `MatchReplay`. Byte-identical given the same inputs.
- **Tournament**: a set of matches across multiple maps and seeds. Scores are aggregated. Rankings are reproducible.
- **BudgetViolation**: a typed error thrown by the DSL interpreter when the step count exceeds the budget. Thrown at the exact same step every run (deterministic). Does NOT crash the match; the ant forfeits its turn.
- **Golden-master test**: a test that serializes the tick-N state of a canonical match and asserts it matches a committed expected JSON blob.

**Fixed-point encoding (use these constants everywhere):**
```typescript
export const Q16_SCALE = 65536;               // 2^16
export const EVAP_NUMERATOR = 253;
export const EVAP_DENOMINATOR = 256;          // ~1.2% decay per tick
export const DIFF_NUMERATOR = 1;
export const DIFF_DENOMINATOR = 16;           // spread 6.25% to each neighbor
export const PHERO_MAX = Q16_SCALE * 255;     // cap at 255.0 in real units
// All pheromone values are integers in [0, PHERO_MAX].
```

**Stack:**

| Concern | Choice |
|---|---|
| Language | TypeScript (strict mode, no `any`) |
| Runtime | Node.js ≥ 20 |
| Test runner | Vitest (`npm test`) |
| Assertions | Vitest `expect` |
| DSL format | JSON-compatible TypeScript objects (behavior tree) — no `eval` |
| All sim math | Integer only — no floats in tick, pheromone, or conflict resolution |
| UI framework | React + Vite; Tailwind CSS v4 |
| No live services | All tests offline |

**Acceptance command:**
```
npm test
```
All tests offline. No host `eval`, no network.

**Determinism ground rules (imperative):**
1. Never use `eval()`, `new Function()`, or dynamic imports for player scripts.
2. Never call `Math.random()` in `src/`. All randomness flows through a committed seeded PRNG.
3. Never call `Date.now()` in the simulation or judge.
4. All pheromone math is integer: use `Math.floor` for evaporation/diffusion, never floating-point.
5. Conflict resolution is by `antId` (lexicographic ascending). Document this and never change it.
6. The Sense phase reads a frozen snapshot of the world. No mutation until the Resolve phase begins.
7. Applying intents in the Resolve phase uses a stable sort by `antId`. The order is the spec.

---

### 2. The explicit task graph for the first vertical slice

The first slice covers A9 items 1–8: tick kernel → pheromone field → DSL + sandbox → ant model → judge → replay → UI → flagship tournament. Complete in order.

---

**`A01` — Core types: Arena, Tile, Ant, Colony, Pheromone**

dependsOn: none

files: `src/core/types.ts`, `test/core/types.test.ts`

interface:
```typescript
export type ColonyId = string;
export type AntId = string;
export type Channel = 'food-trail' | 'home-trail' | 'danger' | 'recruit';
export type TerrainType = 'floor' | 'wall' | 'nest' | 'food-source' | 'hazard';

export interface Tile { col: number; row: number; }

export interface TerrainCell { type: TerrainType; }

export interface Ant {
  antId: AntId;
  colonyId: ColonyId;
  tile: Tile;
  energy: number;
  maxEnergy: number;
  carry: number;
  maxCarry: number;
  senseRadius: number;  // in tiles (integer)
  isDead: boolean;
}

export interface Queen { colonyId: ColonyId; hp: number; maxHp: number; tile: Tile; }

export interface Colony {
  colonyId: ColonyId;
  name: string;
  nestTile: Tile;
  queen: Queen;
  foodStored: number;    // integer
  score: number;
}

export interface PheromoneField {
  cols: number;
  rows: number;
  // pheromone[colonyIndex][channelIndex][tileIndex] — all integers in [0, PHERO_MAX]
  values: number[][][];
  channelIndex: Record<Channel, number>;
}

export interface ArenaState {
  cols: number;
  rows: number;
  terrain: TerrainCell[];    // flat: terrain[row * cols + col]
  food: number[];            // food[row * cols + col] — integer food units per tile
  pheromone: PheromoneField;
  ants: Map<AntId, Ant>;
  colonies: Map<ColonyId, Colony>;
  tick: number;
  rngState: bigint;          // current PRNG state (see A02)
}
```

how to implement:
1. Create `src/core/types.ts`. Define all types exactly as above.
2. Flat array indexing: `tileIndex = row * cols + col`. Document this formula and use it everywhere.
3. No logic in this file — types only.

acceptance: `test/core/types.test.ts`:
- `tileIndex(5, 3, 10)` (col=5, row=3, cols=10) `=== 35` — add this as a trivial helper and test it.
- Construct a minimal `ArenaState` with 5×5 grid and 2 colonies. Assert `arenaState.ants.size === 0` and `arenaState.colonies.size === 2`.
Run `npm test` → green.

---

**`A02` — PRNG (committed, portable, pure integer)**

dependsOn: `A01`

files: `src/core/prng.ts`, `test/core/prng.test.ts`

interface:
```typescript
// SplitMix64 — committed, portable, pure bigint implementation
export type PrngState = bigint;  // 64-bit state
export function prngCreate(seed: bigint): PrngState;
export function prngNext(state: PrngState): { value: bigint; next: PrngState };
// Returns integer in [0, max)
export function prngNextInt(state: PrngState, max: number): { value: number; next: PrngState };
// Derive a sub-seed by mixing (primary seed, name string)
export function deriveSeed(primary: bigint, name: string): bigint;
```

how to implement:
1. Create `src/core/prng.ts`. Implement SplitMix64:
   - State is a single 64-bit `bigint` `z`.
   - `prngNext(z)`: `z = (z + 0x9e3779b97f4a7c15n) & 0xFFFFFFFFFFFFFFFFn` (increment); then mix: `z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & mask`; `z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & mask`; `z = z ^ (z >> 31n)`. Return `{ value: z, next: z }`.
2. `prngNextInt(state, max)`: `prngNext(state)`, then `value = Number(value % BigInt(max))`.
3. `deriveSeed(primary, name)`: compute a simple integer hash of `name` (e.g. FNV-1a on the UTF-8 bytes), XOR with `primary`, run two SplitMix64 rounds.

acceptance: `test/core/prng.test.ts`:
- `prngCreate(0n)` followed by 5 steps produces the exact same 5 values every run (commit the expected values as constants in the test).
- `deriveSeed(1n, 'alpha') !== deriveSeed(1n, 'beta')`.
- `prngNextInt(prngCreate(99n), 10).value` is in `[0, 10)`.
Run `npm test` → green.

---

**`A03` — Pheromone field: fixed-point evaporation + diffusion + deposit + query**

dependsOn: `A01`, `A02`

files: `src/core/pheromone.ts`, `test/core/pheromone.test.ts`

interface:
```typescript
// Deposit pheromone at a tile for a colony/channel. Caps at PHERO_MAX.
export function depositPheromone(
  field: PheromoneField, colonyIdx: number, channelIdx: number, tileIdx: number, amount: number
): PheromoneField;  // returns new field (immutable)

// Evaporate all values: newVal = Math.floor(val * EVAP_NUMERATOR / EVAP_DENOMINATOR)
export function evaporatePheromone(field: PheromoneField): PheromoneField;

// Diffuse: spread DIFF_NUMERATOR/DIFF_DENOMINATOR of each tile's value to its 4 orthogonal neighbors.
// Conservation rule: the amount that spreads OUT of a tile is deducted from it (so total is conserved/non-increasing).
export function diffusePheromone(field: PheromoneField, cols: number, rows: number): PheromoneField;

// Query: return pheromone value at a tile for a colony/channel
export function queryPheromone(
  field: PheromoneField, colonyIdx: number, channelIdx: number, tileIdx: number
): number;  // integer in [0, PHERO_MAX]

// Create an empty field
export function emptyPheromoneField(cols: number, rows: number, numColonies: number): PheromoneField;
```

how to implement:
1. Create `src/core/pheromone.ts`. All functions are pure (return new field, never mutate).
2. `depositPheromone`: `Math.min(current + amount, PHERO_MAX)`.
3. `evaporatePheromone`: iterate all values; `Math.floor(v * 253 / 256)`.
4. `diffusePheromone`: for each tile, compute spread = `Math.floor(v * 1 / 16)`. Add spread to each of the 4 orthogonal neighbors (within bounds). Deduct `4 * spread` from the source tile. Cap everything at `PHERO_MAX`; floor at 0. **Important**: use a copy of the original values as the source — don't use the updated values during the same diffusion step.
5. `queryPheromone`: array lookup.

acceptance: `test/core/pheromone.test.ts`:
- Deposit `Q16_SCALE * 100` (= 6,553,600) at tile 0. Assert `queryPheromone(..., 0) === 6553600`.
- After one `evaporatePheromone`: value is `Math.floor(6553600 * 253 / 256) === 6486125` (compute this expected value in the test with the same formula and assert equality — do not hard-code a guess).
- After deposit at center of 3×3 grid + `diffusePheromone`: center tile decreases, neighbors gain. Assert total pheromone over the 9 tiles is ≤ the deposited amount (non-increasing).
- **Float-trap regression**: for a pheromone value of `65537` (one above Q16_SCALE), `Math.floor(65537 * 253 / 256) === 64762` (compute expected in test). Assert the result, proving no float intermediate diverged. (This is the A8 float-trap fixture.)
- After depositing `PHERO_MAX` and depositing again: value stays at `PHERO_MAX` (cap enforced).
Run `npm test` → green.

---

**`A04` — Two-phase tick kernel: Sense snapshot → intents → Resolve → apply**

dependsOn: `A03`

files: `src/core/tick.ts`, `test/core/tick.test.ts`

interface:
```typescript
export interface SensorSnapshot {
  self: Ant;
  visibleTiles: Array<{ tile: Tile; terrain: TerrainType; food: number; pheromone: Record<Channel, number> }>;
  nearbyAnts: Array<{ tile: Tile; colonyId: ColonyId; isEnemy: boolean }>;
  nestDirection: Tile;    // direction toward own nest (nearest nest tile)
}

export interface AntIntent {
  antId: AntId;
  colonyId: ColonyId;
  type: 'move' | 'pick-up' | 'drop' | 'deposit' | 'attack' | 'lay-pheromone' | 'idle';
  targetTile?: Tile;
  channel?: Channel;
  amount?: number;        // for lay-pheromone
}

// Phase 1: build a frozen snapshot of the world
export function buildSensorSnapshot(state: ArenaState, ant: Ant): SensorSnapshot;

// Phase 2: apply all intents in antId order (ascending lexicographic)
// Returns new ArenaState (immutable — never mutates the input)
export function applyIntents(state: ArenaState, intents: AntIntent[]): ArenaState;

// One full tick: build snapshots, run all scripts (see A05), collect intents, apply them.
// Scripts is a Map<colonyId, DslScript> (defined in A05).
// Returns { state: ArenaState, violations: BudgetViolation[] }.
export function runTick(state: ArenaState, scripts: Map<ColonyId, DslScript>, budget: number): TickResult;
export interface TickResult { state: ArenaState; violations: BudgetViolation[]; }
```

how to implement:
1. Create `src/core/tick.ts`.
2. `buildSensorSnapshot`: extract the ant, enumerate all tiles within `ant.senseRadius` (Manhattan or Chebyshev — document which), collect terrain/food/pheromone for each. Compute `nestDirection` as the closest nest tile. Return a frozen (deep-copied) snapshot.
3. `applyIntents`: sort intents by `antId` ascending (lexicographic). For each intent:
   - `move`: if target tile is valid (within bounds, not a wall, not occupied by another ant), update ant tile.
   - `pick-up`: if ant is on a food tile and `ant.carry < ant.maxCarry`, add 1 to carry, subtract 1 from `state.food[tileIdx]`.
   - `deposit`: if ant is on its colony's nest tile and `ant.carry > 0`, add `ant.carry` to `colony.foodStored`, set `ant.carry = 0`.
   - `attack`: if target tile is adjacent and has an enemy ant, reduce target energy by attack amount; if energy ≤ 0, mark dead.
   - `lay-pheromone`: deposit `amount` onto the ant's current tile for the given channel.
   - Conflict: two ants targeting the same food tile — the one with lower `antId` (lexicographic) gets it; the other gets `idle`.
4. `runTick`: call `buildSensorSnapshot` for each living ant (on the frozen pre-tick snapshot), run each colony's script through the DSL interpreter (A05) to get an `AntIntent`, collect violations, then call `applyIntents` with all collected intents. Then run pheromone evaporation + diffusion (one tick of each). Increment `state.tick`.

acceptance: `test/core/tick.test.ts`:
- Build a 5×5 `ArenaState` with one ant at (0,0) and food at (1,0). Apply a `move` intent toward (1,0). Assert ant is now at (1,0).
- Apply a `pick-up` intent on the same ant now at (1,0). Assert `ant.carry === 1`, food at (1,0) decreased by 1.
- Apply two `move` intents targeting the same tile (0,0) from two ants — assert only the ant with the lower `antId` moves there; the other's position is unchanged.
- **Order-independence test**: permute the order of intent input to `applyIntents` (while keeping the same set). Assert the resulting `ArenaState` is identical (since intents are sorted by antId inside `applyIntents`). This is the fairness invariant.
Run `npm test` → green.

---

**`A05` — DSL interpreter: behavior tree + sensor API + step budget**

dependsOn: `A04`

files: `src/dsl/dsl-types.ts`, `src/dsl/interpreter.ts`, `test/dsl/interpreter.test.ts`

interface:
```typescript
// Behavior tree node types (JSON-serializable — no code)
export type DslNode =
  | { type: 'Sequence'; children: DslNode[] }
  | { type: 'Selector'; children: DslNode[] }
  | { type: 'Condition'; check: ConditionCheck }
  | { type: 'Action'; action: ActionNode };

export type ConditionCheck =
  | { type: 'HasFood' }
  | { type: 'CarryFull' }
  | { type: 'FoodNearby' }
  | { type: 'PheromoneAbove'; channel: Channel; threshold: number }
  | { type: 'EnemyNearby' };

export type ActionNode =
  | { type: 'MoveTowardFood' }
  | { type: 'MoveTowardNest' }
  | { type: 'MoveAlongPheromone'; channel: Channel }
  | { type: 'PickUp' }
  | { type: 'Deposit' }
  | { type: 'LayPheromone'; channel: Channel; amount: number }
  | { type: 'Attack' }
  | { type: 'Idle' };

export type DslScript = DslNode;  // root node of the behavior tree

export interface BudgetViolation {
  antId: AntId;
  colonyId: ColonyId;
  tick: number;
  stepsExecuted: number;
  budgetLimit: number;
}

// Run the script for one ant on its sensor snapshot. Returns the chosen AntIntent.
// Throws BudgetViolation if stepCount > budget.
// stepCount increments once per DslNode visited.
export function interpretScript(
  script: DslScript,
  sensor: SensorSnapshot,
  ant: Ant,
  budget: number,
  tick: number
): AntIntent;
```

how to implement:
1. Create `src/dsl/dsl-types.ts` with all type definitions.
2. Create `src/dsl/interpreter.ts`. Implement `interpretScript`:
   - Initialize a step counter `steps = 0`.
   - Traverse the behavior tree recursively. Each visit to a node increments `steps`. If `steps > budget`, throw `BudgetViolation { antId, colonyId, tick, stepsExecuted: steps, budgetLimit: budget }`.
   - `Sequence`: execute children left-to-right; return the first failure; succeed if all succeed.
   - `Selector`: execute children left-to-right; return the first success; fail if all fail.
   - `Condition`: evaluate `check` against `sensor`; return success/failure.
   - `Action`: compute the `AntIntent` based on the sensor snapshot; return success.
   - For `MoveTowardFood`: find the nearest food tile in `sensor.visibleTiles`; emit `move` intent toward it.
   - For `MoveTowardNest`: emit `move` intent toward `sensor.nestDirection`.
   - For `MoveAlongPheromone`: find the neighbor tile with the highest pheromone on the given channel; emit `move` intent.
3. **Sandbox rules**: the interpreter has no access to global scope, `process`, `fs`, or any module outside `src/dsl/`. It receives only `script`, `sensor`, `ant`, `budget`, `tick`. This is enforced by structure — no `eval`, no dynamic import.

acceptance: `test/dsl/interpreter.test.ts`:
- Build a sensor with food visible at (2,1). Run the `BeginnerForager` script (defined in fixtures: `Selector([Sequence([Condition(HasFood), Action(MoveTowardNest), Action(Deposit)]), Sequence([Action(MoveTowardFood), Action(PickUp)])])`). Assert returned intent is `move` toward food.
- Build a sensor with `ant.carry === ant.maxCarry`. Run the same script. Assert intent is `move` toward nest.
- **Budget bomb**: create a `Sequence` with 1001 children of `Idle` nodes. Run with `budget=1000`. Assert `BudgetViolation` is thrown with `stepsExecuted === 1001`.
- **Determinism**: run the same script + sensor twice. Assert identical `AntIntent` returned.
- **Same step every run**: run the budget-bomb script 3 times with the same inputs. Assert `BudgetViolation.stepsExecuted` is identical all 3 times.
Run `npm test` → green.

---

**`A06` — Core ant model: energy, spawn, death, food pickup/drop/deposit**

dependsOn: `A05`

files: `src/core/ant-model.ts`, `test/core/ant-model.test.ts`

interface:
```typescript
// Spawn a new ant for a colony (returns updated state)
export function spawnAnt(state: ArenaState, colonyId: ColonyId, role: 'forager' | 'scout' | 'soldier'): ArenaState;

// Apply per-tick energy drain to all ants (they lose 1 energy per tick carrying food, else 0.5 — integer: 1 per 2 ticks for unloaded)
// Ants with energy <= 0 die.
export function drainEnergy(state: ArenaState): ArenaState;

// Produce food resources at food-source tiles (add FOOD_SPAWN_RATE food per food-source per tick)
export function spawnFood(state: ArenaState): ArenaState;
```

how to implement:
1. Create `src/core/ant-model.ts`.
2. `spawnAnt`: create a new `Ant` with a new unique `antId` (`colonyId + '-' + state.tick + '-' + colonyAntCount`), placed on the nest tile of the colony. Return updated state.
3. `drainEnergy`: for each living ant, reduce energy. Ants carrying food lose 2 energy per tick (integer). Ants not carrying lose 1 energy per tick. If energy ≤ 0, set `isDead: true`. Return new state.
4. `spawnFood`: for each food-source tile, add `FOOD_SPAWN_RATE` (= 5) food per tick, capped at `FOOD_MAX` (= 100). Return new state.

acceptance: `test/core/ant-model.test.ts`:
- Spawn an ant, drain energy 50 ticks (ant carrying food). Assert ant is dead at tick 25 (energy=50, 2/tick → 25 ticks).
- `spawnFood`: after 5 ticks, a food-source tile has 25 food (5 per tick × 5 ticks). Assert.
- `spawnAnt` twice: two ants have different `antId`s. Assert.
Run `npm test` → green.

---

**`A07` — Match runner + tournament judge**

dependsOn: `A06`

files: `src/tournament/match-runner.ts`, `src/tournament/judge.ts`, `test/tournament/judge.test.ts`

interface:
```typescript
export interface MatchConfig {
  seed: bigint;
  map: ArenaMap;       // static map definition (terrain, starting tiles, food-source locations)
  scripts: Map<ColonyId, DslScript>;
  maxTicks: number;
  budget: number;      // per-ant DSL step budget
}

export interface MatchResult {
  finalState: ArenaState;
  scores: Map<ColonyId, MatchScore>;
  violations: BudgetViolation[];
  tickHistory: ArenaState[];   // one snapshot per tick (for replay)
}

export interface MatchScore {
  foodGathered: number;
  survivalTicks: number;
  antsSurvived: number;
  combatKills: number;
  rulesViolations: number;
  total: number;
}

// Run a match to completion (deterministic).
export function runMatch(config: MatchConfig): MatchResult;

export interface TournamentResult {
  matchResults: MatchResult[];
  rankings: Array<{ colonyId: ColonyId; totalScore: number }>;
}
// Run a tournament: each script vs all others, across all map×seed combos
export function runTournament(
  seeds: bigint[],
  maps: ArenaMap[],
  scripts: Map<ColonyId, DslScript>,
  maxTicks: number,
  budget: number
): TournamentResult;
```

how to implement:
1. Create `src/tournament/match-runner.ts`. `runMatch` loops `maxTicks` ticks calling `runTick` and `drainEnergy` and `spawnFood` each tick. Collect all violations. Record `tickHistory[tick] = state` (snapshot after resolution). Score: `foodGathered` from `colony.foodStored`; `survivalTicks` = `maxTicks` minus first-death tick of queen; `antsSurvived` = living ants at end; `combatKills` = dead enemy ants attributed to this colony; `rulesViolations` = violations.length. Total = weighted sum (document weights).
2. Create `src/tournament/judge.ts`. `runTournament`: for each map×seed combo, run `runMatch` for each pair of scripts. Aggregate scores and rank by `totalScore`.

acceptance: `test/tournament/judge.test.ts`:
- Run a 2-colony, 10-tick match with the `BeginnerForager` script and the `BuggyInfiniteLoop` script (defined in A08). Assert:
  - `BeginnerForager` has 0 violations.
  - `BuggyInfiniteLoop` has ≥ 1 violations (budget exceeded).
  - `runMatch(config)` called twice with same config produces identical `MatchResult` (determinism).
- Run a tournament with 2 seeds × 2 maps × 2 scripts. Assert rankings have 2 entries and are reproducible across two `runTournament` calls with the same inputs.
Run `npm test` → green.

---

**`A08` — Adversarial fixture scripts**

dependsOn: `A07`

files: `src/fixtures/scripts.ts`, `test/fixtures/scripts.test.ts`

interface:
```typescript
export const BEGINNER_FORAGER: DslScript;        // follows food pheromone; deposits at nest
export const AGGRESSIVE_RAIDER: DslScript;       // moves toward enemy ants; attacks
export const DEFENSIVE_GARDENER: DslScript;      // lays home-trail pheromone; deposits food
export const SCOUT_SWARM: DslScript;             // explores; lays food-trail when food found
export const BUGGY_INFINITE_LOOP: DslScript;     // a Sequence with > budget children
```

how to implement:
1. Create `src/fixtures/scripts.ts`. Define each script as a `DslScript` (behavior tree object — no `eval`).
2. `BEGINNER_FORAGER`: `Selector([Sequence([Condition(HasFood), Action(MoveTowardNest), Action(Deposit)]), Sequence([Condition(PheromoneAbove, 'food-trail', 1000), Action(MoveAlongPheromone, 'food-trail')]), Sequence([Action(MoveTowardFood), Action(PickUp), Action(LayPheromone, 'food-trail', Q16_SCALE * 10)])])`
3. `BUGGY_INFINITE_LOOP`: a `Sequence` with 2000 `Idle` children (always exceeds budget=1000).
4. Define the others as behavior trees.

acceptance: `test/fixtures/scripts.test.ts`:
- `interpretScript(BUGGY_INFINITE_LOOP, sensor, ant, 1000, 0)` throws `BudgetViolation` with `stepsExecuted >= 1001`.
- `interpretScript(BEGINNER_FORAGER, sensorWithFood, ant, 1000, 0)` returns an intent without throwing.
- `interpretScript(BEGINNER_FORAGER, sensorWithNoFood, ant, 1000, 0)` returns `move` intent (toward food or along pheromone).
Run `npm test` → green.

---

**`A09` — Replay: seed+script-sourced reconstruction + golden-master**

dependsOn: `A08`

files: `src/replay/replay.ts`, `test/replay/replay.test.ts`

interface:
```typescript
// Reconstruct a match state at a given tick from the tick history.
export function replayAtTick(result: MatchResult, tick: number): ArenaState;

// Assert replay is deterministic: run the same match twice, compare tick histories.
export function assertMatchDeterminism(config: MatchConfig): void;

// Overlay projections (pure — do not affect simulation)
export interface PheromoneOverlay { colonyId: ColonyId; channel: Channel; values: number[]; }
export function buildPheromoneOverlay(state: ArenaState, colonyId: ColonyId, channel: Channel): PheromoneOverlay;
export function buildDecisionTrace(result: MatchResult, antId: AntId, tick: number): { sensor: SensorSnapshot; intent: AntIntent } | null;
```

how to implement:
1. Create `src/replay/replay.ts`.
2. `replayAtTick(result, tick)`: return `result.tickHistory[tick]`.
3. `assertMatchDeterminism`: run `runMatch(config)` twice; serialize both `MatchResult` to JSON; assert identical.
4. `buildPheromoneOverlay`: extract the pheromone channel values for the given colony from `state.pheromone`.
5. `buildDecisionTrace`: look up the logged intent for `antId` at `tick` from the match result log.
6. **Golden-master fixture**: run `runMatch(CANONICAL_MATCH_CONFIG)` with the 5 fixture scripts. Serialize `MatchResult` to JSON. Commit as `test/fixtures/golden-match.json`. Assert byte-stability in the golden-master test.

acceptance: `test/replay/replay.test.ts`:
- `replayAtTick(result, 5).tick === 5`.
- `assertMatchDeterminism(CANONICAL_MATCH_CONFIG)` passes (no error).
- **Overlay non-interference**: `buildPheromoneOverlay` called between ticks; assert the `result.tickHistory` is unchanged.
- Golden-master: `runMatch(CANONICAL_MATCH_CONFIG)` JSON matches `test/fixtures/golden-match.json`.
Run `npm test` → green.

---

**`A10` — Arena UI: animated ants, pheromone heatmap, code panel, scoreboard**

dependsOn: `A09`

files: `src/components/arena/ArenaGrid.tsx`, `src/components/arena/PheromoneOverlayLayer.tsx`, `src/components/arena/ScriptPanel.tsx`, `src/components/arena/ScoreBoard.tsx`, `test/components/arena/arena-ui.test.tsx`

interface:
```typescript
interface ArenaGridProps {
  state: ArenaState;
  overlay: PheromoneOverlay | null;
  speed: number;      // ticks per second (for animation)
  onTileClick: (tile: Tile) => void;
}
export function ArenaGrid(props: ArenaGridProps): JSX.Element;

interface PheromoneOverlayLayerProps { overlay: PheromoneOverlay; cols: number; rows: number; }
export function PheromoneOverlayLayer(props: PheromoneOverlayLayerProps): JSX.Element;

interface ScriptPanelProps {
  script: DslScript;
  violations: BudgetViolation[];
  onScriptChange: (script: DslScript) => void;
}
export function ScriptPanel(props: ScriptPanelProps): JSX.Element;

interface ScoreBoardProps { rankings: Array<{ colonyId: ColonyId; totalScore: number }>; currentTick: number; }
export function ScoreBoard(props: ScoreBoardProps): JSX.Element;
```

how to implement:
1. `ArenaGrid`: CSS grid matching `state.cols × state.rows`. Each tile shows terrain color. Ants rendered as colored dots (colony color). Food tiles show a food indicator. On overlay mode, render `PheromoneOverlayLayer` on top.
2. `PheromoneOverlayLayer`: render pheromone intensity as opacity of a colored div overlay per tile. Map value 0 → opacity 0; value PHERO_MAX → opacity 0.85.
3. `ScriptPanel`: display the current DSL script as a readable tree (expand/collapse per node). Show violations as highlighted error nodes. A "Load Example" button loads one of the fixture scripts.
4. `ScoreBoard`: table of colony names, scores, and ranks.

acceptance: `test/components/arena/arena-ui.test.tsx` (React Testing Library):
- Render `ArenaGrid` with a 5×5 state and 2 ants. Assert 25 tiles rendered. Assert 2 ant indicators visible.
- Render with `overlay !== null`. Assert the overlay layer is in the DOM.
- Render `ScriptPanel` with a `BEGINNER_FORAGER` script. Assert it renders without crash and the script tree has nodes visible.
- Render `ScoreBoard` with 2 colonies. Assert 2 rows visible.
Run `npm test` → green.

---

### 3. The decomposition method for the rest

After the first slice is green (all 10 cards pass, golden-master is committed, budget bomb triggers at the same step every run), expand the remaining breadth using this method.

**The recipe:**

1. **Name the invariant the feature must never break.** For this project: (a) `runMatch(config)` is byte-identical on two runs, (b) permuting script execution order does not change resolved world state (the fairness invariant — tested by A04), (c) a sandboxed script cannot escape the DSL interpreter to host globals, (d) no `Math.random()` or `Date.now()` in `src/`.
2. **Write the acceptance test first.** The test must check: the invariants above AND the specific behavior.
3. **Identify the prior card this depends on.** Add the `dependsOn` edge.
4. **Keep each card to one focused addition.** One new DSL condition, one new scenario, one new terrain type.

**Worked example 1: Evaporating-trail trap (A8 fixture)**

Decompose the "forager gets stranded when trail evaporates" scenario:
- **`B01` — Evaporation rate fixture.** Add a constant `TRAIL_EVAPORATION_TICKS` to `src/fixtures/constants.ts` specifying how many ticks a max-intensity food-trail lasts at the default rate. Compute analytically: `PHERO_MAX * (253/256)^N < THRESHOLD` → solve for N. Commit N as a constant. Acceptance: `assert(evaporate(PHERO_MAX, TRAIL_EVAPORATION_TICKS) < THRESHOLD)` where THRESHOLD is the pheromone-above condition threshold used in `BEGINNER_FORAGER`.
- **`B02` — Stranding scenario.** Build a map with food at (10,0) and nest at (0,0). Run `BEGINNER_FORAGER` for `TRAIL_EVAPORATION_TICKS + 5` ticks. After tick `TRAIL_EVAPORATION_TICKS`, the ant can no longer detect the trail (pheromone below threshold) and must fall back to `MoveTowardFood` — assert the ant changes behavior at the exact predicted tick. Acceptance: check the logged intent at tick N vs. tick N+1 (one uses MoveAlongPheromone, one uses MoveTowardFood).

**Worked example 2: Scout-recruitment via pheromone (required scenario)**

- **`B03` — `LayPheromone` triggers `PheromoneAbove` condition.** A scout ant deposits food-trail pheromone at a tile. A forager ant at an adjacent tile in the next tick has `PheromoneAbove('food-trail', 1000)` true. Acceptance: run a 2-tick match: tick 1 scout deposits; tick 2 forager checks the condition. Assert the condition fires (sensor value > threshold).
- **`B04` — Recruitment scenario.** Build a 3-ant scenario: 1 scout at (5,0), 2 foragers at (0,0). Run `SCOUT_SWARM` for 10 ticks. Assert that by tick 8, at least one forager has moved toward the food source (detected the scout's pheromone trail). Acceptance: check forager positions at tick 8.

**Worked example 3: Sandbox escape attempt (A8 fixture)**

- **`B05` — Hostile script fixture.** Define `SANDBOX_ESCAPE_ATTEMPT: DslScript` as a script that tries to reference a host global (e.g. `{ type: 'Condition', check: { type: 'HasFood' } }` with an extra field `_hack: '__proto__'` that the interpreter must ignore). Acceptance: `interpretScript(SANDBOX_ESCAPE_ATTEMPT, sensor, ant, 1000, 0)` returns a normal intent — the extra field is ignored; no host access occurs.
- **`B06` — Structured escape attempt log.** Add a `ScriptValidationError` type. Create `validateScript(script: DslScript): ScriptValidationError[]` — returns errors for unknown node types or unknown action/condition names. Acceptance: a script with `{ type: 'UnknownNode' }` returns a `ScriptValidationError` with a located error message.

---

### 4. Per-task implementation conventions

**Folder layout:**
```
src/
  core/              -- types.ts, prng.ts, pheromone.ts, tick.ts, ant-model.ts
  dsl/               -- dsl-types.ts, interpreter.ts
  tournament/        -- match-runner.ts, judge.ts
  replay/            -- replay.ts
  fixtures/          -- scripts.ts, maps.ts, constants.ts
  components/
    arena/            -- ArenaGrid.tsx, PheromoneOverlayLayer.tsx, ScriptPanel.tsx, ScoreBoard.tsx
    ui/               -- shared primitives
  pages/             -- ArenaPage.tsx
test/
  core/
  dsl/
  tournament/
  replay/
  fixtures/
  components/arena/
  fixtures/           -- golden-match.json
```

**How to write a test in this stack:**
```typescript
// test/core/tick-test.ts
import { describe, it, expect } from 'vitest';
import { applyIntents } from '../../src/core/tick.js';

describe('intent fairness', () => {
  it('antId order is stable under intent permutation', () => {
    const intentsA = [intentA, intentB];
    const intentsB = [intentB, intentA];  // same intents, different order
    const resultA = applyIntents(state, intentsA);
    const resultB = applyIntents(state, intentsB);
    expect(JSON.stringify(resultA)).toBe(JSON.stringify(resultB));
  });
});
```

**Keeping it deterministic:**
- All randomness: `prngNextInt(state.rngState, max)`. Update `state.rngState` with the returned `next` value. Never call `Math.random()`.
- Pheromone math: always `Math.floor` the integer-arithmetic expression. Never use intermediate floats.
- DSL step counting: the counter is a local variable inside `interpretScript` — it cannot be reset or influenced by a script.
- Conflict resolution: always sort intents by `antId` before applying. Document this once in `applyIntents` and never change it.

**How to verify sandbox safety without host `eval`:**
The DSL interpreter is a plain recursive function over a JSON tree. There is no dynamic dispatch, no `eval`, no `new Function`. A script cannot access anything outside the `sensor`, `ant`, `budget`, and `tick` arguments. This is structurally safe — add a comment to `interpreter.ts`: `// SAFETY: this function receives no global scope reference. All world access is through the 'sensor' argument only.`

**Definition of done for any card:**
1. All acceptance tests pass under `npm test`.
2. TypeScript compiles with zero errors.
3. No `eval`, `Math.random()`, `Date.now()`, or `fetch` added to `src/`.
4. `runMatch(config)` byte-identical on two runs (re-run `assertMatchDeterminism` in every card that touches the tick kernel or resolver).
5. Permuting script execution order within the Sense phase produces the same resolved state (fairness invariant).

---

### 5. Common pitfalls for a weak model on this project

**Pitfall 1: Using floating-point for pheromone math.**
A 3B model will write `value *= 0.99` for evaporation. This is a float and will produce different results across platforms, breaking byte-identical replays. Always replace with `Math.floor(value * 253 / 256)`. The float-trap regression test in A03 directly catches this.

**Pitfall 2: Mutating world state during the Sense phase.**
A model may call `depositPheromone` inside `buildSensorSnapshot` (e.g. for scout recruitment). This breaks the two-phase invariant: ant B's sensor reads a world that ant A already modified. Always build all snapshots from a single frozen pre-tick copy of `ArenaState`, never from the live state. The order-independence test in A04 catches this.

**Pitfall 3: Seeding the PRNG with `seed + colonyIndex` instead of `deriveSeed`.**
If sub-seeds are derived by adding constants, different colonies in the same tick may have correlated random behavior (the StS bug analog). Always use `deriveSeed(primary, name)` which applies an avalanche mixer. The seed-derivation test in A02 checks that two different names produce different outputs.

**Pitfall 4: The budget bomb hanging the match loop.**
A model may not implement the step budget inside `interpretScript`, leaving the test to hang. The budget throw must fire inside the recursive DslNode traversal — not as a post-hoc check after the tree finishes. Add a test specifically asserting that the throw happens within 10ms of wall-clock time (use Vitest's `timeout` option with a very short timeout for the budget-bomb test).

**Pitfall 5: Conflict resolution order not documented + not stable.**
If `applyIntents` doesn't sort by `antId` before processing, the same match run on two machines with different Map iteration order will produce different results. Always sort. The order-independence test in A04 verifies this by permuting the input and checking the output is identical.

**Pitfall 6: `tickHistory` storing references instead of snapshots.**
If `runMatch` does `tickHistory.push(state)` and then mutates `state` in subsequent ticks, all history entries point to the same mutable object. Always deep-clone the state before pushing: `tickHistory.push(deepClone(state))`. This is expensive for large arenas — for the test suite, limit history to 100 ticks or use a compact serialization format. The golden-master test will catch stale history immediately.

**Pitfall 7: Forgetting `dependsOn` edges when a card uses types from earlier cards.**
The import graph: `A01 → A02 → A03 → A04` (with A05 depending on A04) → `A06 → A07 → A08 → A09 → A10`. Any card writing `ArenaState` imports from `A01`. Any card writing `AntIntent` imports from `A04`. Any card running a script imports from `A05`. Always trace the full import chain before writing a card's file list.
