import { describe, expect, it } from "vitest";
import { DEFAULT_ZERO_TOKEN_WEDGE_MS, listZeroTokenWedgedSessions } from "../../../src/core/session-turn-liveness";
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
		const young = summary({ startedAt: NOW - DEFAULT_ZERO_TOKEN_WEDGE_MS + 30_000 });
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

	it("honours a custom bound and rejects a nonsensical one", () => {
		const twoMinOld = summary({ startedAt: NOW - 2 * 60_000 });
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
