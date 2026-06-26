# 27 - Tactical Deckbuilder Roguelike Arena

Complexity tier: 27/35 game block
Expected decomposition size: 75-90 dependent implementation cards before coding.
Domain pressure: deckbuilding games, tactical grid combat, roguelike runs, procedural encounters, card rules, status effects, encounter balance, combat presentation.
Acceptance command: npm test

## How to use this challenge
This is a game dev-test project specification for evaluating whether an autonomous coding agent can decompose real game systems, implement deterministic simulation logic, and build a polished presentation layer that makes the game understandable and desirable. The goal is not to finish the whole game. The goal is to build a product-grade foundation that proves the agent understands rules, simulation state, player experience, rendering, and verification.

The agent must read this entire specification before planning. It must create a dependency-linked plan, record domain knowledge debt, identify engine and presentation invariants, and choose a release slice that exercises the highest-risk mechanics. For game projects, visual presentation is mandatory, not a stretch goal. A correct simulation hidden behind ugly placeholder UI is not enough.

## Product vision
Build a tactics-first deckbuilding roguelike where cards drive movement, attacks, summons, traps, and terrain manipulation on a small grid. The challenge is to combine deterministic card resolution with tactical positioning, run progression, rewards, and a presentation layer that feels like a real game.

## Target players and users
- Strategy players who enjoy tactical grid positioning and card synergies.
- Designers tuning enemies, encounters, relics, upgrades, and run pacing.
- Streamers or testers who need replayable seeds and readable combat logs.
- Modders who want future data-driven cards and encounters.

## Foundation release scope
The first serious buildout must include:
- Run, seed, hero, deck, draw pile, discard pile, exhaust pile, card, energy, unit, enemy, tile, terrain, effect, status, relic, reward, encounter, and combat-log models.
- Deterministic combat loop with turn order, draw/discard, energy, legal card targeting, movement, attack resolution, status ticks, death, loot, and victory/defeat states.
- Card rules engine supporting damage, block, movement, push/pull, area effects, summons, traps, terrain change, card draw, exhaust, retain, upgrade, and conditional effects.
- Tactical AI for deterministic fixture enemies using threat maps, target selection, movement goals, intent preview, and scripted boss phases.
- Procedural run generator with seedable map nodes, encounter difficulty, elite fights, shops, rest sites, events, rewards, and boss selection.
- Deck progression system for card rewards, upgrades, removals, relics, archetype synergies, and run history.
- Replay and combat log that can reconstruct every card draw, random roll, damage event, and decision from the seed and command list.
- Seed run with poison/control, movement combo, summon build, trap build, elite fight, and multi-phase boss.

## Gameplay requirements
- Cards must produce meaningful positional choices, not only numerical damage.
- Enemy intent previews should be accurate enough for tactical planning but still allow interesting deterministic AI behavior.
- Run rewards must create archetype decisions and opportunity costs.
- Every random outcome must be seeded and replayable.

## Presentation requirements
Very nice presentation is mandatory for this challenge. The agent must treat rendering, animation, interaction feedback, and layout polish as core acceptance criteria. Required presentation work:
- The combat screen must have a polished grid, animated units, readable card hand, enemy intent icons, status chips, damage numbers, and clear targeting previews.
- Card art can be generated or stylized placeholders, but each card must have a coherent frame, iconography, rarity, cost, type, and effect text layout.
- Animations must communicate play order: draw, card hover, targeting, impact, status tick, death, reward reveal, and map progression.
- The UI must not rely on dense raw JSON logs; the log is secondary evidence behind a playable presentation.
- Responsive layout must keep cards, grid, and intent readable on laptop and desktop widths.

## Architecture requirements
- Separate deterministic combat core, card rule definitions, enemy AI, run generation, reward economy, replay system, and rendering.
- Represent card effects as composable typed actions with validation and generated preview data.
- Use seeded RNG owned by the run state, never ambient randomness.
- Make combat logs machine-readable and presentation-friendly.

