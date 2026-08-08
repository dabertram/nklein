/**
 * P20.2 / P23.5 held-out oracle probe — QUALITY-LATTICE MONOTONICITY (project 06).
 *
 * ── A TWENTY-FIRST INVARIANT FAMILY: a value that may only ever get worse ──
 * Sensor quality is a lattice (Bad < Uncertain < Good) and every derived reading inherits the worst of its
 * inputs. The safety direction is one-way: a computation may DEGRADE quality, never improve it. If a derived
 * value can come out `Good` from partly-`Bad` inputs, the historian recommends maintenance action on data it
 * has already decided not to trust.
 *
 * The spec's visible acceptance is four literal cases. None of them tests the lattice as a lattice: not
 * permutation invariance, not the no-improvement property under composition, and — the sharp one — not the
 * BOUNDARY. `propagateQuality` returns Bad when the bad fraction is `> threshold`; the visible fixture uses
 * 1/5 = 20% against 10%, comfortably past it. An implementation using `>=` behaves identically on every case
 * the spec lists.
 *
 * Catching that took more care than it looks (see the threshold probe): at the boundary BOTH implementations
 * return the code Bad, because any Bad input makes worst-of-inputs Bad anyway. The code cannot discriminate
 * them at all. What can: a zero threshold with no bad inputs, and the subReason — which the threshold rule
 * stamps as 'sensor-fault' while falling through preserves the input's own cause.
 *
 * Binds only to the spec's prescribed module (`src/domain/quality.ts`).
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

const CANDIDATES = ["src/domain/quality.ts", "src/quality.ts", "src/index.ts"];
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
const worstQuality = exported<(qualities: Any[]) => Any>("worstQuality");
const isEligibleForRecommendation = exported<(q: Any) => boolean>("isEligibleForRecommendation");
const propagateQuality = exported<(inputs: Any[], badFractionThreshold: number) => Any>("propagateQuality");

const GOOD = { code: "Good" };
const UNCERTAIN = { code: "Uncertain", subReason: "drift" };
const BAD = { code: "Bad", subReason: "sensor-fault" };
const RANK: Record<string, number> = { Bad: 0, Uncertain: 1, Good: 2 };
const rank = (q: Any) => RANK[String(q?.code)] ?? -1;

/** Every ordering of a three-element array, so permutation invariance is checked rather than sampled. */
function permutations<T>(items: T[]): T[][] {
	if (items.length <= 1) {
		return [items];
	}
	return items.flatMap((item, index) =>
		permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]),
	);
}

test("worstQuality is order-independent — every permutation gives the same answer", () => {
	// A comparator that keeps the last-seen value, or that compares the wrong way on one pair, can still satisfy
	// the two literal cases the spec lists. Checking all six orderings of three distinct qualities does not.
	for (const ordering of permutations([GOOD, UNCERTAIN, BAD])) {
		assert.equal(
			String(worstQuality(ordering).code),
			"Bad",
			`worstQuality depends on argument order: ${ordering.map((q) => q.code).join(",")} gave ${worstQuality(ordering).code}`,
		);
	}
	for (const ordering of permutations([GOOD, UNCERTAIN, GOOD])) {
		assert.equal(String(worstQuality(ordering).code), "Uncertain", "worstQuality mis-ranks Uncertain against Good");
	}
});

test("worstQuality preserves the subReason of the quality it selected", () => {
	// The spec says so, and it is the field that tells an engineer WHY the data is untrusted. A rank-only
	// implementation returns a bare code and every downstream diagnostic loses its cause.
	assert.equal(worstQuality([GOOD, BAD]).subReason, "sensor-fault", "the selected quality's subReason was dropped");
	assert.equal(worstQuality([GOOD, UNCERTAIN]).subReason, "drift", "the selected quality's subReason was dropped");
});

test("the bad-fraction threshold is STRICT — `>` and not `>=`", () => {
	// THE probe, and it needs care: when ANY input is Bad, worst-of-inputs is Bad too, so at the boundary both a
	// `>` and a `>=` implementation return the code Bad. The code cannot discriminate them. Two things can:
	//
	//  1. a threshold of 0 with NO bad inputs — `0 > 0` is false (fall through to worst-of-inputs, here Good)
	//     while `0 >= 0` is true (return Bad), so the two answers differ completely;
	//  2. the subReason at the boundary — the threshold rule stamps 'sensor-fault', whereas falling through
	//     preserves whatever the worst input carried.
	assert.equal(
		String(propagateQuality([GOOD, GOOD], 0).code),
		"Good",
		"with a zero threshold and NO bad inputs the rule must not trip — the spec says strictly greater, and `>=` would mark every clean reading Bad",
	);

	const calibration = { code: "Bad", subReason: "calibration-expired" };
	const atThreshold = [calibration, GOOD, GOOD, GOOD, GOOD, GOOD, GOOD, GOOD, GOOD, GOOD]; // exactly 1/10
	assert.equal(
		String(propagateQuality(atThreshold, 0.1).subReason),
		"calibration-expired",
		"a bad fraction landing exactly ON the threshold must fall through to worst-of-inputs (preserving its subReason), not trip the 'sensor-fault' rule",
	);

	const overThreshold = [calibration, calibration, GOOD, GOOD, GOOD, GOOD, GOOD, GOOD, GOOD, GOOD]; // 2/10
	assert.equal(String(propagateQuality(overThreshold, 0.1).code), "Bad", "a fraction over the threshold must be Bad");
	assert.equal(
		String(propagateQuality(overThreshold, 0.1).subReason),
		"sensor-fault",
		"once the threshold rule trips it must report the 'sensor-fault' subReason the spec names",
	);
});

test("propagation NEVER improves on the worst input — the one-way safety direction", () => {
	// The property the whole lattice exists for. A derived value that comes out better than its worst input lets
	// the historian recommend action on data it already decided not to trust.
	const cases: Any[][] = [
		[GOOD, UNCERTAIN],
		[UNCERTAIN, UNCERTAIN],
		[GOOD, GOOD, UNCERTAIN],
		[BAD, GOOD],
		[UNCERTAIN, BAD, GOOD],
	];
	for (const inputs of cases) {
		const worstInput = Math.min(...inputs.map(rank));
		for (const threshold of [0, 0.25, 0.5, 1]) {
			const propagated = rank(propagateQuality(inputs, threshold));
			assert.ok(
				propagated <= worstInput,
				`propagateQuality([${inputs.map((q) => q.code).join(",")}], ${threshold}) returned ${propagateQuality(inputs, threshold).code}, which is BETTER than the worst input`,
			);
		}
	}
});

test("eligibility composes: a propagated value is never eligible when an input was not", () => {
	// The gate and the lattice have to agree. Only `Good` is eligible, so any non-Good input must make the
	// derived value ineligible — the composition the visible suite never exercises.
	for (const inputs of [
		[GOOD, UNCERTAIN],
		[GOOD, BAD],
		[UNCERTAIN, GOOD, GOOD],
	]) {
		assert.equal(
			isEligibleForRecommendation(propagateQuality(inputs, 0.5)),
			false,
			`a value derived from ${inputs.map((q) => q.code).join(",")} was declared eligible for a recommendation`,
		);
	}
	assert.equal(
		isEligibleForRecommendation(propagateQuality([GOOD, GOOD], 0.5)),
		true,
		"all-Good inputs must remain eligible — the gate is not simply refusing everything",
	);
});
