/**
 * P20.2 / P23.5 held-out oracle probe — THE SHAPE OF A CURVE, not its endpoints (project 33).
 *
 * ── A TWENTY-SIXTH INVARIANT FAMILY: a function pinned only where every candidate agrees ──
 * `urgency` is specified as `(100 − needLevel)² / 100`. The spec's visible acceptance checks exactly two
 * points: `urgency(100) === 0` and `urgency(0) === 100`. Those are the two places where a LINEAR ramp and the
 * specified QUADRATIC curve give identical answers. A linear implementation therefore satisfies the entire
 * visible suite and is wrong everywhere in between — at half-satisfied it reports 50 urgency instead of 25,
 * so colonists panic about needs that are only moderately unmet, and the whole priority system skews.
 *
 * This is the cleanest example in the whole set of a spec pinning a function only where nothing distinguishes
 * the candidates. The probe therefore samples the MIDDLE of the range, and separately checks the curve's shape
 * (convexity) rather than any single value.
 *
 * The second family here is additivity: `decayNeeds(c, n)` must equal decaying one tick n times, because the
 * formula is linear in `ticks`. A compounding or flat-rate decay passes every single-tick fixture.
 *
 * Binds only to the spec's prescribed modules (`src/needs.ts`, `src/fp.ts`).
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

const CANDIDATES = ["src/needs.ts", "src/fp.ts", "src/colonist.ts", "src/index.ts"];
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
const fromFP = exported<(fp: number) => number>("fromFP");
const urgency = exported<(needLevel: number) => number>("urgency");
const decayNeeds = exported<(colonist: Any, ticks: number) => Any>("decayNeeds");
const createColonist = exported<(id: Any, name: string, traits: Any[]) => Any>("createColonist");

/** Fixed-point rounding makes exact equality wrong; one Q8 unit either way is the honest tolerance. */
const closeEnough = (actual: number, expected: number, slack = 1.5) => Math.abs(actual - expected) <= slack;

test("urgency is QUADRATIC in the middle of the range, where the spec's two checkpoints cannot see", () => {
	// THE probe. The visible acceptance pins urgency(100)=0 and urgency(0)=100 — precisely the two points where
	// a linear ramp and the specified curve agree. Everywhere between they diverge, and the divergence is what
	// decides which need a colonist attends to first.
	for (const [level, expected] of [
		[50, 25],
		[75, 6.25],
		[25, 56.25],
		[90, 1],
	] as const) {
		const actual = fromFP(urgency(toFP(level)));
		assert.ok(
			closeEnough(actual, expected, 1.5),
			`urgency(${level}) = ${actual}; the spec's (100 − level)² / 100 gives ${expected} (a LINEAR ramp would give ${100 - level})`,
		);
	}
});

test("the endpoints still hold — the curve is not merely shifted", () => {
	// Kept because a probe that only checks the middle could be satisfied by a curve with the right shape and the
	// wrong offset. Endpoints and midpoints together pin it.
	assert.ok(closeEnough(fromFP(urgency(toFP(100))), 0), "urgency(100) must be 0 — a fully satisfied need is not urgent");
	assert.ok(closeEnough(fromFP(urgency(toFP(0))), 100), "urgency(0) must be 100 — a wholly unmet need is maximally urgent");
});

test("urgency is CONVEX — each equal step down costs more than the one before", () => {
	// A shape assertion needing no reference values at all: on a quadratic, successive equal decrements in
	// satisfaction produce ever-larger urgency increases. A linear ramp gives equal increases and fails here even
	// if someone rescaled the constants to hit the sampled points.
	const steps = [100, 80, 60, 40, 20, 0].map((level) => fromFP(urgency(toFP(level))));
	const deltas = steps.slice(1).map((value, index) => value - (steps[index] as number));
	for (let index = 1; index < deltas.length; index += 1) {
		assert.ok(
			(deltas[index] as number) > (deltas[index - 1] as number),
			`urgency rises linearly, not quadratically: successive deltas were ${deltas.map((d) => d.toFixed(1)).join(", ")}`,
		);
	}
});

test("urgency never rises with satisfaction, anywhere on the range", () => {
	// Monotonicity across the whole domain rather than at sampled points: a formula that squares without
	// re-normalising, or that loses the sign, produces a non-monotone curve that still hits both endpoints.
	let previous = Number.POSITIVE_INFINITY;
	for (let level = 0; level <= 100; level += 5) {
		const value = fromFP(urgency(toFP(level)));
		assert.ok(value <= previous + 1.5, `urgency rose from ${previous} to ${value} as satisfaction increased to ${level}`);
		previous = value;
	}
});

test("decayNeeds is ADDITIVE — n ticks at once equals one tick n times", () => {
	// The formula is linear in `ticks`, so the two must agree. A compounding decay, or one applying a flat amount
	// regardless of the tick count, passes every single-tick fixture and diverges over a real game's timescale.
	const base = createColonist(1, "probe", []);
	const atOnce = decayNeeds(base, 20);
	let stepwise = base;
	for (let tick = 0; tick < 20; tick += 1) {
		stepwise = decayNeeds(stepwise, 1);
	}
	for (const need of Object.keys(atOnce.needs ?? {})) {
		assert.ok(
			closeEnough(Number(atOnce.needs[need]), Number(stepwise.needs?.[need]), 2 * 20),
			`need '${need}': 20 ticks at once gave ${atOnce.needs[need]} but 20 single ticks gave ${stepwise.needs?.[need]}`,
		);
	}
});

test("decay floors at zero and never runs negative, however long it runs", () => {
	// The clamp the spec names. A need below zero inverts every urgency comparison built on it.
	const decayed = decayNeeds(createColonist(1, "probe", []), 100_000);
	for (const [need, value] of Object.entries(decayed.needs ?? {})) {
		assert.ok(Number(value) >= 0, `need '${need}' decayed to ${value} — below the floor of zero`);
	}
});

test("decayNeeds does not mutate the colonist it was given", () => {
	// The spec says it returns a new Colonist. A mutating implementation passes sequential tests and corrupts any
	// caller holding a previous tick's snapshot.
	const base = createColonist(1, "probe", []);
	const before = JSON.stringify(base.needs ?? {});
	decayNeeds(base, 50);
	assert.equal(JSON.stringify(base.needs ?? {}), before, "decayNeeds MUTATED the colonist it was passed");
});
