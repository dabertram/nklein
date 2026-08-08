/**
 * P20.2 / P23.5 held-out oracle probe — SPATIAL INDEXING and generation discipline (project 31).
 *
 * ── A FOURTEENTH INVARIANT FAMILY: a coordinate system that must survive a non-square world ──
 * Every field in this simulation lives in a flat array addressed as `y * width + x`. The transposed form,
 * `x * height + y`, is IDENTICAL on a square grid, so a fixture built on 16×16 cannot tell them apart.
 *
 * **A round-trip cannot tell them apart EITHER, on any grid** — if read and write share the same wrong index the
 * value comes back fine, wrong-but-consistent. (Learned by running these probes against a deliberately
 * transposed build: the round-trip passed.) What actually catches it is checking the NEIGHBOURS, and checking
 * that the backing array never grows beyond `width * height` — a transposed index on a 7×3 world addresses up to
 * 44 in a 21-element array, and JS simply extends it rather than failing.
 *
 * The second property is the double-buffer discipline the spec fixes explicitly: `writeField` writes to `next`,
 * `readField` reads from `prev`, and only `commitGeneration` swaps them. An implementation that writes straight
 * into `prev` makes a simulation tick read its own partial output — cells updated earlier in the sweep influence
 * cells updated later, so the result depends on iteration order and determinism quietly dies. A single
 * write-then-read test PASSES on that implementation and fails on the correct one, which is why this probe
 * asserts the ORDER the spec states rather than the intuitive one.
 *
 * Binds only to the spec's prescribed module (`src/sim/field-store.ts`).
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

const CANDIDATES = ["src/sim/field-store.ts", "src/sim/fields.ts", "src/field-store.ts", "src/index.ts"];
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
const createFieldStore = exported<(w: number, h: number) => Any>("createFieldStore");
const readField = exported<(s: Any, n: string, x: number, y: number, w: number) => number>("readField");
const writeField = exported<(s: Any, n: string, x: number, y: number, w: number, v: number) => void>("writeField");
const commitGeneration = exported<(s: Any) => void>("commitGeneration");

const FIELD = "Pollution";
/** A deliberately NON-SQUARE world: on a square grid a transposed index is not merely hard to see, it is CORRECT. */
const WIDTH = 7;
const HEIGHT = 3;

/** Write a value, commit, then read it back — the only way to observe a write under the double-buffer rule. */
function writeCommitRead(store: Any, x: number, y: number, value: number): number {
	writeField(store, FIELD, x, y, WIDTH, value);
	commitGeneration(store);
	return readField(store, FIELD, x, y, WIDTH);
}

test("every cell of a NON-SQUARE world round-trips to its own coordinate", () => {
	// Each cell carries a value encoding its own position, and every cell is checked. Note the round-trip alone is
	// NOT sufficient (see the header) — the backing-array assertion at the end is what makes this probe decisive.
	const store = createFieldStore(WIDTH, HEIGHT);
	for (let y = 0; y < HEIGHT; y += 1) {
		for (let x = 0; x < WIDTH; x += 1) {
			writeField(store, FIELD, x, y, WIDTH, y * 100 + x);
		}
	}
	commitGeneration(store);
	for (let y = 0; y < HEIGHT; y += 1) {
		for (let x = 0; x < WIDTH; x += 1) {
			assert.equal(
				readField(store, FIELD, x, y, WIDTH),
				y * 100 + x,
				`cell (${x}, ${y}) read back another cell's value on a ${WIDTH}×${HEIGHT} world`,
			);
		}
	}
	// The decisive check: a transposed index writes past the end of a rectangular field, and JS extends the array
	// instead of throwing — so the round-trip above still "works" while the storage is silently corrupt.
	const backing = store.prev?.get?.(FIELD);
	if (Array.isArray(backing)) {
		assert.equal(
			backing.length,
			WIDTH * HEIGHT,
			`the ${FIELD} array holds ${backing.length} cells for a ${WIDTH}×${HEIGHT} world — writes addressed outside it, so the flat index transposes x and y`,
		);
	}
});

test("writing one cell does not disturb its neighbours", () => {
	// An off-by-one in the index writes into the next cell and still round-trips consistently if the read has the
	// same error. Checking the NEIGHBOURS is what separates a wrong-but-consistent index from a correct one.
	const store = createFieldStore(WIDTH, HEIGHT);
	assert.equal(writeCommitRead(store, 3, 1, 42), 42);
	for (const [x, y] of [
		[2, 1],
		[4, 1],
		[3, 0],
		[3, 2],
	]) {
		assert.equal(readField(store, FIELD, x as number, y as number, WIDTH), 0, `writing (3, 1) leaked into (${x}, ${y})`);
	}
});

test("the far corner is addressable — the last row is not truncated", () => {
	// `(WIDTH-1, HEIGHT-1)` is the cell an under-allocated array (`width*height-1`, or `width*width`) cannot hold.
	const store = createFieldStore(WIDTH, HEIGHT);
	assert.equal(writeCommitRead(store, WIDTH - 1, HEIGHT - 1, 77), 77, "the far corner of the world is not addressable");
	assert.equal(writeCommitRead(store, 0, 0, 5), 5, "the origin is not addressable");
});

test("writeField targets `next`, so a read BEFORE commit still sees the old generation", () => {
	// The spec fixes this direction explicitly: write → next, read → prev, swap on commit. A store that writes
	// into `prev` passes the intuitive write-then-read test and makes a sweep read its own partial output, so the
	// result depends on iteration order. Asserting the SPEC's order rather than the intuitive one is the point.
	const store = createFieldStore(WIDTH, HEIGHT);
	writeField(store, FIELD, 2, 1, WIDTH, 11);
	assert.equal(
		readField(store, FIELD, 2, 1, WIDTH),
		0,
		"a value written this generation was readable before commitGeneration — the double buffer is collapsed, so a tick reads its own partial output",
	);
	commitGeneration(store);
	assert.equal(readField(store, FIELD, 2, 1, WIDTH), 11, "the committed value never became readable");
});

test("commitGeneration clears `next`, so an uncommitted cell does not persist forever", () => {
	// The spec says commit "resets next to zeros". Without it, a value written once is re-committed on every
	// subsequent generation — a pollution source that can never be turned off.
	const store = createFieldStore(WIDTH, HEIGHT);
	writeField(store, FIELD, 1, 1, WIDTH, 9);
	commitGeneration(store);
	assert.equal(readField(store, FIELD, 1, 1, WIDTH), 9);
	commitGeneration(store);
	assert.equal(
		readField(store, FIELD, 1, 1, WIDTH),
		0,
		"a value re-appeared after a second commit — commitGeneration does not reset `next`",
	);
});

test("fields are independent: writing one does not move another", () => {
	// A store that shares one array across field names, or that keys `next` by reference, passes every
	// single-field test and couples pollution to land value.
	const store = createFieldStore(WIDTH, HEIGHT);
	writeField(store, FIELD, 2, 2, WIDTH, 50);
	writeField(store, "LandValue", 2, 2, WIDTH, 7);
	commitGeneration(store);
	assert.equal(readField(store, FIELD, 2, 2, WIDTH), 50, "Pollution was overwritten by a LandValue write");
	assert.equal(readField(store, "LandValue", 2, 2, WIDTH), 7, "LandValue was overwritten by a Pollution write");
});
