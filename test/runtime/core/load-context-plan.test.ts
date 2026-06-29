import { describe, expect, it } from "vitest";
import { planLoadContextLength } from "../../../src/core/load-context-plan";

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
