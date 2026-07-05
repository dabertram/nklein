import { describe, expect, it } from "vitest";
import { assessToolArgumentRepair, ToolArgumentVerdict } from "../../../src/core/tool-argument-repair";
import type { LocalLlmToolDefinition } from "../../../src/nklein-agent/nklein-local-llm-client";
import { parseNarratedToolCalls } from "../../../src/nklein-agent/nklein-narrated-tool-call";
import { detectResponseLoop } from "../../../src/nklein-agent/nklein-response-loop-detection";

// Regression tests for the 5 defects the model-robustness/retry bug-hunt confirmed (2026-07-05).

describe("bug #1 — repairCommon preserves apostrophes inside a double-quoted value (does not drop the call)", () => {
	it("recovers a narrated tool call whose value has apostrophes + a trailing comma", () => {
		const text = `<tool_call>{"name":"create_card","arguments":{"body":"don't break the 'build' step",}}</tool_call>`;
		const calls = parseNarratedToolCalls(text);
		expect(calls).toHaveLength(1);
		expect(calls[0].toolName).toBe("create_card");
		expect(calls[0].input).toEqual({ body: "don't break the 'build' step" });
	});
});

describe("bug #2 — Gemma tool_code parsing is string-aware (a `tool_code` inside an arg doesn't truncate the call)", () => {
	it("recovers a call whose argument value contains the literal tool_code", () => {
		const calls = parseNarratedToolCalls('tool_code = run_command(command="grep tool_code .")');
		expect(calls).toHaveLength(1);
		expect(calls[0].toolName).toBe("run_command");
		expect(calls[0].input).toEqual({ command: "grep tool_code ." });
	});

	it("recovers BOTH calls in a multi-call turn where an argument mentions tool_code", () => {
		const calls = parseNarratedToolCalls(
			'tool_code = run_command(command="grep tool_code .")\ntool_code = create_card(title="Y")',
		);
		expect(calls.map((c) => c.toolName)).toEqual(["run_command", "create_card"]);
	});
});

describe("bug #3 — a required field with no `properties` entry is kept, not dropped as unknown", () => {
	const tool: LocalLlmToolDefinition = {
		name: "note",
		description: "",
		parameters: { type: "object", properties: { other: { type: "string" } }, required: ["x"] },
	};

	it("keeps a present required field even though the schema declares no property for it", () => {
		const result = assessToolArgumentRepair({ name: "note", arguments: { x: "hello", other: "y" } }, tool);
		expect(result.verdict).not.toBe(ToolArgumentVerdict.Reject);
		expect(result.fieldsToReask).not.toContain("x"); // x was NOT dropped-then-flagged-missing
		const effective = result.repairedArguments ?? { x: "hello", other: "y" };
		expect(effective.x).toBe("hello");
	});
});

describe("bug #4 — number coercion only accepts plain decimals (no hex/octal/binary/scientific)", () => {
	const tool: LocalLlmToolDefinition = {
		name: "n",
		description: "",
		parameters: { type: "object", properties: { count: { type: "integer" } }, required: ["count"] },
	};

	it("does NOT fabricate 16 from the string '0x10' — flags it for re-ask instead", () => {
		const result = assessToolArgumentRepair({ name: "n", arguments: { count: "0x10" } }, tool);
		expect(result.repairedArguments?.count).not.toBe(16);
		expect(result.fieldsToReask).toContain("count");
	});

	it("still coerces a plain decimal string '16' → 16", () => {
		const result = assessToolArgumentRepair({ name: "n", arguments: { count: "16" } }, tool);
		expect(result.verdict).toBe(ToolArgumentVerdict.Repairable);
		expect(result.repairedArguments?.count).toBe(16);
	});
});

describe("bug #5 — detectResponseLoop reports the true smallest period + exact repeats + one-occurrence salvage", () => {
	it("reduces a detected multiple to its minimal cycle", () => {
		const text = "go. ".repeat(40); // period 4, 160 chars; detected via a 12-char multiple, reported as the period
		const result = detectResponseLoop(text, { minUnitLen: 12, minRepeats: 4 });
		expect(result.looping).toBe(true);
		expect(result.repeatedUnit).toBe("go.");
		expect(result.repeats).toBe(40);
		expect(result.salvagedText).toBe("go."); // one occurrence, not several
	});
});
