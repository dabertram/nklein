import { describe, expect, it } from "vitest";
import { evaluateQuietRunningSessionStall } from "../../../src/core/lms-session-stall";

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
