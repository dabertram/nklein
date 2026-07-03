import { describe, expect, it } from "vitest";
import {
	assessRunAttention,
	assessRunBudgetPressure,
	assessRunLiveness,
	DEFAULT_RUN_BUDGET_WARN_FRACTION,
	DEFAULT_RUN_LIVENESS_THRESHOLDS,
	type RunLivenessSignals,
} from "../../../src/core/run-attention-signals";

const NOW = 1_000_000_000;
const { idleAfterMs, stalledAfterMs, heartbeatLostAfterMs } = DEFAULT_RUN_LIVENESS_THRESHOLDS;

/** A healthily-beating, recently-active run — the baseline the cases perturb. */
const ACTIVE: RunLivenessSignals = {
	nowMs: NOW,
	lastActivityAtMs: NOW - 1_000,
	lastHeartbeatAtMs: NOW - 1_000,
	expectsHeartbeat: true,
};

describe("assessRunLiveness", () => {
	it("active = recent activity + a live heartbeat", () => {
		expect(assessRunLiveness(ACTIVE)).toBe("active");
	});

	it("idle = a short quiet gap (past the idle window, within the stall window), heartbeat still live", () => {
		const activityAtMs = NOW - idleAfterMs; // exactly at the idle boundary → idle
		expect(assessRunLiveness({ ...ACTIVE, lastActivityAtMs: activityAtMs })).toBe("idle");
		expect(assessRunLiveness({ ...ACTIVE, lastActivityAtMs: NOW - (stalledAfterMs - 1) })).toBe("idle");
	});

	it("stalled = no forward activity for a full stall window while still beating", () => {
		expect(assessRunLiveness({ ...ACTIVE, lastActivityAtMs: NOW - stalledAfterMs })).toBe("stalled");
		expect(assessRunLiveness({ ...ACTIVE, lastActivityAtMs: NOW - (stalledAfterMs + 60_000) })).toBe("stalled");
	});

	it("silent = the heartbeat aged past the lost window (a run that should be beating)", () => {
		expect(assessRunLiveness({ ...ACTIVE, lastHeartbeatAtMs: NOW - heartbeatLostAfterMs })).toBe("silent");
	});

	it("silent = a run that should beat but has never sent a heartbeat (null heartbeat)", () => {
		expect(assessRunLiveness({ ...ACTIVE, lastHeartbeatAtMs: null })).toBe("silent");
	});

	it("silent OUTRANKS stalled — a stalled run with a dead heartbeat is silent (may be dead), not just parked", () => {
		expect(
			assessRunLiveness({
				...ACTIVE,
				lastActivityAtMs: NOW - (stalledAfterMs + 1),
				lastHeartbeatAtMs: NOW - (heartbeatLostAfterMs + 1),
			}),
		).toBe("silent");
	});

	it("a run NOT expected to beat is never silent — a missing heartbeat maps by activity age instead", () => {
		// Queued/finished/never-started: no heartbeat expected, so recent activity still reads active.
		expect(assessRunLiveness({ ...ACTIVE, expectsHeartbeat: false, lastHeartbeatAtMs: null })).toBe("active");
		// ...and a stall is still detectable without a heartbeat.
		expect(
			assessRunLiveness({
				...ACTIVE,
				expectsHeartbeat: false,
				lastHeartbeatAtMs: null,
				lastActivityAtMs: NOW - stalledAfterMs,
			}),
		).toBe("stalled");
	});

	it("unknown activity age (nothing emitted yet) on a beating run is idle, not stalled", () => {
		// A stall requires a KNOWN age past the window; a run that hasn't started emitting is just waiting.
		expect(assessRunLiveness({ ...ACTIVE, lastActivityAtMs: null })).toBe("idle");
	});

	it("future timestamps (clock skew) are treated as 'just happened' — age 0, never negative → active", () => {
		expect(assessRunLiveness({ ...ACTIVE, lastActivityAtMs: NOW + 50_000, lastHeartbeatAtMs: NOW + 50_000 })).toBe(
			"active",
		);
	});

	it("honours injected thresholds", () => {
		const tight = { idleAfterMs: 10, stalledAfterMs: 20, heartbeatLostAfterMs: 15 };
		expect(assessRunLiveness({ ...ACTIVE, lastActivityAtMs: NOW - 25 }, tight)).toBe("silent"); // hb NOW-1000 old
		expect(assessRunLiveness({ ...ACTIVE, lastActivityAtMs: NOW - 25, lastHeartbeatAtMs: NOW - 5 }, tight)).toBe(
			"stalled",
		);
	});
});

