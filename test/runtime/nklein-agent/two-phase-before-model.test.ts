import { describe, expect, it, vi } from "vitest";
import type { PhaseOneRawResponse } from "../../../src/core/two-phase-tool-pick";
import { narrowToolsForStep } from "../../../src/nklein-agent/two-phase-before-model";

const canned = (content: string, finishReason = "stop") =>
	vi.fn(async (_input: { menu: string; task: string }): Promise<PhaseOneRawResponse> => ({ content, finishReason }));
const tools = [{ name: "read_files" }, { name: "write_file" }, { name: "editor" }];

describe("narrowToolsForStep", () => {
	it("narrows to the single picked tool", async () => {
		const result = await narrowToolsForStep({ tools, step: "make a new file", callModel: canned("write_file") });
		expect(result).toEqual([{ name: "write_file" }]);
	});

	it("leaves the tools unchanged for a none / plan_needed pick", async () => {
		expect(await narrowToolsForStep({ tools, step: "s", callModel: canned("none") })).toBe(tools);
		expect(await narrowToolsForStep({ tools, step: "s", callModel: canned("plan") })).toBe(tools);
	});

	it("leaves the tools unchanged for a truncated (empty + finish:length) pick", async () => {
		expect(await narrowToolsForStep({ tools, step: "s", callModel: canned("", "length") })).toBe(tools);
	});

	it("skips the phase-1 call entirely when there are fewer than 2 tools", async () => {
		const callModel = canned("read_files");
		const one = [{ name: "read_files" }];
		expect(await narrowToolsForStep({ tools: one, step: "s", callModel })).toBe(one);
		expect(callModel).not.toHaveBeenCalled();
	});

	it("shows the model a menu built from the offered tools (authored card purpose for known tools)", async () => {
		const callModel = canned("read_files");
		await narrowToolsForStep({ tools, step: "view a file", callModel });
		const menu = callModel.mock.calls[0]?.[0]?.menu ?? "";
		// read_files is an authored kanban tool → its card purpose appears; every offered tool name is listed.
		expect(menu).toContain("read_files");
		expect(menu).toContain("Read one or more text/image files");
		for (const tool of tools) {
			expect(menu).toContain(tool.name);
		}
	});

	it("falls back to a name-only card for a tool we haven't authored", async () => {
		const custom = [{ name: "read_files" }, { name: "some_custom_tool" }];
		const callModel = canned("some_custom_tool");
		const result = await narrowToolsForStep({ tools: custom, step: "s", callModel });
		expect(result).toEqual([{ name: "some_custom_tool" }]);
		expect(callModel.mock.calls[0]?.[0]?.menu).toContain("some_custom_tool");
	});
});
