import { describe, expect, it } from "vitest";
import {
	classifyNarrationDialect,
	isRecoverableNarration,
	NarrationDialect,
} from "../../../src/core/narration-dialect";

const TOOLS = ["read_file", "run_command", "create_card", "update_focus_chain"];

describe("classifyNarrationDialect — structured-marker families (recovered + labelled)", () => {
	it("labels Hermes/Qwen `<tool_call>` and recovers the call", () => {
		const verdict = classifyNarrationDialect(
			'<tool_call>{"name": "read_file", "arguments": {"path": "a.txt"}}</tool_call>',
		);
		expect(verdict.dialect).toBe(NarrationDialect.HermesQwen);
		expect(verdict.recoverable).toBe(true);
		expect(verdict.hasStructuredMarker).toBe(true);
		expect(verdict.recoveredCalls).toEqual([{ toolName: "read_file", input: { path: "a.txt" } }]);
	});

	it("labels the pipe-delimited `<|tool_call|>` variant as Hermes/Qwen", () => {
		const verdict = classifyNarrationDialect('<|tool_call|>{"name": "create_card", "arguments": {"title": "X"}}');
		expect(verdict.dialect).toBe(NarrationDialect.HermesQwen);
		expect(verdict.recoverable).toBe(true);
	});

	it("labels Phi `[TOOL_REQUEST]` distinctly from Mistral (both are bracket markers)", () => {
		const verdict = classifyNarrationDialect(
			'[TOOL_REQUEST]{"name": "run_command", "arguments": {"cmd": "ls"}}[END_TOOL_REQUEST]',
		);
		expect(verdict.dialect).toBe(NarrationDialect.Phi);
		expect(verdict.recoverable).toBe(true);
		expect(verdict.recoveredCalls[0]?.toolName).toBe("run_command");
	});

	it("labels Mistral `[TOOL_CALLS]` (a JSON array of calls)", () => {
		const verdict = classifyNarrationDialect('[TOOL_CALLS][{"name": "read_file", "arguments": {"path": "b.txt"}}]');
		expect(verdict.dialect).toBe(NarrationDialect.Mistral);
		expect(verdict.recoverable).toBe(true);
		expect(verdict.recoveredCalls[0]?.toolName).toBe("read_file");
	});

	it("labels Llama `<|python_tag|>`", () => {
		const verdict = classifyNarrationDialect('<|python_tag|>{"name": "create_card", "arguments": {"title": "L"}}');
		expect(verdict.dialect).toBe(NarrationDialect.LlamaPythonTag);
		expect(verdict.recoverable).toBe(true);
	});

	it("labels the Functionary `<function=NAME>{args}</function>` tag (name in the tag)", () => {
		const verdict = classifyNarrationDialect('<function=create_card>{"title": "F"}</function>');
		expect(verdict.dialect).toBe(NarrationDialect.FunctionaryTag);
		expect(verdict.recoverable).toBe(true);
		expect(verdict.recoveredCalls).toEqual([{ toolName: "create_card", input: { title: "F" } }]);
	});

	it("labels the DeepSeek special-token format (name outside the JSON, fenced args)", () => {
		const text =
			'<｜tool▁call▁begin｜>function<｜tool▁sep｜>read_file\n```json\n{"path": "d.txt"}\n```<｜tool▁call▁end｜>';
		const verdict = classifyNarrationDialect(text);
		expect(verdict.dialect).toBe(NarrationDialect.DeepSeek);
		expect(verdict.recoverable).toBe(true);
		expect(verdict.recoveredCalls[0]?.toolName).toBe("read_file");
	});

	it("labels the ASCII-normalized DeepSeek variant (`<|tool_call_begin|>`, `tool_sep`)", () => {
		const text = '<|tool_call_begin|>function<|tool_sep|>run_command\n```json\n{"cmd": "pwd"}\n```<|tool_call_end|>';
		const verdict = classifyNarrationDialect(text);
		expect(verdict.dialect).toBe(NarrationDialect.DeepSeek);
		expect(verdict.recoverable).toBe(true);
	});
});

