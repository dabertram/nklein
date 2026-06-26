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

---

## Small-model build guide (3B-ready)

> This section is a mechanical execution guide. Assume the reader is a literal-minded 3B model that cannot infer unstated knowledge. Every card is independently verifiable. The seeded-RNG + pile-conservation property tests are the acceptance backbone — nothing advances until those invariants hold.

---

### 1. Glossary & ground rules

**Domain terms:**

- **Run**: one full game attempt. Has a `seed` (64-bit integer), a hero, a current deck, relics, and a map. All randomness derives from the seed.
- **Seed**: a 64-bit integer that initializes the run. Given the same seed and the same commands, the entire run is bit-for-bit reproducible.
- **RunRng**: the single owner of all randomness in a run. It holds multiple named sub-streams (see below). Scripts and combat never call `Math.random()`.
- **Sub-stream**: a seeded PRNG instance for one concern: `shuffleRng`, `cardRng`, `rewardRng`, `mapRng`, `aiRng`, `miscRng`. Each is initialized by hashing `(runSeed, streamName)` — never `runSeed + constant`.
- **PRNG**: a portable, committed, pure-integer pseudo-random number generator. Use xoroshiro128** or SplitMix64 — implemented in pure TypeScript `bigint` math. Never use `Math.random()`.
- **Combat deck**: the hero's cards active in a fight. Begins as a copy of the run deck (draw + discard + hand + exhaust + in-play = deck). Always conserved.
- **Draw pile**: the shuffled subset of the combat deck waiting to be drawn.
- **Discard pile**: played cards waiting to be reshuffled into the draw pile.
- **Exhaust pile**: cards permanently removed from the combat for this fight (not reshuffled).
- **Hand**: cards currently held by the player.
- **In-play**: cards currently being resolved (the queue is draining their effects).
- **Conservation invariant**: at all times, `|draw| + |hand| + |discard| + |exhaust| + |in-play| === |combat deck|`. Never breaks, including during effect resolution.
- **Action queue**: a FIFO/stack of atomic `CombatAction` objects (e.g. `DealDamage`, `GainBlock`, `ApplyStatus`, `MoveUnit`, `Push`, `Draw`, `Exhaust`). A card *enqueues* actions; the engine drains them one at a time; triggered effects enqueue new actions before the drain continues.
- **Effect timing**: the documented order in which action types resolve. Never deviate from the order stated in the spec.
- **Status**: a named modifier on a unit with a stack count (e.g. `Poison:3`, `Vulnerable:2`, `Weak:1`, `Frail:1`). Stacks decrement at defined moments (end-of-turn for most; Poison also deals damage before decrement).
- **Intent**: what an enemy is declared to do on its next turn, computed by a pure function of combat state. Must exactly match what the enemy does when its turn arrives.
- **Tile**: one cell of the tactical grid. Has coordinates `{col: number, row: number}` (integers only).
- **Terrain**: a property of a tile (floor, wall, hazard, temporary effect). Permanent terrain is in the map; temporary terrain is placed by card effects and expires on a given tick.
- **Push/pull**: forced movement. Resolves deterministically: pushed into a wall → no movement; pushed into another unit → the second unit is pushed first (chain), depth-limited.
- **Replay**: re-running a run from `(seed, commandList)` to reconstruct the identical combat log and final state.
- **Command**: a player decision recorded in the command list (e.g. `{ type: 'PlayCard', cardId, targetTile }`).
- **Golden-master test**: a test that serializes the final state of a canonical run and asserts it is byte-identical to a committed expected string.

**The pipeline for damage calculation (fixed order, integer math only):**
```
base damage
  + Strength (flat add, per hit)
  × (1 - 0.25 × Weak applied)    -- if attacker has Weak: 0.75× (floor)
  × (1 + 0.50 × Vulnerable applied) -- if target has Vulnerable: 1.5× (floor)
  - Block (subtract from result, floor at 0)
  → HP reduction (floor at 0 → death)
```
All multiplications use integer floor. Example: `base=7, Vulnerable` → `floor(7 × 1.5) = 10`.

**Stack:**

| Concern | Choice |
|---|---|
| Language | TypeScript (strict mode, no `any`) |
| Runtime | Node.js ≥ 20 |
| Test runner | Vitest (`npm test`) |
| Assertions | Vitest `expect` |
| Big integers | Native JS `bigint` for PRNG state |
| All sim math | Integer only — no `Math.floor` on floats in combat; use integer arithmetic |
| UI framework | React + Vite; Tailwind CSS v4 |
| No live services | All tests offline |

**Acceptance command:**
```
npm test
```
All tests offline. No network, no live services.

**Determinism ground rules (imperative):**
1. Never call `Math.random()` anywhere in `src/`. All randomness flows through `RunRng`.
2. Never call `Date.now()` in the simulation or combat core.
3. Each sub-stream seed is derived by `hashStreamSeed(runSeed, streamName)` — never `runSeed + constant`.
4. All combat math is integer. Never use `0.5` or floats in the damage pipeline.
5. The action queue drains in strict FIFO order. Triggered effects enqueue to the front (LIFO/stack within a drain step) — document which model you choose and never change it mid-implementation.
6. The combat deck conservation invariant holds after every single action — test this.

