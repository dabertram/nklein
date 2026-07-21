import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import { createModelFailoverController } from "../../../src/nklein-agent/nklein-model-failover-controller";

function errorSummary(over: Partial<RuntimeTaskSessionSummary> = {}): RuntimeTaskSessionSummary {
	return {
		taskId: "t1",
		state: "awaiting_review",
		reviewReason: "error",
		providerId: "lmstudio",
		modelId: "ministral",
		warningMessage: "Engine protocol predict request returned 500",
		...over,
	} as RuntimeTaskSessionSummary;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createModelFailoverController", () => {
	beforeEach(() => {
		vi.unstubAllEnvs();
	});

	it("re-drives the card on the best untried candidate with a modelId override (default-on)", async () => {
		const resend = vi.fn().mockResolvedValue(undefined);
		const noteStrategyApplied = vi.fn();
		const controller = createModelFailoverController({ resendTaskInput: resend, noteStrategyApplied });
		controller.setCandidates("t1", ["gemma", "ministral", "qwable"]);
		controller.maybeModelFailover("t1", errorSummary());
		await flush();
		expect(resend).toHaveBeenCalledTimes(1);
		const [taskId, text, mode, images, overrides] = resend.mock.calls[0] ?? [];
		expect(taskId).toBe("t1");
		expect(String(text)).toContain("model-side error");
		expect(mode).toBe("act");
		expect(images).toBeUndefined();
		expect(overrides).toMatchObject({ providerId: "lmstudio", modelId: "gemma" });
		expect(noteStrategyApplied).toHaveBeenCalledWith("t1", "cross_model_carry");
	});

	it("does nothing for a non-error terminal or a task/sandbox-scoped error", async () => {
		const resend = vi.fn().mockResolvedValue(undefined);
		const controller = createModelFailoverController({ resendTaskInput: resend });
		controller.setCandidates("t1", ["gemma"]);
		controller.maybeModelFailover("t1", errorSummary({ reviewReason: "attention" }));
		controller.maybeModelFailover("t1", errorSummary({ warningMessage: "Docker bind mount failed" }));
		await flush();
		expect(resend).not.toHaveBeenCalled();
	});

	it("re-drives repeated decomposition-validation exhaustion on another loaded architect before human fallback", async () => {
		const resend = vi.fn().mockResolvedValue(undefined);
		const resetDecompositionRecoveryBudget = vi.fn();
		const controller = createModelFailoverController({ resendTaskInput: resend, resetDecompositionRecoveryBudget });
		controller.setCandidates("t1", ["qwopus", "qwen", "gemma"]);
		controller.maybeModelFailover(
			"t1",
			errorSummary({
				reviewReason: "attention",
				modelId: "qwopus",
				warningMessage: "Sandbox MCP server Codebase Memory is OFF for this task: container headroom is too low.",
				latestHookActivity: {
					activityText:
						"!Klein paused this architect after 4 decomposition attempts that kept failing graph validation.",
					toolName: null,
					toolInputSummary: null,
					finalMessage:
						"!Klein paused this architect after 4 decomposition attempts that kept failing graph validation.",
					hookEventName: "guardrail",
					notificationType: "warning",
					source: "kanban",
				},
			}),
		);
		await flush();
		expect(resend).toHaveBeenCalledTimes(1);
		expect(resend.mock.calls[0]?.[1]).toContain("fresh architect on a different loaded model");
		expect(resend.mock.calls[0]?.[4]).toMatchObject({ providerId: "lmstudio", modelId: "qwen" });
		expect(resetDecompositionRecoveryBudget).toHaveBeenCalledWith("t1");
	});

	it("is disabled by the kill-switch", async () => {
		vi.stubEnv("NKLEIN_MODEL_FAILOVER", "off");
		const resend = vi.fn().mockResolvedValue(undefined);
		const controller = createModelFailoverController({ resendTaskInput: resend });
		controller.setCandidates("t1", ["gemma"]);
		controller.maybeModelFailover("t1", errorSummary());
		await flush();
		expect(resend).not.toHaveBeenCalled();
	});

	it("caps hops: after two failovers the third error parks (no further re-drive)", async () => {
		const resend = vi.fn().mockResolvedValue(undefined);
		const controller = createModelFailoverController({ resendTaskInput: resend });
		controller.setCandidates("t1", ["gemma", "qwable", "extra"]);
		controller.maybeModelFailover("t1", errorSummary()); // ministral → gemma
		await flush();
		controller.maybeModelFailover("t1", errorSummary({ modelId: "gemma" })); // gemma → qwable
		await flush();
		controller.maybeModelFailover("t1", errorSummary({ modelId: "qwable" })); // cap reached
		await flush();
		expect(resend).toHaveBeenCalledTimes(2);
		expect(resend.mock.calls[1]?.[4]).toMatchObject({ modelId: "qwable" });
	});

	it("does nothing without stashed candidates and forgets per-task state", async () => {
		const resend = vi.fn().mockResolvedValue(undefined);
		const controller = createModelFailoverController({ resendTaskInput: resend });
		controller.maybeModelFailover("t1", errorSummary());
		await flush();
		expect(resend).not.toHaveBeenCalled();
		controller.setCandidates("t1", ["gemma"]);
		controller.forgetTask("t1");
		controller.maybeModelFailover("t1", errorSummary());
		await flush();
		expect(resend).not.toHaveBeenCalled();
	});
});
