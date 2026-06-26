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

---

## Small-model build guide (3B-ready)

> This section is the mechanical on-ramp. A 3B model reading this must be able to follow it card-by-card without needing to be clever. Every card is independently implementable and verifiable. Read E1–E9 above first; this section operationalizes them.

---

### 1. Glossary & ground rules

**Domain terms:**
- **Tick** — integer logical time unit; the only time the simulation knows. Never use `Date.now()`, `performance.now()`, or `setTimeout` in any core module.
- **Fixed-point (Q16.16)** — integer arithmetic where the low 16 bits are the fractional part. Value `n` represents the real number `n / 65536`. All non-integer math in the engine uses this type, never JavaScript `number` floats.
- **PRNG** — seeded pseudo-random number generator. The engine has exactly one, split into per-system sub-streams. Never call `Math.random()` in core code.
- **Event log** — append-only array of typed events (`CommandValidated`, `EffectApplied`, `RandomRolled`, `UnitDied`, etc.). The visible match state is derived by folding this log; the log itself is the source of truth.
- **Snapshot** — a serialized copy of folded state at a specific tick. Restoring a snapshot and replaying subsequent events must reproduce identical state.
- **End-state hash** — a deterministic hash (e.g. SHA-256 or a pure-JS equivalent) of the serialized final match state. Two runs of the same scenario with the same seed must produce the same hash.
- **Projection** — a pure function `project(authState, seatId) -> PlayerView` that removes all information the seat cannot see. Never mutates authoritative state.
- **PlayerView** — the narrowed, per-seat view type. It cannot represent enemy units out of vision, queued enemy commands, or future random outcomes.
- **SyncTest** — a correctness harness that re-simulates the last N ticks from a saved state every tick and compares per-tick checksums to the originals. Any mismatch is a hard failure.
- **OIV (Operational Intent Volume)** — not used here; see project 17.
- **ZoC (Zone of Control)** — a tactical concept: entering a tile adjacent to an enemy unit costs extra move points or ends movement.
- **We-Go** — simultaneous-resolution turn structure: all players submit commands in the decision phase; all commands are revealed and executed together in the execution phase.
- **CBS/GGRS** — Conflict-Based Search (MAPF); GGRS is a rollback-netcode framework. Only the GGRS-style `saveState/loadState/advanceFrame` request contract is implemented here (no live network).

**Stack:**
- Language: TypeScript (strict mode, `noImplicitAny: true`)
- Runtime: Node.js (no browser globals in core)
- Test runner: `npm test` runs all tests (e.g. Vitest or Jest — use whichever is in `package.json`)
- No external math libraries; fixed-point is implemented from scratch in `src/engine/fixed.ts`
- No network, no file I/O in tests — fixture maps and scenarios live as TypeScript objects in `test/fixtures/`

**Ground rules (repeat these to yourself before every card):**
1. Never use `Math.random()` in `src/engine/` — use `src/engine/prng.ts` only.
2. Never use `Date.now()` or wall-clock time anywhere in core.
3. Never use JavaScript `number` for computed values in the engine — use the `Fixed` type from `src/engine/fixed.ts`.
4. Never iterate a `Set` or `Map` whose order is not explicitly pinned.
5. Every core function must be pure (no side effects, no I/O).
6. Every acceptance test runs offline: no network, no live services.
7. The acceptance command is `npm test`. It must pass green before a card is done.

---

### 2. The explicit task graph for the first vertical slice

The first vertical slice covers E1–E3, E6–E8 from the v2 section. It has **16 cards** (S01–S16). Build them in order; each depends only on prior cards.

---

**S01 — Project scaffold & TypeScript config**
dependsOn: none
files: `package.json`, `tsconfig.json`, `src/engine/.gitkeep`, `test/.gitkeep`

interface: none (configuration only)

how to implement:
1. Create `package.json` with `"type": "module"`, a `"test"` script that runs Vitest (`vitest run`), and dev dependencies: `vitest`, `typescript`.
2. Create `tsconfig.json` with `"strict": true`, `"noImplicitAny": true`, `"target": "ES2022"`, `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`.
3. Create empty placeholder files so the directory structure exists.

acceptance: `npm test` runs and exits 0 with "no test files found" (or equivalent). No TypeScript errors on an empty project.

---

**S02 — Fixed-point type (Q16.16)**
dependsOn: S01
files: `src/engine/fixed.ts`, `test/engine/fixed.test.ts`

interface:
```typescript
// src/engine/fixed.ts
export type Fixed = bigint; // Q16.16: real value = n / 65536n
export const FIXED_ONE: Fixed = 65536n;
export const FIXED_ZERO: Fixed = 0n;

export function toFixed(integer: number): Fixed;      // integer * 65536
export function fromFixed(f: Fixed): number;          // f / 65536 (for display only, never for engine logic)
export function fixedAdd(a: Fixed, b: Fixed): Fixed;
export function fixedSub(a: Fixed, b: Fixed): Fixed;
export function fixedMul(a: Fixed, b: Fixed): Fixed;  // (a * b) >> 16n
export function fixedDiv(a: Fixed, b: Fixed): Fixed;  // (a << 16n) / b
export function fixedCmp(a: Fixed, b: Fixed): -1 | 0 | 1;
export function fixedSqrt(a: Fixed): Fixed;           // integer Newton-Raphson, never Math.sqrt
export const FIXED_HALF: Fixed;  // 32768n
```

