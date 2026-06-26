# 29 - Factory Automation Puzzle Sandbox

Complexity tier: 29/35 game block
Expected decomposition size: 105-130 dependent implementation cards before coding.
Domain pressure: factory automation, logistics puzzles, conveyor routing, resource transformation, blueprinting, simulation determinism, production-line presentation.
Acceptance command: npm test

## How to use this challenge
This is a game dev-test project specification for evaluating whether an autonomous coding agent can decompose real game systems, implement deterministic simulation logic, and build a polished presentation layer that makes the game understandable and desirable. The goal is not to finish the whole game. The goal is to build a product-grade foundation that proves the agent understands rules, simulation state, player experience, rendering, and verification.

The agent must read this entire specification before planning. It must create a dependency-linked plan, record domain knowledge debt, identify engine and presentation invariants, and choose a release slice that exercises the highest-risk mechanics. For game projects, visual presentation is mandatory, not a stretch goal. A correct simulation hidden behind ugly placeholder UI is not enough.

## Product vision
Build a factory automation puzzle sandbox where players design production lines, route resources, optimize throughput, and solve scenario contracts. The foundation should combine satisfying presentation with a deterministic logistics simulation deep enough to support puzzles, freeplay, and future multiplayer ghost challenges.

## Target players and users
- Automation puzzle fans who want compact, readable optimization problems.
- Creative builders who want blueprints, copy/paste, and production metrics.
- Level designers who need data-driven recipes, machines, constraints, and scoring.
- Spectators who enjoy watching production lines come alive.

## Foundation release scope
The first serious buildout must include:
- World, tile, belt, splitter, merger, inserter, machine, recipe, item, fluid, pipe, power source, blueprint, contract, metric, replay, and save-game models.
- Tick-based logistics simulation for item movement, belt lanes, machine input/output buffers, recipe timing, power draw, blocked output, and throughput measurement.
- Factory components including belts, splitters, mergers, underground belts, inserters, assemblers, smelters, pipes, pumps, tanks, storage, and power distribution.
- Recipe graph with intermediate products, byproducts, ratios, bottleneck analysis, and contract requirements.
- Blueprint system for selecting, copying, rotating, placing, validating, and comparing factory modules.
- Scenario contracts with resource budgets, space limits, time limits, throughput goals, waste limits, and scoring tiers.
- Debug and analytics overlays for item flow, machine utilization, bottlenecks, power, blocked outputs, buffer levels, and contract progress.
- Replay/save system that stores build commands and reconstructs the factory deterministically.
- Seed scenarios for starter circuits, fluid cracking, compact smelting, mixed-belt cleanup, limited power, and late-game modular production.

## Gameplay requirements
- Optimization must be measurable through throughput, latency, utilization, cost, footprint, and reliability.
- The game must support both puzzle constraints and open sandbox building.
- Blueprinting is not optional; it is core to scale and player expression.
- Analytics overlays must help players improve designs without solving everything automatically.

## Presentation requirements
Very nice presentation is mandatory for this challenge. The agent must treat rendering, animation, interaction feedback, and layout polish as core acceptance criteria. Required presentation work:
- Factories must feel alive: animated belts, moving items, machine cycles, power pulses, fluid indicators, smoke or heat accents, and satisfying build placement feedback.
- The interface must include a polished build palette, ghost placement, invalid-placement hints, rotation previews, blueprint selection, and compact metrics panels.
- Overlays must be visually distinct and readable: flow arrows, bottleneck heatmaps, utilization colors, contract goals, and power-network highlights.
- The camera should pan and zoom smoothly, with crisp tile rendering and no layout shift in toolbars or metrics panels.
- A beautiful production line view is mandatory; raw grid cells with letters do not meet the challenge.

## Architecture requirements
- Separate simulation core, component definitions, recipe graph, placement validation, blueprint system, scenario rules, replay/save logic, analytics projection, and renderer.
- Use deterministic tick ordering for belts, machines, and fluids.
- Represent item and fluid movement as simulation state, not as animation-only effects.
- Make scoring and contract validation pure and fixture-testable.

