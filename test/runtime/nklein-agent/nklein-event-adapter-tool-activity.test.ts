import { describe, expect, it } from "vitest";
import {
	getRetainedNKleinToolActivity,
	isRecoverableToolCallFailure,
	isReviewableAbortedToolCompletion,
} from "../../../src/nklein-agent/nklein-event-adapter-tool-activity";
import type { NKleinTaskSessionEntry } from "../../../src/nklein-agent/nklein-session-state";

const entryWithActivity = (activity: Record<string, unknown> | null): NKleinTaskSessionEntry =>
	({ summary: { latestHookActivity: activity } }) as unknown as NKleinTaskSessionEntry;

describe("getRetainedNKleinToolActivity (§5.U extraction)", () => {
	it("returns the tool name + input summary from an SDK hook activity", () => {
		expect(
			getRetainedNKleinToolActivity(
				entryWithActivity({ source: "nklein-sdk", toolName: "write_file", toolInputSummary: "path=a.ts" }),
			),
		).toEqual({ toolName: "write_file", toolInputSummary: "path=a.ts" });
	});

	it("defaults the input summary to null when absent", () => {
		expect(getRetainedNKleinToolActivity(entryWithActivity({ source: "nklein-sdk", toolName: "edit" }))).toEqual({
			toolName: "edit",
			toolInputSummary: null,
		});
	});

	it("returns nulls when there is no SDK tool activity", () => {
		expect(getRetainedNKleinToolActivity(entryWithActivity(null))).toEqual({
			toolName: null,
			toolInputSummary: null,
		});
		expect(getRetainedNKleinToolActivity(entryWithActivity({ source: "other", toolName: "write_file" }))).toEqual({
			toolName: null,
			toolInputSummary: null,
		});
		expect(getRetainedNKleinToolActivity(entryWithActivity({ source: "nklein-sdk" }))).toEqual({
			toolName: null,
			toolInputSummary: null,
		});
	});
});

describe("isReviewableAbortedToolCompletion (§5.U extraction)", () => {
	const reviewable = (toolName: string) =>
		entryWithActivity({ source: "nklein-sdk", hookEventName: "tool_result", toolName });

	it("is true for a completed mutating tool result", () => {
		expect(isReviewableAbortedToolCompletion(reviewable("write_file"))).toBe(true);
		expect(isReviewableAbortedToolCompletion(reviewable("EDIT"))).toBe(true); // case-insensitive
		expect(isReviewableAbortedToolCompletion(reviewable("run_command"))).toBe(true);
	});

	it("is false for a non-mutating tool", () => {
		expect(isReviewableAbortedToolCompletion(reviewable("read_file"))).toBe(false);
	});

	it("is false unless the hook event is a tool_result from the SDK", () => {
		expect(
			isReviewableAbortedToolCompletion(
				entryWithActivity({ source: "nklein-sdk", hookEventName: "assistant_delta", toolName: "write_file" }),
			),
		).toBe(false);
		expect(
			isReviewableAbortedToolCompletion(
				entryWithActivity({ source: "other", hookEventName: "tool_result", toolName: "write_file" }),
			),
		).toBe(false);
		expect(isReviewableAbortedToolCompletion(entryWithActivity(null))).toBe(false);
	});
});

describe("isRecoverableToolCallFailure (§5.U extraction)", () => {
	it("matches the SDK 'tool call(s) failed' marker", () => {
		expect(isRecoverableToolCallFailure("2 tool call(s) failed: bad schema")).toBe(true);
	});

	it("is false for unrelated or null messages", () => {
		expect(isRecoverableToolCallFailure("some other error")).toBe(false);
		expect(isRecoverableToolCallFailure(null)).toBe(false);
	});
});
