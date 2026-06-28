import type { AgentMessage, AgentMessagePart } from "@nklein/shared";
import { describe, expect, it } from "vitest";

import {
	parseNarratedToolCalls,
	parseToolValidatedNarration,
	recoverNarratedToolCalls,
	stripNarratedToolCallMarkup,
} from "../../../src/nklein-agent/nklein-narrated-tool-call";

function message(...content: AgentMessagePart[]): AgentMessage {
	return { id: "m1", role: "assistant", content, createdAt: 0 };
}

describe("parseNarratedToolCalls", () => {
	it("parses the exact <tool_call> block a 35B model emitted in its reasoning channel (evidence bundle)", () => {
		const text = `<tool_call>
{"name": "list_files", "arguments": {"path": "/workspace", "recursive": false, "maxDepth": 1, "includeHidden": true}}
</tool_call>`;
		expect(parseNarratedToolCalls(text)).toEqual([
			{
				toolName: "list_files",
				input: { path: "/workspace", recursive: false, maxDepth: 1, includeHidden: true },
			},
		]);
	});

	it("parses a read_large_file continuation call (the other observed stall)", () => {
		const text = `Some reasoning prose.\n<tool_call>\n{"name": "read_large_file", "arguments": {"path": "/spec.md", "cursor": "read:789:2"}}\n</tool_call>`;
		expect(parseNarratedToolCalls(text)).toEqual([
			{ toolName: "read_large_file", input: { path: "/spec.md", cursor: "read:789:2" } },
		]);
	});

	it("recovers multiple narrated calls", () => {
		const text = `<tool_call>{"name": "read_files", "arguments": {"path": "a.ts"}}</tool_call>
<tool_call>{"name": "read_files", "arguments": {"path": "b.ts"}}</tool_call>`;
		expect(parseNarratedToolCalls(text)).toEqual([
			{ toolName: "read_files", input: { path: "a.ts" } },
			{ toolName: "read_files", input: { path: "b.ts" } },
		]);
	});

	it("tolerates the pipe-delimited <|tool_call|> and <function_call> variants", () => {
		expect(parseNarratedToolCalls(`<|tool_call|>{"name":"x","arguments":{"a":1}}<|/tool_call|>`)).toEqual([
			{ toolName: "x", input: { a: 1 } },
		]);
		expect(parseNarratedToolCalls(`<function_call>{"name":"y","arguments":{}}</function_call>`)).toEqual([
			{ toolName: "y", input: {} },
		]);
	});

	it("recovers a truncated block with no closing tag (balanced-brace extraction closes it)", () => {
		expect(parseNarratedToolCalls(`<tool_call>\n{"name": "list_files", "arguments": {"path": "/workspace"`)).toEqual([
			{ toolName: "list_files", input: { path: "/workspace" } },
		]);
	});

	it("unwraps double-encoded (string) arguments", () => {
		const text = `<tool_call>{"name":"read_files","arguments":"{\\"path\\":\\"a.ts\\"}"}</tool_call>`;
		expect(parseNarratedToolCalls(text)).toEqual([{ toolName: "read_files", input: { path: "a.ts" } }]);
	});

	it("accepts input/parameters/tool aliases and repairs sloppy JSON (trailing comma)", () => {
		expect(parseNarratedToolCalls(`<tool_call>{"name":"a","input":{"x":1}}</tool_call>`)).toEqual([
			{ toolName: "a", input: { x: 1 } },
		]);
		expect(parseNarratedToolCalls(`<tool_call>{"tool":"b","parameters":{"y":2,}}</tool_call>`)).toEqual([
			{ toolName: "b", input: { y: 2 } },
		]);
	});

	it("ignores blocks with no tool name and text without a wrapper", () => {
		expect(parseNarratedToolCalls(`<tool_call>{"arguments":{"path":"a"}}</tool_call>`)).toEqual([]);
		expect(parseNarratedToolCalls(`I would list the files in /workspace and then read them.`)).toEqual([]);
		expect(parseNarratedToolCalls(`{"name":"list_files","arguments":{}}`)).toEqual([]); // bare JSON, no wrapper
	});
});

