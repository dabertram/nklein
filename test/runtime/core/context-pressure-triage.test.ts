import { describe, expect, it } from "vitest";
import type { OccupancyPressureDecision } from "../../../src/core/context-occupancy-pressure";
import { triageContextPressure } from "../../../src/core/context-pressure-triage";

function occupancy(over: Partial<OccupancyPressureDecision>): OccupancyPressureDecision {
	return {
		action: "proceed",
		usedFraction: 0.5,
		headroomTokens: 1000,
		trimZoneOrder: [],
		reason: "test",
		...over,
	};
}

describe("triageContextPressure (F4.14 context-pressure triage core)", () => {
	it("continue — occupancy in the productive band", () => {
		const triage = triageContextPressure({
			occupancy: occupancy({ action: "proceed", usedFraction: 0.5 }),
			pendingWorkItems: 3,
		});
		expect(triage.action).toBe("continue");
	});

	it("compact — over the ceiling with zones left to trim (passes the trim order through)", () => {
		const triage = triageContextPressure({
			occupancy: occupancy({ action: "compact", usedFraction: 0.92, trimZoneOrder: ["middle", "back"] }),
			pendingWorkItems: 2,
		});
		expect(triage.action).toBe("compact");
		expect(triage.trimZoneOrder).toEqual(["middle", "back"]);
	});

	it("stop — over the ceiling with NOTHING left to trim (unrecoverable), parks pending work", () => {
		const triage = triageContextPressure({
			occupancy: occupancy({ action: "compact", usedFraction: 0.99, trimZoneOrder: [] }),
			pendingWorkItems: 4,
		});
		expect(triage.action).toBe("stop");
		expect(triage.reason).toMatch(/unrecoverable.*park.*4 pending/);
	});

	it("stop — clean stop reason when no pending work remains", () => {
		const triage = triageContextPressure({
			occupancy: occupancy({ action: "compact", usedFraction: 0.99, trimZoneOrder: [] }),
			pendingWorkItems: 0,
		});
		expect(triage.action).toBe("stop");
		expect(triage.reason).toMatch(/clean stop/);
	});

	it("stop — a degenerate turn under real pressure won't recover (don't compact-and-retry a hopeless turn)", () => {
		const triage = triageContextPressure({
			occupancy: occupancy({ action: "compact", usedFraction: 0.9, trimZoneOrder: ["middle"] }),
			pendingWorkItems: 1,
			degenerateBehavior: true,
		});
		expect(triage.action).toBe("stop");
		expect(triage.reason).toMatch(/degenerate/);
	});

	it("does NOT stop a degenerate turn that is not under space pressure (that's F3.1/F3.5's job, not context triage)", () => {
		const triage = triageContextPressure({
			occupancy: occupancy({ action: "proceed", usedFraction: 0.4 }),
			pendingWorkItems: 1,
			degenerateBehavior: true,
		});
		expect(triage.action).toBe("continue");
	});

	it("compact — past the learned quality knee even though space is fine, when there's something to trim", () => {
		const triage = triageContextPressure({
			occupancy: occupancy({ action: "proceed", usedFraction: 0.7, trimZoneOrder: ["middle"] }),
			pendingWorkItems: 2,
			qualityBudgetExceeded: true,
		});
		expect(triage.action).toBe("compact");
		expect(triage.reason).toMatch(/quality budget/);
	});

	it("continue — past the quality knee but nothing left to trim (no recovery lever here)", () => {
		const triage = triageContextPressure({
			occupancy: occupancy({ action: "proceed", usedFraction: 0.7, trimZoneOrder: [] }),
			pendingWorkItems: 2,
			qualityBudgetExceeded: true,
		});
		expect(triage.action).toBe("continue");
	});
});
