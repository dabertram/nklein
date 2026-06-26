# 34 - Realtime Strategy with LLM Commanders and Cooperative AI Allies

Complexity tier: 34/35 game block
Expected decomposition size: 210-260 dependent implementation cards before coding.
Domain pressure: real-time strategy, squad tactics, economy, fog of war, deterministic simulation, LLM-controlled enemy commanders, cooperative AI allies, multiplayer-ready presentation.
Acceptance command: npm test

## How to use this challenge
This is a game dev-test project specification for evaluating whether an autonomous coding agent can decompose real game systems, implement deterministic simulation logic, and build a polished presentation layer that makes the game understandable and desirable. The goal is not to finish the whole game. The goal is to build a product-grade foundation that proves the agent understands rules, simulation state, player experience, rendering, and verification.

The agent must read this entire specification before planning. It must create a dependency-linked plan, record domain knowledge debt, identify engine and presentation invariants, and choose a release slice that exercises the highest-risk mechanics. For game projects, visual presentation is mandatory, not a stretch goal. A correct simulation hidden behind ugly placeholder UI is not enough.

## Product vision
Build a modern RTS foundation where the player commands an army while LLM-backed commanders can control enemies, advise the player, or cooperate as allied commanders. The live LLM path must be optional; deterministic scripted commander adapters are required for tests. The game must have a polished presentation worthy of an RTS, not a minimap prototype.

## Target players and users
- RTS players who want economy, scouting, army control, fog of war, and tactical battles.
- Co-op players who want AI allied commanders that can coordinate plans and react to pings.
- Scenario designers who want authored missions, commander personalities, and difficulty curves.
- AI researchers testing LLM planning under partial observability and real-time constraints.

## Foundation release scope
The first serious buildout must include:
- Match, map, player, faction, unit, squad, building, resource node, tech, upgrade, command, order queue, fog state, scout report, commander intent, alliance, ping, replay, and telemetry models.
- Deterministic RTS simulation with fixed ticks, resources, build queues, unit movement, combat, projectiles placeholder, damage types, abilities, harvesting, production, tech unlocks, and victory conditions.
- Fog-of-war system with explored, visible, hidden, last-known enemy state, decoy reports, scout events, and per-player projections that prevent information leaks.
- Unit control layer for selection, formations, attack-move, patrol, hold, retreat, ability targeting, rally points, control groups, and squad-level commands.
- Economy and production AI primitives for build orders, worker assignment, expansion timing, supply caps, tech progression, and resource harassment response.
- Commander interface that converts game observations into bounded natural-language or structured briefs and accepts high-level plans from LLM or scripted adapters.
- Enemy LLM commander adapter with personality, strategic goals, scouting summaries, production plans, attack timings, retreats, deception, and difficulty constraints.
- Cooperative AI ally adapter that can accept player pings, propose plans, reserve resources, defend areas, coordinate attacks, and explain current intent.
- Scenario system for tutorial, skirmish, survival, asymmetric defense, two-player co-op with AI ally, and boss-style enemy commander missions.
- Replay and spectator system with fog-perspective switching, commander intent timeline, build order chart, combat highlights, and post-game analysis.
- Seed mission with resource expansion race, hidden enemy tech switch, allied AI needing defense, commander deception, and late-game base assault.

## Gameplay requirements
- The RTS must be playable without LLMs using deterministic scripted commanders and bots.
- LLM commanders must operate through bounded high-level intents and legal commands, not direct mutation of game state.
- Enemy commanders must obey fog of war and cannot see hidden player state.
- Cooperative allies must coordinate with player signals but remain constrained by faction economy and unit legality.
- Real-time pressure should be represented through ticks and command queues while tests can run deterministically.

## Presentation requirements
Very nice presentation is mandatory for this challenge. The agent must treat rendering, animation, interaction feedback, and layout polish as core acceptance criteria. Required presentation work:
- A very nice RTS presentation is mandatory: animated units, buildings, harvesting, combat effects, fog of war, selection rings, command cursors, projectiles or hit effects, health bars, rally lines, minimap, and faction identity.
- The UI must include a polished command card, production queue, resource bar, unit portraits/icons, control groups, alerts, minimap, objectives, and commander communication panel.
- LLM commander communication should feel integrated: concise battle plans, intent markers on the map, ally pings, enemy taunts or intercepted signals where appropriate, and post-game analysis.
- Spectator/replay presentation must show fog perspective, build orders, combat highlights, commander decisions, and timeline scrubber.
- No raw canvas dots, unstyled tables, or chat-only commander control can pass this challenge.

## Architecture requirements
- Separate deterministic simulation, command validation, fog projection, unit AI, economy AI, commander adapter, LLM context builder, scenario system, replay, spectator projection, and renderer.
- Use structured commander intents and legal command translation before touching simulation state.
- Keep live LLM providers behind adapters with deterministic fixture commanders for tests.
- Represent fog-filtered observations as immutable snapshots with provenance and token budget metadata.
- Make replay authoritative from initial state, seed, player commands, and commander decisions.

## Domain knowledge debt to surface
The agent should not pretend to know every game design, simulation, AI, rendering, or balancing detail perfectly. It should mark assumptions, build deterministic subsets, and preserve extension points for future designers, artists, balance passes, and live integrations. Required knowledge areas:
- RTS games are partial-observation, resource-constrained, real-time decision systems.
- LLM-controlled enemies must be bounded by game rules, timing, visibility, and difficulty controls.
- Cooperative AI needs communication protocols, intent sharing, and conflict resolution with player plans.
- Presentation is essential because RTS players read battlefield state visually under time pressure.
- Deterministic fixtures are required because live LLM output cannot be the basis of acceptance tests.

## Required challenge scenarios
The implementation plan and fixtures should be shaped around scenarios like these. They do not all need full UI coverage in the first slice, but the core model and presentation should be capable of representing them:
- The enemy commander scouts the player, misreads a decoy expansion, and delays its tech switch.
- The allied commander asks for defense while preparing an air strike and marks its intended route on the map.
- Fog projection hides the player army from the enemy commander until a scout obtains line of sight.
- A live LLM suggestion attempts an illegal command and the validator rejects it with a structured reason.
- The replay shows the commander intent timeline alongside resource graph and combat highlights.
- A co-op mission has the player and AI ally split roles between defense, harassment, and final push.

## Decomposition pressure
This challenge should force decomposition across rules or simulation engine, deterministic fixtures, AI or policy layers, replay/save state, player-facing presentation, UI interaction, diagnostics, and test harnesses. The plan should include dependency links so core state, commands, invariants, and golden tests are built before rendering depends on them. Avoid starting with a visual mock that cannot play the game; also avoid building a correct but lifeless engine with no usable presentation.

The agent should maintain a visible knowledge-debt list covering unclear rules, balance assumptions, AI limitations, rendering tradeoffs, asset gaps, accessibility concerns, performance constraints, and future designer review checkpoints. Knowledge debt is not a failure; hiding it is.

## Acceptance criteria
- Simulation tests cover economy, build queues, unit movement, combat, abilities, harvesting, tech, victory, and command validation.
- Fog tests prove enemies and allies receive only legal projected observations.
- Commander adapter tests cover scripted enemy, scripted ally, illegal LLM output, bounded intent translation, and difficulty constraints.
- Co-op tests cover pings, shared plans, resource reservations, conflicting intents, and ally explanation output.
- Replay tests reproduce match state, commander decisions, build orders, and combat outcomes deterministically.
- Presentation checks verify animated battlefield, minimap, command UI, fog, commander panel, intent markers, and spectator timeline.
- The project passes npm test without requiring a live LLM provider.

## Explicit non-goals
- Do not let LLM output directly mutate game state.
- Do not let enemy commanders see through fog of war.
- Do not make the RTS a chat game with icons.
- Do not depend on live LLM calls in acceptance tests.
- Do not skip polished battlefield presentation.

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