how to implement:
1. Create `src/engine/fixed.ts`.
2. Implement all functions using only bigint arithmetic — no `Math.*` calls anywhere.
3. `fixedSqrt`: use integer Newton-Raphson on bigints (5–10 iterations converge); test against known squares.
4. Export all symbols.
5. Write `test/engine/fixed.test.ts` with the assertions below.

acceptance: `test/engine/fixed.test.ts` asserts:
- `fixedAdd(toFixed(3), toFixed(4)) === toFixed(7)`
- `fixedMul(toFixed(3), toFixed(4)) === toFixed(12)`
- `fixedDiv(toFixed(10), toFixed(4)) === toFixed(2) + 32768n` (i.e. 2.5 in Q16.16)
- `fixedSqrt(toFixed(9)) === toFixed(3)`
- `fixedSqrt(toFixed(2))` is between `toFixed(1)` and `toFixed(2)` (irrational, check bounds only)
- `fromFixed(toFixed(7))` equals `7` (JavaScript number)
`npm test` → green, no floats in implementation.

---

**S03 — Seeded split-PRNG**
dependsOn: S02
files: `src/engine/prng.ts`, `test/engine/prng.test.ts`

interface:
```typescript
// src/engine/prng.ts
export type PrngState = { s0: bigint; s1: bigint }; // splitmix64 state
export type PrngStream = { state: PrngState; streamId: number };

export function createPrng(seed: bigint): PrngState;
export function splitStream(root: PrngState, streamId: number): PrngStream;
export function nextUint32(stream: PrngStream): { value: number; next: PrngStream };
// Returns integer in [0, max). Pure: always returns the same next state for the same input.
export function nextIntBelow(stream: PrngStream, max: number): { value: number; next: PrngStream };
```

how to implement:
1. Implement SplitMix64 in bigints: `s = s + 0x9E3779B97F4A7C15n; s = ((s ^ (s >> 30n)) * 0xBF58476D1CE4E5B9n) & 0xFFFFFFFFFFFFFFFFn; ...` (standard SplitMix64 mixing).
2. `splitStream`: derive a new `PrngState` by calling the root with `streamId` as a salt (e.g. `createPrng(root.s0 ^ BigInt(streamId))`).
3. All functions are pure — they return the next state, never mutate.
4. Write `test/engine/prng.test.ts`.

acceptance: `test/engine/prng.test.ts` asserts:
- Two calls to `createPrng(42n)` produce the same state.
- `nextUint32` called 100 times on the same initial stream produces the same sequence every run.
- `splitStream(root, 1)` and `splitStream(root, 2)` produce different sequences.
- No call to `Math.random()` appears in `src/engine/prng.ts` (check by reading the file in the test or via a static lint rule).

---

**S04 — Core domain types**
dependsOn: S02
files: `src/engine/types.ts`

interface:
```typescript
// src/engine/types.ts
export type Tick = number;          // integer, never fractional
export type UnitId = string;
export type PlayerId = string;
export type TeamId = string;
export type TileCoord = { x: number; y: number }; // integer grid coordinates

export type Terrain = 'open' | 'cover' | 'elevated' | 'blocking' | 'hazard';
export type Tile = { coord: TileCoord; terrain: Terrain; elevation: number; };

export type UnitStatus = 'normal' | 'stunned' | 'overwatch' | 'dead';
export type Unit = {
  id: UnitId;
  teamId: TeamId;
  coord: TileCoord;
  hp: number;          // integer, [0, maxHp]
  maxHp: number;
  ap: number;          // action points, integer
  maxAp: number;
  status: UnitStatus;
  cooldowns: Record<string, Tick>;   // abilityId -> tick when available
  stealthLevel: number;  // 0 = visible, higher = harder to detect
};

export type MatchState = {
  tick: Tick;
  units: Map<UnitId, Unit>;
  tiles: Map<string, Tile>;  // key: `${x},${y}`
  eventLog: GameEvent[];
  prngStreams: Record<string, import('./prng.js').PrngStream>;
};

export type GameEvent =
  | { type: 'CommandValidated'; tick: Tick; unitId: UnitId; command: Command }
  | { type: 'EffectApplied'; tick: Tick; targetId: UnitId; delta: number; source: string }
  | { type: 'RandomRolled'; tick: Tick; streamId: string; value: number }
  | { type: 'UnitDied'; tick: Tick; unitId: UnitId }
  | { type: 'VisionRevealed'; tick: Tick; seatId: PlayerId; unitId: UnitId };

export type Command =
  | { kind: 'Move'; unitId: UnitId; path: TileCoord[] }
  | { kind: 'Attack'; unitId: UnitId; targetId: UnitId; abilityId: string }
  | { kind: 'EndTurn'; unitId: UnitId };

export type Scenario = {
  tiles: Tile[];
  units: Unit[];
  teams: Array<{ id: TeamId; playerIds: PlayerId[] }>;
  seed: bigint;
};
```

