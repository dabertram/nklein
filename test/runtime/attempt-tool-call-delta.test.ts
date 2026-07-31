import { describe, expect, it } from "vitest";
import type { AttemptToolCall } from "../../src/core/agent-attempt-ledger";
import { buildTerminalAttemptEvent, resolveAttemptToolCallDelta } from "../../src/nklein-agent/nklein-ledger-attempt";
import { extractTerminalToolCalls } from "../../src/nklein-agent/nklein-ledger-tool-calls";

/**
 * P21.14 — an attempt records ITS OWN tool calls, not the whole task's transcript.
 *
 * ── THE DEFECT, MEASURED ON THE LIVE LEDGER ──
 * Every terminal capture re-read the entire persisted transcript, so a task's calls were recorded once per
 * attempt: `habit-score-extensions-card-4` carried the identical 11 calls across 11 attempts, and one
 * fingerprint appeared 12 times. Ratios survived (the same calls duplicate on both sides) but **sample SIZE did
 * not** — an evidence floor of 20 calls could be cleared by 2 real calls duplicated ten times, and a floor that
 * can be cleared by duplication is not a floor.
 */

function call(name: string, id: string): AttemptToolCall {
	return { name, fingerprint: id, outcome: "success" };
}

describe("resolveAttemptToolCallDelta", () => {
	it("records everything on the FIRST attempt", () => {
		const result = resolveAttemptToolCallDelta({
			allToolCalls: [call("a", "1"), call("b", "2")],
			priorWatermarks: [],
		});
		expect(result.toolCalls).toHaveLength(2);
		expect(result.transcriptToolCallCount).toBe(2);
	});

	it("records only the NEW calls on a later attempt", () => {
		const result = resolveAttemptToolCallDelta({
			allToolCalls: [call("a", "1"), call("b", "2"), call("c", "3")],
			priorWatermarks: [2],
		});
		expect(result.toolCalls.map((entry) => entry.name)).toEqual(["c"]);
		expect(result.transcriptToolCallCount).toBe(3);
	});

	it("records NOTHING when the transcript did not grow — the restart case", () => {
		// The exact shape of the defect: a restart re-terminates a finished task, the transcript is unchanged,
		// and the old code re-recorded all of it as a fresh attempt's work.
		const result = resolveAttemptToolCallDelta({
			allToolCalls: [call("a", "1"), call("b", "2")],
			priorWatermarks: [2],
		});
		expect(result.toolCalls).toEqual([]);
		expect(result.transcriptToolCallCount).toBe(2);
	});

	it("uses the HIGHEST prior watermark, not the last or the first", () => {
		// Attempts are not guaranteed to be read in order, and one legacy null must not reset the mark.
		const result = resolveAttemptToolCallDelta({
			allToolCalls: [call("a", "1"), call("b", "2"), call("c", "3"), call("d", "4")],
			priorWatermarks: [3, null, 1],
		});
		expect(result.toolCalls.map((entry) => entry.name)).toEqual(["d"]);
	});

	it("treats a LEGACY null watermark as 0 rather than guessing", () => {
		// Historical lines recorded a cumulative count in `toolCalls`; reinterpreting that as a delta would
		// silently rewrite the meaning of data already on disk. One more duplicate, once per task, is the price.
		const result = resolveAttemptToolCallDelta({
			allToolCalls: [call("a", "1"), call("b", "2")],
			priorWatermarks: [null, null],
		});
		expect(result.toolCalls).toHaveLength(2);
	});

	it("starts over when the transcript SHRANK, rather than reporting zero forever", () => {
		// A compaction or a fresh session reusing the task id leaves a watermark above the current count.
		// Slicing past the end would silently report no calls for the rest of the task's life.
		const result = resolveAttemptToolCallDelta({
			allToolCalls: [call("a", "1")],
			priorWatermarks: [9],
		});
		expect(result.toolCalls).toHaveLength(1);
		expect(result.transcriptToolCallCount).toBe(1);
	});

	it("copies the calls, so a later mutation cannot reach the ledger event", () => {
		const source = [call("a", "1")];
		const result = resolveAttemptToolCallDelta({ allToolCalls: source, priorWatermarks: [] });
		(source[0] as { name: string }).name = "mutated";
		expect(result.toolCalls[0]?.name).toBe("a");
	});
});

