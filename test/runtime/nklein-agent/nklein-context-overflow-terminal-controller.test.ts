import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeTaskSessionSummary } from "../../../src/core/api-contract";

const { recordSelfObservation } = vi.hoisted(() => ({ recordSelfObservation: vi.fn() }));
vi.mock("../../../src/telemetry/self-observation-sink", () => ({ recordSelfObservation }));

import {
	buildContextOverflowRedrivePrompt,
	type ContextOverflowTerminalControllerDeps,
	createContextOverflowTerminalController,
	readContextOverflowErrorMessage,
} from "../../../src/nklein-agent/nklein-context-overflow-terminal-controller";

const OVERFLOW_500 =
	"Engine protocol predict stream returned an error: {code:500, message:'Context size has been exceeded'}";

function overflowSummary(over: Partial<RuntimeTaskSessionSummary> = {}): RuntimeTaskSessionSummary {
	return {
		taskId: "t1",
		state: "awaiting_review",
		reviewReason: "error",
		providerId: "lmstudio",
		modelId: "ornith-local-9b",
		warningMessage: OVERFLOW_500,
		...over,
	} as RuntimeTaskSessionSummary;
}

function deps(over: Partial<ContextOverflowTerminalControllerDeps> = {}): ContextOverflowTerminalControllerDeps {
	return {
		canCompactHistory: vi.fn(async () => true),
		redriveAfterOverflow: vi.fn(async () => undefined),
		failOverToNextModel: vi.fn(),
		noteStrategyApplied: vi.fn(),
		...over,
	};
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function recordedActions(): string[] {
	return recordSelfObservation.mock.calls.map((call) => String(call[0]?.metadata?.action));
}

beforeEach(() => {
	vi.unstubAllEnvs();
	recordSelfObservation.mockClear();
});

describe("createContextOverflowTerminalController", () => {
	it("claims an overflow error terminal and re-drives on the same model with the compaction prompt (default-on)", async () => {
		const d = deps();
		const controller = createContextOverflowTerminalController(d);
		expect(controller.maybeRecoverTerminalOverflow("t1", overflowSummary())).toBe(true);
		await flush();
		expect(d.canCompactHistory).toHaveBeenCalledWith("t1");
		expect(d.redriveAfterOverflow).toHaveBeenCalledTimes(1);
		expect(d.redriveAfterOverflow).toHaveBeenCalledWith("t1", OVERFLOW_500);
		expect(d.failOverToNextModel).not.toHaveBeenCalled();
		expect(d.noteStrategyApplied).toHaveBeenCalledWith("t1", "context_shrink");
		expect(recordSelfObservation).toHaveBeenCalledTimes(1);
		expect(recordSelfObservation.mock.calls[0]?.[0]).toMatchObject({
			signal: "custom",
			severity: "warning",
			taskId: "t1",
			providerId: "lmstudio",
			modelId: "ornith-local-9b",
			metadata: { category: "context_overflow_redrive", action: "compact_and_redrive", redrivesUsed: 1 },
		});
	});

	it("hands the SAME terminal to the model-failover leg when the history cannot be compacted", async () => {
		const d = deps({ canCompactHistory: vi.fn(async () => false) });
		const controller = createContextOverflowTerminalController(d);
		const summary = overflowSummary();
		expect(controller.maybeRecoverTerminalOverflow("t1", summary)).toBe(true);
		await flush();
		expect(d.redriveAfterOverflow).not.toHaveBeenCalled();
		expect(d.failOverToNextModel).toHaveBeenCalledWith("t1", summary);
		expect(d.noteStrategyApplied).not.toHaveBeenCalled();
		expect(recordedActions()).toEqual(["defer_to_model_failover"]);
	});

	it("spends at most two consecutive compaction re-drives, then defers; a healthy terminal resets the streak", async () => {
		const d = deps();
		const controller = createContextOverflowTerminalController(d);
		for (let round = 1; round <= 2; round += 1) {
			expect(controller.maybeRecoverTerminalOverflow("t1", overflowSummary())).toBe(true);
			await flush();
			expect(d.redriveAfterOverflow).toHaveBeenCalledTimes(round);
		}
		expect(controller.maybeRecoverTerminalOverflow("t1", overflowSummary())).toBe(true);
		await flush();
		expect(d.redriveAfterOverflow).toHaveBeenCalledTimes(2);
		expect(d.failOverToNextModel).toHaveBeenCalledTimes(1);
		expect(recordedActions()).toEqual(["compact_and_redrive", "compact_and_redrive", "defer_to_model_failover"]);

		// A healthy terminal (the compacted turn completed) ends the streak: the next overflow starts a fresh budget.
		expect(controller.maybeRecoverTerminalOverflow("t1", overflowSummary({ reviewReason: "hook" }))).toBe(false);
		expect(controller.maybeRecoverTerminalOverflow("t1", overflowSummary())).toBe(true);
		await flush();
		expect(d.redriveAfterOverflow).toHaveBeenCalledTimes(3);
		expect(d.failOverToNextModel).toHaveBeenCalledTimes(1);
	});

	it("does not claim non-overflow terminals — a healthy end, an attention park, a task-scoped error, a running card", async () => {
		const d = deps();
		const controller = createContextOverflowTerminalController(d);
		expect(controller.maybeRecoverTerminalOverflow("t1", overflowSummary({ reviewReason: "hook" }))).toBe(false);
		expect(controller.maybeRecoverTerminalOverflow("t1", overflowSummary({ reviewReason: "attention" }))).toBe(false);
		expect(
			controller.maybeRecoverTerminalOverflow("t1", overflowSummary({ warningMessage: "Docker bind mount failed" })),
		).toBe(false);
		expect(controller.maybeRecoverTerminalOverflow("t1", overflowSummary({ state: "running" }))).toBe(false);
		await flush();
		expect(d.canCompactHistory).not.toHaveBeenCalled();
		expect(d.redriveAfterOverflow).not.toHaveBeenCalled();
		expect(d.failOverToNextModel).not.toHaveBeenCalled();
		expect(recordSelfObservation).not.toHaveBeenCalled();
	});

	it("reads the overflow from the retained hook final message when the summary carries no warning", async () => {
		const d = deps();
		const controller = createContextOverflowTerminalController(d);
		const summary = overflowSummary({
			warningMessage: null,
			latestHookActivity: {
				activityText: `Agent error: ${OVERFLOW_500}`,
				toolName: null,
				toolInputSummary: null,
				finalMessage: OVERFLOW_500,
				hookEventName: "agent_error",
				notificationType: null,
				source: "nklein-sdk",
			},
		});
		expect(readContextOverflowErrorMessage(summary)).toBe(OVERFLOW_500);
		expect(controller.maybeRecoverTerminalOverflow("t1", summary)).toBe(true);
		await flush();
		expect(d.redriveAfterOverflow).toHaveBeenCalledWith("t1", OVERFLOW_500);
	});

	it("sees through a REWRITTEN summary warning to the raw engine string on the hook activity", async () => {
		// `resolveAgentErrorWarning` (event adapter, run-failed arm) replaces the raw error with the local-model
		// reload guidance when it matches `isLocalModelRuntimeUnavailableError`. Reading only `warningMessage` would
		// therefore lose the overflow wording on exactly the arm this controller lives on.
		const d = deps();
		const controller = createContextOverflowTerminalController(d);
		const summary = overflowSummary({
			warningMessage:
				'Local model "ornith-local-9b" on its endpoint became unavailable mid-run (crashed or unloaded).',
			latestHookActivity: {
				activityText: `Agent error: ${OVERFLOW_500}`,
				toolName: null,
				toolInputSummary: null,
				finalMessage: OVERFLOW_500,
				hookEventName: "agent_error",
				notificationType: null,
				source: "nklein-sdk",
			},
		});
		expect(readContextOverflowErrorMessage(summary)).toBe(OVERFLOW_500);
		expect(controller.maybeRecoverTerminalOverflow("t1", summary)).toBe(true);
		await flush();
		expect(d.redriveAfterOverflow).toHaveBeenCalledWith("t1", OVERFLOW_500);
	});

	it("returns null overflow text when neither the warning nor the final message is an overflow", () => {
		expect(readContextOverflowErrorMessage(overflowSummary({ warningMessage: "Docker bind mount failed" }))).toBe(
			null,
		);
		expect(readContextOverflowErrorMessage(overflowSummary({ warningMessage: null }))).toBe(null);
	});

	it("is a kill switch: NKLEIN_CONTEXT_OVERFLOW_REDRIVE=off restores the pre-fix terminal handling", async () => {
		vi.stubEnv("NKLEIN_CONTEXT_OVERFLOW_REDRIVE", "off");
		const d = deps();
		const controller = createContextOverflowTerminalController(d);
		expect(controller.maybeRecoverTerminalOverflow("t1", overflowSummary())).toBe(false);
		await flush();
		expect(d.redriveAfterOverflow).not.toHaveBeenCalled();
		expect(d.failOverToNextModel).not.toHaveBeenCalled();
	});

	it("leaves derived (harness-owned) sessions alone — the merge/review brackets own their bounded lifecycle", async () => {
		const d = deps();
		const controller = createContextOverflowTerminalController(d);
		expect(controller.maybeRecoverTerminalOverflow("t1::merge", overflowSummary({ taskId: "t1::merge" }))).toBe(
			false,
		);
		expect(controller.maybeRecoverTerminalOverflow("t1::review", overflowSummary({ taskId: "t1::review" }))).toBe(
			false,
		);
		await flush();
		expect(d.redriveAfterOverflow).not.toHaveBeenCalled();
		expect(d.failOverToNextModel).not.toHaveBeenCalled();
	});

	it("fails closed: a rejected re-drive is recorded and the card stays parked (no failover, no throw)", async () => {
		const d = deps({ redriveAfterOverflow: vi.fn(async () => Promise.reject(new Error("admission gate closed"))) });
		const controller = createContextOverflowTerminalController(d);
		expect(controller.maybeRecoverTerminalOverflow("t1", overflowSummary())).toBe(true);
		await flush();
		expect(d.failOverToNextModel).not.toHaveBeenCalled();
		const outcomes = recordSelfObservation.mock.calls.map((call) => String(call[0]?.metadata?.outcome));
		expect(outcomes[0]).toBe("redriving");
		expect(outcomes[1]).toContain("redrive failed: Error: admission gate closed");
	});

	it("claims one transition at a time per task (a duplicate terminal while the chain is pending is ignored)", async () => {
		let release: (compactable: boolean) => void = () => {};
		const gate = new Promise<boolean>((resolve) => {
			release = resolve;
		});
		const d = deps({ canCompactHistory: vi.fn(() => gate) });
		const controller = createContextOverflowTerminalController(d);
		expect(controller.maybeRecoverTerminalOverflow("t1", overflowSummary())).toBe(true);
		expect(controller.maybeRecoverTerminalOverflow("t1", overflowSummary())).toBe(false);
		release(true);
		await flush();
		expect(d.redriveAfterOverflow).toHaveBeenCalledTimes(1);
	});

	it("forgetTask drops the per-task streak", async () => {
		const d = deps();
		const controller = createContextOverflowTerminalController(d);
		for (let round = 1; round <= 2; round += 1) {
			controller.maybeRecoverTerminalOverflow("t1", overflowSummary());
			await flush();
		}
		controller.forgetTask("t1");
		expect(controller.maybeRecoverTerminalOverflow("t1", overflowSummary())).toBe(true);
		await flush();
		expect(d.redriveAfterOverflow).toHaveBeenCalledTimes(3);
		expect(d.failOverToNextModel).not.toHaveBeenCalled();
	});
});

describe("buildContextOverflowRedrivePrompt", () => {
	it("names the overflow (bounded) and tells the model the history was compacted", () => {
		const prompt = buildContextOverflowRedrivePrompt(`${OVERFLOW_500}${"x".repeat(500)}`);
		expect(prompt).toContain("overflowed the model's context window");
		expect(prompt).toContain("Context size has been exceeded");
		expect(prompt).toContain("compacted the earlier conversation history");
		expect(prompt.length).toBeLessThan(500);
	});
});
