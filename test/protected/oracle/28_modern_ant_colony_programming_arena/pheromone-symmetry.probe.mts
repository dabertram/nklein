/**
 * P20.2 / P23.5 held-out oracle probe — PHEROMONE DIFFUSION SYMMETRY AND ISOLATION (project 28).
 *
 * ── A TWENTY-FOURTH INVARIANT FAMILY: a field update that must not favour a direction ──
 * `diffusePheromone` spreads a fraction of every tile to its four orthogonal neighbours. The spec warns about
 * the trap in its own implementation notes — *"use a copy of the original values as the source — don't use the
 * updated values during the same diffusion step"* — which is exactly the kind of warning a test suite usually
 * does not follow up on.
 *
 * An in-place, row-major diffusion still CONSERVES total mass, so any conservation check passes. What it loses
 * is isotropy: cells updated earlier in the sweep feed the cells updated later, so pheromone drifts down and to
 * the right. In a colony simulation that is a permanent directional bias in every trail the ants lay — plausible
 * behaviour, wrong physics, and nothing in the totals to show for it.
 *
 * So the decisive probe is a single deposit at the centre of an empty field, one diffusion step, and the four
 * neighbours compared to EACH OTHER.
 *
 * Binds only to the spec's prescribed module (`src/core/pheromone.ts`).
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

const CANDIDATES = ["src/core/pheromone.ts", "src/pheromone.ts", "src/index.ts"];
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
const emptyPheromoneField = exported<(cols: number, rows: number, numColonies: number) => Any>("emptyPheromoneField");
const depositPheromone =
	exported<(f: Any, colony: number, channel: number, tile: number, amount: number) => Any>("depositPheromone");
const evaporatePheromone = exported<(f: Any) => Any>("evaporatePheromone");
const diffusePheromone = exported<(f: Any, cols: number, rows: number) => Any>("diffusePheromone");
const queryPheromone = exported<(f: Any, colony: number, channel: number, tile: number) => number>("queryPheromone");

const COLS = 5;
const ROWS = 5;
const COLONIES = 2;
const tile = (x: number, y: number) => y * COLS + x;
const CENTRE = tile(2, 2);

test("one diffusion step reaches all four neighbours EQUALLY — no directional bias", () => {
	// THE probe, and the one the spec's own implementation note is about. An in-place row-major sweep conserves
	// mass perfectly and drifts pheromone down and to the right, which no conservation check can see.
	const seeded = depositPheromone(emptyPheromoneField(COLS, ROWS, COLONIES), 0, 0, CENTRE, 4096);
	const diffused = diffusePheromone(seeded, COLS, ROWS);

	const north = queryPheromone(diffused, 0, 0, tile(2, 1));
	const south = queryPheromone(diffused, 0, 0, tile(2, 3));
	const west = queryPheromone(diffused, 0, 0, tile(1, 2));
	const east = queryPheromone(diffused, 0, 0, tile(3, 2));

	assert.ok(north > 0, "diffusion from the centre reached no neighbour at all");
	assert.equal(
		new Set([north, south, west, east]).size,
		1,
		`the four neighbours received unequal amounts (N=${north}, S=${south}, W=${west}, E=${east}) — the sweep reads its own partial output, so pheromone drifts`,
	);
});

test("diffusion never CREATES pheromone — the total is conserved or falls", () => {
	// The spec's stated conservation rule. Integer flooring means the total may drop; it must never rise, or a
	// trail amplifies itself and every ant follows a signal nothing produced.
	const seeded = depositPheromone(emptyPheromoneField(COLS, ROWS, COLONIES), 0, 0, CENTRE, 4096);
	const totalOf = (field: Any) => {
		let sum = 0;
		for (let index = 0; index < COLS * ROWS; index += 1) {
			sum += queryPheromone(field, 0, 0, index);
		}
		return sum;
	};
	let field = seeded;
	let previous = totalOf(field);
	for (let step = 0; step < 10; step += 1) {
		field = diffusePheromone(field, COLS, ROWS);
		const total = totalOf(field);
		assert.ok(total <= previous, `diffusion step ${step} INCREASED the total from ${previous} to ${total}`);
		previous = total;
	}
});

test("colonies are isolated — depositing for one never moves another's field", () => {
	// A single backing array shared across colonies passes every single-colony test and merges two colonies'
	// trails, so each follows the other's pheromone. Same independence family as project 27's RNG streams.
	const field = depositPheromone(emptyPheromoneField(COLS, ROWS, COLONIES), 0, 0, CENTRE, 4096);
	assert.ok(queryPheromone(field, 0, 0, CENTRE) > 0, "the deposit did not land in colony 0");
	assert.equal(queryPheromone(field, 1, 0, CENTRE), 0, "a deposit for colony 0 appeared in colony 1's field");

	const diffused = diffusePheromone(field, COLS, ROWS);
	assert.equal(queryPheromone(diffused, 1, 0, CENTRE), 0, "diffusing colony 0 leaked into colony 1");
	assert.equal(queryPheromone(diffused, 1, 0, tile(2, 1)), 0, "diffusion crossed the colony boundary");
});

test("every operation is PURE — the field it was given is unchanged", () => {
	// The spec says so outright ("returns new field (immutable)"). A mutating implementation passes every
	// sequential test and corrupts any caller holding a previous tick's field, which is how a replay is built.
	const original = depositPheromone(emptyPheromoneField(COLS, ROWS, COLONIES), 0, 0, CENTRE, 4096);
	const before = queryPheromone(original, 0, 0, CENTRE);

	depositPheromone(original, 0, 0, CENTRE, 1000);
	assert.equal(queryPheromone(original, 0, 0, CENTRE), before, "depositPheromone MUTATED the field it was passed");
	diffusePheromone(original, COLS, ROWS);
	assert.equal(queryPheromone(original, 0, 0, CENTRE), before, "diffusePheromone MUTATED the field it was passed");
	evaporatePheromone(original);
	assert.equal(queryPheromone(original, 0, 0, CENTRE), before, "evaporatePheromone MUTATED the field it was passed");
});

test("evaporation only ever decreases, and floors at zero rather than going negative", () => {
	// Monotone decay, and the boundary an integer floor makes reachable: repeated evaporation must settle at 0
	// and stay there. A value drifting below zero inverts every comparison downstream of it.
	let field = depositPheromone(emptyPheromoneField(COLS, ROWS, COLONIES), 0, 0, CENTRE, 4096);
	let previous = queryPheromone(field, 0, 0, CENTRE);
	for (let step = 0; step < 400; step += 1) {
		field = evaporatePheromone(field);
		const value = queryPheromone(field, 0, 0, CENTRE);
		assert.ok(value <= previous, `evaporation step ${step} INCREASED the value from ${previous} to ${value}`);
		assert.ok(value >= 0, `evaporation drove the value negative (${value}) at step ${step}`);
		previous = value;
	}
	assert.equal(previous, 0, "400 evaporation steps did not decay the tile to zero");
});