---

### 2. The explicit task graph for the first vertical slice

The first slice covers D8 items 1–8: seeded RNG → combat state → damage pipeline → grid → enemy AI → replay → UI → flagship test. Complete in order.

---

**`D01` — PRNG + RunRng with independent named sub-streams**

dependsOn: none

files: `src/core/prng.ts`, `src/core/run-rng.ts`, `test/core/prng.test.ts`

interface:
```typescript
// A committed, portable PRNG (xoroshiro128** or SplitMix64 — pick one, commit the algorithm).
export interface PrngState { s0: bigint; s1: bigint; } // for xoroshiro128**
export function prngNext(state: PrngState): { value: bigint; next: PrngState };
export function prngCreate(seed: bigint): PrngState;
export function prngNextInt(state: PrngState, max: number): { value: number; next: PrngState };
  // returns value in [0, max), integer; next is new state

// Hash function for deriving sub-stream seeds (avalanche-mixing — NOT seed+constant)
export function hashStreamSeed(runSeed: bigint, streamName: string): bigint;

// Named sub-streams
export type StreamName =
  | 'shuffleRng' | 'cardRng' | 'rewardRng' | 'mapRng'
  | 'aiRng' | 'miscRng';

export interface RunRng {
  streams: Record<StreamName, PrngState>;
}
export function createRunRng(runSeed: bigint): RunRng;
// Advance one stream by one step, return new RunRng (immutable)
export function rngDraw(rng: RunRng, stream: StreamName): { value: bigint; rng: RunRng };
export function rngDrawInt(rng: RunRng, stream: StreamName, max: number): { value: number; rng: RunRng };
```

how to implement:
1. Create `src/core/prng.ts`. Implement xoroshiro128** (the ** variant, not +) in pure `bigint`:
   - State: two 64-bit `bigint` values `s0`, `s1`.
   - Output: `((rotl(s0 * 5n, 7n)) * 9n) & 0xFFFFFFFFFFFFFFFFn`.
   - Advance: standard xoroshiro128 state update.
   - `prngCreate(seed)`: initialize via one round of SplitMix64 on the seed to avoid correlated initial states.
2. Implement `hashStreamSeed(runSeed, streamName)`: hash `(runSeed XOR BigInt(fnv1a32(streamName)))` through SplitMix64 two rounds. Never do `runSeed + i`.
3. Create `src/core/run-rng.ts`. `createRunRng(runSeed)` builds a `RunRng` by calling `hashStreamSeed` for each of the 6 stream names and initializing a PRNG state per name.
4. `rngDraw` and `rngDrawInt` advance the named stream and return a new `RunRng` (never mutate the old one).

acceptance: `test/core/prng.test.ts`:
- `prngCreate(42n)` followed by 10 steps produces the same sequence every run.
- `hashStreamSeed(1n, 'shuffleRng') !== hashStreamSeed(1n, 'cardRng')`.
- `createRunRng(100n).streams.shuffleRng` differs from `createRunRng(100n).streams.rewardRng` (first outputs are different — this is the anti-StS-correlation test).
- **Stream independence property**: for 20 different seeds, compute `rngDrawInt(createRunRng(s), 'shuffleRng', 1000).value` and `rngDrawInt(createRunRng(s), 'rewardRng', 1000).value`. Assert the Pearson correlation of these two sequences is < 0.3 (compute inline in the test — no external stats library needed).
Run `npm test` → green.

---

**`D02` — Core domain types: Card, Pile, CombatDeck, Unit, CombatState**

dependsOn: `D01`

files: `src/core/types.ts`, `test/core/types.test.ts`

interface:
```typescript
export type CardId = string;
export type UnitId = string;

export interface Card {
  id: CardId;
  name: string;
  cost: number;        // energy cost, integer ≥ 0
  type: 'attack' | 'skill' | 'power';
  rarity: 'common' | 'uncommon' | 'rare';
  upgraded: boolean;
}

export type Pile = 'draw' | 'hand' | 'discard' | 'exhaust' | 'in-play';

export interface CombatDeck {
  draw: CardId[];
  hand: CardId[];
  discard: CardId[];
  exhaust: CardId[];
  inPlay: CardId[];
  allCards: Map<CardId, Card>;
}

export function deckConservation(deck: CombatDeck): boolean;
  // true iff draw.length + hand.length + discard.length + exhaust.length + inPlay.length
  //           === allCards.size

export type StatusEffect = 'poison' | 'vulnerable' | 'weak' | 'frail' | 'strength' | 'dexterity' | 'block';

export interface Unit {
  id: UnitId;
  name: string;
  hp: number;
  maxHp: number;
  block: number;
  energy?: number;        // only for hero
  maxEnergy?: number;
  statuses: Partial<Record<StatusEffect, number>>;  // status → stack count
  tile: { col: number; row: number };
  isHero: boolean;
  isDead: boolean;
}

export interface CombatState {
  deck: CombatDeck;
  hero: Unit;
  enemies: Unit[];
  grid: { cols: number; rows: number; terrain: TerrainCell[][] };
  turn: number;
  phase: 'player' | 'enemy' | 'reward' | 'defeat';
  rng: RunRng;
  log: CombatEvent[];
}

export type TerrainType = 'floor' | 'wall' | 'hazard' | 'terrain-effect';
export interface TerrainCell { type: TerrainType; expiresOnTurn?: number; }
```

