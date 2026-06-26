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

---

## Small-model build guide (3B-ready)

> This section is a mechanical execution guide. Assume the reader is a literal-minded 3B model that cannot infer unstated knowledge. Every card is independently implementable. The perft suite is the acceptance backbone — nothing advances until perft is green.

---

### 1. Glossary & ground rules

**Domain terms:**

- **Square**: one of 64 board positions, indexed 0–63 (a1=0, h1=7, a8=56, h8=63).
- **Piece**: one of `Pawn | Knight | Bishop | Rook | Queen | King`; always belongs to one `Color` (`White | Black`).
- **BitBoard**: a `bigint` with 64 bits, one per square; bit N is set if a piece occupies square N. Use `bigint` — JS `number` is only 53-bit and will silently corrupt a full board.
- **Position**: the complete state needed to generate legal moves: piece-bitboards per (piece-type, color), side to move, castling rights (KQkq flags), en-passant target square or `null`, halfmove clock (for 50-move rule), fullmove number.
- **Pseudo-legal move**: a move that looks legal for the moving piece in isolation but may leave the king in check.
- **Legal move**: a pseudo-legal move that, after being applied, does not leave the moving side's king in check.
- **Perft(depth)**: count of leaf nodes when generating all legal moves to the given depth from a position. Deliberately ignores draw-by-repetition and 50-move (pure move-count only). A match against published numbers proves correctness.
- **Perft divide**: perft broken down by each root move — shows which move family contributes which count, crucial for localizing bugs.
- **FEN**: Forsyth–Edwards Notation. Six space-separated fields: piece placement, side to move, castling rights, EP square, halfmove clock, fullmove number. Example: `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1`.
- **SAN**: Standard Algebraic Notation. Piece letter + destination square, e.g. `Nf3`, `exd5`, `O-O`, `e8=Q+`. Includes disambiguation (file/rank/both) only when required by legality.
- **PGN**: Portable Game Notation. A text format containing a tag roster (e.g. `[Event "..."]`) followed by SAN moves with optional `{ comments }`, `$NAG` annotations, and `(variation)` trees.
- **NAG**: Numeric Annotation Glyph. `$1` = good move, `$2` = poor move, etc.
- **Castling rights**: four boolean flags — white kingside (K), white queenside (Q), black kingside (k), black queenside (q).
- **En passant**: a pawn capture where a pawn on rank 5 (white) or rank 4 (black) captures the square behind an opponent's pawn that just moved two squares.
- **Zobrist key**: a 64-bit hash of a position computed by XOR-ing precomputed random values for each occupied square, side-to-move, castling rights, and EP file. Used for repetition detection and transposition tables.
- **Repetition**: a position (same pieces, side to move, castling rights, AND en-passant possibility) appearing three times in game history.
- **Immutable game tree**: a tree of `GameNode` objects where each node contains a `Position`, a move, annotations, and child nodes for variations. Navigation is a separate `ReplayPath` cursor — the tree itself is never mutated.
- **ReplayProjection**: a pure function `(tree, path) → BoardView` that produces a display-ready snapshot. Never writes to the tree.

**Stack:**

| Concern | Choice |
|---|---|
| Language | TypeScript (strict mode, no `any`) |
| Runtime | Node.js ≥ 20 |
| Test runner | Vitest (`npm test`) |
| Assertions | Vitest `expect` |
| Big integers | Native JS `bigint` — mandatory for 64-bit bitboards |
| UI framework | React + Vite (web-ui); Tailwind CSS v4 |
| No live services | All tests offline; no live chess engine, no network |

**Acceptance command (run this to confirm green):**
```
npm test
```
Run from the project root. All tests must pass. No network calls, no live engine.

**Determinism ground rules (imperative):**
1. Never call `Math.random()` in any module under `src/`. Clocks use an injected `VirtualClock` interface.
2. Never call `Date.now()` in the chess core or simulation.
3. Commit the Zobrist random table as a constant array in `src/core/zobrist-table.ts`. Never generate it at runtime.
4. The perft function must not apply 50-move or repetition pruning — pure move-count only.
5. The replay projection is a pure function. Do not store navigation state on `GameNode`.

---

### 2. The explicit task graph for the first vertical slice

The first slice covers C8 items 1–7: typed core → move generator → perft gate → notation → game tree → engine adapter → UI. Each card is independently verifiable. Complete them in order — later cards import types/functions from earlier ones.

---

**`S01` — Square, Piece, Color types**

dependsOn: none

files: `src/core/types.ts`

interface:
```typescript
export type Color = 'white' | 'black';
export type PieceType = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';
export interface Piece { type: PieceType; color: Color; }
// Squares are 0..63; a1=0, b1=1, ..., h1=7, a2=8, ..., h8=63
export type Square = number; // 0–63
export const FILE = (sq: Square): number => sq & 7;   // 0=a..7=h
export const RANK = (sq: Square): number => sq >> 3;  // 0=rank1..7=rank8
export const SQ = (file: number, rank: number): Square => rank * 8 + file;
export const SQUARE_NAME = (sq: Square): string => 'abcdefgh'[FILE(sq)] + (RANK(sq) + 1);
```

how to implement:
1. Create `src/core/types.ts`.
2. Define `Color`, `PieceType`, `Piece` as above.
3. Define `Square` as a type alias for `number`. Add `FILE`, `RANK`, `SQ`, `SQUARE_NAME` as named exports.
4. Export all.

acceptance: `test/core/types.test.ts` asserts:
- `FILE(0) === 0`, `RANK(0) === 0` (a1)
- `FILE(63) === 7`, `RANK(63) === 7` (h8)
- `SQ(0, 0) === 0`, `SQ(7, 7) === 63`
- `SQUARE_NAME(0) === 'a1'`, `SQUARE_NAME(63) === 'h8'`
Run `npm test` → green.

---

**`S02` — BitBoard type + primitive operations**

dependsOn: `S01`

files: `src/core/bitboard.ts`, `test/core/bitboard.test.ts`

