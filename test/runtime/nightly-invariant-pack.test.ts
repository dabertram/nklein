import { describe, expect, it } from "vitest";
import {
	type DrainedState,
	evaluatePack,
	type InvariantPack,
	resolvePack,
} from "../../src/core/nightly-invariant-pack";

const BASE: InvariantPack = {
	id: "core-invariants",
	expectedTerminalLanes: ["done"],
	mustFire: ["acceptance_evidence", "review_verdict"],
	mustStayQuiet: ["runaway_guard", "stall_guard"],
};

const EXTENDED: InvariantPack = {
	id: "taint-project",
	expectedTerminalLanes: ["parked"],
	mustFire: ["taint_hold"],
	mustStayQuiet: ["thrash_guard"],
	includes: ["core-invariants"],
};

const registry = new Map([
	["core-invariants", BASE],
	["taint-project", EXTENDED],
]);

function healthyState(overrides: Partial<DrainedState> = {}): DrainedState {
	return {
		terminalLanesByCard: new Map([["card-1", "done"]]),
		firedSignals: new Set(["acceptance_evidence", "review_verdict"]),
		watchedSignals: new Set(["acceptance_evidence", "review_verdict", "runaway_guard", "stall_guard"]),
		unmatchedAimockRequests: 0,
		orphanSessions: 0,
		orphanWorktrees: 0,
		orphanLeases: 0,
		...overrides,
	};
}

describe("resolvePack", () => {
	it("merges an included pack so a project asserts BY REFERENCE", () => {
		const resolved = resolvePack("taint-project", registry);
		expect(resolved?.mustFire).toEqual(["acceptance_evidence", "review_verdict", "taint_hold"]);
		expect(resolved?.expectedTerminalLanes).toEqual(["done", "parked"]);
		expect(resolved?.mustStayQuiet).toEqual(["runaway_guard", "stall_guard", "thrash_guard"]);
	});

	it("returns null for an unknown pack rather than an empty one", () => {
		// An empty pack would assert NOTHING while appearing to pass — the worst possible failure here.
		expect(resolvePack("nope", registry)).toBeNull();
	});

	it("returns null when an INCLUDED pack is missing", () => {
		const broken = new Map([["a", { ...BASE, id: "a", includes: ["ghost"] }]]);
		expect(resolvePack("a", broken)).toBeNull();
	});

	it("survives a cycle rather than hanging", () => {
		const cyclic = new Map([
			["a", { ...BASE, id: "a", includes: ["b"] }],
			["b", { ...BASE, id: "b", includes: ["a"] }],
		]);
		expect(resolvePack("a", cyclic)).not.toBeNull();
	});
});

describe("evaluatePack", () => {
	it("passes a healthy run", () => {
		const result = evaluatePack(BASE, healthyState());
		expect(result.passed).toBe(true);
	});

	it("fails when a gate that MUST fire did not — the run skipped a control", () => {
		const result = evaluatePack(BASE, healthyState({ firedSignals: new Set(["review_verdict"]) }));
		expect(result.passed).toBe(false);
		expect(result.violated.some((c) => c.name === "must_fire:acceptance_evidence")).toBe(true);
		expect(result.summary).toContain("skipped a control");
	});

	it("fails when a guard fired on a HEALTHY run — the false positive that gets guards disabled", () => {
		const result = evaluatePack(
			BASE,
			healthyState({ firedSignals: new Set(["acceptance_evidence", "review_verdict", "stall_guard"]) }),
		);
		expect(result.passed).toBe(false);
		expect(result.violated.some((c) => c.name === "must_stay_quiet:stall_guard")).toBe(true);
		expect(result.summary).toContain("FALSE POSITIVE");
	});

	it("reports INDETERMINATE — never satisfied — when a signal was never watched", () => {
		const result = evaluatePack(BASE, healthyState({ watchedSignals: new Set(["review_verdict"]) }));
		expect(result.passed).toBe(false);
		expect(result.indeterminate.length).toBeGreaterThan(0);
		expect(result.summary).toContain("unevaluable ≠ pass");
	});

	it("treats an unwatched must-stay-quiet signal as proving nothing", () => {
		const result = evaluatePack(
			BASE,
			healthyState({ watchedSignals: new Set(["acceptance_evidence", "review_verdict"]) }),
		);
		const quiet = result.indeterminate.find((c) => c.name === "must_stay_quiet:runaway_guard");
		expect(quiet?.detail).toContain("silence proves nothing");
	});

	it("fails on unmatched aimock requests (F11.4c)", () => {
		const result = evaluatePack(BASE, healthyState({ unmatchedAimockRequests: 2 }));
		expect(result.passed).toBe(false);
		expect(result.violated.some((c) => c.name === "aimock_fully_matched")).toBe(true);
	});

	it("fails on orphans left after teardown", () => {
		const result = evaluatePack(BASE, healthyState({ orphanWorktrees: 1 }));
		expect(result.passed).toBe(false);
		expect(result.violated.some((c) => c.name === "no_orphans_after_teardown")).toBe(true);
	});

	it("fails when a card ended in an unexpected lane, naming the card", () => {
		const result = evaluatePack(
			BASE,
			healthyState({
				terminalLanesByCard: new Map([
					["card-1", "done"],
					["card-2", "in_progress"],
				]),
			}),
		);
		expect(result.passed).toBe(false);
		expect(result.summary).toContain("card-2→in_progress");
	});
});
