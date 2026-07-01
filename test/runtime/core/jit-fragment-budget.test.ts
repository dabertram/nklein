import { describe, expect, it } from "vitest";
import { type FragmentBudgetCandidate, selectFragmentsWithinBudget } from "../../../src/core/jit-fragment-budget";

describe("selectFragmentsWithinBudget", () => {
	it("keeps everything when the budget comfortably covers all candidates (rank order: equal imp ⇒ cheaper first)", () => {
		const candidates: FragmentBudgetCandidate[] = [
			{ id: "repo_map", estimatedTokens: 100, importance: 0.5 },
			{ id: "focus_chain", estimatedTokens: 50, importance: 0.5 },
		];
		const result = selectFragmentsWithinBudget(candidates, 1000);
		// same importance ⇒ tie broken by lower cost, so focus_chain(50) is admitted before repo_map(100).
		expect(result.kept).toEqual(["focus_chain", "repo_map"]);
		expect(result.dropped).toEqual([]);
		expect(result.usedTokens).toBe(150);
		expect(result.overBudget).toBe(false);
	});

	it("drops the lowest-importance fragments first when the budget is tight", () => {
		// budget 150: repo_map(imp .9) + temporal(imp .8) = 140 fit; efficiency_rules(imp .3) would push to 190 → dropped.
		const candidates: FragmentBudgetCandidate[] = [
			{ id: "repo_map", estimatedTokens: 100, importance: 0.9 },
			{ id: "temporal", estimatedTokens: 40, importance: 0.8 },
			{ id: "efficiency_rules", estimatedTokens: 50, importance: 0.3 },
		];
		const result = selectFragmentsWithinBudget(candidates, 150);
		expect(result.kept).toEqual(["repo_map", "temporal"]);
		expect(result.dropped).toEqual(["efficiency_rules"]);
		expect(result.usedTokens).toBe(140);
		expect(result.overBudget).toBe(false);
	});

	it("admits a later cheaper fragment that fits after a costlier one was skipped (greedy, not first-fit-stops)", () => {
		// same importance ⇒ ordered by lower cost: cheap(30) admitted first, then repo_map(80) fits in budget 120,
		// leaving no room for focus_chain(60) which is dropped.
		const candidates: FragmentBudgetCandidate[] = [
			{ id: "repo_map", estimatedTokens: 80, importance: 0.5 },
			{ id: "focus_chain", estimatedTokens: 60, importance: 0.5 },
			{ id: "temporal", estimatedTokens: 30, importance: 0.5 },
		];
		const result = selectFragmentsWithinBudget(candidates, 120);
		// cost order: temporal(30), focus_chain(60), repo_map(80). Admit temporal(30) → used 30; focus_chain(60) → 90;
		// repo_map(80) would be 170 → dropped. So kept = [temporal, focus_chain].
		expect(result.kept).toEqual(["temporal", "focus_chain"]);
		expect(result.dropped).toEqual(["repo_map"]);
		expect(result.usedTokens).toBe(90);
	});

	it("always keeps required fragments, even when they overrun the budget, and reports overBudget", () => {
		const candidates: FragmentBudgetCandidate[] = [
			{ id: "efficiency_rules", estimatedTokens: 200, required: true, importance: 0.1 },
			{ id: "repo_map", estimatedTokens: 50, importance: 0.9 },
		];
		const result = selectFragmentsWithinBudget(candidates, 100);
		// required efficiency_rules(200) alone exceeds budget 100 → overBudget; no optional is admitted.
		expect(result.kept).toEqual(["efficiency_rules"]);
		expect(result.dropped).toEqual(["repo_map"]);
		expect(result.usedTokens).toBe(200);
		expect(result.overBudget).toBe(true);
		expect(result.reason).toMatch(/OVER BUDGET/);
	});

	it("keeps required fragments in INPUT order (not importance order), listed before optionals", () => {
		const candidates: FragmentBudgetCandidate[] = [
			{ id: "freshness_rail", estimatedTokens: 10, required: true, importance: 0.1 },
			{ id: "repo_map", estimatedTokens: 10, importance: 0.99 },
			{ id: "temporal", estimatedTokens: 10, required: true, importance: 0.2 },
		];
		const result = selectFragmentsWithinBudget(candidates, 1000);
		// required (freshness_rail, temporal) in input order first; then optionals by rank (repo_map).
		expect(result.kept).toEqual(["freshness_rail", "temporal", "repo_map"]);
		expect(result.overBudget).toBe(false);
	});

	it("required fragments fit within budget ⇒ remaining budget still fills with optionals", () => {
		const candidates: FragmentBudgetCandidate[] = [
			{ id: "efficiency_rules", estimatedTokens: 40, required: true },
			{ id: "repo_map", estimatedTokens: 40, importance: 0.9 },
			{ id: "focus_chain", estimatedTokens: 40, importance: 0.2 },
		];
		const result = selectFragmentsWithinBudget(candidates, 100);
		// required 40 leaves 60: repo_map(40) fits → used 80; focus_chain(40) would be 120 → dropped.
		expect(result.kept).toEqual(["efficiency_rules", "repo_map"]);
		expect(result.dropped).toEqual(["focus_chain"]);
		expect(result.usedTokens).toBe(80);
		expect(result.overBudget).toBe(false);
	});

	it("breaks importance ties by lower cost, then by original input order", () => {
		// all importance 0.5. Cost order should be: a(10) < b==c(20, input order b before c) < d(30).
		const candidates: FragmentBudgetCandidate[] = [
			{ id: "repo_map", estimatedTokens: 30, importance: 0.5 }, // d
			{ id: "focus_chain", estimatedTokens: 20, importance: 0.5 }, // b (input-order before c)
			{ id: "efficiency_rules", estimatedTokens: 20, importance: 0.5 }, // c
			{ id: "temporal", estimatedTokens: 10, importance: 0.5 }, // a
		];
		// generous budget so all are kept — assert the RANK order via kept order.
		const result = selectFragmentsWithinBudget(candidates, 1000);
		expect(result.kept).toEqual(["temporal", "focus_chain", "efficiency_rules", "repo_map"]);
	});

	it("a non-positive budget keeps only required fragments (optionals all dropped)", () => {
		const candidates: FragmentBudgetCandidate[] = [
			{ id: "temporal", estimatedTokens: 5, required: true },
			{ id: "repo_map", estimatedTokens: 5, importance: 0.9 },
		];
		const zero = selectFragmentsWithinBudget(candidates, 0);
		expect(zero.kept).toEqual(["temporal"]);
		expect(zero.dropped).toEqual(["repo_map"]);
		expect(zero.overBudget).toBe(true); // required(5) > budget(0)

		const negative = selectFragmentsWithinBudget(candidates, -100);
		expect(negative.kept).toEqual(["temporal"]);
		expect(negative.dropped).toEqual(["repo_map"]);
	});

	it("returns an empty selection for no candidates", () => {
		const result = selectFragmentsWithinBudget([], 500);
		expect(result.kept).toEqual([]);
		expect(result.dropped).toEqual([]);
		expect(result.usedTokens).toBe(0);
		expect(result.overBudget).toBe(false);
		expect(result.reason).toMatch(/kept 0 fragment/);
	});

	it("treats a missing importance as 0 (lowest) so tagged fragments outrank untagged ones", () => {
		const candidates: FragmentBudgetCandidate[] = [
			{ id: "repo_map", estimatedTokens: 40 }, // importance defaults to 0
			{ id: "focus_chain", estimatedTokens: 40, importance: 0.5 },
		];
		// budget fits only one (40 each, budget 60): the tagged focus_chain(0.5) wins; repo_map(0) is dropped.
		const result = selectFragmentsWithinBudget(candidates, 60);
		expect(result.kept).toEqual(["focus_chain"]);
		expect(result.dropped).toEqual(["repo_map"]);
	});

	it("floors non-finite / negative token costs to 0 (a free fragment always fits)", () => {
		const candidates: FragmentBudgetCandidate[] = [
			{ id: "repo_map", estimatedTokens: Number.NaN, importance: 0.9 },
			{ id: "focus_chain", estimatedTokens: -50, importance: 0.5 },
			{ id: "temporal", estimatedTokens: Number.POSITIVE_INFINITY, importance: 0.1 },
		];
		const result = selectFragmentsWithinBudget(candidates, 0);
		// all three normalize to 0 cost ⇒ all fit even on a 0 budget; ranked by importance desc.
		expect(result.kept).toEqual(["repo_map", "focus_chain", "temporal"]);
		expect(result.dropped).toEqual([]);
		expect(result.usedTokens).toBe(0);
		expect(result.overBudget).toBe(false);
	});

	it("is pure — does not mutate the input array or its elements", () => {
		const candidates: FragmentBudgetCandidate[] = [
			{ id: "repo_map", estimatedTokens: 100, importance: 0.9 },
			{ id: "focus_chain", estimatedTokens: 100, importance: 0.1 },
		];
		const snapshot = JSON.parse(JSON.stringify(candidates));
		selectFragmentsWithinBudget(candidates, 100);
		expect(candidates).toEqual(snapshot);
	});

	it("the kept set never exceeds the budget unless a required fragment forced it (invariant)", () => {
		const candidates: FragmentBudgetCandidate[] = [
			{ id: "repo_map", estimatedTokens: 70, importance: 0.9 },
			{ id: "focus_chain", estimatedTokens: 70, importance: 0.8 },
			{ id: "efficiency_rules", estimatedTokens: 70, importance: 0.7 },
		];
		const result = selectFragmentsWithinBudget(candidates, 150);
		expect(result.overBudget).toBe(false);
		expect(result.usedTokens).toBeLessThanOrEqual(150);
		// two 70-cost fragments (140) fit under 150; the third (210) would overflow → dropped.
		expect(result.kept).toEqual(["repo_map", "focus_chain"]);
		expect(result.dropped).toEqual(["efficiency_rules"]);
		expect(result.usedTokens).toBe(140);
	});
});