## Domain knowledge debt to surface
The agent should not pretend to know every game design, simulation, AI, rendering, or balancing detail perfectly. It should mark assumptions, build deterministic subsets, and preserve extension points for future designers, artists, balance passes, and live integrations. Required knowledge areas:
- Deckbuilders require strict pile semantics and careful effect timing.
- Tactical grids need movement legality, line of sight, area selection, and terrain interaction.
- Roguelike runs need replayable seeds and transparent randomness.
- Presentation clarity matters because players must understand complex cause and effect quickly.

## Required challenge scenarios
The implementation plan and fixtures should be shaped around scenarios like these. They do not all need full UI coverage in the first slice, but the core model and presentation should be capable of representing them:
- A card pushes an enemy into a trap and then a poison status kills it at end of turn.
- A summon blocks line of sight and changes enemy movement intent.
- An upgraded card exhausts itself but creates a temporary terrain tile.
- A boss phase changes its intent rules after losing half health.
- The same seed and command list reproduce identical combat and reward choices.

## Decomposition pressure
This challenge should force decomposition across rules or simulation engine, deterministic fixtures, AI or policy layers, replay/save state, player-facing presentation, UI interaction, diagnostics, and test harnesses. The plan should include dependency links so core state, commands, invariants, and golden tests are built before rendering depends on them. Avoid starting with a visual mock that cannot play the game; also avoid building a correct but lifeless engine with no usable presentation.

The agent should maintain a visible knowledge-debt list covering unclear rules, balance assumptions, AI limitations, rendering tradeoffs, asset gaps, accessibility concerns, performance constraints, and future designer review checkpoints. Knowledge debt is not a failure; hiding it is.

## Acceptance criteria
- Combat tests cover pile transitions, targeting legality, area effects, movement, statuses, summons, traps, upgrades, and boss phases.
- Run generator tests prove deterministic map, rewards, and encounter selection from seeds.
- Replay tests reconstruct combat state and final outcome exactly.
- Enemy AI tests produce stable intent and movement choices across fixtures.
- Presentation checks verify readable cards, grid, status icons, target previews, and no overlapping combat panels.
- The project passes npm test with no live services.

## Explicit non-goals
- Do not build a card list without tactical combat.
- Do not use nondeterministic random draws in tests.
- Do not make enemy intent decorative or inaccurate.
- Do not ship placeholder UI that hides card and grid interactions.

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

> Added 2026-06-26 via deep domain research. **The single hardest, most-defining property of this project is *seed-perfect determinism through a stateful combat engine with many interacting effect timings*: a deckbuilder's bugs live in resolution order (does the trap trigger before or after the poison tick? does Vulnerable apply to the push-damage?) and in correlated/leaky RNG. The proof is a property-based replay backbone — `(seed, commandList) → byte-identical combat + reward state, every run, with strict pile-conservation and decoupled RNG streams.** Build the deterministic combat kernel + replay first; cards, AI, and presentation are downstream of a resolver you can *prove* reproducible.

This section adds the load-bearing rigor that separates a real tactics-deckbuilder from "a card list with HP bars." It is grounded in how shipped deckbuilders actually implement determinism — especially **Slay the Spire's multi-stream seeded RNG** and the **subtle correlation bug** its community reverse-engineered — and in **Into the Breach's perfect-information deterministic combat**, and it makes determinism + invariants the `npm test` backbone.

## D0. The grading thesis: a deckbuilder is a deterministic state machine wearing card art

The naive version draws `Math.random()` cards, resolves effects in whatever order the code happens to loop, and "balances" by vibes. It will desync its own replays and produce un-debuggable combat. The disciplined version is:

