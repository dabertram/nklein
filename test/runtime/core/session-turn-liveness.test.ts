import { describe, expect, it } from "vitest";
import {
	BUSY_WEDGE_HARD_CAP_MULTIPLIER,
	DEFAULT_ZERO_TOKEN_WEDGE_MS,
	decideZeroTokenWedgeAction,
	listZeroTokenWedgedSessions,
} from "../../../src/core/session-turn-liveness";
import type { RuntimeTaskSessionSummary } from "../../../src/core/task-session-api-contract";

const NOW = 1_783_900_000_000;

function summary(overrides: Partial<RuntimeTaskSessionSummary> = {}): RuntimeTaskSessionSummary {
	return {
		taskId: "task-1",
		state: "running",
		agentId: "nklein",
		workspacePath: "/tmp/ws",
		pid: null,
		startedAt: NOW - DEFAULT_ZERO_TOKEN_WEDGE_MS - 60_000, // past the bound by a minute
		updatedAt: NOW,
		lastOutputAt: null,
		lastTokenAt: null,
		// Production primary starts optimistically stamp this before the SDK call. It is a renewable timestamp, not
		// permanent evidence that the first turn is alive.
		lastHeartbeatAt: NOW - DEFAULT_ZERO_TOKEN_WEDGE_MS - 60_000,
		// The first model turn went out long ago too — the wedge ages from THIS stamp (startup is exempt).
		firstTurnSentAt: NOW - DEFAULT_ZERO_TOKEN_WEDGE_MS - 60_000,
		heartbeatStatus: "healthy",
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		...overrides,
	} as RuntimeTaskSessionSummary;
}

