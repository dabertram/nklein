import { describe, expect, it } from "vitest";
import { type RecordingMark, resolveCaptureWindow } from "../../../src/core/hitl-capture-window";

/** The marks the live rig actually held on 2026-09-10, including the 31 stamped by one burned run. */
const LIVE: RecordingMark[] = [
	{ projectId: "39_tests_interval_boundary_suite", mark: 1473 },
	{ projectId: "40_tests_lru_cache_sequence_suite", mark: 1512 },
	{ projectId: "41_tests_async_retry_concurrency_suite", mark: 1570 },
	{ projectId: "42_analysis_unchecked_error_audit", mark: 1659 },
	{ projectId: "45_analysis_dataset_quality_audit", mark: 1774 },
	{ projectId: "46_analysis_security_severity_audit", mark: 1405 },
	{ projectId: "47_spec_requirements_extraction", mark: 1405 },
];

describe("HITL capture window", () => {
	it("closes an earlier project's window at the next project's mark, so a late re-record is still exact", () => {
		// The whole point: recorded today, at high-water 1775, project 40 must NOT swallow 41-45.
		expect(
			resolveCaptureWindow({
				marks: LIVE,
				projectId: "40_tests_lru_cache_sequence_suite",
				queueHighWaterMark: 1775,
			}),
		).toEqual({
			from: 1512,
			to: 1570,
			boundedBy: { kind: "next-project", projectId: "41_tests_async_retry_concurrency_suite" },
		});
	});

	it("runs to the end of the queue only for the latest drive, and says that is what happened", () => {
		const window = resolveCaptureWindow({
			marks: LIVE,
			projectId: "45_analysis_dataset_quality_audit",
			queueHighWaterMark: 1775,
		});
		expect(window).toEqual({ from: 1774, to: 1775, boundedBy: { kind: "queue-high-water" } });
	});

	it("ignores marks that share a value: a burned run stamped 31 projects at once and they bound nothing", () => {
		// 46 and 47 both hold 1405. If a tie counted, 46's window would be the empty range (1405, 1405].
		const window = resolveCaptureWindow({
			marks: LIVE,
			projectId: "46_analysis_security_severity_audit",
			queueHighWaterMark: 1775,
		});
		expect(window.from).toBe(1405);
		expect(window.to).toBe(1473);
		expect(window.boundedBy).toEqual({ kind: "next-project", projectId: "39_tests_interval_boundary_suite" });
	});

	it("never returns a bound beyond what the queue has actually reached", () => {
		// A mark written for a project that was seeded but whose traffic has not arrived yet must not push the
		// upper bound past the queue: the window would claim ids that do not exist.
		const window = resolveCaptureWindow({
			marks: LIVE,
			projectId: "42_analysis_unchecked_error_audit",
			queueHighWaterMark: 1700,
		});
		expect(window).toEqual({ from: 1659, to: 1700, boundedBy: { kind: "queue-high-water" } });
	});

	it("refuses to guess a window for a project that was never marked", () => {
		expect(() =>
			resolveCaptureWindow({
				marks: LIVE,
				projectId: "76_performance_incremental_aggregate",
				queueHighWaterMark: 1775,
			}),
		).toThrow(/no recording mark/u);
	});
});
