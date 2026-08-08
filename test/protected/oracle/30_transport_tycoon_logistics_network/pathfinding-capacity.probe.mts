/**
 * P20.2 / P23.5 held-out oracle probe — PATH OPTIMALITY and CAPACITY under interleaving (project 30).
 *
 * ── A SEVENTH INVARIANT FAMILY ──
 * The previous six are conservation, tracing, independence, authorization, determinism and correspondence.
 * This adds two more: an OPTIMALITY claim (A* must return the cheapest path, not merely a valid one) and a
 * CAPACITY claim (a station's platforms must never be over-occupied, however occupies and releases interleave).
 *
 * Optimality is the interesting one to hold out, because a wrong implementation still returns a working route.
 * Greedy best-first search finds a path on every fixture anyone writes by hand; it just finds a worse one, and
 * nothing about the result LOOKS broken. So the probes here build graphs with a deliberate trap — a cheap-looking
 * first step that leads somewhere expensive — and assert the total cost, never merely that a path came back.
 *
 * `runAstar` takes a `NodeFollower`, so these graphs are pure and need no world state; the probe binds to the
 * spec's prescribed modules only (`src/core/pathfinding.ts`, `src/core/station.ts`), never to agent fixtures.
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

const CANDIDATES = ["src/core/pathfinding.ts", "src/core/astar.ts", "src/core/station.ts", "src/index.ts"];
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
const runAstar = exported<(f: Any, start: number, goal: number, h: (n: number) => number) => Any>("runAstar");
const addStation = exported<(w: Any, id: number, nodeId: number, name: string, platforms: number) => Any>("addStation");
const tryOccupyPlatform = exported<(station: Any, trainId: number) => boolean>("tryOccupyPlatform");
const releasePlatform = exported<(station: Any, trainId: number) => void>("releasePlatform");

/** A pure NodeFollower over an explicit edge list, so the graph shape is entirely the probe's. */
function followerFor(edges: readonly { id: number; from: number; to: number; cost: number }[]) {
	return {
		neighbors(nodeId: number) {
			return edges
				.filter((edge) => edge.from === nodeId)
				.map((edge) => ({ segmentId: edge.id, nextNodeId: edge.to, costTicks: edge.cost }));
		},
	};
}
/** Zero is always admissible (it never overestimates), which isolates the SEARCH from the heuristic's quality. */
const zeroHeuristic = () => 0;

test("A* returns the CHEAPEST path, not merely a path that works", () => {
	// The trap: from node 1 the cheapest single step (cost 1, to node 2) leads to a 100-cost continuation, while
	// the dearer first step (cost 10, to node 3) finishes for 1 more. Greedy best-first takes the bait and still
	// returns a perfectly usable route — which is why a fixture that only asserts "a path came back" cannot see it.
	const edges = [
		{ id: 10, from: 1, to: 2, cost: 1 },
		{ id: 11, from: 2, to: 4, cost: 100 },
		{ id: 12, from: 1, to: 3, cost: 10 },
		{ id: 13, from: 3, to: 4, cost: 1 },
	];
	const result = runAstar(followerFor(edges), 1, 4, zeroHeuristic);
	assert.ok(result, "no path returned for a connected graph");
	assert.equal(Number(result.totalCostTicks), 11, `A* returned a ${result.totalCostTicks}-cost path; the optimum is 11`);
	assert.deepEqual(result.segmentIds, [12, 13], "the returned segments are not the cheapest route");
});

test("a node reached more cheaply LATER is corrected, not frozen by the closed set", () => {
	// The classic A* defect: closing a node on first touch and never revisiting it. It only shows up when a
	// shorter route to an already-closed node appears afterwards, which no small hand fixture contains.
	const edges = [
		{ id: 20, from: 1, to: 2, cost: 5 },
		{ id: 21, from: 1, to: 3, cost: 1 },
		{ id: 22, from: 3, to: 2, cost: 1 }, // reaches node 2 for 2, after 2 was first seen at 5
		{ id: 23, from: 2, to: 4, cost: 1 },
	];
	const result = runAstar(followerFor(edges), 1, 4, zeroHeuristic);
	assert.ok(result, "no path returned for a connected graph");
	assert.equal(Number(result.totalCostTicks), 3, `expected the corrected cost 3, got ${result.totalCostTicks}`);
});

