import { describe, expect, it } from "vitest";
import type { RuntimeTaskHookActivity, RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import { isChatOnlyDecompositionActivity } from "../../../src/nklein-agent/decomposition-stall-nudger";

function activity(over: Partial<RuntimeTaskHookActivity> = {}): RuntimeTaskHookActivity {
	return {
		activityText: null,
		toolName: null,
		toolInputSummary: null,
		finalMessage: null,
		hookEventName: "assistant_delta",
		notificationType: null,
		source: "nklein-sdk",
		...over,
	};
}

function summary(latestHookActivity: RuntimeTaskHookActivity | null): RuntimeTaskSessionSummary {
	return {
		taskId: "t1",
		state: "running",
		agentId: "nklein",
		workspacePath: null,
		pid: null,
		startedAt: null,
		updatedAt: 0,
		lastOutputAt: null,
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity,
	};
}

describe("isChatOnlyDecompositionActivity", () => {
	it("flags a running assistant delta that narrates a plan instead of calling the tool", () => {
		expect(
			isChatOnlyDecompositionActivity(
				summary(activity({ activityText: "Based on my analysis, the task graph is..." })),
			),
		).toBe(true);
		expect(
			isChatOnlyDecompositionActivity(summary(activity({ finalMessage: "Here is the implementation plan." }))),
		).toBe(true);
	});

	it("is false when the model is actually calling decompose_project", () => {
		expect(
			isChatOnlyDecompositionActivity(
				summary(activity({ toolName: "decompose_project", activityText: "task graph" })),
			),
		).toBe(false);
	});

	it("is false for the wrong source, the wrong hook event, or no matching prose", () => {
		expect(
			isChatOnlyDecompositionActivity(summary(activity({ source: "terminal", activityText: "task graph" }))),
		).toBe(false);
		expect(
			isChatOnlyDecompositionActivity(summary(activity({ hookEventName: "tool_call", activityText: "task graph" }))),
		).toBe(false);
		expect(isChatOnlyDecompositionActivity(summary(activity({ activityText: "just some normal output" })))).toBe(
			false,
		);
	});

	it("is false when there is no activity", () => {
		expect(isChatOnlyDecompositionActivity(summary(null))).toBe(false);
	});
});