describe("why the watermark counts TOOL CALLS and not MESSAGES", () => {
	/** A transcript where a tool_use and its tool_result sit in different messages — the ordinary shape. */
	const messages = [
		{ role: "assistant", content: [{ type: "tool_use", id: "u1", name: "edit_file", input: {} }] },
		{ role: "user", content: [{ type: "tool_result", tool_use_id: "u1", is_error: false, content: "ok" }] },
		{ role: "assistant", content: [{ type: "tool_use", id: "u2", name: "edit_file", input: {} }] },
		{ role: "user", content: [{ type: "tool_result", tool_use_id: "u2", is_error: true, content: "boom" }] },
	] as never;

	it("extracting over the WHOLE transcript resolves every outcome", () => {
		const calls = extractTerminalToolCalls(messages);
		expect(calls.map((entry) => entry.outcome)).toEqual(["success", "error"]);
	});

	it("extracting over a MESSAGE SLICE loses the result — which is why slicing messages was rejected", () => {
		// The pairing map is built per call, so a boundary between a tool_use and its tool_result leaves the call
		// unresolved in one attempt and DROPS the result entirely in the next: the id has no match in the new map.
		const firstHalf = extractTerminalToolCalls((messages as unknown[]).slice(0, 1) as never);
		expect(firstHalf[0]?.outcome, "unresolved in the earlier slice").toBeNull();
		const secondHalf = extractTerminalToolCalls((messages as unknown[]).slice(1, 2) as never);
		expect(secondHalf, "the orphaned result vanishes entirely").toEqual([]);
	});

	it("so the delta is taken AFTER extraction, and outcomes survive", () => {
		const all = extractTerminalToolCalls(messages);
		const second = resolveAttemptToolCallDelta({ allToolCalls: all, priorWatermarks: [1] });
		expect(second.toolCalls).toHaveLength(1);
		expect(second.toolCalls[0]?.outcome, "the delta keeps the resolved outcome").toBe("error");
	});
});

describe("the attempt event carries the watermark", () => {
	const base = {
		taskId: "t-1",
		workspacePath: "/repo",
		state: "awaiting_review" as const,
		role: "worker",
		providerId: "lmstudio",
		modelId: "qwen/qwen3-8b",
		endpoint: "http://127.0.0.1:1234/v1",
		startedAt: 1_000,
		endedAt: 5_000,
		promptTokens: 10,
		completionTokens: 10,
		timeoutReason: null,
	};

	it("persists it when supplied", () => {
		expect(buildTerminalAttemptEvent({ ...base, transcriptToolCallCount: 7 }).transcriptToolCallCount).toBe(7);
	});

	it("defaults to null, so a coarse write is not mistaken for a watermark of zero", () => {
		// Zero would claim "the transcript had no calls at this point" and make the NEXT attempt re-record
		// everything. Null says "not recorded", which the resolver treats as legacy.
		expect(buildTerminalAttemptEvent(base).transcriptToolCallCount).toBeNull();
	});
});

/**
 * P21.15 — `toolSetOffered` now has a writer.
 *
 * The field is read by `agent-ledger-projections` and the §5.AA behaviour profile for `toolCount`, and was
 * 0/238 because the terminal writer's input type had no such field.
 *
 * **The source had to be the EXTENSION, not the tool-assembly site.** `nklein-session-runtime` builds
 * `sessionExtraTools`, but that is only the extension-registered set — a live run showed the model offered 27
 * tools where that variable held far fewer. The consumer's whole point is count THRESHOLDS (F12.18: ~7 target,
 * accuracy craters past 10–15), so an understated count is not a weaker measurement — it is a wrong one, and
 * worse than the null it replaces.
 */
describe("toolSetOffered on the attempt event", () => {
	const base = {
		taskId: "t-1",
		workspacePath: "/repo",
		state: "awaiting_review" as const,
		role: "worker",
		providerId: "lmstudio",
		modelId: "qwen/qwen3-8b",
		endpoint: "http://127.0.0.1:1234/v1",
		startedAt: 1_000,
		endedAt: 5_000,
		promptTokens: 10,
		completionTokens: 10,
		timeoutReason: null,
	};

	it("carries the offered tool names when supplied", () => {
		const event = buildTerminalAttemptEvent({ ...base, toolSetOffered: ["read_files", "write_files", "editor"] });
		expect(event.toolSetOffered).toEqual(["read_files", "write_files", "editor"]);
	});

	it("gives the behaviour profile a real toolCount", () => {
		expect(buildTerminalAttemptEvent({ ...base, toolSetOffered: Array(27).fill("t") }).toolSetOffered).toHaveLength(
			27,
		);
	});

	it("defaults to [] when never observed — and NULL input must not become a false zero-count", () => {
		// The schema stores an array, so absence lands as []. The distinction that matters is upstream: the
		// runtime accessor returns NULL when no request was seen, and null must never be written as a claim that
		// the model was offered nothing.
		expect(buildTerminalAttemptEvent(base).toolSetOffered).toEqual([]);
		expect(buildTerminalAttemptEvent({ ...base, toolSetOffered: null }).toolSetOffered).toEqual([]);
	});

	it("COPIES the array, so a later mutation cannot reach the persisted event", () => {
		const offered = ["read_files"];
		const event = buildTerminalAttemptEvent({ ...base, toolSetOffered: offered });
		offered.push("mutated");
		expect(event.toolSetOffered).toEqual(["read_files"]);
	});
});
