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

describe("transition reason causality (N22b)", () => {
	// Live-found 2026-08-03: warningMessage is a PERSISTENT overlay riding every later patch, so using it as
	// a reason fallback stamped unrelated lane moves with stale advisory texts — one N21 forensics pass
	// initially read "Sandbox MCP server … withheld" as the cause of a card leaving review. reviewReason is
	// set alongside the state change it explains; a transition without one honestly has reason null.
	it("uses reviewReason as the reason when present", async () => {
		const events: AgentTransitionEvent[] = [];
		const record = createSessionTransitionRecorder(async (event) => {
			events.push(event);
		});
		record(scope, { ...summary("t1", "running") });
		record(scope, { ...summary("t1", "awaiting_review"), reviewReason: "hook" });
		await new Promise((resolve) => setImmediate(resolve));
		expect(events[1]?.reason).toBe("hook");
	});

	it("NEVER falls back to the persistent warningMessage — reason is null instead", async () => {
		const events: AgentTransitionEvent[] = [];
		const record = createSessionTransitionRecorder(async (event) => {
			events.push(event);
		});
		record(scope, { ...summary("t2", "running") });
		record(scope, {
			...summary("t2", "idle"),
			warningMessage: "Sandbox MCP server withheld — stale advisory that did NOT cause this move",
		} as RuntimeTaskSessionSummary);
		await new Promise((resolve) => setImmediate(resolve));
		expect(events[1]?.to).toBe("idle");
		expect(events[1]?.reason).toBeNull();
	});
});
