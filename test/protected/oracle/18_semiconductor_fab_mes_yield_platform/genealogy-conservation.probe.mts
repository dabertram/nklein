/**
 * P20.2 / P23.5 held-out oracle probe — wafer conservation across the split/merge/rework ALGEBRA (project 18).
 *
 * ── WHY THIS PROJECT AND THIS INVARIANT ──
 * P20.2's measured failure mode is not malice but FEATURE ISOLATION: "each handler passes its own test while
 * sharing no representation with the others; the parts pass and the whole does not exist." Project 18's spec
 * hands us the perfect target, because it prescribes the agent's OWN visible tests per module —
 * `lot-split.test.ts` splits 25 into 22+3 and checks conservation, `lot-merge.test.ts` merges 22+3 back and
 * checks conservation — and each of those passes on an implementation that cannot COMPOSE. So this probe never
 * re-tests a single operation in isolation. Every case here chains operations, which is exactly the surface the
 * visible suite leaves uncovered and the gap P20.2 exists to measure.
 *
 * FAIL_TO_PASS: red on an unbuilt or feature-isolated workspace, green only when the algebra actually composes.
 * The probe binds only to a surface some SPEC fixed in advance — the prescriptive spec's module paths, or the
 * discovery variant's pinned public entry point (see `resolve-operations.mts`) — never to the agent's own tests,
 * fixtures or helpers. An agent cannot satisfy it by editing anything it wrote.
 *
 * Runs via the HOST's tsx, never through anything the agent authored. Workspace arrives via
 * NKLEIN_ORACLE_WORKSPACE.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveRouteAlgebra } from "./resolve-operations.mts";

const workspace = process.env.NKLEIN_ORACLE_WORKSPACE;
if (!workspace) {
	throw new Error("NKLEIN_ORACLE_WORKSPACE is not set — the oracle runner must provide the workspace under grade.");
}

// Bound through the shared resolver so this ONE probe grades BOTH spec variants (P23.6): the prescriptive
// spec's module paths and the discovery variant's single pinned public entry point. Either way the surface was
// fixed by a SPEC in advance, never chosen by the agent.
const { splitLot, mergeLots, recordRework } = await resolveRouteAlgebra(workspace);

const EPOCH = 1_700_000_000_000;
/** The spec's Clock contract is one method; a local stub keeps the probe independent of the agent's ManualClock. */
const clock = { now: () => EPOCH };

const WAFERS = Array.from({ length: 25 }, (_, index) => `w${String(index + 1).padStart(2, "0")}`);

function parentLot() {
	return {
		id: "LOT_A",
		waferIds: [...WAFERS],
		routeId: "ROUTE_1",
		currentOperationId: "OP_10",
		status: "active",
	};
}

/** Assign every wafer to a child by index, which the spec requires to be total and non-duplicating. */
function assignmentsFor(groups: readonly (readonly string[])[], childIds: readonly string[]) {
	const assignments: Record<string, string> = {};
	groups.forEach((group, index) => {
		for (const wafer of group) {
			assignments[wafer] = childIds[index] as string;
		}
	});
	return assignments;
}

test("wafers are conserved across a split → merge → split CHAIN, not merely one operation", () => {
	// The isolated visible tests (split 25→22+3, merge 22+3→25) both pass on an implementation whose merge
	// silently drops one parent's wafers when the parents came from a split rather than being hand-built.
	const parent = parentLot();
	const childIds = ["LOT_B", "LOT_C", "LOT_D"];
	const groups = [WAFERS.slice(0, 12), WAFERS.slice(12, 20), WAFERS.slice(20)];
	const split = splitLot(parent, assignmentsFor(groups, childIds), childIds, clock);

	const merged = mergeLots(split.childLots.slice(0, 2), "LOT_E", clock);
	const resplitIds = ["LOT_F", "LOT_G"];
	const mergedWafers = [...merged.mergedLot.waferIds];
	const resplit = splitLot(
		merged.mergedLot,
		assignmentsFor([mergedWafers.slice(0, 5), mergedWafers.slice(5)], resplitIds),
		resplitIds,
		clock,
	);

	// Everything still alive after the chain: two re-split children plus the untouched third original child.
	const live = [...resplit.childLots, split.childLots[2]].flatMap((lot: { waferIds: string[] }) => lot.waferIds);
	assert.equal(live.length, 25, "wafer COUNT changed across the chain — a wafer was lost or duplicated");
	assert.deepEqual(new Set(live), new Set(WAFERS), "the live wafer SET diverged from the original lot");
});

