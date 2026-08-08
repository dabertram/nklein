/**
 * P20.2 / P23.5 held-out oracle probe — genealogy tracing under COMPOSITION (project 04).
 *
 * ── WHAT THE VISIBLE SUITE ALREADY COVERS, AND THEREFORE WHAT THIS DOES NOT ──
 * The spec prescribes the agent's own `test/trace.test.ts`: a two-hop chain A→B→C, one commingle, one partial
 * consumption, and a ONE-hop gap. Every case is shallow and tree-shaped. A breadth-first walk with no visited
 * set, no depth accounting, and no cycle guard passes all four — and then loops forever or silently truncates
 * on the graphs a real food supply chain actually produces. So this probe deliberately never re-tests a shallow
 * chain. It builds deep chains, diamonds, rework loops and deep gaps: the compositions the visible suite leaves
 * uncovered, which is exactly P20.2's "the parts pass and the whole does not exist".
 *
 * The recall direction is the one that matters here. This is an allergen/HACCP recall system, and the spec makes
 * the safety stance explicit — `isConservative: true` ALWAYS, gaps WIDEN the affected set and are never pruned.
 * An under-inclusive trace ships contaminated food; that asymmetry is why several probes assert a SUPERSET
 * rather than an exact set.
 *
 * Binds only to surfaces the spec fixed in advance (`src/event-log.ts`, `src/genealogy.ts`, `src/trace.ts`),
 * never to the agent's own tests or fixtures. Runs via the HOST's tsx; workspace via NKLEIN_ORACLE_WORKSPACE.
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const workspace = process.env.NKLEIN_ORACLE_WORKSPACE;
if (!workspace) {
	throw new Error("NKLEIN_ORACLE_WORKSPACE is not set — the oracle runner must provide the workspace under grade.");
}

const moduleAt = async (relativePath: string) => await import(pathToFileURL(join(workspace, relativePath)).href);
const { createEventLog } = await moduleAt("src/event-log.ts");
const { buildGenealogyGraph, checkMassConservation } = await moduleAt("src/genealogy.ts");
const { backwardTrace, forwardTrace } = await moduleAt("src/trace.ts");

const kgQty = (value: number) => ({ value, uom: "kg" });

let eventSeq = 0;
/** One transformation edge-set: inputs → outputs at a given day. Ids are deterministic, never wall-clock. */
function transformation(inputs: readonly [string, number][], outputs: readonly [string, number][], day: number) {
	eventSeq += 1;
	return {
		eventId: `evt-probe-${eventSeq}`,
		eventType: "transformation" as const,
		bizStep: "commissioning",
		disposition: "in_progress",
		inputLots: inputs.map(([lotId, kg]) => ({ lotId, quantity: kgQty(kg) })),
		outputLots: outputs.map(([lotId, kg]) => ({ lotId, quantity: kgQty(kg) })),
		declaredYieldLossKg: 0,
		eventTime: day,
		location: "plant-1",
		transformationId: `xf-probe-${eventSeq}`,
	};
}

function receiving(lotId: string, day: number) {
	eventSeq += 1;
	return {
		eventId: `evt-probe-${eventSeq}`,
		eventType: "object" as const,
		bizStep: "receiving",
		disposition: "in_progress",
		epcList: [lotId],
		eventTime: day,
		location: "plant-1",
	};
}

// biome-ignore lint/suspicious/noExplicitAny: the workspace under grade is untyped by construction.
function logOf(events: readonly any[]) {
	const log = createEventLog();
	for (const event of events) {
		log.append(event);
	}
	return log;
}

// biome-ignore lint/suspicious/noExplicitAny: the workspace under grade is untyped by construction.
const graphOf = (events: readonly any[]) => buildGenealogyGraph(logOf(events));

// biome-ignore lint/suspicious/noExplicitAny: the workspace under grade is untyped by construction.
const lotIdsOf = (result: any): Set<string> =>
	new Set((result.affectedLots ?? []).map((node: { lotId: string }) => node.lotId));