how to implement:
1. Create `src/core/types.ts`. Define exactly as above.
2. Implement `deckConservation(deck)` as shown.
3. All position and HP values are integers.

acceptance: `test/core/types.test.ts`:
- Build a `CombatDeck` with 10 cards, 3 in hand, 7 in draw. Assert `deckConservation` returns `true`.
- Move one card from draw to hand manually (via array splice). Assert `deckConservation` still `true`.
- Add a card to hand without removing from draw. Assert `deckConservation` returns `false`.
Run `npm test` → green.

---

**`D03` — Action queue resolver (core drain loop)**

dependsOn: `D02`

files: `src/core/combat-actions.ts`, `src/core/action-resolver.ts`, `test/core/action-resolver.test.ts`

interface:
```typescript
export type CombatAction =
  | { type: 'DealDamage'; targetId: UnitId; amount: number }
  | { type: 'GainBlock'; targetId: UnitId; amount: number }
  | { type: 'ApplyStatus'; targetId: UnitId; status: StatusEffect; stacks: number }
  | { type: 'MoveUnit'; unitId: UnitId; to: { col: number; row: number } }
  | { type: 'PushUnit'; unitId: UnitId; direction: { dc: number; dr: number }; squares: number }
  | { type: 'DrawCards'; count: number }
  | { type: 'ExhaustCard'; cardId: CardId }
  | { type: 'PlaceTerrain'; tile: { col: number; row: number }; terrainType: TerrainType; expiresOnTurn: number }
  | { type: 'TriggerOnDamage'; targetId: UnitId; damageDealt: number };

export interface CombatEvent {
  tick: number;
  action: CombatAction;
  resultSnapshot: Partial<{ hpAfter: number; blockAfter: number; statusesAfter: Partial<Record<StatusEffect, number>> }>;
}

// Drain the action queue. Returns new CombatState (immutable; does not mutate state).
// Triggered effects (traps, on-death, on-damage) enqueue new actions at the FRONT of the queue.
export function resolveActions(state: CombatState, queue: CombatAction[]): CombatState;
```

how to implement:
1. Create `src/core/combat-actions.ts` with the action type union.
2. Create `src/core/action-resolver.ts`. Implement `resolveActions`:
   - Loop while `queue.length > 0`. Pop the first action.
   - `DealDamage`: apply the damage pipeline (see §1) — compute final damage, reduce target block first, then HP. If HP ≤ 0, mark `isDead: true`. Append a `CombatEvent`. If the tile has a hazard, enqueue a new action for the hazard damage at the FRONT.
   - `GainBlock`: add to target's block.
   - `ApplyStatus`: add stacks (cap at defined limits — Poison and Vulnerable have no standard cap; Weak/Frail cap at 99).
   - `MoveUnit`: update tile.
   - `PushUnit`: compute new tile after push (check for walls/units blocking); if blocked by another unit, push that unit first (recurse, depth-limit 10 to prevent loops).
   - `DrawCards`: move N cards from draw to hand. If draw is empty, shuffle discard into draw (using `rng.shuffleRng`). After shuffle, check `deckConservation`.
   - `ExhaustCard`: move from in-play (or hand) to exhaust.
   - `PlaceTerrain`: set the terrain cell.
   - After every action, assert `deckConservation(state.deck)` — if it fails, throw (this is a bug, not a runtime error).
3. Append each resolved action to `state.log`.

acceptance: `test/core/action-resolver.test.ts`:
- Build a minimal `CombatState` with hero (HP 30, block 0) and one enemy (HP 20).
- Apply `[DealDamage(enemy, 5), GainBlock(hero, 3)]`. Assert enemy HP is 15; hero block is 3.
- Apply `[DealDamage(hero, 4)]` with hero block=3. Assert block becomes 0, HP reduces by 1 (not 4).
- Apply `[DrawCards(3)]` with 5 cards in draw. Assert hand grows by 3, draw shrinks by 3, `deckConservation` holds.
- Apply `[DrawCards(6)]` with only 2 cards in draw and 4 in discard. Assert reshuffle fires (discard → draw), all 6 end up in hand (2 from draw + 4 reshuffled), discard is empty, `deckConservation` holds.
Run `npm test` → green.

---

**`D04` — Damage / status pipeline (integer math, exact thresholds)**

dependsOn: `D03`

files: `src/core/damage-pipeline.ts`, `test/core/damage-pipeline.test.ts`

