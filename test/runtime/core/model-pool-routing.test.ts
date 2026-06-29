import { describe, expect, it } from "vitest";
import { type RoleModelPoolCandidate, selectPoolForTask } from "../../../src/core/model-pool-routing";

const pool = (over: Partial<RoleModelPoolCandidate> & { poolId: string }): RoleModelPoolCandidate => ({
	capabilityTier: 80,
	freeSlots: 1,
	...over,
});

// m4mini = weak/small, legion = mid, m5 = strong (the user's three machines).
const m4 = (over: Partial<RoleModelPoolCandidate> = {}) => pool({ poolId: "m4mini", capabilityTier: 40, ...over });
const legion = (over: Partial<RoleModelPoolCandidate> = {}) => pool({ poolId: "legion", capabilityTier: 60, ...over });
const m5 = (over: Partial<RoleModelPoolCandidate> = {}) => pool({ poolId: "m5max", capabilityTier: 95, ...over });

describe("selectPoolForTask", () => {
	it("routes an EASY card to the smallest sufficient pool (reserving strong pools)", () => {
		const result = selectPoolForTask({ pools: [m5(), m4(), legion()], difficulty: 30 });
		expect(result).toMatchObject({ type: "assign", poolId: "m4mini" });
	});

	it("routes a HARD card to the only pool that can serve it", () => {
		const result = selectPoolForTask({ pools: [m4(), legion(), m5()], difficulty: 90 });
		expect(result).toMatchObject({ type: "assign", poolId: "m5max" }); // only m5 clears tier 90
	});

	it("skips a full pool and fans out to the next capable free one", () => {
		// difficulty 30: m4 is smallest-sufficient but FULL → next is legion (free).
		const result = selectPoolForTask({ pools: [m4({ freeSlots: 0 }), legion(), m5()], difficulty: 30 });
		expect(result).toMatchObject({ type: "assign", poolId: "legion" });
	});

	it("reports no_capacity when every capable pool is full (caller queues)", () => {
		const result = selectPoolForTask({
			pools: [m4({ freeSlots: 0 }), legion({ freeSlots: 0 }), m5({ freeSlots: 0 })],
			difficulty: 30,
		});
		expect(result.type).toBe("no_capacity");
	});

	it("reports no_fit when no pool clears the difficulty", () => {
		const result = selectPoolForTask({ pools: [m4(), legion()], difficulty: 99 });
		expect(result.type).toBe("no_fit");
	});

	it("capability weighting picks the strongest free pool (quality-max)", () => {
		const result = selectPoolForTask({ pools: [m4(), legion(), m5()], difficulty: 30, weighting: "capability" });
		expect(result).toMatchObject({ type: "assign", poolId: "m5max" });
	});

	it("breaks a tier tie toward more free slots, then poolId", () => {
		const result = selectPoolForTask({
			pools: [
				pool({ poolId: "b", capabilityTier: 50, freeSlots: 1 }),
				pool({ poolId: "a", capabilityTier: 50, freeSlots: 3 }),
			],
			difficulty: 10,
		});
		expect(result).toMatchObject({ type: "assign", poolId: "a" }); // more free slots wins
	});
});
