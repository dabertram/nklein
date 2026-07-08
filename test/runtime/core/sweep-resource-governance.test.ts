import { describe, expect, it } from "vitest";
import { decideSweepPriority, decideSweepStartHeadroom } from "../../../src/core/sweep-resource-governance";

describe("sweep resource governance", () => {
	describe("decideSweepStartHeadroom (7461)", () => {
		const ample = { freeRamGb: 64, requiredRamGb: 8, freeDiskGb: 200, requiredDiskGb: 10 };

		it("passes with ample RAM + disk (VRAM gate skipped when not provided)", () => {
			expect(decideSweepStartHeadroom(ample)).toMatchObject({ ok: true, blockers: [] });
		});

		it("blocks on short RAM", () => {
			const d = decideSweepStartHeadroom({ ...ample, freeRamGb: 4 });
			expect(d.ok).toBe(false);
			expect(d.blockers).toEqual(["ram"]);
		});

		it("blocks on short disk", () => {
			expect(decideSweepStartHeadroom({ ...ample, freeDiskGb: 5 }).blockers).toEqual(["disk"]);
		});

		it("checks VRAM only when both figures are provided", () => {
			expect(decideSweepStartHeadroom({ ...ample, freeVramGb: 2, requiredVramGb: 8 }).blockers).toEqual(["vram"]);
			// Missing requiredVramGb → VRAM gate skipped even with tiny freeVramGb.
			expect(decideSweepStartHeadroom({ ...ample, freeVramGb: 0 }).ok).toBe(true);
		});

		it("reports every short resource together", () => {
			const d = decideSweepStartHeadroom({
				freeRamGb: 2,
				requiredRamGb: 8,
				freeDiskGb: 1,
				requiredDiskGb: 10,
				freeVramGb: 1,
				requiredVramGb: 8,
			});
			expect(d.ok).toBe(false);
			expect(d.blockers.sort()).toEqual(["disk", "ram", "vram"]);
		});
	});

	describe("decideSweepPriority (7462)", () => {
		it("interactive work preempts a running sweep", () => {
			expect(decideSweepPriority({ interactiveTaskActive: true, sweepRunning: true }).action).toBe("preempt_sweep");
		});

		it("holds a sweep from starting while interactive work is in flight", () => {
			expect(decideSweepPriority({ interactiveTaskActive: true, sweepRunning: false }).action).toBe("hold_sweep");
		});

		it("lets a sweep continue when nothing interactive contends", () => {
			expect(decideSweepPriority({ interactiveTaskActive: false, sweepRunning: true }).action).toBe(
				"continue_sweep",
			);
		});

		it("permits a sweep to start on an idle machine", () => {
			expect(decideSweepPriority({ interactiveTaskActive: false, sweepRunning: false }).action).toBe(
				"may_start_sweep",
			);
		});
	});
});
