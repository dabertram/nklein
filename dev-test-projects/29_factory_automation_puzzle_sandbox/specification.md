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

---

## Small-model build guide (3B-ready)

This section makes the spec mechanically buildable by a tiny (~3B-parameter) local model. Every card is sized for one focused implementation step. Follow it literally; do not infer unstated requirements.

### 1. Glossary & ground rules

**Domain terms:**
- **Tick** — one logical simulation step; the game runs at 60 ticks per logical second. The real clock is never read in the sim; only the integer tick counter advances.
- **Fixed-point position** — a belt tile is divided into 256 sub-tile positions. A position value is an integer (type `Fixed` = branded `number & { __fixed: true }`). Never store raw `number` floats in simulation state.
- **Transport line** — a maximal run of connected same-direction belt tiles modeled as a single object storing a list of (itemId, gapToNext) pairs, not per-item absolute positions.
- **Gap** — the distance (in fixed-point positions) between the trailing edge of one item and the leading edge of the next item ahead. Standard gap on a saturated belt = 64 positions. Minimum valid gap = 0.
- **Belt tier** — Standard (speed 8 pos/tick), Fast (16 pos/tick), Express (24 pos/tick).
- **Phase** — one of the six named stages executed in order every tick: (1) fluids, (2) machine-consume, (3) machine-emit, (4) inserters, (5) transport-lines, (6) sinks.
- **Entity id** — a monotonically-increasing integer assigned at placement time. Determines stable intra-phase update order.
- **Inserter** — a rotary arm that moves one item per swing from a belt or chest into a machine or belt. Swing duration is a fixed tick constant.
- **Recipe** — a pure data record: `{ id, inputs: {itemId, qty}[], outputs: {itemId, qty}[], craftTicks: number }`.
- **Machine** — an entity with input buffer, output buffer, active recipe, and craft-progress counter.
- **Blueprint** — a translation-invariant, rotation-normalized list of entity records with relative positions.
- **Command log** — the append-only list of player-issued commands (PlaceBelt, PlaceMachine, StartRecipe, …) with their tick timestamps. The log is the save file's source of truth.
- **Seed** — an integer used to initialize the seeded PRNG for any nondeterminism the design wants.
- **Conservation invariant** — at every tick boundary, `total_items_in_world = items_on_belts + items_in_buffers + items_in_inserters`. This count must equal `items_injected_by_sources − items_consumed_by_recipes`.

**Stack:**
- Language: TypeScript (strict mode, no `any`).
- Runtime: Node.js (current LTS).
- Test runner: Vitest (`npm test` runs `vitest run`).
- No canvas/DOM in core modules. The renderer is a separate layer.
- All acceptance tests: pure in-memory, no network, no `Date.now()`, no `Math.random()` (use the seeded PRNG adapter instead).

**Acceptance command (plain steps):**
1. `cd` to the project root.
2. Run `npm test`.
3. All Vitest test suites must pass with exit code 0. No test may call the network, read the filesystem, or use `Date.now()` or `Math.random()`.

**Determinism rules (imperative):**
- Never call `Math.random()` anywhere in `src/`. Use `createSeededPrng(seed)` from `src/core/prng.ts` and pass the instance explicitly.
- Never call `Date.now()` or `performance.now()` anywhere in `src/`. The tick counter in `WorldState.tick` is the only time source.
- Never use `number` arithmetic for positions, speeds, or counts in `src/core/` or `src/sim/`. Use the `Fixed` newtype and its helpers.
- Never use `for...in` over a Map or object for entity-update loops. Always iterate a sorted entity-id array to guarantee stable order.
- The renderer (`src/renderer/`) may use `number` floats and real clocks. It must never write back into `WorldState`.

---

### 2. The explicit task graph for the first vertical slice

The first slice covers F1 (kernel) + F2 (transport-line core) + F3 (tick phases) + one machine + one inserter + one two-step recipe + F4 LP basics + F6 blueprint MVP + F0/F10 replay/save + F8 polished slice view. Target: ~42 cards. Build them in the order below; each card's `dependsOn` must already be green before you start it.

---

**`S01` — Fixed-point newtype and arithmetic helpers**
dependsOn: none
files: `src/core/fixed.ts`, `test/core/fixed.test.ts`
interface:
```ts
export type Fixed = number & { __fixed: true };
export function toFixed(n: number): Fixed;   // floor(n * 256) cast
export function fromFixed(f: Fixed): number; // f / 256
export function addFixed(a: Fixed, b: Fixed): Fixed;
export function subFixed(a: Fixed, b: Fixed): Fixed;
export function mulFixed(a: Fixed, scalar: number): Fixed; // scalar is plain integer
export function clampFixed(f: Fixed, lo: Fixed, hi: Fixed): Fixed;
export const ZERO_FIXED: Fixed;
export const TILE_WIDTH: Fixed;              // = toFixed(1) = 256
export const STANDARD_GAP: Fixed;           // = toFixed(64/256) = 64
export const ITEM_SIZE: Fixed;              // = toFixed(64/256) = 64 (same as standard gap)
```
how to implement:
1. Create `src/core/fixed.ts`.
2. `toFixed(n)` returns `(Math.floor(n * 256)) as Fixed` — this is the only place raw `Math.floor` is allowed; it converts design-space units to fixed-point.
3. Implement `addFixed`, `subFixed` as simple integer add/sub cast back to `Fixed`.
4. `mulFixed(a, scalar)` = `(a * scalar) as Fixed` — scalar must be a plain integer constant, never a float.
5. `clampFixed` clamps between lo and hi.
6. Export named constants.
7. Create `test/core/fixed.test.ts`.
acceptance: `test/core/fixed.test.ts` asserts:
- `toFixed(1) === 256`
- `addFixed(toFixed(0.5), toFixed(0.5)) === toFixed(1)` (i.e. `128 + 128 === 256`)
- `subFixed(toFixed(1), toFixed(0.25)) === 192`
- `mulFixed(toFixed(1), 3) === 768`
- `clampFixed(toFixed(2), toFixed(0), toFixed(1)) === toFixed(1)`
- `STANDARD_GAP === 64`
Run `npm test` → green.

