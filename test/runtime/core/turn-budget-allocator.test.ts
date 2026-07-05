import { describe, expect, it } from "vitest";
import { allocateTurnBudget, type BudgetBand, MIN_CONTEXT_FLOOR_TOKENS } from "../../../src/core/turn-budget-allocator";

const fixed = (id: BudgetBand["id"], desired: number): BudgetBand => ({ id, fixed: true, desired, priority: 0 });
const flex = (id: BudgetBand["id"], desired: number, priority: number, min = 0): BudgetBand => ({
	id,
	fixed: false,
	desired,
	priority,
	min,
});

describe("allocateTurnBudget", () => {
	it("reserves fixed bands first, then fills flexible bands by priority up to their desired", () => {
		const result = allocateTurnBudget(40_000, [
			fixed("system_invariants", 2_000),
			fixed("current_message", 1_000),
			fixed("tool_defs", 3_000),
			flex("recent_transcript", 20_000, 100),
			flex("semantic", 10_000, 50),
			flex("episodic", 10_000, 40),
		]);
		// 40k − 6k fixed = 34k for flexible: transcript 20k, semantic 10k, episodic gets the remaining 4k.
		expect(result.allocations.system_invariants).toBe(2_000);
		expect(result.allocations.recent_transcript).toBe(20_000);
		expect(result.allocations.semantic).toBe(10_000);
		expect(result.allocations.episodic).toBe(4_000);
		expect(result.totalAllocated).toBe(40_000);
		expect(result.leftover).toBe(0);
		expect(result.overBudget).toBe(false);
	});

	it("drops a flexible band whose min can't be met; its budget flows to the next", () => {
		const result = allocateTurnBudget(40_000, [
			fixed("system_invariants", 2_000),
			flex("recent_transcript", 36_000, 100),
			flex("semantic", 5_000, 50, 5_000), // wants 5k, min 5k — only 2k left ⇒ dropped
			flex("procedural", 2_000, 10, 0), // min 0 ⇒ takes the leftover 2k
		]);
		expect(result.allocations.recent_transcript).toBe(36_000);
		expect(result.dropped).toContain("semantic");
		expect(result.allocations.semantic).toBe(0);
		expect(result.allocations.procedural).toBe(2_000); // reclaimed the semantic budget
	});

	it("flags overBudget when the fixed bands alone exceed the window (still allocates them)", () => {
		const result = allocateTurnBudget(32_000, [
			fixed("system_invariants", 20_000),
			fixed("tool_defs", 20_000),
			flex("semantic", 5_000, 50),
		]);
		expect(result.overBudget).toBe(true);
		expect(result.allocations.system_invariants).toBe(20_000);
		expect(result.allocations.tool_defs).toBe(20_000);
		expect(result.allocations.semantic).toBe(0); // no room left
		expect(result.leftover).toBeLessThan(0);
	});

	it("higher priority wins the scarce budget regardless of input order", () => {
		const result = allocateTurnBudget(10_000, [
			flex("episodic", 8_000, 10), // listed first but lower priority
			flex("objective_focus", 8_000, 100), // higher priority — fills first
		]);
		expect(result.allocations.objective_focus).toBe(8_000);
		expect(result.allocations.episodic).toBe(2_000);
	});

	it("marks underFloor when the window is below the ≥32k floor (but still allocates within it)", () => {
		const result = allocateTurnBudget(16_000, [fixed("system_invariants", 2_000), flex("semantic", 100_000, 50)]);
		expect(result.underFloor).toBe(true);
		expect(result.allocations.semantic).toBe(14_000); // capped at the (sub-floor) leftover
		expect(allocateTurnBudget(MIN_CONTEXT_FLOOR_TOKENS, []).underFloor).toBe(false);
	});

	it("clamps negative/garbage token values to 0 (fail-safe)", () => {
		const result = allocateTurnBudget(-5, [fixed("system_invariants", -10), flex("semantic", -3, 5)]);
		expect(result.allocations.system_invariants).toBe(0);
		expect(result.allocations.semantic).toBe(0);
		expect(result.totalAllocated).toBe(0);
	});

	it("only reports bands present in the input", () => {
		const result = allocateTurnBudget(40_000, [flex("semantic", 1_000, 50)]);
		expect(Object.keys(result.allocations)).toEqual(["semantic"]);
	});
});

describe("allocateTurnBudget — non-finite fail-safe (regression: bug-hunt 2026-07-05)", () => {
	it("sanitizes NaN / Infinity tokens to 0 so nothing poisons the allocation", () => {
		const result = allocateTurnBudget(Number.NaN, [
			{ id: "system_invariants", fixed: true, desired: Number.NaN, priority: 0 },
			{ id: "semantic", fixed: false, desired: 10_000, priority: 50, min: 0 },
		]);
		expect(result.allocations.system_invariants).toBe(0);
		expect(Number.isNaN(result.totalAllocated)).toBe(false);
		expect(Number.isNaN(result.leftover)).toBe(false);
		expect(Number.isFinite(allocateTurnBudget(Number.POSITIVE_INFINITY, []).totalAllocated)).toBe(true);
	});
});
