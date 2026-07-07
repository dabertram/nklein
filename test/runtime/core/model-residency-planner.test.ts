import { describe, expect, it } from "vitest";
import { planResidencyForModel, type ResidentModelInfo } from "../../../src/core/model-residency-planner";

const GiB = 1024 ** 3;
const resident = (key: string, gib: number, over: Partial<ResidentModelInfo> = {}): ResidentModelInfo => ({
	key,
	sizeBytes: gib * GiB,
	inUse: false,
	lastUsedAt: 0,
	...over,
});

describe("planResidencyForModel", () => {
	it("fits without eviction when there's headroom (128 budget, 20 resident, need 28)", () => {
		const plan = planResidencyForModel({
			neededSizeBytes: 28 * GiB,
			resident: [resident("a", 20)],
			totalBudgetBytes: 128 * GiB,
		});
		expect(plan.fits).toBe(true);
		expect(plan.toUnload).toEqual([]);
	});

	it("evicts the COLDEST not-in-use model to make room", () => {
		// 128 budget → usable 96. Resident 80 (free 16). Need 28 → must free ≥12. Evict the coldest until it fits.
		const plan = planResidencyForModel({
			neededSizeBytes: 28 * GiB,
			resident: [
				resident("hot", 40, { lastUsedAt: 100 }),
				resident("cold", 40, { lastUsedAt: 1 }), // coldest → evicted first
			],
			totalBudgetBytes: 128 * GiB,
		});
		expect(plan.fits).toBe(true);
		expect(plan.toUnload).toEqual(["cold"]); // one eviction frees 40 → enough
	});

	it("NEVER evicts an in-use model, even if it's the coldest", () => {
		const plan = planResidencyForModel({
			neededSizeBytes: 28 * GiB,
			resident: [
				resident("cold-busy", 40, { lastUsedAt: 1, inUse: true }), // coldest but mid-task → immovable
				resident("warm-free", 40, { lastUsedAt: 100 }),
			],
			totalBudgetBytes: 128 * GiB,
		});
		expect(plan.toUnload).toEqual(["warm-free"]); // the free one is evicted, not the busy cold one
	});

	it("REFUSES (never overloads) when it can't fit even after evicting everything evictable", () => {
		// 24 budget → usable 18. Resident 16 (all in use). Need 20 → can't free anything, can't fit.
		const plan = planResidencyForModel({
			neededSizeBytes: 20 * GiB,
			resident: [resident("busy", 16, { inUse: true })],
			totalBudgetBytes: 24 * GiB,
		});
		expect(plan.fits).toBe(false);
		expect(plan.toUnload).toEqual([]);
		expect(plan.reason).toMatch(/never overload/i);
	});

	it("refuses on unknown size or budget", () => {
		expect(planResidencyForModel({ neededSizeBytes: 0, resident: [], totalBudgetBytes: 128 * GiB }).fits).toBe(false);
		expect(planResidencyForModel({ neededSizeBytes: 8 * GiB, resident: [], totalBudgetBytes: 0 }).fits).toBe(false);
	});

	it("evicts multiple cold models when one isn't enough", () => {
		// 128 → usable 96. Resident 90 (free 6). Need 40 → free ≥34. Two 20-GiB cold models = 40 freed.
		const plan = planResidencyForModel({
			neededSizeBytes: 40 * GiB,
			resident: [
				resident("c1", 20, { lastUsedAt: 1 }),
				resident("c2", 20, { lastUsedAt: 2 }),
				resident("hot", 50, { lastUsedAt: 100 }),
			],
			totalBudgetBytes: 128 * GiB,
		});
		expect(plan.fits).toBe(true);
		expect(plan.toUnload).toEqual(["c1", "c2"]); // coldest two, in order
	});
});
