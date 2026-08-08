/**
 * P20.2 / P23.5 held-out oracle probe — the FIXED-POINT determinism substrate (project 32).
 *
 * ── WHY THE SUBSTRATE, AND WHY COMPOSITIONALLY ──
 * This simulation's entire determinism claim rests on `src/fp.ts`: integer-only arithmetic so a replay reproduces
 * bit-for-bit. The spec's own visible acceptance for it is four single-operation checks — `fromFP(toFP(3.5))`
 * round-trips, `1 + 2 === 3`, `0.1 * 10 ≈ 1`, `5 - 3` does not throw. Every one is a single call with a tolerance,
 * and a float-backed implementation passes all four. The failure only appears once operations COMPOSE: floats
 * accumulate a different error along a long chain, and "≈ within rounding" hides it at every individual step.
 *
 * So these probes chain, re-associate, and check the exact integer contract the spec states — including the
 * conservation guard, which is the one place the spec demands a THROW rather than a value.
 *
 * Binds only to the spec's prescribed module (`src/fp.ts`). Runs via the HOST's tsx; workspace via
 * NKLEIN_ORACLE_WORKSPACE.
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const workspace = process.env.NKLEIN_ORACLE_WORKSPACE;
if (!workspace) {
	throw new Error("NKLEIN_ORACLE_WORKSPACE is not set — the oracle runner must provide the workspace under grade.");
}

const fp = (await import(pathToFileURL(join(workspace, "src/fp.ts")).href)) as {
	FP_SCALE: number;
	toFP: (n: number) => number;
	fromFP: (v: number) => number;
	fpAdd: (a: number, b: number) => number;
	fpSub: (a: number, b: number) => number;
	fpMul: (a: number, b: number) => number;
	fpDiv: (a: number, b: number) => number;
	fpClamp: (v: number, lo: number, hi: number) => number;
};

test("every fixed-point value is an INTEGER, all the way through a chain", () => {
	// The whole point of fixed point: the representation is an integer, so replay is exact. A float-backed
	// implementation satisfies every "≈ within 1/FP_SCALE" assertion in the visible suite and fails here on the
	// first multiply — which is also the first place a long simulation starts to drift between machines.
	const values = [fp.toFP(3.5), fp.toFP(0.1), fp.toFP(1000), fp.toFP(0)];
	for (const value of values) {
		assert.ok(Number.isInteger(value), `toFP produced a non-integer (${value}) — the representation is not fixed point`);
	}
	let acc = fp.toFP(1);
	for (let step = 0; step < 40; step += 1) {
		acc = fp.fpMul(acc, fp.toFP(1.1));
		acc = fp.fpDiv(acc, fp.toFP(1.05));
		acc = fp.fpAdd(acc, fp.toFP(0.01));
		assert.ok(Number.isInteger(acc), `a non-integer appeared at step ${step} — arithmetic left the fixed-point domain`);
	}
});

test("the same chain, run twice, is EXACTLY equal — not approximately", () => {
	// Determinism is an equality claim, and the visible suite only ever asserts tolerances. A tolerance can never
	// distinguish "deterministic" from "close enough this time".
	const chain = () => {
		let acc = fp.toFP(7.25);
		for (let step = 0; step < 200; step += 1) {
			acc = fp.fpMul(acc, fp.toFP(1.0007));
			acc = fp.fpAdd(acc, fp.toFP(0.5));
			acc = fp.fpDiv(acc, fp.toFP(1.0003));
		}
		return acc;
	};
	assert.equal(chain(), chain(), "the same fixed-point chain produced two different results");
});

test("fpMul and fpDiv truncate exactly as the spec states", () => {
	// The spec pins the formulas — `Math.trunc((a * b) / FP_SCALE)` and `Math.trunc((a * FP_SCALE) / b)`. Rounding
	// instead of truncating passes every tolerance-based check and shifts a long simulation systematically, which
	// is the difference between an energy ledger that closes and one that slowly invents energy.
	const a = fp.toFP(0.1);
	const b = fp.toFP(10);
	assert.equal(fp.fpMul(a, b), Math.trunc((a * b) / fp.FP_SCALE), "fpMul does not truncate as specified");
	assert.equal(fp.fpDiv(a, b), Math.trunc((a * fp.FP_SCALE) / b), "fpDiv does not truncate as specified");
	// A third-of-one is the classic case where round-vs-truncate diverges.
	const third = fp.fpDiv(fp.toFP(1), fp.toFP(3));
	assert.equal(third, Math.trunc((fp.toFP(1) * fp.FP_SCALE) / fp.toFP(3)), "fpDiv rounds where it must truncate");
});

test("the conservation guard THROWS on a negative result, at the boundary and beyond it", () => {
	// The spec is explicit: fpSub throws "Conservation violated: negative result". This is the guard against energy
	// and water leaks, so a clamp-to-zero implementation is the dangerous failure — it silently CREATES matter and
	// every downstream conservation test still balances. The visible acceptance only checks the non-throwing case.
	assert.equal(fp.fpSub(fp.toFP(5), fp.toFP(3)), fp.toFP(2), "a legal subtraction did not return the right value");
	assert.equal(fp.fpSub(fp.toFP(3), fp.toFP(3)), 0, "exact zero must be legal — it is not negative");
	assert.throws(() => fp.fpSub(fp.toFP(3), fp.toFP(5)), "a negative result did not throw the conservation guard");
	// One unit below zero: a guard written as `< -epsilon` or `<= -1` lets the smallest leak through, and the
	// smallest leak is exactly what accumulates over a long simulation.
	assert.throws(() => fp.fpSub(0, 1), "a one-unit negative result slipped past the conservation guard");
});

test("fpDiv rejects division by zero rather than yielding Infinity", () => {
	// The spec says it throws. An Infinity propagates silently through a whole tick and lands as NaN somewhere
	// unrelated, which is the hardest class of simulation bug to trace back.
	assert.throws(() => fp.fpDiv(fp.toFP(1), 0), "division by zero did not throw");
});

test("fpClamp composes: clamping an already-clamped value is a no-op", () => {
	// Idempotence under composition. A clamp implemented with the bounds swapped, or one that returns the bound
	// rather than the value when in range, passes a single-call check and destroys a repeatedly-clamped reservoir.
	const lo = fp.toFP(2);
	const hi = fp.toFP(8);
	for (const raw of [fp.toFP(-5), fp.toFP(0), fp.toFP(5), fp.toFP(8), fp.toFP(100)]) {
		const once = fp.fpClamp(raw, lo, hi);
		assert.equal(fp.fpClamp(once, lo, hi), once, "clamping twice changed the value");
		assert.ok(once >= lo && once <= hi, `clamp returned ${once}, outside [${lo}, ${hi}]`);
	}
	assert.equal(fp.fpClamp(fp.toFP(5), lo, hi), fp.toFP(5), "clamp altered a value already inside the range");
});

test("a conserved total stays EXACTLY conserved when repeatedly split and recombined", () => {
	// The energy ledger in miniature, and the reason the truncation rule above matters. Splitting a pool and
	// adding the parts back must never EXCEED the original — truncation may lose a unit, but inventing one is a
	// leak in the direction that breaks conservation. Neither is visible in a single-operation test.
	const total = fp.toFP(1000);
	let remaining = total;
	let distributed = 0;
	for (const share of [fp.toFP(0.25), fp.toFP(0.3), fp.toFP(0.2)]) {
		const portion = fp.fpMul(remaining, share);
		remaining = fp.fpSub(remaining, portion); // throws if the split ever over-draws
		distributed = fp.fpAdd(distributed, portion);
	}
	assert.ok(
		fp.fpAdd(distributed, remaining) <= total,
		"splitting and recombining produced MORE than the original total — the arithmetic invents matter",
	);
});
