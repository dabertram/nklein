/**
 * P20.2 / P23.5 held-out oracle probe — HARDWARE-CONTRACT FIDELITY (project 20).
 *
 * ── A SIXTEENTH INVARIANT FAMILY: an architectural contract that must hold at every boundary ──
 * A machine emulator is judged by the rules it keeps when nothing is watching. The spec's visible acceptance
 * covers the headline ones: `writeReg(rf, 0, 42)` then `readReg(result, 0) === 0` (x0 hardwired), and
 * `MemoryAccessError` on a bad access. Both are single-shot.
 *
 * What that leaves uncovered is where emulators actually break:
 *  · **x0 across a SEQUENCE** — a register file that special-cases the immediate read-back passes the visible
 *    test and lets a later write leak through, which is fatal because compilers use x0 as a discard target
 *    constantly.
 *  · **the `reason` field being RIGHT, not merely present** — the spec makes it a union of `'out_of_bounds'` and
 *    `'misaligned'` so a fault handler can act on it. An implementation that throws with one hard-coded reason
 *    satisfies every `assert.throws` and makes the discriminator useless.
 *  · **the exact boundary** — `size - 4` must load and `size` must fault. Off-by-one here is invisible to any
 *    test that uses a comfortable middle address.
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

const CANDIDATES = ["src/machine/registers.ts", "src/machine/memory.ts", "src/machine/machine.ts", "src/index.ts"];
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
const createRegisterFile = exported<(stvec: number) => Any>("createRegisterFile");
const readReg = exported<(rf: Any, r: number) => number>("readReg");
const writeReg = exported<(rf: Any, r: number, v: number) => Any>("writeReg");
const createMemory = exported<(sizeBytes: number) => Any>("createMemory");
const loadWord = exported<(mem: Any, addr: number) => number>("loadWord");
const storeWord = exported<(mem: Any, addr: number, value: number) => void>("storeWord");

const MEM_SIZE = 1024;

/** Run `fn`, returning the thrown error, or null when it did not throw. */
function thrownBy(fn: () => unknown): Any {
	try {
		fn();
		return null;
	} catch (error) {
		return error;
	}
}

test("x0 stays zero across a SEQUENCE of writes, not just the first read-back", () => {
	// The visible test writes x0 once and reads it once. A register file that returns 0 for register 0 on read —
	// but still STORES the value — passes that and then leaks the stored value through any path that reads the
	// backing array directly (a state dump, a context switch, a snapshot). Interleaving other writes is what
	// separates "reads as zero" from "is hardwired to zero".
	let rf = createRegisterFile(0);
	rf = writeReg(rf, 0, 42);
	rf = writeReg(rf, 1, 7);
	rf = writeReg(rf, 0, 99);
	rf = writeReg(rf, 2, 8);
	assert.equal(readReg(rf, 0), 0, "x0 returned a written value after a sequence of writes — it is not hardwired");
	assert.equal(readReg(rf, 1), 7, "an ordinary register lost its value");
	assert.equal(readReg(rf, 2), 8, "an ordinary register lost its value");

	// Reading through readReg is NOT sufficient and this probe learned it the hard way: a file that masks r===0 on
	// READ while still storing the value passes everything above. The stored state has to be inspected directly,
	// because a context switch, a state dump or a snapshot reads the array, not the accessor.
	const backing = rf.regs ?? rf.registers ?? rf.x;
	if (Array.isArray(backing) || ArrayBuffer.isView(backing)) {
		assert.equal(
			Number((backing as Any)[0]),
			0,
			"x0 reads as zero but a written value is STORED in the register file — anything reading the raw state (context switch, snapshot, trap dump) sees it",
		);
	}
});

test("writeReg is immutable — the register file it was given is unchanged", () => {
	// The spec's signature returns a RegisterFile. A mutating implementation passes every sequential test and
	// destroys any code holding a snapshot, which is exactly what a context switch or a trap handler does.
	const original = createRegisterFile(0);
	const updated = writeReg(original, 5, 123);
	assert.equal(readReg(updated, 5), 123, "the returned register file did not take the write");
	assert.equal(readReg(original, 5), 0, "writeReg MUTATED the register file it was passed");
});

test("a misaligned access reports reason 'misaligned' — for all three misalignments", () => {
	// The spec makes `reason` a union so a fault handler can act on it. `assert.throws` alone cannot tell a
	// correct discriminator from one hard-coded to a single value, and every visible test is an assert.throws.
	const mem = createMemory(MEM_SIZE);
	for (const offset of [1, 2, 3]) {
		const error = thrownBy(() => loadWord(mem, 64 + offset));
		assert.ok(error, `loadWord did not fault on a misaligned address (64 + ${offset})`);
		assert.equal(error.reason, "misaligned", `loadWord(64 + ${offset}) reported reason '${error.reason}'`);
		const storeError = thrownBy(() => storeWord(mem, 64 + offset, 1));
		assert.ok(storeError, `storeWord did not fault on a misaligned address (64 + ${offset})`);
		assert.equal(storeError.reason, "misaligned", `storeWord(64 + ${offset}) reported reason '${storeError.reason}'`);
	}
});

test("an out-of-range access reports reason 'out_of_bounds', not 'misaligned'", () => {
	// The complement. An implementation reporting one reason for everything passes each throws-check in isolation
	// and is only caught by requiring the two to DIFFER.
	const mem = createMemory(MEM_SIZE);
	const past = thrownBy(() => loadWord(mem, MEM_SIZE));
	assert.ok(past, "loadWord did not fault one word past the end of memory");
	assert.equal(past.reason, "out_of_bounds", `an address past the end reported reason '${past.reason}'`);

	const negative = thrownBy(() => loadWord(mem, -4));
	assert.ok(negative, "loadWord did not fault on a negative address");
	assert.equal(negative.reason, "out_of_bounds", `a negative address reported reason '${negative.reason}'`);
});

test("the LAST addressable word loads, and the next one faults", () => {
	// The exact boundary. `size - 4` is the last legal word; `size` is the first illegal one. A `<=` where a `<`
	// belongs (or the reverse) is invisible to any test using a comfortable middle address, and shows up as
	// either a phantom fault or a one-word buffer overrun.
	const mem = createMemory(MEM_SIZE);
	storeWord(mem, MEM_SIZE - 4, 0xabc);
	assert.equal(loadWord(mem, MEM_SIZE - 4), 0xabc, "the last addressable word could not be used");
	assert.ok(thrownBy(() => loadWord(mem, MEM_SIZE)), "an address exactly at the size did not fault");
	assert.equal(loadWord(mem, 0), 0, "address zero is not addressable");
});

test("a stored word reads back exactly, and does not disturb the adjacent words", () => {
	// Round-trip plus neighbours, for the same reason as project 31: a consistently-wrong address round-trips
	// fine, and only the neighbour check separates that from a correct one.
	const mem = createMemory(MEM_SIZE);
	storeWord(mem, 128, 0x11111111);
	storeWord(mem, 132, 0x22222222);
	storeWord(mem, 136, 0x33333333);
	assert.equal(loadWord(mem, 132), 0x22222222, "a stored word did not read back");
	assert.equal(loadWord(mem, 128), 0x11111111, "writing 132 disturbed the word below it");
	assert.equal(loadWord(mem, 136), 0x33333333, "writing 132 disturbed the word above it");
});