describe("classifyNarrationDialect — marker-less families", () => {
	it("labels the Gemma `tool_code` Python narration", () => {
		const verdict = classifyNarrationDialect('tool_code = read_file(filename="FACT.txt")');
		expect(verdict.dialect).toBe(NarrationDialect.GemmaToolCode);
		expect(verdict.recoverable).toBe(true);
		expect(verdict.hasStructuredMarker).toBe(false);
		expect(verdict.recoveredCalls).toEqual([{ toolName: "read_file", input: { filename: "FACT.txt" } }]);
	});

	it("labels the Gemma `tool_code` fenced form with a list kwarg", () => {
		const verdict = classifyNarrationDialect("```tool_code\nupdate_focus_chain(steps_completed=[1, 2])\n```");
		expect(verdict.dialect).toBe(NarrationDialect.GemmaToolCode);
		expect(verdict.recoverable).toBe(true);
		expect(verdict.recoveredCalls[0]).toEqual({ toolName: "update_focus_chain", input: { steps_completed: [1, 2] } });
	});

	it("labels the plain-prose `Tool call: name(args)` dialect (gemma-e2b e2e leak)", () => {
		const verdict = classifyNarrationDialect('Tool call: `create_card(title="E2E-CARD-7777", prompt="from e2e")`');
		expect(verdict.dialect).toBe(NarrationDialect.PlainProse);
		expect(verdict.recoverable).toBe(true);
		expect(verdict.hasStructuredMarker).toBe(false);
		expect(verdict.recoveredCalls).toEqual([
			{ toolName: "create_card", input: { title: "E2E-CARD-7777", prompt: "from e2e" } },
		]);
	});
});

describe("classifyNarrationDialect — offered-tool-gated bare JSON (§5.O safety)", () => {
	it("labels a bare object naming an OFFERED tool as tool_validated_json (with the offered set)", () => {
		const verdict = classifyNarrationDialect('{"tool": "create_card", "parameters": {"title": "B"}}', TOOLS);
		expect(verdict.dialect).toBe(NarrationDialect.ToolValidatedJson);
		expect(verdict.recoverable).toBe(true);
		expect(verdict.hasStructuredMarker).toBe(false);
		expect(verdict.recoveredCalls).toEqual([{ toolName: "create_card", input: { title: "B" } }]);
	});

	it("recovers a ```json-fenced offered-tool object", () => {
		const verdict = classifyNarrationDialect(
			'```json\n{"tool_name": "read_file", "args": {"path": "z"}}\n```',
			TOOLS,
		);
		expect(verdict.dialect).toBe(NarrationDialect.ToolValidatedJson);
		expect(verdict.recoveredCalls[0]?.toolName).toBe("read_file");
	});

	it("does NOT recover bare JSON when the offered set is omitted (bare JSON is too easily a legit answer)", () => {
		const verdict = classifyNarrationDialect('{"tool": "create_card", "parameters": {"title": "B"}}');
		expect(verdict.dialect).toBe(NarrationDialect.None);
		expect(verdict.recoverable).toBe(false);
	});

	it("does NOT recover a bare object naming an UNOFFERED tool (a coincidental JSON answer)", () => {
		const verdict = classifyNarrationDialect('{"tool": "not_a_tool", "parameters": {"x": 1}}', TOOLS);
		expect(verdict.dialect).toBe(NarrationDialect.None);
		expect(verdict.recoverable).toBe(false);
	});
});