interface:
```typescript
// Compute final damage from attacker to target.
// All integer. Follows the documented pipeline (§1 of this guide).
export function computeDamage(
  baseDamage: number,
  attacker: Pick<Unit, 'statuses'>,
  target: Pick<Unit, 'statuses'>
): number;

// Apply damage to a unit — subtract block first, then HP. Returns updated unit.
export function applyDamageToUnit(unit: Unit, damage: number): Unit;

// End-of-turn status resolution for a unit.
// Order: Poison ticks (deal damage equal to stack, then decrement by 1) → Vulnerable/Weak/Frail decrement by 1 → Block cleared.
export function resolveEndOfTurnStatuses(unit: Unit): { unit: Unit; actions: CombatAction[] };
```

how to implement:
1. Create `src/core/damage-pipeline.ts`.
2. `computeDamage`: `base + attacker.statuses.strength ?? 0` → apply Weak if attacker has it (`Math.floor(result * 0.75)`) → apply Vulnerable if target has it (`Math.floor(result * 1.5)`) → clamp at 0.
3. `applyDamageToUnit`: subtract block first (floor at 0), remainder reduces HP (floor at 0). Return new `Unit` (immutable).
4. `resolveEndOfTurnStatuses`: for Poison — compute `DealDamage` action with amount = stack count, then decrement stack by 1 (remove if reaches 0). For Vulnerable/Weak/Frail — decrement by 1 each. Clear block (set to 0). Return updated unit + list of generated actions.

acceptance: `test/core/damage-pipeline.test.ts`:
- `computeDamage(7, {statuses:{}}, {statuses:{vulnerable:2}})` → `Math.floor(7 * 1.5) = 10`.
- `computeDamage(10, {statuses:{weak:1}}, {statuses:{}})` → `Math.floor(10 * 0.75) = 7`.
- `computeDamage(10, {statuses:{weak:1}}, {statuses:{vulnerable:1}})` → `Math.floor(Math.floor(10*0.75)*1.5) = Math.floor(7.5) = 10` (document the floor order and test it).
- `applyDamageToUnit({...unit, block:3, hp:10}, 5)` → block=0, hp=8 (5-3=2 damage to hp).
- `resolveEndOfTurnStatuses({...unit, statuses:{poison:3}})` → actions include `DealDamage(unit.id, 3)`, returned unit has `statuses:{poison:2}`.
Run `npm test` → green.

---

**`D05` — Tactical grid: movement legality, line-of-sight, push/pull**

dependsOn: `D03`

files: `src/core/grid.ts`, `test/core/grid.test.ts`

interface:
```typescript
// Can a unit move to the given tile? (Not occupied by another unit, not a wall, within bounds)
export function canMoveTo(state: CombatState, unitId: UnitId, to: { col: number; row: number }): boolean;

// Bresenham-style LoS: is there a clear line of sight between two tiles?
// Returns false if any wall tile or unit (other than from/to endpoints) lies on the line.
export function hasLineOfSight(state: CombatState, from: { col: number; row: number }, to: { col: number; row: number }): boolean;

// Resolve a push: compute the final tile after pushing unitId in direction (dc,dr) by 'squares' steps.
// Returns { finalTile, chainedPushes: CombatAction[] } — chain pushes for displaced units.
export function resolvePush(
  state: CombatState,
  unitId: UnitId,
  direction: { dc: number; dr: number },
  squares: number
): { finalTile: { col: number; row: number }; chainedPushes: CombatAction[] };

// Get all tiles within targeting template (e.g. 'adjacent', 'row', 'cone-forward', 'single')
export function getTargetTiles(
  state: CombatState,
  origin: { col: number; row: number },
  template: 'adjacent' | 'row' | 'column' | 'single' | 'all-enemies'
): Array<{ col: number; row: number }>;
```

how to implement:
1. Create `src/core/grid.ts`.
2. `canMoveTo`: bounds check, wall check, no-other-unit check.
3. `hasLineOfSight`: walk the integer Bresenham line from `from` to `to`; check each intermediate tile for walls. Units block LoS (important: a summon placed between scout and target breaks LoS — required scenario).
4. `resolvePush`: step `squares` times in direction; stop if wall or out of bounds (no further movement). If another unit is in the next cell, push IT first recursively (limit recursion depth to 10).
5. `getTargetTiles`: implement each template as a pure function over the grid.

acceptance: `test/core/grid.test.ts`:
- Build a 5×5 grid with a wall at (2,2). `hasLineOfSight(state, {col:0,row:2}, {col:4,row:2})` returns `false`.
- Remove the wall. `hasLineOfSight(...)` returns `true`.
- Place a unit (summon) at (2,2). `hasLineOfSight(...)` returns `false` (unit blocks LoS).
- `resolvePush` pushes a unit from (1,2) rightward 3 squares; a wall at (3,2) stops it at (2,2). Assert `finalTile === {col:2,row:2}`.
- `resolvePush` into another unit causes a chain push — both units move, final tiles correct.
Run `npm test` → green.

---

**`D06` — Fixture enemy AI + intent system**

dependsOn: `D05`

