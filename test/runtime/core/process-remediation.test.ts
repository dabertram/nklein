import { describe, expect, it } from "vitest";
import {
	detectProcessRemediation,
	type ProcessTrajectory,
	peakRemediationLevel,
	type TrajectoryStep,
} from "../../../src/core/process-remediation.js";

/** opencode-swarm PRM port — the 3 multi-step/agent patterns the single-card watchdog can't see. */

const step = (agent: string, madeProgress: boolean, filesRequested: string[] = []): TrajectoryStep => ({
	agent,
	madeProgress,
	filesRequested,
});

const trajectory = (over: Partial<ProcessTrajectory> = {}): ProcessTrajectory => ({
	steps: [],
	initialPlanTaskCount: 5,
	currentPlanTaskCount: 5,
	...over,
});

describe("detectProcessRemediation", () => {
	it("is clean for a healthy trajectory", () => {
		const t = trajectory({ steps: [step("coder", true, ["a.ts"]), step("reviewer", true, ["a.ts"])] });
		expect(detectProcessRemediation(t)).toEqual([]);
		expect(peakRemediationLevel([])).toBeNull();
	});

	it("fires ping_pong on alternating no-progress hand-offs, and grades by severity", () => {
		// 4 alternating no-progress hops = exactly the threshold → L1.
		const four = trajectory({
			steps: [step("coder", false), step("reviewer", false), step("coder", false), step("reviewer", false)],
		});
		const f4 = detectProcessRemediation(four).find((f) => f.pattern === "ping_pong");
		expect(f4?.level).toBe(1);

		// A same-agent repeat breaks the alternation chain → no ping-pong.
		const broken = trajectory({
			steps: [step("coder", false), step("coder", false), step("coder", false), step("reviewer", false)],
		});
		expect(detectProcessRemediation(broken).some((f) => f.pattern === "ping_pong")).toBe(false);

		// 8 hops = double threshold → L3.
		const eight = trajectory({
			steps: Array.from({ length: 8 }, (_, i) => step(i % 2 === 0 ? "coder" : "reviewer", false)),
		});
		expect(detectProcessRemediation(eight).find((f) => f.pattern === "ping_pong")?.level).toBe(3);
	});

	it("fires expansion_drift when the plan grows past its baseline", () => {
		const t = trajectory({ initialPlanTaskCount: 5, currentPlanTaskCount: 9 }); // +4 > threshold 3 → L1
		const drift = detectProcessRemediation(t).find((f) => f.pattern === "expansion_drift");
		expect(drift?.level).toBe(1);
		expect(drift?.detail).toContain("grew by 4");

		const big = trajectory({ initialPlanTaskCount: 5, currentPlanTaskCount: 12 }); // +7 ≥ 2×3 → L3
		expect(detectProcessRemediation(big).find((f) => f.pattern === "expansion_drift")?.level).toBe(3);
	});

	it("fires context_thrash on consecutive strictly-growing file-request sets", () => {
		const t = trajectory({
			steps: [
				step("coder", false, ["a.ts"]),
				step("coder", false, ["a.ts", "b.ts"]),
				step("coder", false, ["a.ts", "b.ts", "c.ts"]),
			],
		});
		const thrash = detectProcessRemediation(t).find((f) => f.pattern === "context_thrash");
		expect(thrash?.level).toBe(1);

		// A non-superset step (different files) resets the growth run → no thrash.
		const reset = trajectory({
			steps: [step("coder", false, ["a.ts"]), step("coder", false, ["x.ts"]), step("coder", false, ["y.ts"])],
		});
		expect(detectProcessRemediation(reset).some((f) => f.pattern === "context_thrash")).toBe(false);
	});

	it("peakRemediationLevel returns the most severe finding level", () => {
		const t = trajectory({
			initialPlanTaskCount: 5,
			currentPlanTaskCount: 12, // expansion drift L3
			steps: [step("coder", false, ["a.ts"]), step("coder", false, ["a.ts", "b.ts"])],
		});
		expect(peakRemediationLevel(detectProcessRemediation(t))).toBe(3);
	});
});
