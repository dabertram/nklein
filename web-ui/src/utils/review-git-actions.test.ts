import { describe, expect, it } from "vitest";

import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import { getReviewGitActionChangeState, hasReviewGitActionChanges } from "@/utils/review-git-actions";

function createSummary(hookEventName: string | null): RuntimeTaskSessionSummary {
	return {
		taskId: "task-1",
		state: "awaiting_review",
		agentId: "nklein",
		workspacePath: "/repo",
		pid: null,
		startedAt: 1,
		updatedAt: 1,
		lastOutputAt: 1,
		reviewReason: "exit",
		exitCode: 0,
		lastHookAt: 1,
		latestHookActivity: hookEventName
			? {
					activityText: "Result patch captured",
					toolName: null,
					toolInputSummary: null,
					finalMessage: null,
					hookEventName,
					notificationType: null,
					source: "nklein",
				}
			: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
	};
}

describe("hasReviewGitActionChanges", () => {
	it("prefers explicit workspace changed-file counts", () => {
		expect(getReviewGitActionChangeState({ changedFiles: 1, summary: createSummary(null) })).toBe("dirty");
		expect(getReviewGitActionChangeState({ changedFiles: 0, summary: createSummary("sandbox_patch_captured") })).toBe(
			"clean",
		);
		expect(hasReviewGitActionChanges({ changedFiles: 1, summary: createSummary(null) })).toBe(true);
		expect(hasReviewGitActionChanges({ changedFiles: 0, summary: createSummary("sandbox_patch_captured") })).toBe(
			false,
		);
	});

	it("uses sandbox result patch activity when no workspace snapshot exists", () => {
		expect(
			getReviewGitActionChangeState({ changedFiles: undefined, summary: createSummary("sandbox_patch_captured") }),
		).toBe("dirty");
		expect(getReviewGitActionChangeState({ changedFiles: null, summary: createSummary("sandbox_patch_empty") })).toBe(
			"clean",
		);
		expect(getReviewGitActionChangeState({ changedFiles: undefined, summary: createSummary(null) })).toBe("unknown");
		expect(
			hasReviewGitActionChanges({ changedFiles: undefined, summary: createSummary("sandbox_patch_captured") }),
		).toBe(true);
		expect(hasReviewGitActionChanges({ changedFiles: null, summary: createSummary("sandbox_patch_empty") })).toBe(
			false,
		);
	});
});
