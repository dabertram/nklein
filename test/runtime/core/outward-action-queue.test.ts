import { describe, expect, it } from "vitest";
import {
	type QueuedOutwardAction,
	redactArgsSummary,
	summarizeOutwardActionQueue,
} from "../../../src/core/outward-action-queue";

const action = (over: Partial<QueuedOutwardAction>): QueuedOutwardAction => ({
	id: "id1",
	toolName: "issues__post_comment",
	target: "issue-7",
	argsSummary: 'body="hi"',
	reason: "outward action needs approval",
	status: "pending",
	at: 1,
	...over,
});

describe("redactArgsSummary", () => {
	it("summarizes object args as key=value with short scalar previews", () => {
		expect(redactArgsSummary({ issue: 7, body: "hello" })).toBe('issue=7, body="hello"');
	});

	it("redacts a credential-shaped value so it is never persisted", () => {
		const summary = redactArgsSummary({ token: "ghp_0123456789abcdefghijABCDEFGHIJ", issue: 3 });
		expect(summary).not.toContain("ghp_0123456789");
		expect(summary).toContain("[redacted]");
		expect(summary).toContain("issue=3");
	});

	it("handles strings, null, and non-serializable-ish input without throwing", () => {
		expect(redactArgsSummary("plain")).toBe("plain");
		expect(redactArgsSummary(null)).toBe("(no args)");
		expect(redactArgsSummary(42)).toBe("42");
	});

	it("bounds the overall summary length", () => {
		// A long, non-credential-shaped raw string arg (spaces break the 24+ alnum run so it isn't redacted).
		const summary = redactArgsSummary("word ".repeat(200));
		expect(summary.length).toBeLessThanOrEqual(301); // 300 + the ellipsis
		expect(summary.endsWith("…")).toBe(true);
	});
});

describe("summarizeOutwardActionQueue", () => {
	it("counts by status and lists pending tools worst-first", () => {
		const summary = summarizeOutwardActionQueue([
			action({ id: "a", toolName: "issues__post_comment", status: "pending" }),
			action({ id: "b", toolName: "issues__post_comment", status: "pending" }),
			action({ id: "c", toolName: "pr__create", status: "pending" }),
			action({ id: "d", toolName: "pr__create", status: "approved" }),
			action({ id: "e", toolName: "pr__create", status: "rejected" }),
		]);
		expect(summary).toMatchObject({ total: 5, pending: 3, approved: 1, rejected: 1 });
		expect(summary.pendingByTool).toEqual([
			{ toolName: "issues__post_comment", pending: 2 },
			{ toolName: "pr__create", pending: 1 },
		]);
	});

	it("is all-zero for an empty queue", () => {
		expect(summarizeOutwardActionQueue([])).toEqual({
			total: 0,
			pending: 0,
			approved: 0,
			rejected: 0,
			pendingByTool: [],
		});
	});
});