describe("assessRunBudgetPressure", () => {
	it("is calm with no ceilings", () => {
		expect(assessRunBudgetPressure([])).toEqual({ approachingCeiling: false, tightest: null, fraction: 0 });
	});

	it("reports the tightest (highest used-fraction) ceiling", () => {
		const p = assessRunBudgetPressure([
			{ kind: "iterations", used: 3, cap: 10 }, // 0.30
			{ kind: "wall_time", used: 9, cap: 10 }, // 0.90 ← tightest
			{ kind: "tokens", used: 50, cap: 100 }, // 0.50
		]);
		expect(p.tightest).toBe("wall_time");
		expect(p.fraction).toBeCloseTo(0.9);
		expect(p.approachingCeiling).toBe(true);
	});

	it("does not flag below the warn fraction", () => {
		const p = assessRunBudgetPressure([{ kind: "iterations", used: 7, cap: 10 }]); // 0.70 < 0.80
		expect(p.tightest).toBe("iterations");
		expect(p.fraction).toBeCloseTo(0.7);
		expect(p.approachingCeiling).toBe(false);
	});

	it("flags exactly AT the warn fraction (inclusive boundary)", () => {
		const p = assessRunBudgetPressure([{ kind: "iterations", used: 8, cap: 10 }]); // 0.80 == default warn
		expect(p.approachingCeiling).toBe(true);
		expect(p.fraction).toBeCloseTo(DEFAULT_RUN_BUDGET_WARN_FRACTION);
	});

	it("ignores un-capped ceilings (cap ≤ 0) so 'no limit' never contributes pressure", () => {
		const p = assessRunBudgetPressure([
			{ kind: "iterations", used: 999, cap: 0 },
			{ kind: "tokens", used: -5, cap: -1 },
			{ kind: "wall_time", used: 5, cap: 10 }, // the only capped one → tightest
		]);
		expect(p.tightest).toBe("wall_time");
		expect(p.fraction).toBeCloseTo(0.5);
		expect(p.approachingCeiling).toBe(false);
	});

	it("all-uncapped reads calm (no tightest)", () => {
		expect(assessRunBudgetPressure([{ kind: "iterations", used: 100, cap: 0 }])).toEqual({
			approachingCeiling: false,
			tightest: null,
			fraction: 0,
		});
	});

	it("clamps an over-cap ceiling to a full fraction of 1 (never > 1)", () => {
		const p = assessRunBudgetPressure([{ kind: "iterations", used: 25, cap: 10 }]);
		expect(p.fraction).toBe(1);
		expect(p.approachingCeiling).toBe(true);
	});

	it("floors a negative used at 0", () => {
		const p = assessRunBudgetPressure([{ kind: "tokens", used: -10, cap: 100 }]);
		expect(p.fraction).toBe(0);
		expect(p.tightest).toBe("tokens");
		expect(p.approachingCeiling).toBe(false);
	});

	it("honours an injected warn fraction", () => {
		const p = assessRunBudgetPressure([{ kind: "wall_time", used: 6, cap: 10 }], 0.5); // 0.60 ≥ 0.50
		expect(p.approachingCeiling).toBe(true);
	});
});

describe("assessRunAttention", () => {
	it("maps a silent run → heartbeatLost override (feeds the classifier's stuck)", () => {
		const a = assessRunAttention({ ...ACTIVE, lastHeartbeatAtMs: null }, []);
		expect(a.liveness).toBe("silent");
		expect(a.overrides).toEqual({ heartbeatLost: true, noProgressOrLoop: false, approachingBudgetCeiling: false });
	});

	it("maps a stalled run → noProgressOrLoop override (feeds the classifier's stuck)", () => {
		const a = assessRunAttention({ ...ACTIVE, lastActivityAtMs: NOW - stalledAfterMs }, []);
		expect(a.liveness).toBe("stalled");
		expect(a.overrides).toEqual({ heartbeatLost: false, noProgressOrLoop: true, approachingBudgetCeiling: false });
	});

	it("maps an approaching-ceiling active run → approachingCeiling override only (still live/progressing)", () => {
		const a = assessRunAttention(ACTIVE, [{ kind: "wall_time", used: 9, cap: 10 }]);
		expect(a.liveness).toBe("active");
		expect(a.budget.tightest).toBe("wall_time");
		expect(a.overrides).toEqual({ heartbeatLost: false, noProgressOrLoop: false, approachingBudgetCeiling: true });
	});

	it("a healthy run within budget derives no overrides at all", () => {
		const a = assessRunAttention(ACTIVE, [{ kind: "iterations", used: 1, cap: 10 }]);
		expect(a.overrides).toEqual({ heartbeatLost: false, noProgressOrLoop: false, approachingBudgetCeiling: false });
	});

	it("threads injected thresholds into both sub-assessments", () => {
		const a = assessRunAttention(
			// Live heartbeat (age 5 < lost 100) so the tight stall window is what fires.
			{ ...ACTIVE, lastActivityAtMs: NOW - 30, lastHeartbeatAtMs: NOW - 5 },
			[{ kind: "tokens", used: 6, cap: 10 }],
			{ liveness: { idleAfterMs: 10, stalledAfterMs: 20, heartbeatLostAfterMs: 100 }, budgetWarnFraction: 0.5 },
		);
		expect(a.liveness).toBe("stalled"); // activity age 30 ≥ stalled 20, heartbeat age 5 < lost 100
		expect(a.overrides.noProgressOrLoop).toBe(true);
		expect(a.budget.approachingCeiling).toBe(true); // 0.60 ≥ 0.50
	});
});