how to implement:
1. Create `src/engine/types.ts` with all the types above.
2. No logic — types only.
3. Write a trivial `test/engine/types.test.ts` that imports every type and creates one instance of each to confirm no TypeScript errors.

acceptance: `test/engine/types.test.ts` compiles and passes. `npm test` → green.

---

**S05 — Match state initialization & event log fold**
dependsOn: S03, S04
files: `src/engine/state.ts`, `test/engine/state.test.ts`

interface:
```typescript
// src/engine/state.ts
import { Scenario, MatchState, GameEvent } from './types.js';
import { createPrng, splitStream } from './prng.js';

export function initMatchState(scenario: Scenario): MatchState;
// Returns a MatchState with tick=0, units from scenario, tiles indexed, empty event log.

export function applyEvent(state: MatchState, event: GameEvent): MatchState;
// Pure: returns new state with event appended and state updated.

export function foldEvents(initial: MatchState, events: GameEvent[]): MatchState;
// Reduces events over initial state.

export function hashState(state: MatchState): string;
// Deterministic hash of serialized state. Use a pure-JS hash (djb2 or similar).
// Never use crypto.randomBytes or other nondeterministic sources.
```

how to implement:
1. Create `src/engine/state.ts`.
2. `initMatchState`: build the tile Map (key = `${x},${y}`), build the unit Map, set `tick=0`, initialize one PRNG stream per system using `splitStream`.
3. `applyEvent`: pattern-match on `event.type`, return updated state (use spread/copy — never mutate).
4. `foldEvents`: `events.reduce(applyEvent, initial)`.
5. `hashState`: serialize `state` to JSON with keys sorted deterministically (sort `Map` entries by key before serializing), then run a pure djb2 or FNV-1a hash. **Do not** use `JSON.stringify(state)` with a `Map` directly — `Map` serializes as `{}`. Convert maps to sorted arrays first.
6. Write `test/engine/state.test.ts`.

acceptance: `test/engine/state.test.ts` asserts:
- `initMatchState(scenario)` with a 2-unit scenario produces state with `state.units.size === 2`.
- `hashState(state)` called twice on the same state object returns the same string.
- `foldEvents` applied twice to the same log produces states with equal hashes.

---

**S06 — Snapshot / restore**
dependsOn: S05
files: `src/engine/snapshot.ts`, `test/engine/snapshot.test.ts`

interface:
```typescript
// src/engine/snapshot.ts
export type Snapshot = { tick: number; data: string }; // serialized MatchState

export function takeSnapshot(state: MatchState): Snapshot;
export function restoreSnapshot(snap: Snapshot): MatchState;
// restoreSnapshot(takeSnapshot(state)) must produce a state with the same hashState() as state.
```

how to implement:
1. `takeSnapshot`: serialize the state to JSON (sort Map entries, convert bigints to strings), return `{ tick: state.tick, data: JSON.stringify(...) }`.
2. `restoreSnapshot`: parse JSON, reconstruct Maps and bigints from the serialized form.
3. Write `test/engine/snapshot.test.ts`.

acceptance: `test/engine/snapshot.test.ts` asserts:
- `hashState(restoreSnapshot(takeSnapshot(state))) === hashState(state)` for a non-trivial state.
- Restoring the snapshot and applying 3 more events produces the same hash as not snapshotting and applying the same events from the original.

---

**S07 — GGRS-style request contract**
dependsOn: S06
files: `src/engine/ggrs.ts`, `test/engine/ggrs.test.ts`

interface:
```typescript
// src/engine/ggrs.ts
import { Snapshot, MatchState } from './snapshot.js';

export type GgrsRequest =
  | { type: 'SaveGameState'; tick: number }
  | { type: 'LoadGameState'; handle: Snapshot }
  | { type: 'AdvanceFrame'; inputs: Command[] };

export type SessionDriver = {
  // Processes a batch of requests in order, returns the resulting state.
  processRequests(state: MatchState, requests: GgrsRequest[]): MatchState;
};

export function createLocalSessionDriver(): SessionDriver;
// The local driver executes requests in-process with no network.
```

how to implement:
1. `createLocalSessionDriver`: returns an object whose `processRequests` handles each request type in order.
   - `SaveGameState`: take a snapshot and stash it in a local `Map<number, Snapshot>` keyed by tick.
   - `LoadGameState`: call `restoreSnapshot(handle)` and return the restored state.
   - `AdvanceFrame`: apply the commands to the state (stub: just record them as `CommandValidated` events for now; real command execution comes in S10–S11).
2. Write `test/engine/ggrs.test.ts`.

acceptance: `test/engine/ggrs.test.ts` asserts:
- `SaveGameState` → `LoadGameState` round-trips the state hash correctly.
- `AdvanceFrame` increments `state.tick` by 1.
- Processing `[SaveGameState(0), AdvanceFrame([]), LoadGameState(snap0), AdvanceFrame([])]` ends at tick 1 (not 2) because LoadGameState reset to tick 0.

---

**S08 — SyncTest harness**
dependsOn: S07
files: `src/engine/synctest.ts`, `test/engine/synctest.test.ts`