test("a split's children stay on the parent's route, so merging them back is legal", () => {
	// The spec makes merge validate that parents share a route, and makes split give children "same routeId as
	// parent". An implementation that defaults the child route (or drops the field) passes its own split test —
	// which only checks waferIds — and then makes every downstream merge throw. Neither module's test can see it.
	const childIds = ["LOT_B", "LOT_C"];
	const split = splitLot(
		parentLot(),
		assignmentsFor([WAFERS.slice(0, 20), WAFERS.slice(20)], childIds),
		childIds,
		clock,
	);
	for (const child of split.childLots) {
		assert.equal(child.routeId, "ROUTE_1", "a split child lost the parent's routeId");
	}
	assert.doesNotThrow(() => mergeLots(split.childLots, "LOT_E", clock));
});

test("merging a split child back with its own parent is rejected — the wafers would be duplicated", () => {
	// Purely compositional: merge's own acceptance test constructs two disjoint hand-made lots and never has a
	// parent available to overlap with. This is the case that only exists once split and merge share a world.
	const parent = parentLot();
	const childIds = ["LOT_B", "LOT_C"];
	const split = splitLot(parent, assignmentsFor([WAFERS.slice(0, 20), WAFERS.slice(20)], childIds), childIds, clock);
	assert.throws(
		() => mergeLots([parent, split.childLots[0]], "LOT_E", clock),
		"merging a lot with its own split child must throw — every child wafer appears in both",
	);
});

test("rework re-routes wafers without removing them from the lot's genealogy", () => {
	// "rework must append a loop without erasing the original path". A rework that rewrites the wafer set rather
	// than appending history passes a shallow event-shape test and destroys conservation for everything after it.
	const childIds = ["LOT_B", "LOT_C"];
	const split = splitLot(
		parentLot(),
		assignmentsFor([WAFERS.slice(0, 20), WAFERS.slice(20)], childIds),
		childIds,
		clock,
	);
	const reworked = WAFERS.slice(0, 3);
	const rework = recordRework(split.childLots[0].id, reworked, "OP_05", "probe-rework", clock);
	const startEvent = rework?.startEvent ?? rework?.reworkStartEvent ?? rework;

	assert.equal(startEvent.kind, "lot-rework-started", "rework did not emit a lot-rework-started event");
	for (const wafer of reworked) {
		assert.ok(
			split.childLots[0].waferIds.includes(wafer),
			"rework removed a wafer from its lot instead of appending a loop to its history",
		);
	}
	// The chain still conserves after a rework, which is the property the whole battery rests on.
	const live = split.childLots.flatMap((lot: { waferIds: string[] }) => lot.waferIds);
	assert.deepEqual(new Set(live), new Set(WAFERS), "conservation broke after a rework");
});

test("split validation is total: a wafer left unassigned or assigned twice throws", () => {
	// The spec demands a descriptive Error, explicitly "not a silent no-op" — a no-op here is what silently
	// deletes wafers further down a chain, so the probe asserts the throw rather than the return value.
	const childIds = ["LOT_B", "LOT_C"];
	const incomplete = assignmentsFor([WAFERS.slice(0, 20), WAFERS.slice(20, 24)], childIds);
	assert.throws(() => splitLot(parentLot(), incomplete, childIds, clock), "an unassigned wafer must throw");

	const unknownWafer = { ...assignmentsFor([WAFERS.slice(0, 20), WAFERS.slice(20)], childIds), "w99": "LOT_B" };
	assert.throws(
		() => splitLot(parentLot(), unknownWafer, childIds, clock),
		"a wafer that is not in the parent lot must throw",
	);
});

test("splitLot does not mutate its input lot", () => {
	// The spec says so outright ("do not mutate the input"). A mutating split passes every isolated test — they
	// assert on the RETURNED children — and corrupts the parent that a later step in a chain still reads.
	const parent = parentLot();
	const childIds = ["LOT_B", "LOT_C"];
	splitLot(parent, assignmentsFor([WAFERS.slice(0, 20), WAFERS.slice(20)], childIds), childIds, clock);
	assert.deepEqual(parent.waferIds, WAFERS, "splitLot mutated the parent's waferIds");
	assert.equal(parent.status, "active", "splitLot mutated the parent's status");
});
