/**
 * P20.2 / P23.5 held-out oracle probe — MOVE LEGALITY on the positions the canonical suite does not reach
 * (project 26).
 *
 * ── A FIFTEENTH INVARIANT FAMILY: exhaustive rule correctness, where "looks right" and "is right" diverge ──
 * This project is unusual: its visible acceptance is already strong. The spec REQUIRES perft green to depth ≥4
 * on all six canonical positions, and perft is a byte-exact count against published numbers. So a held-out
 * probe that simply re-ran perft would measure nothing new.
 *
 * What it holds out instead is the small set of positions the canonical six do NOT cover, each chosen because
 * the spec itself names the rule as one that "WILL break a naive implementation":
 *   · the rare HORIZONTAL en-passant pin, where removing BOTH pawns exposes the king along the rank;
 *   · castling through an attacked square (legal for the rook, illegal for the king);
 *   · under-promotion completeness — all four pieces, including on a capture.
 *
 * ── WHY NO NEW PERFT NUMBERS ARE ASSERTED HERE ──
 * A perft expectation is only as good as the number written down. Asserting a count from memory would risk a
 * permanently-red probe that blames the agent for the probe's own error — a failure this session has already
 * produced three times in other projects. Every expectation below is instead a LEGALITY fact derivable from the
 * position by reasoning, or a self-consistency property (perft(1) equals the legal-move count; make/unmake
 * round-trips). Those need no external table to be trustworthy.
 *
 * Binds only to the spec's prescribed exports. Runs via the HOST's tsx; workspace via NKLEIN_ORACLE_WORKSPACE.
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const workspace = process.env.NKLEIN_ORACLE_WORKSPACE;
if (!workspace) {
	throw new Error("NKLEIN_ORACLE_WORKSPACE is not set — the oracle runner must provide the workspace under grade.");
}

const CANDIDATES = [
	"src/movegen/legal.ts",
	"src/movegen/movegen.ts",
	"src/board/fen.ts",
	"src/movegen/perft.ts",
	"src/index.ts",
];
const loaded: Record<string, unknown>[] = [];
for (const candidate of CANDIDATES) {
	try {
		loaded.push((await import(pathToFileURL(join(workspace, candidate)).href)) as Record<string, unknown>);
	} catch {
		// Not every candidate exists; the lookup below names what was actually missing.
	}
}
function exported<T>(name: string): T {
	for (const module of loaded) {
		if (typeof module[name] === "function") {
			return module[name] as T;
		}
	}
	throw new Error(`The workspace exports no ${name} — looked in ${CANDIDATES.join(", ")}.`);
}

// biome-ignore lint/suspicious/noExplicitAny: the workspace under grade is untyped by construction.
type Any = any;
const parseFen = exported<(fen: string) => Any>("parseFen");
const generateLegalMoves = exported<(pos: Any) => Any[]>("generateLegalMoves");
const makeMove = exported<(pos: Any, move: Any) => Any>("makeMove");
const perft = exported<(pos: Any, depth: number) => number>("perft");

/** Squares may be numbers or algebraic strings depending on the agent's representation; compare as text. */
const sq = (value: unknown): string => String(value);
const movesFrom = (pos: Any) => generateLegalMoves(pos);

test("the HORIZONTAL en-passant pin makes the capture ILLEGAL", () => {
	// The spec names this rule explicitly as one that will break a naive generator, and none of the six canonical
	// positions contains it. Black king a4, white rook h4, black pawn c4, white pawn d2. After d2-d4 the black
	// pawn could capture en passant onto d3 — but doing so removes BOTH the c4 and d4 pawns from the 4th rank,
	// exposing the black king to the rook. A generator that checks only the moving pawn's pin allows it.
	const before = parseFen("8/8/8/8/k1p4R/8/3P4/3K4 w - - 0 1");
	const double = movesFrom(before).find((m: Any) => sq(m.from).includes("d2") || sq(m.from) === "11");
	assert.ok(double, "white's d2 pawn has no legal move in a position where the double push is available");

	const after = makeMove(before, movesFrom(before).find((m: Any) => sq(m.to).includes("d4") || sq(m.to) === "27"));
	const epCaptures = movesFrom(after).filter(
		(m: Any) => String(m.flag).includes("passant") || (sq(m.from).includes("c4") && sq(m.to).includes("d3")),
	);
	assert.equal(
		epCaptures.length,
		0,
		"the en-passant capture was generated, but taking it removes both pawns from the 4th rank and exposes the black king to the rook — the horizontal EP pin",
	);
});

