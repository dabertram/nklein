import { describe, expect, it } from "vitest";
import { parseForgivingToolCall, parseToolCallFromChannels } from "../../../src/core/forgiving-tool-call-parser";

describe("parseForgivingToolCall", () => {
	it("parses a native JSON call without marking it recovered", () => {
		const call = parseForgivingToolCall('{"name":"read_files","arguments":{"path":"a.ts"}}');
		expect(call).toMatchObject({ name: "read_files", arguments: { path: "a.ts" }, format: "json", recovered: false });
	});

	it("recovers non-native key names (tool/parameters)", () => {
		const call = parseForgivingToolCall('{"tool":"grep","parameters":{"q":"foo"}}');
		expect(call).toMatchObject({ name: "grep", arguments: { q: "foo" }, format: "json", recovered: true });
	});

	it("re-parses arguments delivered as a JSON string (OpenAI shape)", () => {
		const call = parseForgivingToolCall('{"name":"x","arguments":"{\\"a\\":1}"}');
		expect(call?.arguments).toEqual({ a: 1 });
	});

	it("recovers a fenced ```json block", () => {
		const text = 'Here you go:\n```json\n{"name":"run_command","arguments":{"cmd":"ls"}}\n```';
		const call = parseForgivingToolCall(text);
		expect(call).toMatchObject({
			name: "run_command",
			arguments: { cmd: "ls" },
			format: "fenced-json",
			recovered: true,
		});
	});

	it("recovers a Hermes <tool_call> block", () => {
		const call = parseForgivingToolCall('<tool_call>{"name":"search","arguments":{"q":"x"}}</tool_call>');
		expect(call).toMatchObject({ name: "search", format: "hermes", recovered: true });
	});

	it("recovers an XML <function=name> tag", () => {
		const call = parseForgivingToolCall('<function=read_files>{"path":"a.ts"}</function>');
		expect(call).toMatchObject({ name: "read_files", arguments: { path: "a.ts" }, format: "xml-function" });
	});

	it('recovers an XML <function_call name="…"> tag', () => {
		const call = parseForgivingToolCall('<function_call name="grep">{"q":"foo"}</function_call>');
		expect(call).toMatchObject({ name: "grep", arguments: { q: "foo" }, format: "xml-function" });
	});

	it("recovers a Python-style call with typed kwargs", () => {
		const call = parseForgivingToolCall('read_files(path="a.ts", limit=5, recurse=True)');
		expect(call).toMatchObject({
			name: "read_files",
			arguments: { path: "a.ts", limit: 5, recurse: true },
			format: "python-call",
		});
	});

	it("repairs trailing commas", () => {
		const call = parseForgivingToolCall('{"name":"x","arguments":{"a":1,}}');
		expect(call).toMatchObject({ name: "x", arguments: { a: 1 }, recovered: true });
	});

	it("repairs Python True/False/None literals in JSON", () => {
		const call = parseForgivingToolCall('{"name":"x","arguments":{"flag":True,"opt":None}}');
		expect(call?.arguments).toEqual({ flag: true, opt: null });
	});

	it("extracts a JSON call embedded in surrounding prose", () => {
		const call = parseForgivingToolCall('Sure, calling {"name":"grep","arguments":{"q":"foo"}} for you.');
		expect(call).toMatchObject({ name: "grep", arguments: { q: "foo" } });
	});

	it("returns null when there is no recoverable call", () => {
		expect(parseForgivingToolCall("I could not find the file, sorry.")).toBeNull();
		expect(parseForgivingToolCall("")).toBeNull();
	});

	it("does not misfire on mid-sentence parentheses (only a trailing call)", () => {
		expect(parseForgivingToolCall("See section 2 (final) for details")).toBeNull();
	});
});

describe("parseToolCallFromChannels", () => {
	it("falls back to reasoning_content when content has no call", () => {
		const call = parseToolCallFromChannels({
			content: "Let me think about this.",
			reasoningContent: '<tool_call>{"name":"read_files","arguments":{"path":"x"}}</tool_call>',
		});
		expect(call).toMatchObject({ name: "read_files", format: "hermes" });
	});

	it("prefers content when both channels carry a call", () => {
		const call = parseToolCallFromChannels({
			content: '{"name":"fromContent","arguments":{}}',
			reasoningContent: '{"name":"fromReasoning","arguments":{}}',
		});
		expect(call?.name).toBe("fromContent");
	});

	it("returns null when neither channel has a call", () => {
		expect(parseToolCallFromChannels({ content: "nope", reasoningContent: null })).toBeNull();
	});
});