files: `src/core/enemy-ai.ts`, `src/core/intent.ts`, `test/core/enemy-ai.test.ts`

interface:
```typescript
export type IntentType = 'attack' | 'move' | 'defend' | 'special';
export interface EnemyIntent {
  type: IntentType;
  targetTile?: { col: number; row: number };
  damage?: number;          // for attack intent
  description: string;      // human-readable
}

// Compute what an enemy will do this turn — PURE FUNCTION.
// Must exactly match what executeEnemyTurn produces.
export function predictIntent(state: CombatState, enemyId: UnitId): EnemyIntent;

// Execute the enemy's turn (enqueues actions). Must produce exactly what predictIntent declared.
export function executeEnemyTurn(state: CombatState, enemyId: UnitId, rng: RunRng): { actions: CombatAction[]; rng: RunRng };

// Boss phase flip: returns the correct phase number based on HP fraction
export function getBossPhase(boss: Unit): number;  // 0 = full health; 1 = below half; etc.
```

how to implement:
1. Create `src/core/intent.ts` and `src/core/enemy-ai.ts`.
2. Define one fixture enemy type: `BasicSlime` (moves toward hero, attacks if adjacent, defends otherwise).
3. Define one boss: `FrostBoss` — phase 0 (above 50% HP): attacks for 10, moves toward hero. Phase 1 (≤50% HP): attacks for 15 + applies Vulnerable.
4. `predictIntent`: pure function. Reads combat state snapshot. No side effects. Computes the same answer as `executeEnemyTurn` will.
5. `executeEnemyTurn`: call `predictIntent` to get the intent, then enqueue the matching actions. **Assert inside the function**: `predictIntent result === what we're about to execute` (for the AI test invariant).

acceptance: `test/core/enemy-ai.test.ts`:
- Place a `BasicSlime` 2 tiles from the hero. `predictIntent` returns `move` intent toward hero.
- Move the hero adjacent. `predictIntent` returns `attack` intent with `damage === baseAttack`.
- For `FrostBoss` at 60% HP: `getBossPhase(boss) === 0`, attack damage is 10.
- Drop `FrostBoss` to 45% HP: `getBossPhase(boss) === 1`, `predictIntent` returns attack with damage 15 + Vulnerable.
- Assert `predictIntent(state, bossId).damage === executeEnemyTurn(state, bossId, rng).actions.find(a => a.type === 'DealDamage').amount` for every fixture.
Run `npm test` → green.

---

**`D07` — Replay: command-sourced reconstruction + golden-master test**

dependsOn: `D06`

files: `src/replay/replay.ts`, `src/replay/combat-log.ts`, `test/replay/replay.test.ts`

interface:
```typescript
export interface Command {
  type: 'PlayCard' | 'EndTurn' | 'UsePotion' | 'ChooseReward';
  cardId?: CardId;
  targetTile?: { col: number; row: number };
  rewardIndex?: number;
}

export interface CombatReplay {
  seed: bigint;
  initialState: CombatState;
  commands: Command[];
  finalState: CombatState;
  log: CombatEvent[];
}

// Run combat to completion given seed + commands. Pure — same inputs → same output always.
export function runCombat(seed: bigint, commands: Command[], enemyScript: EnemyScript): CombatReplay;

// Assert two replays are byte-identical (serialized JSON must match).
export function assertReplayDeterminism(seed: bigint, commands: Command[], enemyScript: EnemyScript): void;
```

how to implement:
1. Create `src/replay/replay.ts`.
2. `runCombat(seed, commands, enemyScript)`: construct `CombatState` from seed (create `RunRng`, set up hero + enemies from `enemyScript`, deal initial hand). Then process commands one by one — for each `PlayCard`, validate legality (card in hand, hero has energy, target is legal), enqueue actions, drain the queue. For `EndTurn`, run `resolveEndOfTurnStatuses` for all units, then run enemy turns in stable id order, then start new player turn (draw cards). Collect the log. Return the replay.
3. `assertReplayDeterminism`: call `runCombat` twice with the same arguments, serialize both to JSON, assert they are identical.
4. **Golden-master fixture**: define one canonical combat script (see D08 flagship test). Serialize `runCombat(42n, CANONICAL_COMMANDS, CANONICAL_SCRIPT)` to JSON. Commit that JSON as `test/fixtures/golden-replay.json`. The golden-master test asserts `runCombat(42n, ...)` still matches the committed file.

acceptance: `test/replay/replay.test.ts`:
- `assertReplayDeterminism(42n, [...], script)` passes (no assertion error).
- Golden-master: `runCombat(42n, CANONICAL_COMMANDS, CANONICAL_SCRIPT)` serialized to JSON equals the committed `test/fixtures/golden-replay.json`.
- After replaying, `deckConservation(replay.finalState.deck) === true`.
Run `npm test` → green.

---

**`D08` — Card rule system: play a card, enqueue effects**

dependsOn: `D07`

files: `src/cards/card-definitions.ts`, `src/cards/card-engine.ts`, `test/cards/card-engine.test.ts`

