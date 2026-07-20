import { describe, expect, it } from "vitest";
import {
	computeInterventionMetrics,
	type InterventionEvent,
	rankInterventionsForReport,
} from "../../src/core/operator-intervention";

function ev(
	taskId: string,
	severity: InterventionEvent["severity"],
	humanSeconds: number | null = 30,
	at = 1,
): InterventionEvent {
	return { taskId, severity, humanSeconds, at };
}

describe("computeInterventionMetrics", () => {
	it("counts by severity rather than emitting a bare total", () => {
		const metrics = computeInterventionMetrics({
			events: [ev("t1", "nudge"), ev("t1", "correction"), ev("t2", "takeover")],
			completedTaskIdsInOrder: ["t1", "t2", "t3"],
		});
		expect(metrics.bySeverity).toEqual({ nudge: 1, correction: 1, takeover: 1, abort: 0 });
		expect(metrics.tasksTouched).toBe(2);
	});

	it("computes the autonomous streak from the newest completed tasks backward", () => {
		const metrics = computeInterventionMetrics({
			events: [ev("t1", "takeover")],
			completedTaskIdsInOrder: ["t1", "t2", "t3", "t4"],
		});
		// t4, t3, t2 were clean; t1 was intervened on.
		expect(metrics.autonomousStreak).toBe(3);
	});

	it("reports a zero streak when the newest task was intervened on", () => {
		const metrics = computeInterventionMetrics({
			events: [ev("t3", "nudge")],
			completedTaskIdsInOrder: ["t1", "t2", "t3"],
		});
		expect(metrics.autonomousStreak).toBe(0);
	});

	it("NAMES unmeasured human time so the total is never read as complete", () => {
		const metrics = computeInterventionMetrics({
			events: [ev("t1", "nudge", 60), ev("t2", "correction", null)],
			completedTaskIdsInOrder: ["t1", "t2"],
		});
		expect(metrics.unmeasuredEvents).toBe(1);
		expect(metrics.summary).toContain("is a FLOOR, not the real cost");
	});

	it("returns null measured time rather than 0 when nothing was measured", () => {
		const metrics = computeInterventionMetrics({
			events: [ev("t1", "nudge", null)],
			completedTaskIdsInOrder: ["t1"],
		});
		// 0 would read as 'the human spent no time', which is a different and false claim.
		expect(metrics.measuredHumanSeconds).toBeNull();
	});

	it("always states that a rate needs its denominator — the disengagement-report lesson", () => {
		const metrics = computeInterventionMetrics({ events: [], completedTaskIdsInOrder: ["t1"] });
		expect(metrics.summary).toContain("disengagement mistake");
	});

	it("refuses to imply a rate with no completed tasks", () => {
		const metrics = computeInterventionMetrics({ events: [], completedTaskIdsInOrder: [] });
		expect(metrics.summary).toContain("no intervention rate can be computed");
	});
});

describe("rankInterventionsForReport", () => {
	it("puts the worst first — takeovers and aborts before nudges", () => {
		const ranked = rankInterventionsForReport([
			ev("t1", "nudge", 10, 5),
			ev("t2", "abort", 10, 1),
			ev("t3", "correction", 10, 4),
			ev("t4", "takeover", 10, 2),
		]);
		expect(ranked.map((e) => e.severity)).toEqual(["abort", "takeover", "correction", "nudge"]);
	});

	it("breaks ties by recency", () => {
		const ranked = rankInterventionsForReport([ev("a", "nudge", 1, 1), ev("b", "nudge", 1, 9)]);
		expect(ranked[0]?.taskId).toBe("b");
	});

	it("does not mutate its input", () => {
		const events = [ev("a", "nudge", 1, 1), ev("b", "abort", 1, 2)];
		rankInterventionsForReport(events);
		expect(events[0]?.severity).toBe("nudge");
	});
});