describe("listZeroTokenWedgedSessions", () => {
	it("flags the production start shape once its optimistic heartbeat expires without a first token", () => {
		const findings = listZeroTokenWedgedSessions([summary()], NOW);
		expect(findings).toHaveLength(1);
		expect(findings[0]?.taskId).toBe("task-1");
		expect(findings[0]?.ageMs).toBeGreaterThan(DEFAULT_ZERO_TOKEN_WEDGE_MS);
		expect(findings[0]?.reason).toContain("without a first token");
	});

	it("leaves a session under the bound alone (a slow low-power prefill is legitimate)", () => {
		const young = summary({
			startedAt: NOW - DEFAULT_ZERO_TOKEN_WEDGE_MS + 30_000,
			firstTurnSentAt: NOW - DEFAULT_ZERO_TOKEN_WEDGE_MS + 30_000,
		});
		expect(listZeroTokenWedgedSessions([young], NOW)).toHaveLength(0);
	});

	it("leaves a session with ANY token history to the heartbeat machinery", () => {
		expect(listZeroTokenWedgedSessions([summary({ lastTokenAt: NOW - 20 * 60_000 })], NOW)).toHaveLength(0);
	});

	it("leaves a recent pre-token heartbeat alone (a slow first token is still making lifecycle progress)", () => {
		expect(listZeroTokenWedgedSessions([summary({ lastHeartbeatAt: NOW - 60_000 })], NOW)).toHaveLength(0);
	});

	it("does not let a stale/lost label permanently exempt a still-running token-less session", () => {
		expect(listZeroTokenWedgedSessions([summary({ heartbeatStatus: "stale" })], NOW)).toHaveLength(1);
		expect(listZeroTokenWedgedSessions([summary({ heartbeatStatus: "lost" })], NOW)).toHaveLength(1);
		expect(
			listZeroTokenWedgedSessions([summary({ heartbeatStatus: "stale", lastHeartbeatAt: NOW - 1_000 })], NOW),
		).toHaveLength(0);
	});

	it("skips non-running and paused sessions", () => {
		expect(listZeroTokenWedgedSessions([summary({ state: "queued" })], NOW)).toHaveLength(0);
		expect(listZeroTokenWedgedSessions([summary({ state: "interrupted" })], NOW)).toHaveLength(0);
		expect(listZeroTokenWedgedSessions([summary({ paused: true })], NOW)).toHaveLength(0);
	});

	it("skips a session without a start stamp (cannot be aged)", () => {
		expect(listZeroTokenWedgedSessions([summary({ startedAt: null })], NOW)).toHaveLength(0);
	});

	it("skips a session whose first turn has not been issued yet (startup is not a wedged request)", () => {
		// Live 2026-09-02 (zero-token-self-heal RED): worktree/sandbox/admission prep exceeded a tight bound and
		// the watchdog killed healthy sessions MID-STARTUP, before any model request existed. No first send — no
		// wedge; wedged starts belong to the force-reclaim sweep.
		expect(listZeroTokenWedgedSessions([summary({ firstTurnSentAt: null })], NOW)).toHaveLength(0);
		expect(listZeroTokenWedgedSessions([summary({ firstTurnSentAt: undefined })], NOW)).toHaveLength(0);
	});

	it("ages from the first send, not the optimistic start (slow startup + fresh request is healthy)", () => {
		const slowStartup = summary({
			startedAt: NOW - 30 * 60_000, // optimistic stamp long ago
			lastHeartbeatAt: NOW - 1_000,
			firstTurnSentAt: NOW - 2_000, // request just went out
		});
		expect(listZeroTokenWedgedSessions([slowStartup], NOW)).toHaveLength(0);
	});

	it("honours a custom bound and rejects a nonsensical one", () => {
		const twoMinOld = summary({ startedAt: NOW - 2 * 60_000, firstTurnSentAt: NOW - 2 * 60_000 });
		expect(listZeroTokenWedgedSessions([twoMinOld], NOW, { wedgeAfterMs: 60_000 })).toHaveLength(1);
		// invalid bounds fall back to the (not yet exceeded) default
		expect(listZeroTokenWedgedSessions([twoMinOld], NOW, { wedgeAfterMs: -5 })).toHaveLength(0);
		expect(listZeroTokenWedgedSessions([twoMinOld], NOW, { wedgeAfterMs: Number.NaN })).toHaveLength(0);
	});

	it("reports every wedged session, not just the first (each holds capacity)", () => {
		const findings = listZeroTokenWedgedSessions(
			[summary({ taskId: "a" }), summary({ taskId: "b::review" }), summary({ taskId: "c", lastTokenAt: NOW })],
			NOW,
		);
		expect(findings.map((f) => f.taskId)).toEqual(["a", "b::review"]);
	});

	it("is total on malformed input", () => {
		// biome-ignore lint/suspicious/noExplicitAny: deliberately malformed
		expect(listZeroTokenWedgedSessions(null as any, NOW)).toEqual([]);
		expect(listZeroTokenWedgedSessions([summary()], Number.NaN)).toEqual([]);
	});
});

describe("decideZeroTokenWedgeAction (P0.BUSYWEDGE)", () => {
	const wedgeAfterMs = 15 * 60_000;

	it("waits while the model is busy processing the prompt, up to the hard cap", () => {
		expect(decideZeroTokenWedgeAction({ ageMs: 16 * 60_000, wedgeAfterMs, modelBusy: true })).toBe("wait_busy");
		expect(
			decideZeroTokenWedgeAction({
				ageMs: wedgeAfterMs * BUSY_WEDGE_HARD_CAP_MULTIPLIER - 1,
				wedgeAfterMs,
				modelBusy: true,
			}),
		).toBe("wait_busy");
		expect(
			decideZeroTokenWedgeAction({
				ageMs: wedgeAfterMs * BUSY_WEDGE_HARD_CAP_MULTIPLIER,
				wedgeAfterMs,
				modelBusy: true,
			}),
		).toBe("interrupt");
	});

	it("interrupts a token-less session whose model is idle (the historical behaviour)", () => {
		expect(decideZeroTokenWedgeAction({ ageMs: 16 * 60_000, wedgeAfterMs, modelBusy: false })).toBe("interrupt");
	});
});