interface:
```typescript
export interface CardDefinition {
  id: string;
  name: string;
  cost: number;
  type: 'attack' | 'skill' | 'power';
  rarity: 'common' | 'uncommon' | 'rare';
  // Returns the actions to enqueue when this card is played
  play(hero: Unit, target: { tile?: { col: number; row: number }; unitId?: UnitId }, state: CombatState): CombatAction[];
  // Returns valid targets for this card
  getValidTargets(state: CombatState, hero: Unit): Array<{ col: number; row: number }>;
  upgradeId?: string;   // id of the upgraded version
  exhaust?: boolean;    // if true, card goes to exhaust after play instead of discard
  retain?: boolean;     // if true, card stays in hand at end of turn instead of discarding
}

// The minimum card set for the flagship test:
export const CARD_DEFINITIONS: Map<string, CardDefinition>;
  // Must include: Strike (deal 6 damage), Defend (gain 5 block),
  // PoisonDart (apply 3 Poison), PushShot (deal 5 + push target 1 tile),
  // TrapLayer (exhaust: place a hazard terrain tile adjacent to caster),
  // SummonGolem (summon an ally unit on target tile)

// Play a card: validate, spend energy, enqueue effects, move card to in-play.
export function playCard(state: CombatState, cardId: CardId, targetTile: { col: number; row: number } | null): { state: CombatState; actions: CombatAction[] };
```

how to implement:
1. Create `src/cards/card-definitions.ts` with the 6 required card definitions.
2. Create `src/cards/card-engine.ts` with `playCard`.
3. `playCard`: verify card is in hand, hero has enough energy, target (if required) is in `getValidTargets`. Subtract energy, move card from hand to in-play. Return the actions from `definition.play(...)` plus the correct card-move action (to discard, or to exhaust if `definition.exhaust`).

acceptance: `test/cards/card-engine.test.ts`:
- Playing `Strike` against an enemy: `DealDamage` action in the queue with amount 6. Enemy HP reduces. `deckConservation` holds.
- Playing `Defend`: `GainBlock(hero, 5)` in queue. Hero block increases.
- Playing `PoisonDart`: enemy gains `Poison: 3`. At end of turn, poison deals 3 damage, then stack becomes 2.
- Playing `TrapLayer` (exhaust): card goes to exhaust, not discard. A hazard terrain tile is placed. `deckConservation` holds.
- Playing a card with insufficient energy: `playCard` returns an error or throws (define a `CardPlayError` exception).
Run `npm test` → green.

---

**`D09` — Flagship seeded scenario: push-into-trap-then-poison (ordering invariant)**

dependsOn: `D08`

files: `test/scenarios/flagship-scenario.test.ts`, `src/scenarios/flagship-scenario.ts`

interface: no new production types; test + scenario fixture only.

how to implement:
1. Create `src/scenarios/flagship-scenario.ts` defining the canonical seeded combat scenario (seed=`42n`):
   - Hero starts with: `[Strike, Defend, PoisonDart, PushShot, TrapLayer]`.
   - Enemy: `BasicSlime` at tile (3,2); hero at (0,2). Grid 5×5.
   - Command sequence: place a `TrapLayer` at (1,2) → play `PoisonDart` on slime (3 Poison) → play `PushShot` on slime (pushes toward tile (1,2)) → end turn.
2. `test/scenarios/flagship-scenario.test.ts`:
   - Run the scenario with `runCombat(42n, FLAGSHIP_COMMANDS, FLAGSHIP_SCRIPT)`.
   - Assert the push lands the slime on the hazard tile.
   - Assert the hazard damage fires BEFORE the end-of-turn poison tick.
   - Assert end-of-turn poison deals 3 damage, then Poison stack becomes 2.
   - Assert the slime dies (if total damage ≥ HP) OR has the correct HP after all effects, verifiable by fixed expected HP value.
   - Assert `deckConservation` throughout.
   - Assert `assertReplayDeterminism` passes for this exact seed+commands.

acceptance: all assertions in `test/scenarios/flagship-scenario.test.ts` pass. The push-then-trap-then-poison ordering is explicitly asserted by checking `log` event order: `PushUnit` → `TriggerOnDamage (trap)` → `DealDamage (poison)`.
Run `npm test` → green.

---

**`D10` — Combat screen UI (grid, hand, intent icons, status chips, damage numbers)**

dependsOn: `D09`

files: `src/components/combat/CombatGrid.tsx`, `src/components/combat/CardHand.tsx`, `src/components/combat/StatusChip.tsx`, `src/components/combat/IntentIcon.tsx`, `test/components/combat/combat-ui.test.tsx`

