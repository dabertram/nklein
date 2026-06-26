# 10 - Deterministic Multiplayer Tactical Game and Simulation Engine

Complexity tier: 10/20
Expected decomposition size: 30-34 dependent implementation cards before coding.
Domain pressure: turn-based tactics, deterministic simulation, netcode, fog of war, pathfinding, ability systems, replay verification.
Acceptance command: npm test

## How to use this challenge
This is a dev-test project specification for evaluating whether an autonomous coding agent can decompose a real domain, identify knowledge gaps, build a correct foundation, and verify it with deterministic tests. The goal is not to finish the entire product. The goal is to build a durable foundation that proves the agent understood the domain boundaries and can implement the highest-risk core behaviors without hiding behind placeholders.

The agent must read this entire specification before planning. It must create a dependency-linked plan, record domain knowledge debt, and choose a narrow release slice that still exercises the real hard parts. Prefer fewer production-quality vertical slices over many shallow labels.

## Product vision
Build the foundation for a real competitive multiplayer tactical game. The challenge is not visuals first; it is a deterministic rules engine with authoritative replay, fog of war, ability interactions, and network-ready command validation.

## Foundation release scope
The first serious buildout must include:
- Match, player, team, unit, map tile, terrain, vision state, command, ability, effect, initiative, objective, and replay models.
- Deterministic simulation loop that accepts player commands, validates them, applies effects, and emits a replay event log.
- Grid map engine with terrain costs, blocking, cover, elevation, line of sight, zones of control, and dynamic hazards.
- Ability system supporting targeted attacks, area effects, buffs, debuffs, interrupts, cooldowns, resources, status stacking, and resistances.
- Fog-of-war projection that creates per-player visible state without leaking hidden units or future random outcomes.
- Seeded random number handling with replay verification and desync detection.
- AI skirmish harness for deterministic smoke tests and balance fixture scenarios.
- Seed scenario with stealth units, overwatch, area denial, status interactions, and simultaneous objective pressure.

## Architecture requirements
- Keep simulation core pure and independent of rendering, input, transport, and storage.
- Represent commands and replay events as versioned serializable messages.
- Use deterministic math and seeded randomness; avoid Date.now and Math.random in the engine.
- Make visibility filtering a separate projection over authoritative state.

## Domain knowledge debt to surface
The agent should not pretend to know every regulation, standard, or numerical model perfectly. It should implement a defensible deterministic subset, mark assumptions explicitly, and create extension points where real-world integrations or expert-reviewed rule packs would live. Required knowledge areas:
- Multiplayer games fail when hidden information leaks through client state.
- Replay determinism requires controlled randomness and stable ordering of effects.
- Ability systems need explicit timing phases and stacking rules.
- Pathfinding must understand tactical rules, not just shortest distance.

## Decomposition pressure
This project should force decomposition across domain modeling, calculation or policy engines, workflow state, deterministic fixtures, auditability, and UI/view-model boundaries. The plan should include dependency links so shared primitives and invariants are built before dependent workflow features. Avoid starting with screens. Start with the domain model, invariants, and tests that would make later screens trustworthy.

The agent should maintain a visible knowledge-debt list covering unclear standards, units, legal or safety constraints, numerical assumptions, terminology, fixture limitations, and future expert-review checkpoints. Knowledge debt is not a failure; hiding it is.

## Acceptance criteria
- Golden replays produce identical hashes across repeated runs.
- Hidden units and hidden commands are absent from opponent projections.
- Pathfinding tests cover terrain, cover, blocking, elevation, and hazards.
- Ability interaction tests cover interrupt, status stack, area effect, and cooldown edge cases.
- The project passes npm test without a renderer.

## Explicit non-goals
- Do not start with a decorative game board and missing engine rules.
- Do not use nondeterministic randomness or wall-clock time in simulation tests.
- Do not trust the client for command legality.