interface:
```typescript
export type BitBoard = bigint;
export const BB_EMPTY: BitBoard = 0n;
export const BB_ALL: BitBoard = 0xFFFFFFFFFFFFFFFFn;
export function bbSet(bb: BitBoard, sq: Square): BitBoard;    // set bit sq
export function bbClear(bb: BitBoard, sq: Square): BitBoard;  // clear bit sq
export function bbHas(bb: BitBoard, sq: Square): boolean;     // test bit sq
export function bbLSB(bb: BitBoard): Square;                  // index of lowest set bit; throws if bb===0n
export function bbPopCount(bb: BitBoard): number;             // count set bits
export function bbToSquares(bb: BitBoard): Square[];          // list all set bits
```

how to implement:
1. Create `src/core/bitboard.ts`.
2. `bbSet`: `return bb | (1n << BigInt(sq));`
3. `bbClear`: `return bb & ~(1n << BigInt(sq));`
4. `bbHas`: `return (bb >> BigInt(sq) & 1n) === 1n;`
5. `bbLSB`: `if (bb === 0n) throw new Error('bbLSB of empty'); return Number(BigInt.asUintN(64, bb & -bb).toString(2).length - 1);` — actually simpler: use a loop or `Math.log2` on the Number coercion of the lowest bit. Recommended: `return Number((bb & -bb) === 1n ? 0n : BigInt(64) - BigInt(Math.clz32(Number(bb & -bb)) + 32));` — or just iterate. Safest: `let lsb = bb & -bb; let n = 0; while ((lsb >>= 1n) > 0n) n++; return n;`
6. `bbPopCount`: count bits — iterate `while(bb > 0n) { bb &= bb - 1n; count++; }`.
7. `bbToSquares`: loop while bb > 0n, extract LSB each time.

acceptance: `test/core/bitboard.test.ts`:
- `bbHas(bbSet(0n, 0), 0) === true`
- `bbHas(bbSet(0n, 63), 63) === true`
- `bbHas(bbClear(bbSet(0n, 5), 5), 5) === false`
- `bbLSB(bbSet(0n, 12)) === 12`
- `bbPopCount(0b1010n) === 2`
- `bbToSquares(0b1101n)` equals `[0, 2, 3]`
Run `npm test` → green.

---

**`S03` — CastlingRights + Position type**

dependsOn: `S01`, `S02`

files: `src/core/position.ts`, `test/core/position.test.ts`

interface:
```typescript
import { BitBoard, BB_EMPTY } from './bitboard.js';
import { Color, PieceType, Square } from './types.js';

export interface CastlingRights {
  whiteKingside: boolean;
  whiteQueenside: boolean;
  blackKingside: boolean;
  blackQueenside: boolean;
}
export const NO_CASTLING: CastlingRights = { whiteKingside: false, whiteQueenside: false, blackKingside: false, blackQueenside: false };
export const ALL_CASTLING: CastlingRights = { whiteKingside: true, whiteQueenside: true, blackKingside: true, blackQueenside: true };

export interface Position {
  // bitboards[color][pieceType] — indexed by Color and PieceType
  pieces: Record<Color, Record<PieceType, BitBoard>>;
  sideToMove: Color;
  castling: CastlingRights;
  epSquare: Square | null;   // target square behind the double-pushed pawn, or null
  halfmoveClock: number;     // resets on pawn move or capture
  fullmoveNumber: number;
  zobristKey: bigint;
}
export function emptyPosition(): Position;
```

how to implement:
1. Create `src/core/position.ts`.
2. Define `CastlingRights` and the two constants.
3. Define `Position` as above. All `BitBoard` fields start at `BB_EMPTY`.
4. Implement `emptyPosition()` — returns a position with all piece bitboards `BB_EMPTY`, `sideToMove: 'white'`, `NO_CASTLING`, `epSquare: null`, clocks at 0 and 1, `zobristKey: 0n`.

acceptance: `test/core/position.test.ts`:
- `emptyPosition().sideToMove === 'white'`
- `emptyPosition().epSquare === null`
- All piece bitboards in `emptyPosition()` equal `BB_EMPTY`
Run `npm test` → green.

---

**`S04` — Zobrist table (committed constant)**

dependsOn: `S01`

files: `src/core/zobrist-table.ts`, `test/core/zobrist-table.test.ts`

interface:
```typescript
// A committed, never-randomly-generated table.
// pieceKeys[colorIndex][pieceTypeIndex][square]: bigint — 64-bit value
// colorIndex: 0=white, 1=black
// pieceTypeIndex: 0=pawn,1=knight,2=bishop,3=rook,4=queen,5=king
export const ZOBRIST_PIECE_KEYS: bigint[][][];   // [2][6][64]
export const ZOBRIST_SIDE_KEY: bigint;           // XOR when it's black's turn
export const ZOBRIST_CASTLING_KEYS: bigint[];    // [16] — one per castling-rights bitmask (KQkq = 4 bits → 16 combos)
export const ZOBRIST_EP_FILE_KEYS: bigint[];     // [8] — one per EP file (a–h)
export function computeZobristKey(pos: Position): bigint;
```

how to implement:
1. Create `src/core/zobrist-table.ts`. The values MUST be hard-coded constants — copy from a known-good source or generate once with a script and paste in. Never compute at runtime with `Math.random()`.
2. Use the 64-bit constants from a well-known open-source engine (e.g. Polyglot random numbers, which are public domain): https://www.chessprogramming.org/Zobrist_Hashing — or generate offline via a seeded SplitMix64 and commit.
3. Export the arrays and `computeZobristKey(pos)` which XORs piece keys for every occupied square + side key if black + matching castling key + EP file key if EP is active.

