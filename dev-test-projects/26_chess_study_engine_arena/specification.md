# 26 - Modern Chess Study, Engine, and Tournament Arena

Complexity tier: 26/35 game block
Expected decomposition size: 60-75 dependent implementation cards before coding.
Domain pressure: chess rules, legal move generation, PGN/FEN, engine analysis, opening study, tactics training, tournament presentation, replay UX.
Acceptance command: npm test

## How to use this challenge
This is a game dev-test project specification for evaluating whether an autonomous coding agent can decompose real game systems, implement deterministic simulation logic, and build a polished presentation layer that makes the game understandable and desirable. The goal is not to finish the whole game. The goal is to build a product-grade foundation that proves the agent understands rules, simulation state, player experience, rendering, and verification.

The agent must read this entire specification before planning. It must create a dependency-linked plan, record domain knowledge debt, identify engine and presentation invariants, and choose a release slice that exercises the highest-risk mechanics. For game projects, visual presentation is mandatory, not a stretch goal. A correct simulation hidden behind ugly placeholder UI is not enough.

## Product vision
Build a polished chess product that combines a correct rules engine, study tools, tactics, engine-style analysis, tournament playback, and a presentation layer good enough for spectators. This is the entry game challenge, but it still must be a serious chess foundation, not a draggable board demo.

## Target players and users
- Club players studying openings, tactics, endgames, and annotated games.
- Coaches who need to create lesson lines and compare candidate moves.
- Tournament viewers who need clean presentation, clocks, arrows, variations, and commentary panels.
- Developers integrating future engine adapters and chess database features.

## Foundation release scope
The first serious buildout must include:
- Board, square, piece, color, move, position, game, variation, annotation, clock, player, puzzle, study, tournament, and engine-evaluation models.
- Legal move generator covering check, checkmate, stalemate, castling, en passant, promotion, insufficient material, repetition tracking, and fifty-move rule fixtures.
- FEN importer/exporter and PGN parser/writer for deterministic fixture games, variations, comments, NAG-like annotations, and clock comments.
- Tactics trainer with puzzle state, candidate move validation, mistake branches, hints, themes, spaced repetition metadata, and review results.
- Study mode with opening tree, transpositions, arrows, highlights, comments, branch navigation, and reference-game statistics from fixtures.
- Engine analysis adapter boundary with deterministic fake engine output, principal variation lines, centipawn/mate scores, blunder detection, and analysis depth.
- Tournament viewer with round pairings, clocks, result state, move list, variation board, player info, and spectator-friendly current-position summary.
- Replay system that can step forward/backward through a game, branch into variations, and preserve annotations without mutating the original game.

## Gameplay requirements
- Correctness must come before visual polish: every visible move and puzzle decision must come from the legal move engine.
- Study tools must support branches and transpositions, not just a linear move list.
- Engine suggestions must be clearly labeled as analysis output with depth and source.
- Puzzle progress must distinguish correct move, inexact move, tactical fail, solved, abandoned, and needs review.

## Presentation requirements
Very nice presentation is mandatory for this challenge. The agent must treat rendering, animation, interaction feedback, and layout polish as core acceptance criteria. Required presentation work:
- The first screen must look like a finished chess application: high-quality board, piece set, clocks, side panels, move list, and restrained dark theme.
- Moves need smooth piece animation, legal-target highlights, last-move markers, check indication, premove-style ghost states where appropriate, and polished drag/click behavior.
- Study and tournament modes need readable typography, compact dense panels, variation trees, arrows, and hover previews without layout jumping.
- No placeholder chess pieces, raw text-only boards, or unstyled HTML controls are acceptable.
- Presentation tests should verify board orientation, coordinates, responsive layout, no overlapping panels, and stable replay controls.

## Architecture requirements
- Separate chess rules engine, notation import/export, study domain, engine adapter, puzzle state, tournament state, replay projection, and UI components.
- Use deterministic pure functions for move generation and game state transitions.
- Represent annotations and variations structurally instead of embedding them as display text.
- Keep rendering independent from the rules engine so board UI cannot create illegal positions.

