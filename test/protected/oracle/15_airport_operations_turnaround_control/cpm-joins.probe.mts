/**
 * P20.2 / P23.5 held-out oracle probe — CRITICAL-PATH JOINS and order independence (project 15).
 *
 * ── A NINETEENTH INVARIANT FAMILY: a node whose answer depends on ALL its inputs, not the first one ──
 * The forward pass of CPM is one line in the spec — `earliestStart = max(predecessors' earliestFinish)` — and
 * the word doing all the work is **max**. An implementation taking the FIRST predecessor's finish, or the one
 * that happens to appear earliest in the array, produces a complete, plausible schedule that is simply too
 * optimistic: every join starts before its slowest input is done. On a turnaround that is an aircraft pushed
 * back while it is still fuelling.
 *
 * The spec's visible acceptance runs the STANDARD network, whose predecessor lists are written in a natural
 * order. So these probes deliberately list the LONGEST predecessor SECOND, and separately shuffle the task
 * array, because a CPM that leans on array order rather than a real topological sort passes every
 * well-ordered fixture. (Both tricks are the same lesson this session learned twice already: a fixture whose
 * accidental ordering flatters the implementation proves nothing.)
 *
 * Binds only to the spec's prescribed module (`src/core/turnaround-cpm.ts`).
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

const CANDIDATES = ["src/core/turnaround-cpm.ts", "src/core/cpm.ts", "src/index.ts"];
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
const computeCriticalPath = exported<(inBlocksMs: number, tasks: Any[]) => Any>("computeCriticalPath");

const MIN = 60_000;
const task = (id: string, minutes: number, predecessorIds: string[] = []) => ({
	id,
	label: id,
	durationMs: minutes * MIN,
	predecessorIds,
});
/** Read a Map-or-object result field uniformly. */
const get = (mapLike: Any, key: string): number =>
	Number(typeof mapLike?.get === "function" ? mapLike.get(key) : mapLike?.[key]);

/**
 * A diamond with a deliberately ADVERSARIAL predecessor order: `join` lists the SHORT branch first, so a
 * take-the-first implementation starts it 20 minutes early and every downstream number is wrong.
 */
const DIAMOND = [
	task("start", 10),
	task("short", 10, ["start"]),
	task("long", 30, ["start"]),
	task("join", 5, ["short", "long"]),
];

test("a join starts after the LATEST predecessor, even when it is listed second", () => {
	// THE probe. start(10) then long(30) finishes at 40; short(10) finishes at 20. `join` must start at 40.
	// A take-first implementation reads `short` and starts at 20 — a schedule that looks complete and is wrong.
	const result = computeCriticalPath(0, DIAMOND);
	assert.equal(
		get(result.taskEarliestStart, "join"),
		40 * MIN,
		`join starts at ${get(result.taskEarliestStart, "join") / MIN} min; it must wait for the LONGER branch, which finishes at 40`,
	);
	assert.equal(result.criticalPathMs, 45 * MIN, `critical path is ${result.criticalPathMs / MIN} min; expected 45`);
});

test("the shorter branch carries exactly the difference as float", () => {
	// Float is what makes a schedule actionable. An implementation reporting zero float everywhere still gets the
	// critical path right and tells an operations controller nothing about where the slack is.
	const result = computeCriticalPath(0, DIAMOND);
	assert.equal(get(result.taskFloat, "short"), 20 * MIN, "the 10-min branch beside a 30-min branch has 20 min of float");
	assert.equal(get(result.taskFloat, "long"), 0, "a task on the critical path must have zero float");
	assert.equal(get(result.taskFloat, "join"), 0, "the join is on the critical path");
});

test("the critical path is exactly the zero-float chain, in execution order", () => {
	const result = computeCriticalPath(0, DIAMOND);
	assert.deepEqual(
		[...result.criticalPath],
		["start", "long", "join"],
		`critical path was ${JSON.stringify([...result.criticalPath])}; the long branch is the binding one`,
	);
});

test("SHUFFLING the task array changes nothing — the pass is topological, not positional", () => {
	// A CPM that iterates the array once, in order, produces correct answers for any well-ordered input and wrong
	// ones the moment a task appears before its predecessor. Real networks are assembled from several sources.
	const shuffled = [DIAMOND[3], DIAMOND[1], DIAMOND[0], DIAMOND[2]];
	const ordered = computeCriticalPath(0, DIAMOND);
	const scrambled = computeCriticalPath(0, shuffled);
	assert.equal(
		scrambled.criticalPathMs,
		ordered.criticalPathMs,
		"reordering the task array changed the critical path length — the forward pass depends on array position",
	);
	for (const id of ["start", "short", "long", "join"]) {
		assert.equal(
			get(scrambled.taskEarliestStart, id),
			get(ordered.taskEarliestStart, id),
			`earliest start of ${id} depends on where it sits in the input array`,
		);
	}
});

test("slipping a NON-critical task beyond its float DOES move the finish", () => {
	// The spec's visible test covers the within-float half ("unchanged"). The complement is what proves float is
	// a real measurement rather than a constant: at float + 1 the finish must move.
	const withinFloat = computeCriticalPath(0, [
		task("start", 10),
		task("short", 30, ["start"]), // grew 10 → 30, exactly its float; still not binding
		task("long", 30, ["start"]),
		task("join", 5, ["short", "long"]),
	]);
	assert.equal(withinFloat.criticalPathMs, 45 * MIN, "growing a task to exactly its float moved the finish");

	const beyondFloat = computeCriticalPath(0, [
		task("start", 10),
		task("short", 35, ["start"]), // 5 past its float — now the binding branch
		task("long", 30, ["start"]),
		task("join", 5, ["short", "long"]),
	]);
	assert.equal(
		beyondFloat.criticalPathMs,
		50 * MIN,
		"growing a task PAST its float did not move the finish — the branch never became binding",
	);
});

test("predictedOffBlockMs is inBlocks plus the critical path, for a non-zero inBlocks", () => {
	// A trivially-derived field, and exactly the kind that gets hard-coded to the critical path alone. A zero
	// inBlocksMs — which every convenient fixture uses — cannot tell the two apart.
	const inBlocks = 9 * 60 * MIN;
	const result = computeCriticalPath(inBlocks, DIAMOND);
	assert.equal(
		Number(result.predictedOffBlockMs),
		inBlocks + 45 * MIN,
		"predictedOffBlockMs ignored inBlocksMs — a zero-based fixture cannot detect this",
	);
});
