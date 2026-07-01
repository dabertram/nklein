import { describe, expect, it, vi } from "vitest";
import type { PhaseOneRawResponse } from "../../../src/core/two-phase-tool-pick";
import {
	createOpenAiCompatPhaseOnePickCaller,
	latestStepText,
	narrowToolsForStep,
} from "../../../src/nklein-agent/two-phase-before-model";

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

describe("latestStepText", () => {
	it("returns the last user message's string content", () => {
		expect(
			latestStepText([
				{ role: "user", content: "first" },
				{ role: "assistant", content: "reply" },
				{ role: "user", content: "  the step  " },
			]),
		).toBe("the step");
	});

	it("joins text parts of an array content", () => {
		expect(
			latestStepText([
				{
					role: "user",
					content: [
						{ type: "text", text: "do" },
						{ type: "text", text: "this" },
					],
				},
			]),
		).toBe("do this");
	});

	it("skips assistant/non-user and empty user messages", () => {
		expect(
			latestStepText([
				{ role: "user", content: "real step" },
				{ role: "user", content: "   " },
				{ role: "assistant", content: "ignore me" },
			]),
		).toBe("real step");
	});

	it("returns empty string when there is no user message", () => {
		expect(latestStepText([{ role: "assistant", content: "x" }])).toBe("");
		expect(latestStepText([])).toBe("");
	});
});

describe("createOpenAiCompatPhaseOnePickCaller", () => {
	it("normalizes the base URL to the /v1/chat/completions route", () => {
		// A bare host gets /v1 appended; a base already ending in /v1 does not double it. (Behavior asserted via the
		// fetch URL — we stub global fetch to capture it.)
		const calls: string[] = [];
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (url: string) => {
			calls.push(String(url));
			return {
				ok: true,
				json: async () => ({ choices: [{ message: { content: "read_files" }, finish_reason: "stop" }] }),
			};
		}) as unknown as typeof fetch;
		try {
			const bare = createOpenAiCompatPhaseOnePickCaller({ baseUrl: "http://localhost:1234", modelId: "m" });
			const versioned = createOpenAiCompatPhaseOnePickCaller({ baseUrl: "http://localhost:1234/v1/", modelId: "m" });
			return Promise.all([bare({ menu: "x", task: "t" }), versioned({ menu: "x", task: "t" })]).then(() => {
				expect(calls).toEqual([
					"http://localhost:1234/v1/chat/completions",
					"http://localhost:1234/v1/chat/completions",
				]);
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
