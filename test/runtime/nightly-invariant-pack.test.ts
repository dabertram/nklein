import { describe, expect, it } from "vitest";
import {
	applyProfileToPack,
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

describe("per-profile quiet exemptions (N5 2026-07-26 — flaky injected-fault noise)", () => {
	const withExemptions: InvariantPack = {
		...BASE,
		quietExemptionsByProfile: { flaky: ["stall_guard"] },
	};

	it("drops only the exempted quiet signals for the exempting profile", () => {
		const flaky = applyProfileToPack(withExemptions, "flaky");
		expect(flaky.mustStayQuiet).toEqual(["runaway_guard"]);
		// Everything else is untouched — lanes and mustFire are profile-independent.
		expect(flaky.mustFire).toEqual(withExemptions.mustFire);
		expect(flaky.expectedTerminalLanes).toEqual(withExemptions.expectedTerminalLanes);
	});

	it("leaves other profiles (and packs without exemptions) byte-identical", () => {
		expect(applyProfileToPack(withExemptions, "perfect").mustStayQuiet).toEqual(["runaway_guard", "stall_guard"]);
		expect(applyProfileToPack(BASE, "flaky")).toBe(BASE);
	});

	it("a fired-but-exempt signal no longer violates the flaky profile, and still violates perfect", () => {
		const fired = healthyState({
			firedSignals: new Set(["acceptance_evidence", "review_verdict", "stall_guard"]),
		});
		expect(evaluatePack(applyProfileToPack(withExemptions, "flaky"), fired).passed).toBe(true);
		expect(evaluatePack(applyProfileToPack(withExemptions, "perfect"), fired).passed).toBe(false);
	});

	it("resolvePack merges exemptions across includes", () => {
		const child: InvariantPack = {
			id: "child",
			expectedTerminalLanes: [],
			mustFire: [],
			mustStayQuiet: [],
			quietExemptionsByProfile: { flaky: ["runaway_guard"] },
			includes: ["core-invariants"],
		};
		const merged = resolvePack(
			"child",
			new Map([
				["core-invariants", withExemptions],
				["child", child],
			]),
		);
		expect(merged?.quietExemptionsByProfile?.flaky).toEqual(["runaway_guard", "stall_guard"]);
	});
});

describe("the vacuous-pass bug (found 2026-07-20 by the N7 runner wire)", () => {
	it("reports INDETERMINATE, not satisfied, when NO cards were observed", () => {
		// 'All 0 cards ended in done' is vacuously true and reads as a pass. That is the same empty-pack hazard
		// resolvePack refuses, reappearing one level down — in the STATE rather than in the pack. The runner found
		// it immediately: a cell with no card data reported 'all 3 invariant(s) satisfied'.
		const result = evaluatePack(BASE, healthyState({ terminalLanesByCard: new Map() }));
		expect(result.passed).toBe(false);
		const lanes = result.checks.find((c) => c.name === "terminal_lanes");
		expect(lanes?.status).toBe("indeterminate");
		expect(lanes?.detail).toContain("vacuously true");
	});
});
