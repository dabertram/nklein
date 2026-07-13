import { describe, expect, it } from "vitest";
import {
	buildConstrainedToolCallSchema,
	parseConstrainedToolCall,
} from "../../../src/nklein-agent/nklein-constrained-tool-call";
import type { LocalLlmToolDefinition } from "../../../src/nklein-agent/nklein-local-llm-client";

const TOOLS: LocalLlmToolDefinition[] = [
	{
		name: "create_card",
		description: "Create a card",
		parameters: {
			type: "object",
			properties: { title: { type: "string" } },
			required: ["title"],
		},
	},
	{
		name: "run_command",
		description: "Run a command",
		parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
	},
];

describe("buildConstrainedToolCallSchema", () => {
	it("returns null when there are no tools", () => {
		expect(buildConstrainedToolCallSchema([])).toBeNull();
	});

	it("default shape constrains `tool` to an enum of the offered names + a generic arguments object", () => {
		const built = buildConstrainedToolCallSchema(TOOLS);
		expect(built).not.toBeNull();
		if (!built) {
			throw new Error("Expected a constrained tool-call schema.");
		}
		expect(built.name).toBe("klein_tool_call");
		expect(built.strict).toBe(true);
		const props = (built.schema as { properties: Record<string, { enum?: string[]; type?: string }> }).properties;
		expect(props.tool.enum).toEqual(["create_card", "run_command"]);
		expect(props.arguments.type).toBe("object");
		expect((built.schema as { required: string[] }).required).toEqual(["tool", "arguments"]);
	});

	it("perToolArguments builds a discriminated anyOf pinning each tool's own parameter schema", () => {
		const built = buildConstrainedToolCallSchema(TOOLS, { perToolArguments: true, schemaName: "custom" });
		if (!built) {
			throw new Error("Expected a per-tool constrained schema.");
		}
		expect(built.name).toBe("custom");
		const branches = (built.schema as { anyOf: Array<{ properties: Record<string, unknown> }> }).anyOf;
		expect(branches).toHaveLength(2);
		const first = branches[0].properties as { tool: { const: string }; arguments: Record<string, unknown> };
		expect(first.tool.const).toBe("create_card");
		expect(first.arguments).toEqual(TOOLS[0].parameters);
	});

	it("normalizes a missing/odd arguments schema to a permissive object branch", () => {
		const weird: LocalLlmToolDefinition[] = [
			{ name: "noargs", description: "", parameters: {} as Record<string, unknown> },
		];
		const built = buildConstrainedToolCallSchema(weird, { perToolArguments: true });
		if (!built) {
			throw new Error("Expected a normalized constrained schema.");
		}
		const branch = (built.schema as { anyOf: Array<{ properties: { arguments: unknown } }> }).anyOf[0];
		expect(branch.properties.arguments).toEqual({ type: "object" });
	});
});

describe("parseConstrainedToolCall", () => {
	it("parses our `{ tool, arguments }` shape into a known call", () => {
		const out = parseConstrainedToolCall('{"tool":"create_card","arguments":{"title":"Hi"}}', TOOLS);
		expect(out).toEqual({ name: "create_card", arguments: { title: "Hi" } });
	});

	it("accepts a bare `{ name, arguments }` and the OpenAI `{ function: { name, arguments } }` shapes", () => {
		expect(parseConstrainedToolCall('{"name":"run_command","arguments":{"command":"ls"}}', TOOLS)).toEqual({
			name: "run_command",
			arguments: { command: "ls" },
		});
		expect(
			parseConstrainedToolCall('{"function":{"name":"run_command","arguments":{"command":"ls"}}}', TOOLS),
		).toEqual({ name: "run_command", arguments: { command: "ls" } });
	});

	it("coerces a JSON-string arguments field (the OpenAI wire form)", () => {
		expect(parseConstrainedToolCall('{"tool":"create_card","arguments":"{\\"title\\":\\"X\\"}"}', TOOLS)).toEqual({
			name: "create_card",
			arguments: { title: "X" },
		});
	});

	it("extracts the first balanced object from surrounding prose / a code fence", () => {
		const prose = 'Sure! Here is the call:\n```json\n{"tool":"create_card","arguments":{"title":"Y"}}\n```\nDone.';
		expect(parseConstrainedToolCall(prose, TOOLS)).toEqual({ name: "create_card", arguments: { title: "Y" } });
	});

	it("returns null for a hallucinated (unoffered) tool name", () => {
		expect(parseConstrainedToolCall('{"tool":"delete_everything","arguments":{}}', TOOLS)).toBeNull();
	});

	it("returns null when there is no JSON object and defaults arguments to {} when missing/malformed", () => {
		expect(parseConstrainedToolCall("no json here", TOOLS)).toBeNull();
		expect(parseConstrainedToolCall('{"tool":"run_command"}', TOOLS)).toEqual({ name: "run_command", arguments: {} });
		expect(parseConstrainedToolCall('{"tool":"run_command","arguments":"not json"}', TOOLS)).toEqual({
			name: "run_command",
			arguments: {},
		});
	});

	it("scans past a non-JSON brace group to reach the real call later in the prose", () => {
		// A weak model narrates set-notation `{1,2}` (a balanced span that is NOT JSON) before the call.
		// The old scanner committed to that first balanced span, failed to parse it, and returned null.
		const content =
			'The set {1,2} is not JSON, but here is the call: {"tool":"run_command","arguments":{"command":"ls"}}';
		expect(parseConstrainedToolCall(content, TOOLS)).toEqual({ name: "run_command", arguments: { command: "ls" } });
	});

	it("skips a decoy inline-argument object and finds the structured call after it", () => {
		// Weak models frequently render the args inline (`{"command":"ls"}`) while narrating, then emit the
		// real `{tool,arguments}` call. The first balanced object has no tool name — keep scanning.
		const content = 'I will run_command({"command":"ls"}) now:\n{"tool":"run_command","arguments":{"command":"ls"}}';
		expect(parseConstrainedToolCall(content, TOOLS)).toEqual({ name: "run_command", arguments: { command: "ls" } });
	});

	it("skips a decoy empty object `{}` and finds the real call", () => {
		const content = 'Thinking... {} Now the call: {"tool":"create_card","arguments":{"title":"Z"}}';
		expect(parseConstrainedToolCall(content, TOOLS)).toEqual({ name: "create_card", arguments: { title: "Z" } });
	});

	it("skips a narrated hallucinated-name object and honors a later offered call", () => {
		const content =
			'I could {"tool":"delete_everything","arguments":{}} but instead {"tool":"create_card","arguments":{"title":"Q"}}';
		expect(parseConstrainedToolCall(content, TOOLS)).toEqual({ name: "create_card", arguments: { title: "Q" } });
	});

	it("still returns null when every candidate names no offered tool", () => {
		expect(parseConstrainedToolCall('nope {1,2} {"tool":"delete_everything"} {}', TOOLS)).toBeNull();
	});
});