test("an ordinary en-passant capture IS still generated", () => {
	// The other direction, so the probe cannot be satisfied by a generator that simply never emits en passant.
	const after = parseFen("8/8/8/8/3pP3/8/8/K6k b - e3 0 1");
	const epCaptures = movesFrom(after).filter(
		(m: Any) => String(m.flag).includes("passant") || (sq(m.from).includes("d4") && sq(m.to).includes("e3")),
	);
	assert.ok(epCaptures.length > 0, "a legal en-passant capture was not generated at all");
});

test("the king may not castle THROUGH an attacked square", () => {
	// The spec spells out all three king squares. A generator that checks only the destination allows castling
	// through check, which no simple fixture catches — the resulting position is perfectly legal-looking.
	const pos = parseFen("4k3/8/8/8/8/8/5r2/4K2R w K - 0 1"); // black rook f2 attacks f1, the king's transit square
	const castles = movesFrom(pos).filter((m: Any) => String(m.flag).includes("castl"));
	assert.equal(castles.length, 0, "castling was allowed while the king's transit square f1 is attacked");
});

test("castling IS legal when only the ROOK's path is attacked", () => {
	// The complement, and the reason the rule is easy to get wrong in the safe direction: the rook may pass
	// through an attacked square. A generator that forbids it is also wrong, and only this pairing shows which.
	const pos = parseFen("4k3/8/8/8/8/8/1r6/R3K3 w Q - 0 1"); // black rook b2 attacks b1, on the rook's path only
	const castles = movesFrom(pos).filter((m: Any) => String(m.flag).includes("castl"));
	assert.ok(castles.length > 0, "queenside castling was forbidden although only the ROOK passes an attacked square");
});

test("a promotion generates ALL FOUR pieces, including under-promotions", () => {
	// The spec names under-promotion. A generator emitting only a queen passes any test that counts "a promotion
	// happened" and silently loses three moves per promoting pawn — which perft at depth 1 would catch, but only
	// if a promotion position is in the suite.
	const pos = parseFen("8/P7/8/8/8/8/8/K6k w - - 0 1");
	const promos = movesFrom(pos).filter((m: Any) => m.promotion !== undefined || String(m.flag).includes("promo"));
	const pieces = new Set(promos.map((m: Any) => String(m.promotion).toLowerCase()));
	assert.equal(promos.length, 4, `expected four promotion moves (Q, R, B, N); got ${promos.length}`);
	assert.equal(pieces.size, 4, `the four promotions are not four distinct pieces: ${[...pieces].join(", ")}`);
});

test("perft(1) equals the legal-move count — the two must agree by construction", () => {
	// A self-consistency property needing no published table: if perft walks the legal-move generator, depth 1 is
	// exactly its length. A perft with its own separate (and differently buggy) generator diverges here.
	for (const fen of [
		"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
		"8/P7/8/8/8/8/8/K6k w - - 0 1",
		"4k3/8/8/8/8/8/1r6/R3K3 w Q - 0 1",
	]) {
		const pos = parseFen(fen);
		assert.equal(perft(pos, 1), movesFrom(pos).length, `perft(1) disagrees with generateLegalMoves for ${fen}`);
	}
});

test("makeMove does not mutate the position it was given", () => {
	// The spec offers make/unmake as an optimisation, but `makeMove` itself returns a new Position. A mutating
	// implementation passes every single-move test and corrupts every search that explores siblings.
	const pos = parseFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
	const before = movesFrom(pos).length;
	makeMove(pos, movesFrom(pos)[0]);
	assert.equal(movesFrom(pos).length, before, "makeMove mutated the position it was passed — sibling moves are now generated from a changed board");
});
