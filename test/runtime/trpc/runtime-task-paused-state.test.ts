import { describe, expect, it } from "vitest";

import type { RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import { withTaskPausedState } from "../../../src/trpc/runtime-task-paused-state";

const summary = (taskId: string): RuntimeTaskSessionSummary =>
	({ taskId, state: "running" }) as unknown as RuntimeTaskSessionSummary;

describe("withTaskPausedState", () => {
	it("returns null for a null summary", () => {
		expect(withTaskPausedState(null, new Set(["t1"]))).toBeNull();
	});

	it("stamps paused:true when the task id is in the paused set, false otherwise", () => {
		expect(withTaskPausedState(summary("t1"), new Set(["t1", "t2"]))?.paused).toBe(true);
		expect(withTaskPausedState(summary("t3"), new Set(["t1"]))?.paused).toBe(false);
		expect(withTaskPausedState(summary("t1"), new Set())?.paused).toBe(false);
	});

	it("preserves the rest of the summary and does not mutate the input", () => {
		const input = summary("t1");
		const result = withTaskPausedState(input, new Set(["t1"]));
		expect(result?.taskId).toBe("t1");
		expect("paused" in input).toBe(false);
	});
});
