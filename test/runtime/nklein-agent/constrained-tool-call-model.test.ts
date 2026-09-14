import type { AgentModel, AgentModelEvent, AgentModelRequest, AgentToolDefinition } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	CONSTRAINED_TOOL_CALL_CONTEXT_KEY,
	ConstrainedToolCallNoCallError,
	type ConstrainedToolCallObservation,
	constrainedToolCallReask,
	createConstrainedToolCallModel,
	readConstrainedToolCallContext,
} from "../../../src/nklein-agent/constrained-tool-call-model";
import type { LocalLlmToolCompletion, LocalLlmToolDefinition } from "../../../src/nklein-agent/nklein-local-llm-client";
import type { SkillApiProfileDirectClient } from "../../../src/nklein-agent/skill-api-profile-agent-model";

/**
 * P23.5 (2): the constrained_schema rung on the swarm path. Native forcing first (the model fills the arguments
 * itself), the per-tool json_schema second (the grammar makes the required fields present), every result judged by
 * the shared argument assessor before it is emitted.
 */
const writeFile: AgentToolDefinition = {
	name: "write_file",
	description: "write a file",
	inputSchema: {
		type: "object",
		properties: { path: { type: "string" }, content: { type: "string" } },
		required: ["path", "content"],
	},
};

type NativeCall = Parameters<SkillApiProfileDirectClient["completeWithTools"]>;
type SchemaCall = Parameters<SkillApiProfileDirectClient["complete"]>;

function client(script: {
	native?: (...args: NativeCall) => Promise<Omit<LocalLlmToolCompletion, "raw">>;
	schema?: (...args: SchemaCall) => ReturnType<SkillApiProfileDirectClient["complete"]>;
}): SkillApiProfileDirectClient & { nativeCalls: NativeCall[]; schemaCalls: SchemaCall[] } {
	const nativeCalls: NativeCall[] = [];
	const schemaCalls: SchemaCall[] = [];
	return {
		nativeCalls,
		schemaCalls,
		completeWithTools: async (...args) => {
			nativeCalls.push(args);
			const completion = script.native
				? await script.native(...args)
				: { content: "", toolCalls: [], finishReason: "stop", reasoningTokens: null };
			return { raw: null, ...completion };
		},
		complete: async (...args) => {
			schemaCalls.push(args);
			return script.schema ? script.schema(...args) : { content: "" };
		},
	};
}

function request(overrides: Partial<AgentModelRequest> = {}): AgentModelRequest {
	return {
		systemPrompt: "system",
		messages: [
			{
				id: "u1",
				role: "user",
				createdAt: 1,
				content: [{ type: "text", text: "Write src/a.ts with `export const a = 1;`" }],
			},
			{
				id: "a1",
				role: "assistant",
				createdAt: 2,
				content: [{ type: "tool-call", toolCallId: "w0", toolName: "write_file", input: {} }],
			},
			{
				id: "u2",
				role: "user",
				createdAt: 3,
				content: [{ type: "tool-result", toolCallId: "w0", toolName: "write_file", output: "path is required" }],
			},
		],
		tools: [writeFile],
		options: {
			temperature: 0.2,
			maxTokens: 900,
			metadata: {
				[CONSTRAINED_TOOL_CALL_CONTEXT_KEY]: {
					toolName: "write_file",
					fieldsToReask: ["path", "content"],
					reason: "re-ask 2 required field(s): path, content",
				},
			},
		},
		...overrides,
	};
}

async function collect(model: AgentModel, input: AgentModelRequest): Promise<AgentModelEvent[]> {
	const events: AgentModelEvent[] = [];
	for await (const event of await model.stream(input)) events.push(event);
	return events;
}

