import { describe, expect, it } from "vitest";

import type { AutonomousChatAgentResult } from "../../../src/chat/chat-autonomous-loop";
import type { RuntimeSwarmGuardrails } from "../../../src/core/api-contract";
import { createAutonomousChatRunController } from "../../../src/trpc/runtime-api/autonomous-chat-run";

const GUARDRAILS: RuntimeSwarmGuardrails = {
	maxAutonomousTurnsPerTask: 10,
	maxAutonomousWallTimeMs: 60_000,
	maxRepeatedNoDiffCheckpoints: 3,
	maxRepeatedToolCallsPerTask: 5,
};

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createAutonomousChatRunController", () => {
	it("starts a run in the background, then status reflects the result once it finishes", async () => {
		let resolveRun: (result: AutonomousChatAgentResult | null) => void = () => {};
		const runPromise = new Promise<AutonomousChatAgentResult | null>((resolve) => {
			resolveRun = resolve;
		});
		const controller = createAutonomousChatRunController({
			chatService: { runAutonomous: () => runPromise },
			resolveGuardrails: async () => GUARDRAILS,
		});

		const started = await controller.start({ sessionId: "s1", goal: "do it" });
		expect(started.started).toBe(true);
		expect(started.status.running).toBe(true);
		expect(controller.status({ sessionId: "s1" }).running).toBe(true);

		resolveRun({
			stopReason: "completed",
			turns: 2,
			finalText: "done",
			planProgress: { total: 2, done: 2 },
		});
		await flushMicrotasks();

		const status = controller.status({ sessionId: "s1" });
		expect(status.running).toBe(false);
		expect(status.stopReason).toBe("completed");
		expect(status.turns).toBe(2);
		expect(status.finalText).toBe("done");
		expect(status.planProgress).toEqual({ total: 2, done: 2 });
	});

	it("refuses to start a second run while one is active, returning the in-flight status", async () => {
		const controller = createAutonomousChatRunController({
			chatService: { runAutonomous: () => new Promise(() => {}) }, // never resolves → stays running
			resolveGuardrails: async () => GUARDRAILS,
		});
		await controller.start({ sessionId: "s1", goal: "first" });
		const second = await controller.start({ sessionId: "s1", goal: "second" });
		expect(second.started).toBe(false);
		expect(second.status.goal).toBe("first");
		expect(second.status.running).toBe(true);
	});

	it("records a failed run in finalText with a null stop reason", async () => {
		const controller = createAutonomousChatRunController({
			chatService: { runAutonomous: async () => Promise.reject(new Error("model exploded")) },
			resolveGuardrails: async () => GUARDRAILS,
		});
		await controller.start({ sessionId: "s1", goal: "do it" });
		await flushMicrotasks();
		const status = controller.status({ sessionId: "s1" });
		expect(status.running).toBe(false);
		expect(status.stopReason).toBeNull();
		expect(status.finalText).toMatch(/model exploded/);
	});

	it("returns idle status for an unknown session", () => {
		const controller = createAutonomousChatRunController({
			chatService: { runAutonomous: async () => null },
			resolveGuardrails: async () => GUARDRAILS,
		});
		expect(controller.status({ sessionId: "nope" })).toEqual({
			running: false,
			goal: null,
			stopReason: null,
			turns: 0,
			finalText: null,
			planProgress: { total: 0, done: 0 },
		});
	});
});
