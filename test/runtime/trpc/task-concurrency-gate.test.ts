import { describe, expect, it } from "vitest";
import type { RuntimeTaskSessionState, RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import {
	countActiveProjectTaskSessions,
	createConcurrencyLimitStartError,
} from "../../../src/trpc/runtime-api/task-concurrency-gate";

// The gate only reads `taskId` + `state`; a minimal cast fixture is the seam (the rest of the summary is irrelevant here).
function summary(taskId: string, state: RuntimeTaskSessionState): RuntimeTaskSessionSummary {
	return { taskId, state } as unknown as RuntimeTaskSessionSummary;
}

describe("countActiveProjectTaskSessions", () => {
	it("returns 0 when there are no sessions", () => {
		expect(countActiveProjectTaskSessions([], "start")).toBe(0);
	});

	it("counts queued / running / awaiting_review sessions toward the limit", () => {
		const out = countActiveProjectTaskSessions(
			[summary("a", "queued"), summary("b", "running"), summary("c", "awaiting_review")],
			"start",
		);
		expect(out).toBe(3);
	});

	it("does NOT count idle / paused / failed / interrupted sessions", () => {
		// A paused (or finished/failed) task is not occupying a concurrency slot — only live work counts.
		const out = countActiveProjectTaskSessions(
			[summary("a", "idle"), summary("b", "paused"), summary("c", "failed"), summary("d", "interrupted")],
			"start",
		);
		expect(out).toBe(0);
	});

	it("excludes the task being started (so it never blocks itself)", () => {
		const out = countActiveProjectTaskSessions([summary("self", "running"), summary("other", "running")], "self");
		expect(out).toBe(1);
	});

	it("excludes the home-agent session even when it is running", () => {
		const out = countActiveProjectTaskSessions(
			[summary("__home_agent__:ws1:nklein", "running"), summary("real", "running")],
			"start",
		);
		expect(out).toBe(1);
	});

	it("counts each task id once even if it appears in multiple summaries", () => {
		const out = countActiveProjectTaskSessions(
			[summary("dup", "running"), summary("dup", "awaiting_review")],
			"start",
		);
		expect(out).toBe(1);
	});

	it("combines the rules: only distinct active, non-home, non-self tasks count", () => {
		const out = countActiveProjectTaskSessions(
			[
				summary("self", "running"), // excluded: starting task
				summary("__home_agent__:ws1:nklein", "running"), // excluded: home agent
				summary("p", "paused"), // excluded: not active
				summary("x", "queued"), // counts
				summary("y", "running"), // counts
				summary("y", "awaiting_review"), // duplicate of y → still one
			],
			"self",
		);
		expect(out).toBe(2);
	});
});

describe("createConcurrencyLimitStartError", () => {
	it("names the configured limit and explains the remedy", () => {
		const message = createConcurrencyLimitStartError(3);
		expect(message).toContain("3");
		expect(message.toLowerCase()).toContain("limit reached");
	});
});
