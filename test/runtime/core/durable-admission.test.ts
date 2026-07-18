import { describe, expect, it, vi } from "vitest";
import {
	type AdmissionCandidate,
	createAdmissionWakeCoordinator,
	planDurableAdmission,
} from "../../../src/core/durable-admission";
import { type DurableRunConfig, DurableRunController } from "../../../src/core/durable-run-controller";
import { buildDurableJobGraph } from "../../../src/core/durable-scheduler";

/**
 * F1.19 — saturation-aware durable admission: saturated pools exclude their candidates this wake, fairness
 * round-robins across pools (longest-waiting first within a pool), the starvation bound jumps a long-waiting
 * candidate to the front, and the wake coordinator turns capacity/ready events into one debounced tick.
 */

const NOW = 1_000_000;

function candidate(jobId: string, poolKey: string | null, waitedMs: number): AdmissionCandidate {
	return { jobId, poolKey, readySinceMs: NOW - waitedMs };
}

describe("planDurableAdmission", () => {
	it("excludes saturated pools, round-robins fair across free pools, and lets unpooled jobs through", () => {
		const plan = planDurableAdmission({
			now: NOW,
			pools: [
				{ poolKey: "m5max", capacity: 2, inUse: 1 }, // one slot free
				{ poolKey: "m4mini", capacity: 1, inUse: 1 }, // saturated
				{ poolKey: "legion", capacity: 2, inUse: 0 },
			],
			candidates: [
				candidate("a1", "m5max", 5_000),
				candidate("a2", "m5max", 9_000), // waited longer than a1 → first within its pool
				candidate("b1", "m4mini", 60_000), // saturated pool → excluded despite the long wait
				candidate("c1", "legion", 1_000),
				candidate("u1", null, 100), // unpooled → always admissible
			],
		});
		// F1.19b rationing (live wiring 2026-07-18): b1's pool was ALREADY full; a1 loses to a2 for m5max's ONE
		// free slot (longest-waiting first) and is excluded THIS wake — admitting both would dispatch into
		// saturation, the exact churn the admission layer exists to prevent.
		expect(plan.excludedJobIds).toEqual(["b1", "a1"]);
		// Round-robin across pools (first-appearance order m5max, legion, unpooled), longest-waiting first within.
		expect(plan.readyOrder).toEqual(["a2", "c1", "u1"]);
		expect(plan.starvingJobIds).toEqual([]);
	});

	it("a candidate past the starvation bound jumps to the FRONT and is flagged (even when saturated)", () => {
		const plan = planDurableAdmission({
			now: NOW,
			starvationBoundMs: 10_000,
			pools: [
				{ poolKey: "p1", capacity: 1, inUse: 0 },
				{ poolKey: "p2", capacity: 1, inUse: 1 },
			],
			candidates: [
				candidate("fresh", "p1", 1_000),
				candidate("starved", "p1", 15_000), // past the bound → leads
				candidate("starved-saturated", "p2", 20_000), // starving but its pool is full → excluded + flagged
			],
		});
		expect(plan.readyOrder[0]).toBe("starved");
		// Rationing: the starving candidate consumes p1's ONE free slot first; `fresh` waits for the next wake.
		expect(plan.excludedJobIds).toEqual(["starved-saturated", "fresh"]);
		expect(plan.starvingJobIds.sort()).toEqual(["starved", "starved-saturated"]);
	});

	it("integrates with the controller: an excluded job is not leased this tick; freed capacity admits it", async () => {
		const graph = buildDurableJobGraph({ taskIds: ["a", "b"], dependencies: [] });
		const dispatches: string[] = [];
		let saturated = true;
		const controller = new DurableRunController(
			graph,
			{ maxConcurrentLeases: 2, leaseDurationMs: 10_000, maxAttempts: 3, reclaimBackoffMs: 0 } as DurableRunConfig,
			{
				now: () => NOW,
				mintWorkerId: () => "w",
				appendLog: () => {},
				dispatch: (dispatch) => void dispatches.push(dispatch.jobId),
				planAdmission: () => (saturated ? { excludedJobIds: ["b"] } : {}),
			},
		);
		await controller.tick();
		expect(dispatches).toEqual(["a"]); // b's pool saturated → not leased despite a free slot
		saturated = false; // capacity freed
		await controller.tick();
		expect(dispatches).toEqual(["a", "b"]);
	});
});

describe("createAdmissionWakeCoordinator", () => {
	it("coalesces an event burst into ONE tick and stops after dispose", () => {
		vi.useFakeTimers();
		try {
			const requestTick = vi.fn();
			const coordinator = createAdmissionWakeCoordinator({ requestTick, debounceMs: 50 });
			coordinator.capacityFreed("m5max");
			coordinator.jobBecameReady();
			coordinator.capacityFreed(); // burst — still one pending wake
			vi.advanceTimersByTime(60);
			expect(requestTick).toHaveBeenCalledTimes(1);
			// A later event schedules a fresh wake.
			coordinator.jobBecameReady();
			vi.advanceTimersByTime(60);
			expect(requestTick).toHaveBeenCalledTimes(2);
			coordinator.dispose();
			coordinator.capacityFreed();
			vi.advanceTimersByTime(60);
			expect(requestTick).toHaveBeenCalledTimes(2); // disposed → no further ticks
		} finally {
			vi.useRealTimers();
		}
	});
});
