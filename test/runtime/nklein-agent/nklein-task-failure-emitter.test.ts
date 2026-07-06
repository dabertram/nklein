import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/telemetry/self-observation-sink", () => ({ recordSelfObservation: vi.fn() }));

import { createDefaultSummary, type NKleinTaskSessionEntry } from "../../../src/nklein-agent/nklein-session-state";
import {
	createTaskFailureEmitter,
	type TaskFailureEmitterDeps,
} from "../../../src/nklein-agent/nklein-task-failure-emitter";
import { recordSelfObservation } from "../../../src/telemetry/self-observation-sink";

function entry(): NKleinTaskSessionEntry {
	return {
		summary: createDefaultSummary("t1"),
		messages: [],
		activeAssistantMessageId: null,
		activeReasoningMessageId: null,
		toolMessageIdByToolCallId: new Map(),
		toolInputByToolCallId: new Map(),
	} as unknown as NKleinTaskSessionEntry;
}

function deps(over: Partial<TaskFailureEmitterDeps> = {}): TaskFailureEmitterDeps {
	return {
		clearRunTimeouts: vi.fn(),
		clearActiveToolFlag: vi.fn(),
		resolveProviderId: vi.fn(() => "ollama"),
		getModelId: vi.fn(() => "m1"),
		getEndpoint: vi.fn(() => "http://localhost:1234/v1"),
		getPreviousFailure: vi.fn(() => undefined),
		recordFailure: vi.fn(),
		emitMessage: vi.fn(),
		emitSummary: vi.fn(),
		...over,
	};
}

beforeEach(() => vi.clearAllMocks());

describe("createTaskFailureEmitter (§5.U extraction)", () => {
	it("a first generic failure clears run state, awaits review, and emits a message + summary + observation", () => {
		const d = deps();
		const e = entry();
		createTaskFailureEmitter(d).emit("t1", e, "start", new Error("boom"));

		expect(d.clearRunTimeouts).toHaveBeenCalledWith("t1");
		expect(d.clearActiveToolFlag).toHaveBeenCalledWith("t1");
		expect(d.recordFailure).toHaveBeenCalledWith("t1", { fingerprint: "start:boom", count: 1, parked: false });
		expect(d.emitMessage).toHaveBeenCalledTimes(1); // non-credit failure → user-facing system message
		const summary = (d.emitSummary as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(summary.state).toBe("awaiting_review");
		expect(summary.reviewReason).toBe("error");
		expect(recordSelfObservation).toHaveBeenCalledTimes(1);
	});

	it("parks (state=failed) once the same error reaches the consecutive-failure threshold", () => {
		const d = deps({ getPreviousFailure: () => ({ fingerprint: "start:boom", count: 2, parked: false }) });
		createTaskFailureEmitter(d).emit("t1", entry(), "start", new Error("boom"));

		expect(d.recordFailure).toHaveBeenCalledWith("t1", { fingerprint: "start:boom", count: 3, parked: true });
		const summary = (d.emitSummary as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(summary.state).toBe("failed");
	});

	it("no-ops (past clearing run state) when this exact error already parked the task", () => {
		const d = deps({ getPreviousFailure: () => ({ fingerprint: "start:boom", count: 3, parked: true }) });
		createTaskFailureEmitter(d).emit("t1", entry(), "start", new Error("boom"));

		// The early return still clears run state, but records / emits nothing (no duplicate park handling).
		expect(d.clearRunTimeouts).toHaveBeenCalledWith("t1");
		expect(d.recordFailure).not.toHaveBeenCalled();
		expect(d.emitMessage).not.toHaveBeenCalled();
		expect(d.emitSummary).not.toHaveBeenCalled();
		expect(recordSelfObservation).not.toHaveBeenCalled();
	});
});