test("a backward trace reaches the ORIGIN of a deep chain, not just the first hops", () => {
	// The visible suite's chain is A→B→C. A walk that never enqueues beyond its seed's parents satisfies it and
	// stops two hops short here, which in a recall means the contaminated supplier lot is never identified.
	const events = [
		receiving("lot-A", 1),
		transformation([["lot-A", 100]], [["lot-B", 100]], 2),
		transformation([["lot-B", 100]], [["lot-C", 100]], 3),
		transformation([["lot-C", 100]], [["lot-D", 100]], 4),
		transformation([["lot-D", 100]], [["lot-E", 100]], 5),
	];
	const traced = lotIdsOf(backwardTrace("lot-E", graphOf(events)));
	for (const ancestor of ["lot-A", "lot-B", "lot-C", "lot-D"]) {
		assert.ok(traced.has(ancestor), `backward trace from lot-E lost ancestor ${ancestor} — a recall would miss it`);
	}
});

test("a forward trace reaches every downstream lot of a deep chain", () => {
	const events = [
		receiving("lot-A", 1),
		transformation([["lot-A", 100]], [["lot-B", 100]], 2),
		transformation([["lot-B", 100]], [["lot-C", 100]], 3),
		transformation([["lot-C", 100]], [["lot-D", 100]], 4),
	];
	const traced = lotIdsOf(forwardTrace("lot-A", graphOf(events)));
	for (const descendant of ["lot-B", "lot-C", "lot-D"]) {
		assert.ok(traced.has(descendant), `forward trace from lot-A lost descendant ${descendant}`);
	}
});

test("a DIAMOND genealogy resolves without dropping or duplicating a lot", () => {
	// A splits into B and C, both of which feed D. The visible commingle test is one hop and cannot distinguish a
	// walk that revisits A twice (duplicate) from one that marks A visited on the first branch and then prunes
	// the second branch entirely (drop). Both are wrong; only a diamond separates them.
	const events = [
		receiving("lot-A", 1),
		transformation([["lot-A", 60]], [["lot-B", 60]], 2),
		transformation([["lot-A", 40]], [["lot-C", 40]], 2),
		transformation(
			[
				["lot-B", 60],
				["lot-C", 40],
			],
			[["lot-D", 100]],
			3,
		),
	];
	const result = backwardTrace("lot-D", graphOf(events));
	const traced = lotIdsOf(result);
	for (const ancestor of ["lot-A", "lot-B", "lot-C"]) {
		assert.ok(traced.has(ancestor), `diamond backward trace lost ${ancestor}`);
	}
	const occurrences = (result.affectedLots ?? []).filter((node: { lotId: string }) => node.lotId === "lot-A").length;
	assert.equal(occurrences, 1, "lot-A appears more than once — the trace double-counts a shared ancestor");
});

test("a REWORK edge does not make the trace diverge", () => {
	// The spec: rework is "a DAG with a time-ordered rework edge" — yesterday's out-of-spec output re-enters
	// today's batch. It is the one shape that looks like a cycle to a naive walker, and the visible suite never
	// builds one. A missing visited-set hangs here rather than failing, so the assertion is that it TERMINATES
	// with the origin still reachable.
	const events = [
		receiving("lot-A", 1),
		transformation([["lot-A", 100]], [["lot-B", 100]], 2),
		// lot-B is out of spec; it is reworked back into a new batch alongside fresh material the next day.
		transformation([["lot-B", 100]], [["lot-C", 100]], 3),
		transformation([["lot-C", 100]], [["lot-B2", 100]], 4),
		transformation([["lot-B2", 100]], [["lot-D", 100]], 5),
	];
	const traced = lotIdsOf(backwardTrace("lot-D", graphOf(events)));
	assert.ok(traced.has("lot-A"), "the rework chain lost the original supplier lot");
	assert.ok(traced.has("lot-B"), "the rework chain lost the reworked lot");
});