---

**`S02` — Seeded PRNG**
dependsOn: none
files: `src/core/prng.ts`, `test/core/prng.test.ts`
interface:
```ts
export interface SeededPrng { next(): number; nextInt(lo: number, hi: number): number; }
export function createSeededPrng(seed: number): SeededPrng;
```
how to implement:
1. Use a simple xorshift32 or mulberry32 algorithm — single 32-bit state, no dependencies.
2. `next()` returns a float in [0,1).
3. `nextInt(lo, hi)` returns `Math.floor(lo + prng.next() * (hi - lo + 1))`.
4. Do NOT use `Math.random()` anywhere in this file.
acceptance: `test/core/prng.test.ts` asserts:
- Two `createSeededPrng(42)` instances produce identical sequences for 10 calls each.
- `createSeededPrng(1).nextInt(0, 9)` is in [0,9] for 20 calls (no out-of-range).
- `createSeededPrng(0).next() !== createSeededPrng(1).next()` (different seeds differ).
Run `npm test` → green.

---

**`S03` — World state type and clock**
dependsOn: `S01`, `S02`
files: `src/core/world.ts`, `test/core/world.test.ts`
interface:
```ts
export interface WorldState {
  tick: number;                         // monotonically-increasing integer tick counter
  seed: number;
  entities: Map<number, Entity>;        // entityId → Entity
  nextEntityId: number;
  transportLines: Map<number, TransportLine>; // lineId → TransportLine
  nextLineId: number;
}
export type Entity = BeltEntity | MachineEntity | InserterEntity; // union expanded in later cards
export interface BeltEntity { kind: 'belt'; id: number; /* fields added in S06 */ }
export interface MachineEntity { kind: 'machine'; id: number; /* fields added in S09 */ }
export interface InserterEntity { kind: 'inserter'; id: number; /* fields added in S10 */ }
export interface TransportLine { id: number; /* fields added in S07 */ }
export function createWorld(seed: number): WorldState;
export function advanceTick(world: WorldState): void; // increments world.tick by 1 (logic added in S14)
```
how to implement:
1. Create `src/core/world.ts` with the interfaces and `createWorld` factory (initializes empty maps, tick = 0).
2. `advanceTick` for now just does `world.tick++`; the phase logic is wired in S14.
3. Export all types.
acceptance: `test/core/world.test.ts` asserts:
- `createWorld(42).tick === 0`
- `createWorld(42).seed === 42`
- After `advanceTick(w)`, `w.tick === 1`; after 100 calls, `w.tick === 100`.
Run `npm test` → green.

---

**`S04` — World-state hash (determinism canary)**
dependsOn: `S03`
files: `src/core/hash.ts`, `test/core/hash.test.ts`
interface:
```ts
export function hashWorldState(world: WorldState): string; // deterministic hex string
```
how to implement:
1. Serialize the world to a stable JSON string (sort Map entries by key before serializing — use `JSON.stringify` with a replacer that converts Maps to sorted arrays).
2. Hash the JSON string with a simple djb2 or FNV-1a algorithm (no crypto dependency; implement inline in ~10 lines).
3. Return the hex string.
4. Do NOT use `Date.now()` or `Math.random()` anywhere.
acceptance: `test/core/hash.test.ts` asserts:
- Two `createWorld(1)` instances that undergo identical `advanceTick` sequences produce identical hashes.
- A world at tick 0 and a world at tick 1 produce different hashes.
- Calling `hashWorldState` twice on the same unmodified world returns the same string.
Run `npm test` → green.

---

**`S05` — Command log record and replay skeleton**
dependsOn: `S03`
files: `src/core/command-log.ts`, `test/core/command-log.test.ts`
interface:
```ts
export type GameCommand =
  | { kind: 'PlaceBelt'; tick: number; entityId: number; x: number; y: number; direction: Direction }
  | { kind: 'PlaceMachine'; tick: number; entityId: number; x: number; y: number; recipeId: string }
  | { kind: 'PlaceInserter'; tick: number; entityId: number; x: number; y: number; direction: Direction }
  | { kind: 'SetRecipe'; tick: number; entityId: number; recipeId: string };
export type Direction = 'N' | 'E' | 'S' | 'W';
export interface CommandLog { commands: GameCommand[]; seed: number; }
export function createCommandLog(seed: number): CommandLog;
export function appendCommand(log: CommandLog, cmd: GameCommand): void;
export function replayCommandLog(log: CommandLog, totalTicks: number, applyCommand: (w: WorldState, cmd: GameCommand) => void): WorldState;
```
how to implement:
1. `createCommandLog` returns `{ commands: [], seed }`.
2. `appendCommand` pushes to the array.
3. `replayCommandLog`: create a fresh world with `createWorld(log.seed)`, then loop ticks 0…totalTicks-1; before each `advanceTick`, apply all commands whose `tick` field equals the current tick via `applyCommand`.
4. Return the final world state.
acceptance: `test/core/command-log.test.ts` asserts:
- An empty log replayed for 10 ticks produces `world.tick === 10`.
- Two replays of the same log reach identical `hashWorldState` output.
Run `npm test` → green.

---

