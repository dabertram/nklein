import { describe, expect, it } from "vitest";
import type { AgentTransitionEvent } from "../../../src/core/agent-attempt-ledger";
import type { RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import { createSessionTransitionRecorder } from "../../../src/server/nklein-runtime-terminal-telemetry";
import type { RuntimeTrpcWorkspaceScope } from "../../../src/trpc/app-router";

const scope = { workspaceId: "ws1", workspacePath: "/tmp/ws1" } as RuntimeTrpcWorkspaceScope;

function summary(taskId: string, state: RuntimeTaskSessionSummary["state"]): RuntimeTaskSessionSummary {
	return {
		taskId,
		state,
		agentId: "nklein",
		workspacePath: "/tmp/ws1",
		pid: null,
		startedAt: 1,
		updatedAt: 1,
		lastOutputAt: 1,
		reviewReason: null,
		exitCode: null,
		lastHookAt: 1,
		latestHookActivity: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
	} as RuntimeTaskSessionSummary;
}

describe("createSessionTransitionRecorder (§5.AF transition events from session state changes)", () => {
	it("records only CHANGES (queued→running→review), never same-state re-emissions", async () => {
		const events: AgentTransitionEvent[] = [];
		const record = createSessionTransitionRecorder(async (event) => {
			events.push(event);
		});
		record(scope, summary("t1", "queued"));
		record(scope, summary("t1", "running"));
		record(scope, summary("t1", "running")); // heartbeat re-emission — skipped
		record(scope, summary("t1", "awaiting_review"));
		await new Promise((resolve) => setImmediate(resolve));
		expect(events.map((event) => `${event.from ?? "∅"}→${event.to}`)).toEqual([
			"∅→queued",
			"queued→running",
			"running→awaiting_review",
		]);
		expect(events.every((event) => event.kind === "transition" && event.taskId === "t1")).toBe(true);
	});

	it("tracks tasks independently and survives an append failure silently", async () => {
		let failNext = true;
		const events: AgentTransitionEvent[] = [];
		const record = createSessionTransitionRecorder(async (event) => {
			if (failNext) {
				failNext = false;
				throw new Error("ledger down");
			}
			events.push(event);
		});
		record(scope, summary("a", "running")); // append fails — must not throw
		record(scope, summary("b", "running"));
		await new Promise((resolve) => setImmediate(resolve));
		expect(events.map((event) => event.taskId)).toEqual(["b"]);
	});
});