1. **Determinism** — `runCombat(seed, commands)` and `generateRun(seed)` produce **byte-identical** logs and final state on every machine, every run.
2. **Conservation** — cards are *conserved*: every card is in exactly one pile (draw / hand / discard / exhaust / in-play) at all times; `Σ piles == deck` is an invariant that never breaks mid-resolution.
3. **Order-correctness** — effect timing (triggers, status ticks, deaths, push-into-hazard chains) follows one explicit, documented resolution order; the same inputs always resolve the same way.
4. **Telegraph fidelity** — enemy intent shown to the player is *exactly* what the enemy will do (Into-the-Breach-grade perfect information), so tactical planning is honest.

Everything below serves those four. The flagship test is **a multi-phase seeded combat (the "poison+control / movement-combo / summon / trap / elite / boss" required scenario) replayed from `(seed, commandList)` to a byte-identical final state, with pile-conservation and taint-free RNG asserted throughout.**

## D1. The seeded RNG architecture (and the real bug to NOT ship)

This is the most authentic, most instructive seam, and there is a famous real-world failure to learn from.

- **Multiple independent RNG streams, one run seed.** Slay the Spire derives a run from a 64-bit seed and spins up **separate generators per concern** — `monsterRng, eventRng, merchantRng, cardRng, treasureRng, relicRng, potionRng, monsterHpRng, aiRng, shuffleRng, cardRandomRng, miscRng` — so that two players on the same seed get the *same* card rewards even if they take different actions in between (consuming one stream doesn't shift another). ([forgottenarbiter, "Correlated Randomness in Slay the Spire"](https://forgottenarbiter.github.io/Correlated-Randomness/); [Andy Tockman, "Correlated randomness in Slay the Spire 2"](https://tck.mn/blog/correlated-randomness-sts2/)) **Adopt this: a `RunRng` owns a fixed set of named sub-streams; combat draws never perturb the reward stream.** (Base spec: "seeded RNG owned by the run state, never ambient randomness" — here made concrete.)
- **The bug to avoid (ship the *fix*, and a test that proves you avoided it).** StS seeded every stream from *the same* `Settings.seed`, and because `java.util.Random`/`System.Random` produce a **first output that is nearly a linear function of the seed**, streams whose seeds differed by small amounts produced **correlated** outputs — e.g. "if your first card reward is uncommon, a potion also drops." ([forgottenarbiter](https://forgottenarbiter.github.io/Correlated-Randomness/); [HN discussion](https://news.ycombinator.com/item?id=48552844); the community "RNG Fix" decorrelates by avalanche-mixing each stream's seed: [sts2-rng-fix](https://github.com/ing-gom/sts2-rng-fix)) **The correct approach: derive each sub-stream seed by hashing `(runSeed, streamName)` through a strong mixer (SplitMix64 / a hash, not seed+constant) so streams are statistically independent.** Ship a **property test: pairwise correlation of the first outputs of all sub-streams is ~0** across many run seeds — i.e. observing one stream gives no information about another. This single test elevates the project above the shipped game it's modeled on.
- **Choose a portable PRNG with a defined bit-exact algorithm** (e.g. a documented xoroshiro128**/PCG/SplitMix64 in pure integer/`bigint` math) and **commit it**; never rely on the platform's `Math.random()` (unspecified, non-reproducible). Replay determinism requires the generator's bitstream be identical everywhere.

## D2. The combat resolution model (the timing seam where bugs hide)

Card games are notorious for **effect-ordering** bugs. Make the order explicit and data-driven.

- **Action queue, not nested calls.** Model resolution as a **queue/stack of atomic actions** (`DealDamage`, `GainBlock`, `ApplyStatus`, `MoveUnit`, `Push`, `Summon`, `Draw`, `Exhaust`, `TriggerOnX`) that the engine drains deterministically — the canonical deckbuilder architecture (Slay the Spire's `GameActionManager` resolves a queue; community frameworks "use custom action queue systems to separate game visuals from game logic"). A card *enqueues* actions; triggered effects (on-damage, on-death, on-block-broken, traps) enqueue *new* actions that resolve before the queue empties. **The drain order is the spec; document and test it.**
- **Pile semantics are strict and conserved.** Draw → hand → (play) → discard / exhaust; **reshuffle discard→draw when draw is empty, using the dedicated `shuffleRng` stream**; **exhaust** removes from the combat deck for the fight; **retain** keeps a card across the end-of-turn discard. Every transition is an action; the **conservation invariant** (every card in exactly one pile; counts sum to the deck) is checked after every action in tests. ([Slay the Spire mechanics overview](https://slay-the-spire.fandom.com/wiki/Combat_Mechanics))
- **Damage & status pipeline (deterministic, ordered).** Adopt the StS-style modifier pipeline: base damage → **Strength** (flat add) → **Weak** (−25% dealt) → target **Vulnerable** (+50% taken) → **Block** absorbs → remainder hits HP; **Block** is gained with **Dexterity** (flat add) and reduced by **Frail** (−25% gained). ([Combat Mechanics](https://slay-the-spire.fandom.com/wiki/Combat_Mechanics); [StS mechanics](https://slaythespire.wiki.gg/wiki/Mechanics)) **End-of-turn resolution order is fixed** (e.g. *relics/powers → poison/burn ticks → debuff decrement → block expiry*), matching the "resolves in the order powers → cards" convention, and is asserted by the required scenario *"push enemy into trap, then poison kills it at end of turn"* — which only passes if push-damage, trap-trigger, and poison-tick order is exactly right.
- **Tactical grid layer.** Movement legality, **line-of-sight** (a summon blocking LoS changes enemy intent — a required scenario), area/template targeting, **push/pull** with chain resolution (pushed unit into another unit / hazard / off-grid), and terrain effects (a card creating a temporary terrain tile on exhaust — a required scenario). Positions/HP/energy are **integers**; if any geometry needs sub-cell math, use **fixed-point**, never floats, to keep replays byte-identical (see D5).

## D3. Enemy AI & intent: perfect-information determinism (Into the Breach as the model)

Intent must be *honest* and *deterministic*, which is what makes tactical planning fair and the replay reproducible.

- **Telegraphed, accurate intent.** Like Into the Breach — "all enemy movements and attacks are fully telegraphed… no critical hits, no unexpected misses, no events that aren't telegraphed a turn in advance" ([Into the Breach, Wikipedia](https://en.wikipedia.org/wiki/Into_the_Breach); [Atomic Bob-Omb, "Into the Breach & Enemy Intentions"](https://atomicbobomb.home.blog/2020/05/17/into-the-breach-enemy-intentions/)) — the intent shown is *exactly* the action that will execute, computed by a **pure function of the (visible) combat state + `aiRng`**. The base spec's non-goal "do not make enemy intent decorative or inaccurate" becomes an invariant: **`predictIntent(state) === actionTakenNextTurn(state)`** for every fixture enemy.
- **Deterministic resolution order.** Into the Breach resolves in a fixed sequence (environment → fire/electric → Vek attacks in a stated order → spawns), and "the order enemies move is the order they attack in." ([gamepressure Into the Breach guide](https://guides.gamepressure.com/into_the_breach/guide.asp?ID=43635)) Adopt a **stable enemy action order** (by unit id / initiative) so multi-enemy turns are reproducible.
- **AI via threat maps / target selection**, not scripted-but-hidden randomness: enemies score targets/moves deterministically; **boss phase changes** (intent rules flip after losing half HP — a required scenario) are explicit state transitions, tested for the exact tick they trigger.

## D4. Replay & combat log: the reconstruction backbone

- **Command-sourced replay.** The authoritative record is `(seed, initialRunConfig, orderedCommandList)`; the engine **re-derives** all randomness from the seeded streams and all state from the commands. `replay(seed, commands)` must reconstruct **every card draw, every random roll, every damage event, and every reward choice exactly** (base spec requirement) — proven by a **golden-master test**: serialize the final state + log of a canonical run and assert byte-stability.
- **Two-audience log.** The combat log is **machine-readable** (structured events for replay/tests) *and* **presentation-friendly** (human-readable causality for the UI), but the UI must not be "dense raw JSON" (base spec) — the structured log is evidence *behind* a playable presentation. Every visible number (a damage value, a block amount, a reward) is **traceable to its source event** — the deckbuilder analogue of the exemplar's evidence graph: "this 14 damage = base 6 +3 Strength, ×1.5 Vulnerable, −0 Block."
- **Snapshot/restore for tests.** Combat state is serializable; a test can snapshot mid-combat, fork two command continuations, and assert each replays deterministically — the property-based core.

## D5. Determinism & testability strategy (no live services, no wall clock, no floats in sim math)

- **No ambient randomness / no wall clock in the simulation core.** All RNG flows from the run's seeded streams (D1); any timing (animation pacing) lives in the presentation layer and **never** feeds simulation. Tests construct a run from a seed and a command list — nothing else.
- **Integer / fixed-point simulation math.** HP, energy, block, positions, status stacks are integers. **Floating-point arithmetic is not reproducible across compilers/CPUs/JS engines** — the classic source of replay desync ([Gaffer On Games, "Floating Point Determinism"](https://gafferongames.com/post/floating_point_determinism/); [DEV, "Deterministic Physics in TS: Why I Wrote a Fixed-Point Engine"](https://dev.to/shaisrc/deterministic-physics-in-ts-why-i-wrote-a-fixed-point-engine-4b0l)). If any computation needs fractions (e.g. a ×1.5 Vulnerable on an odd base), define the **exact rounding rule** (e.g. `floor` after the multiply, matching StS) and test it — *don't* let `0.5`-rounding drift. Prefer **fixed-point (Q16.16) integers** for any geometric/percentage math so results are bit-identical everywhere.
- **Everything external is a fixture adapter.** No live services exist in this game, so "external" mostly means *generated content* (card/relic/enemy data) and *assets* — data-driven definitions live in-repo as deterministic fixtures; card art may be stylized placeholders but each card still has a coherent typed frame (cost/type/rarity/effect), per the base spec.
- **Run generation is pure over the seed.** `generateRun(seed)` → map nodes, encounter difficulty, elites, shops, rests, events, rewards, boss — all from `mapRng/eventRng/...`, reproducibly (base spec: "deterministic map, rewards, and encounter selection from seeds").

## D6. Property-based invariants & acceptance (beyond example tests)

Assert system-wide invariants across **randomized + scripted** runs (the rubric the exemplar sets):

1. **Determinism** — `runCombat(seed, commands)` twice ⇒ identical event logs; `generateRun(seed)` twice ⇒ identical maps/rewards.
2. **Card conservation** — at every action boundary, every card is in exactly one pile and `Σ piles == combatDeck`; no card duplicated or lost by any effect (exhaust/retain/summon/shuffle included). Fuzz with random legal command sequences.
3. **Resource non-negativity / bounds** — energy never negative; spending requires sufficient energy; block never negative; HP clamps at 0 (death) and at max; status stacks within defined caps.
4. **RNG stream independence** — pairwise first-output correlation across sub-streams ≈ 0 over many seeds (D1) — the anti-StS-bug test.
5. **Intent fidelity** — `predictedIntent === executedAction` for every fixture enemy across random states (D3).
6. **Legal-targeting totality** — a card may only resolve against targets its rules permit; illegal targets are rejected before any state change (no partial mutation).
7. **Replay sufficiency** — the structured log alone (UI prose redacted) reconstructs final HP, deck, and reward choices for a canonical run.

Plus a **chaos pass**: random legal command streams against random seeds, asserting (1)–(4) and (6) never break — fuzzing the resolver is how you find the trap-vs-poison ordering bug before a player does.

## D7. Adversarial / edge-case fixture pack (the "this separates real from demo" suite)

- **Push-into-trap-then-poison-kill** (ordering): push damage + trap trigger + end-of-turn poison must kill in the exact documented order; flip the order and the test must fail.
- **Lethal-reshuffle**: draw pile empties mid-turn forcing a `shuffleRng` reshuffle; the post-shuffle draw order is seed-deterministic and conservation holds.
- **Summon-blocks-LoS**: a summon changes enemy target/intent; `predictIntent` updates accordingly and matches execution.
- **Exhaust-creates-terrain**: an upgraded card exhausts itself *and* spawns a temporary terrain tile that expires on a defined tick.
- **Boss half-HP phase flip**: intent rules change at exactly the HP threshold; tested for the precise tick and the new intent set.
- **Chain-push off-grid / into another unit**: forced-movement chains resolve deterministically without infinite loops or lost units.
- **Same-seed-different-path reward stability**: two command sequences that reach the same reward node draw identical rewards (the multi-stream guarantee).
- **Status-cap & decrement boundaries**: Vulnerable/Weak/Frail decrement at the right step; Poison ticks then decrements; an effect that would exceed a stack cap clamps deterministically.

## D8. The concrete first vertical slice (the on-ramp — build THIS first, ~30–45 cards)

1. **Seeded `RunRng` with hashed independent sub-streams** + the committed portable PRNG + the stream-independence property test (D1).
2. **Combat state model + action queue resolver** with strict pile semantics and the **conservation invariant** (D2).
3. **The damage/block/status pipeline** (Strength/Vulnerable/Weak/Dexterity/Frail/Poison/Block) with the fixed end-of-turn order, in integer/fixed-point math (D2, D5).
4. **Tactical grid**: movement legality, LoS, targeting templates, push/pull chains, one terrain effect (D2).
5. **One deterministic fixture enemy + intent** with `predictIntent === execute` fidelity, and one **boss phase flip** (D3).
6. **Command-sourced replay + structured/presentation log**, with the golden-master byte-stable replay test (D4).
7. **The polished combat screen**: grid, animated units, readable hand, **intent icons**, status chips, damage numbers, targeting previews — rendering from engine state, with presentation tests (readability, no overlap, intent legibility).
8. **The flagship seeded scenario** (poison+control / movement-combo / summon / trap / elite / multi-phase boss) replaying byte-identically with all invariants green.

If that slice is real, run generation, deck progression (rewards/upgrades/removals/relics/archetypes), shops/events, and full content are **breadth on a proven, replay-correct spine.**

## D9. Domain knowledge-debt to surface (track, don't bluff)

- **Balance is a designer pass, not a solved problem**: card/relic/enemy numbers are placeholders; flag where playtesting/tuning is needed (run economy, archetype power curves, elite/boss difficulty).
- **Rounding conventions** for percentage modifiers (Vulnerable ×1.5 on odd HP, Weak/Frail ×0.75) — pick one (document + test), note it may differ from any reference game.
- **RNG-correlation subtleties** (the StS lesson) — documented with citation and the mitigation chosen.
- **Intent-vs-randomness tension**: how much hidden AI variation is acceptable while keeping intent honest (Into-the-Breach is fully deterministic; many deckbuilders allow seeded enemy choice) — flagged as a design decision.
- **Accessibility** (colorblind-safe status chips, damage-number readability, reduced-motion mode) and **performance** (large boards / many summons) — flagged for designer/engineering review.

## D10. Why this is a great !Klein challenge

A tactics-deckbuilder is an excellent small-local-LLM decomposition target because correctness is **externally checkable by replay**: a swarm of weak agents builds the resolver incrementally and *knows* it's right when `(seed, commands)` replays byte-identically and conservation never breaks — no human judgment, no flaky oracle, no live dependency. The hard seams (decorrelated multi-stream RNG, action-queue effect ordering, pile conservation, honest deterministic intent) are legible, dependency-ordered, and each gated by a property-based test. It stresses **determinism under weak models, stateful long-combat correctness, RNG discipline, and faithful presentation of complex causality** — and it is genuinely *fun* to watch the colony land the exact resolution order that makes "push into trap, poison finishes it" work on the first replay.