**`S06` — Belt entity type and grid placement**
dependsOn: `S03`, `S01`
files: `src/core/belt.ts`, `test/core/belt.test.ts`
interface:
```ts
export interface BeltEntity {
  kind: 'belt';
  id: number;
  x: number; y: number;        // tile-grid coordinates (integers)
  direction: Direction;
  tier: BeltTier;
  lineId: number | null;       // assigned when transport lines are built (S07)
}
export type BeltTier = 'standard' | 'fast' | 'express';
export function beltSpeedForTier(tier: BeltTier): Fixed; // 8, 16, or 24 as Fixed
export function placeBelt(world: WorldState, id: number, x: number, y: number, dir: Direction, tier: BeltTier): BeltEntity;
```
how to implement:
1. Create `src/core/belt.ts`.
2. `beltSpeedForTier`: return `toFixed(8)`, `toFixed(16)`, or `toFixed(24)` based on tier — these are integer-valued Fixed numbers (8, 16, 24 in 256-unit space; note: actually the speeds are positions per tick, NOT tiles per tick; 8 pos/tick means 8/256 tile/tick = 1/32 tile/tick ≈ 1.875 tiles/s at 60 ticks/s — document this in a comment).
3. `placeBelt`: create a `BeltEntity`, insert into `world.entities`, return it.
acceptance: `test/core/belt.test.ts` asserts:
- `beltSpeedForTier('standard') === 8` (as the raw integer, since `toFixed(8/256 * 256) === 8` — i.e. the raw Fixed integer value for standard speed is 8).

Wait — re-derive: belt speed in Factorio is 8 positions/tick on a 256-position tile. `toFixed` converts design-space tiles to fixed-point by multiplying by 256. But speed is already in positions/tick, not tiles, so speed constants are just plain integers stored as `Fixed`. So `beltSpeedForTier('standard') === 8 as Fixed`.

- `placeBelt` inserts into `world.entities` and returns an entity with correct fields.
- Two placements get different ids when `world.nextEntityId` is incremented each time.
Run `npm test` → green.

---

**`S07` — Transport-line gap-list model**
dependsOn: `S06`
files: `src/core/transport-line.ts`, `test/core/transport-line.test.ts`
interface:
```ts
export interface TransportLineItem { itemId: string; gapToNext: Fixed; }
export interface TransportLine {
  id: number;
  beltIds: number[];              // ordered belt entity ids (head → tail)
  items: TransportLineItem[];     // ordered head → tail; gapToNext = distance to item ahead
  headGap: Fixed;                 // gap from the head-of-line to the first item
  blocked: boolean;               // true when output end is blocked
}
export function createTransportLine(id: number, beltIds: number[]): TransportLine;
export function advanceTransportLine(line: TransportLine, speed: Fixed): void;
export function tryInsertItemAtTail(line: TransportLine, itemId: string): boolean;
export function tryExtractItemFromHead(line: TransportLine): string | null;
export function countItemsOnLine(line: TransportLine): number;
```
how to implement:
1. `createTransportLine`: empty items array, headGap = total-line-length (all gaps at max), blocked = false.
2. `advanceTransportLine(line, speed)`: if `line.blocked`, decrement the last non-zero `gapToNext` by speed (clamped at 0); if not blocked, decrement `headGap` by speed (clamped at 0) — this is the O(1) unblocked advance; items do not move individually.
3. `tryInsertItemAtTail`: if the last gap ≥ `STANDARD_GAP + ITEM_SIZE`, push `{ itemId, gapToNext: STANDARD_GAP }` to items and subtract from tail gap; return true. Else return false.
4. `tryExtractItemFromHead`: if `headGap === 0` and items is non-empty, shift the first item, add its `gapToNext` back to headGap, return itemId. Else return null.
5. `countItemsOnLine`: `line.items.length`.
acceptance: `test/core/transport-line.test.ts` asserts:
- A new line has 0 items.
- Insert 4 items; `countItemsOnLine === 4`.
- Advance enough ticks to deliver first item; `tryExtractItemFromHead` returns the correct itemId.
- After inserting and extracting, item count conserved (0 net change across insert+extract sequence).
- `tryInsertItemAtTail` returns false when line is full (gapToNext of last item < STANDARD_GAP + ITEM_SIZE).
Run `npm test` → green.

---

**`S08` — Tick-phase schedule constant**
dependsOn: `S03`
files: `src/core/tick-phases.ts`, `test/core/tick-phases.test.ts`
interface:
```ts
export const TICK_PHASES = ['fluids', 'machine-consume', 'machine-emit', 'inserters', 'transport-lines', 'sinks'] as const;
export type TickPhase = typeof TICK_PHASES[number];
export function assertTickPhaseOrder(phases: readonly TickPhase[]): void; // throws if order differs from TICK_PHASES
```
how to implement:
1. Create `src/core/tick-phases.ts` with the constant tuple and the assertion function.
2. `assertTickPhaseOrder` checks array equality and throws `Error('Phase order violation')` if mismatched.
acceptance: `test/core/tick-phases.test.ts` asserts:
- `TICK_PHASES` has exactly 6 elements in the documented order.
- `assertTickPhaseOrder(TICK_PHASES)` does not throw.
- `assertTickPhaseOrder(['transport-lines', 'fluids', ...])` throws.
Run `npm test` → green.

---