## Domain knowledge debt to surface
The agent should not pretend to know every game design, simulation, AI, rendering, or balancing detail perfectly. It should mark assumptions, build deterministic subsets, and preserve extension points for future designers, artists, balance passes, and live integrations. Required knowledge areas:
- Factory games require careful tick ordering to avoid unfair or nondeterministic throughput.
- Production ratios and bottlenecks should be computed from recipes and actual flow.
- Blueprints need structural validation across rotations and terrain constraints.
- Presentation is gameplay because players understand machines through motion and overlays.

## Required challenge scenarios
The implementation plan and fixtures should be shaped around scenarios like these. They do not all need full UI coverage in the first slice, but the core model and presentation should be capable of representing them:
- A splitter balances two belts until one downstream machine backs up.
- A fluid recipe creates a byproduct that must be stored or consumed to keep the line running.
- A compact blueprint is rotated and placed near obstacles with partial invalid tiles.
- A contract rewards throughput but penalizes power spikes and wasted output.
- A replay reconstructs a build sequence and reaches the same final production metrics.

## Decomposition pressure
This challenge should force decomposition across rules or simulation engine, deterministic fixtures, AI or policy layers, replay/save state, player-facing presentation, UI interaction, diagnostics, and test harnesses. The plan should include dependency links so core state, commands, invariants, and golden tests are built before rendering depends on them. Avoid starting with a visual mock that cannot play the game; also avoid building a correct but lifeless engine with no usable presentation.

The agent should maintain a visible knowledge-debt list covering unclear rules, balance assumptions, AI limitations, rendering tradeoffs, asset gaps, accessibility concerns, performance constraints, and future designer review checkpoints. Knowledge debt is not a failure; hiding it is.

## Acceptance criteria
- Simulation tests cover belts, splitters, mergers, inserters, machines, pipes, buffers, power, blocked outputs, and recipe timing.
- Recipe graph tests compute ratios, bottlenecks, byproducts, and contract requirements.
- Blueprint tests cover copy, rotate, validate, place, reject, and compare.
- Replay tests reconstruct build commands and simulation metrics exactly.
- Presentation checks verify animated components, build palette, ghost placement, overlays, camera controls, and readable metrics.
- The project passes npm test without real-time simulation dependence.

## Explicit non-goals
- Do not make item movement purely cosmetic.
- Do not use nondeterministic tick order.
- Do not ship a lifeless grid without animated machines and overlays.
- Do not hard-code one scenario into the engine.

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

> Added 2026-06-26 via deep domain research. **The single hardest, most-defining property of this project:** a factory game is a *fixed-point, fixed-timestep, deterministic discrete-event simulation of a material-flow graph* in which **matter is conserved exactly, tick-update order is total and stable, and a recorded build-command log replays bit-identically to the same throughput** — everything else (recipes, blueprints, contracts, the beautiful animated belts) is content layered on that spine. Get the conservation-and-determinism core right and the game is real; get it wrong and you have a lava-lamp that lies about its numbers.

This section adds the load-bearing architecture the base spec implies but does not pin down. It is grounded in how the genre's reference implementations actually work — Factorio's belt/transport-line model and its deterministic multithreaded tick discipline, Satisfactory's fluid-network behavior, and the standard production-graph (linear-program) formulation used by the community calculators.

## F0. The meta-test: what "deterministic logistics simulation" actually demands

The base spec says "use deterministic tick ordering" and "represent item movement as simulation state, not animation-only effects." Those two sentences are the whole challenge. Make them concrete and testable:

