import { describe, expect, it } from "vitest";
import { planLoadContextLength, planSharedSlotLoadContextLength } from "../../../src/core/load-context-plan";

const FLOOR = 32_000;

describe("planLoadContextLength", () => {
	it("lands at the ≥32k floor for a small task (the common case — never over-provisions)", () => {
		const ctx = planLoadContextLength({ taskNeededTokens: 6000, maxContextLength: 262_144, minContextFloor: FLOOR });
		// task fit (~8192) is below the floor → floored to 32000, NOT the model's 262k max.
		expect(ctx).toBe(FLOOR);
	});

	it("sizes UP for a big-context task but not to the model max", () => {
		const ctx = planLoadContextLength({
			taskNeededTokens: 80_000,
			maxContextLength: 262_144,
			minContextFloor: FLOOR,
		});
		// 80k * 1.25 headroom = 100000 → rounds up to a 1024 multiple, above the floor, well below 262k.
		expect(ctx).toBeGreaterThan(FLOOR);
		expect(ctx).toBeLessThan(262_144);
		expect(ctx).toBeGreaterThanOrEqual(100_000);
	});

	it("never exceeds the model max", () => {
		const ctx = planLoadContextLength({
			taskNeededTokens: 500_000,
			maxContextLength: 128_000,
			minContextFloor: FLOOR,
		});
		expect(ctx).toBe(128_000);
	});

	it("clamps to the model max when the model cannot even meet the floor (suitability gate's job to reject)", () => {
		const ctx = planLoadContextLength({ taskNeededTokens: 4000, maxContextLength: 16_000, minContextFloor: FLOOR });
		expect(ctx).toBe(16_000);
	});

	it("stays within [floor, max] across a sweep", () => {
		for (const need of [0, 1000, 32_000, 60_000, 130_000]) {
			const ctx = planLoadContextLength({
				taskNeededTokens: need,
				maxContextLength: 262_144,
				minContextFloor: FLOOR,
			});
			expect(ctx).toBeGreaterThanOrEqual(FLOOR);
			expect(ctx).toBeLessThanOrEqual(262_144);
		}
	});
});
describe("planSharedSlotLoadContextLength (F12.68 shared-slot budget)", () => {
	const base = { taskNeededTokens: 8_000, minContextFloor: 32_000 };

	it("multiplies the per-session plan by the slot count when the model max allows it", () => {
		const plan = planSharedSlotLoadContextLength({ ...base, maxContextLength: 131_072, concurrentSlots: 3 });
		expect(plan.contextLength).toBe(96_000);
		expect(plan.perSlotContextLength).toBe(32_000);
		expect(plan.perSlotUnderFloor).toBe(false);
	});

	it("slots=1 degenerates to the per-session plan exactly", () => {
		const single = planSharedSlotLoadContextLength({ ...base, maxContextLength: 131_072, concurrentSlots: 1 });
		expect(single.contextLength).toBe(planLoadContextLength({ ...base, maxContextLength: 131_072 }));
		expect(single.perSlotUnderFloor).toBe(false);
	});

	it("flags per-slot starvation when the model max cannot cover slots x floor", () => {
		const plan = planSharedSlotLoadContextLength({ ...base, maxContextLength: 40_960, concurrentSlots: 3 });
		expect(plan.contextLength).toBe(40_960);
		expect(plan.perSlotContextLength).toBe(13_653);
		expect(plan.perSlotUnderFloor).toBe(true);
		expect(plan.maxSlotsAtFloor).toBe(1);
	});

	it("reports the safe fallback cap for a mid-size model", () => {
		const plan = planSharedSlotLoadContextLength({ ...base, maxContextLength: 131_072, concurrentSlots: 8 });
		expect(plan.perSlotUnderFloor).toBe(true);
		expect(plan.maxSlotsAtFloor).toBe(4);
	});

	it("clamps degenerate slot counts up to 1", () => {
		const plan = planSharedSlotLoadContextLength({ ...base, maxContextLength: 131_072, concurrentSlots: 0 });
		expect(plan.contextLength).toBe(planLoadContextLength({ ...base, maxContextLength: 131_072 }));
	});
});