interface:
```typescript
// src/engine/synctest.ts
export type SyncTestResult = { passed: boolean; divergentTick?: number; details?: string };

export function runSyncTest(
  state: MatchState,
  inputs: Command[][],  // one array per tick
  checkDistance: number,
  driver: SessionDriver
): SyncTestResult;
// Every tick t: advance normally. Also re-simulate the last checkDistance ticks from
// the saved snapshot at t-checkDistance and compare the per-tick checksums to the original.
// Returns { passed: true } if all checksums match; { passed: false, divergentTick } otherwise.
```

how to implement:
1. Run two parallel simulations: `mainLine` advances normally tick by tick; at each tick, if `t >= checkDistance`, also re-run the last `checkDistance` ticks from the saved snapshot and compute checksums.
2. Compare mainLine checksum at each tick to the re-simulation checksum. On mismatch: return `{ passed: false, divergentTick: t }`.
3. Write `test/engine/synctest.test.ts`.

acceptance: `test/engine/synctest.test.ts` asserts:
- A fully deterministic scenario (same inputs, no randomness) passes the SyncTest with `checkDistance=3`.
- A scenario that injects a `Math.random()` call via a mock returns `{ passed: false }` (inject a determinism-breaking event manually to simulate the failure).

---

**S09 — Deterministic A\* pathfinder**
dependsOn: S04
files: `src/engine/pathfinding.ts`, `test/engine/pathfinding.test.ts`

interface:
```typescript
// src/engine/pathfinding.ts
import { TileCoord, Tile, MatchState } from './types.js';

export type PathResult = { path: TileCoord[]; cost: number } | { path: null; cost: null };

export function findPath(
  from: TileCoord,
  to: TileCoord,
  tiles: Map<string, Tile>,
  blockedCoords: Set<string>,   // set of "${x},${y}" strings for occupied tiles
  options?: { respectZoC?: boolean; occupiedBy?: Map<string, string> }
): PathResult;
// Dijkstra/A* over the tile map.
// Terrain costs: open=1, cover=2, elevated=2, hazard=3, blocking=Infinity (impassable).
// Elevation difference >=2 adds +1 cost.
// ZoC: entering a tile adjacent to an enemy unit costs +2 and stops movement for that unit's turn.
// Tie-breaking: when two nodes have equal cost, choose the one with lower x, then lower y.
// (This tiebreak is the ONLY source of stable ordering — never use insertion order.)
```

how to implement:
1. Implement Dijkstra with a min-heap (use a simple array + sort, or a hand-written binary heap — no `Set` iteration for node order).
2. Tile adjacency: 4-directional (no diagonals) or 8-directional as documented in a comment; pick one and be explicit.
3. Tiebreak: when pushing equal-cost nodes, sort by `x` then `y` deterministically.
4. Zones of Control: if `options.respectZoC === true`, check adjacency to enemy-occupied tiles (from `occupiedBy`) and add cost.
5. Write `test/engine/pathfinding.test.ts` with the fixture below.

acceptance: `test/engine/pathfinding.test.ts` uses a 5×5 fixture grid:
- Straight open path: `findPath({x:0,y:0}, {x:4,y:0}, ...)` returns path of length 5, cost 4.
- Blocking tile at `{x:2,y:0}`: same start/end returns a path that avoids it.
- Hazard tile: verify cost increases.
- Two calls with identical inputs produce identical paths (determinism check).
- `npm test` → green.

---

**S10 — Command validator**
dependsOn: S04, S05, S09
files: `src/engine/commands.ts`, `test/engine/commands.test.ts`

interface:
```typescript
// src/engine/commands.ts
export type ValidationResult = { valid: true } | { valid: false; reason: string };

export function validateCommand(state: MatchState, command: Command): ValidationResult;
// Rules:
// Move: unit must exist, be alive, have AP >= path.length, path must be walkable from current position,
//       destination must not be occupied.
// Attack: unit must exist, be alive, have AP >= 1, target must be visible and in range,
//         ability must not be on cooldown.
// EndTurn: always valid if unit exists and is alive.
```