describe("createConstrainedToolCallModel", () => {
	it("forces the call natively first and emits the model's own usable arguments", async () => {
		const direct = client({
			native: async () => ({
				content: "Writing the file now.",
				toolCalls: [
					{ id: "n1", name: "write_file", arguments: { path: "src/a.ts", content: "export const a = 1;" } },
				],
				finishReason: "tool_calls",
				reasoningTokens: null,
			}),
		});
		const observations: ConstrainedToolCallObservation[] = [];
		const model = createConstrainedToolCallModel({
			directClient: direct,
			modelId: "qwen/qwen3.8-27b",
			onObservation: (observation) => observations.push(observation),
		});

		const events = await collect(model, request());
		expect(events).toEqual([
			{ type: "text-delta", text: "Writing the file now." },
			{
				type: "tool-call-delta",
				toolCallId: "n1",
				toolName: "write_file",
				input: { path: "src/a.ts", content: "export const a = 1;" },
				inputText: '{"path":"src/a.ts","content":"export const a = 1;"}',
			},
			{ type: "finish", reason: "tool-calls" },
		]);
		// Native forcing: the offered tool, tool_choice required, the request's sampling, the re-ask merged into the
		// trailing user turn (alternation-safe), naming the tool and the missing fields.
		const [wire, tools, opts] = direct.nativeCalls[0] as NativeCall;
		expect(tools.map((tool: LocalLlmToolDefinition) => tool.name)).toEqual(["write_file"]);
		expect(opts).toEqual({ toolChoice: "required" });
		expect(wire.sampling).toEqual({ temperature: 0.2, maxTokens: 900 });
		expect(wire.messages[0]).toEqual({ role: "system", content: "system" });
		const last = wire.messages.at(-1);
		expect(last?.role).toBe("user");
		expect(last?.content).toContain("path is required");
		expect(last?.content).toContain("Your previous `write_file` call carried no usable arguments.");
		expect(last?.content).toContain("missing or unusable for: path, content");
		expect(direct.schemaCalls).toHaveLength(0);
		expect(observations).toEqual([
			{
				rung: "native_tool_choice",
				toolName: "write_file",
				verdict: "usable",
				reason: "arguments satisfy the schema",
				usable: true,
			},
		]);
	});

	it("falls to the per-tool json_schema when the native call is still empty", async () => {
		const direct = client({
			native: async () => ({
				content: "",
				toolCalls: [{ id: "n1", name: "write_file", arguments: {} }],
				finishReason: "tool_calls",
				reasoningTokens: null,
			}),
			schema: async () => ({
				content: '{"tool":"write_file","arguments":{"path":"src/a.ts","content":"export const a = 1;"}}',
			}),
		});
		const observations: ConstrainedToolCallObservation[] = [];
		const model = createConstrainedToolCallModel({
			directClient: direct,
			modelId: "qwen/qwen3.8-27b",
			baseMaxTokens: 2_000,
			onObservation: (observation) => observations.push(observation),
		});

		const events = await collect(model, request({ options: { metadata: {} } }));
		expect(events[0]).toMatchObject({
			type: "tool-call-delta",
			toolName: "write_file",
			input: { path: "src/a.ts", content: "export const a = 1;" },
		});
		expect(events.at(-1)).toEqual({ type: "finish", reason: "tool-calls" });
		const [schemaWire] = direct.schemaCalls[0] as SchemaCall;
		// The per-tool schema pins the tool name AND its own parameter schema — the grammar cannot emit `{}`.
		expect(schemaWire.format?.jsonSchema?.name).toBe("klein_constrained_tool_call");
		expect(JSON.stringify(schemaWire.format?.jsonSchema?.schema)).toContain('"const":"write_file"');
		expect(JSON.stringify(schemaWire.format?.jsonSchema?.schema)).toContain('"required":["path","content"]');
		// No context on the request: the re-ask still names the (only) offered tool; maxTokens comes from the base.
		expect(schemaWire.sampling).toEqual({ maxTokens: 2_000 });
		expect(schemaWire.messages.at(-1)?.content).toContain(
			"Your previous `write_file` call carried no usable arguments.",
		);
		expect(observations.map((observation) => [observation.rung, observation.usable])).toEqual([
			["native_tool_choice", false],
			["json_schema", true],
		]);
	});

	it("emits the still-unusable call when both steps fail, so the classifier judges it malformed again", async () => {
		const direct = client({
			native: async () => ({
				content: "",
				toolCalls: [{ id: "n1", name: "write_file", arguments: { path: "src/a.ts" } }],
				finishReason: "tool_calls",
				reasoningTokens: null,
			}),
			schema: async () => ({ content: '{"tool":"write_file","arguments":{"path":""}}' }),
		});
		const model = createConstrainedToolCallModel({ directClient: direct, modelId: "m" });
		const events = await collect(model, request());
		// The json_schema attempt returned last and IS a call (path present, content missing) — it is what gets emitted.
		expect(events).toHaveLength(2);
		expect(events[0]).toMatchObject({ type: "tool-call-delta", toolName: "write_file", input: { path: "" } });
		expect(events[1]).toEqual({ type: "finish", reason: "tool-calls" });
	});

	it("throws the typed no-call error when neither step produced any call", async () => {
		const direct = client({ schema: async () => ({ content: "I cannot do that." }) });
		const model = createConstrainedToolCallModel({ directClient: direct, modelId: "m" });
		await expect(collect(model, request())).rejects.toBeInstanceOf(ConstrainedToolCallNoCallError);
		expect(direct.nativeCalls).toHaveLength(1);
		expect(direct.schemaCalls).toHaveLength(1);
	});

	it("applies a lossless repair to the forced call instead of re-forcing", async () => {
		const direct = client({
			native: async () => ({
				content: "",
				toolCalls: [{ id: "n1", name: "write_file", arguments: { path: "src/a.ts", content: "x", extra: true } }],
				finishReason: "tool_calls",
				reasoningTokens: null,
			}),
		});
		const model = createConstrainedToolCallModel({ directClient: direct, modelId: "m" });
		const events = await collect(model, request());
		expect(events[0]).toMatchObject({ input: { path: "src/a.ts", content: "x" } });
		expect(direct.schemaCalls).toHaveLength(0);
	});

	it("never calls the wire for an aborted request or a turn without tools", async () => {
		const direct = client({});
		const model = createConstrainedToolCallModel({ directClient: direct, modelId: "m" });
		const controller = new AbortController();
		controller.abort(new Error("cancelled"));
		await expect(collect(model, request({ signal: controller.signal }))).rejects.toThrow("cancelled");
		await expect(collect(model, request({ tools: [] }))).rejects.toBeInstanceOf(ConstrainedToolCallNoCallError);
		expect(direct.nativeCalls).toHaveLength(0);
		expect(direct.schemaCalls).toHaveLength(0);
	});

	it("observation failures never alter the recovery", async () => {
		const direct = client({
			native: async () => ({
				content: "",
				toolCalls: [{ id: "n1", name: "write_file", arguments: { path: "a", content: "b" } }],
				finishReason: "tool_calls",
				reasoningTokens: null,
			}),
		});
		const model = createConstrainedToolCallModel({
			directClient: direct,
			modelId: "m",
			onObservation: vi.fn(() => {
				throw new Error("telemetry down");
			}),
		});
		expect((await collect(model, request())).at(-1)).toEqual({ type: "finish", reason: "tool-calls" });
	});
});

