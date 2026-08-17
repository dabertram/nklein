// §dsh#32 — session-fork pure core: the step-boundary safety rule (no dangling tool_use crosses a fork) and
// the typed refusals that keep a bad fork unrepresentable.

import { describe, expect, it } from "vitest";

import { buildSessionForkPlan, latestStepBoundaryIndex, unresolvedToolUseIdsAt } from "../../../src/core/session-fork";

const user = (text: string) => ({ role: "user", content: [{ type: "text", text }] });
const assistantText = (text: string) => ({ role: "assistant", content: [{ type: "text", text }] });
const assistantTool = (id: string) => ({
	role: "assistant",
	content: [{ type: "tool_use", id, name: "write_file", input: {} }],
});
const toolResult = (id: string) => ({ role: "user", content: [{ type: "tool_result", tool_use_id: id, content: [] }] });

describe("unresolvedToolUseIdsAt / latestStepBoundaryIndex", () => {
	const transcript = [user("task"), assistantTool("t1"), toolResult("t1"), assistantTool("t2")];

	it("flags a dangling tool_use and finds the latest safe boundary before it", () => {
		expect(unresolvedToolUseIdsAt(transcript, 3)).toEqual(["t2"]);
		expect(unresolvedToolUseIdsAt(transcript, 2)).toEqual([]);
		expect(latestStepBoundaryIndex(transcript)).toBe(2);
	});
});

describe("buildSessionForkPlan", () => {
	const transcript = [user("task"), assistantTool("t1"), toolResult("t1"), assistantText("done step 1")];

	it("forks at the latest boundary with provenance and a copied prefix", () => {
		const result = buildSessionForkPlan({
			sourceTaskId: "src-1",
			forkTaskId: "fork-1",
			messages: transcript,
			boundary: "latest",
			forkedAt: "2026-08-17T18:00:00.000Z",
		});
		if (!("plan" in result)) throw new Error("expected a plan");
		expect(result.plan.initialMessages).toHaveLength(4);
		expect(result.plan.provenance).toEqual({
			sourceTaskId: "src-1",
			boundaryIndex: 3,
			forkedAt: "2026-08-17T18:00:00.000Z",
		});
		// Copies, not aliases — mutating the plan must not reach the source transcript objects.
		expect(result.plan.initialMessages[0]).not.toBe(transcript[0]);
	});

	it("refuses an explicit boundary that would cut a dangling tool_use", () => {
		const withDangling = [...transcript, assistantTool("t9")];
		const result = buildSessionForkPlan({
			sourceTaskId: "src-1",
			forkTaskId: "fork-1",
			messages: withDangling,
			boundary: { afterMessageIndex: 4 },
			forkedAt: "2026-08-17T18:00:00.000Z",
		});
		if (!("refusal" in result)) throw new Error("expected a refusal");
		expect(result.refusal).toEqual({ kind: "dangling_tool_use", index: 4, unresolvedToolUseIds: ["t9"] });
	});

	it("refuses same-id, empty source, and out-of-range boundaries", () => {
		expect(
			buildSessionForkPlan({
				sourceTaskId: "a",
				forkTaskId: "a",
				messages: transcript,
				boundary: "latest",
				forkedAt: "t",
			}),
		).toEqual({ refusal: { kind: "same_id" } });
		expect(
			buildSessionForkPlan({ sourceTaskId: "a", forkTaskId: "b", messages: [], boundary: "latest", forkedAt: "t" }),
		).toEqual({ refusal: { kind: "empty_source" } });
		expect(
			buildSessionForkPlan({
				sourceTaskId: "a",
				forkTaskId: "b",
				messages: transcript,
				boundary: { afterMessageIndex: 99 },
				forkedAt: "t",
			}),
		).toEqual({ refusal: { kind: "index_out_of_range", index: 99, messageCount: 4 } });
	});
});