describe("parseNarratedToolCalls — model-family tool-call formats (todo §5.O)", () => {
	it("recovers the Mistral/Mixtral [TOOL_CALLS] array format (multiple calls)", () => {
		const text = `[TOOL_CALLS][{"name": "read_files", "arguments": {"path": "a.ts"}}, {"name": "read_files", "arguments": {"path": "b.ts"}}]`;
		expect(parseNarratedToolCalls(text)).toEqual([
			{ toolName: "read_files", input: { path: "a.ts" } },
			{ toolName: "read_files", input: { path: "b.ts" } },
		]);
	});

	it("recovers the Llama 3.1 <|python_tag|> single-object format", () => {
		const text = `<|python_tag|>{"name": "list_files", "parameters": {"path": "/workspace"}}`;
		expect(parseNarratedToolCalls(text)).toEqual([{ toolName: "list_files", input: { path: "/workspace" } }]);
	});

	it("recovers the OpenAI-shaped nested function:{name,arguments} object (with stringified args)", () => {
		const text = `<tool_call>{"function": {"name": "read_files", "arguments": "{\\"path\\": \\"a.ts\\"}"}}</tool_call>`;
		expect(parseNarratedToolCalls(text)).toEqual([{ toolName: "read_files", input: { path: "a.ts" } }]);
	});

	it("recovers the Functionary <function=NAME>{args}</function> named-tag format", () => {
		const text = `<function=read_files>{"path": "a.ts"}</function>`;
		expect(parseNarratedToolCalls(text)).toEqual([{ toolName: "read_files", input: { path: "a.ts" } }]);
	});

	it("recovers multiple named-function tags in one turn", () => {
		const text = `<function=read_files>{"path": "a.ts"}</function>\n<function=run_commands>{"commands": ["ls"]}</function>`;
		expect(parseNarratedToolCalls(text)).toEqual([
			{ toolName: "read_files", input: { path: "a.ts" } },
			{ toolName: "run_commands", input: { commands: ["ls"] } },
		]);
	});

	it("does not fire on plain prose mentioning these tokens without a real block", () => {
		expect(parseNarratedToolCalls("I'll use the python_tag approach and discuss tool_calls in general.")).toEqual([]);
	});

	it("recovers the DeepSeek-V3/R1 native format (special tokens, name outside the JSON, fenced args)", () => {
		const text =
			'I\'ll read it.\n<｜tool▁call▁begin｜>function<｜tool▁sep｜>read_file\n```json\n{"path":"src/timebase.ts"}\n```<｜tool▁call▁end｜>';
		expect(parseNarratedToolCalls(text)).toEqual([{ toolName: "read_file", input: { path: "src/timebase.ts" } }]);
	});

	it("recovers the ASCII-normalized DeepSeek variant some GGUF quantizations emit (<|tool_call_begin|>)", () => {
		const text =
			'<|tool_call_begin|>function<|tool_sep|>decompose_project\n```json\n{"slug":"daw","tasks":[{"id":"a"}]}\n```<|tool_call_end|>';
		expect(parseNarratedToolCalls(text)).toEqual([
			{ toolName: "decompose_project", input: { slug: "daw", tasks: [{ id: "a" }] } },
		]);
	});

	it("recovers multiple DeepSeek calls inside the outer <｜tool▁calls▁begin｜> wrapper", () => {
		const text =
			'<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>function<｜tool▁sep｜>list_files\n```json\n{"path":"."}\n```<｜tool▁call▁end｜><｜tool▁call▁begin｜>function<｜tool▁sep｜>read_files\n```json\n{"files":["a.ts"]}\n```<｜tool▁call▁end｜><｜tool▁calls▁end｜>';
		expect(parseNarratedToolCalls(text)).toEqual([
			{ toolName: "list_files", input: { path: "." } },
			{ toolName: "read_files", input: { files: ["a.ts"] } },
		]);
	});

	it("recovers a DeepSeek call whose args have no ```json fence and a truncated end token", () => {
		const text = '<｜tool▁call▁begin｜>function<｜tool▁sep｜>list_files {"path":"/workspace"}';
		expect(parseNarratedToolCalls(text)).toEqual([{ toolName: "list_files", input: { path: "/workspace" } }]);
	});

	it("strips a DeepSeek narrated call from a final reply for display", () => {
		const text =
			'Reading the spec now.\n<｜tool▁call▁begin｜>function<｜tool▁sep｜>read_file\n```json\n{"path":"spec.md"}\n```<｜tool▁call▁end｜>';
		expect(stripNarratedToolCallMarkup(text)).toBe("Reading the spec now.");
	});
});

