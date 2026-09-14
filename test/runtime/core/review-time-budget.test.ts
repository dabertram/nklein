import { describe, expect, it } from "vitest";
import {
	DEFAULT_EXPECTED_REVIEW_TURNS,
	REVIEW_BUDGET_CEILING_MS,
	resolveReviewTimeBudgetMs,
} from "../../../src/core/review-time-budget";

/**
 * P1.REVIEWBUDGET (2026-09-09, measured): a flat 10-minute budget with a 6-minute verdict reserve left FOUR
 * minutes of exploration for a reviewer that needs three or four turns at ~1.5 min each. The log recorded
 * "exploration turn cut at the verdict reserve" 38 times; the verdicts were never reached.
 */
const FLOOR = 10 * 60_000;
const RESERVE = 6 * 60_000;

describe("resolveReviewTimeBudgetMs", () => {
	it("lengthens a starved budget from observed turn latency", () => {
		const budget = resolveReviewTimeBudgetMs({
			observedTurnMs: [90_000, 45_000],
			reserveMs: RESERVE,
			floorMs: FLOOR,
		});
		// 4 turns x the SLOWEST observation + the reserve.
		expect(budget.budgetMs).toBe(DEFAULT_EXPECTED_REVIEW_TURNS * 90_000 + RESERVE);
		expect(budget.derived).toBe(true);
		expect(budget.reason).toContain("observed turn latency");
	});

	it("NEVER shortens: a fast fleet keeps the configured budget", () => {
		const budget = resolveReviewTimeBudgetMs({ observedTurnMs: [4_000], reserveMs: RESERVE, floorMs: FLOOR });
		expect(budget.budgetMs).toBe(FLOOR);
		expect(budget.derived).toBe(false);
		expect(budget.reason).toContain("fits inside the configured budget");
	});

	it("an explicit operator budget wins outright — evidence never overrides a named number", () => {
		const budget = resolveReviewTimeBudgetMs({
			observedTurnMs: [600_000],
			reserveMs: RESERVE,
			floorMs: FLOOR,
			configuredMs: 40 * 60_000,
		});
		expect(budget.budgetMs).toBe(40 * 60_000);
		expect(budget.derived).toBe(false);
		expect(budget.reason).toContain("operator-configured");
	});

	it("ignores unobserved models rather than reading them as instant", () => {
		const budget = resolveReviewTimeBudgetMs({
			observedTurnMs: [null, undefined, 0, Number.NaN, Number.POSITIVE_INFINITY, -5],
			reserveMs: RESERVE,
			floorMs: FLOOR,
		});
		expect(budget.budgetMs).toBe(FLOOR);
		expect(budget.reason).toContain("no observed turn latency yet");
	});

	it("caps a pathological observation at the ceiling, and never below the floor", () => {
		const budget = resolveReviewTimeBudgetMs({
			observedTurnMs: [4 * 60 * 60_000],
			reserveMs: RESERVE,
			floorMs: FLOOR,
		});
		expect(budget.budgetMs).toBe(REVIEW_BUDGET_CEILING_MS);
		expect(budget.reason).toContain("capped at the ceiling");
		// A floor ABOVE the ceiling still wins — this mechanism only ever lengthens.
		const highFloor = resolveReviewTimeBudgetMs({
			observedTurnMs: [4 * 60 * 60_000],
			reserveMs: RESERVE,
			floorMs: 2 * REVIEW_BUDGET_CEILING_MS,
		});
		expect(highFloor.budgetMs).toBe(2 * REVIEW_BUDGET_CEILING_MS);
	});

	it("honours an explicit expected-turn count", () => {
		const budget = resolveReviewTimeBudgetMs({
			observedTurnMs: [60_000],
			reserveMs: 0,
			floorMs: 1,
			expectedTurns: 3,
		});
		expect(budget.budgetMs).toBe(180_000);
	});
});
