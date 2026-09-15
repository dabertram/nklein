import { describe, expect, it } from "vitest";
import type { RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import { createDefaultSummary, type NKleinTaskSessionEntry } from "../../../src/nklein-agent/nklein-session-state";
import {
	detectRepeatedToolCallCycle,
	formatRepeatedToolCallParkMessage,
	getRepeatedToolCallLimit,
	NKLEIN_EXTRA_TOOL_REPEATED_CALL_PARK_THRESHOLD,
	RepeatedToolCallGuard,
} from "../../../src/nklein-agent/repeated-tool-call-guard";

describe("detectRepeatedToolCallCycle", () => {
	it("detects the live alternating-search loop after three exact periods", () => {
		expect(
			detectRepeatedToolCallCycle(["search:a", "search:b", "search:a", "search:b", "search:a", "search:b"]),
		).toEqual({
			cycleLength: 2,
			repetitions: 3,
		});
	});

	it("detects a three-step cycle but ignores consecutive repeats and incomplete periods", () => {
		expect(detectRepeatedToolCallCycle(["a", "b", "c", "a", "b", "c", "a", "b", "c"])).toEqual({
			cycleLength: 3,
			repetitions: 3,
		});
		expect(detectRepeatedToolCallCycle(["a", "a", "a", "a", "a", "a"])).toBeNull();
		expect(detectRepeatedToolCallCycle(["a", "b", "a", "b", "a"])).toBeNull();
	});

	it("does not mistake a progressing workflow for a cycle", () => {
		expect(detectRepeatedToolCallCycle(["read:a", "search:a", "read:b", "search:b", "edit:b", "test:b"])).toBeNull();
	});
});

describe("RepeatedToolCallGuard periodic cycles", () => {
	it("parks an exact alternating full-input tool cycle and counts each hook only once", () => {
		const taskId = "review-loop";
		const base = createDefaultSummary(taskId);
		base.state = "running";
		const entry = {
			summary: base,
			messages: [],
			activeAssistantMessageId: null,
			activeReasoningMessageId: null,
			toolMessageIdByToolCallId: new Map(),
			toolInputByToolCallId: new Map(),
		} satisfies NKleinTaskSessionEntry;
		const parked: Array<Record<string, unknown>> = [];
		const guard = new RepeatedToolCallGuard({
			getMaxRepeatedToolCallsPerTask: () => 4,
			getTaskEntry: (id) => (id === taskId ? entry : null),
			parkTaskForAutonomyBudget: (input) => {
				parked.push(input.metadata);
				return entry.summary as RuntimeTaskSessionSummary;
			},
		});

		for (let index = 0; index < 6; index += 1) {
			const fingerprint = index % 2 === 0 ? "search:formatCompactLine" : 'search:test("';
			const summary = {
				...base,
				lastHookAt: index + 1,
				latestHookActivity: {
					activityText: "search_code",
					toolName: "search_code",
					toolInputSummary: fingerprint,
					toolInputFingerprint: fingerprint,
					finalMessage: null,
					hookEventName: "tool_call",
					notificationType: null,
					source: "nklein-sdk",
				},
			} satisfies RuntimeTaskSessionSummary;
			expect(guard.check(summary)).toBe(index === 5 ? entry.summary : null);
			// Re-emitting the same summary is not another tool call.
			expect(guard.check(summary)).toBeNull();
		}

		expect(parked).toEqual([
			expect.objectContaining({
				guardrail: "repeated_tool_call_cycle",
				cycleLength: 2,
				repetitions: 3,
			}),
		]);
	});
});

describe("F1.34d — the incremental decompose route must not trip the identical-call guard", () => {
	it("allows 3+ decompose_project calls whose inputs DIFFER (add-tasks batches then completion)", () => {
		// The F1.7 incremental route legitimately calls decompose_project several times while CONSTRUCTING the
		// graph (batch 1, batch 2, completion). The 2026-07-25/26 parks were recordings re-serving the IDENTICAL
		// call after validation drift — correct guard behavior. A live architect's varying inputs must never
		// collide: the lossless full-input fingerprint is what guarantees that; this test pins it.
		const taskId = "incremental-decompose";
		const base = createDefaultSummary(taskId);
		base.state = "running";
		const entry = {
			summary: base,
			messages: [],
			activeAssistantMessageId: null,
			activeReasoningMessageId: null,
			toolMessageIdByToolCallId: new Map(),
			toolInputByToolCallId: new Map(),
		} satisfies NKleinTaskSessionEntry;
		const parked: Array<Record<string, unknown>> = [];
		const guard = new RepeatedToolCallGuard({
			getMaxRepeatedToolCallsPerTask: () => 3,
			getTaskEntry: (id) => (id === taskId ? entry : null),
			parkTaskForAutonomyBudget: (input) => {
				parked.push(input.metadata);
				return entry.summary as RuntimeTaskSessionSummary;
			},
		});
		const inputs = [
			'{"action":"add_tasks","tasks":["s00","s01","s02"]}',
			'{"action":"add_tasks","tasks":["s03","s04"]}',
			'{"action":"complete"}',
			'{"action":"complete","confirm":true}',
		];
		for (const [index, fingerprint] of inputs.entries()) {
			const summary = {
				...base,
				lastHookAt: index + 1,
				latestHookActivity: {
					activityText: "decompose_project",
					toolName: "decompose_project",
					toolInputSummary: `decompose batch ${index}`,
					toolInputFingerprint: fingerprint,
					finalMessage: null,
					hookEventName: "tool_call",
					notificationType: null,
					source: "nklein-sdk",
				},
			} satisfies RuntimeTaskSessionSummary;
			expect(guard.check(summary)).toBeNull();
		}
		expect(parked).toEqual([]);
	});

	it("still parks decompose_project when the SAME input repeats to the limit (non-progressing replay)", () => {
		const taskId = "stuck-decompose";
		const base = createDefaultSummary(taskId);
		base.state = "running";
		const entry = {
			summary: base,
			messages: [],
			activeAssistantMessageId: null,
			activeReasoningMessageId: null,
			toolMessageIdByToolCallId: new Map(),
			toolInputByToolCallId: new Map(),
		} satisfies NKleinTaskSessionEntry;
		const parked: Array<Record<string, unknown>> = [];
		const guard = new RepeatedToolCallGuard({
			getMaxRepeatedToolCallsPerTask: () => 3,
			getTaskEntry: (id) => (id === taskId ? entry : null),
			parkTaskForAutonomyBudget: (input) => {
				parked.push(input.metadata);
				return entry.summary as RuntimeTaskSessionSummary;
			},
		});
		let lastResult: unknown = null;
		for (let index = 0; index < 3; index += 1) {
			const summary = {
				...base,
				lastHookAt: index + 1,
				latestHookActivity: {
					activityText: "decompose_project",
					toolName: "decompose_project",
					toolInputSummary: "same graph",
					toolInputFingerprint: '{"action":"add_tasks","tasks":["s00"]}',
					finalMessage: null,
					hookEventName: "tool_call",
					notificationType: null,
					source: "nklein-sdk",
				},
			} satisfies RuntimeTaskSessionSummary;
			lastResult = guard.check(summary);
		}
		expect(lastResult).toBe(entry.summary);
		expect(parked).toHaveLength(1);
	});
});

describe("getRepeatedToolCallLimit", () => {
	it("gives read/command tools a higher park threshold (they legitimately repeat more)", () => {
		expect(getRepeatedToolCallLimit("read_files", 3)).toBe(NKLEIN_EXTRA_TOOL_REPEATED_CALL_PARK_THRESHOLD);
		expect(getRepeatedToolCallLimit("run_commands", 3)).toBe(NKLEIN_EXTRA_TOOL_REPEATED_CALL_PARK_THRESHOLD);
		expect(getRepeatedToolCallLimit("  READ_FILES  ", 3)).toBe(NKLEIN_EXTRA_TOOL_REPEATED_CALL_PARK_THRESHOLD); // case/space-insensitive
	});

	it("never drops below the operator-configured base limit", () => {
		expect(getRepeatedToolCallLimit("read_files", 10)).toBe(10); // base wins when higher than the extra threshold
	});

	it("uses the base limit for ordinary tools", () => {
		expect(getRepeatedToolCallLimit("edit_file", 3)).toBe(3);
		expect(getRepeatedToolCallLimit("decompose_project", 4)).toBe(4);
	});
});

describe("formatRepeatedToolCallParkMessage", () => {
	it("gives empty decompose_project the weak-local-model diagnostic", () => {
		const message = formatRepeatedToolCallParkMessage({
			toolName: "decompose_project",
			count: 3,
			toolInputSummary: null,
		});
		expect(message).toContain("empty arguments");
		expect(message).toContain("more capable model");
		expect(message).toContain("3×");
	});

	it("uses the generic repeated-call message for other tools, echoing count + input summary", () => {
		const message = formatRepeatedToolCallParkMessage({
			toolName: "edit_file",
			count: 5,
			toolInputSummary: "path: src/a.ts",
		});
		expect(message).toContain("5 repeated edit_file tool calls");
		expect(message).toContain("(path: src/a.ts)");
		expect(message).not.toContain("empty arguments");
	});

	it("treats decompose_project WITH arguments as the generic case, not the empty diagnostic", () => {
		const message = formatRepeatedToolCallParkMessage({
			toolName: "decompose_project",
			count: 2,
			toolInputSummary: "slug: my-project",
		});
		expect(message).not.toContain("empty arguments");
		expect(message).toContain("2 repeated decompose_project tool calls");
	});
});

describe("failure-target dedup (v19 architect park, 2026-09-01)", () => {
	it("counts a failing decompose_project once per hook event, not per summary re-emission", () => {
		const parked: unknown[] = [];
		const guard = new RepeatedToolCallGuard({
			getMaxRepeatedToolCallsPerTask: () => 99,
			getTaskEntry: () => ({ summary: { taskId: "t1", reviewReason: null } }) as never,
			parkTaskForAutonomyBudget: (input: unknown) => {
				parked.push(input);
				return { taskId: "t1" } as never;
			},
			recordObservation: () => {},
		} as never);
		const failedSummary = (hookAt: number) =>
			({
				taskId: "t1",
				state: "running",
				lastHookAt: hookAt,
				latestHookActivity: {
					source: "nklein-sdk",
					hookEventName: "tool_result",
					activityText: "Failed decompose_project: graph validation",
					toolName: "decompose_project",
					toolInputSummary: null,
				},
			}) as never;
		// One real failure, re-observed by three heartbeat re-emissions: counts ONCE.
		guard.check(failedSummary(1000));
		guard.check(failedSummary(1000));
		guard.check(failedSummary(1000));
		expect(parked).toHaveLength(0);
		// Three more DISTINCT failures reach the threshold (4) and park.
		guard.check(failedSummary(2000));
		guard.check(failedSummary(3000));
		guard.check(failedSummary(4000));
		expect(parked).toHaveLength(1);
	});
	it("clears the decomposition streak on accepted construction progress (convergence, not looping)", () => {
		// Live 2026-09-02 (v31): two premature finalizes early, 23 minutes of productive add_task/add_dependency
		// building, then two rejections at the real finalize — the accumulated 4 parked the architect seconds
		// from the flood. Accepted construction ops must reset the streak.
		const parked: unknown[] = [];
		const guard = new RepeatedToolCallGuard({
			getMaxRepeatedToolCallsPerTask: () => 99,
			getTaskEntry: () => ({ summary: { taskId: "t1", reviewReason: null } }) as never,
			parkTaskForAutonomyBudget: (input: unknown) => {
				parked.push(input);
				return { taskId: "t1" } as never;
			},
			recordObservation: () => {},
		} as never);
		const failedSummary = (hookAt: number) =>
			({
				taskId: "t1",
				state: "running",
				lastHookAt: hookAt,
				latestHookActivity: {
					source: "nklein-sdk",
					hookEventName: "tool_result",
					activityText: "Failed decompose_project: graph validation",
					toolName: "decompose_project",
					toolInputSummary: null,
				},
			}) as never;
		guard.check(failedSummary(1000));
		guard.check(failedSummary(2000));
		guard.check(failedSummary(3000));
		guard.noteDecompositionProgress("t1"); // an accepted add_task lands
		guard.check(failedSummary(4000));
		guard.check(failedSummary(5000));
		guard.check(failedSummary(6000));
		expect(parked).toHaveLength(0); // streak restarted at the progress mark — 3 since, under the threshold
		guard.check(failedSummary(7000));
		expect(parked).toHaveLength(1); // 4 consecutive WITHOUT progress still parks
	});
});

describe("P1.LOOPGUARDNUDGE — one automatic re-drive before the park (opt-in callback)", () => {
	it("nudges instead of parking the first time, parks the second time", () => {
		const taskId = "review-loop-nudge";
		const base = createDefaultSummary(taskId);
		base.state = "running";
		const entry = {
			summary: base,
			messages: [],
			activeAssistantMessageId: null,
			activeReasoningMessageId: null,
			toolMessageIdByToolCallId: new Map(),
			toolInputByToolCallId: new Map(),
		} satisfies NKleinTaskSessionEntry;
		const parked: string[] = [];
		const nudged: string[] = [];
		const guard = new RepeatedToolCallGuard({
			getMaxRepeatedToolCallsPerTask: () => 3,
			getTaskEntry: (id) => (id === taskId ? entry : null),
			autoNudgeBeforePark: (input) => {
				nudged.push(input.message);
				// The real send-input path resets the guard's counters; mirror that here.
				guard.resetTask(input.taskId);
				return true;
			},
			parkTaskForAutonomyBudget: (input) => {
				parked.push(input.message);
				return entry.summary as RuntimeTaskSessionSummary;
			},
		});
		const same = (index: number) =>
			({
				...base,
				lastHookAt: index + 1,
				latestHookActivity: {
					// search_code carries the BASE limit (read_files/run_commands have a raised threshold).
					activityText: "search_code",
					toolName: "search_code",
					toolInputSummary: "Remove keys that are set to None",
					toolInputFingerprint: "search:Remove keys that are set to None",
					finalMessage: null,
					hookEventName: "tool_call",
					notificationType: null,
					source: "nklein-sdk",
				},
			}) satisfies RuntimeTaskSessionSummary;
		// Three identical calls: the guard would park; the auto-nudge takes the first trip instead.
		expect(guard.check(same(0))).toBeNull();
		expect(guard.check(same(1))).toBeNull();
		expect(guard.check(same(2))).toBeNull();
		expect(nudged).toHaveLength(1);
		expect(nudged[0]).toContain("repeated search_code tool calls");
		expect(parked).toEqual([]);
		// The counters were reset by the nudge; three more identical calls park for real (the budget is one).
		expect(guard.check(same(3))).toBeNull();
		expect(guard.check(same(4))).toBeNull();
		expect(guard.check(same(5))).toBe(entry.summary);
		expect(parked).toHaveLength(1);
		expect(nudged).toHaveLength(1);
	});
});