describe("classifyNarrationDialect — none / non-recoverable (evidence, not a phantom call)", () => {
	it("returns none for empty / whitespace text", () => {
		for (const empty of ["", "   ", "\n\t "]) {
			const verdict = classifyNarrationDialect(empty, TOOLS);
			expect(verdict.dialect).toBe(NarrationDialect.None);
			expect(verdict.recoverable).toBe(false);
			expect(verdict.recoveredCalls).toEqual([]);
		}
	});

	it("returns none for an ordinary prose answer (no marker, no call shape)", () => {
		const verdict = classifyNarrationDialect(
			"I read the file and it contains the configuration for the service. Everything looks correct.",
			TOOLS,
		);
		expect(verdict.dialect).toBe(NarrationDialect.None);
		expect(verdict.recoverable).toBe(false);
	});

	it("does not treat prose that merely MENTIONS a tool call as a plain-prose dialect", () => {
		const verdict = classifyNarrationDialect(
			"Next I would make a tool call to read the file, but let me think first.",
		);
		expect(verdict.dialect).toBe(NarrationDialect.None);
		expect(verdict.recoverable).toBe(false);
	});

	it("returns none (unrecoverable) when a marker is present but the payload is unparseable garbage", () => {
		const verdict = classifyNarrationDialect("<tool_call> not json at all, no name here </tool_call>");
		expect(verdict.dialect).toBe(NarrationDialect.None);
		expect(verdict.recoverable).toBe(false);
		expect(verdict.reason).toMatch(/unrecoverable/i);
	});
});

describe("classifyNarrationDialect — precedence when signals overlap", () => {
	it("prefers the specific marker family over the offered-JSON family", () => {
		// A `<tool_call>` block whose JSON also names an offered tool: the marker family is the more precise label.
		const verdict = classifyNarrationDialect('<tool_call>{"name": "read_file", "arguments": {}}</tool_call>', TOOLS);
		expect(verdict.dialect).toBe(NarrationDialect.HermesQwen);
	});

	it("classifies a `<tool_call>` block that incidentally contains `tool_code` as the marker family, not Gemma", () => {
		const verdict = classifyNarrationDialect(
			'<tool_call>{"name": "run_command", "arguments": {"cmd": "cat tool_code.py"}}</tool_call>',
		);
		expect(verdict.dialect).toBe(NarrationDialect.HermesQwen);
		expect(verdict.recoverable).toBe(true);
	});

	it("classifies DeepSeek before the generic Hermes `tool_call` (its token also matches loosely)", () => {
		const text = "<｜tool▁call▁begin｜>function<｜tool▁sep｜>read_file\n```json\n{}\n```<｜tool▁call▁end｜>";
		const verdict = classifyNarrationDialect(text);
		expect(verdict.dialect).toBe(NarrationDialect.DeepSeek);
	});

	it("recovers a call hidden after prose (reasoning + content concatenated by the caller)", () => {
		const text =
			'Let me call the tool now.\n<tool_call>{"name": "create_card", "arguments": {"title": "P"}}</tool_call>';
		const verdict = classifyNarrationDialect(text, TOOLS);
		expect(verdict.dialect).toBe(NarrationDialect.HermesQwen);
		expect(verdict.recoveredCalls[0]?.toolName).toBe("create_card");
	});
});

describe("isRecoverableNarration — convenience predicate", () => {
	it("is true for a recoverable narration", () => {
		expect(isRecoverableNarration('<tool_call>{"name": "read_file", "arguments": {}}</tool_call>')).toBe(true);
		expect(isRecoverableNarration('tool_code = read_file(filename="x")')).toBe(true);
		expect(isRecoverableNarration('{"tool": "read_file", "parameters": {}}', TOOLS)).toBe(true);
	});

	it("is false for a genuine answer / unrecoverable stall / gated-off bare JSON", () => {
		expect(isRecoverableNarration("Everything looks correct, no action needed.")).toBe(false);
		expect(isRecoverableNarration("<tool_call> garbage </tool_call>")).toBe(false);
		expect(isRecoverableNarration('{"tool": "read_file", "parameters": {}}')).toBe(false);
	});
});