1. **Conservation.** At every tick boundary, `Σ items in the world` changes only by exactly what sources injected and sinks/recipes consumed. No item is silently created or destroyed by a belt corner, a splitter rounding, a blueprint paste, or a save/load. This is a property test, not a vibe.
2. **Determinism.** `simulate(seed, commandLog, N_ticks)` run twice yields byte-identical world-state hashes at every checkpoint, on any machine. No `Date.now()`, no `Math.random()` outside the seeded PRNG, no floating-point in the authoritative core (fixed-point only — see F1).
3. **Replayability.** The replay/save artifact is the **command log + seed**, not a state dump; reconstructing the factory from it reaches the *exact same final production metrics* (a base-spec required scenario). The state snapshot exists only as an optimization/checkpoint, never as the source of truth.
4. **Throughput truth.** Measured throughput, utilization, and bottleneck reports are derived from the same authoritative state the simulation runs on — never from a parallel "analytics-only" approximation that can disagree with what the belts actually did.

Everything below serves these four. Build the kernel (F1–F3) before any renderer.

## F1. The fixed-point logical-time kernel (the foundation under the foundation)

Factory determinism is impossible with floats: floating-point rounding differs across CPUs/compilers and compounds into divergence over thousands of ticks — the canonical cause of lockstep desync ([Gaffer On Games — Floating Point Determinism](https://gafferongames.com/post/floating_point_determinism/); deterministic-lockstep frameworks use fixed-point FP math precisely for this reason, e.g. [Klotho's FP64 fixed-point core](https://github.com/xpTURN/Klotho)). So:

- **Sub-tile fixed-point positions.** Adopt Factorio's proven scheme directly: a belt tile is **256 fixed-point positions** (resolution 1/256 tile); belt speeds are integer **positions-per-tick** (the reference values: standard 8/tick, fast 16/tick, express 24/tick → 1.875 / 3.75 / 5.625 tiles per second at 60 ticks/s); the **minimum gap between items on a saturated belt is 64 positions** (→ a hard cap of 4 items per tile per lane, single-lane throughput = 4 × tiles/s) ([Factorio Wiki — Transport belts/Physics](https://wiki.factorio.com/Transport_belts/Physics)). Corners are *not* the same length as straights — model the inner lane of a turn shorter and the outer lane longer (reference: inner 106 positions, outer 295 positions per 256-position straight) so a corner subtly changes per-lane throughput, which is a real, testable gameplay fact.
- **Tick = 1/60 logical second, injected clock.** All durations (recipe craft time, inserter swing, fluid update, contract timers, animation phase) read the logical tick counter. Tests advance ticks explicitly; the renderer interpolates between the last two authoritative states for smoothness but never feeds back into the sim.
- **Seeded entropy tree.** Any nondeterminism the *design* wants (tie-break jitter, future enemy/event seeds, procedural scenario layout) draws from one seeded splittable PRNG, so a run is reproducible from `(seed, commandLog)`.
- **Integer-only authoritative state; floats live only in the renderer.** The core simulates in fixed-point; the view may convert to float for drawing. A lint/architecture test forbids `number`-float arithmetic in core modules where it would affect state (enforce via a typed `Fixed` newtype so it cannot accidentally mix with `number`).

This kernel is the first ~12–15 cards and gates everything.

## F2. The transport-line model (the genre's defining data structure)

Naïvely simulating each item as an independent position-bearing entity is both slow and a determinism hazard. The reference solution — and the thing that makes this spec *expert-grade* rather than student-grade — is the **transport line**: a maximal run of belts treated as one object that stores **gaps between items**, not absolute positions ([Factorio FFF #176 — Belts optimization](https://www.factorio.com/blog/post/fff-176)).

- **Items as a gap list.** A transport line holds an ordered list of items each described by the distance to the next; the "head" gap and "tail" gap are the only things most ticks touch. For an unblocked line you **increment/decrement only the terminal gap and do not move items at all** — O(1) per line regardless of length. When the line is blocked, you decrement the *last non-zero gap*, and that compressed-index *can only decrease, never increase*, giving amortized-constant updates.
- **Compression semantics.** Whenever a gap exceeds the standard spacing, an item may be inserted there; inserted items are squashed below standard spacing, and when the belt moves the gap re-extends to standard ([Factorio FFF #231 — Belt compression](https://www.factorio.com/blog/post/fff-231)). **Once a belt compresses it stays compressed** until drained — model this exactly; it is why real factories "back up" cleanly and why balancers are needed.
- **Inserters track items at O(1).** An inserter watching a line maintains a cursor and updates the absolute position of its tracked item in O(1) as the line shifts — it must not re-scan. Inserter pickup/drop is where items leave aggregate movement and are simulated individually; the **swing has its own fixed tick cost** and is a notorious source of off-by-one throughput bugs (a real Factorio bug report: an inserter's rotation cost shifting by a single tick changes steady-state throughput — [forums.factorio.com 2.1.8](https://forums.factorio.com/viewtopic.php?p=696038)). Make inserter timing a first-class, golden-tested number.
- **Lines split/merge on edit.** Building or removing a belt, or a splitter boundary, splits or merges transport lines; splitters and undergrounds are the canonical line boundaries. The split/merge must conserve every item and be replay-stable.

**Property tests for F2:** (a) total items invariant across arbitrary build/remove command sequences; (b) a fully-compressed line drained from the front re-expands to exactly standard spacing; (c) throughput of a saturated straight line equals the analytic `4 × tiles/s` for its tier; (d) corner lane throughput differs from straight by the documented ratio.

## F3. Deterministic tick order: the update-schedule contract

"Deterministic tick ordering" must be a *named, stable, total order* with documented phase boundaries, because the order in which belts, inserters, and machines update changes outputs. Factorio's own engine treats activation order as load-bearing and, when multithreaded, **defers cross-thread wakeups into a list the main thread merges in a deterministic group-update order** rather than waking entities immediately ([Factorio FFF #176](https://www.factorio.com/blog/post/fff-176)). Your single-threaded core gets this for free *only if you fix the order explicitly*:

- **Phased tick.** Define ordered phases, e.g.: (1) fluids/pipes settle, (2) machines consume inputs and advance crafts, (3) machines emit outputs into buffers, (4) inserters swing (pickup then drop, in a fixed entity order), (5) transport lines advance, (6) sinks/contracts sample. The phase list is a documented constant; reordering it is a breaking change with a regression test.
- **Stable intra-phase order.** Within a phase, entities update in a deterministic key order (insertion-order id, or spatial Z-order) — never hash-map iteration order, never wall-clock. A "shuffle the entity-update order, assert identical result" *negative* test proves you did not accidentally depend on a coincidental order where you shouldn't, and a separate test proves you *do* depend on it where the design says you must (e.g. two inserters competing for the same belt slot resolve by stable priority, documented).
- **No same-tick double-move.** An item moved by phase 5 must not also be picked up by an inserter that already ran in phase 4 this tick — phase ordering prevents the classic "free teleport" bug.

## F4. The production graph as a linear program (ratios, bottlenecks, byproducts — done right)

The base spec wants "ratios, bottlenecks, byproducts, and contract requirements." The correct, expert formulation is a **linear program over the recipe matrix**, exactly as the community calculators do it ([Kirk McDonald — Calculating Factorio](https://kirkmcdonald.github.io/posts/calculation.html); [Factorio Wiki — Balancer mechanics](https://wiki.factorio.com/Balancer_mechanics)):

- **Recipe matrix `A`.** Rows = items/fluids, columns = recipes (+ pseudo-recipes for raw sources and "waste" sinks). Positive entries = products, negative = ingredients. Solve `A·x = b` where `x` = per-recipe run-rate and `b` = desired net output. Steady-state assembler counts follow `output/s = (recipe_out × craft_speed) / craft_time`, `assemblers = ⌈target / per_assembler⌉`.
- **Cycles are normal, not errors.** Oil cracking / recycling / catalysts create cycles in the recipe graph; the matrix formulation handles them natively (no topological sort required). Your bottleneck analyzer must therefore work on a *cyclic* graph — this is a key correctness seam, and a place student implementations break.
- **Underdetermined systems + cost vector.** When multiple recipes make the same item, the system is underdetermined; resolve with a **lexicographic cost vector** (a reasonable default cost is per-recipe power draw) so the optimizer prefers, in priority order, the cheaper inputs — and add explicit **"waste" columns** (lowest priority) so surplus byproducts can be sunk rather than making the LP infeasible.
- **Two truths, reconciled.** The LP gives the *theoretical* ratio/bottleneck ("you need 1.5 copper plates per circuit"); the live sim gives the *actual* observed flow. The analytics overlay must show both and flag divergence (real factories run with deliberate slack — "one extra assembler absorbs micro-pauses" is the practitioner rule). **A property test asserts that a factory built exactly to the LP ratio, fed at the LP input rate, reaches the LP-predicted output ± the documented slack, within a bounded warm-up.**

## F5. Fluids and pipes (the second, harder flow system)

Fluids are not items and must not be modeled as items. They are a **continuous network that equalizes**, with throughput that degrades at junctions and dead-ends ([Satisfactory Wiki — Pipelines](https://satisfactory.wiki.gg/wiki/Pipelines); [Pipeline Junction](https://satisfactory.wiki.gg/wiki/Pipeline_Junction)):

- **Segment = connected pipe network** with a fixed per-segment fluid amount; junctions **split outgoing flow as evenly as possible and equalize levels**, and a full downstream branch causes **backflow that throttles the whole segment below its nominal max** (the documented "manifold backs up, flow fluctuates" behavior). Model nominal throughput (e.g. tiered max m³/tick) and the backpressure penalty as real state.
- **Head-lift / elevation (optional but flavorful).** Pumps add lift; without enough lift a vertical run won't fill. Even a simplified integer head-lift model gives the fluid system a distinct identity from belts.
- **Determinism caution.** Equalization is the classic place floating-point sneaks in. Do it in fixed-point with a fixed visitation order over the segment's tiles; a "byproduct must be stored or consumed to keep the line running" base scenario is the acceptance test (a tank fills, the upstream recipe stalls, throughput drops measurably — all deterministically).

## F6. Blueprints as canonical, content-addressable structures

Blueprinting is "core to scale and player expression" (base spec) and is a real serialization/normalization problem, mirrored by Factorio's actual format ([Factorio Wiki — Blueprint string format](https://wiki.factorio.com/Blueprint_string_format)):

- **Structure.** A blueprint is an entity list (`entity_number`, `name`, `position {x,y}` *relative to the blueprint origin*, `direction`, `recipe`, control behavior) plus tiles and wire/connection topology. Positions are relative to a center, so a blueprint is **translation-invariant**.
- **Canonicalization is the hard part.** "Copy, rotate, validate, place, reject, compare" (base spec) requires a **canonical form**: normalize origin, sort entities by a stable key, canonicalize each rotation, so that **two structurally-identical blueprints hash to the same id regardless of authoring order, translation, or which rotation they were saved in** ([factorio-blueprint-tools supports mirror/tile/split](https://github.com/christoph-frick/factorio-blueprint-tools)). "Compare two blueprints" becomes hash equality on canonical form. Rotation must be exact (direction enum, 4- or 8-way) and must round-trip: `rotate⁴ == identity`.
- **Placement validation** against terrain/obstacles/partial-invalid tiles is a pure function (a base scenario: a compact blueprint rotated near obstacles with some invalid tiles). Validation, canonicalization, and hashing are all pure and fixture-tested with golden blueprint files committed to the repo.

## F7. Contracts, scoring, and the analytics projection

- **Contracts** carry resource budgets, space/time limits, throughput goals, waste limits, and scoring tiers; scoring and validation are **pure functions of the recorded run** (base spec). A contract that "rewards throughput but penalizes power spikes and wasted output" is evaluated over the deterministic tick log, so the score is replay-stable.
- **Power is a network, not a meter.** Generation, draw, and shortfall (brownout → machines slow/stall) are simulated; a "limited power" scenario must deterministically throttle production. Power draw also feeds the LP cost vector (F4).
- **Analytics are projections** (utilization %, blocked-output flags, buffer levels, bottleneck heatmap, flow arrows) computed from authoritative state — the renderer reads these, never recomputes physics.

## F8. The presentation layer is gameplay (and must not break determinism)

The base spec is emphatic that "presentation is gameplay." The v2 discipline: **the beautiful layer is a pure function of authoritative state, decoupled from the tick rate.**

- **Interpolated rendering.** The renderer draws at display refresh by interpolating between the two most recent authoritative tick states; the sim runs at fixed 60 ticks/s via an accumulator ([Gaffer On Games — Fix Your Timestep](https://gafferongames.com/post/fix_your_timestep/)). Animated belts, moving items, machine cycles, power pulses, fluid indicators, smoke/heat accents all derive from sim state + interpolation — never from independent `requestAnimationFrame` timers that could disagree with the simulation.
- **Build feel.** Ghost placement, invalid-placement hints (reusing the F6 validation predicate), rotation previews, blueprint selection, and snap feedback are required and must be visually crisp with no toolbar/metrics layout shift.
- **Overlays** (flow, bottleneck heatmap, utilization color, contract goals, power network) are the F7 projections rendered legibly. A "presentation check" test asserts panels are non-overlapping and overlays toggle without re-laying-out the board.

## F9. Adversarial / edge-case fixture pack (what separates a sim from a demo)

Ship these as deterministic fixtures the simulation must survive, each asserting an invariant:

- **The splitter back-pressure race** (base scenario): a balancing splitter feeding two belts, one downstream machine backs up — assert the split stays fair until backup, then biases correctly, and **no item is duplicated or lost** at the split.
- **The compression trap:** feed a belt to full compression, then drain from the front — assert exact re-expansion to standard spacing and conserved count.
- **The cyclic recipe:** a recipe graph with a recycling loop and a catalyst — assert the LP solves and the live factory reaches steady state without deadlock.
- **The fluid manifold backup** (base scenario): a byproduct tank fills — assert deterministic throughput drop and recovery when drained.
- **The 8-way rotation round-trip:** rotate a complex blueprint through all orientations and back — assert canonical-hash identity.
- **The inserter off-by-one:** a hand-built fixture that would expose a single-tick inserter timing error — golden throughput number locked.
- **The replay divergence canary:** run the same command log on two fresh worlds with different (irrelevant) host conditions — assert identical state hashes at every checkpoint.
- **The save/load equivalence:** snapshot mid-run, kill, restore from snapshot + remaining command log — assert the restored run reaches identical final metrics as the uninterrupted run.

## F10. Global invariants (property-based — this is how the foundation is graded)

Beyond example tests, assert system-wide invariants over randomized + scripted runs:

1. **Conservation of matter** — for any command log, `Δ(total items + items-in-flight + items-in-buffers)` equals exactly `injected − consumed`; belts, corners, splitters, mergers, undergrounds, and save/load are all matter-neutral.
2. **Determinism** — `simulate(seed, log, N)` twice ⇒ identical per-checkpoint state hashes; shuffling *renderer* inputs never changes sim state.
3. **Replay fidelity** — command-log replay reaches identical throughput/utilization/contract score as the original run (base-spec required scenario, elevated to an invariant).
4. **Tick-order stability** — the documented phase order is the only order that produces the golden outputs; a regression test pins it.
5. **Throughput monotonicity where claimed** — upgrading a belt tier or adding an in-ratio assembler never *decreases* steady-state output of an otherwise-unchanged line (catches accidental backpressure bugs).
6. **Compression idempotence** — a compressed line that is neither fed nor drained does not spontaneously change item count or spacing across arbitrary tick counts.
7. **LP/sim agreement** — a factory built to the LP ratio hits the LP-predicted output within documented slack and warm-up.

Plus a **chaos pass**: randomized build/remove/rotate command streams interleaved with save/load and pause/resume, asserting invariants 1–7 hold throughout.

## F11. The concrete first vertical slice (the on-ramp — build THIS first, ~40–55 cards)

Do **not** spread the first release across all machine types and scenarios. Prove the spine end-to-end on one deep slice:

- **Kernel (F1):** fixed-point positions, virtual clock, seeded PRNG, world-state hashing.
- **Transport-line core (F2) + phased tick (F3):** belts, one corner type, one splitter, one merger, one underground — with the gap-list model, compression, and the documented tick phases.
- **One machine + one inserter + one two-step recipe** (raw → intermediate → product) wired through input/output buffers, with correct inserter swing timing.
- **Power as a network** with a brownout throttle, feeding one "limited power" contract.
- **The LP analyzer (F4)** on that small recipe set, with the LP-vs-sim agreement test green.
- **Blueprint MVP (F6):** copy/rotate/validate/place/compare on the slice's entities, canonical hashing, golden blueprint fixtures.
- **Replay/save (F0/F10):** command-log record + replay reaching identical metrics; snapshot/restore equivalence.
- **Polished slice view (F8):** animated belts/items/machine/inserter/power with interpolated rendering, build palette, ghost placement + invalid hints, one bottleneck/utilization overlay, smooth pan/zoom — a board that looks alive, not a letter grid.
- **Green:** the F9 splitter-backpressure + compression-trap + replay-divergence fixtures and the F10 conservation + determinism + replay invariants, all passing under `npm test` with zero wall-clock/random/network dependence.

If that slice is real, every later machine, fluid, and scenario is breadth on a proven spine.

## F12. Domain knowledge-debt to track (surface, don't bluff)

- **Tick-rate & timing constants** (belt speeds, inserter swing, craft times, min item gap) are *balance numbers* borrowed from a reference; flag them as designer-tunable and document the source so a balance pass can re-derive them rather than treating them as physics.
- **Fluid model fidelity:** the simplified equalization/backpressure model is a deliberate subset of real CFD; mark where it diverges from Satisfactory/Factorio behavior and where a fluids designer must review.
- **LP scope:** the linear-program ratio tool assumes steady state and ignores warm-up transients, buffer dynamics, and beacon/module effects — note these as future extensions, not silent omissions.
- **Performance ceiling:** the gap-list optimization is essential at scale; document the entity-count budget the first slice targets and where spatial partitioning/multithreading would be needed (and the determinism cost of multithreading — see Factorio's deferred-wakeup approach).
- **Accessibility:** color-coded overlays (bottleneck heatmaps, utilization) need a colorblind-safe palette and non-color redundant encoding; flag for an a11y review.
- **Blueprint canonicalization corner cases:** mirroring, fluid-direction asymmetry, and modded entities complicate canonical form; mark the boundary the first slice supports.

## F13. Why this is a great !Klein challenge

This stresses exactly the capabilities !Klein exists to prove with small local models: **decomposition** (a clean dependency spine from kernel → transport line → tick order → recipes → blueprints → presentation, where building out of order fails loudly), **determinism under weak models** (the agents cannot hand-wave "it mostly works" — the conservation and replay invariants are pass/fail and catch any nondeterministic shortcut a fuzzy model might take), **long-running stateful correctness** (a 10,000-tick replay either matches or it doesn't), and **legible, evidence-backed work** (every throughput number is derivable from recipe + tick math, every score from the recorded log). The fixed-point/transport-line/LP spine is *small enough to build* yet *unforgiving enough to grade*, which is the ideal shape for a swarm to decompose and a human to trust. Build the kernel, transport line, tick order, and conservation invariants first (F1–F3, F10–F11); earn the rest.
