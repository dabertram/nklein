import { describe, expect, it } from "vitest";
import {
	type AgentActivityEntry,
	accumulateSessionActivity,
	accumulateTeamProgress,
} from "@/runtime/agent-activity-timeline";

function summary(activityText: string | null, lastHookAt: number, toolName: string | null = null) {
	return {
		latestHookActivity: activityText
			? {
					activityText,
					toolName,
					toolInputSummary: null,
					finalMessage: null,
					hookEventName: "tool",
					notificationType: null,
					source: "cline-sdk",
				}
			: null,
		lastHookAt,
		updatedAt: lastHookAt,
		state: "running" as const,
	};
}

describe("accumulateSessionActivity", () => {
	it("appends new activities and dedupes repeats", () => {
		let timeline: AgentActivityEntry[] = [];
		timeline = accumulateSessionActivity(timeline, summary("Reading files", 1, "read_files"));
		timeline = accumulateSessionActivity(timeline, summary("Reading files", 1, "read_files")); // dup
		timeline = accumulateSessionActivity(timeline, summary("Editing file", 2, "edit_file"));
		expect(timeline.map((e) => e.text)).toEqual(["Reading files", "Editing file"]);
		expect(timeline[0]?.kind).toBe("tool");
		expect(timeline[1]?.toolName).toBe("edit_file");
	});

	it("ignores empty activity and classifies tool vs status", () => {
		let timeline: AgentActivityEntry[] = [];
		timeline = accumulateSessionActivity(timeline, summary(null, 1));
		expect(timeline).toHaveLength(0);
		timeline = accumulateSessionActivity(timeline, summary("Thinking", 1, null));
		expect(timeline[0]?.kind).toBe("status");
	});

	it("caps the timeline length", () => {
		let timeline: AgentActivityEntry[] = [];
		for (let i = 0; i < 10; i += 1) {
			timeline = accumulateSessionActivity(timeline, summary(`step ${i}`, i, "tool"), 5);
		}
		expect(timeline).toHaveLength(5);
		expect(timeline.at(-1)?.text).toBe("step 9");
	});
});

describe("accumulateTeamProgress", () => {
	it("merges progress events chronologically and dedupes", () => {
		const events = [
			{
				taskId: "t",
				message: "started",
				agentId: "a",
				role: "worker",
				runId: "r",
				status: "running",
				eventType: "x",
				createdAt: 2,
			},
			{
				taskId: "t",
				message: "planned",
				agentId: "a",
				role: "worker",
				runId: "r",
				status: "running",
				eventType: "x",
				createdAt: 1,
			},
		] as never[];
		const timeline = accumulateTeamProgress([], events);
		expect(timeline.map((e) => e.text)).toEqual(["planned", "started"]);
		expect(accumulateTeamProgress(timeline, events)).toHaveLength(2); // idempotent
	});
});
