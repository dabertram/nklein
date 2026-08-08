/**
 * P20.2 / P23.5 held-out oracle probe — TRANSPORT-LINE ORDER AND BACKPRESSURE (project 29).
 *
 * ── A TWENTY-THIRD INVARIANT FAMILY: a container whose ORDER is the whole point ──
 * A belt is not a bag. `countItemsOnLine` makes conservation easy to check and says nothing about sequence, so
 * a line backed by a stack passes every count-based assertion and delivers items in reverse — which in a
 * factory is the wrong ingredient arriving at the wrong assembler, with the totals still balancing perfectly.
 *
 * The other half is backpressure. `tryInsertItemAtTail` returns a boolean precisely because a full line must
 * REFUSE rather than silently drop, and a refusal that still consumes the item is invisible to any test that
 * checks the return value without also checking the count. Both halves are only observable under an
 * INTERLEAVING of insert / advance / extract, which is what these probes drive.
 *
 * Binds only to the spec's prescribed module (`src/sim/transport-line.ts`).
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

const CANDIDATES = ["src/sim/transport-line.ts", "src/sim/belt.ts", "src/transport-line.ts", "src/index.ts"];
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
const createTransportLine = exported<(id: number, beltIds: number[]) => Any>("createTransportLine");
const advanceTransportLine = exported<(line: Any, speed: number) => void>("advanceTransportLine");
const tryInsertItemAtTail = exported<(line: Any, itemId: string) => boolean>("tryInsertItemAtTail");
const tryExtractItemFromHead = exported<(line: Any) => string | null>("tryExtractItemFromHead");
const countItemsOnLine = exported<(line: Any) => number>("countItemsOnLine");

const SPEED = 8;
const newLine = () => createTransportLine(1, [10, 11, 12, 13]);

/** Advance until an item is extractable, or give up — a line that never delivers is itself a finding. */
function drainOne(line: Any, maxTicks = 200): string | null {
	for (let tick = 0; tick < maxTicks; tick += 1) {
		const item = tryExtractItemFromHead(line);
		if (item !== null && item !== undefined) {
			return item;
		}
		advanceTransportLine(line, SPEED);
	}
	return null;
}

test("items leave the line in the order they entered — a belt is FIFO, not a stack", () => {
	// THE probe. `countItemsOnLine` cannot distinguish a queue from a stack: both conserve perfectly. Only the
	// SEQUENCE separates them, and reversed delivery in a factory is the wrong ingredient at the wrong machine.
	const line = newLine();
	const inserted: string[] = [];
	for (const id of ["alpha", "bravo", "charlie"]) {
		if (tryInsertItemAtTail(line, id)) {
			inserted.push(id);
		}
		for (let tick = 0; tick < 4; tick += 1) {
			advanceTransportLine(line, SPEED);
		}
	}
	assert.ok(inserted.length >= 2, "the line refused almost everything — cannot judge ordering");

	const delivered: string[] = [];
	for (let index = 0; index < inserted.length; index += 1) {
		const item = drainOne(line);
		if (item === null) {
			break;
		}
		delivered.push(item);
	}
	assert.deepEqual(
		delivered,
		inserted,
		`items were delivered as ${JSON.stringify(delivered)} but entered as ${JSON.stringify(inserted)} — the line is not FIFO`,
	);
});

test("conservation holds after EVERY operation of an interleaved sequence", () => {
	// Inserted minus extracted must equal the count at every step, not merely at the end, where two opposite
	// errors can cancel. The interleaving is what makes a partially-advanced line the state under test.
	const line = newLine();
	let inserted = 0;
	let extracted = 0;
	for (let step = 0; step < 60; step += 1) {
		if (step % 3 === 0 && tryInsertItemAtTail(line, `item-${step}`)) {
			inserted += 1;
		}
		if (step % 5 === 0 && tryExtractItemFromHead(line) !== null) {
			extracted += 1;
		}
		advanceTransportLine(line, SPEED);
		assert.equal(
			countItemsOnLine(line),
			inserted - extracted,
			`after step ${step}: ${inserted} in, ${extracted} out, but the line reports ${countItemsOnLine(line)}`,
		);
	}
});

test("a refused insertion does NOT consume the item", () => {
	// Backpressure's real obligation. A line that returns false and still swallows the item passes any test
	// checking only the boolean, and the factory loses material with the ledger still balancing.
	const line = newLine();
	let accepted = 0;
	for (let attempt = 0; attempt < 500; attempt += 1) {
		if (tryInsertItemAtTail(line, `flood-${attempt}`)) {
			accepted += 1;
		} else {
			// The first refusal is the interesting moment: the count must not have moved.
			assert.equal(
				countItemsOnLine(line),
				accepted,
				"a REFUSED insertion changed the item count — the line consumed an item it said it would not take",
			);
			return;
		}
	}
	assert.fail("the line accepted 500 items without ever applying backpressure — it has no capacity limit");
});

test("extracting from an empty line returns null rather than throwing or inventing an item", () => {
	// The spec's return type is `string | null`. A throw stops a tick mid-phase; an invented id creates matter.
	const line = newLine();
	for (let attempt = 0; attempt < 5; attempt += 1) {
		assert.equal(tryExtractItemFromHead(line), null, "an empty line yielded an item");
		advanceTransportLine(line, SPEED);
	}
	assert.equal(countItemsOnLine(line), 0, "an empty line reports a non-zero count");
});

test("advancing NEVER creates or destroys items", () => {
	// The tick's own obligation, isolated from insert and extract. A position update that drops an item off the
	// end without an extraction is the silent-loss failure, and it only shows across many ticks.
	const line = newLine();
	let placed = 0;
	for (const id of ["a", "b"]) {
		if (tryInsertItemAtTail(line, id)) {
			placed += 1;
		}
	}
	for (let tick = 0; tick < 100; tick += 1) {
		advanceTransportLine(line, SPEED);
		assert.equal(countItemsOnLine(line), placed, `advancing changed the item count at tick ${tick} with no extraction`);
	}
});