## Quality bar
- Use typed domain objects and pure core modules wherever practical.
- Keep deterministic fixtures in the repository and do not depend on live APIs for acceptance tests.
- Test edge cases before building broad UI coverage.
- Every risk score, recommendation, workflow transition, or generated report must be explainable from source facts.
- Stubs are acceptable only at external integration boundaries and must be named as adapters with deterministic fixture implementations.
- The foundation should be extensible into a real product if later teams add integrations, expert-reviewed rule packs, and production UI.

---

# Extended scope & deep-reasoning extensions (v2)

> Added 2026-06-26 via deep domain research. The single hardest, most-defining property of this project is **byte-identical determinism**: the simulation core must be a pure, seeded, fixed-timestep state machine whose entire future is a function of `(initial_state, ordered_input_log, seed)` — so two machines (or two runs) fed the same inputs land on the *same bits*, a divergence is detected the tick it happens, and any match can be re-derived from its input log alone. Everything else (abilities, fog, AI) is content layered on that engine; if the engine is not bit-deterministic, none of it is trustworthy.

## E0. The meta-test: why determinism is the whole game

A tactical game's rules engine is *easy* to demo and *brutal* to make correct, because the failure mode is invisible until two clients disagree. The discipline that separates a real engine from a themed demo is treating the simulation as a **deterministic state machine under test**, exactly the way databases like FoundationDB and TigerBeetle treat their cores: a single-threaded, discrete-event simulator driven by a seeded PRNG, where "replay the exact failure from a seed" is a first-class capability and "simulate a whole match in milliseconds" is the unit test (https://antithesis.com/docs/resources/deterministic_simulation_testing/, https://notes.eatonphil.com/2024-08-20-deterministic-simulation-testing.html). The grading rubric is therefore not "how many abilities" but:

