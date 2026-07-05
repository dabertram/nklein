import { describe, expect, it } from "vitest";
import {
	type ModelPool,
	poolFreeRamMb,
	poolHasConcurrencyHeadroom,
	poolHasRamHeadroom,
	poolHasResidentModel,
	poolResidentModelKeys,
	poolResidentRamMb,
} from "../../../src/core/model-pool";

const pool = (over: Partial<ModelPool> = {}): ModelPool => ({
	id: "m5max",
	label: "m5max",
	endpoint: "http://m5max:1234",
	maxConcurrency: 3,
	ramBudgetMb: 64_000,
	residentModels: [
		{ modelKey: "qwen/qwen3-8b", ramMb: 9_000 },
		{ modelKey: "gpt-oss-120b", ramMb: 40_000 },
	],
	...over,
});

describe("ModelPool primitives", () => {
	it("lists resident keys + sums resident RAM + reports free headroom", () => {
		const p = pool();
		expect(poolResidentModelKeys(p)).toEqual(["qwen/qwen3-8b", "gpt-oss-120b"]);
		expect(poolResidentRamMb(p)).toBe(49_000);
		expect(poolFreeRamMb(p)).toBe(15_000);
	});

	it("RAM headroom is PER-POOL (fits within this machine's budget, not global)", () => {
		const p = pool();
		expect(poolHasRamHeadroom(p, 15_000)).toBe(true); // 49k + 15k = 64k = budget
		expect(poolHasRamHeadroom(p, 15_001)).toBe(false); // just over
	});

	it("an over-budget pool reports 0 free and no headroom", () => {
		const p = pool({ ramBudgetMb: 40_000 }); // resident 49k > budget 40k
		expect(poolFreeRamMb(p)).toBe(0);
		expect(poolHasRamHeadroom(p, 1)).toBe(false);
	});

	it("concurrency headroom respects maxConcurrency", () => {
		const p = pool({ maxConcurrency: 3 });
		expect(poolHasConcurrencyHeadroom(p, 2)).toBe(true);
		expect(poolHasConcurrencyHeadroom(p, 3)).toBe(false);
	});

	it("detects an already-resident model (no reload needed)", () => {
		const p = pool();
		expect(poolHasResidentModel(p, "gpt-oss-120b")).toBe(true);
		expect(poolHasResidentModel(p, "not-loaded")).toBe(false);
	});

	it("clamps negative footprints / budgets (fail-safe)", () => {
		const p = pool({ ramBudgetMb: 1_000, residentModels: [{ modelKey: "x", ramMb: -50 }] });
		expect(poolResidentRamMb(p)).toBe(0);
		expect(poolFreeRamMb(p)).toBe(1_000);
	});
});