acceptance: `test/core/zobrist-table.test.ts`:
- `computeZobristKey(emptyPosition())` returns a `bigint` (may be 0n for the empty position, which has no pieces, white to move, no castling, no EP).
- For the starting FEN, `computeZobristKey(parseFen(STARTING_FEN))` equals a precomputed expected value (compute once in the test setup and hard-code as the expected, then assert it's stable across re-runs).
- Two positions differing only in EP file have different Zobrist keys.
Run `npm test` → green.

---

**`S05` — FEN parser + serializer**

dependsOn: `S03`, `S04`

files: `src/notation/fen.ts`, `test/notation/fen.test.ts`

interface:
```typescript
export const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export class FenParseError extends Error {}
export function parseFen(fen: string): Position;   // throws FenParseError on malformed input
export function serializeFen(pos: Position): string;
```

how to implement:
1. Create `src/notation/fen.ts`.
2. Split the FEN string on spaces; assert exactly 6 fields.
3. Parse field 1 (piece placement): split on `/`, iterate 8 ranks from rank 8 down to rank 1, map piece letters to `(PieceType, Color)`, set the appropriate bit in `pieces[color][pieceType]`.
4. Parse field 2 (side to move): `'w'` → `'white'`, `'b'` → `'black'`.
5. Parse field 3 (castling): iterate characters `K`, `Q`, `k`, `q`; `-` means no castling.
6. Parse field 4 (EP square): `-` → `null`; otherwise convert algebraic (e.g. `e3`) to a `Square`.
7. Parse fields 5–6 (halfmove clock, fullmove number) as integers.
8. Compute `zobristKey` using `computeZobristKey`.
9. `serializeFen`: reverse of the above; produce the canonical six-field string.
10. Throw `FenParseError` (not a crash) on malformed input.

acceptance: `test/notation/fen.test.ts`:
- `serializeFen(parseFen(STARTING_FEN)) === STARTING_FEN`
- Round-trip the Kiwipete FEN: `serializeFen(parseFen(KIWIPETE)) === KIWIPETE` where `KIWIPETE = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -'` (note: this FEN omits clocks — treat as `0 1` or accept and re-add).
- `parseFen('invalid fen')` throws `FenParseError`.
- `parseFen(STARTING_FEN).sideToMove === 'white'`
- `parseFen(STARTING_FEN).castling.whiteKingside === true`
Run `npm test` → green.

---

**`S06` — Move type + move encoding**

dependsOn: `S01`

files: `src/core/move.ts`, `test/core/move.test.ts`

interface:
```typescript
export type MoveFlag =
  | 'normal'
  | 'capture'
  | 'ep-capture'
  | 'castle-kingside'
  | 'castle-queenside'
  | 'promotion'
  | 'promotion-capture';

export interface Move {
  from: Square;
  to: Square;
  piece: PieceType;
  color: Color;
  flag: MoveFlag;
  promotion?: PieceType;  // only set when flag is 'promotion' or 'promotion-capture'
  captured?: PieceType;   // only set for capture variants
}

export function movesEqual(a: Move, b: Move): boolean;
export function moveToUci(m: Move): string;  // e.g. "e2e4", "e7e8q"
```

how to implement:
1. Create `src/core/move.ts`.
2. Define `MoveFlag` union and `Move` interface exactly as above.
3. `movesEqual`: compare all fields with `===`.
4. `moveToUci`: `SQUARE_NAME(m.from) + SQUARE_NAME(m.to) + (m.promotion ? m.promotion[0] : '')` — promotion letter is the first char of the PieceType string (e.g. `'queen'[0] = 'q'`).

acceptance: `test/core/move.test.ts`:
- `moveToUci({ from: SQ(4,1), to: SQ(4,3), piece: 'pawn', color: 'white', flag: 'normal' }) === 'e2e4'`
- `moveToUci({ from: SQ(4,6), to: SQ(4,7), piece: 'pawn', color: 'white', flag: 'promotion', promotion: 'queen' }) === 'e7e8q'`
- `movesEqual(m, m) === true` for any valid move.
Run `npm test` → green.

---

**`S07` — Pseudo-legal pawn move generator**

dependsOn: `S05`, `S06`

files: `src/core/movegen-pawns.ts`, `test/core/movegen-pawns.test.ts`

interface:
```typescript
// Returns all pseudo-legal pawn moves from the given position.
// Does NOT filter for king safety.
export function generatePawnMoves(pos: Position): Move[];
```

how to implement:
1. Create `src/core/movegen-pawns.ts`.
2. Extract `pawns: BitBoard` for the side to move. Iterate `bbToSquares(pawns)`.
3. For each pawn square:
   - Single push: one square forward. If blocked by any piece, skip.
   - Double push: only from starting rank (rank 2 for white, rank 7 for black); only if single-push square is also empty.
   - Diagonal captures: only if an enemy piece occupies the capture square. Set flag `'capture'`, include `captured` type.
   - En passant capture: if `pos.epSquare` is reachable diagonally, add a move with `flag: 'ep-capture'`.
   - Promotions: if the pawn reaches rank 8 (white) or rank 1 (black), emit four moves (q, r, b, n) with `flag: 'promotion'` or `'promotion-capture'`.
4. "Blocked" means checking the all-pieces occupancy bitboard.

acceptance: `test/core/movegen-pawns.test.ts`:
- From `STARTING_FEN`, there are 16 pawn moves (8 single pushes + 8 double pushes).
- From `parseFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1')`, black has a pawn that can capture en passant (if a black pawn is on d4 or f4) — add a fixture where it IS available and assert the EP move is in the list.
- From `parseFen('8/4P3/8/8/8/8/8/8 w - - 0 1')`, the white e7 pawn generates exactly 4 promotion moves (no capture).
Run `npm test` → green.

---

**`S08` — Pseudo-legal move generators for all other pieces**

dependsOn: `S07`

files: `src/core/movegen-pieces.ts`, `test/core/movegen-pieces.test.ts`

interface:
```typescript
export function generateKnightMoves(pos: Position): Move[];
export function generateBishopMoves(pos: Position): Move[];
export function generateRookMoves(pos: Position): Move[];
export function generateQueenMoves(pos: Position): Move[];
export function generateKingMoves(pos: Position): Move[];  // includes castling (pseudo-legal: does not check king safety yet)
export function generatePseudoLegalMoves(pos: Position): Move[];  // all of the above + pawns
```

how to implement:
1. Create `src/core/movegen-pieces.ts`.
2. For knights: precompute a lookup table `KNIGHT_ATTACKS[64]: BitBoard` (the 8 knight-leap offsets, clipped at board edges). Iterate each knight square, intersect with `~ownPieces` for targets.
3. For bishops/rooks: implement ray-scan sliding. For each direction, scan squares until blocked. Stop before capturing own piece; include enemy-piece capture square.
4. Queens = bishops + rooks combined.
5. For kings: precompute `KING_ATTACKS[64]: BitBoard` (8 adjacent squares). Plus castling: emit `'castle-kingside'` / `'castle-queenside'` moves if castling rights are set AND the squares between king and rook are empty (do NOT check for attacks through — that is legality filtering, not pseudo-legality).
6. `generatePseudoLegalMoves`: concatenate all generators.

acceptance: `test/core/movegen-pieces.test.ts`:
- From `STARTING_FEN`, knights have 4 moves (2 knights × 2 squares each). Total pseudo-legal moves = 20 (matches perft depth 1).
- From `parseFen('8/8/8/8/8/8/8/R7 w - - 0 1')`, the a1 rook has 14 moves.
- From `parseFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1')`, white king has castling moves (kingside and queenside) in the pseudo-legal set.
Run `npm test` → green.

---

**`S09` — makeMove / unmakeMove + apply-position**

dependsOn: `S08`

files: `src/core/make-move.ts`, `test/core/make-move.test.ts`

interface:
```typescript
// Returns a new Position (immutable — does not mutate pos).
export function makeMove(pos: Position, move: Move): Position;

// Undo — provided the move was the last applied to pos.
// Stored undo info: pack it into an UndoInfo record returned by makeMove.
export interface MakeMoveResult {
  position: Position;
  undo: UndoInfo;
}
export interface UndoInfo {
  move: Move;
  capturedPiece: PieceType | null;
  prevCastling: CastlingRights;
  prevEpSquare: Square | null;
  prevHalfmoveClock: number;
  prevZobristKey: bigint;
}
export function makeMoveWithUndo(pos: Position, move: Move): MakeMoveResult;
export function unmakeMove(pos: Position, undo: UndoInfo): Position;
```

how to implement:
1. Create `src/core/make-move.ts`. Implement using pure, immutable style — always construct a new `Position` object (copy all bitboards).
2. `makeMove(pos, move)`: apply the move — clear the from-square bit, set the to-square bit, handle captures (clear enemy piece bit), handle EP (clear the captured pawn on the EP rank), handle castling (also move rook), handle promotion (replace pawn bit with promotion piece bit). Update `sideToMove`, `castling`, `epSquare`, `halfmoveClock`, `fullmoveNumber`, and `zobristKey` incrementally.
3. `makeMoveWithUndo`: same as `makeMove` but also return the `UndoInfo`.
4. `unmakeMove`: restore the position from `UndoInfo` — reverse all bit operations.

acceptance: `test/core/make-move.test.ts`:
- `makeMove(parseFen(STARTING_FEN), e2e4Move).epSquare` is the e3 square (behind the double-pushed pawn).
- `unmakeMove(makeMove(pos, m), undo)` deepEquals `pos` for a random set of legal moves (use multiple named fixtures; e.g. starting position e2e4, Kiwipete pawn push, Kiwipete EP capture).
- After a pawn move, `halfmoveClock === 0`. After a quiet knight move, `halfmoveClock === prevClock + 1`.
- Castling kingside moves both king (e1→g1) and rook (h1→f1) in the resulting position.
Run `npm test` → green.

---

**`S10` — Legal move filter + in-check predicate**

dependsOn: `S09`

files: `src/core/legal-moves.ts`, `test/core/legal-moves.test.ts`

interface:
```typescript
// Returns true if the given side's king is attacked in pos.
export function isInCheck(pos: Position, color: Color): boolean;

// Returns only legal moves (pseudo-legal + king-safe after application).
export function generateLegalMoves(pos: Position): Move[];

// Returns true if the position is checkmate (in check and no legal moves).
export function isCheckmate(pos: Position): boolean;

// Returns true if the position is stalemate (not in check and no legal moves).
export function isStalemate(pos: Position): boolean;
```

how to implement:
1. Create `src/core/legal-moves.ts`.
2. `isInCheck(pos, color)`: find the king's square, generate all pseudo-legal moves for the OPPONENT (using `pos` with flipped side to move), return whether any opponent move targets the king's square. Alternatively, generate attack bitboards for all opponent pieces and test the king square — simpler and faster.
3. `generateLegalMoves(pos)`: for each pseudo-legal move from `generatePseudoLegalMoves(pos)`, apply it with `makeMove`, call `isInCheck(newPos, pos.sideToMove)` — if the king is NOT in check, keep the move. Also: for castling moves, check that the king's starting square and the squares it passes through are not in check (three king squares for kingside: e1, f1, g1).
4. `isCheckmate`: `isInCheck(pos, pos.sideToMove) && generateLegalMoves(pos).length === 0`.
5. `isStalemate`: `!isInCheck(pos, pos.sideToMove) && generateLegalMoves(pos).length === 0`.

acceptance: `test/core/legal-moves.test.ts`:
- `generateLegalMoves(parseFen(STARTING_FEN)).length === 20`.
- Scholar's mate position (after e4 e5 Bc4 Nc6 Qh5 Nf6 Qxf7): `isCheckmate(pos) === true`.
- A known stalemate FEN (e.g. `7k/8/6Q1/8/8/8/8/7K w - - 0 1` after white plays the stalemating move, or use a well-known stalemate position): `isStalemate(pos) === true`.
- Castling-through-check: from `parseFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1')`, if f1 is attacked by a rook on f8, kingside castling is not in `generateLegalMoves`.
Run `npm test` → green.

---

**`S11` — Perft function + divide**

dependsOn: `S10`

files: `src/core/perft.ts`, `test/core/perft.test.ts`

interface:
```typescript
export function perft(pos: Position, depth: number): number;
export function perftDivide(pos: Position, depth: number): Map<string, number>;  // move UCI → node count
```

how to implement:
1. Create `src/core/perft.ts`.
2. `perft(pos, depth)`: if `depth === 0`, return 1. Generate legal moves. For each, apply `makeMove`, recurse with `depth - 1`, sum results.
3. `perftDivide(pos, depth)`: like perft but at the root, record each root move's subtotal in a `Map<string, number>` keyed by `moveToUci(move)`.
4. **Do not** apply 50-move rule or repetition in perft — pure move count only.
5. Optimization note: at `depth === 1`, you can return `legalMoves.length` directly without recursing (bulk counting). This is an important speedup for depth-4/5 tests.

acceptance: `test/core/perft.test.ts`:
Assert these exact values (from C2):
```
perft(parseFen(STARTING_FEN), 1) === 20
perft(parseFen(STARTING_FEN), 2) === 400
perft(parseFen(STARTING_FEN), 3) === 8902
perft(parseFen(STARTING_FEN), 4) === 197281
perft(parseFen(KIWIPETE), 1) === 48
perft(parseFen(KIWIPETE), 2) === 2039
perft(parseFen(KIWIPETE), 3) === 97862
perft(parseFen(KIWIPETE), 4) === 4085603
```
These are the gate. Mark tests for positions 3–6 at depth 4 as non-fast (timeout 30s each). All must pass.
Run `npm test` → green. **This is the perft gate. Nothing in the slice proceeds past this point until these numbers match exactly.**

---

**`S12` — make/unmake round-trip property test**

dependsOn: `S11`

files: `test/core/make-unmake-roundtrip.test.ts`

interface: no new production code; test only.

how to implement:
1. Create the test file.
2. Enumerate a fixed set of 10 named fixture positions (starting, Kiwipete, positions 3–6 from perft table, plus 3 crafted positions covering EP capture, castling, and promotion).
3. For each fixture position, generate legal moves, apply `makeMoveWithUndo` to each, call `unmakeMove`, and assert `deepEquals(restored, original)` — checking all piece bitboards, castling rights, EP square, halfmove clock, fullmove number, and Zobrist key.

acceptance: all assertions pass; no mutation of the original position detected.
Run `npm test` → green.

---

**`S13` — PGN parser (tags, SAN moves, variations, comments, NAGs, clock tags)**

dependsOn: `S10`, `S05`

files: `src/notation/san.ts`, `src/notation/pgn-parser.ts`, `test/notation/pgn.test.ts`

interface:
```typescript
// SAN generation
export function toSan(pos: Position, move: Move): string;
// SAN parsing — throws if not a legal move
export function parseSan(pos: Position, san: string): Move;

// PGN tree node
export interface GameNode {
  move: Move | null;          // null for the root node
  san: string | null;
  position: Position;
  annotations: { nags: number[]; comment: string | null; clockSeconds: number | null };
  children: GameNode[];       // index 0 = mainline; others = variations
  parent: GameNode | null;
}
export interface PgnGame {
  tags: Record<string, string>;
  root: GameNode;
}
export function parsePgn(text: string): PgnGame;
export function serializePgn(game: PgnGame): string;
```

how to implement:
1. Create `src/notation/san.ts`. Implement `toSan(pos, move)`:
   - Pawn moves: file-of-origin + `x` + destination + promotion suffix.
   - Piece moves: piece letter (not pawn) + disambiguation + `x` (if capture) + destination.
   - Disambiguation: among all legal moves that match piece type + destination, if two exist, add file (if files differ), else rank (if ranks differ), else both. Check: if one of the alternatives is illegal due to a pin, it is NOT in `generateLegalMoves`, so disambiguation may be omitted — always work from the actual legal-moves list.
   - Castling: `O-O` or `O-O-O`.
   - Check/mate suffix: `+` or `#`.
2. Implement `parseSan(pos, san)`: find the matching move in `generateLegalMoves(pos)` by converting each to SAN and comparing.
3. Create `src/notation/pgn-parser.ts`. Use a recursive descent parser:
   - Parse tag roster: `[Key "Value"]` pairs.
   - Parse move text: recognize move numbers, SAN tokens, `$NAG`, `{ comment }` (with optional `{[%clk H:MM:SS]}`), and `( variation )` recursively.
   - Build the `GameNode` tree as you parse.
4. `serializePgn`: reconstruct tag roster + move text from the tree, with `( ... )` for variations.

acceptance: `test/notation/pgn.test.ts`:
- Parse the fixture PGN string (a 10-move game with one nested variation, one NAG, one `{[%clk 0:01:23]}` comment) — assert tag values, that the mainline has the right number of moves, that the variation branches off the correct move, that the clock annotation is `83` seconds.
- `serializePgn(parsePgn(FIXTURE_PGN))` round-trips to a canonically whitespace-normalized form (define the normalization: single space between moves, newline before each tag, etc.) and assert the result matches a pre-written expected string stored in the test.
Run `npm test` → green.

---

**`S14` — Immutable game tree + pure replay projection**

dependsOn: `S13`

files: `src/replay/game-tree.ts`, `src/replay/replay-projection.ts`, `test/replay/replay.test.ts`

interface:
```typescript
// Path through the variation tree: list of child-indices at each node
export type VariationPath = number[];

export interface BoardView {
  position: Position;
  legalMoves: Move[];
  lastMove: Move | null;
  orientation: Color;  // which side is at the bottom
  path: VariationPath;
}

// Pure function: derive a display-ready view
export function replayProjection(root: GameNode, path: VariationPath, orientation: Color): BoardView;

// Navigation helpers (pure — return new path, do not mutate)
export function pathForward(root: GameNode, path: VariationPath): VariationPath;
export function pathBackward(path: VariationPath): VariationPath;
export function pathEnterVariation(path: VariationPath, variationIndex: number): VariationPath;
export function pathFlipOrientation(view: BoardView): BoardView;  // returns new view with flipped orientation, same path
```

how to implement:
1. Create `src/replay/game-tree.ts` — types only, re-export `GameNode`.
2. Create `src/replay/replay-projection.ts`.
3. `replayProjection(root, path, orientation)`: walk the `GameNode` tree following the path indices, gather the position at the end, compute `legalMoves`, record `lastMove`.
4. Navigation helpers: `pathForward` appends `0` (mainline child) if exists; `pathBackward` pops the last index (returns `[]` at root); `pathEnterVariation` replaces the last index.
5. `pathFlipOrientation`: return `{ ...view, orientation: view.orientation === 'white' ? 'black' : 'white' }`.
6. **Key invariant:** `root` is never mutated; all helpers return new paths/views.

acceptance: `test/replay/replay.test.ts`:
- Load the fixture PGN from S13. Navigate to move 3 (mainline). Assert the position matches the expected FEN.
- Enter variation 1 at move 3. Assert position changes.
- Flip orientation on a view. Assert `orientation` changed but `path` and `position` are unchanged.
- Navigate forward then backward; assert final path equals the original path.
Run `npm test` → green.

---

**`S15` — Fixture UCI engine adapter**

dependsOn: `S14`, `S05`

files: `src/engine/engine-adapter.ts`, `src/engine/fixture-engine.ts`, `test/engine/engine-adapter.test.ts`

interface:
```typescript
export type ScoreType = 'cp' | 'mate';
export interface EngineAnalysis {
  depth: number;
  scoreType: ScoreType;
  value: number;          // centipawns (for cp) or mate-in-N (for mate)
  pv: Move[];             // principal variation
  multipv: number;        // which line (1-based)
}
export interface BlunderClassification {
  from: EngineAnalysis;
  to: EngineAnalysis;
  label: 'brilliant' | 'good' | 'inaccuracy' | 'mistake' | 'blunder' | 'normal';
  betterPv: Move[];       // the PV that was ignored (when label is blunder/mistake/inaccuracy)
}

export interface EngineAdapter {
  analyzePosition(pos: Position, depth: number): Promise<EngineAnalysis[]>;
}

export function classifyMove(before: EngineAnalysis, after: EngineAnalysis): BlunderClassification;

// Fixture engine: returns scripted analysis keyed by Zobrist key
export function makeFixtureEngine(script: Map<bigint, EngineAnalysis[]>): EngineAdapter;
```

how to implement:
1. Create `src/engine/engine-adapter.ts` with the types and `classifyMove`. Implement `classifyMove` as a pure function: compute centipawn-loss = `before.value - after.value` (with mate-aware clamping: a mated-in-N counts as −∞ loss). Apply thresholds: 0–25 = normal, 26–50 = inaccuracy, 51–100 = mistake, >100 = blunder; gaining eval = good/brilliant.
2. Create `src/engine/fixture-engine.ts`. `makeFixtureEngine(script)` returns an object whose `analyzePosition(pos, depth)` looks up `pos.zobristKey` in the `script` map and returns the scripted analysis. If not found, return a default analysis (`depth: 0, scoreType: 'cp', value: 0, pv: [], multipv: 1`).

acceptance: `test/engine/engine-adapter.test.ts`:
- Build a fixture engine with a scripted position. Call `analyzePosition(thatPos, 4)`. Assert the returned analysis matches the scripted values exactly.
- `classifyMove({ scoreType: 'cp', value: 200, ... }, { scoreType: 'cp', value: 50, ... })` returns `label: 'blunder'` (loss of 150 cp).
- `classifyMove({ scoreType: 'cp', value: 10, ... }, { scoreType: 'cp', value: 15, ... })` returns `label: 'normal'`.
- `classifyMove({ scoreType: 'mate', value: 3, ... }, { scoreType: 'cp', value: -100, ... })` returns `label: 'blunder'`.
Run `npm test` → green.

---

**`S16` — Board UI component (legal moves only, orientation, last-move highlight)**

dependsOn: `S14`

files: `src/components/chess/ChessBoard.tsx`, `test/components/chess/ChessBoard.test.tsx`

interface:
```typescript
interface ChessBoardProps {
  view: BoardView;
  onMove: (move: Move) => void;  // called only for legal moves; UI never emits illegal moves
}
export function ChessBoard(props: ChessBoardProps): JSX.Element;
```

how to implement:
1. Create `src/components/chess/ChessBoard.tsx`.
2. Render an 8×8 grid. Squares ordered by `view.orientation` (white at bottom: rank 1 at the bottom row, a-file on the left; flip both axes for black).
3. Render piece SVGs or Unicode characters (placeholder acceptable for skeleton; final must not be text-only per base spec — use SVG or an icon set).
4. On click of a piece belonging to `view.position.sideToMove`, highlight the square and show `view.legalMoves` targets for that piece.
5. On click of a highlighted target, call `props.onMove(move)`. Never emit a move not in `view.legalMoves`.
6. Highlight `view.lastMove.from` and `view.lastMove.to` with a last-move marker.
7. If `isInCheck(view.position, view.position.sideToMove)`, highlight the king's square.

acceptance: `test/components/chess/ChessBoard.test.tsx` (React Testing Library):
- Render with a starting-position `BoardView`. Assert 64 squares are rendered.
- Assert all pieces are present (16 white, 16 black).
- Click the e2 pawn. Assert legal-target highlights appear on e3 and e4.
- Attempt to simulate clicking a square not in the legal targets — assert `onMove` is not called.
Run `npm test` → green.

---

**`S17` — Move list + clock panel + eval bar UI**

dependsOn: `S15`, `S16`

files: `src/components/chess/MoveList.tsx`, `src/components/chess/ClockPanel.tsx`, `src/components/chess/EvalBar.tsx`, `test/components/chess/panels.test.tsx`

interface:
```typescript
interface MoveListProps {
  root: GameNode;
  path: VariationPath;
  onNavigate: (path: VariationPath) => void;
}
export function MoveList(props: MoveListProps): JSX.Element;

interface ClockPanelProps {
  whiteSeconds: number;
  blackSeconds: number;
  activeColor: Color;
}
export function ClockPanel(props: ClockPanelProps): JSX.Element;

interface EvalBarProps {
  analysis: EngineAnalysis | null;
  orientation: Color;
}
export function EvalBar(props: EvalBarProps): JSX.Element;
```

how to implement:
1. `MoveList`: render move numbers and SAN tokens. Clicking a move navigates to it (calls `onNavigate` with the path to that node). Render variations as indented sub-lists.
2. `ClockPanel`: display two clocks. Highlight the active side.
3. `EvalBar`: vertical bar showing engine advantage. If `analysis.scoreType === 'cp'`, fill white's side proportionally. If `scoreType === 'mate'`, show "M3" etc.

acceptance: `test/components/chess/panels.test.tsx`:
- Render `MoveList` with a parsed PGN fixture. Assert move number `1.` appears, and the mainline first move SAN is visible.
- Click a move in the list — assert `onNavigate` was called with a non-empty path.
- Render `EvalBar` with `{ scoreType: 'cp', value: 50 }`. Assert it renders without crash and shows some visual indication.
Run `npm test` → green.

---

**`S18` — Full board page + layout integration test**

dependsOn: `S17`

files: `src/pages/BoardPage.tsx`, `test/components/chess/layout.test.tsx`

interface:
```typescript
// Wires together ChessBoard + MoveList + ClockPanel + EvalBar in a page layout.
export function BoardPage(): JSX.Element;
```

how to implement:
1. Create `src/pages/BoardPage.tsx`. Initialize with `parseFen(STARTING_FEN)` and an empty `GameNode` root.
2. Wire `onMove` to call `makeMove`, create a new `GameNode`, append to the tree, and update the `VariationPath`.
3. Show `MoveList`, `ClockPanel` (static clocks for now), and `EvalBar` (no analysis until engine is connected).
4. Add a "Flip board" button that calls `pathFlipOrientation`.

acceptance: `test/components/chess/layout.test.tsx`:
- Render `BoardPage`. Assert no overlapping panels (check layout classes — no absolute-positioned panels with the same z-index stack).
- Assert the board, move list, and clock panel are all present in the DOM.
- Click "Flip board" — assert the board orientation changes (a-file moves from left to right or similar orientation signal in the rendered HTML).
Run `npm test` → green.

---

### 3. The decomposition method for the rest

After the first slice is green (all 18 cards pass `npm test`, perft gate is green to depth ≥4 on all six positions), expand the remaining breadth by the following method. Use this as the recipe for `decompose_project` on any remaining feature.

**The recipe (apply once per feature cluster):**

1. **Name the invariant the feature must never break.** For chess features, the invariant is always one of: (a) perft stays green, (b) FEN/PGN round-trips, (c) the replay projection is pure and non-mutating, (d) the engine adapter boundary stays deterministic.
2. **Write the acceptance test first (the card's last step).** If you cannot state a concrete passing assertion, the card is not well-defined — split it further.
3. **Identify what prior card's output this imports.** Add it as a `dependsOn` edge. Never write a card that requires something not yet defined.
4. **Keep each card ≤ one focused step.** A card that says "implement en passant" is too large — split into: (a) detect EP legality in move generator, (b) test EP pin cases specifically, (c) add perft regression for position 3 (which exercises EP heavily).

**Worked example 1: en passant pin case (C6 fixture)**

Turn the spec's "en-passant discovered check / horizontal pin" fixture into 2 cards:
- **`B01` — EP-pin fixture position.** Produce the FEN for the horizontal-pin EP position (e.g. `8/8/8/K1Pp3r/8/8/8/8 w - d6 0 1` — white king on a5, white pawn on c5, black pawn just pushed to d5, black rook on h5; capturing d6 exposes king). Store in `src/fixtures/positions.ts`. Acceptance: `parseFen` round-trips the FEN; `generateLegalMoves` does NOT include the EP capture.
- **`B02` — EP-pin perft regression.** Add this position to `perft.test.ts` at depth 1 and depth 3 with precomputed counts. Acceptance: perft matches.

**Worked example 2: PGN torture round-trip (C6 fixture)**

Turn "PGN round-trip torture" into 3 cards:
- **`B03` — Nested variations PGN fixture.** Write a PGN string with 3 levels of nested variations and commit it to `src/fixtures/pgn-torture.pgn`. Acceptance: `parsePgn(text)` returns a root with 3 levels of `children` arrays at the branch point.
- **`B04` — Clock + NAG round-trip.** Extend the PGN fixture to include `{[%clk 0:05:42]}` and `$6` annotations. Acceptance: `parsePgn` stores clock seconds and NAG values; `serializePgn(parsePgn(pgn))` is a byte-stable round-trip.
- **`B05` — Disambiguation round-trip.** A fixture position where two rooks can move to d1 but one is pinned, so SAN output omits the file disambiguator. Acceptance: `toSan` produces the unambiguous-looking string; `parseSan` recovers the correct move.

**Worked example 3: tactics trainer puzzle state machine (base spec requirement)**

- **`B06` — Puzzle model types.** `PuzzleState`, `PuzzleVerdict: 'correct' | 'inexact' | 'failed' | 'solved' | 'abandoned' | 'needs-review'`, `PuzzleAttempt`. Store in `src/puzzles/types.ts`.
- **`B07` — Puzzle state machine.** Pure function `advancePuzzle(state, candidateMove): PuzzleState`. Acceptance: fixture puzzle (FEN + solution line); playing the correct move produces `'correct'`; playing an alternative legal move produces `'inexact'` or `'failed'` based on whether it's in the solution tree; exhausting all correct moves produces `'solved'`.
- **`B08` — Puzzle spaced repetition metadata.** Add `nextReviewAt: Date`, `intervalDays: number`, `reviewCount: number` to puzzle state. `scheduleReview(verdict): PuzzleState` updates these deterministically (use a seeded SM2 algorithm — no `Date.now()`; inject a clock). Acceptance: `scheduleReview('correct')` increases `intervalDays`; `scheduleReview('failed')` resets it.

Use this same three-card cluster shape for every new feature: types → state machine → persistence/scheduling.

---

### 4. Per-task implementation conventions

**Folder layout:**
```
src/
  core/          -- types, bitboards, position, movegen, make-move, legal-moves, perft, zobrist
  notation/      -- fen.ts, san.ts, pgn-parser.ts
  engine/        -- engine-adapter.ts, fixture-engine.ts
  replay/        -- game-tree.ts, replay-projection.ts
  puzzles/       -- types.ts, puzzle-state-machine.ts
  study/         -- opening-tree.ts, study-state.ts
  tournament/    -- tournament-types.ts, tournament-state.ts
  components/
    chess/       -- ChessBoard.tsx, MoveList.tsx, ClockPanel.tsx, EvalBar.tsx
    ui/          -- shared primitives
  pages/         -- BoardPage.tsx
  fixtures/      -- positions.ts, pgn-torture.pgn, fixture-engine-scripts.ts
test/
  core/
  notation/
  engine/
  replay/
  components/chess/
```

**How to write a test in this stack (minimal Vitest snippet):**
```typescript
// test/core/example.test.ts
import { describe, it, expect } from 'vitest';
import { parseFen, serializeFen } from '../../src/notation/fen.js';

describe('FEN round-trip', () => {
  it('starting position', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    expect(serializeFen(parseFen(fen))).toBe(fen);
  });
});
```
Run with `npm test`. Every test file must import from `.js` extensions (ESM Node).

**Keeping it deterministic:**
- Never use `Math.random()`. If you need a seeded value, import a SplitMix64 PRNG from a fixed seed.
- Never call `Date.now()` in core. Inject a `Clock` interface `{ nowMs(): number }` and pass a `VirtualClock` that you advance manually in tests.
- The Zobrist table is a committed constant file. Never regenerate it at runtime.
- Perft and `generateLegalMoves` must be pure functions with no side effects.

**How to wire a fixture adapter:**
```typescript
// In tests, use the fixture engine:
const script = new Map<bigint, EngineAnalysis[]>();
const startPos = parseFen(STARTING_FEN);
script.set(startPos.zobristKey, [
  { depth: 4, scoreType: 'cp', value: 22, pv: [/* ... */], multipv: 1 }
]);
const engine = makeFixtureEngine(script);
const result = await engine.analyzePosition(startPos, 4);
```

**Definition of done for any card:**
1. All acceptance tests in the card's test file pass under `npm test`.
2. TypeScript compiles with zero errors (no `any` types introduced).
3. No new calls to `Math.random()`, `Date.now()`, or `fetch` in `src/`.
4. The perft suite remains green (run `npm test` — do not add a skip to perft tests).
5. No mutation of existing `Position`, `GameNode`, or `Move` objects.

---

### 5. Common pitfalls for a weak model on this project

**Pitfall 1: Using JS `number` instead of `bigint` for bitboards.**
A `number` is only 53 bits. Squares 53–63 will silently corrupt. The fix is mandatory: every bitboard field must be `bigint`. All bitboard operations must use `1n << BigInt(sq)`, not `1 << sq`. If you see a bitboard test failing for squares above 52, this is the cause.

**Pitfall 2: Perft at depth ≥ 4 is slow without bulk counting at depth 1.**
A naive recursive perft that calls `generateLegalMoves` all the way to depth 0 will time out at depth 5 for Kiwipete. Always implement the bulk-counting optimization: at `depth === 1`, return `generateLegalMoves(pos).length` directly without recursing. This is the single most important performance tweak.

**Pitfall 3: The en-passant horizontal pin.**
In the position `8/8/8/K1Pp3r/8/8/8/8 w - d6 0 1`, the EP capture c5xd6 is illegal because it removes BOTH the c5 pawn AND the d5 pawn from the 5th rank, exposing the king on a5 to the rook on h5. The standard king-safety filter (apply the move, check if king is in check) handles this correctly AS LONG AS `makeMove` correctly removes the captured pawn from its square (d5) rather than the EP landing square (d6). Always test this specific fixture in the legal-moves suite.

**Pitfall 4: Castling legality — not checking the squares the king passes through.**
The filter "apply the move and check if king is in check" catches the destination being attacked, but not the intermediate square. For castling, you must explicitly check that the three king squares (start, middle, end) are all free from attack before allowing the castle. Failing to check the middle square produces a wrong perft count on Kiwipete.

**Pitfall 5: SAN disambiguation omitted because an alternative is pinned.**
When two pieces of the same type can reach the same square, the SAN might look ambiguous. But if one of the pieces is pinned (its move is not in `generateLegalMoves`), the disambiguator is OMITTED. Always generate the disambiguation string by checking the actual legal-moves list, not the pseudo-legal list.

**Pitfall 6: PGN parser using a library that mangles variation trees.**
A PGN with nested variations `(1. e4 (1. d4) 1... e5)` is a tree, not a flat list. Do not use a library that returns a flat move list; write or use a recursive descent parser that builds the `GameNode` tree. A flat list cannot represent the study-mode branch structure.

**Pitfall 7: Zobrist key not updated incrementally in `makeMove`.**
Recomputing the full Zobrist key from scratch in `makeMove` costs O(64) per move — fine for correctness but slow. More importantly, if you do recompute but forget to include the EP file or castling rights bits, repetition detection will be wrong. Verify with a test: after make+unmake, the Zobrist key exactly matches the original (this is already covered by S12 but is the most common source of hard-to-debug repetition bugs).

**Pitfall 8: Forgetting `dependsOn` edges when a card imports from a previous card.**
A 3B model will sometimes write a card that skips imports. Always list every prior card whose exports this card uses. The full import graph for the slice: `S01 → S02 → S03 → S04 → S05` (types → bitboard → position → zobrist → FEN), then `S05+S06 → S07 → S08 → S09 → S10 → S11` (moves → perft gate), then `S10+S05 → S13` (notation), then `S13 → S14 → S15` (replay+engine), then `S14+S15 → S16 → S17 → S18` (UI).
