import { describe, expect, it } from "vitest";
import {
	type DevTestSweepEntry,
	formatDevTestSweepReport,
	runDevTestSweep,
	summarizeDevTestSweep,
} from "../../../src/core/dev-test-sweep";

function entry(overrides: Partial<DevTestSweepEntry> = {}): DevTestSweepEntry {
	return {
		preset: "mid_task",
		scenarioTitle: "Mid task",
		started: true,
		startMessage: null,
		outcome: "completed",
		success: true,
		incompleteCardCount: 0,
		summary: "ok",
		evidenceBundlePath: null,
		durationMs: 1000,
		...overrides,
	};
}

describe("dev-test-sweep", () => {
	it("aggregates per-preset outcomes, counting started/failed/not-started", () => {
		const summary = summarizeDevTestSweep([
			entry({ preset: "wide_fanout", outcome: "completed", success: true }),
			entry({ preset: "deep_chain", outcome: "failed", success: false, incompleteCardCount: 2 }),
			entry({ preset: "many_small", started: false, startMessage: "no model", outcome: "failed", success: false }),
		]);
		expect(summary.total).toBe(3);
		expect(summary.succeeded).toBe(1);
		expect(summary.failed).toBe(2);
		expect(summary.notStarted).toBe(1);
		expect(summary.byOutcome.completed).toBe(1);
		expect(summary.byOutcome.failed).toBe(2);
		expect(summary.byOutcome.stagnant).toBe(0);
		expect(summary.allSucceeded).toBe(false);
	});

	it("flags allSucceeded only when every preset completes (and never for an empty sweep)", () => {
		expect(summarizeDevTestSweep([entry(), entry({ preset: "x" })]).allSucceeded).toBe(true);
		expect(
			summarizeDevTestSweep([entry(), entry({ preset: "x", success: false, outcome: "stagnant" })]).allSucceeded,
		).toBe(false);
		expect(summarizeDevTestSweep([]).allSucceeded).toBe(false);
	});

	it("runs each preset in order and aggregates the results", async () => {
		const ran: string[] = [];
		const summary = await runDevTestSweep(["a", "b"], async (preset) => {
			ran.push(preset);
			return entry({ preset, outcome: preset === "b" ? "failed" : "completed", success: preset === "a" });
		});
		expect(ran).toEqual(["a", "b"]);
		expect(summary.total).toBe(2);
		expect(summary.succeeded).toBe(1);
	});

	it("formats a readable report with a per-preset line and an outcome rollup", () => {
		const report = formatDevTestSweepReport(
			summarizeDevTestSweep([
				entry({ preset: "wide_fanout", durationMs: 2500 }),
				entry({
					preset: "deep_chain",
					outcome: "failed",
					success: false,
					incompleteCardCount: 3,
					durationMs: 4000,
				}),
			]),
		);
		expect(report).toContain("Dev-test sweep — 2 presets");
		expect(report).toContain("✓ wide_fanout");
		expect(report).toContain("✗ deep_chain");
		expect(report).toContain("failed (3 incomplete)");
		expect(report).toContain("2.5s");
		expect(report).toContain("1/2 succeeded");
		expect(report).toContain("completed 1, failed 1");
	});
});