> Added 2026-06-26 via deep domain research. **The single defining property of this project:** it forces a clean, load-bearing seam between a **bit-deterministic, fixed-tick, replayable RTS simulation** and a **non-deterministic LLM commander**, such that the commander can *only* perceive a fog-filtered observation snapshot and *only* act by emitting bounded structured intents that a validator translates into legal commands — so `npm test` stays reproducible behind scripted fixture commanders while a live LLM is a drop-in production adapter. An RTS where LLM text mutates game state, or enemies see through fog, or replays don't reproduce, is the failure mode; a *deterministic battlefield steered by a sandboxed, fog-bounded commander* is the win.

## E0. The grading rubric (what actually makes this master-grade)

The naive version is "an RTS where you chat at the enemy." That is untestable (LLM output is nondeterministic), unsound (text reaching the simulation is a confused-deputy hole), and unfair (an LLM that sees hidden state isn't playing the same game). The disciplined version puts an **air gap** between simulation and commander: the simulation is deterministic and authoritative; the commander is a pure function from a *fog-filtered observation* to *structured intents*; a validator is the only bridge. Grade on:

1. **Determinism + replay** — the match is reproducible bit-for-bit from `(initial state, seed, ordered commands, commander decisions)`; replay carries inputs only and verification reduces to comparing a state hash each tick. This is the RTS gold standard. [gafferongames.com/post/deterministic_lockstep](https://gafferongames.com/post/deterministic_lockstep/), [socratopia.app/library/math-for-game-devs-en/chapter-30](https://www.socratopia.app/library/math-for-game-devs-en/chapter-30)
2. **Fog soundness** — no commander (enemy or ally) ever receives a datum it could not legally observe; provable by construction, not by trusting the model.
3. **Intent legality** — the LLM never mutates simulation state; it emits intents that a validator either translates into legal commands or rejects with a structured reason. "LLM output directly mutates game state" is an explicit non-goal.
4. **Testability without a live model** — every acceptance test runs on scripted fixture commanders; the live LLM path is optional and never required for `npm test`.

Everything below serves those four.

## E1. The deterministic simulation kernel (the foundation — build this first, ~20–25 cards)

Bitwise determinism is the *precondition* for everything; lockstep RTS demands "exact down to the bit-level — you could checksum your entire game state each frame and it would be identical." [gafferongames.com/post/deterministic_lockstep](https://gafferongames.com/post/deterministic_lockstep/)

- **Fixed-tick simulation decoupled from render.** The sim advances in fixed ticks (e.g. 1 tick = 1/16 s of game time, or coarser); orders are queued and applied at tick boundaries. Render interpolates between the last two simulation states; the simulation never reads the wall clock. Real-time *pressure* is modeled as ticks + command latency, while tests advance the clock explicitly. [gafferongames.com/post/fix_your_timestep](https://gafferongames.com/post/fix_your_timestep/)
- **Fixed-point math, no floats in core.** Unit positions, velocities, damage, harvest amounts, and timers are fixed-point (Q16.16/FP64-style), with deterministic trig via lookup tables — because IEEE float results are *not* reproducible across machines/compilers/build modes and a single 1-ULP drift desyncs the whole match (and every replay of it). This is the single most common RTS-determinism failure; eliminate it structurally. [gamedeveloper.com/programming/cross-platform-rts-synchronization-and-floating-point-indeterminism](https://www.gamedeveloper.com/programming/cross-platform-rts-synchronization-and-floating-point-indeterminism), [github.com/xpTURN/Klotho](https://github.com/xpTURN/Klotho)
- **Single seeded PRNG tree + deterministic iteration.** One root seed forks named streams (spread of damage rolls, ability variance, decoy generation); set the seed deterministically per tick. Entities are stepped in a stable documented order (entity id); forbid hash-map iteration order in core. [gafferongames.com/post/deterministic_lockstep](https://gafferongames.com/post/deterministic_lockstep/)
- **Deterministic pathfinding + collision.** Grid/nav A* (or Jump Point Search for canonical, symmetry-broken paths) and flow-fields for large groups, each with an explicit deterministic tie-break; two units with equal-cost options must resolve identically every run. [arxiv.org/pdf/2501.14816](https://arxiv.org/pdf/2501.14816)
- **Command-log replay as authority.** A match = `(initial state, seed, ordered player commands, commander intents)`. The replay is recomputed, not stored as state; a per-tick **state checksum** makes any desync a failing test. Snapshots compact long matches and let the replay scrubber seek.

## E2. The fog-of-war projection (the soundness spine — grounded in AlphaStar)

Fog is not a render effect; it is an **immutable, per-player observation projection** that is the *only* thing a commander can see — and it must leak nothing. Model it on AlphaStar's observation contract, which is exactly this discipline at SOTA scale:

- **Three-state visibility per cell** (hidden / explored-but-not-visible / currently-visible) per player, derived from that player's units' sight ranges each tick.
- **Strict observation filtering, AlphaStar-style:** enemy units hidden by fog **do not appear** in the observation at all; enemy units seen earlier but now out of vision appear only as **last-known** ghosts (stale position/type), not live truth; even visible enemies expose only legal fields. "Active exploration is necessary to determine the opponent's state." Reproduce this filter as the bridge's hard boundary. [storage.googleapis.com/deepmind-media/research/alphastar/AlphaStar_unformatted.pdf](https://storage.googleapis.com/deepmind-media/research/alphastar/AlphaStar_unformatted.pdf), [ar5iv.labs.arxiv.org/html/1708.04782](https://ar5iv.labs.arxiv.org/html/1708.04782)
- **Last-known + decoy reports.** The projection carries last-known enemy state and *seeded decoy* reports (a feint expansion the enemy may misread) — enabling the spec's "enemy commander misreads a decoy and delays its tech switch" scenario *honestly*: the deception is in what the fog legitimately shows, never in the model peeking.
- **Provenance + token-budget metadata.** Each observation snapshot is immutable and stamped with provenance (which tick, which units sourced it) and a token-budget annotation, so the context builder (E4) can bound what it serializes to a model. The architecture requirement — "fog-filtered observations as immutable snapshots with provenance and token budget metadata" — is met literally.
- **The invariant:** a property test diffs the enemy commander's *entire* observation against ground truth and asserts it contains *no* hidden-state datum; fuzz unit positions and assert the leak never occurs. This is "enemies cannot see through fog of war" proven by construction.

## E3. The commander seam: bounded structured intents, not state mutation (the safety spine)

This is the architecturally hardest and most defining part: the LLM commander is a **pure function `observation → structured intents`**, and a **validator** is the *only* path from intent to simulation. Ground it in CICERO, the SOTA Diplomacy agent, whose action space is explicitly **split between natural-language and a standard set of structured board moves** — language for communication, structured intents for legal actions. [researchgate.net/publication/365666035](https://www.researchgate.net/publication/365666035_Human-level_play_in_the_game_of_Diplomacy_by_combining_language_models_with_strategic_reasoning), [arxiv.org/html/2506.09655v1](https://arxiv.org/html/2506.09655v1)

- **A typed intent schema** (the commander's whole vocabulary): high-level plans like `expand(base_id, location_hint)`, `attack(target_region, force_ratio)`, `defend(region)`, `tech(branch)`, `harass(target)`, `scout(area)`, `retreat(squad)`, `ping_ally(location, request)`, `say(channel, text)`. Mirror AlphaStar's structured action decomposition — *what* action, applied to *who/which group*, targeting *where*, and *when next* — so intents are legal-by-shape before any semantics. [storage.googleapis.com/deepmind-media/research/alphastar/AlphaStar_unformatted.pdf](https://storage.googleapis.com/deepmind-media/research/alphastar/AlphaStar_unformatted.pdf)
- **The validator is the bridge and the gate.** It re-checks every intent against the commander's *own legal observation and faction state*: can this faction afford it? does it reference only units/regions the commander can legally know about (cross-checked against E2)? is the unit composition legal for this faction/tech? An intent referencing a fog-hidden enemy position, or an unaffordable build, or an illegal unit is **rejected with a structured reason** and an audit record — the spec's "a live LLM suggestion attempts an illegal command and the validator rejects it with a structured reason" scenario, made the *central* mechanism. Valid intents are compiled to the same legal command queue a human uses; **text never reaches the simulation.**
- **Difficulty as bounded constraints, not cheating.** Difficulty is enforced at the seam: APM/intent-rate caps (AlphaStar limited itself to ~22 actions per 5 s to match human speed and *avoid* superhuman execution), reaction-delay floors, and economy/visibility limits — never fog-peeking. Difficulty tuning is a documented, testable knob on the validator/scheduler. [storage.googleapis.com/deepmind-media/research/alphastar/AlphaStar_unformatted.pdf](https://storage.googleapis.com/deepmind-media/research/alphastar/AlphaStar_unformatted.pdf)
- **Separate prose from action.** A commander's taunt/brief (`say`) and its evidence-backed reasoning summary are *presentation*, kept strictly apart from the legal intents that actually move units — the spec's "keep generated prose separate from legal game actions."

## E4. The LLM context builder + the fixture-vs-live adapter split (the testability spine)

`npm test` must be green with **zero** live model calls; the live LLM is a drop-in production adapter behind the *same* interface.

- **`Commander` is one interface, three+ implementations:** `ScriptedCommander` (a deterministic policy/state-machine — enemy *and* ally variants — used by all tests), `ReplayCommander` (re-emits recorded intents from a match log), and `LiveLLMCommander` (production, behind a provider adapter). The simulation only ever sees the interface; it cannot tell which is driving.
- **The context builder** turns the immutable fog observation (E2) into a bounded, token-budgeted brief (text or structured) for the model, and parses the model's reply back into typed intents — with robust recovery for malformed/over-budget output (reject-and-rescope, never crash). The simulation/test path never depends on this builder.
- **Determinism boundary is explicit:** the *simulation* is deterministic; the *live commander* is not — so the seam is where reproducibility is enforced. Tests pin a `ScriptedCommander`; a live LLM is exercised only in opt-in, non-acceptance integration smoke tests. "Keep live LLM providers behind adapters with deterministic fixture commanders for tests" is met literally. This mirrors the broader LLM-RTS research direction (state-machine + memory prompting harnesses around a deterministic core). [arxiv.org/html/2510.18395v1](https://arxiv.org/html/2510.18395v1)

## E5. The cooperative-ally protocol (intent sharing + conflict resolution)

The ally is a `ScriptedCommander`/`LiveLLMCommander` with a **communication protocol**, not a scripted helper:

- **Player pings → ally intents.** The player marks a location/request (defend here, attack there, need resources); the ally proposes a plan, *reserves resources*, and marks its intended route on the map — the spec's "ally asks for defense while preparing an air strike and marks its route" scenario, as structured shared intents.
- **Conflict resolution.** When the player's plan and the ally's proposal collide (both want the same chokepoint, or a resource reservation starves the player), a deterministic resolver negotiates or escalates, and the ally **explains its current intent** in prose backed by the structured plan. "Cooperative AI needs communication protocols, intent sharing, and conflict resolution with player plans" is the literal requirement.
- **Role-splitting co-op** (defense / harassment / final push between player and ally) falls out of the same intent + reservation system — a testable shared-plan scenario, not bespoke mission script.

## E6. Presentation worthy of an RTS (mandatory, derived, never hand-maintained)

Beauty is acceptance, and the discipline is that **the battlefield is a pure projection of (the player's) fog-filtered simulation state.**

- **A living battlefield:** animated units, buildings, harvesting, combat effects/projectiles, selection rings, command cursors, health bars, rally lines, fog rendering, a real minimap, and faction identity.
- **A polished command layer:** command card, production queue, resource bar, unit portraits/icons, control groups, alerts, objectives, minimap, and a **commander communication panel** (concise battle plans, intent markers on the map, ally pings, enemy taunts/intercepted signals where appropriate).
- **Commander integration as first-class UI:** intent markers render the *structured* plan (not just chat); a rejected illegal intent surfaces its structured reason; the ally's reserved route and the enemy's last-known ghosts appear as proper map annotations.
- **Spectator/replay:** fog-perspective switching (watch the match through any commander's legal observation), a commander-intent timeline, a build-order chart, combat highlights, a resource graph, and a timeline scrubber — the spec's "replay shows the commander intent timeline alongside resource graph and combat highlights." Raw canvas dots, unstyled tables, or chat-only control fail (explicit non-goal).

## E7. The adversarial / edge-case scenario pack (ship the hard cases as fixtures)

Concrete, seeded, deterministically-asserted situations — the difference between an RTS foundation and a tech demo:

- **Fog leak hunt:** fuzz the enemy commander's observation against ground truth across many ticks and assert *zero* hidden-state leakage (the soundness invariant), including the moment a scout *gains* line of sight and the army legitimately appears.
- **Decoy misread:** a seeded decoy expansion causes the scripted enemy to delay its tech switch — assert the enemy acted only on its (legitimately misleading) observation, never on truth.
- **Illegal-intent rejection battery:** a fixture commander (standing in for a live LLM) emits intents that are unaffordable, reference fog-hidden enemies, target nonexistent units, or request illegal compositions — assert each is rejected with the correct structured reason and an audit record, and that *none* mutated state.
- **Co-op conflict:** player and ally issue colliding plans / overlapping resource reservations — assert the deterministic resolver's outcome and the ally's explanation, and that reservations conserve (no resource double-spent).
- **Difficulty bounds:** assert the enemy never exceeds its APM/intent-rate cap and never reacts faster than its delay floor — superhuman execution is impossible by construction.
- **Determinism stressors:** two runs from one seed produce byte-identical per-tick state hashes; a snapshot/restore mid-battle continues identically; the *same* match driven by `ScriptedCommander` then re-driven by `ReplayCommander` (replaying its recorded intents) yields an identical match. Swap in a *different* commander adapter and confirm the simulation core is byte-identical given identical intents (adapter-independence).
- **Late-game assault:** the seed mission's full arc (expansion race → hidden enemy tech switch → ally needing defense → commander deception → base assault) runs end-to-end deterministically.

## E8. Global invariants (property-based — this is how the RTS is graded)

Across randomized + scripted matches, assert properties, not just examples:

1. **Determinism** — equal `(initial state, seed, player commands, commander intents)` ⇒ byte-identical per-tick state hashes across two runs and across a snapshot/restore boundary.
2. **Fog soundness** — for every tick and every commander, the observation contains no datum the player could not legally observe (proven against ground truth); last-known ghosts are flagged stale, never live.
3. **No-mutation-by-text** — the simulation state is mutated *only* by validator-approved legal commands; no code path lets commander prose or raw intents write state directly.
4. **Intent legality totality** — every accepted intent passed a legality check against the commander's own legal observation + faction state; every rejected intent has a structured reason + audit record.
5. **Adapter independence** — given identical intents, the simulation produces identical results regardless of which `Commander` implementation (scripted/replay/live) emitted them; the live LLM is never on the acceptance path.
6. **Resource/economy conservation** — resources are conserved across harvest/spend/reservation (no minting by bookkeeping; reservations released on cancel); supply caps and tech prerequisites always hold.
7. **Difficulty bounds** — no commander exceeds its APM/intent-rate cap or reaction-delay floor.

Plus a **chaos mode**: drop/delay command packets (lockstep must stall-and-resync, not desync), kill and restore from snapshot mid-battle, and feed the validator a fuzzed stream of malformed/illegal intents asserting the simulation stays sound and deterministic throughout.

## E9. The concrete first vertical slice (the on-ramp — build THIS first, ~50–65 cards)

Do **not** spread the first release across all factions, units, and missions. Prove the spine on **one small map, two factions (player vs. one scripted enemy commander), a minimal economy + a handful of unit types**:

- The **deterministic kernel** (E1): fixed-tick sim, fixed-point math + LUT trig, seeded PRNG tree, deterministic pathfinding + tie-breaking, command-log replay, per-tick state checksum, snapshot/restore.
- The **fog projection** (E2) with three-state visibility, last-known ghosts, and one seeded decoy, plus the *fog-leak property test* green.
- The **commander seam** (E3): the typed intent schema + the validator (legality + structured rejection + audit), proving "text never mutates state" and the illegal-intent-rejection battery.
- The **`Commander` interface** (E4) with a `ScriptedCommander` enemy and `ReplayCommander`, so the whole slice runs with **zero live model calls**; stub the `LiveLLMCommander` behind the same interface.
- **Presentation** (E6): an animated battlefield + command card + production queue + resource bar + minimap + the **commander panel with intent markers** + a replay scrubber with fog-perspective switching and a commander-intent timeline.
- The seed mission's core arc (expansion race + the decoy-driven tech delay + an enemy assault) running deterministically end-to-end, with all global invariants holding through one snapshot/restore and one packet-drop resync.

If that slice is real — a deterministic, fog-sound battlefield steered by a sandboxed scripted commander, with text provably unable to touch state — then a live LLM commander, an ally, more factions, and richer missions are all breadth on a proven spine. If it isn't, no amount of unit art saves it.

## E10. Domain knowledge-debt to track (surface, don't bluff)

Each item gets an owner, a risk note, and an **expert-review/designer-review** flag:

- **Balance** — unit costs, damage types, tech timings, and economy rates are starting points; flag for a balance pass and never present as final.
- **Determinism portability** — fixed-point coverage must be total; document any remaining float in non-core (render only) and assert it can't feed simulation. Cross-platform/replay-compatibility is a tracked risk.
- **LLM context-budget realism** — the token budget for a real model's brief is a guess until measured against a live model; mark as debt and keep it out of the acceptance path.
- **Commander prompt/parse robustness** — recovery for malformed live-LLM output is best-effort; document the failure modes and keep fixtures authoritative.
- **Pathfinding/perf at scale** — A*/JPS/flow-field cost vs. unit count; record the deterministic tie-break rule and the unit-count performance budget.
- **Fixture realism** — scripted commanders are *representative*, not a model's real behavior; name them as adapters and don't overclaim coverage.
- **Accessibility** — battlefield readability under time pressure must not rely on color alone (selection/health/fog need secondary encodings) — tracked debt.

## E11. Why this is a great !Klein challenge

It stresses the exact capabilities !Klein must prove with small local models — and is unusually *on-thesis* because the game itself is "a sandboxed, fog-bounded LLM commander steering a deterministic world," which is a microcosm of governed agency. It demands **deep, dependency-ordered decomposition** (the deterministic kernel, fog projection, and validator seam *must* be built and invariant-tested before any LLM or rendering depends on them), **determinism under weak authorship** (the agents cannot fudge fixed-point math, fog filtering, or tie-breaking — the replay and fog-leak invariants catch it instantly), **a clean nondeterministic-actor boundary** (the single hardest seam — isolating the LLM behind an observation→intent→validator air gap so `npm test` stays reproducible — is precisely the discipline !Klein applies to its own agents: bounded perception, structured action, validated side effects), and **legible reasoning** (every intent and rejection is evidence-backed and auditable). It is a delight to watch a swarm of small models build: a real RTS where you can replay any match, switch to the enemy's fog perspective, and watch its plans — provably formed only from what it could legally see. Build the kernel + fog projection + validator seam + scripted-commander slice (E1–E4, E9) first; earn the rest.

---

## Small-model build guide (3B-ready)

> This section exists so a ~3B local model can follow the spec mechanically. Every card below is independently implementable and verifiable with `npm test`. The 3B must **follow** these instructions, not reason about them.

### 1. Glossary & ground rules

**Domain terms**

| Term | Meaning in this project |
|---|---|
| Tick | One fixed simulation step. 1 tick = 1/16 second of game time. All unit positions, timers, and command queues advance by ticks. |
| FP | Fixed-point integer. Use Q16 = integer × 65536. All positions, velocities, damage, harvest amounts, and timers are FP. Never raw floats in core. |
| Seed | A 32-bit unsigned integer. All randomness derives from it. Same seed + same commands = identical match. |
| Checksum | A hash of the full simulation state at a tick. Two runs from the same seed must produce identical checksums. |
| Commander | The interface that drives a faction's strategy. Three implementations: `ScriptedCommander` (deterministic, used in all tests), `ReplayCommander` (replays recorded intents), `LiveLLMCommander` (production only, never on `npm test` path). |
| Intent | A typed structured action emitted by a commander: `expand`, `attack`, `defend`, `tech`, `harass`, `scout`, `retreat`, `ping_ally`, `say`. |
| Validator | The only bridge from intent to simulation state. Checks legality; rejects with a structured reason + audit record if illegal. Text never mutates state directly. |
| Fog of war | Per-player visibility state. Three values per cell per player: `hidden`, `explored`, `visible`. |
| Last-known | An enemy unit the player has seen but no longer has line of sight to. Appears as a ghost in the observation; position/type is stale. |
| Observation | The immutable, per-player, fog-filtered snapshot of the game state. The only thing a commander may act on. |
| Decoy | A seeded false expansion report placed in a player's observation to simulate in-game feints. |
| APM cap | Actions per minute limit on a commander. Enforced by the validator/scheduler (difficulty knob). |
| Command log | The ordered list of player + commander intents applied so far. Replay = fold log over initial state. |
| LUT trig | Look-up table trigonometry (integer arrays for sin/cos). Never call `Math.sin`/`Math.cos` in the sim core. |
| ScriptedCommander | A deterministic policy (state-machine) that produces legal intents from an observation, used in all acceptance tests. |
| ReplayCommander | Re-emits intents from a stored intent log — used to verify replay determinism. |
| LiveLLMCommander | Wraps a live LLM behind the `Commander` interface. Only exercised in opt-in smoke tests, never in `npm test`. |

**Stack**

- Language: TypeScript (strict mode, no `any`)
- Runtime: Node.js 20+
- Test runner: `npm test` runs `vitest run`
- Key helpers: `src/fp.ts` (FP math), `src/prng.ts` (PRNG tree), `src/lut.ts` (trig LUT)
- Layout: `src/` for sim core; `src/commanders/` for commander implementations; `src/adapters/` for LLM stubs; `test/` for tests; `test/fixtures/` for seeded scenarios

**Ground rules (imperative)**

1. Never call `Date.now()`, `Math.random()`, `setTimeout`, or `setInterval` inside `src/` core sim modules.
2. All unit positions, velocities, damage, harvest, and timers are FP integers. Never store them as `number` floats in simulation state.
3. Process entities (units, buildings, projectiles) in ascending stable-id order. Never iterate a `Map` or `Set` for order-sensitive processing.
4. A commander may only read from an `Observation` object (fog-filtered). It must not receive or reference `GroundTruthState` directly.
5. Text from a commander's `say` intent never mutates game state — only validator-approved structured intents do.
6. `npm test` must pass with **zero live model calls** — `LiveLLMCommander` is only exercised behind an env-var gate.
7. All acceptance tests use `ScriptedCommander` or `ReplayCommander`.
8. Stubs for live LLM go in `src/adapters/llm.fixture.ts` with a deterministic implementation alongside.

---

### 2. The explicit task graph for the first vertical slice

The first slice targets: **E1 (deterministic kernel) + E2 (fog projection with fog-leak test) + E3 (intent schema + validator) + E4 (Commander interface + ScriptedCommander + ReplayCommander) + E9 (seed mission: expansion race + decoy + enemy assault, deterministic end-to-end)**. The live LLM adapter is a typed stub only — no live calls.

Cards are in strict dependency order.

---

**`R01` — Project scaffold and TypeScript config**
dependsOn: none
files: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/types.ts`
interface:
```ts
// src/types.ts
export type FP = number;         // Q16: integer × 65536
export type Tick = number;       // non-negative integer
export type Seed = number;       // uint32
export type EntityId = number;   // stable, monotonically assigned
export type TileIndex = number;  // row-major grid index
export type PlayerId = "player" | "enemy" | "ally";
```
how to implement: same scaffold pattern. `"test": "vitest run"` in `package.json`. `"strict": true`, `"noImplicitAny": true` in `tsconfig.json`.
acceptance: `npm test` exits 0. `tsc --noEmit` has no errors.

---

**`R02` — Fixed-point arithmetic and LUT trig**
dependsOn: `R01`
files: `src/fp.ts`, `src/lut.ts`, `test/fp.test.ts`
interface:
```ts
// src/fp.ts — Q16: integer × 65536
export const FP_SCALE = 65536;
export function toFP(n: number): FP      // Math.round(n * FP_SCALE)
export function fromFP(fp: FP): number   // fp / FP_SCALE
export function fpAdd(a: FP, b: FP): FP
export function fpSub(a: FP, b: FP): FP  // throws if result < 0
export function fpMul(a: FP, b: FP): FP  // Math.trunc((a * b) / FP_SCALE)
export function fpDiv(a: FP, b: FP): FP  // Math.trunc((a * FP_SCALE) / b)
export function fpClamp(v: FP, lo: FP, hi: FP): FP
export function fpAbs(v: FP): FP

// src/lut.ts — integer sin/cos in Q16 for 360 discrete degrees
export function lutSin(degrees: number): FP  // degrees is integer [0, 359]
export function lutCos(degrees: number): FP
```
how to implement: `lutSin`/`lutCos`: at module load, build an array `LUT_SIN[360]` where `LUT_SIN[i] = Math.round(Math.sin(i * Math.PI / 180) * FP_SCALE)` — this is computed once at startup, not called in the sim loop. The sim uses `lutSin(degrees)` (integer lookup), never `Math.sin`.
acceptance: `test/fp.test.ts` asserts: `fpMul(toFP(3), toFP(4))` = `toFP(12)`; `fpSub(toFP(2), toFP(3))` throws; `lutSin(90)` = `FP_SCALE` (= `toFP(1)`); `lutCos(0)` = `FP_SCALE`; `lutSin(0) === 0`. `npm test` green.

---

**`R03` — Seeded PRNG tree**
dependsOn: `R01`
files: `src/prng.ts`, `test/prng.test.ts`
interface:
```ts
// src/prng.ts
export type PrngStream = { name: string; state: number };
export type PrngTree = {
  damage: PrngStream;
  ability: PrngStream;
  decoy: PrngStream;
  commander: PrngStream;
  misc: PrngStream;
};
export function createPrngTree(rootSeed: Seed): PrngTree
export function nextUint32(stream: PrngStream): number
export function nextIntBelow(stream: PrngStream, n: number): number
```
how to implement: xorshift32; each stream seeded from `rootSeed + streamIndex`.
acceptance: two `createPrngTree(99)` produce identical `damage` sequences. Different streams differ. `nextIntBelow` always in `[0, n)`. `npm test` green.

---

**`R04` — Map grid, unit model, and entity registry**
dependsOn: `R01`, `R02`
files: `src/map.ts`, `src/unit.ts`, `test/unit.test.ts`
interface:
```ts
// src/map.ts
export type MapCell = { index: TileIndex; walkable: boolean; elevation: FP };
export type MapGrid = { width: number; height: number; cells: MapCell[] };
export function createMapGrid(width: number, height: number): MapGrid
export function cellNeighbors(grid: MapGrid, idx: TileIndex): TileIndex[]  // 4-connected

// src/unit.ts
export type UnitType = "worker" | "soldier" | "ranged";
export type Unit = {
  id: EntityId;
  owner: PlayerId;
  type: UnitType;
  positionFP: { x: FP; y: FP };   // tile-space position Q16
  hpFP: FP;                        // current HP Q16
  maxHpFP: FP;                     // max HP Q16
  orderQueue: Order[];
};
export type Order = { kind: "move"; targetTile: TileIndex } | { kind: "attack"; targetId: EntityId } | { kind: "harvest"; resourceId: EntityId };
export function createUnit(id: EntityId, owner: PlayerId, type: UnitType, startTile: TileIndex, grid: MapGrid): Unit
export function nextEntityId(used: EntityId[]): EntityId
```
how to implement: `createUnit` places unit at tile center (tile index → FP pixel coords). `positionFP` = `{x: toFP(col), y: toFP(row)}`. `orderQueue = []`.
acceptance: `createUnit` initializes at correct position; `nextEntityId([1,3,5])` returns 6; `cellNeighbors` at corner returns 2. `npm test` green.

---

**`R05` — Simulation clock and tick loop skeleton**
dependsOn: `R01`, `R03`, `R04`
files: `src/clock.ts`, `src/sim.ts`, `test/sim.test.ts`
interface:
```ts
// src/clock.ts
export type SimClock = { tick: Tick; matchTimeMs: number };
export function createClock(): SimClock
export function advanceClock(clock: SimClock): SimClock  // tick += 1; matchTimeMs += 62 (1/16 s in ms)

// src/sim.ts
export type MatchState = {
  clock: SimClock;
  map: MapGrid;
  units: Unit[];           // sorted by id
  resources: ResourceNode[]; // see R06
  prngTree: PrngTree;
  commandLog: IntentLog;
};
export function createMatchState(seed: Seed, map: MapGrid, units: Unit[]): MatchState
export function stepMatch(state: MatchState, pendingIntents: ValidatedIntent[]): MatchState
  // 1. Apply intents in id order
  // 2. Advance unit positions one step toward their order target
  // 3. Resolve combat for units in attack orders
  // 4. Advance clock
```
how to implement: `stepMatch` returns a new `MatchState` (immutable). Process units in `id` order. Stub out combat and movement for now (move 1 FP unit per tick toward target).
acceptance: `createMatchState` has clock at tick 0. Two `stepMatch` calls advance clock to tick 2. `units` array is sorted by id. `npm test` green.

---

**`R06` — Resource nodes and economy**
dependsOn: `R01`, `R02`, `R04`, `R05`
files: `src/economy.ts`, `test/economy.test.ts`
interface:
```ts
// src/economy.ts
export type ResourceNode = {
  id: EntityId;
  tileIndex: TileIndex;
  resourceType: "minerals" | "vespene";
  stockFP: FP;   // remaining resource, Q16
};
export type PlayerEconomy = {
  playerId: PlayerId;
  mineralsFP: FP;
  vespeneFP: FP;
};
export function harvestResource(
  node: ResourceNode,
  economy: PlayerEconomy,
  amountFP: FP,
): { node: ResourceNode; economy: PlayerEconomy }
  // node.stockFP -= amountFP (fpSub — throws if negative)
  // economy.mineralsFP += amountFP (if resource is minerals)
// Conservation: node.stockFP + economy.mineralsFP change by equal and opposite amounts
export function spendMinerals(economy: PlayerEconomy, costFP: FP): PlayerEconomy
  // economy.mineralsFP -= costFP (fpSub — throws if insufficient)
```
how to implement: immutable returns. `fpSub` is the conservation guard.
acceptance: `test/economy.test.ts` asserts: harvesting 10 minerals decreases `node.stockFP` by `toFP(10)` and increases `economy.mineralsFP` by `toFP(10)`. Over-harvesting throws. `spendMinerals` beyond balance throws. `npm test` green.

---

**`R07` — Deterministic pathfinding (A* with tie-break)**
dependsOn: `R01`, `R04`
files: `src/pathfinding.ts`, `test/pathfinding.test.ts`
interface:
```ts
// src/pathfinding.ts
export type Path = TileIndex[];
export function findPath(map: MapGrid, from: TileIndex, to: TileIndex): Path | null
  // A* on 4-connected grid; Manhattan heuristic.
  // Tie-break: equal f-score nodes → expand the one with lower TileIndex first.
export function moveToward(unitPos: { x: FP; y: FP }, targetTile: TileIndex, map: MapGrid, speedFP: FP): { x: FP; y: FP }
  // Move unitPos by speedFP toward the center of targetTile; clamp to tile center if within speedFP.
```
how to implement: standard A*. Open set = sorted array by `(f, tileIndex)`. The secondary sort key (`tileIndex` ascending) is the determinism tie-break.
acceptance: straight corridor path found. Blocked corridor returns null. Two calls produce identical paths. `moveToward` moves by exactly `speedFP` per call. `npm test` green.

---

**`R08` — Fog of war projection**
dependsOn: `R01`, `R04`, `R05`, `R06`
files: `src/fog.ts`, `test/fog.test.ts`
interface:
```ts
// src/fog.ts
export type CellVisibility = "hidden" | "explored" | "visible";
export type FogState = {
  playerId: PlayerId;
  visibility: CellVisibility[];  // one per MapCell, indexed by TileIndex
  lastKnownEnemies: Map<EntityId, { tileIndex: TileIndex; type: UnitType; observedAtTick: Tick }>;
};
export type Observation = {
  playerId: PlayerId;
  tick: Tick;
  visibleUnits: Unit[];          // enemy units currently in visible cells (live data)
  lastKnownGhosts: Array<{ id: EntityId; tileIndex: TileIndex; type: UnitType; staleTick: Tick }>;
  visibleResources: ResourceNode[];
  ownUnits: Unit[];              // player's own units (always visible)
  fogState: FogState;            // read-only snapshot of visibility
  decoyReports: DecoyReport[];   // seeded false reports (see R09)
};
export type DecoyReport = { tileIndex: TileIndex; fakeUnitType: UnitType; seed: number };
export function computeFogState(playerId: PlayerId, units: Unit[], map: MapGrid, sightRange: number): FogState
  // For each unit owned by playerId: mark cells within sightRange (Manhattan) as "visible".
  // Previously visible but now out of range: "explored".
  // Never seen: "hidden".
export function buildObservation(
  playerId: PlayerId,
  groundTruth: MatchState,
  fog: FogState,
  tick: Tick,
  decoys: DecoyReport[],
): Observation
  // Returns ONLY what playerId can legally see.
  // Enemy units in "hidden" cells: excluded from visibleUnits.
  // Enemy units last seen but now in "explored" cells: added to lastKnownGhosts.
  // Enemy units in "visible" cells: included in visibleUnits (live data).
  // OWN units: always included in ownUnits.
  // Caller must NOT pass GroundTruthState directly to a commander — only Observation.
```
how to implement: `computeFogState` iterates each owned unit, computes reachable cells within `sightRange`, sets to `"visible"`. Previously `"visible"` cells not reachable this tick become `"explored"`. `buildObservation` filters the ground truth by checking cell visibility per unit. Use ascending entity-id order for all lists.
acceptance: `test/fog.test.ts` asserts:
- An enemy unit in a `"hidden"` cell does not appear in `visibleUnits`.
- The same unit in a `"visible"` cell does appear.
- After the player moves away, the unit becomes a `lastKnownGhost` with the last observed position.
- Two calls on same state produce identical observations (determinism).
- A `DecoyReport` appears in `decoyReports` regardless of fog state.
- `npm test` green.

---

**`R09` — Seeded decoy report generator**
dependsOn: `R01`, `R03`, `R08`
files: `src/decoys.ts`, `test/decoys.test.ts`
interface:
```ts
// src/decoys.ts
export function generateDecoys(
  prng: PrngStream,    // decoy stream
  map: MapGrid,
  tick: Tick,
  count: number,
): DecoyReport[]
  // Generates `count` seeded DecoyReports at random (non-occupied) tile indices.
  // fakeUnitType is randomly selected from ["soldier", "worker", "ranged"].
  // Same seed → same decoys.
```
how to implement: draw tile indices and unit types from `prng`. Filter out already-occupied tiles (accept any random tile for now; caller verifies legality).
acceptance: two calls with same prng state produce same decoys. Decoy tile indices are valid cell indices. `npm test` green.

---

**`R10` — Fog-leak property test**
dependsOn: `R08`, `R09`, `R05`
files: `test/fog_leak.test.ts`
interface: (test file only)
how to implement:
1. Create a match with player owning 2 units (sight range = 3 tiles) and enemy owning 3 units scattered on the map.
2. For each tick 0–20, build the player's observation.
3. **Property test**: for every `unit` in `observation.visibleUnits`, assert `fog.visibility[unit.tileIndex] === "visible"`.
4. For every enemy unit NOT in a visible cell, assert it is absent from `visibleUnits` (may be in `lastKnownGhosts` or absent entirely).
5. Assert that `observation` contains no reference to enemy units in `"hidden"` cells.
acceptance: all assertions green across 20 ticks, `npm test` green. This is the E2 fog-soundness invariant test — it must stay green for all future changes.

---

**`R11` — Intent schema and typed intent log**
dependsOn: `R01`, `R04`
files: `src/intents.ts`, `test/intents.test.ts`
interface:
```ts
// src/intents.ts
export type Intent =
  | { kind: "expand"; baseId: EntityId; locationHint: TileIndex }
  | { kind: "attack"; targetRegion: TileIndex; forceRatio: FP }
  | { kind: "defend"; region: TileIndex }
  | { kind: "tech"; branch: string }
  | { kind: "harass"; targetTile: TileIndex }
  | { kind: "scout"; area: TileIndex }
  | { kind: "retreat"; squadId: EntityId }
  | { kind: "ping_ally"; location: TileIndex; request: string }
  | { kind: "say"; channel: "broadcast" | "ally"; text: string };
export type SubmittedIntent = { commanderId: PlayerId; intent: Intent; submittedAtTick: Tick };
export type IntentLog = SubmittedIntent[];
export type ValidatedIntent = SubmittedIntent & { validationId: string };
export type RejectedIntent = SubmittedIntent & { reason: string; auditId: string };
export function appendIntent(log: IntentLog, entry: SubmittedIntent): IntentLog
export function intentsAtTick(log: IntentLog, tick: Tick): SubmittedIntent[]
```
how to implement: immutable array operations.
acceptance: `appendIntent` does not mutate original. `intentsAtTick` filters correctly. `npm test` green.

---

**`R12` — Intent validator**
dependsOn: `R01`, `R04`, `R08`, `R11`
files: `src/validator.ts`, `test/validator.test.ts`
interface:
```ts
// src/validator.ts
export type ValidationResult =
  | { ok: true; validatedIntent: ValidatedIntent }
  | { ok: false; rejection: RejectedIntent };
export function validateIntent(
  intent: SubmittedIntent,
  observation: Observation,   // commander's legal view only
  economy: PlayerEconomy,
  tick: Tick,
  apmTracker: ApmTracker,
): ValidationResult
// Rejection rules (each produces a distinct reason string):
// 1. "fog_violation": intent references a unit/tile the commander cannot legally observe
//    (unit not in visibleUnits or lastKnownGhosts)
// 2. "insufficient_resources": intent requires minerals/vespene the economy cannot afford
// 3. "illegal_unit_type": intent references a unit type not unlocked by current tech
// 4. "apm_cap_exceeded": commander has exceeded its APM budget for this tick window
// 5. "malformed_intent": intent.kind is not a known value
// On rejection: produce a RejectedIntent with a non-empty reason and auditId = `rej_${tick}_${counter}`
export type ApmTracker = { windowTicks: number; maxIntents: number; recentIntents: Tick[] };
export function createApmTracker(windowTicks: number, maxIntents: number): ApmTracker
export function checkApmCap(tracker: ApmTracker, tick: Tick): { allowed: boolean; updated: ApmTracker }
```
how to implement: each rule is a guard clause returning early with the rejection. Check fog rule: for `attack` or `harass` intents, verify the `targetRegion` or `targetTile` is within the observation's visible or last-known tiles. For `expand`, verify `locationHint` is not a `"hidden"` cell. `ApmTracker` prunes `recentIntents` older than `tick - windowTicks` on each check.
acceptance: `test/validator.test.ts` asserts:
- An `attack` intent targeting a `"hidden"` cell is rejected with `reason === "fog_violation"`.
- An `expand` intent to a visible tile with sufficient minerals is accepted.
- An `expand` intent with insufficient minerals is rejected with `reason === "insufficient_resources"`.
- An intent with `kind = "unknown_action"` is rejected with `reason === "malformed_intent"`.
- Exceeding APM cap is rejected with `reason === "apm_cap_exceeded"`.
- Every rejected intent has a non-empty `auditId`.
- No mutation of game state occurs for any rejected intent.
- `npm test` green.

---

**`R13` — Commander interface, ScriptedCommander, and ReplayCommander**
dependsOn: `R01`, `R08`, `R11`, `R12`
files: `src/commanders/commander.ts`, `src/commanders/scripted.ts`, `src/commanders/replay.ts`, `test/commanders.test.ts`
interface:
```ts
// src/commanders/commander.ts
export interface Commander {
  id: PlayerId;
  // Called each tick with the commander's observation. Returns 0 or more intents.
  // Must never receive GroundTruthState.
  act(observation: Observation, tick: Tick): Intent[];
}

// src/commanders/scripted.ts
// A deterministic state-machine commander used in all tests.
export type ScriptedPhase = "expand" | "attack" | "tech" | "defend";
export function createScriptedCommander(id: PlayerId, prng: PrngStream): Commander
  // Phase logic: expand for first 480 ticks; attack if ownUnits.length >= 5; else defend.
  // Emits one intent per tick (or none). Uses prng for any tie-breaks.

// src/commanders/replay.ts
export function createReplayCommander(id: PlayerId, recordedIntents: SubmittedIntent[]): Commander
  // Replays the recorded intents at the exact ticks they were originally submitted.
  // Returns the intent if tick matches, else empty array.

// src/adapters/llm.fixture.ts (stub only — not wired to any live model)
export function createLiveCommander(id: PlayerId): Commander
  // Throws "LiveLLMCommander: not available in test mode" if called without env var ENABLE_LIVE_LLM=true
```
how to implement: `ScriptedCommander` checks `observation.ownUnits.length` and the current phase to select an intent. `ReplayCommander` scans `recordedIntents` for the current tick and returns matching intents.
acceptance: `test/commanders.test.ts` asserts:
- `ScriptedCommander` produces at least one `expand` intent in the first 480 ticks.
- Two `ScriptedCommander`s with the same seed produce identical intent sequences over 1000 ticks (determinism).
- `ReplayCommander` emits the exact same intents as the `ScriptedCommander` that recorded them.
- `createLiveCommander` throws in test mode.
- `npm test` green.

---

**`R14` — Match state checksum and snapshot/restore**
dependsOn: `R05`, `R06`, `R07`, `R08`, `R11`
files: `src/snapshot.ts`, `test/snapshot.test.ts`
interface:
```ts
// src/snapshot.ts
export function checksumMatch(state: MatchState): string
  // djb2 hash of JSON.stringify({tick, unit_ids, unit_hps, resource_stocks, economy_minerals})
export function takeSnapshot(state: MatchState): string   // JSON.stringify(state)
export function restoreSnapshot(snap: string): MatchState
```
how to implement: `checksumMatch` hashes a minimal projection (tick + sorted unit ids + their HPs + resource stocks). `takeSnapshot`/`restoreSnapshot` are JSON round-trips. Note: `Map` objects in `FogState.lastKnownEnemies` must be serialized as sorted arrays.
acceptance: same-state → same checksum twice. `restoreSnapshot(takeSnapshot(state))` has identical checksum. `npm test` green.

---

**`R15` — Seed mission: expansion race + decoy + scripted enemy assault**
dependsOn: `R01`–`R14`
files: `src/scenarios/seed_mission.ts`, `test/seed_mission.test.ts`
interface:
```ts
// src/scenarios/seed_mission.ts
export type MissionResult = {
  checksums: string[];          // one per 100-tick checkpoint
  validatedIntents: ValidatedIntent[];
  rejectedIntents: RejectedIntent[];
  enemyObservationLog: Array<{ tick: Tick; visibleUnitCount: number; ghostCount: number }>;
};
export function runSeedMission(seed: Seed, ticks: number): MissionResult
// Setup:
//   Player: 3 workers at tile 5, 1200 minerals
//   Enemy: 3 soldiers at tile 45 (far side of 8×8 map), ScriptedCommander(enemy, prng.commander)
//   1 decoy: generated by generateDecoys at tick 0 (count=1)
//   Player fog range = 3 tiles; Enemy fog range = 3 tiles
// Each tick:
//   1. Compute player fog + enemy fog
//   2. Build player observation + enemy observation (independently filtered)
//   3. Commander acts on its observation → intents
//   4. Validate intents (player economy, enemy observation)
//   5. Apply validated intents to match state
//   6. Step match
//   7. Record checksum every 100 ticks
//   8. Log enemy observation stats
```
how to implement: wire all prior modules. The decoy appears in the enemy's observation. The enemy `ScriptedCommander` will attack once it has enough units — assert this happens deterministically.
acceptance: `test/seed_mission.test.ts` asserts:
- `runSeedMission(42, 2000)` completes without error.
- `result.checksums` has 20 entries.
- Two calls with seed=42 produce identical checksums (determinism).
- `result.enemyObservationLog` never contains a unit with `fog.visibility === "hidden"` (fog-soundness — cross-check against ground truth).
- `result.validatedIntents` is non-empty.
- Any intent in `result.rejectedIntents` has a non-empty `reason` and `auditId`.
- `npm test` green.

---

**`R16` — Determinism + snapshot/restore + adapter-independence tests**
dependsOn: `R15`, `R14`, `R13`
files: `test/determinism.test.ts`
interface: (test file only)
how to implement:
1. Run `runSeedMission(42, 2000)` twice. Assert all 20 checksums identical.
2. Snapshot/restore mid-match: run 1000 ticks, take snapshot, run 1000 more → `checksums[10..19]`. Restore snapshot, run 1000 more → assert same `checksums[10..19]`.
3. Record intents from the scripted-commander run. Create a `ReplayCommander` from those intents. Run the full match with `ReplayCommander` instead. Assert identical checksums.
4. Assert the simulation produces no unit HP < 0 at any checkpoint (non-negativity invariant).
acceptance: all assertions green, `npm test` green.

---

### Summary of first-slice cards

| id | title |
|---|---|
| R01 | Project scaffold and TypeScript config |
| R02 | Fixed-point arithmetic and LUT trig |
| R03 | Seeded PRNG tree |
| R04 | Map grid, unit model, and entity registry |
| R05 | Simulation clock and tick loop skeleton |
| R06 | Resource nodes and economy |
| R07 | Deterministic pathfinding (A* with tie-break) |
| R08 | Fog of war projection |
| R09 | Seeded decoy report generator |
| R10 | Fog-leak property test |
| R11 | Intent schema and typed intent log |
| R12 | Intent validator |
| R13 | Commander interface, ScriptedCommander, ReplayCommander |
| R14 | Match state checksum and snapshot/restore |
| R15 | Seed mission: expansion race + decoy + enemy assault |
| R16 | Determinism + snapshot/restore + adapter-independence tests |

**16 first-slice cards.**

---

### 3. The decomposition method for the rest

After the first slice passes, expand features with this recipe:

**Step 1 — Identify the new mechanic's invariant.**
Example: tech tree → invariant: a unit type cannot be produced unless its prerequisite is unlocked. State this before writing any code.

**Step 2 — Types-and-interface card.**
One small card with the exported types and function signatures. No implementation.

**Step 3 — Pure-function implementation card.**
All FP, no floats, no `Math.random()`. Reference `fp.ts` and `prng.ts`.

**Step 4 — Invariant test card.**
Property test: assert the invariant holds for all inputs in a fuzz loop.

**Step 5 — Wire into MatchState and the tick loop.**
One card adds the new state field to `MatchState`, calls the new step, and ensures `checksumMatch` covers it.

**Step 6 — Validator guard (if the feature has legal-action implications).**
Add a new rejection rule to `validateIntent` (one guard clause) and a test asserting it fires.

**Step 7 — Scenario fixture card.**
A function in `src/scenarios/` exercising the feature end-to-end.

---

**Worked example 1: Tech tree + unit production**
- `T01` — `src/tech.ts` types: `TechTree {unlocked: Set<string>}`, `TechNode {id: string; cost: FP; prerequisite: string | null}`. dependsOn: R01, R02.
- `T02` — `researchTech(tree, nodeId, economy, techCatalog)`: checks prerequisite unlocked, spends minerals (fpSub — conservation), adds `nodeId` to `unlocked`. dependsOn: T01, R06.
- `T03` — Test: researching without prerequisite throws; after prerequisite, succeeds; economy decreases correctly. dependsOn: T02.
- `T04` — Add validator rule: `tech` intent with unmet prerequisite → `"illegal_unit_type"` rejection. dependsOn: T03, R12.
- `T05` — Scenario: enemy ScriptedCommander researches tech in phase 2, then produces advanced unit. Assert the unit only appears after research. dependsOn: T04, R15.

**Worked example 2: Combat resolution**
- `CB01` — `src/combat.ts`: `resolveCombat(attacker: Unit, defender: Unit, prng: PrngStream): {attackerDmg: FP; defenderDmg: FP}`. Uses a damage roll via `nextIntBelow(prng.damage, maxDmg - minDmg + 1) + minDmg`. dependsOn: R02, R03.
- `CB02` — Test: same seed → same damage roll. Damage is always in `[minDmg, maxDmg]`. HP never goes negative after a kill (clamped to 0). dependsOn: CB01.
- `CB03` — Wire into `stepMatch`: for each unit with `kind === "attack"` order, call `resolveCombat` if target is in range. Remove units with `hp === 0`. dependsOn: CB02, R05.

**Worked example 3: Cooperative ally intent sharing**
- `A01` — `src/ally.ts`: `AllyPlan {proposedRoute: TileIndex[]; resourceReservation: FP; tick: Tick}`. Function `receivePlayerPing(ping: Intent, allyObservation: Observation): AllyPlan`. dependsOn: R08, R11.
- `A02` — Test: a `ping_ally` from player at tile X produces an `AllyPlan` with a route from ally base to X (via `findPath`). dependsOn: A01, R07.
- `A03` — `resolveResourceConflict(playerPlan, allyPlan, economy)`: if both plans reserve more than `economy.mineralsFP`, reduce ally reservation first (deterministic: ally defers). dependsOn: A02, R06.
- `A04` — Wire into `stepMatch`: ally commander receives ping intents, produces an `AllyPlan`, logs its reservation. dependsOn: A03, R05.

---

### 4. Per-task implementation conventions

**File/folder layout**
```
src/
  types.ts              — FP, Tick, Seed, EntityId, TileIndex, PlayerId
  fp.ts                 — Q16 fixed-point math
  lut.ts                — integer trig LUT
  prng.ts               — PRNG tree
  map.ts                — MapGrid, MapCell
  unit.ts               — Unit, Order, UnitType
  clock.ts              — SimClock
  sim.ts                — MatchState, stepMatch
  economy.ts            — ResourceNode, PlayerEconomy
  pathfinding.ts        — A* with tie-break
  fog.ts                — FogState, Observation, buildObservation
  decoys.ts             — generateDecoys
  intents.ts            — Intent, IntentLog, ValidatedIntent, RejectedIntent
  validator.ts          — validateIntent, ApmTracker
  snapshot.ts           — checksumMatch, takeSnapshot, restoreSnapshot
  commanders/
    commander.ts        — Commander interface
    scripted.ts         — ScriptedCommander
    replay.ts           — ReplayCommander
  adapters/
    llm.fixture.ts      — LiveLLMCommander stub (throws in test mode)
  scenarios/
    seed_mission.ts
test/
  *.test.ts
  fixtures/
```

**Naming**
- FP fields end in `FP` (e.g. `hpFP`, `mineralsFP`) to distinguish from display values.
- Commander implementations live in `src/commanders/` — never inline commander logic in `sim.ts`.
- All intents are structured objects, never strings or untyped objects.

**Writing a test (vitest snippet)**
```ts
// test/validator.test.ts
import { describe, it, expect } from "vitest";
import { validateIntent, createApmTracker } from "../src/validator.js";
import { buildObservation } from "../src/fog.js";
// ... setup ground truth, fog, economy ...

describe("intent validator — fog violation", () => {
  it("rejects attack on hidden cell", () => {
    const intent = { commanderId: "enemy" as PlayerId, intent: { kind: "attack", targetRegion: hiddenTile, forceRatio: toFP(1) }, submittedAtTick: 0 };
    const result = validateIntent(intent, enemyObservation, enemyEconomy, 0, tracker);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.reason).toBe("fog_violation");
  });
});
```

**Determinism rules**
- Always sort `Unit[]` by `id` before processing in `stepMatch`.
- Use `prng` streams as explicit arguments — never as module-level singletons.
- The `Observation` object is immutable — commanders read from it but must not store a reference that outlives the tick.

**The LLM adapter boundary (critical)**
- `LiveLLMCommander` in `src/adapters/llm.fixture.ts` must throw if `process.env.ENABLE_LIVE_LLM !== "true"`.
- Test code never imports `LiveLLMCommander` directly — it only imports from `src/commanders/commander.ts`.
- Any test that touches the `Commander` interface uses `createScriptedCommander` or `createReplayCommander`.

**Definition of done (any card)**
1. `npm test` is green.
2. `tsc --noEmit` has zero errors.
3. At least one test asserts the key invariant (fog-soundness, resource conservation, intent legality, or determinism).
4. No `Math.random()`, `Date.now()`, `Math.sin`, or raw floats in sim-state computations.
5. No `any` types.
6. No commander receives `MatchState` directly — only `Observation`.

---

### 5. Common pitfalls for a weak model on THIS project

**Pitfall 1: Using floats for unit positions**
The model will write `unit.x += 0.5 * velocity`. On different machines or with different JS engine versions, this can produce different sub-pixel positions, causing different combat ranges or pathfinding grid snaps, desynchronizing replays. Fix: all positions are Q16 FP integers. Use `fpAdd(unit.positionFP.x, speedFP)` and `fpClamp` to tile boundaries.

**Pitfall 2: Commander receiving ground truth instead of Observation**
The model may wire `stepMatch` to call `commander.act(matchState, tick)` directly. This leaks all enemy positions and breaks fog soundness — the fog-leak property test (R10) immediately fails. Fix: `commander.act` must only receive an `Observation`. The `buildObservation` function is the sole bridge; `MatchState` is never passed to a commander.

**Pitfall 3: Using `Math.sin`/`Math.cos` in the damage or movement calculations**
The model will write `Math.cos(angleRad)` for area-of-effect spread or projectile arcs. This is not reproducible across platforms. Fix: use `lutCos(degrees)` from `src/lut.ts` for all angular calculations. The LUT is built once at startup from `Math.cos` but is then a static integer array.

**Pitfall 4: Validator that only checks the first rejection rule**
The model may implement `validateIntent` with an early return after the first rule and miss adding subsequent rules. A fog-sound intent that is unaffordable then passes incorrectly. Fix: check all rules in order as explicit guard clauses, each returning a distinct rejection. The `test/validator.test.ts` tests each rule in isolation.

**Pitfall 5: ReplayCommander mismatching ticks**
The model may implement `ReplayCommander.act` to return all recorded intents at once, not filtering by tick. This causes all actions to fire on tick 0 and the rest to be silent, making the replay match differ from the original. Fix: `createReplayCommander` filters `recordedIntents` by `submittedAtTick === tick` in `act()` and returns only those.

**Pitfall 6: Nondeterministic fog.lastKnownEnemies Map iteration**
The model may use `Map.entries()` to build `lastKnownGhosts` in arbitrary insertion order. If the Map is rebuilt from a snapshot in a different order, the ghost list differs and the checksum breaks. Fix: always serialize `lastKnownEnemies` as a sorted array (by entity id) in `takeSnapshot`, and rebuild the Map in that order in `restoreSnapshot`.

**Pitfall 7: "Say" intents mutating state**
The model may implement `commander.act` to return a `say` intent and then have the validator write the text to a game-log data structure, which the checksum then hashes. A live LLM with different text would then produce a different checksum. Fix: `say` intents are *presentation only* — they are never written to `MatchState` and never included in `checksumMatch`. They are recorded in a separate `chatLog` structure that is excluded from checksums.