**`S09` — Machine entity type and recipe registry**
dependsOn: `S03`, `S01`
files: `src/core/recipe.ts`, `src/core/machine.ts`, `test/core/machine.test.ts`
interface:
```ts
// recipe.ts
export interface RecipeSpec {
  id: string;
  inputs: { itemId: string; qty: number }[];
  outputs: { itemId: string; qty: number }[];
  craftTicks: number;
}
export interface RecipeRegistry { recipes: Map<string, RecipeSpec>; }
export function createRecipeRegistry(): RecipeRegistry;
export function registerRecipe(reg: RecipeRegistry, spec: RecipeSpec): void;
export function lookupRecipe(reg: RecipeRegistry, id: string): RecipeSpec;

// machine.ts
export interface MachineEntity {
  kind: 'machine';
  id: number;
  x: number; y: number;
  recipeId: string | null;
  inputBuffer: Map<string, number>;   // itemId → qty
  outputBuffer: Map<string, number>;  // itemId → qty
  craftProgress: number;              // 0..recipe.craftTicks; 0 = idle
  crafting: boolean;
}
export function placeMachine(world: WorldState, id: number, x: number, y: number): MachineEntity;
export function machineTick_consume(machine: MachineEntity, reg: RecipeRegistry): void; // phase 2
export function machineTick_emit(machine: MachineEntity, reg: RecipeRegistry): void;    // phase 3
```
how to implement:
1. `createRecipeRegistry`: empty Map.
2. `registerRecipe`: insert into map.
3. `lookupRecipe`: get from map, throw if missing.
4. `machineTick_consume`: if not crafting and recipeId set and all inputs available in inputBuffer, deduct inputs, set `crafting = true`, `craftProgress = recipe.craftTicks`.
5. `machineTick_emit`: if crafting, decrement `craftProgress`; when it reaches 0, add outputs to `outputBuffer`, set `crafting = false`.
acceptance: `test/core/machine.test.ts` asserts:
- A machine with recipe `{ id:'r1', inputs:[{itemId:'iron',qty:1}], outputs:[{itemId:'gear',qty:1}], craftTicks:5 }` starts idle.
- Add 1 iron to inputBuffer; call `machineTick_consume` → `crafting === true`, iron removed from inputBuffer.
- Call `machineTick_emit` 5 times → `crafting === false`, 1 gear in outputBuffer.
- Calling `machineTick_consume` again with no iron leaves `crafting === false`.
Run `npm test` → green.

---

**`S10` — Inserter entity type and swing logic**
dependsOn: `S09`, `S07`
files: `src/core/inserter.ts`, `test/core/inserter.test.ts`
interface:
```ts
export const INSERTER_SWING_TICKS = 13; // fixed balance constant; documented as designer-tunable
export interface InserterEntity {
  kind: 'inserter';
  id: number;
  x: number; y: number;
  direction: Direction;                // pickup side
  heldItem: string | null;
  swingProgress: number;               // 0..INSERTER_SWING_TICKS; 0 = ready
  swingPhase: 'pickup' | 'dropoff' | 'idle';
  sourceLineId: number | null;         // transport line to pick from
  targetMachineId: number | null;      // machine to drop into
}
export function placeInserter(world: WorldState, id: number, x: number, y: number, dir: Direction): InserterEntity;
export function inserterTick(inserter: InserterEntity, lines: Map<number, TransportLine>, machines: Map<number, MachineEntity>): void;
```
how to implement:
1. `inserterTick`: if `swingPhase === 'idle'`, check source line; if item available at head, enter `swingPhase = 'pickup'`, `swingProgress = INSERTER_SWING_TICKS`.
2. If `swingPhase === 'pickup'`, decrement `swingProgress`; when 0, call `tryExtractItemFromHead` on source line, set `heldItem`, enter `swingPhase = 'dropoff'`, reset `swingProgress = INSERTER_SWING_TICKS`.
3. If `swingPhase === 'dropoff'`, decrement; when 0, add `heldItem` to target machine's `inputBuffer`, clear `heldItem`, enter `swingPhase = 'idle'`.
4. An inserter with `sourceLineId = null` or `targetMachineId = null` stays idle.
acceptance: `test/core/inserter.test.ts` asserts:
- Create a minimal line with one item at head; create a machine; create an inserter linking them.
- Advance `inserterTick` for `2 * INSERTER_SWING_TICKS` ticks; assert machine inputBuffer has 1 iron.
- The transport line's item count decreased by 1 (conservation).
Run `npm test` → green.

---

**`S11` — Two-step recipe fixture (ore → plate → gear)**
dependsOn: `S09`
files: `src/fixtures/recipes/two-step.ts`, `test/fixtures/two-step-recipe.test.ts`
interface:
```ts
// Registers two recipes into a given registry:
//   smelter: { id: 'smelt-iron', inputs: [{itemId:'iron-ore', qty:2}], outputs: [{itemId:'iron-plate', qty:1}], craftTicks: 10 }
//   assembler: { id: 'make-gear', inputs: [{itemId:'iron-plate', qty:2}], outputs: [{itemId:'gear', qty:1}], craftTicks: 8 }
export function registerTwoStepRecipes(reg: RecipeRegistry): void;
```
how to implement:
1. Create `src/fixtures/recipes/two-step.ts`.
2. Call `registerRecipe` twice with the specs above.
acceptance: `test/fixtures/two-step-recipe.test.ts` asserts:
- After `registerTwoStepRecipes(reg)`, `lookupRecipe(reg, 'smelt-iron').craftTicks === 10`.
- `lookupRecipe(reg, 'make-gear').inputs[0].itemId === 'iron-plate'`.
Run `npm test` → green.

---

**`S12` — Item conservation property test**
dependsOn: `S07`, `S10`, `S11`
files: `test/core/conservation.test.ts`
interface: (test only, no new src files)
how to implement:
1. Build a minimal world: one transport line with 3 iron-ore items, one smelter machine wired to an inserter sourcing from the line.
2. Advance 200 ticks via `advanceTick` (calling phase 2, 3, 4, 5 manually in order for now; the full `advanceTick` integration is S14).
3. After each tick, assert: `items_on_lines + items_in_inserter_hands + items_in_machine_buffers === 3` (no item created or destroyed).
acceptance: `test/core/conservation.test.ts` — all 200 tick assertions pass. Run `npm test` → green.

---