1. **Determinism** — does `simulate(state, inputs, seed)` produce a byte-identical event log and end-state hash on every run, machine, and (stretch) platform?
2. **No hidden-information leak** — can a player's projection *never* contain a hidden unit, a hidden command, or a not-yet-rolled random outcome, proven by construction rather than by hoping the renderer hides it?
3. **Replay integrity** — can any match be re-derived from its input log + seed, with a desync caught at the exact divergent tick via per-tick checksums (the GGRS `SyncTest` discipline: re-simulate the last *n* states every tick and compare checksums, firing on mismatch — https://docs.rs/ggrs/latest/ggrs/index.html)?
4. **Graceful weakness** — does it stay correct when the agent driving the build is a small local model that *will* reach for `Math.random()`, `Date.now()`, floats, and `Set`/`Map` iteration order? The architecture must make those mistakes *fail a test*, not ship a Heisenbug.

Everything below serves those four.

## E1. The deterministic simulation kernel (the foundation under the foundation)

Build this before any unit, ability, or tile exists. It is the first ~6–8 cards and every later card depends on it.

- **Fixed-timestep, integer logical time.** The sim advances in discrete ticks (e.g. a turn is decomposed into ordered *sub-phases*; a real-time-with-pause variant would use a fixed `dt`). No wall clock anywhere in core. A `Tick` is an integer; all durations, cooldowns, and durations-remaining are integer tick counts. This mirrors the lockstep gold standard: "given the same initial state and the same sequence of inputs, the simulation will always produce identical results" (https://www.snapnet.dev/blog/netcode-architectures-part-1-lockstep/, https://gafferongames.com/post/deterministic_lockstep/).
- **No floating point in the simulation core — fixed-point only.** Float results diverge across compilers, optimization levels, x87-vs-SSE, fused-multiply-add, and transcendental implementations, which makes cross-machine float determinism effectively impossible (https://gafferongames.com/post/deterministic_lockstep/). Use a **Q16.16 / Q32.32 fixed-point type backed by 64-bit integers** for any non-integer math (movement interpolation, partial cover modifiers, damage falloff): Q16.16 "relies on standard integer ALU instructions which are consistent across architectures, guaranteeing bit-identical numerical results on x86, ARM, RISC-V, and WASM" (https://mikelankamp.github.io/fpm/, https://github.com/mrdav30/FixedMathSharp). Trig/sqrt (for LOS rays, AoE radii) come from **deterministic lookup tables or CORDIC**, never the platform `Math.*` (https://github.com/mrdav30/FixedMathSharp). Provide a tiny `fixed` module (add/mul/div/sqrt/sin/cos/atan2) and **ban `number`-float math in the core via a lint/test guard.**
- **Seeded PRNG tree.** A single splittable seeded generator (e.g. a counter-based / SplitMix-style PRNG) is the *only* source of randomness — hit/miss rolls, crit, scatter, AI tie-breaks. Streams are **split deterministically by purpose** (one substream per system) so adding a new consumer can't shift another system's roll sequence. Replaces "all randomness with `deterministicRandom()` so the same seed yields the same execution path every time" (https://pierrezemb.fr/posts/diving-into-foundationdb-simulation/). The PRNG state is part of saved game state.
- **Deterministic ordering everywhere.** Never iterate a hash-map/`Set` whose order is insertion- or hash-dependent for anything that affects state. Units, effects, and pending events resolve in a **stable, explicitly-sorted order** (by `unitId`, then a deterministic tiebreak). "Replay determinism requires controlled randomness and stable ordering of effects" — this is in the base spec for a reason; reordering effect application is the single most common silent desync.
- **Event-sourced authoritative state.** The match's truth is an **append-only event log** (`CommandValidated`, `EffectApplied`, `RandomRolled`, `UnitDied`, `VisionRevealed`, …). The renderable/queryable `MatchState` is a *fold* over that log. This gives free replay, time-travel, audit, and snapshot/restore. A **snapshot** is a serialized fold checkpoint; restoring it + replaying the tail must reproduce state exactly.
- **The time-machine harness.** `simulateMatch(scenario, seed, commandLog) -> { endStateHash, eventLog }` runs a whole match headless in milliseconds, can snapshot at any tick, kill and restore from the snapshot, and assert invariants throughout. **The flagship test is a golden replay: a canonical match whose end-state hash and full event-log hash are pinned, asserted byte-identical on every run.**

## E2. Rollback-readiness without shipping live netcode (the netcode seam, made testable)

The base spec says "network-ready command validation." The acceptance command must **not** touch a real network — but the engine must be *shaped* so production rollback netcode (GGPO/GGRS-style) drops in later. That shape is itself the test target.

- **Implement the GGRS request contract in-process.** The engine exposes exactly the three operations a rollback session needs: `saveState(tick) -> StateHandle`, `loadState(handle)`, `advanceFrame(inputs)`; the driver issues them as a request stream (`SaveGameState | LoadGameState | AdvanceFrame`), mirroring GGRS's mandatory `GgrsRequest` handling (https://docs.rs/ggrs/latest/ggrs/index.html). A local "session driver" fixture replaces the network.
- **The SyncTest is a core acceptance test, not an afterthought.** Port GGRS's `SyncTestSession`: every tick, **re-simulate the last `check_distance` frames from a saved state and compare per-frame checksums to the originals; any mismatch is a hard test failure** with the diverging tick reported (https://docs.rs/ggrs/latest/ggrs/index.html, https://github.com/gschup/ggrs). This is what actually catches a non-deterministic ability or an unstable sort, and it is the cheapest, highest-value determinism test you can own.
- **Input model: delay + a bounded prediction window.** Commands carry the tick they apply to. Model **input delay** (a few ticks, e.g. 2–3 at 60 Hz) and a **bounded prediction/rollback window** (≈6–9 frames; real implementations keep prediction under ~100–150 ms because beyond that "tends to get unplayable quickly" — https://www.snapnet.dev/blog/netcode-architectures-part-2-rollback/). Exceeding the window must **stall (wait for input)**, never silently fabricate state — and the engine must guard against the **"spiral of death"** where re-simulation cost exceeds the per-frame budget (https://www.snapnet.dev/blog/netcode-architectures-part-2-rollback/). Prediction uses **repeat-last-input** (`PredictRepeatLast`), the GGRS/industry default, because "incorrectly predicting that a remote player takes an action is a far worse experience than predicting they do nothing" (https://www.snapnet.dev/blog/netcode-architectures-part-2-rollback/).
- **State serialization is a first-class requirement.** Saving/loading the whole sim state must be cheap and lossless — ideally the state is a compact, contiguously-serializable structure (the "one big struct you can memcpy" ideal) so save/restore during rollback is fast (https://www.snapnet.dev/blog/netcode-architectures-part-2-rollback/). Transient cosmetic effects are *not* in sim state; only "this effect occurred" facts are.
- **Versioned, serializable messages.** Commands and replay events are **versioned schemas** (the base spec requires this) so an old replay can be migrated or explicitly rejected, never silently mis-replayed.

## E3. The visibility/projection seam — provable no-leak fog of war (the security spine)

In competitive games, "multiplayer games fail when hidden information leaks through client state" (base spec). Make non-leakage **structural and property-tested**, not a rendering convention.

- **One authoritative state; per-seat projections are pure functions over it.** `project(authoritativeState, seatId) -> PlayerView` is a *narrowing* function: it can only ever *remove* information. A `PlayerView` for seat A is a distinct type that **cannot represent** an enemy unit A can't see, an enemy's queued command, a not-yet-revealed map tile, or a future random roll. This is the base spec's "make visibility filtering a separate projection over authoritative state," hardened into a type boundary.
- **Vision is computed deterministically** from tiles, elevation, LOS (fixed-point/integer ray or shadowcasting), stealth/detection stats, and zones of control — and **recomputed as a projection**, never mutated ad-hoc.
- **The anti-leak property test (load-bearing).** For a randomized battery of states and seats: `project(s, A)` must be **invariant to every hidden detail** — fuzz by mutating only A-invisible facts of `s` (enemy positions out of vision, enemy queued orders, undrawn RNG) and assert `project(s, A)` is byte-identical. Any change means a leak. This is the fog-of-war analogue of a security boundary and is exactly the kind of by-construction guarantee weak models can't accidentally violate without turning a test red.
- **Simultaneous / "We-Go" resolution done right.** Tactics that resolve both sides' orders together (decision phase → execution phase, a.k.a. phase-based/"We-Go" — https://grokipedia.com/page/Turn-based_tactics) must collect *all* seats' commands **before** any reveal, then resolve in deterministic phase/initiative order, so no seat's projection leaks the other's intent mid-turn. Sequential (initiative-ordered) resolution is the simpler variant of the same engine.

## E4. The ability/effect timing machine (the rules spine)

The base spec demands interrupts, cooldowns, status stacking, resistances, AoE. The hard part is **timing and ordering**, where ad-hoc code silently desyncs.

- **Explicit phase/timing-window state machine.** Every action resolves through ordered, named windows (e.g. `Declare → CostPay → PreHit/Interrupt → Roll → Apply → OnHit/Reaction → Cleanup`). Interrupts and overwatch/reactions fire **only** in their declared windows. "Ability systems need explicit timing phases and stacking rules" (base spec) — encode them as data + a state machine, not nested `if`s.
- **Deterministic stacking & resistance algebra.** Status effects compose by **typed, order-independent rules** (or an explicitly-ordered one): refresh-vs-stack-vs-strongest-wins, max-stack caps, diminishing returns, resist/immunity. The result of applying a set of effects must be a **pure function of the multiset + a deterministic application order**, so the SyncTest can't catch a divergence.
- **Resource & cooldown integerization.** AP/mana/cooldowns are integer tick/charge counts; no float decay.
- **Reaction loops must terminate.** Interrupt-triggers-interrupt chains need a **bounded depth / fixed-point resolution** so a reaction cascade can't loop forever or diverge by evaluation order.

## E5. Tactical pathfinding & the determinism it demands

"Pathfinding must understand tactical rules, not just shortest distance" (base spec). Make it deterministic and tactically real.

- **Deterministic A\*/Dijkstra over a weighted grid** with terrain move-cost, blocking, **cover**, **elevation**, **zones of control** (entering a ZoC ends/limits movement), and **dynamic hazards** (fire/gas tiles that change cost over ticks). Ties broken by a **stable rule** (deterministic tiebreak on node id) so equal-cost paths are reproducible — a classic silent-nondeterminism source.
- **Reachability, threat, and LOS** are computed from the same integer/fixed-point primitives the renderer never gets to influence. Pathing tests cover terrain, cover, blocking, elevation, and hazards (an explicit acceptance criterion).

## E6. The desync forensics & adversarial fixture pack (red-team as a test asset)

A determinism engine should ship its own hostility, so a small model can't quietly reintroduce nondeterminism.

- **The "two engines" differential test.** Run the same scenario through the engine twice under different conditions that *must not* matter (different insertion order into internal collections, a snapshot/restore in the middle, a split simulate-vs-rollback path) and assert **identical event-log + end-state hashes**. This is the metamorphic relation "reordering irrelevant things changes nothing" (https://arxiv.org/pdf/2211.12003).
- **Nondeterminism tripwires (each is a failing-test fixture):** a fixture that smuggles a float into damage math; one that iterates a `Set` for effect order; one that calls a non-seeded RNG; one that reads wall-clock for a cooldown. Each must be **caught by the SyncTest or the differential test**, proving the guards work.
- **The desync localizer.** When checksums diverge, a harness **bisects the tick range and dumps the first divergent event** (state-diff of the two folds), turning "it desynced somewhere in a 5000-tick match" into "tick 1342, effect application order differs." This is the practitioner's core debugging tool ("when the hashes diverge, you know the exact tick where the problem started" — https://bugnet.io/blog/how-to-debug-multiplayer-desync-issues-in-games).
- **Replay-tamper detection.** A replay whose input log was altered (or produced under a different rules version) must fail validation rather than silently producing a different match.

## E7. The AI skirmish harness (deterministic opponents = free coverage)

The base spec wants an "AI skirmish harness for deterministic smoke tests." Make AI a **pure, seeded policy** (`decide(view, seed) -> commands`) over the *projected* view only (never the authoritative state — the AI must obey fog too, or it leaks). Two AIs playing a seeded match is a complete, fast, deterministic integration test that exercises movement, abilities, fog, hazards, and objectives end-to-end — and doubles as a balance-fixture generator.

## E8. Global invariants (property-based, this is how the engine is graded)

Beyond example tests, assert **system-wide invariants** as property tests across randomized + scripted matches (metamorphic / invariant testing — https://antithesis.com/docs/resources/property_based_testing/):

1. **Determinism / replay** — `simulate(scenario, seed, inputs)` twice yields **byte-identical** event logs and end-state hashes; a snapshot+restore mid-match changes nothing.
2. **SyncTest cleanliness** — re-simulating the last `check_distance` frames every tick never mismatches a checksum.
3. **No hidden-information leak** — `project(s, seat)` is invariant under mutation of any seat-invisible fact (E3), for all seats, all states.
4. **Conservation / legality** — resources (HP, AP, charges) never go negative or exceed caps; every state change traces to a validated command + applied effect (no spontaneous mutation); the **client is never trusted for legality** (illegal commands are rejected pre-apply).
5. **Causality & monotonicity** — ticks are monotonic; an effect can only depend on facts at-or-before its tick; no future RNG draw influences a current projection.
6. **Termination** — reaction/interrupt cascades and pathfinding always terminate (bounded depth / closed sets).
7. **Replay integrity** — every match is reconstructable from `(scenario, seed, input-log)`; a tampered or wrong-version replay fails validation.

Plus a **chaos mode**: random snapshot/restore, random rollback depths within the window, fault-injected dropped/late inputs (forcing prediction + reconciliation), and assert all invariants still hold.

## E9. The concrete first vertical slice (the on-ramp — build THIS first, ~14–18 of the 30–34 cards)

Do **not** spread the first slice across many abilities and a UI. Prove the spine end-to-end on a tiny scenario:

- The **deterministic kernel** (E1): fixed-point module + ban-floats guard, seeded split-PRNG, integer tick loop, event log, snapshot/restore, end-state hashing.
- The **GGRS-style request contract + SyncTest** (E2) wired to a local session driver, green on the slice.
- A **2-unit-per-side scenario** on a small grid with: deterministic A\* over terrain + one cover tile + one elevation step + one ZoC, one targeted attack with a seeded hit roll, one AoE with a fixed-point radius, one status effect with a stacking rule and a cooldown, and one overwatch/interrupt in its timing window.
- **Fog-of-war projection** (E3) with the anti-leak property test, including one stealth unit and the simultaneous (We-Go) reveal ordering.
- The **two-AI seeded skirmish** (E7) playing that scenario headless to completion.
- The **golden replay** + **differential test** + at least **two nondeterminism tripwires** (E6) and the **global invariants** (E8) green on this slice.

If that slice is bit-deterministic and leak-free, every later ability and screen is content on a proven engine. If it isn't, no amount of UI saves it — the same lesson the base spec states as "build the engine before the board."

## E10. Domain knowledge-debt to track (surface, don't bluff)

- **Cross-platform vs single-binary determinism.** True bit-determinism across OS/arch/WASM is achievable with strict fixed-point but is *expensive to guarantee*; record explicitly whether the slice claims **single-binary determinism** (table stakes) or **cross-platform** (stretch), since real lockstep games still see a **0.1–1% desync rate** in the wild (https://bugnet.io/blog/how-to-debug-multiplayer-desync-issues-in-games) and serialization/float edge cases are the usual cause.
- **Anti-cheat / authority model.** Lockstep clients see all inputs (so map-hacks are possible); a server-authoritative variant hides state but costs bandwidth (https://www.snapnet.dev/blog/netcode-architectures-part-1-lockstep/). Flag which trust model the design assumes and what a production version would need (input validation, server reconciliation, replay audit).
- **Balance rule-packs need expert review.** Damage curves, stacking rules, and initiative formulas are *content*, not engine truth — mark them as expert-reviewable rule packs behind the deterministic engine, never hard-coded constants pretending to be balanced.
- **Replay format compatibility.** A versioning/migration policy for replays and command schemas is a real maintenance burden; record it as debt rather than implying replays are forever-compatible.

## E11. Why this is a great !Klein challenge

This project is a **determinism crucible** that is *unusually unforgiving of exactly the mistakes a small local model makes by default*: it will reach for `Math.random()`, `Date.now()`, floats, and unordered-collection iteration — and here every one of those turns a test red rather than shipping a silent Heisenbug. So the spec's value isn't "can the model write an ability"; it's "can good decomposition + invariant tests + a SyncTest make a *fallible* model produce a **bit-deterministic, leak-free** engine." It stresses clean decomposition (kernel before content), property-based reasoning (invariants over examples), and the discipline of a pure core behind hard seams (projection, timing, pathfinding). The reward is legible and beautiful: a headless match that replays byte-for-byte, a fog projection that *cannot* leak, and a desync localizer that pinpoints the exact tick — a small swarm proving real engineering rigor on a domain where rigor is the whole point. **Build the kernel + SyncTest + no-leak projection (E1–E3, E8) first; earn the rest.**
