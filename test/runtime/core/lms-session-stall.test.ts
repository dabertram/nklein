import { describe, expect, it } from "vitest";
import {
	evaluateQuietRunningSessionStall,
	evaluateWorkspaceSessionProgress,
} from "../../../src/core/lms-session-stall";

describe("evaluateWorkspaceSessionProgress", () => {
	it("does not treat heartbeat-only updatedAt advances as verifier progress", () => {
		const verdict = evaluateWorkspaceSessionProgress({
			sessions: [
				{
					id: "card-1::review",
					state: "running",
					lastHookAt: null,
					lastOutputAt: null,
					updatedAt: 30_000,
				},
			],
			previousStatesBySessionId: new Map([["card-1::review", "running"]]),
			previousActivityStamp: 10_000,
		});

		expect(verdict.progressed).toBe(false);
		expect(verdict.activityStamp).toBe(10_000);
	});

	it("treats hook/output activity as verifier progress", () => {
		const verdict = evaluateWorkspaceSessionProgress({
			sessions: [
				{
					id: "card-1::review",
					state: "running",
					lastHookAt: 12_000,
					lastOutputAt: null,
					updatedAt: 30_000,
				},
			],
			previousStatesBySessionId: new Map([["card-1::review", "running"]]),
			previousActivityStamp: 10_000,
		});

		expect(verdict.progressed).toBe(true);
		expect(verdict.activityStamp).toBe(12_000);
		expect(verdict.reasons).toContain("activity:card-1::review");
	});

	it("treats new sessions and state transitions as verifier progress", () => {
		const first = evaluateWorkspaceSessionProgress({
			sessions: [{ id: "card-1", state: "queued", updatedAt: 1 }],
			previousStatesBySessionId: new Map(),
			previousActivityStamp: 0,
		});
		const second = evaluateWorkspaceSessionProgress({
			sessions: [{ id: "card-1", state: "running", updatedAt: 2 }],
			previousStatesBySessionId: first.statesBySessionId,
			previousActivityStamp: first.activityStamp,
		});

		expect(first.progressed).toBe(true);
		expect(first.reasons).toContain("new:card-1:queued");
		expect(second.progressed).toBe(true);
		expect(second.reasons).toContain("state:card-1:queued->running");
	});
});

describe("evaluateQuietRunningSessionStall", () => {
	it("waits when there are no running sessions", () => {
		expect(
			evaluateQuietRunningSessionStall({
				runningSessions: [],
				lmsModels: [],
				quietMs: 120_000,
				idleStallMs: 90_000,
				activeStallMs: 600_000,
			}),
		).toMatchObject({ action: "wait" });
	});

	it("aborts a quiet running session when LM Studio reports its model idle", () => {
		expect(
			evaluateQuietRunningSessionStall({
				runningSessions: [{ id: "card-1", modelId: "coder-gpu" }],
				lmsModels: [{ identifier: "coder-gpu", status: "idle", queued: 0, machineId: "m4mini" }],
				quietMs: 91_000,
				idleStallMs: 90_000,
				activeStallMs: 600_000,
			}),
		).toMatchObject({ action: "abort", reasonCode: "idle_running_session" });
	});

	it("waits on active LM Studio work until the active quiet window is exceeded", () => {
		expect(
			evaluateQuietRunningSessionStall({
				runningSessions: [{ id: "card-1", modelId: "qwopus" }],
				lmsModels: [{ identifier: "qwopus", status: "processingPrompt", queued: 0 }],
				quietMs: 300_000,
				idleStallMs: 90_000,
				activeStallMs: 600_000,
			}),
		).toMatchObject({ action: "wait" });
	});

	it("aborts active LM Studio work after the bounded active quiet window", () => {
		expect(
			evaluateQuietRunningSessionStall({
				runningSessions: [{ id: "card-1", modelId: "qwopus" }],
				lmsModels: [{ identifier: "qwopus", status: "processingPrompt", queued: 0 }],
				quietMs: 601_000,
				idleStallMs: 90_000,
				activeStallMs: 600_000,
			}),
		).toMatchObject({ action: "abort", reasonCode: "active_running_session_timeout" });
	});

	it("aborts unobservable running sessions after the bounded active quiet window", () => {
		expect(
			evaluateQuietRunningSessionStall({
				runningSessions: [{ id: "card-1", modelId: "missing-model" }],
				lmsModels: [{ identifier: "other-model", status: "idle", queued: 0 }],
				quietMs: 601_000,
				idleStallMs: 90_000,
				activeStallMs: 600_000,
			}),
		).toMatchObject({ action: "abort", reasonCode: "unobservable_running_session_timeout" });
	});

	it("matches a running session by model key when the LM Studio identifier is an alias", () => {
		const verdict = evaluateQuietRunningSessionStall({
			runningSessions: [{ id: "card-1", modelId: "qwen/qwen3-8b" }],
			lmsModels: [{ identifier: "qwen3-local", modelKey: "qwen/qwen3-8b", status: "idle", queued: 0 }],
			quietMs: 91_000,
			idleStallMs: 90_000,
			activeStallMs: 600_000,
		});

		expect(verdict).toMatchObject({ action: "abort", reasonCode: "idle_running_session" });
		expect(verdict.lmsSummary).toContain("qwen3-local");
	});
});
