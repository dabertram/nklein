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