describe("recoverNarratedToolCalls", () => {
	it("appends a recovered tool-call part when the call is narrated in the reasoning channel", () => {
		const msg = message({
			type: "reasoning",
			text: `<tool_call>\n{"name": "list_files", "arguments": {"path": "/workspace"}}\n</tool_call>`,
		});
		const recovered = recoverNarratedToolCalls(msg);
		expect(recovered).toHaveLength(1);
		expect(recovered[0]).toMatchObject({
			type: "tool-call",
			toolName: "list_files",
			input: { path: "/workspace" },
			metadata: { recoveredFromNarratedToolCall: true },
		});
		expect(recovered[0].toolCallId).toBeTruthy();
		// Mutated in place so the agent loop (which filters message.content for tool-call parts) dispatches it.
		expect(msg.content.filter((part) => part.type === "tool-call")).toHaveLength(1);
	});

	it("recovers from the text channel too", () => {
		const msg = message({
			type: "text",
			text: `<tool_call>{"name":"read_files","arguments":{"path":"a.ts"}}</tool_call>`,
		});
		expect(recoverNarratedToolCalls(msg)).toHaveLength(1);
	});

	it("is a no-op when a real tool call is already present (no double-execution)", () => {
		const msg = message(
			{ type: "text", text: `<tool_call>{"name":"list_files","arguments":{}}</tool_call>` },
			{ type: "tool-call", toolCallId: "real", toolName: "list_files", input: {} },
		);
		expect(recoverNarratedToolCalls(msg)).toEqual([]);
		expect(msg.content.filter((part) => part.type === "tool-call")).toHaveLength(1);
	});

	it("is a no-op when nothing is narrated", () => {
		const msg = message({ type: "text", text: "All done — the files look correct." });
		expect(recoverNarratedToolCalls(msg)).toEqual([]);
		expect(msg.content).toHaveLength(1);
	});
});

describe("stripNarratedToolCallMarkup", () => {
	it("strips the exact <|tool_call> narration gemma-4-e2b leaked into its final reply (live §5.O)", () => {
		// The non-JSON, YAML-ish body parseNarratedToolCalls can't parse — the whole reply was narration.
		const text =
			"<|tool_call>call:write_file\nfile_name: greet.js\ncontent: |\n  function greet(name) {\n    return 'Hello, ' + name;\n  }";
		expect(stripNarratedToolCallMarkup(text)).toBe("");
	});

	it("keeps the natural-language prose before a narrated call and drops the markup tail", () => {
		expect(stripNarratedToolCallMarkup('I created the file. <tool_call>{"name":"write_file"}</tool_call>')).toBe(
			"I created the file.",
		);
		expect(stripNarratedToolCallMarkup("Here you go. [TOOL_CALLS][{}]")).toBe("Here you go.");
		expect(stripNarratedToolCallMarkup("Done. <function=read_file>{}</function>")).toBe("Done.");
	});

	it("strips a plain-prose `Tool call: name(args)` narration (gemma-e2b, §5.Z)", () => {
		expect(stripNarratedToolCallMarkup('I created the file. Tool call: write_file({"path":"x"})')).toBe(
			"I created the file.",
		);
		// The whole reply was the narration.
		expect(stripNarratedToolCallMarkup('Tool call: read_file("a.txt")')).toBe("");
		// Case/spacing tolerant.
		expect(stripNarratedToolCallMarkup("Done.\nTOOL CALL : list_dir( . )")).toBe("Done.");
	});

	it("does NOT strip ordinary prose that merely mentions a tool call (no name+paren shape)", () => {
		expect(stripNarratedToolCallMarkup("I made a tool call to read the file and it worked.")).toBe(
			"I made a tool call to read the file and it worked.",
		);
	});

	it("is a no-op for ordinary prose with no tool-call markup", () => {
		expect(stripNarratedToolCallMarkup("The functions are add and subtract.")).toBe(
			"The functions are add and subtract.",
		);
		expect(stripNarratedToolCallMarkup("")).toBe("");
	});
});

describe("parseNarratedToolCalls — Gemma `tool_code` Python-call narration (§5.Z e2e capstone)", () => {
	it("recovers a single `tool_code = name(kwarg=value)` call", () => {
		expect(parseNarratedToolCalls('tool_code = read_file(filename="FACT.txt")')).toEqual([
			{ toolName: "read_file", input: { filename: "FACT.txt" } },
		]);
	});

	it("recovers EVERY call from gemma-4-e2b's actual e2e narration (incl. a list-valued kwarg)", () => {
		// The exact narration gemma-4-e2b emitted in the live e2e sweep (2026-06-28) instead of structured calls.
		const live = [
			"**Step 1: Use read_file to read FACT.txt.**",
			'tool_code = read_file(filename="FACT.txt")',
			"**Step 2: Use run_command to run exactly: cat FACT.txt**",
			'tool_code = run_command(command="cat FACT.txt")',
			'tool_code = create_card(title="E2E-CARD-7777", prompt="from e2e")',
			'tool_code = update_focus_chain(steps_completed=["read_file", "run_command", "create_card"])',
			"All steps complete. The marker is **ECHO-MARKER-7777-XYZ**.",
		].join("\n");
		expect(parseNarratedToolCalls(live)).toEqual([
			{ toolName: "read_file", input: { filename: "FACT.txt" } },
			{ toolName: "run_command", input: { command: "cat FACT.txt" } },
			{ toolName: "create_card", input: { title: "E2E-CARD-7777", prompt: "from e2e" } },
			{ toolName: "update_focus_chain", input: { steps_completed: ["read_file", "run_command", "create_card"] } },
		]);
	});

	it("handles a ```tool_code fence, a `print(default_api.fn(...))` wrapper, and numeric/bool literals", () => {
		const fenced = '```tool_code\nprint(default_api.create_card(title="X", count=2, draft=true))\n```';
		expect(parseNarratedToolCalls(fenced)).toEqual([
			{ toolName: "create_card", input: { title: "X", count: 2, draft: true } },
		]);
	});

	it("does NOT fire without a `tool_code` anchor (a bare Python-looking line in prose is left alone)", () => {
		expect(parseNarratedToolCalls('I would call read_file(filename="x") here.')).toEqual([]);
	});

	it("recovered gemma calls flow through recoverNarratedToolCalls into executable tool-call parts", () => {
		const msg = message({ type: "text", text: 'tool_code = create_card(title="E2E-CARD-7777", prompt="from e2e")' });
		const recovered = recoverNarratedToolCalls(msg);
		expect(recovered).toHaveLength(1);
		expect(recovered[0]).toMatchObject({
			type: "tool-call",
			toolName: "create_card",
			input: { title: "E2E-CARD-7777", prompt: "from e2e" },
		});
		expect(msg.content.some((part) => part.type === "tool-call")).toBe(true);
	});
});

