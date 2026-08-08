/**
 * P20.2 / P23.5 held-out oracle probe — DOES THE CHECKER ACTUALLY CHECK? (project 35).
 *
 * ── A TWENTY-SEVENTH INVARIANT FAMILY: a verifier that must be able to say NO ──
 * `checkConservation(before, after)` is the economy's own safety net, and the spec's visible acceptance uses it
 * exactly one way: *"`checkConservation` is `true` after any sequence of produce/consume/trade operations"*.
 * Every assertion expects TRUE. **A function that returns `true` unconditionally passes the entire visible
 * suite** — and then certifies every future leak, including ones the agent has not written yet.
 *
 * That is the sharpest form of a failure this session has met repeatedly: a guard whose only exercised direction
 * is the one where it says yes. So the first probe hands it a pair of states that manifestly violate
 * conservation and requires FALSE.
 *
 * The second gap is DRIFT. `checkConservation` tolerates one FP unit, and a test writer naturally checks two or
 * three operations. A tariff split that truncates both halves independently loses a unit per trade — inside
 * tolerance every single time, and unbounded over a game's worth of turns. So conservation is asserted from the
 * ORIGINAL state across a long sequence, not step by step.
 *
 * Binds only to the spec's prescribed module (`src/economy.ts`).
 * Runs via the HOST's tsx; workspace via NKLEIN_ORACLE_WORKSPACE.
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const workspace = process.env.NKLEIN_ORACLE_WORKSPACE;
if (!workspace) {
	throw new Error("NKLEIN_ORACLE_WORKSPACE is not set — the oracle runner must provide the workspace under grade.");
}

const CANDIDATES = ["src/economy.ts", "src/sim/economy.ts", "src/fp.ts", "src/index.ts"];
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
const toFP = exported<(n: number) => number>("toFP");
const produce = exported<(econ: Any, region: number, good: string, amount: number) => Any>("produce");
const consume = exported<(econ: Any, region: number, good: string, amount: number) => Any>("consume");
const checkConservation = exported<(before: Any, after: Any) => boolean>("checkConservation");

const GOOD = "grain";
/** A minimal two-region economy, built here so the probe does not depend on any fixture the agent wrote. */
const economy = () => ({
	markets: [
		{ regionIndex: 0, goods: { [GOOD]: toFP(1000) }, ownerFactionId: "f1" },
		{ regionIndex: 1, goods: { [GOOD]: toFP(500) }, ownerFactionId: "f2" },
	],
	tradeRoutes: [],
	factionTreasuries: { f1: toFP(100), f2: toFP(100) },
});

test("checkConservation returns FALSE when conservation is actually violated", () => {
	// THE probe. Every visible assertion expects TRUE, so a function returning `true` unconditionally passes the
	// whole suite and then certifies every leak the agent has not written yet. A verifier that cannot say no is
	// not a verifier.
	const before = economy();
	const inflated = economy();
	inflated.markets[0].goods[GOOD] = toFP(999_999); // goods conjured from nothing

	assert.equal(
		checkConservation(before, inflated),
		false,
		"checkConservation approved a state whose goods total jumped by ~999,000 — it does not actually check anything",
	);

	const drained = economy();
	drained.markets[1].goods[GOOD] = toFP(0); // goods vanished
	assert.equal(checkConservation(before, drained), false, "checkConservation approved a state that LOST goods");

	const treasuryInflated = economy();
	treasuryInflated.factionTreasuries.f1 = toFP(500_000);
	assert.equal(
		checkConservation(before, treasuryInflated),
		false,
		"checkConservation ignores treasuries — the total it guards is goods PLUS treasury",
	);
});

test("checkConservation still returns TRUE for a genuinely conserving operation", () => {
	// The complement: a checker that always says no is equally useless, and would pass the probe above.
	const before = economy();
	const after = consume(produce(before, 0, GOOD, toFP(50)), 0, GOOD, toFP(50));
	assert.equal(checkConservation(before, after), true, "a produce-then-consume round trip was reported as non-conserving");
});

test("conservation holds across a LONG sequence measured from the ORIGINAL state", () => {
	// Drift. The tolerance is one FP unit per comparison, and a test writer checks two or three operations. A
	// split that truncates independently loses a unit per trade — inside tolerance every time, unbounded over a
	// game. Comparing against the ORIGINAL rather than the previous step is what makes accumulation visible.
	const original = economy();
	let current = original;
	for (let round = 0; round < 200; round += 1) {
		current = produce(current, round % 2, GOOD, toFP(7));
		current = consume(current, round % 2, GOOD, toFP(7));
	}
	assert.equal(
		checkConservation(original, current),
		true,
		"200 balanced produce/consume rounds drifted the economy's total beyond tolerance — per-step rounding is accumulating",
	);
});

test("consuming beyond stock throws AND leaves the economy untouched", () => {
	// The spec makes fpSub the conservation guard, and the visible test checks only that it throws. What matters
	// to the ledger is that the failed operation is ATOMIC — a partial deduction before the throw leaves a
	// permanently short market, which is exactly the leak the guard exists to prevent.
	const before = economy();
	const goodsBefore = JSON.stringify(before.markets.map((m) => m.goods));
	assert.throws(() => consume(before, 0, GOOD, toFP(999_999)), "consuming beyond stock did not throw");
	assert.equal(
		JSON.stringify(before.markets.map((m) => m.goods)),
		goodsBefore,
		"a REFUSED consume still changed the market — the failed operation was not atomic",
	);
});

test("produce and consume are immutable — the economy passed in is never modified", () => {
	// The spec says "all immutable returns". A mutating implementation passes sequential tests and silently
	// invalidates any caller holding an earlier turn's state, which is what a save or a replay is.
	const before = economy();
	const snapshot = JSON.stringify(before);
	produce(before, 0, GOOD, toFP(25));
	consume(before, 0, GOOD, toFP(25));
	assert.equal(JSON.stringify(before), snapshot, "produce/consume MUTATED the economy they were given");
});