**`S13` — Splitter entity and backpressure fixture**
dependsOn: `S07`
files: `src/core/splitter.ts`, `test/core/splitter.test.ts`
interface:
```ts
export interface SplitterEntity {
  kind: 'splitter';
  id: number;
  x: number; y: number;
  direction: Direction;
  inputLineId: number;
  outputLineIds: [number, number];   // [left, right]
  alternator: 0 | 1;                // which output gets the next item
}
export function splitterTick(splitter: SplitterEntity, lines: Map<number, TransportLine>): void;
```
how to implement:
1. `splitterTick`: attempt `tryExtractItemFromHead` on `inputLineId`; if an item arrives, try `tryInsertItemAtTail` on `outputLineIds[alternator]`; if insertion succeeds, flip `alternator`; if it fails (output backed up), try the other output; if both fail, put item back (re-insert at head — or mark blocked).
2. Use the stable id-order as the tie-breaker when both outputs are available — output 0 takes priority before alternation.
acceptance: `test/core/splitter.test.ts` asserts:
- Feed 10 items into a splitter with two unblocked outputs; each output receives exactly 5 items (conservation + fair split).
- Block one output; assert all items route to the other output (backpressure); item count conserved.
Run `npm test` → green.

---

**`S14` — Full phased advanceTick wiring**
dependsOn: `S08`, `S09`, `S10`, `S13`
files: `src/core/tick.ts`, `test/core/tick-order.test.ts`
interface:
```ts
export function runTick(world: WorldState, reg: RecipeRegistry): void;
// Executes all 6 phases in TICK_PHASES order, then increments world.tick.
```
how to implement:
1. Create `src/core/tick.ts`.
2. Phase 1 (fluids): no-op stub (fluids not in slice; log a comment).
3. Phase 2 (machine-consume): iterate `world.entities` in ascending entity-id order; for each `MachineEntity`, call `machineTick_consume`.
4. Phase 3 (machine-emit): same iteration, call `machineTick_emit`.
5. Phase 4 (inserters): iterate ascending id, call `inserterTick`.
6. Phase 5 (transport-lines): iterate `world.transportLines` ascending id; for each line, call `advanceTransportLine` with the speed of the first belt in the line; then for each `SplitterEntity`, call `splitterTick`.
7. Phase 6 (sinks): no-op stub.
8. Increment `world.tick`.
9. Replace the stub in `world.ts`'s `advanceTick` with a call to `runTick`.
acceptance: `test/core/tick-order.test.ts` asserts:
- Run the S12 scenario through `advanceTick` (now using `runTick`); item conservation holds for 200 ticks.
- A "phase-order pinning" test: place two inserters A (id=1) and B (id=2) competing for the same belt slot; assert A always wins (lower id = higher priority) by golden throughput number over 60 ticks.
Run `npm test` → green.

---

**`S15` — LP production-ratio analyzer (F4 MVP)**
dependsOn: `S11`
files: `src/core/lp-analyzer.ts`, `test/core/lp-analyzer.test.ts`
interface:
```ts
export interface LpSolution {
  recipeRates: Map<string, number>;    // recipeId → runs per second (float, for display only)
  assemblerCounts: Map<string, number>; // recipeId → assemblers needed (ceiling)
  bottleneckRecipeId: string | null;   // recipe with highest resource load
}
export function solveProductionRatio(
  reg: RecipeRegistry,
  targetOutputs: { itemId: string; qty: number }[],   // desired net output per second
): LpSolution;
```
how to implement:
1. For this MVP, implement a simplified sequential solver (not a full LP library): for each recipe in topological order, compute the run-rate needed to satisfy the target output, then propagate input requirements to upstream recipes.
2. `assemblerCounts`: `ceil(rate / perAssemblerRate)` where `perAssemblerRate = recipe.outputs[0].qty / (recipe.craftTicks / 60)`.
3. `bottleneckRecipeId`: the recipe whose assembler count is highest relative to the others.
4. Note: cyclic recipes are not handled in the MVP (mark as `KNOWLEDGE_DEBT: cyclic recipes require full LP solver`).
acceptance: `test/core/lp-analyzer.test.ts` asserts:
- For the two-step fixture targeting 1 gear/s: `smelt-iron` rate > 0, `make-gear` rate > 0.
- `assemblerCounts.get('smelt-iron')` ≥ 1.
- Result is deterministic (same inputs → same output, no randomness).
Run `npm test` → green.

---

**`S16` — Blueprint canonical form and hashing**
dependsOn: `S01`, `S06`
files: `src/core/blueprint.ts`, `test/core/blueprint.test.ts`
interface:
```ts
export interface BlueprintEntity {
  kind: 'belt' | 'machine' | 'inserter' | 'splitter';
  relX: number; relY: number;   // position relative to blueprint origin (integers)
  direction: Direction;
  tier?: BeltTier;
  recipeId?: string;
}
export interface Blueprint {
  entities: BlueprintEntity[];
  canonicalHash: string;
}
export function createBlueprint(entities: BlueprintEntity[]): Blueprint;
// Normalizes: translate so min(relX)=0, min(relY)=0; sort entities by (relX, relY, kind, direction); hash.
export function rotateBlueprint(bp: Blueprint, quarterTurns: 1 | 2 | 3): Blueprint;
export function blueprintsEqual(a: Blueprint, b: Blueprint): boolean; // compares canonicalHash
export function validateBlueprintPlacement(bp: Blueprint, occupiedTiles: Set<string>): { valid: boolean; invalidCells: {x:number,y:number}[] };
```
how to implement:
1. `createBlueprint`: normalize origin (shift all coords so min is 0,0), sort entities, JSON-hash (same djb2/FNV-1a as S04).
2. `rotateBlueprint(bp, n)`: apply n × 90° rotation to each entity's `relX, relY, direction`; then re-canonicalize.
3. Direction rotation: `N→E→S→W→N` for 1 quarter-turn clockwise.
4. `validateBlueprintPlacement`: for each entity at `(originX + relX, originY + relY)`, check if `"x,y"` is in occupiedTiles.
acceptance: `test/core/blueprint.test.ts` asserts:
- Two blueprints with the same entities in different input order have the same `canonicalHash`.
- `rotateBlueprint(bp, 4)` (4 × 90°) has same hash as original.
- `blueprintsEqual(rotateBlueprint(bp,1), rotateBlueprint(bp,1))` is true.
- `validateBlueprintPlacement` returns invalid for tiles in occupiedTiles.
Run `npm test` → green.