describe("parseNarratedToolCalls — plain-prose `Tool call: name(kwargs)` (gemma-e2b e2e dialect)", () => {
	it("recovers backtick-wrapped prose calls with Python kwargs", () => {
		expect(parseNarratedToolCalls('Tool call: `create_card(title="E2E-CARD-7777", prompt="from e2e")`')).toEqual([
			{ toolName: "create_card", input: { title: "E2E-CARD-7777", prompt: "from e2e" } },
		]);
	});

	it("recovers EVERY call from gemma-e2b's actual e2e prose narration", () => {
		const live = [
			"**Step 1: Use read_file to read FACT.txt.**",
			'Tool call: `read_file(filename="FACT.txt")`',
			"**Step 2: Use run_command to run exactly: cat FACT.txt**",
			'Tool call: `run_command(command="cat FACT.txt")`',
			'Tool call: `create_card(title="E2E-CARD-7777", prompt="from e2e")`',
			"Tool call: `update_focus_chain()`",
			"All steps have been completed successfully. The marker is **ECHO-MARKER-7777-XYZ**.",
		].join("\n");
		expect(parseNarratedToolCalls(live)).toEqual([
			{ toolName: "read_file", input: { filename: "FACT.txt" } },
			{ toolName: "run_command", input: { command: "cat FACT.txt" } },
			{ toolName: "create_card", input: { title: "E2E-CARD-7777", prompt: "from e2e" } },
			{ toolName: "update_focus_chain", input: {} },
		]);
	});

	it("does NOT fire on ordinary prose that merely mentions a tool call (no name+paren)", () => {
		expect(parseNarratedToolCalls("I made a tool call to read the file and it worked.")).toEqual([]);
	});
});

describe("parseToolValidatedNarration — markerless `{tool,parameters}` (≤4B nemotron/gemma dialect)", () => {
	const offered = ["read_file", "run_command", "create_card", "update_focus_chain"];

	it('recovers ```json-fenced {"tool","parameters"} objects whose name is an offered tool', () => {
		// nemotron-3-nano-4b's exact e2e narration: valid JSON objects in fences, no recognized marker.
		const live = [
			"**Step 3: Create card.**",
			"```json",
			'{ "tool": "create_card", "parameters": { "title": "E2E-CARD-7777", "prompt": "from e2e" } }',
			"```",
		].join("\n");
		expect(parseToolValidatedNarration(live, offered)).toEqual([
			{ toolName: "create_card", input: { title: "E2E-CARD-7777", prompt: "from e2e" } },
		]);
	});

	it("recovers EVERY offered-tool object in order", () => {
		const live = [
			'{"tool":"read_file","parameters":{"file_path":"FACT.txt"}}',
			'{"tool":"run_command","parameters":{"command":"cat FACT.txt"}}',
		].join("\n\n");
		expect(parseToolValidatedNarration(live, offered).map((c) => c.toolName)).toEqual(["read_file", "run_command"]);
	});

	it("is SAFE: ignores a JSON object whose name is NOT an offered tool (a coincidental legit answer)", () => {
		expect(parseToolValidatedNarration('{"tool":"delete_everything","parameters":{}}', offered)).toEqual([]);
		expect(parseToolValidatedNarration('{"result":"the answer is 42"}', offered)).toEqual([]);
		expect(parseToolValidatedNarration("plain prose with no json", offered)).toEqual([]);
	});

	it("returns nothing when no tools are offered", () => {
		expect(parseToolValidatedNarration('{"tool":"read_file"}', [])).toEqual([]);
	});
});