## Domain knowledge debt to surface
The agent should not pretend to know every game design, simulation, AI, rendering, or balancing detail perfectly. It should mark assumptions, build deterministic subsets, and preserve extension points for future designers, artists, balance passes, and live integrations. Required knowledge areas:
- Chess edge cases are numerous and must be tested with exact positions.
- PGN and FEN look simple but require careful handling of variations, comments, castling rights, en passant, and move counters.
- Engine evaluation can be misleading unless score type, depth, and principal variation are visible.
- A polished chess UI depends on tiny interaction details, not large decorative surfaces.

## Required challenge scenarios
The implementation plan and fixtures should be shaped around scenarios like these. They do not all need full UI coverage in the first slice, but the core model and presentation should be capable of representing them:
- A study contains a main line with two transpositions and an annotated blunder branch.
- A puzzle begins from a FEN with en passant available and the first tempting move fails tactically.
- A tournament game reaches time trouble and the viewer must show clocks, move list, evaluation, and board state cleanly.
- A PGN import includes nested variations and clock comments that must round-trip.
- A user flips the board during replay without losing selected variation state.

## Decomposition pressure
This challenge should force decomposition across rules or simulation engine, deterministic fixtures, AI or policy layers, replay/save state, player-facing presentation, UI interaction, diagnostics, and test harnesses. The plan should include dependency links so core state, commands, invariants, and golden tests are built before rendering depends on them. Avoid starting with a visual mock that cannot play the game; also avoid building a correct but lifeless engine with no usable presentation.

The agent should maintain a visible knowledge-debt list covering unclear rules, balance assumptions, AI limitations, rendering tradeoffs, asset gaps, accessibility concerns, performance constraints, and future designer review checkpoints. Knowledge debt is not a failure; hiding it is.

## Acceptance criteria
- Move-generation tests cover check, pins, castling rights, en passant, promotion, repetition, fifty-move, mate, and stalemate fixtures.
- PGN/FEN tests round-trip annotated games with variations and comments.
- Puzzle tests cover correct lines, failed branches, hints, review scheduling, and abandoned puzzles.
- Engine adapter tests consume deterministic analysis and produce stable blunder/excellent move classifications.
- Presentation checks verify board layout, piece rendering, responsive side panels, and replay controls.
- The project passes npm test without a live chess engine.

## Explicit non-goals
- Do not build a board that allows illegal moves.
- Do not use a text-only board or placeholder piece letters as the final foundation presentation.
- Do not call a live engine in acceptance tests.
- Do not flatten study variations into one move list.

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

> Added 2026-06-26 via deep domain research. **The single hardest, most-defining property of this project is *exhaustive, provable rules correctness*: a chess engine is a domain where "looks right" and "is right" diverge on positions the author never imagined, and the only honest proof is `perft` — a byte-exact node-count match against published reference numbers on adversarial positions. Build perft-first; everything else (study, tactics, tournaments, UI) is downstream of a move generator you can *prove* legal.**

