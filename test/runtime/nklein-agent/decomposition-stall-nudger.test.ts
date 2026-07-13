import { describe, expect, it } from "vitest";
import type { RuntimeTaskHookActivity, RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import {
	DecompositionStallNudger,
	isChatOnlyDecompositionActivity,
	isDecompositionProgressTool,
} from "../../../src/nklein-agent/decomposition-stall-nudger";

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

	it("flags the driver's actual decompose-narration phrasings (2026-06-29 live C1 finding)", () => {
		// These ran to the deadline WITHOUT a decompose call because the old pattern missed them.
		for (const text of [
			"The spec is small: a local habit tracker with CRUD, check-ins, streaks. Let me decompose this into cards.",
			"Good — I have a clear picture of the spec and current skeleton codebase. Let me decompose this into dependency-ordered cards.",
		]) {
			expect(isChatOnlyDecompositionActivity(summary(activity({ finalMessage: text })))).toBe(true);
		}
	});

	it("does NOT flag ordinary implementation prose (no false positive)", () => {
		for (const text of [
			"I read the file and edited storage.ts to add a function.",
			"Running the tests now to verify the change.",
		]) {
			expect(isChatOnlyDecompositionActivity(summary(activity({ activityText: text })))).toBe(false);
		}
	});

	it("is false when the model is actually calling decompose_project", () => {
		expect(
			isChatOnlyDecompositionActivity(
				summary(activity({ toolName: "decompose_project", activityText: "task graph" })),
			),
		).toBe(false);
	});

	it("is false while the model drives the F1.7 incremental construction (add_task/add_dependency)", () => {
		for (const toolName of ["add_task", "add_dependency", " Add_Task "]) {
			expect(isChatOnlyDecompositionActivity(summary(activity({ toolName, activityText: "task graph" })))).toBe(
				false,
			);
		}
		expect(isDecompositionProgressTool("decompose_project")).toBe(true);
		expect(isDecompositionProgressTool("read_files")).toBe(false);
		expect(isDecompositionProgressTool(null)).toBe(false);
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

describe("DecompositionStallNudger.maybeContinueStalledDecomposition (#30 turn-end path)", () => {
	function makeNudger(over: { finalMessage: string; toolName: string | null }) {
		const sent: string[] = [];
		const observed: Array<Record<string, string | null>> = [];
		const stalledSummary: RuntimeTaskSessionSummary = {
			...summary(
				activity({
					hookEventName: "agent_end",
					toolName: over.toolName,
					finalMessage: over.finalMessage,
				}),
			),
			state: "awaiting_review",
			reviewReason: "hook",
		};
		const nudger = new DecompositionStallNudger({
			isExplicitDecompositionTask: () => true,
			getTaskSummary: () => stalledSummary,
			resolveProviderId: () => "lmstudio",
			resolveModelId: () => "gptoss120-m5",
			resolveWorkspacePath: () => null,
			recordObservation: (params) => {
				observed.push(params.metadata);
			},
			cancelTaskTurn: async () => null,
			sendTaskSessionInput: async (_taskId, text) => {
				sent.push(text);
				return null;
			},
		});
		return { nudger, sent, observed };
	}

	it("run31 regression: re-prompts a text-only decomposition final even though update_focus_chain ran (rejected)", async () => {
		const decompositionAsText = '{ "slug": "x", "tasks": [{"id":"t1"}], "minimumTaskCount": 10 }';
		const { nudger, sent, observed } = makeNudger({
			finalMessage: decompositionAsText,
			toolName: "update_focus_chain",
		});
		nudger.maybeContinueStalledDecomposition("t1");
		await new Promise((resolve) => setImmediate(resolve));
		expect(sent).toHaveLength(1);
		expect(sent[0]).toContain("exactly that JSON");
		expect(observed[0]?.finalLooksLikeDecompositionJson).toBe("true");
	});

	it("keeps the generic decompose re-prompt when the final text is not decomposition JSON", async () => {
		const { nudger, sent } = makeNudger({ finalMessage: "I believe the plan is solid.", toolName: null });
		nudger.maybeContinueStalledDecomposition("t1");
		await new Promise((resolve) => setImmediate(resolve));
		expect(sent).toHaveLength(1);
		expect(sent[0]).toContain("decompose_project");
		expect(sent[0]).not.toContain("exactly that JSON");
	});
});