test("equal-cost routes resolve identically every run — determinism, not luck", () => {
	// The spec pins "break ties by stable node id" precisely because a tie resolved by iteration order makes a
	// replay diverge. Two runs over the same graph must agree, and so must two runs over the same edges supplied
	// in a different ORDER — which is what proves the tiebreak is on node id rather than on insertion.
	const edges = [
		{ id: 30, from: 1, to: 2, cost: 5 },
		{ id: 31, from: 1, to: 3, cost: 5 },
		{ id: 32, from: 2, to: 4, cost: 5 },
		{ id: 33, from: 3, to: 4, cost: 5 },
	];
	const first = runAstar(followerFor(edges), 1, 4, zeroHeuristic);
	const again = runAstar(followerFor(edges), 1, 4, zeroHeuristic);
	assert.deepEqual(first.segmentIds, again.segmentIds, "the same graph produced two different routes");
	const reordered = runAstar(followerFor([...edges].reverse()), 1, 4, zeroHeuristic);
	assert.equal(
		Number(reordered.totalCostTicks),
		Number(first.totalCostTicks),
		"reordering the edge list changed the chosen cost — the tiebreak depends on iteration order",
	);
});

test("an unreachable goal returns null rather than throwing or inventing a route", () => {
	// The spec's return type is `PathResult | null`. A throw here aborts a whole tick; an empty-but-non-null
	// result reads downstream as "a zero-cost route exists", which is worse than either.
	const edges = [{ id: 40, from: 1, to: 2, cost: 1 }];
	assert.equal(runAstar(followerFor(edges), 1, 99, zeroHeuristic), null, "an unreachable goal did not return null");
});

test("platform capacity holds across a long interleaving of occupies and releases", () => {
	// The visible acceptance is occupy → occupy → release → occupy on a ONE-platform station. That sequence never
	// leaves the station partially full, so it cannot catch a release that frees the wrong platform or an occupy
	// that double-counts. This drives 200 interleaved operations and checks the invariant after every one.
	const world = { stations: [], tick: 0 } as Any;
	const station = addStation(world, 1, 1, "Central", 3);
	const occupying = new Set<number>();

	for (let step = 0; step < 200; step += 1) {
		const trainId = step % 7;
		if (occupying.has(trainId)) {
			releasePlatform(station, trainId);
			occupying.delete(trainId);
		} else if (tryOccupyPlatform(station, trainId)) {
			occupying.add(trainId);
		}
		assert.ok(
			occupying.size <= 3,
			`step ${step}: ${occupying.size} trains hold platforms at a 3-platform station — capacity was exceeded`,
		);
	}
});

test("a full station refuses, and one release makes room for exactly one more", () => {
	// Composed rather than single-shot: fill to capacity, confirm refusal, release ONE, confirm exactly one more
	// fits and the next is refused again. An off-by-one in the capacity check passes the visible 1-platform case.
	const world = { stations: [], tick: 0 } as Any;
	const station = addStation(world, 2, 2, "Docks", 2);
	assert.equal(tryOccupyPlatform(station, 101), true, "first train refused at an empty 2-platform station");
	assert.equal(tryOccupyPlatform(station, 102), true, "second train refused at a 2-platform station");
	assert.equal(tryOccupyPlatform(station, 103), false, "a third train was admitted to a 2-platform station");

	releasePlatform(station, 101);
	assert.equal(tryOccupyPlatform(station, 103), true, "no room after a release");
	assert.equal(tryOccupyPlatform(station, 104), false, "the station admitted a train beyond its capacity again");
});

test("releasing a train that holds nothing leaves capacity unchanged", () => {
	// A spurious release must not manufacture room. The visible suite only ever releases a train it just occupied,
	// so a `pop()`-style release that ignores the id passes it and silently frees someone else's platform.
	const world = { stations: [], tick: 0 } as Any;
	const station = addStation(world, 3, 3, "Yard", 1);
	assert.equal(tryOccupyPlatform(station, 201), true);
	releasePlatform(station, 999); // never occupied
	assert.equal(tryOccupyPlatform(station, 202), false, "a spurious release freed a platform that was still in use");
});
