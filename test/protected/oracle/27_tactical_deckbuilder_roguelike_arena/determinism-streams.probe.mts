/**
 * P20.2 / P23.5 held-out oracle probe — RNG determinism and STREAM INDEPENDENCE (project 27).
 *
 * ── A DIFFERENT KIND OF COMPOSITIONAL TRAP FROM PROJECTS 18 AND 04 ──
 * Those measure conservation across a chain of operations. This one measures INDEPENDENCE: the spec gives the
 * run six named RNG sub-streams (`shuffleRng`, `cardRng`, `rewardRng`, …) so that drawing loot cannot perturb
 * combat. A single shared counter behind a stream-shaped API satisfies every per-stream test anyone would write
 * — each stream is deterministic, each replays from a seed, each produces plausible values — and collapses the
 * instant two streams interleave. That is precisely "the parts pass and the whole does not exist", in the shape
 * a game's replay system actually fails: a bug report that cannot be reproduced because the reporter drew one
 * extra reward.
 *
 * The probes are therefore all INTERLEAVINGS and REPLAYS, never single-stream sequences.
 *
 * Binds only to surfaces the spec fixed in advance (`src/core/prng.ts`, `src/core/rng-streams.ts` or the same
 * exports re-exported from `src/core/prng.ts`), never to the agent's own tests or fixtures.
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

/**
 * The spec names `src/core/prng.ts` for the generator and leaves the stream layer's file unstated, so the
 * resolver tries the documented module and the two obvious neighbours. Failing to find an export throws with the
 * places searched — an absent function must never read as a passing probe.
 */
const CANDIDATES = ["src/core/prng.ts", "src/core/rng-streams.ts", "src/core/rng.ts", "src/index.ts"];
const loaded: Record<string, unknown>[] = [];
for (const candidate of CANDIDATES) {
	try {
		loaded.push((await import(pathToFileURL(join(workspace, candidate)).href)) as Record<string, unknown>);
	} catch {
		// Not every candidate exists; the export lookup below reports what was actually missing.
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
const createRunRng = exported<(seed: bigint) => Any>("createRunRng");
const rngDraw = exported<(rng: Any, stream: string) => { value: bigint; rng: Any }>("rngDraw");
const rngDrawInt = exported<(rng: Any, stream: string, max: number) => { value: number; rng: Any }>("rngDrawInt");
const hashStreamSeed = exported<(runSeed: bigint, streamName: string) => bigint>("hashStreamSeed");

const SEED = 0x5eed_1234_abcdn;

/** Draw `count` values from one stream, returning the sequence and the final rng. */
function drawSequence(rng: Any, stream: string, count: number): { values: bigint[]; rng: Any } {
	const values: bigint[] = [];
	let current = rng;
	for (let index = 0; index < count; index += 1) {
		const step = rngDraw(current, stream);
		values.push(step.value);
		current = step.rng;
	}
	return { values, rng: current };
}

test("drawing from one stream does NOT perturb another stream's sequence", () => {
	// THE probe. A shared-counter implementation passes every single-stream test and fails only here.
	const baseline = drawSequence(createRunRng(SEED), "cardRng", 5).values;

	// Same card draws, but with reward and AI draws interleaved between them.
	let rng = createRunRng(SEED);
	const interleaved: bigint[] = [];
	for (let index = 0; index < 5; index += 1) {
		rng = rngDraw(rng, "rewardRng").rng;
		rng = rngDraw(rng, "aiRng").rng;
		const step = rngDraw(rng, "cardRng");
		interleaved.push(step.value);
		rng = step.rng;
	}

	assert.deepEqual(
		interleaved,
		baseline,
		"cardRng changed because OTHER streams were drawn — the sub-streams share state, so no replay survives a differing reward roll",
	);
});

test("the same seed replays the same interleaved history exactly", () => {
	// Determinism across a MIXED sequence, not a single stream: the property a shared replay/bug-report depends on.
	const play = (): Array<bigint | number> => {
		let rng = createRunRng(SEED);
		const out: Array<bigint | number> = [];
		for (const stream of ["shuffleRng", "cardRng", "aiRng", "cardRng", "rewardRng", "mapRng"]) {
			const step = rngDraw(rng, stream);
			out.push(step.value);
			rng = step.rng;
			const bounded = rngDrawInt(rng, stream, 13);
			out.push(bounded.value);
			rng = bounded.rng;
		}
		return out;
	};
	assert.deepEqual(play(), play(), "the same seed produced two different histories — the run is not replayable");
});

test("different seeds diverge, so determinism is not just a constant", () => {
	// Guards the degenerate pass: an implementation that always returns 0 satisfies every determinism assertion
	// above. Replay and non-triviality have to be asserted together.
	const a = drawSequence(createRunRng(SEED), "cardRng", 8).values;
	const b = drawSequence(createRunRng(SEED + 1n), "cardRng", 8).values;
	assert.notDeepEqual(a, b, "two different seeds produced identical sequences — the generator ignores its seed");
	assert.ok(new Set(a.map(String)).size > 1, "one stream returned a constant — this is not a generator");
});

test("stream seeds are AVALANCHE-mixed, not seed-plus-a-constant", () => {
	// The spec says so explicitly ("avalanche-mixing — NOT seed+constant"). The lazy implementation is
	// `runSeed + hash(name)`, which passes any single-stream test and makes neighbouring streams correlated.
	// Two streams of one run must not sit at a fixed offset that repeats across runs.
	const offsetFor = (seed: bigint) => hashStreamSeed(seed, "cardRng") - hashStreamSeed(seed, "rewardRng");
	assert.notEqual(
		offsetFor(SEED),
		offsetFor(SEED + 1n),
		"the gap between two stream seeds is identical across runs — the derivation is additive, so streams stay correlated",
	);
	assert.notEqual(hashStreamSeed(SEED, "cardRng"), hashStreamSeed(SEED, "rewardRng"), "two streams share a seed");
});

test("a bounded draw stays in range and still advances the stream", () => {
	// Composed on purpose: an implementation that returns the bound-modulo without advancing state passes a
	// range check and then makes every subsequent draw identical — a deck that reshuffles into the same order.
	let rng = createRunRng(SEED);
	const seen: number[] = [];
	for (let index = 0; index < 24; index += 1) {
		const step = rngDrawInt(rng, "shuffleRng", 6);
		assert.ok(
			Number.isInteger(step.value) && step.value >= 0 && step.value < 6,
			`bounded draw returned ${step.value}, outside [0, 6)`,
		);
		seen.push(step.value);
		rng = step.rng;
	}
	assert.ok(new Set(seen).size > 1, "24 bounded draws returned one value — the bounded draw does not advance state");
});

test("rngDraw is immutable: the input RunRng still produces its original next value", () => {
	// The spec says "return new RunRng (immutable)". A mutating implementation passes sequential tests and breaks
	// every caller that holds a snapshot — which is exactly how a replay or an undo feature is built.
	const original = createRunRng(SEED);
	const first = rngDraw(original, "cardRng").value;
	rngDraw(original, "cardRng");
	rngDraw(original, "rewardRng");
	assert.equal(rngDraw(original, "cardRng").value, first, "drawing MUTATED the RunRng it was given");
});