---

**`S17` — Golden blueprint fixtures (F6)**
dependsOn: `S16`
files: `src/fixtures/blueprints/smelter-line.ts`, `test/fixtures/blueprint-golden.test.ts`
interface:
```ts
// A hand-coded 3-belt, 1-machine, 1-inserter blueprint for the smelter-line scenario
export const SMELTER_LINE_BLUEPRINT: Blueprint;
```
how to implement:
1. Define `SMELTER_LINE_BLUEPRINT` as a `createBlueprint(...)` call with hardcoded entities — 3 standard belts in a row, 1 machine at tile (1,1), 1 inserter at (1,0) pointing S.
2. Commit the `canonicalHash` as a golden constant in the test.
acceptance: `test/fixtures/blueprint-golden.test.ts` asserts:
- `SMELTER_LINE_BLUEPRINT.canonicalHash === '<the golden hash computed once and hardcoded>'`.
- `blueprintsEqual(rotateBlueprint(SMELTER_LINE_BLUEPRINT, 2), rotateBlueprint(SMELTER_LINE_BLUEPRINT, 2))` is true.
Run `npm test` → green.

---

**`S18` — Replay/save end-to-end test (F0)**
dependsOn: `S05`, `S14`, `S15`, `S16`
files: `test/core/replay.test.ts`
interface: (test only)
how to implement:
1. Build a 60-tick scenario in a command log: place 2 belts + 1 machine + 1 inserter; start recipe `smelt-iron`; inject 10 iron-ore items into the line.
2. Replay twice via `replayCommandLog`; assert `hashWorldState` at tick 60 is identical for both replays.
3. Assert item conservation at tick 60: total items across world = items injected − items consumed by completed recipes.
acceptance: `test/core/replay.test.ts` — all assertions pass.
Run `npm test` → green.

---

**`S19` — Conservation property test (F10 invariant 1)**
dependsOn: `S14`, `S13`
files: `test/core/conservation-property.test.ts`
interface: (test only)
how to implement:
1. Run a 500-tick randomized scenario (using the seeded PRNG, not `Math.random()`): randomly insert/extract items, run machines, run splitter. Seed = 12345.
2. After every tick, assert: `items_on_all_lines + items_held_by_inserters + items_in_machine_buffers === initial_item_count + items_injected − items_consumed`.
acceptance: All 500 assertions pass. Run `npm test` → green.

---

**`S20` — Determinism canary test (F10 invariant 2)**
dependsOn: `S18`
files: `test/core/determinism.test.ts`
interface: (test only)
how to implement:
1. Replay the same 200-tick command log three times on fresh worlds; collect `hashWorldState` at ticks 50, 100, 150, 200.
2. Assert all three runs produce identical hashes at every checkpoint.
acceptance: All 12 assertions (3 runs × 4 checkpoints) pass. Run `npm test` → green.

---

**`S21` — Compression-trap fixture (F9)**
dependsOn: `S07`, `S14`
files: `test/core/compression-trap.test.ts`
interface: (test only)
how to implement:
1. Fill a transport line to full compression (4 items, all gaps = 0).
2. Block the output for 10 ticks (set `line.blocked = true`); assert item count unchanged.
3. Unblock; drain all items from the head over subsequent ticks.
4. Assert all 4 items extracted and line is empty (no duplication, no loss).
acceptance: All assertions pass. Run `npm test` → green.

---

**`S22` — Splitter backpressure race fixture (F9)**
dependsOn: `S13`, `S14`
files: `test/core/splitter-backpressure.test.ts`
interface: (test only)
how to implement:
1. Create a splitter with two output lines; block one output at tick 30.
2. Feed 20 items over 60 ticks.
3. Assert: items on both outputs together = items fed (conservation); after block, items only go to open output.
acceptance: All assertions pass. Run `npm test` → green.

---

**`S23` — Renderer abstraction boundary**
dependsOn: `S14`
files: `src/renderer/render-types.ts`, `test/renderer/render-boundary.test.ts`
interface:
```ts
// A pure snapshot the renderer reads; never written by the renderer
export interface RenderSnapshot {
  tick: number;
  belts: { id: number; x: number; y: number; direction: Direction; tier: BeltTier; itemsAtPositions: { relPos: number; itemId: string }[] }[];
  machines: { id: number; x: number; y: number; crafting: boolean; progress: number }[];
  inserters: { id: number; x: number; y: number; heldItem: string | null; swingPhase: 'pickup'|'dropoff'|'idle' }[];
}
export function buildRenderSnapshot(world: WorldState): RenderSnapshot;
```
how to implement:
1. `buildRenderSnapshot` reads `world.entities` and `world.transportLines`; converts Fixed positions to plain numbers (float); returns a plain object. It must NOT mutate `world`.
2. `buildRenderSnapshot` may use `fromFixed` to convert positions for the renderer.
acceptance: `test/renderer/render-boundary.test.ts` asserts:
- `buildRenderSnapshot(world)` on a world with 2 belts + 1 machine returns correct entity counts.
- Calling it twice on an unmodified world returns deeply-equal results.
- It does not throw.
Run `npm test` → green.

---