interface:
```typescript
interface CombatGridProps {
  state: CombatState;
  selectedCard: CardId | null;
  validTargets: Array<{ col: number; row: number }>;
  onTileClick: (tile: { col: number; row: number }) => void;
}
export function CombatGrid(props: CombatGridProps): JSX.Element;

interface CardHandProps {
  deck: CombatDeck;
  allCards: Map<CardId, Card>;
  selectedCardId: CardId | null;
  heroEnergy: number;
  onSelectCard: (cardId: CardId) => void;
}
export function CardHand(props: CardHandProps): JSX.Element;

interface StatusChipProps { effect: StatusEffect; stacks: number; }
export function StatusChip(props: StatusChipProps): JSX.Element;

interface IntentIconProps { intent: EnemyIntent; }
export function IntentIcon(props: IntentIconProps): JSX.Element;
```

how to implement:
1. `CombatGrid`: render a CSS grid matching `state.grid.cols × state.grid.rows`. Each tile shows its terrain type. Units are rendered with their HP/block/status. Highlighted tiles (valid targets) have a distinct background class.
2. `CardHand`: render each card in `deck.hand` as a styled card frame. Cards costing more than `heroEnergy` appear dimmed. Clicking selects/deselects.
3. `StatusChip`: colored chip with effect name and stack count.
4. `IntentIcon`: icon + description for the enemy's telegraphed intent.

acceptance: `test/components/combat/combat-ui.test.tsx` (React Testing Library):
- Render `CombatGrid` with the flagship scenario initial state. Assert the grid has the correct number of tiles.
- Assert the hero and enemy are rendered in their correct tiles.
- Assert that valid-target tiles have a distinct CSS class when a card is selected.
- Render `CardHand` with 5 cards; hero energy=2. Assert 5 card frames visible; cards with cost > 2 have a "dimmed" class.
- Render `IntentIcon` with attack intent; assert it renders without crash.
Run `npm test` → green.

---

### 3. The decomposition method for the rest

After the first slice is green (all 10 cards pass, conservation holds, replay is golden-master stable), expand the remaining features using this method.

**The recipe:**

1. **Name the invariant the feature must never break.** For this project, invariants are always one of: (a) `deckConservation` holds throughout, (b) `runCombat(seed, commands)` is byte-identical on two runs, (c) `predictIntent === executedAction` for every enemy, (d) no `Math.random()` or `Date.now()` in `src/`.
2. **Write the acceptance test first.** The test checks: the invariants above still hold AND the specific behavior is correct (e.g. "push into trap fires before poison" — assert log order).
3. **Identify the prior card this depends on.** Add the `dependsOn` edge.
4. **Keep each card to one focused addition.** One new card definition, one new status effect, one new enemy — never "add the full card set."

**Worked example 1: Exhaust-creates-terrain card (D7 fixture)**

Decompose the "upgraded card exhausts + creates terrain" scenario into 3 cards:
- **`E01` — `TrapLayer+` card definition.** Create the upgraded version of `TrapLayer` — costs 0 instead of 1, places a stronger hazard. Add to `CARD_DEFINITIONS`. Acceptance: playing `TrapLayer+` enqueues `PlaceTerrain` + `ExhaustCard`; `deckConservation` holds.
- **`E02` — Terrain expiry.** Implement `tickTerrainExpiry(state, currentTurn): CombatState` — removes terrain tiles where `expiresOnTurn <= currentTurn`. Acceptance: a terrain tile placed at `expiresOnTurn:3` is absent in the state on turn 4.
- **`E03` — Terrain-expiry integration test.** Run a 4-turn seeded combat where `TrapLayer` is played on turn 1, the terrain expires on turn 2, and a push on turn 3 does NOT trigger the hazard. Acceptance: replay is deterministic; hazard is gone; push deals no hazard damage.

**Worked example 2: Boss phase flip (D7 fixture)**

Decompose the boss phase-change scenario into 2 cards:
- **`E04` — `FrostBoss` phase-1 definition.** Already partially done in D06. Extend: phase 1 also applies `Vulnerable:2` to the hero on attack. Acceptance: at ≤50% HP, `predictIntent` returns attack intent with Vulnerable application; `executeEnemyTurn` applies it. Assert in a test that at exactly the 50% HP tick, the intent switches.
- **`E05` — Boss phase regression replay.** Build a seeded combat that reaches the boss HP threshold. Assert the exact tick in the log where the phase flip occurs. Golden-master the log slice around the flip (ticks N-1 and N). Acceptance: replay is deterministic; the flip tick is the same every run.

**Worked example 3: Run generation (map + rewards)**

Decompose `generateRun(seed)` into 3 cards:
- **`E06` — Map node types.** Define `MapNode: { type: 'combat' | 'elite' | 'boss' | 'shop' | 'rest' | 'event'; depth: number }` and `RunMap`. Acceptance: type-checks pass.
- **`E07` — Deterministic map generation.** `generateRun(seed)` builds a `RunMap` using `mapRng`. Acceptance: `generateRun(42n)` twice produces identical maps (determinism test). Node distribution matches expected counts for the given seed (one hard-coded expected layout as a snapshot test).
- **`E08` — Reward draw is stream-independent.** After running a combat that consumes 10 `aiRng` draws, the reward offered by `rewardRng` is the same as if no combat happened (use two different seeds for `aiRng` and assert `rewardRng` output is identical — this is the anti-StS-correlation test for rewards).