This section adds the load-bearing rigor that separates a real chess foundation from a "draggable board demo." It is grounded in the canonical literature — primarily the [Chess Programming Wiki](https://www.chessprogramming.org/) — and it makes **determinism + exhaustive correctness** the property-based acceptance backbone the way `npm test` demands.

## C0. The grading thesis: correctness is a counting problem, not an opinion

The naive chess project hand-writes move rules, eyeballs a few games, and ships. It will be **wrong** — on en-passant discovered checks, on castling-through-an-attacked-square, on under-promotion, on the pinned-pawn-can't-capture-en-passant case — and nobody will notice until a puzzle "solution" is illegal. The disciplined project treats the move generator as a function whose correctness is **decidable by enumeration**:

1. **Correctness** — does `perft(pos, depth)` match the published count *exactly* for every standard test position?
2. **Determinism** — does the same fixture game / analysis / tournament replay to a byte-identical projection every run?
3. **Round-trip fidelity** — does `parse(serialize(x)) == x` for FEN and PGN, including variations, comments, NAGs, and clock annotations?
4. **Reviewability** — can every engine score, blunder flag, and puzzle verdict be traced to a source position + a labeled analysis line, never an unexplained number?

Everything below serves those four. The flagship test is **the perft suite green to depth 4–5 on all six canonical positions**; if that is red, no UI polish matters.

## C1. Board representation & the move generator (the load-bearing seam)

The hardest, most rewarding seam. Two viable representations; the spec recommends **bitboards** for authenticity and testability, with a `0x88` or mailbox fallback acceptable only if perft still passes.

- **Bitboards.** Represent each piece-type/color as a 64-bit occupancy (`bigint` or a typed `BitBoard` wrapper in TS; JS numbers are 53-bit so **`bigint` is mandatory** for full 64-bit boards — do not use floats). Piece attacks for knights/kings are precomputed lookup tables; pawns are shift-masks. ([Bitboards](https://www.chessprogramming.org/Bitboards))
- **Sliding pieces via magic bitboards.** Bishop/rook/queen attacks are the genuinely hard part. Implement **magic bitboards**: mask relevant occupancy, multiply by a per-square magic constant, right-shift by `64 - indexBits`, index a precomputed attack table. Magics are found offline by brute-force search for a collision-free (constructive-collision-tolerant) mapping; ship them as a **committed constant table with a generator script + a test that re-verifies every square's table is collision-free.** ([Magic Bitboards](https://www.chessprogramming.org/Magic_Bitboards); [analog-hors, "Magical Bitboards and How to Find Them"](https://analog-hors.github.io/site/magic-bitboards/)) A plain "ray-scan to first blocker" generator is an acceptable v1 *as long as perft passes* — but magic bitboards should be a tracked card because they are the canonical, fast, and fun-to-watch-decomposed approach.
- **Legality, done right.** Generate pseudo-legal moves, then filter for king-safety — OR generate fully-legal directly via pin/check-mask computation (check-evasion generation when in check; pinned pieces restricted to their pin ray). The filter approach is simpler and perft-provable; the direct approach is faster. Either is fine **iff perft matches.**

### The exact rules that *will* break a naive implementation (test each with a named fixture)

- **En passant** is only legal the *immediately* following ply, and the capturing pawn must not be **absolutely pinned**, including the rare **horizontal pin** where removing *both* the moving pawn and the captured pawn exposes the king along the 5th/4th rank. ([En passant](https://www.chessprogramming.org/En_passant))
- **Castling** requires: king and the chosen rook unmoved (rights tracked in FEN), squares between empty, and the king **not in check, not passing through an attacked square, and not landing on an attacked square** (the rook may pass through attack). Encode all three king squares' safety.
- **Promotion** to all four pieces, including **under-promotion**, and including promotion-with-capture and promotion-giving-check/mate.
- **Check, double-check** (only the king can move), **pins** (absolute vs relative), discovered check, and discovered *double* check.
- **Draw conditions:** stalemate; **insufficient material** (K vs K, K+minor vs K, K+B vs K+B same color — but *not* K+N+N vs K which is a non-forced draw, a known subtlety); **fifty-move** rule (100 half-moves since last pawn move or capture, tracked by the FEN halfmove clock) and **seventy-five-move** auto-draw; **threefold** (and **fivefold** auto) repetition.
- **Repetition equality is subtle:** two positions repeat only if same pieces on same squares, same side to move, **same castling rights, and same en-passant possibility** — and EP "possibility" for repetition purposes exists whenever a pawn just made a double-step *even if the EP capture is itself illegal (pinned)*, a genuine edge case that real sites get wrong. ([Repetitions](https://www.chessprogramming.org/Repetitions); [Threefold repetition](https://en.wikipedia.org/wiki/Threefold_repetition)) Use a **Zobrist key that incorporates side-to-move, castling rights, and the EP file** so repetition detection is a hash-history scan, not a board diff.

## C2. Perft as the property-based acceptance backbone (ship these exact numbers)

`perft(depth)` walks the legal-move tree and counts leaf nodes; it is "mostly a test of correctness." It deliberately **does not** count draws by repetition/fifty-move/insufficient-material (those diverge from game rules), so the perft generator must be the pure legal-move generator. ([Perft](https://www.chessprogramming.org/Perft)) Ship a `perft.test.ts` asserting these **canonical published counts** ([Perft Results](https://www.chessprogramming.org/Perft_Results)):

| Position | FEN | depth → nodes |
|---|---|---|
| **Initial** | `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1` | 1→20, 2→400, 3→8,902, 4→197,281, 5→4,865,609, 6→119,060,324 |
| **Kiwipete** | `r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -` | 1→48, 2→2,039, 3→97,862, 4→4,085,603, 5→193,690,690 |
| **Position 3** | `8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1` | 1→14, 2→191, 3→2,812, 4→43,238, 5→674,624, 6→11,030,083 |
| **Position 4** | `r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1` | 1→6, 2→264, 3→9,467, 4→422,333, 5→15,833,292 |
| **Position 5** | `rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8` | 1→44, 2→1,486, 3→62,379, 4→2,103,487 |
| **Position 6** | `r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10` | 1→46, 2→2,079, 3→89,890, 4→3,894,594 |

These six positions are *adversarially designed* to exercise castling, EP, promotion, pins, and checks — Kiwipete alone catches most generator bugs. **Required depths for the acceptance gate: ≥4 for all six (fast, < a second or two each), ≥5 where the count is reasonable.** Higher depths are an opt-in slow suite. Add **`perft divide`** (per-root-move subtotals) as a debugging affordance and a test — when a count is off, divide localizes the buggy move family instantly.

> Property-based extension: a `makeMove`/`unmakeMove` round-trip invariant — for a random legal move from a random fixture position, `unmake(make(pos, m)) deepEquals pos` (board, Zobrist key, castling rights, EP square, clocks). Fuzz it. This catches the single most common engine bug: incremental state not perfectly restored.

## C3. Notation: FEN & PGN must round-trip, including the ugly parts

- **FEN** has six fields: piece placement, side to move, castling rights, en-passant target square, halfmove clock, fullmove number. Round-trip every field; reject malformed FENs with a typed error, not a crash. ([python-chess core docs](https://python-chess.readthedocs.io/en/latest/core.html) describe the canonical field set.)
- **PGN** is the harder parser. Support: the seven-tag roster + arbitrary tags; **SAN** moves with the exact **disambiguation algorithm** (file, then rank, then both — and *omit* disambiguation when the alternative move would be illegal due to a pin, matching standard engine output); check `+` / mate `#` suffixes; **NAG** annotations (`$1`…); **recursive annotation variations** in `( … )` nested arbitrarily; `{ … }` comments; and **clock annotations** (`{[%clk 0:01:23]}`). ([Portable Game Notation](https://www.chessprogramming.org/Portable_Game_Notation); [PGN standard, saremba.de](http://www.saremba.de/chessgml/standards/pgn/pgn-complete.htm); [Algebraic Chess Notation](https://www.chessprogramming.org/Algebraic_Chess_Notation)) The acceptance test imports a fixture PGN with **nested variations + clock comments + NAGs and asserts a byte-stable re-serialization** (modulo a documented canonical-whitespace normalization). The study tree is the parse target — variations are a tree, never a flattened line.

## C4. The engine adapter & evaluation vocabulary (deterministic fake, real semantics)

Acceptance must not call a live engine. But the *interface* and the *analysis vocabulary* must be authentic so a real engine drops in later.

- **UCI boundary.** Model the adapter on the **UCI protocol**: `position … moves …`, `go depth … / movetime …`, and parse `info depth … score cp ± / score mate ± multipv … pv …` and `bestmove`. ([UCI is the de-facto engine protocol; reference engines: [Stockfish](https://stockfishchess.org/), generic UCI overviews above.]) The **fixture engine** returns scripted, deterministic `info` lines keyed by position hash — full PV lines, centipawn *or* mate scores, and a depth. **Score type matters and must be surfaced in the UI:** a `mate in 3` is not "+infinity cp," and a depth-4 eval is not a depth-30 eval — the base spec's "engine eval can be misleading unless score type, depth, and PV are visible" is enforced by making `{ scoreType: 'cp' | 'mate', value, depth, pv, multipv }` a typed, displayed record.
- **Blunder/brilliant classification** is a pure function of consecutive evals (centipawn-loss thresholds with mate-aware clamping), and must be **deterministic and explainable**: each classification links to the before/after eval and the better PV it ignored. This is the chess analogue of the exemplar's "evidence graph" — every verdict traces to source analysis.
- **Authenticity notes to track as extension points (knowledge debt):** modern engines evaluate with **NNUE** (efficiently-updatable neural network, ported to Stockfish 12 for an ~80–100 Elo gain) ([NNUE](https://www.chessprogramming.org/NNUE); [Introducing NNUE Evaluation](https://stockfishchess.org/blog/2020/introducing-nnue-evaluation/)); opening prep uses the **Polyglot book format** (triples of Zobrist-key → move → weight) ([PolyGlot](https://www.chessprogramming.org/PolyGlot)). The foundation should expose an **opening-book adapter** (fixture book of `zobristKey → weighted moves`) and an **eval adapter**, both behind the same deterministic-fixture discipline, so a production NNUE engine and a real `.bin` book are later swap-ins, not rewrites.

## C5. Determinism & testability strategy (no live engine, no wall clock)

- **No `Date.now()` / `Math.random()` in core.** Clocks (tournament time controls, increment, Bronstein/Fischer delay) read an **injected virtual clock**; tests advance it explicitly. Any move-ordering jitter or fixture-engine "thinking time" draws from a **seeded PRNG**, so a tournament playback is reproducible from `(seed, fixtureSet)`.
- **Engine, opening book, and any future online database are adapters** behind interfaces with in-repo deterministic fixtures. A test never reaches the network or a real binary.
- **Replay is a projection, never a mutation.** Stepping forward/backward, entering a variation, and flipping the board are **view-state over an immutable game tree** — the original game and its annotations are never mutated by navigation (the base spec's explicit requirement, here made an invariant: `replayProjection(tree, path)` is pure, and `tree` is frozen). Board flip changes only orientation in the projection; the selected variation path is preserved across a flip (one of the required scenarios).
- **Zobrist keys give free, deterministic state identity** for transposition detection in the study tree and repetition detection in games — seed the Zobrist table from a fixed constant array (committed), never a runtime RNG, or two runs disagree.

## C6. Adversarial / edge-case fixture pack (the correctness acceptance suite)

Ship these as named, deterministic fixtures the engine must handle exactly:

- **En-passant discovered check / horizontal pin:** a position where the EP capture is illegal because it exposes the king along the rank (must be *excluded* from legal moves but still counts as "EP available" for repetition equality).
- **Castling into/through check:** king-side castling illegal because f1/f8 is attacked; queen-side legal even though b1/b8 is attacked (rook-only square).
- **Under-promotion to deliver mate / avoid stalemate:** a position where queening stalemates but knight-promotion mates.
- **Threefold with differing castling/EP rights:** three board-identical positions that are *not* a repetition because castling rights or EP possibility differ — must **not** be flagged as a draw.
- **Fifty-move boundary:** a position at halfmove-clock 99 where a pawn move resets it vs. a quiet move triggers the claimable draw.
- **PGN round-trip torture:** nested variations 3 deep, inline NAGs, `{[%clk]}` comments, a game ending in a non-standard result tag.
- **Pinned-piece SAN disambiguation:** two rooks could move to the same square but one is pinned, so SAN output must *omit* the disambiguator (matching engine convention).
- **Insufficient-material matrix:** K vs K, K+B vs K, K+N vs K (draw); K+N+N vs K (*not* an automatic draw); K+B vs K+B opposite-color bishops with mating potential.

Each fixture asserts the exact legal-move set (or perft count) and, where relevant, the draw/repetition verdict — with an explanation traceable to the rule.

## C7. Presentation invariants (polish, made testable)

Presentation is mandatory, but it must be *correct* and *stable*, not just pretty:

- The board UI can **never** produce an illegal position: it only issues moves the rules engine returns as legal, and renders from the engine's resulting state (rendering is downstream of rules — the base spec's architecture rule, here an invariant tested by attempting an illegal drag and asserting rejection).
- **Layout invariants** as tests: correct orientation after flip (coordinates and pieces both flip), files/ranks labeled, last-move + check highlight present, no panel overlap across laptop/desktop breakpoints, replay controls stable (no layout jump on hover-preview of a variation).
- **Animation communicates legality, not just motion:** legal-target highlights derive from the engine's legal-move set for the selected piece; a check indicator derives from the engine's in-check predicate. These are projections of engine truth, asserted in tests.

## C8. The concrete first vertical slice (the on-ramp — build THIS first, ~30–45 cards)

Prove the spine end-to-end before breadth:

1. **Typed core + bitboard board** (`bigint` boards), piece/move/position models, Zobrist keys (committed table).
2. **Legal move generator** (pseudo-legal + king-safety filter is fine for v1) covering castling, EP (incl. pin cases), promotion, check/checkmate/stalemate.
3. **The perft suite green to depth ≥4 on all six canonical positions** + the `make/unmake` round-trip property test. *This is the gate; nothing proceeds until it is green.*
4. **FEN round-trip** + **PGN parser/writer** with SAN disambiguation, variations, comments, NAGs, clock tags, round-tripping the torture fixture.
5. **Immutable game tree + pure replay projection** (forward/back, enter variation, board flip preserving variation state).
6. **Fixture UCI engine adapter** returning scripted PV/score/depth, + deterministic blunder classification traceable to evals.
7. **The polished board + move-list + clock + eval panel UI**, rendering only engine-legal states, with the layout/orientation/flip presentation tests.

If that slice is real, study trees, tactics trainer (puzzle state machine: correct / inexact / failed / solved / abandoned / needs-review, each verdict from the legal engine), opening tree with transpositions (Zobrist-keyed), and the tournament viewer are all **breadth on a proven, perft-correct spine.**

## C9. Domain knowledge-debt to surface (track, don't bluff)

- **Magic-number generation**: ship-as-constants vs. generate-at-init; verify collision-freedom in a test either way.
- **NNUE / real evaluation**: out of scope for the fixture engine; flagged as the production eval swap-in with licensing notes (engine binaries and `.nnue` nets have their own licenses).
- **Opening-book licensing / sourcing**: Polyglot `.bin` books and PGN databases have provenance and license considerations; the fixture book is synthetic.
- **Rule-edge ambiguities** real sites get wrong (pinned-EP repetition equality, K+N+N draw status) — documented with the chosen interpretation and citation.
- **Time-control nuance** (Fischer vs. Bronstein increment, delay, byo-yomi) — modeled minimally, extension-pointed.
- **Accessibility** (colorblind-safe last-move/check highlights, keyboard move entry) — flagged for a designer pass.

## C10. Why this is a great !Klein challenge

Chess is the *ideal* small-local-LLM decomposition target because correctness is **externally checkable by a number**: a swarm of weak agents can build the move generator incrementally and *know* they are right when `perft` matches — no human judgment, no flaky oracle, no live dependency. The hard seams (magic bitboards, EP/castling/repetition edge cases, PGN's recursive grammar) are legible, dependency-ordered, and each gated by a deterministic test. It stresses **exhaustive correctness under weak models, determinism, immutable-tree projection, and round-trip fidelity** — and it is genuinely *delightful* to watch a perft suite go green position-by-position as the colony of agents closes the last castling-through-check bug.