**`S24` — Polished slice view scaffold (F8)**
dependsOn: `S23`
files: `src/renderer/canvas-renderer.ts`, `src/renderer/interpolation.ts`, `test/renderer/interpolation.test.ts`
interface:
```ts
// interpolation.ts
export function interpolateSnapshot(prev: RenderSnapshot, next: RenderSnapshot, alpha: number): RenderSnapshot;
// For each item's relPos, lerp between prev and next. alpha in [0,1].

// canvas-renderer.ts (skeleton — full animation is stretch; must not throw)
export interface CanvasRenderer { drawFrame(snapshot: RenderSnapshot, canvas: HTMLCanvasElement): void; }
export function createCanvasRenderer(): CanvasRenderer;
```
how to implement:
1. `interpolateSnapshot`: for each belt's items, linearly interpolate `relPos` between prev and next snapshots at `alpha`. Tick and ids copy from `next`.
2. `createCanvasRenderer`: returns an object with `drawFrame` that calls `canvas.getContext('2d')` and draws colored rectangles for belts, items, and machines. Items are colored circles. Machines are colored squares. This is a minimal but non-empty visual — not a letter grid.
3. Do NOT call `requestAnimationFrame` or any clock inside `createCanvasRenderer`. The caller drives the animation loop.
acceptance: `test/renderer/interpolation.test.ts` asserts:
- `interpolateSnapshot(snap0, snap1, 0)` item positions match snap0.
- `interpolateSnapshot(snap0, snap1, 1)` item positions match snap1.
- `interpolateSnapshot(snap0, snap1, 0.5)` positions are midpoint.
Run `npm test` → green. (The canvas drawing is untested in unit tests; the visual check is manual/Playwright.)

---

**`S25` — Full slice integration test (F11 green gate)**
dependsOn: `S14`, `S18`, `S19`, `S20`, `S21`, `S22`, `S24`
files: `test/integration/slice.test.ts`
interface: (test only)
how to implement:
1. Build a complete smelter-line world: 4 standard belts → inserter → smelter → 1 belt out; inject 20 iron-ore over 120 ticks.
2. Assert after 120 ticks: ≥ 5 gears produced (throughput lower-bound; exact number is deterministic and must be golden-locked once computed).
3. Assert conservation invariant at every tick (include this loop).
4. Assert two replays reach identical hash.
5. Assert LP ratio result for 1 gear/s scenario is non-null.
acceptance: All assertions pass. Run `npm test` → green.

---

### 3. The decomposition method for the rest

After the first slice is green, use this recipe to expand remaining features (F5 fluids, F6 full blueprint system, F7 contracts, F8 full presentation, F9 remaining fixtures, all machine types) into the same card shape.

**Repeatable decomposition recipe:**
1. Name the feature in one sentence. Identify which first-slice types it builds on.
2. List the pure data types / interfaces it introduces (write the TypeScript types out fully).
3. List any invariants it must preserve (usually conservation + determinism).
4. Break it into 2–5 focused cards: type definitions first, pure logic second, integration/wiring third, acceptance test fourth.
5. For each card: fill in id, title, dependsOn, files, interface, recipe steps, and acceptance test.
6. Ensure no card is more than ~100 lines of new production code.

**Worked example A — Fluid pipe network (F5):**
- Card `F501` — `PipeSegment` type: fluid amount (Fixed), max capacity (Fixed), connected segment ids. files: `src/core/fluid.ts`. Accept: type-checks, no logic yet.
- Card `F502` — Equalization step: `equalizeSegment(seg, neighbors)` redistributes fluid evenly among connected segments in one fixed-point step, using ascending segment-id iteration order. files: `src/core/fluid.ts`. Accept: 2 connected segments with 100+0 fluid equalize to 50+50 in one step (fixed-point arithmetic, no float).
- Card `F503` — Fluid phase integration: call equalization for all segments in phase 1 of `runTick`. files: `src/core/tick.ts`. Accept: conservation: total fluid across all segments is invariant after equalization.
- Card `F504` — Byproduct-backup fixture: a recipe that emits fluid; a tank that fills; assert upstream machine stalls when tank is full. files: `test/core/fluid-backup.test.ts`. Accept: deterministic stall at correct tick, conservation holds.

**Worked example B — Contract scoring (F7):**
- Card `C701` — `ContractSpec` type: `{ id, throughputGoalPerSecond: number, powerBudget: Fixed, wasteLimitPerTick: number, scoreTiers: { threshold: number, label: string }[] }`. files: `src/core/contract.ts`. Accept: type-checks.
- Card `C702` — `evaluateContract(spec, runLog: TickSample[])`: pure function, no I/O. Computes throughput average, power peak, waste sum; returns `{ score: number, tier: string }`. files: `src/core/contract.ts`. Accept: two deterministic scenarios reach known scores.
- Card `C703` — Replay-stable scoring: run same command log twice; assert contract scores are identical. files: `test/core/contract-replay.test.ts`. Accept: identical.

**Worked example C — Underground belt pair (F2 extension):**
- Card `U201` — `UndergroundBelt` entity type: `direction`, `layer: 'input'|'output'`, `pairedId: number | null`. files: `src/core/underground.ts`. Accept: type-checks.
- Card `U202` — Pairing logic: `pairUndergroundBelts(world)` scans all underground entities and sets `pairedId` by proximity and direction matching. files: `src/core/underground.ts`. Accept: two correctly-placed underground belts pair; incorrectly-placed do not.
- Card `U203` — Transport-line split at underground boundary: placing an underground belt splits the transport line; removing it merges. Assert conservation at split and merge. files: `test/core/underground.test.ts`. Accept: item count conserved across split/merge.

---

### 4. Per-task implementation conventions