---

### 4. Per-task implementation conventions

**Folder layout:**
```
src/
  core/            -- prng.ts, run-rng.ts, types.ts, combat-actions.ts, action-resolver.ts,
                   -- damage-pipeline.ts, grid.ts, enemy-ai.ts, intent.ts
  cards/           -- card-definitions.ts, card-engine.ts
  replay/          -- replay.ts, combat-log.ts
  run/             -- run-types.ts, run-generator.ts, run-state.ts
  scenarios/       -- flagship-scenario.ts
  components/
    combat/        -- CombatGrid.tsx, CardHand.tsx, StatusChip.tsx, IntentIcon.tsx
    ui/            -- shared primitives
  pages/           -- CombatPage.tsx
test/
  core/
  cards/
  replay/
  scenarios/
  components/combat/
  fixtures/        -- golden-replay.json, pgn-fixture files
```

**How to write a test in this stack (minimal Vitest snippet):**
```typescript
// test/core/conservation.test.ts
import { describe, it, expect } from 'vitest';
import { deckConservation } from '../../src/core/types.js';

describe('deck conservation', () => {
  it('holds after draw', () => {
    // ... build state, move a card, assert
    expect(deckConservation(deck)).toBe(true);
  });
});
```

**Keeping it deterministic:**
- Never use `Math.random()`. Import `rngDrawInt` from `run-rng.ts` and pass the `RunRng` through every function that needs randomness.
- All combat math is integer. Percentages use `Math.floor`. The damage pipeline is documented and immutable — never change the order.
- The action queue resolves in strict FIFO + front-enqueue-for-triggers order. This order is the spec. Never change it.

**How to write a conservation assertion:**
```typescript
// After every resolveActions call in tests:
expect(deckConservation(newState.deck)).toBe(true);
```
Add this assertion after every `resolveActions` call in every test. It is cheap and catches bugs immediately.

**Definition of done for any card:**
1. All acceptance tests pass under `npm test`.
2. TypeScript compiles with zero errors.
3. No `Math.random()`, `Date.now()`, or `fetch` added to `src/`.
4. `deckConservation` holds at every test assertion point.
5. `assertReplayDeterminism` passes for the flagship scenario (re-run it in every card that touches the resolver).

---

### 5. Common pitfalls for a weak model on this project

**Pitfall 1: Using `Math.random()` anywhere in the simulation.**
A 3B model will reach for `Math.random()` when it needs randomness. This breaks replay determinism immediately. The fix is strict: grep for `Math.random` in `src/` as part of every review; if found, replace with a `rngDrawInt(rng, streamName, max)` call and thread the updated `rng` through.

**Pitfall 2: Seeding sub-streams with `runSeed + 1`, `runSeed + 2`, etc. (the StS correlation bug).**
If two stream seeds differ only by a small constant, their first outputs may be correlated. Always derive sub-stream seeds by hashing `(runSeed, streamName)` through an avalanche mixer. The stream-independence test in D01 will catch this — but only if it's actually written. Never skip that test.

**Pitfall 3: Resolving effect-triggered actions out of order.**
The "push into trap, then poison" scenario requires the hazard trigger to fire BEFORE the end-of-turn poison tick. The action queue drain order must be explicit: triggered effects enqueue to the FRONT (so they resolve before the original queue continues). If a 3B model uses a plain FIFO (triggered effects go to the back), this test will fail. The fix is to use a two-array model: `[triggered...] + [remaining...]` at each drain step.

**Pitfall 4: Floating-point in damage math.**
`Math.floor(7 * 1.5)` = 10, correct. But if you store intermediate results as floats and chain multiple multipliers, you can get 9.99999... flooring to 9. Always compute integer × integer, then floor once at the end of each pipeline step. Document the exact floor point and test the edge cases (odd numbers with ×1.5).

**Pitfall 5: Cards not removed from `in-play` after resolution.**
After the action queue drains all effects from a played card, the card must move from `in-play` to `discard` (or `exhaust`). If the resolver does not do this explicitly, cards accumulate in `in-play` and `deckConservation` will catch it — but only if the assertion is present. Always add the `ExhaustCard` / discard action to the queue as part of `playCard`.

**Pitfall 6: `predictIntent` and `executeEnemyTurn` diverging.**
A 3B model may implement `predictIntent` and `executeEnemyTurn` separately, then subtly diverge (e.g. predictIntent uses one threshold for Vulnerable but executeEnemyTurn uses another). Fix: `executeEnemyTurn` must call `predictIntent` first and then execute exactly the intent returned — no separate logic. The test in D06 asserts this explicitly.

**Pitfall 7: Forgetting `dependsOn` on cards that import from earlier cards.**
The import graph for this slice: `D01 → D02 → D03 → D04 → D05 → D06 → D07 → D08 → D09 → D10`. Each card imports from all prior cards in its chain. If a model writes `D05` without importing `canMoveTo` from `D03`'s types, it will redefine the grid type and break the type system. Always list explicit `dependsOn` edges and import from the exact files named in those cards.