describe("constrained tool-call context", () => {
	it("round-trips through request metadata and tolerates junk", () => {
		expect(readConstrainedToolCallContext(request())).toEqual({
			toolName: "write_file",
			fieldsToReask: ["path", "content"],
			reason: "re-ask 2 required field(s): path, content",
		});
		expect(readConstrainedToolCallContext(request({ options: {} }))).toBeNull();
		expect(
			readConstrainedToolCallContext(
				request({ options: { metadata: { [CONSTRAINED_TOOL_CALL_CONTEXT_KEY]: { toolName: "" } } } }),
			),
		).toBeNull();
		expect(
			readConstrainedToolCallContext(
				request({
					options: {
						metadata: { [CONSTRAINED_TOOL_CALL_CONTEXT_KEY]: { toolName: "x", fieldsToReask: [1, "p"] } },
					},
				}),
			),
		).toEqual({ toolName: "x", fieldsToReask: ["p"], reason: "" });
	});

	it("words the re-ask for the model that just emitted the call without arguments", () => {
		expect(constrainedToolCallReask(null, ["write_file"])).toContain("Your previous `write_file` call");
		expect(
			constrainedToolCallReask({ toolName: "edit_file", fieldsToReask: [], reason: "not an object" }, []),
		).toContain("(not an object)");
	});
});