**Folder layout:**
```
src/
  core/          # pure simulation logic; no DOM, no canvas, no network
    fixed.ts     # Fixed newtype
    prng.ts      # seeded PRNG
    world.ts     # WorldState
    hash.ts      # world-state hash
    command-log.ts
    tick.ts      # runTick / phased dispatcher
    tick-phases.ts
    belt.ts
    transport-line.ts
    machine.ts
    recipe.ts
    inserter.ts
    splitter.ts
    blueprint.ts
    lp-analyzer.ts
  renderer/      # view layer; may use floats and real clocks; never writes WorldState
    render-types.ts
    interpolation.ts
    canvas-renderer.ts
  fixtures/      # golden data; no logic
    recipes/
    blueprints/
test/
  core/          # mirrors src/core
  renderer/      # mirrors src/renderer
  fixtures/
  integration/
```

**Naming conventions:**
- Types: PascalCase (`TransportLine`, `BeltEntity`).
- Pure functions: camelCase verb-noun (`advanceTransportLine`, `tryInsertItemAtTail`).
- Test files: mirror the source file name, `.test.ts` suffix.
- Constants: SCREAMING_SNAKE_CASE (`STANDARD_GAP`, `INSERTER_SWING_TICKS`).

**How to write a test in this stack (Vitest):**
```ts
// test/core/fixed.test.ts
import { describe, it, expect } from 'vitest';
import { toFixed, addFixed, STANDARD_GAP } from '../../src/core/fixed.js';

describe('fixed-point arithmetic', () => {
  it('adds two fixed values', () => {
    expect(addFixed(toFixed(0.5), toFixed(0.5))).toBe(toFixed(1));
  });
  it('standard gap is 64', () => {
    expect(STANDARD_GAP).toBe(64);
  });
});
```

**How to keep it deterministic:**
- Replace every `Math.random()` call with `prng.next()` where the PRNG instance is threaded explicitly.
- Replace every `Date.now()` / timer with `world.tick`.
- Sort Map entries by key before hashing or iterating for update order.
- Use integer arithmetic throughout `src/core/`; convert to float only in `src/renderer/`.

**How to wire a fixture adapter:**
```ts
// Example: fixture PRNG adapter for tests
const fixturePrng = createSeededPrng(42); // deterministic seed
const world = createWorld(42);
// inject items via direct API, not via network or file I/O
world.transportLines.get(lineId)!.items.push({ itemId: 'iron-ore', gapToNext: STANDARD_GAP });
```

**Definition of done for any card:**
- The files listed in `files` exist and compile with `tsc --noEmit`.
- The tests listed in `acceptance` pass under `npm test`.
- No new `Math.random()`, `Date.now()`, or `any` is introduced in `src/core/` or `src/sim/`.
- No I/O (network, filesystem read) in any test.
- The conservation invariant (items-in === items-out) is still passing after integration.

---

### 5. Common pitfalls for a weak model on this project

**Pitfall 1 — Using raw `number` for fixed-point positions.**
A 3B model will write `belt.position += speed` using plain numbers and then wonder why the replay diverges. The fix: the `Fixed` newtype (S01) is branded so TypeScript rejects `Fixed + number` without an explicit cast. If a type error appears at a `+` or `-` between a `Fixed` and a raw `number`, use `addFixed`/`subFixed` — never cast away the brand to fix the error.

**Pitfall 2 — Calling `Math.random()` instead of the seeded PRNG.**
A weak model will reach for `Math.random()` when it needs any stochastic behavior. The acceptance tests import the seeded PRNG and assert identical output across two runs with the same seed — this catches the mistake immediately. The rule: `Math.random` is banned in `src/`; ESLint or a grep in CI can enforce it.

**Pitfall 3 — Iterating a Map in insertion order and assuming it is stable.**
JavaScript Maps iterate in insertion order, but if entities are ever deleted and re-inserted, the order changes. Always collect entity ids into a sorted array before the phase loop: `const ids = [...world.entities.keys()].sort((a,b)=>a-b)`. Forgetting this causes the "phase-order pinning" test (S14) to fail intermittently.

**Pitfall 4 — Moving items individually instead of using the gap-list advance.**
A 3B model will write a loop that moves each item's absolute position every tick — this is O(N) per tick and breaks the compression-trap fixture (S21) because the O(1) blocked-line rule is not respected. The correct model (S07): only the head gap or the last non-zero gap changes each tick; items have no absolute position, only a relative gap to the item ahead.

**Pitfall 5 — Same-tick double-move (the "free teleport" bug).**
If the inserter phase (4) extracts an item from a transport line and the transport-line phase (5) then also advances that same item forward in the same tick, the item teleports. The phase ordering (S08, S14) prevents this: inserters run before transport-line advancement. Never swap phases 4 and 5 "for convenience."

**Pitfall 6 — Forgetting to re-canonicalize after blueprint rotation.**
A 3B model will rotate entity positions but skip the normalization step (shift origin back to 0,0), producing a blueprint whose origin is at a negative coordinate. The blueprint test `rotate⁴ == identity` (S16) catches this. Always call `createBlueprint` on the rotated entity list to re-canonicalize.

**Pitfall 7 — LP solver assuming acyclic recipe graph.**
The `solveProductionRatio` MVP (S15) uses a topological-order traversal that silently loops forever on cyclic recipes (oil cracking, recycling). The card explicitly marks this as `KNOWLEDGE_DEBT`. Do not attempt to handle cyclic recipes in the MVP; just throw a clear `Error('Cyclic recipe graph not supported in LP MVP')` so the failure is visible, not silent.

**Pitfall 8 — Initializing `craftProgress` to `recipe.craftTicks` and testing `=== 0` for done.**
This is the correct idiom (S09): `craftProgress` starts at `craftTicks` and counts down; `=== 0` means done. A model might reverse this (start at 0, count up to `craftTicks`) and then the `machineTick_emit` logic inverts. Pick one convention and stick to it — the card uses countdown.