test("a gap DEEP in a chain still widens the affected set at the top-level query", () => {
	// The visible gap test is one hop from the query. Conservatism has to SURVIVE composition: an unknown
	// ancestor four hops up must still surface, because the recall is issued from the finished good.
	const events = [
		// lot-X is referenced as an input but never received — the gap, three hops above the query.
		transformation([["lot-X", 100]], [["lot-B", 100]], 2),
		transformation([["lot-B", 100]], [["lot-C", 100]], 3),
		transformation([["lot-C", 100]], [["lot-D", 100]], 4),
	];
	const result = backwardTrace("lot-D", graphOf(events));
	assert.equal(result.isConservative, true, "a trace over a gapped graph must still declare itself conservative");
	assert.ok(
		lotIdsOf(result).has("lot-X") || (result.gaps ?? []).includes("lot-X"),
		"a gap deep in the chain vanished — the affected set is no longer a superset of ground truth",
	);
});

test("out-of-order event arrival yields the SAME trace, not merely the same graph", () => {
	// The spec pins graph equality under out-of-order arrival; it does not pin that traces agree. A fold that
	// sorts events but builds edges from arrival order produces a graph that compares equal on lots and diverges
	// on reachability — which only a trace can see.
	const ordered = [
		receiving("lot-A", 1),
		transformation([["lot-A", 100]], [["lot-B", 100]], 2),
		transformation([["lot-B", 100]], [["lot-C", 100]], 3),
	];
	const shuffled = [ordered[2], ordered[0], ordered[1]];
	assert.deepEqual(
		lotIdsOf(backwardTrace("lot-C", graphOf(shuffled))),
		lotIdsOf(backwardTrace("lot-C", graphOf(ordered))),
		"the trace depends on ARRIVAL order — event-time replay is not actually driving the fold",
	);
});

test("availableKg never goes negative across a chain of partial consumptions", () => {
	// Per-node arithmetic the visible suite checks once, at one hop. Across a chain each output becomes the next
	// input, so an implementation that subtracts consumption from the wrong node stays green on the single-hop
	// case and drifts negative here — a lot that has shipped more than it ever received.
	const events = [
		receiving("lot-A", 1),
		transformation([["lot-A", 60]], [["lot-B", 60]], 2),
		transformation([["lot-A", 40]], [["lot-C", 40]], 3),
		transformation([["lot-B", 30]], [["lot-D", 30]], 4),
	];
	const graph = graphOf(events);
	for (const [lotId, node] of graph.lots) {
		assert.ok(
			(node as { availableKg: number }).availableKg >= 0,
			`${lotId} reports negative availableKg — more was consumed than ever entered the lot`,
		);
	}
});

test("mass conservation is judged per transformation, and a shortfall is reported rather than absorbed", () => {
	// Composed with the graph above so a single fixture exercises both: one balanced transformation and one with
	// an undeclared 3 kg loss. An implementation that sums across ALL transformations nets these out and reports
	// everything green, which is the "absorbed discrepancy" failure a per-transformation check exists to prevent.
	const events = [
		receiving("lot-A", 1),
		{ ...transformation([["lot-A", 80]], [["lot-B", 75]], 2), declaredYieldLossKg: 5 },
		{ ...transformation([["lot-B", 80]], [["lot-C", 75]], 3), declaredYieldLossKg: 2 },
	];
	const results = checkMassConservation(logOf(events));
	const failing = results.filter((entry: { passes: boolean }) => !entry.passes);
	assert.equal(failing.length, 1, "exactly one of the two transformations is short by 3 kg");
	assert.ok(
		Math.abs(failing[0].discrepancyKg - 3) < 0.001,
		`expected a 3 kg discrepancy, got ${failing[0]?.discrepancyKg}`,
	);
});
