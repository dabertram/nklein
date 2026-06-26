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
