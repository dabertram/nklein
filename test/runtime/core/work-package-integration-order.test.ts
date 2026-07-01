import { describe, expect, it } from "vitest";
import type { WorkPackage } from "../../../src/core/work-package-dispatch";
import {
	type IntegrationOrderPlan,
	integrationMergeOrder,
	planIntegrationOrder,
} from "../../../src/core/work-package-integration-order";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pkg(over: Partial<WorkPackage> & { id: string }): WorkPackage {
	return { writeScope: [`src/core/${over.id}.ts`], ...over };
}

/** Just the ordered ids from a plan's sequence. */
function orderOf(plan: IntegrationOrderPlan): string[] {
	return plan.sequence.map((step) => step.packageId);
}

/** True if `before` lands strictly before `after` in the sequence. */
function landsBefore(plan: IntegrationOrderPlan, before: string, after: string): boolean {
	const order = orderOf(plan);
	const bi = order.indexOf(before);
	const ai = order.indexOf(after);
	return bi >= 0 && ai >= 0 && bi < ai;
}

// ---------------------------------------------------------------------------
// planIntegrationOrder — basic ordering
// ---------------------------------------------------------------------------

describe("planIntegrationOrder — ordering", () => {
	it("empty batch → empty clean plan", () => {
		const plan = planIntegrationOrder([]);
		expect(plan.sequence).toEqual([]);
		expect(plan.deferred).toEqual([]);
		expect(plan.headline).toBe("clean");
	});

	it("single disjoint package lands at order 0 with no rebases", () => {
		const plan = planIntegrationOrder([pkg({ id: "a" })]);
		expect(plan.sequence).toEqual([{ packageId: "a", order: 0, rebaseAgainst: [] }]);
		expect(plan.headline).toBe("clean");
	});

	it("assigns contiguous 0-based order numbers in sequence position", () => {
		const plan = planIntegrationOrder([pkg({ id: "c" }), pkg({ id: "a" }), pkg({ id: "b" })]);
		expect(plan.sequence.map((s) => s.order)).toEqual([0, 1, 2]);
	});

	it("independent disjoint packages land in ascending id order (stable, input-order-independent)", () => {
		const forward = orderOf(planIntegrationOrder([pkg({ id: "a" }), pkg({ id: "b" }), pkg({ id: "c" })]));
		const reversed = orderOf(planIntegrationOrder([pkg({ id: "c" }), pkg({ id: "b" }), pkg({ id: "a" })]));
		expect(forward).toEqual(["a", "b", "c"]);
		expect(reversed).toEqual(["a", "b", "c"]);
	});

	it("lands a prerequisite before its dependent regardless of input order", () => {
		// dependent "a" depends on "b"; "b" must land first even though "a" sorts earlier.
		const plan = planIntegrationOrder([pkg({ id: "a", dependsOn: ["b"] }), pkg({ id: "b" })]);
		expect(orderOf(plan)).toEqual(["b", "a"]);
		expect(landsBefore(plan, "b", "a")).toBe(true);
	});

	it("respects a dependency chain (C←B←A: C then B then A)", () => {
		const plan = planIntegrationOrder([
			pkg({ id: "a", dependsOn: ["b"] }),
			pkg({ id: "b", dependsOn: ["c"] }),
			pkg({ id: "c" }),
		]);
		expect(orderOf(plan)).toEqual(["c", "b", "a"]);
	});

	it("diamond: both mid packages land after the root and before the sink, mids in id order", () => {
		// root ← {left,right} ← sink
		const plan = planIntegrationOrder([
			pkg({ id: "sink", dependsOn: ["left", "right"] }),
			pkg({ id: "left", dependsOn: ["root"] }),
			pkg({ id: "right", dependsOn: ["root"] }),
			pkg({ id: "root" }),
		]);
		expect(orderOf(plan)).toEqual(["root", "left", "right", "sink"]);
	});

	it("ignores a self-dependency for ordering (does not wedge the package out)", () => {
		const plan = planIntegrationOrder([pkg({ id: "a", dependsOn: ["a"] }), pkg({ id: "b" })]);
		expect(orderOf(plan)).toEqual(["a", "b"]);
		expect(plan.deferred).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// planIntegrationOrder — rebase-against overlaps
// ---------------------------------------------------------------------------

describe("planIntegrationOrder — rebase overlaps", () => {
	it("clean headline when every landing is write-scope-disjoint", () => {
		const plan = planIntegrationOrder([
			pkg({ id: "a", writeScope: ["src/core/a.ts"] }),
			pkg({ id: "b", writeScope: ["src/core/b.ts"] }),
		]);
		expect(plan.headline).toBe("clean");
		expect(plan.sequence.every((s) => s.rebaseAgainst.length === 0)).toBe(true);
	});

	it("RED overlap — the second landing rebases against the first on the shared specific path", () => {
		const plan = planIntegrationOrder([
			pkg({ id: "a", writeScope: ["src/core/shared.ts", "src/core/a.ts"] }),
			pkg({ id: "b", writeScope: ["src/core/shared.ts", "src/core/b.ts"] }),
		]);
		// "a" lands first (ascending id, no deps); "b" rebases against "a".
		expect(orderOf(plan)).toEqual(["a", "b"]);
		expect(plan.sequence[0]?.rebaseAgainst).toEqual([]);
		expect(plan.sequence[1]?.rebaseAgainst).toEqual([
			{
				landedId: "a",
				conflictClass: "red",
				sharedSpecificPaths: ["src/core/shared.ts"],
				sharedCoarsePaths: [],
			},
		]);
		expect(plan.headline).toBe("rebases_needed");
	});

	it("YELLOW overlap — a shared coarse path (barrel/manifest) is a light re-check, not a green clean add", () => {
		const plan = planIntegrationOrder([
			pkg({ id: "a", writeScope: ["package.json", "src/core/a.ts"] }),
			pkg({ id: "b", writeScope: ["package.json", "src/core/b.ts"] }),
		]);
		expect(plan.sequence[1]?.rebaseAgainst).toEqual([
			{
				landedId: "a",
				conflictClass: "yellow",
				sharedSpecificPaths: [],
				sharedCoarsePaths: ["package.json"],
			},
		]);
		expect(plan.headline).toBe("rebases_needed");
	});

	it("a later landing lists overlaps with ALL earlier landings it collides with, sorted by landed id", () => {
		// a, b both write shared.ts; c also writes shared.ts → c rebases against BOTH a and b.
		const plan = planIntegrationOrder([
			pkg({ id: "a", writeScope: ["src/core/shared.ts", "src/core/a.ts"] }),
			pkg({ id: "b", writeScope: ["src/core/shared.ts", "src/core/b.ts"] }),
			pkg({ id: "c", writeScope: ["src/core/shared.ts", "src/core/c.ts"] }),
		]);
		expect(orderOf(plan)).toEqual(["a", "b", "c"]);
		expect(plan.sequence[2]?.rebaseAgainst.map((r) => r.landedId)).toEqual(["a", "b"]);
	});

	it("forbidden-scope write between landings is RED (a writes into b's forbidden area)", () => {
		const plan = planIntegrationOrder([
			pkg({ id: "a", writeScope: ["src/server/runtime-server.ts"] }),
			pkg({ id: "b", writeScope: ["src/core/b.ts"], forbiddenScope: ["src/server"] }),
		]);
		// a lands first (ascending id); b then overlaps a via the forbidden-scope violation.
		const bStep = plan.sequence.find((s) => s.packageId === "b");
		expect(bStep?.rebaseAgainst[0]?.conflictClass).toBe("red");
		expect(plan.headline).toBe("rebases_needed");
	});

	it("rebase-against only looks BACKWARD — the first-landed of an overlapping pair has an empty list", () => {
		const plan = planIntegrationOrder([
			pkg({ id: "a", writeScope: ["src/core/shared.ts"] }),
			pkg({ id: "b", writeScope: ["src/core/shared.ts"] }),
		]);
		expect(plan.sequence[0]?.rebaseAgainst).toEqual([]);
		expect(plan.sequence[1]?.rebaseAgainst).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// planIntegrationOrder — deferral (prerequisite not completed)
// ---------------------------------------------------------------------------

describe("planIntegrationOrder — deferral", () => {
	it("defers a completed package whose prerequisite is not in the completed set", () => {
		// "a" depends on "x", but "x" is still in-flight (not present in the batch).
		const plan = planIntegrationOrder([pkg({ id: "a", dependsOn: ["x"] }), pkg({ id: "b" })]);
		expect(orderOf(plan)).toEqual(["b"]);
		expect(plan.deferred).toEqual([{ packageId: "a", reason: "prerequisite_not_completed", blockedBy: ["x"] }]);
		expect(plan.headline).toBe("partial");
	});

	it("propagates deferral transitively: A→B→(missing C) defers both A and B with concrete blockers", () => {
		const plan = planIntegrationOrder([
			pkg({ id: "a", dependsOn: ["b"] }),
			pkg({ id: "b", dependsOn: ["c"] }),
			// c is NOT in the completed set
		]);
		expect(orderOf(plan)).toEqual([]);
		const byId = new Map(plan.deferred.map((d) => [d.packageId, d]));
		expect(byId.get("b")?.blockedBy).toEqual(["c"]); // b directly blocked by missing c
		expect(byId.get("a")?.blockedBy).toEqual(["b"]); // a blocked by now-deferred b
		expect(plan.deferred.every((d) => d.reason === "prerequisite_not_completed")).toBe(true);
	});

	it("landable siblings still land even when one branch of the batch is deferred (partial headline)", () => {
		const plan = planIntegrationOrder([
			pkg({ id: "clean1" }),
			pkg({ id: "clean2" }),
			pkg({ id: "blocked", dependsOn: ["missing"] }),
		]);
		expect(orderOf(plan)).toEqual(["clean1", "clean2"]);
		expect(plan.deferred.map((d) => d.packageId)).toEqual(["blocked"]);
		expect(plan.headline).toBe("partial");
	});

	it("deferred list is sorted by package id and blockedBy is deduped+sorted", () => {
		const plan = planIntegrationOrder([
			pkg({ id: "z", dependsOn: ["m", "n", "m"] }), // duplicate + unsorted missing deps
			pkg({ id: "y", dependsOn: ["q"] }),
		]);
		expect(plan.deferred.map((d) => d.packageId)).toEqual(["y", "z"]);
		expect(plan.deferred.find((d) => d.packageId === "z")?.blockedBy).toEqual(["m", "n"]);
	});

	it("a satisfied in-set prerequisite does NOT defer — the pair simply orders", () => {
		const plan = planIntegrationOrder([pkg({ id: "a", dependsOn: ["b"] }), pkg({ id: "b" })]);
		expect(plan.deferred).toEqual([]);
		expect(orderOf(plan)).toEqual(["b", "a"]);
		expect(plan.headline).toBe("clean");
	});
});

// ---------------------------------------------------------------------------
// planIntegrationOrder — totality / robustness
// ---------------------------------------------------------------------------

describe("planIntegrationOrder — totality", () => {
	it("de-duplicates ids (first occurrence wins) instead of throwing", () => {
		const plan = planIntegrationOrder([
			pkg({ id: "a", writeScope: ["src/core/first.ts"] }),
			pkg({ id: "a", writeScope: ["src/core/second.ts"] }),
			pkg({ id: "b" }),
		]);
		expect(orderOf(plan)).toEqual(["a", "b"]);
		// The FIRST "a" definition is the one kept — b is disjoint from src/core/first.ts, so still clean.
		expect(plan.headline).toBe("clean");
	});

	it("headline is 'partial' when a deferral exists even if the landable part is clean", () => {
		const plan = planIntegrationOrder([pkg({ id: "ok" }), pkg({ id: "blocked", dependsOn: ["missing"] })]);
		expect(plan.sequence.every((s) => s.rebaseAgainst.length === 0)).toBe(true);
		expect(plan.headline).toBe("partial");
	});

	it("does not throw and returns a usable plan on a fully-blocked batch", () => {
		const plan = planIntegrationOrder([pkg({ id: "a", dependsOn: ["ghost"] })]);
		expect(plan.sequence).toEqual([]);
		expect(plan.deferred).toHaveLength(1);
		expect(plan.headline).toBe("partial");
	});
});

// ---------------------------------------------------------------------------
// integrationMergeOrder convenience
// ---------------------------------------------------------------------------

describe("integrationMergeOrder", () => {
	it("returns just the ordered ids of the landable sequence", () => {
		const order = integrationMergeOrder([
			pkg({ id: "a", dependsOn: ["b"] }),
			pkg({ id: "b" }),
			pkg({ id: "c", dependsOn: ["missing"] }),
		]);
		expect(order).toEqual(["b", "a"]); // c deferred, not in the order
	});

	it("matches the plan's sequence ids exactly", () => {
		const input = [pkg({ id: "root" }), pkg({ id: "leaf", dependsOn: ["root"] })];
		expect(integrationMergeOrder(input)).toEqual(orderOf(planIntegrationOrder(input)));
	});
});
