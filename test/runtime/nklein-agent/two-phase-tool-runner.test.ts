import { describe, expect, it } from "vitest";
import { KANBAN_TASK_TOOL_CARDS } from "../../../src/core/task-tool-cards";
import type { ToolCard } from "../../../src/core/tool-card";
import { runTwoPhaseToolPick, type TwoPhasePickModelCaller } from "../../../src/nklein-agent/two-phase-tool-runner";

const canned = (content: string, finishReason = "stop"): TwoPhasePickModelCaller => {
	return async () => ({ content, finishReason });
};

describe("runTwoPhaseToolPick", () => {
	it("returns a one_tool decision for a clean pick over the default kanban cards", async () => {
		const result = await runTwoPhaseToolPick({ task: "view a file", callModel: canned("read_files") });
		expect(result.decision).toEqual({ kind: "one_tool", tool: "read_files" });
		// The menu the model saw lists the real tools.
		expect(result.menu).toContain("read_files");
		expect(result.raw).toEqual({ content: "read_files", finishReason: "stop" });
	});

	it("passes the built phase-1 menu + task to the model caller", async () => {
		const captured: { value: { menu: string; task: string } | null } = { value: null };
		await runTwoPhaseToolPick({
			task: "make a new file",
			callModel: async (input) => {
				captured.value = input;
				return { content: "write_file", finishReason: "stop" };
			},
		});
		expect(captured.value?.task).toBe("make a new file");
		expect(captured.value?.menu).toContain("write_file"); // the menu was built from the cards and handed to the caller
	});

	it("is truncation-aware end-to-end: empty + finish_reason 'length' becomes plan_needed, not none", async () => {
		const result = await runTwoPhaseToolPick({ task: "anything", callModel: canned("", "length") });
		expect(result.decision).toEqual({ kind: "plan_needed" });
	});

	it("honors a custom card set", async () => {
		const cards: readonly ToolCard[] = [{ name: "only_tool", purpose: "p", useWhen: "w" }];
		const result = await runTwoPhaseToolPick({ task: "t", callModel: canned("only_tool"), cards });
		expect(result.decision).toEqual({ kind: "one_tool", tool: "only_tool" });
		expect(result.menu).toContain("only_tool");
		expect(result.menu).not.toContain(KANBAN_TASK_TOOL_CARDS[0].name); // default cards not used
	});
});
