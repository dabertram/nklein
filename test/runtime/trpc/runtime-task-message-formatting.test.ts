import { describe, expect, it } from "vitest";

import { formatAcceptanceVerifyMessage, formatMergeMessage } from "../../../src/trpc/runtime-task-message-formatting";

describe("formatAcceptanceVerifyMessage", () => {
	it("reports a missing Acceptance line when not present", () => {
		expect(formatAcceptanceVerifyMessage({ present: false, passed: null, command: null, exitCode: null })).toBe(
			"No Acceptance check line was found on this card.",
		);
	});

	it("reports a pass with the command", () => {
		expect(formatAcceptanceVerifyMessage({ present: true, passed: true, command: "npm test", exitCode: 0 })).toBe(
			"Acceptance check passed: npm test.",
		);
	});

	it("falls back to 'command' when the command is null on a pass", () => {
		expect(formatAcceptanceVerifyMessage({ present: true, passed: true, command: null, exitCode: 0 })).toBe(
			"Acceptance check passed: command.",
		);
	});

	it("reports a failure with the exit code when present", () => {
		expect(formatAcceptanceVerifyMessage({ present: true, passed: false, command: "npm test", exitCode: 2 })).toBe(
			"Acceptance check failed with exit 2: npm test.",
		);
	});

	it("omits the exit-code clause on a failure when the exit code is null", () => {
		expect(formatAcceptanceVerifyMessage({ present: true, passed: false, command: "npm test", exitCode: null })).toBe(
			"Acceptance check failed: npm test.",
		);
	});
});

describe("formatMergeMessage", () => {
	it("prioritizes a conflict and lists the conflicted paths", () => {
		expect(
			formatMergeMessage({
				ok: false,
				mergedTaskIds: [],
				skippedTaskIds: [],
				conflict: { taskId: "t-1", conflictedPaths: ["a.ts", "b.ts"] },
			}),
		).toBe("Merge conflict while merging t-1. Conflicts: a.ts, b.ts.");
	});

	it("omits the conflicts clause when there are no conflicted paths", () => {
		expect(
			formatMergeMessage({
				ok: false,
				mergedTaskIds: [],
				skippedTaskIds: [],
				conflict: { taskId: "t-2", conflictedPaths: [] },
			}),
		).toBe("Merge conflict while merging t-2.");
	});

	it("reports a blocked merge with its reason (when there is no conflict)", () => {
		expect(
			formatMergeMessage({
				ok: false,
				mergedTaskIds: [],
				skippedTaskIds: [],
				blocked: { reason: "dirty worktree" },
			}),
		).toBe("Merge blocked: dirty worktree");
	});

	it("reports the merged/skipped tally on success", () => {
		expect(formatMergeMessage({ ok: true, mergedTaskIds: ["t-1", "t-2"], skippedTaskIds: ["t-3"] })).toBe(
			"Merged 2 task results; skipped 1.",
		);
	});
});