how to implement:
1. Pattern-match on `command.kind`.
2. For Move: call `findPath(unit.coord, path[path.length-1], ...)` and verify it matches the provided path (client path must equal the pathfinder's result, defending against client manipulation).
3. For Attack: check adjacency or range based on ability definition (stub: range=1 tile for now; real ability data comes in S11).
4. Write `test/engine/commands.test.ts`.

acceptance: `test/engine/commands.test.ts` asserts:
- A valid Move on an open grid returns `{ valid: true }`.
- A Move through a blocking tile returns `{ valid: false }`.
- An Attack on an out-of-range target returns `{ valid: false }`.
- An EndTurn always returns `{ valid: true }` for a living unit.

---

**S11 — Ability system (targeted attack + status effect + cooldown)**
dependsOn: S03, S04, S05
files: `src/engine/abilities.ts`, `test/engine/abilities.test.ts`

interface:
```typescript
// src/engine/abilities.ts
export type AbilityKind = 'targeted-attack' | 'aoe' | 'buff' | 'debuff';
export type TimingWindow = 'Declare' | 'CostPay' | 'PreHit' | 'Roll' | 'Apply' | 'OnHit' | 'Cleanup';

export type Ability = {
  id: string;
  kind: AbilityKind;
  range: number;          // in tiles
  apCost: number;
  cooldownTicks: number;
  hitChanceBase: number;  // integer [0,100]
  damage: number;         // integer base damage
  aoeRadius?: Fixed;      // only for 'aoe' kind, fixed-point tiles
  statusEffect?: { id: string; durationTicks: number; stacksTo: number };
};

// Apply an ability use. Returns new events to append to the log.
export function resolveAbility(
  state: MatchState,
  casterId: UnitId,
  targetId: UnitId,
  ability: Ability,
  prngStream: PrngStream
): { events: GameEvent[]; nextStream: PrngStream };
// Phase order: CostPay (deduct AP), Roll (seeded hit check), Apply (damage/effect), Cleanup (set cooldown).
// Hit check: nextIntBelow(prngStream, 100) < hitChanceBase => hit.
// Emit RandomRolled event with the roll value.
// On hit: emit EffectApplied with delta=-damage.
// Status effect: if statusEffect defined, add/refresh on target. Stack up to stacksTo.
// Cooldown: set state.units[casterId].cooldowns[ability.id] = state.tick + ability.cooldownTicks.
```

how to implement:
1. Implement the four timing phases in order, checking each guard.
2. Use `nextIntBelow` from PRNG — never `Math.random()`.
3. Emit events for every state change, including `RandomRolled`.
4. Status stacking: if the unit already has the status, refresh duration; only stack if count < `stacksTo`.
5. Write `test/engine/abilities.test.ts` with the fixture below.

acceptance: `test/engine/abilities.test.ts` asserts (using a fixed seed so all rolls are deterministic):
- A targeted attack with 100% hit chance always hits.
- A targeted attack with 0% hit chance never hits.
- Two runs with the same seed produce identical event lists (same roll values).
- A status effect applied twice to a unit with `stacksTo=1` does not exceed stack 1.
- Cooldown is set correctly after use.

---

**S12 — Fog-of-war projection**
dependsOn: S04, S05
files: `src/engine/fog.ts`, `test/engine/fog.test.ts`

interface:
```typescript
// src/engine/fog.ts
export type PlayerView = {
  tick: Tick;
  visibleUnits: Map<UnitId, Unit>;         // only units this seat can see
  revealedTiles: Set<string>;              // "${x},${y}" keys
  ownUnits: Map<UnitId, Unit>;             // always includes own units
};
// Note: PlayerView does NOT include a way to hold hidden enemy data.
// The type itself cannot represent what is not visible.

export function computeVision(
  state: MatchState,
  seatId: PlayerId,
  seatTeamId: TeamId
): Set<string>;
// Returns tiles visible to this seat using simple range-based line-of-sight:
// each unit on this seat's team has vision range = 4 tiles (Manhattan distance).
// Blocking tiles obstruct LOS (stop vision past them).
// Stealth units (stealthLevel > 0) require the viewer to be within 2 tiles.

export function project(state: MatchState, seatId: PlayerId, seatTeamId: TeamId): PlayerView;
// Pure function. Returns only what seatId can see. Never returns hidden enemy units.
```

how to implement:
1. `computeVision`: for each unit on the seat's team, enumerate tiles within Manhattan distance 4. Filter by LOS (simple ray: if any tile along the line has terrain='blocking', stop). Apply stealth suppression.
2. `project`: build `visibleUnits` by filtering `state.units` to only those on the visible tiles. Always include own units. Copy — never mutate authoritative state.
3. Write `test/engine/fog.test.ts`.

acceptance: `test/engine/fog.test.ts` asserts:
- A unit on team A cannot see an enemy on team B that is 6 tiles away and behind a blocking tile.
- A unit on team A CAN see an enemy 3 tiles away on an open path.
- `project(state, seatA, teamA)` does not include any unit whose tile is not in `computeVision(state, seatA, teamA)`.
- **Anti-leak property test**: mutate only A-invisible facts of a copy of `state` (move a hidden enemy), call `project(stateCopy, A, teamA)`, assert result equals `project(state, A, teamA)`. (This is the load-bearing fog-correctness test.)

---

**S13 — We-Go (simultaneous) command phase**
dependsOn: S05, S10, S11, S12
files: `src/engine/wego.ts`, `test/engine/wego.test.ts`

interface:
```typescript
// src/engine/wego.ts
export type PlayerCommands = { playerId: PlayerId; commands: Command[] };

export function resolveWeGoTurn(
  state: MatchState,
  allPlayersCommands: PlayerCommands[],  // all seats submit before any reveal
  abilities: Map<string, Ability>,
  prngStreams: Record<string, PrngStream>
): MatchState;
// 1. Validate all commands from all seats (none can see others' commands yet).
// 2. Sort units by unitId for deterministic initiative order (no random initiative in this slice).
// 3. Apply validated commands in sorted order, emitting events.
// 4. Return updated state.
// Key invariant: no seat's command order can depend on another seat's hidden command.
```

how to implement:
1. Collect and validate all commands first (validation phase), then sort units by `unitId` (alphabetical), then apply.
2. For each unit in sorted order: find its validated command, call `resolveAbility` or apply move, emit events.
3. Emit `CommandValidated` events at the start of the tick, before any effects.
4. Write `test/engine/wego.test.ts`.

acceptance: `test/engine/wego.test.ts` asserts:
- Two units submitting simultaneous attack commands both fire (neither is dead before it attacks, because commands were collected before execution).
- Unit processing order is stable (re-run with same inputs, same order).
- An invalid command (unit already dead from a prior effect) produces a `CommandValidated` event that resolves as a no-op, not a crash.

---

**S14 — Deterministic AI policy**
dependsOn: S12, S13
files: `src/engine/ai.ts`, `test/engine/ai.test.ts`

interface:
```typescript
// src/engine/ai.ts
export function decideAiCommands(
  view: PlayerView,
  prngStream: PrngStream,
  abilities: Map<string, Ability>
): { commands: Command[]; nextStream: PrngStream };
// Pure function over PlayerView only — never over authoritative state.
// Simple policy: for each own unit, if an enemy is in attack range, attack it;
// else move one step toward the nearest visible enemy.
// Tie-breaking: choose the target with the lexicographically smallest unitId.
```

how to implement:
1. Iterate `view.ownUnits` in sorted order (by unitId).
2. For each unit: check if any visible enemy is in ability range. If so, attack the lexicographically smallest one.
3. Else: find the nearest visible enemy (Manhattan distance), compute one step of pathfinding toward it, emit a Move command.
4. Never read authoritative state — only `view`.
5. Write `test/engine/ai.test.ts`.

acceptance: `test/engine/ai.test.ts` asserts:
- AI always chooses the lexicographically smallest target when multiple enemies are in range.
- Two identical views produce identical command lists.
- AI never attempts to attack a hidden enemy (one not in `view.visibleUnits`).

---

**S15 — Nondeterminism tripwires**
dependsOn: S03, S05
files: `test/engine/tripwires.test.ts`

interface: no new src files — tests only.

how to implement:
1. Write three tests that each deliberately inject a nondeterminism bug and confirm the SyncTest catches it:
   - **Float tripwire**: monkey-patch `applyEvent` to add `Math.random() * 0` to a damage value (invisible to callers, but changes PRNG state in some engines — or just inject a tiny float-based rounding divergence). Verify `runSyncTest` returns `{ passed: false }`.
   - **Set iteration tripwire**: replace the unit sort in `resolveWeGoTurn` with `Set` iteration (no guaranteed order), run two scenarios that differ only in insertion order, assert their end-state hashes differ, and confirm the SyncTest fires.
   - **Math.random tripwire**: call `Math.random()` inside a mock `resolveAbility` and confirm the SyncTest reports `{ passed: false }` within `checkDistance` ticks.
2. These tests MUST be in `test/engine/tripwires.test.ts` and MUST fail (return `{ passed: false }` from SyncTest) to be green.

acceptance: `test/engine/tripwires.test.ts` → all three tripwires cause SyncTest to fail (which means the test asserts `result.passed === false` → green). `npm test` → green.

---

**S16 — Golden replay + global invariants integration test**
dependsOn: S05–S15
files: `test/integration/golden-replay.test.ts`, `test/fixtures/seed-scenario.ts`

interface: no new src exports — integration test + fixture only.

how to implement:
1. Create `test/fixtures/seed-scenario.ts`: a 6×6 grid, 4 units (2 per team), one blocking tile, one cover tile, one elevated tile, one ZoC-producing enemy placement, one stealth unit. Set `seed = 12345n`.
2. In `test/integration/golden-replay.test.ts`:
   a. `initMatchState(seedScenario)` → run 10 ticks of the We-Go loop with deterministic AI for both sides.
   b. Record `endHash = hashState(finalState)` and `eventLogHash = hashEvents(finalState.eventLog)` (a hash of the full event log serialized deterministically).
   c. **Pin** both hashes as constants in the test file.
   d. Run the simulation again from the same scenario+seed and assert both hashes are identical.
   e. Run `runSyncTest` on the full 10-tick simulation and assert `result.passed === true`.
   f. Assert anti-leak: for every tick, `project(state, 'playerA', 'teamA')` does not contain any unit from teamB that is out of vision.
   g. Assert conservation: unit HP never exceeds `maxHp`, never goes below 0 (it goes to 0 then `UnitDied` fires, status becomes `dead`).
3. `hashEvents`: serialize the event log to JSON (deterministic: sort event fields by key, convert bigints to strings), then djb2/FNV-1a hash.

acceptance: `test/integration/golden-replay.test.ts` → all assertions pass, pinned hashes are stable. `npm test` → green. This is the gate for the entire first slice.

---

### 3. The decomposition method for the rest

After completing the 16-card first slice, use this repeatable recipe to expand the remaining breadth:

**Recipe — how to decompose any new feature:**
1. Identify what **pure type/interface** it needs that doesn't exist yet. That is card cluster A (types-only card, like S04).
2. Identify what **pure computation** it adds (a function over existing types). That is card cluster B (logic card, like S02/S09/S11).
3. Identify what **event types** it emits and how `applyEvent` must extend to handle them. That is card cluster C (event/state card, like S05).
4. Identify what **validator/guard** enforces correctness. That is card cluster D (validation card, like S10).
5. Write **one acceptance test per card** before implementing the card. The test must run offline with a fixture.

**Worked example 1 — Overwatch / interrupt ability:**
- **OW01** (types): Add `TimingWindow` to `GameEvent` and add `OWCommand` to `Command`. files: `src/engine/types.ts` (extend). acceptance: TypeScript compiles.
- **OW02** (logic): Implement `checkOverwatchTrigger(state, movingUnitId, path): OverwatchTrigger | null` in `src/engine/overwatch.ts`. Returns the overwatch attacker + interrupt tick if a watching enemy has LOS to the path. acceptance: test with a fixture where team B has a unit in overwatch — verify trigger fires exactly once on entry into the watched tile, not before or after.
- **OW03** (integration): Extend `resolveWeGoTurn` to call `checkOverwatchTrigger` before each step of a Move, and if it fires, interrupt the move and resolve the overwatch attack. acceptance: a moving unit that enters an overwatch zone takes damage and stops; a moving unit that avoids the zone does not.

**Worked example 2 — AoE ability with fixed-point radius:**
- **AO01** (types): Add `aoeRadius: Fixed` to `Ability` (already in S11). Confirm no new types needed.
- **AO02** (logic): Implement `getTilesInRadius(center: TileCoord, radius: Fixed, tiles: Map<string, Tile>): TileCoord[]` in `src/engine/aoe.ts`. Use `fixedMul`, `fixedSqrt` — never `Math.*`. Tile is in radius if fixed-point Euclidean distance <= radius. Sort result by x then y for stability. acceptance: a radius of `toFixed(2)` centered at `{x:2,y:2}` includes exactly the right set of tiles in a known fixture map.
- **AO03** (integration): Extend `resolveAbility` to handle `kind='aoe'`: call `getTilesInRadius`, find all enemy units on those tiles, emit one `EffectApplied` per target. Emit a single `RandomRolled` for the hit check. acceptance: an AoE attack hits all enemies within radius, misses all enemies outside; two runs with the same seed produce the same damage events.

**Worked example 3 — Desync localizer (E6):**
- **DL01** (logic): Implement `bisectDesync(stateA: MatchState, stateB: MatchState, inputs: Command[][]): number` in `src/engine/desync.ts`. Re-simulate both from their initial states tick by tick, compare `hashState` at each tick, return the first diverging tick. acceptance: a scenario where state A uses a seeded PRNG and state B uses `Math.random()` at tick 5 — `bisectDesync` returns 5.
- **DL02** (test): Write a property test that runs two identical scenarios and asserts `bisectDesync` never returns a value other than "no divergence". acceptance: 100 randomly seeded scenarios all pass.

---

### 4. Per-task implementation conventions

**File/folder layout:**
```
src/
  engine/
    fixed.ts        # Q16.16 arithmetic (S02)
    prng.ts         # seeded PRNG (S03)
    types.ts        # domain types (S04)
    state.ts        # state init, event fold, hash (S05)
    snapshot.ts     # snapshot/restore (S06)
    ggrs.ts         # GGRS request contract (S07)
    synctest.ts     # SyncTest harness (S08)
    pathfinding.ts  # A* / Dijkstra (S09)
    commands.ts     # command validation (S10)
    abilities.ts    # ability resolution (S11)
    fog.ts          # fog-of-war projection (S12)
    wego.ts         # We-Go turn resolution (S13)
    ai.ts           # deterministic AI policy (S14)
test/
  engine/           # unit tests (one file per src/engine/ module)
  integration/      # golden-replay.test.ts (S16)
  fixtures/         # TypeScript fixture objects, no network, no file I/O
```

**Naming:**
- Functions that return new state are named `apply*` or `resolve*` (never `update*` which implies mutation).
- Types that are views/projections are suffixed `View` (e.g. `PlayerView`).
- Fixture files are named `<name>-fixture.ts` or `seed-scenario.ts` — never `.json` (keep them typed).

**How to write a test (minimal working snippet):**
```typescript
// test/engine/fixed.test.ts
import { describe, it, expect } from 'vitest';
import { toFixed, fixedAdd, fixedMul } from '../../src/engine/fixed.js';

describe('Fixed-point arithmetic', () => {
  it('adds two integers correctly', () => {
    expect(fixedAdd(toFixed(3), toFixed(4))).toBe(toFixed(7));
  });
});
```
- Always use `.js` extensions in imports (NodeNext module resolution requires it).
- Tests are pure: no `beforeEach` that touches global state. Create fixture objects inline.
- No `Math.random()` in tests. Use a fixed seed when randomness is needed.

**Keeping it deterministic — the checklist for every card:**
- [ ] No `Math.random()` — check with `grep -r 'Math.random' src/engine/`
- [ ] No `Date.now()` — check with `grep -r 'Date.now' src/engine/`
- [ ] No `Set`/`Map` iteration for state-affecting order — all collections are converted to sorted arrays before processing.
- [ ] All computed values use the `Fixed` type — check with `grep -r ': number' src/engine/` and verify each `number` is a tick, coordinate, or display-only value.
- [ ] Every function that reads PRNG state takes the stream as an argument and returns the new stream — no global mutable PRNG.

**Wiring a fixture adapter:**
- Fixture scenarios live in `test/fixtures/`. They are TypeScript `const` objects conforming to the `Scenario` type.
- The test imports the fixture directly: `import { seedScenario } from '../fixtures/seed-scenario.js'`.
- No file I/O, no `fs.readFile`. The fixture is code, not data.

**Definition of done for any card:**
1. All files listed in the card exist.
2. All exported interfaces match the card's interface exactly (TypeScript check).
3. The acceptance test(s) for that card pass green.
4. `npm test` (all tests) still passes green — no regressions.
5. `grep -r 'Math.random\|Date.now' src/engine/` returns nothing (determinism guard).

---

### 5. Common pitfalls for a weak model on this project

**Pitfall 1 — Reaching for `Math.random()` or `Date.now()`**
A 3B will instinctively write `const roll = Math.floor(Math.random() * 100)` for a hit check or `const startTime = Date.now()` for timing. Both silently break determinism.
Fix: The SyncTest (S08) and the tripwire tests (S15) will turn this red immediately. If those tests fail with `passed: false`, search for `Math.random` and `Date.now` in `src/engine/` and replace them with the seeded PRNG and integer ticks.

**Pitfall 2 — Using JavaScript `number` (float) for engine values**
A 3B will compute `damage = baseAttack * 0.75` using JavaScript floats. Floats diverge across JS engines, optimization levels, and Node versions.
Fix: All engine values use `Fixed` (bigint Q16.16). If a value is a damage multiplier, store it as `Fixed` and multiply with `fixedMul`. The TypeScript type system catches this if `Fixed = bigint` and the function signatures are correct.

**Pitfall 3 — Iterating `Set` or `Map` for state-affecting order**
A 3B may write `for (const unit of state.units.values())` to process units, then run the same scenario twice and get different event orders (or the same order on one machine but different on another).
Fix: Always sort: `[...state.units.values()].sort((a, b) => a.id < b.id ? -1 : 1)`. The tripwire test in S15 will catch this if the sort is missing.

**Pitfall 4 — Mutating state instead of returning new state**
A 3B may write `unit.hp -= damage` directly instead of returning a new `MatchState`. Mutation breaks the snapshot/restore round-trip and the SyncTest.
Fix: `applyEvent` must return a new object. Use `{ ...state, units: new Map([...state.units, [id, { ...unit, hp: unit.hp - damage }]]) }`. Verify with the snapshot test in S06.

**Pitfall 5 — Forgetting to emit `RandomRolled` events**
A 3B may use the PRNG for a roll but not emit a `RandomRolled` event. This means the event log cannot reproduce the roll on replay, breaking golden replay.
Fix: Every call to `nextIntBelow` must be immediately followed by emitting `{ type: 'RandomRolled', tick, streamId, value }`. The golden replay test (S16) will catch this if a re-simulation produces a different hash.

**Pitfall 6 — Fog-of-war leaks (projection returning hidden data)**
A 3B may include all units in `PlayerView` and just mark some as `hidden: true`, trusting the renderer to filter them. This is a data leak — the type itself must not carry hidden information.
Fix: `PlayerView` uses `Map<UnitId, Unit>` for `visibleUnits` — only entries the seat can see are present. The anti-leak property test in S12 and S16 will catch any leak.

**Pitfall 7 — Fixed-point sqrt using `Math.sqrt`**
A 3B implementing `fixedSqrt` will reach for `Math.sqrt(Number(a) / 65536) * 65536`. `Math.sqrt` is platform-dependent and produces floats.
Fix: Use integer Newton-Raphson entirely in bigints as specified in S02. The `fixedSqrt` test checks specific known-square values; a float-based implementation may pass for perfect squares but diverge on non-perfect inputs across platforms.

**Pitfall 8 — Reaction/interrupt chains without termination bounds**
A 3B implementing overwatch or interrupt abilities may write a loop that processes reactions until none remain, without a depth bound. Two units triggering each other's overwatch can loop forever.
Fix: Add a `maxReactionDepth` constant (e.g. 8) and a `reactionDepth` counter to `resolveWeGoTurn`. If depth is exceeded, remaining reactions are discarded and a `ReactionDepthExceeded` event is logged.

**Pitfall 9 — Serializing Maps as `{}` in `hashState`**
`JSON.stringify(new Map([['a', 1]]))` produces `"{}"` — the map is lost. A 3B may not know this.
Fix: Before hashing, convert every Map to a sorted array of `[key, value]` pairs: `[...map.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)`. The snapshot round-trip test in S06 will catch this.

**Pitfall 10 — Replay format with bigints failing `JSON.stringify`**
`JSON.stringify({ seed: 12345n })` throws `TypeError: BigInt value can't be serialized in JSON`. A 3B may not know this.
Fix: In `takeSnapshot` and `hashState`, replace bigints with their string representations: `bigint.toString()`. Restore by parsing back with `BigInt(str)`. The snapshot test in S06 will catch this.
