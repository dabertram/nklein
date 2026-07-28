import type { AgentModel, AgentModelEvent, AgentModelRequest } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	createSkillApiProfileAgentModel,
	type SkillApiProfileDirectClient,
} from "../../../src/nklein-agent/skill-api-profile-agent-model";

const request = (): AgentModelRequest => ({
	systemPrompt: "You are a worker.",
	messages: [
		{
			id: "u1",
			role: "user",
			createdAt: 1,
			content: [{ type: "text", text: "Inspect the repository." }],
		},
	],
	tools: [
		{
			name: "read_file",
			description: "Read one file.",
			inputSchema: {
				type: "object",
				properties: { path: { type: "string" } },
				required: ["path"],
				additionalProperties: false,
			},
		},
	],
	options: {},
});

async function collect(model: AgentModel, input: AgentModelRequest): Promise<AgentModelEvent[]> {
	const events: AgentModelEvent[] = [];
	for await (const event of await model.stream(input)) events.push(event);
	return events;
}

function capturingBase(calls: AgentModelRequest[]): AgentModel {
	return {
		stream(input): AsyncIterable<AgentModelEvent> {
			calls.push(input);
			return (async function* () {
				yield { type: "text-delta", text: "fallback" };
				yield { type: "finish", reason: "stop" };
			})();
		},
	};
}

describe("createSkillApiProfileAgentModel (F4.15)", () => {
	it("is an identity pass-through for an empty profile", () => {
		const base = capturingBase([]);
		expect(createSkillApiProfileAgentModel(base, { modelId: "qwen/qwen3-8b", profile: {} })).toBe(base);
	});

	it("applies thinking, sampler, and proactive answer-budget policy on every SDK request", async () => {
		const calls: AgentModelRequest[] = [];
		const model = createSkillApiProfileAgentModel(capturingBase(calls), {
			modelId: "qwen/qwen3-8b",
			profile: { reasoning: "high", temperature: 0.1 },
			contextWindow: 32_000,
		});
		await collect(model, request());
		expect(calls).toHaveLength(1);
		expect(calls[0]?.options?.temperature).toBe(0.1);
		expect(calls[0]?.options?.thinking).toBe(true);
		expect(calls[0]?.options?.maxTokens).toBeGreaterThan(1_024);
		const text = calls[0]?.messages[0]?.content.find((part) => part.type === "text");
		expect(text?.type === "text" ? text.text : "").toContain("/think");
	});

	it("uses response_format first for a recognized non-reasoning model", async () => {
		const baseCalls: AgentModelRequest[] = [];
		let formatName: string | undefined;
		const direct: SkillApiProfileDirectClient = {
			completeWithTools: async () => {
				throw new Error("native path must not run");
			},
			complete: async (input) => {
				formatName = input.format?.jsonSchema?.name;
				return { content: '{"tool":"read_file","arguments":{"path":"todo.md"}}' };
			},
		};
		const model = createSkillApiProfileAgentModel(capturingBase(baseCalls), {
			modelId: "qwen/qwen2.5-coder-14b",
			profile: { structuredOutput: true },
			directClient: direct,
		});
		const events = await collect(model, request());
		expect(formatName).toBe("klein_tool_call");
		expect(events.find((event) => event.type === "tool-call-delta")).toMatchObject({
			toolName: "read_file",
		});
		expect(baseCalls).toEqual([]);
	});

	it("keeps the assistant text that accompanies a forced tool call (§12 nightly regression)", async () => {
		// 2026-07-28: the forced path emitted ONLY the tool call — `completion.content` (a model explaining
		// itself, or re-raising a contested question, alongside its call) was silently dropped, so the transcript,
		// the UI, and the turn-loop guard never saw it. The guard was structurally blind to text+tool-call loops.
		const question = "Before I write the file — should I use vitest here, or keep the acceptance as specified?";
		const direct: SkillApiProfileDirectClient = {
			completeWithTools: async () => ({
				content: question,
				toolCalls: [{ id: "call_1", name: "read_file", arguments: { path: "todo.md" } }],
				finishReason: "tool_calls",
				raw: {},
			}),
			complete: async () => ({ content: "" }),
		};
		const model = createSkillApiProfileAgentModel(capturingBase([]), {
			modelId: "deepseek-r1-0528-qwen3-8b",
			profile: { structuredOutput: true },
			directClient: direct,
		});
		const events = await collect(model, request());
		const textEvent = events.find((event) => event.type === "text-delta");
		expect(textEvent?.type === "text-delta" ? textEvent.text : "").toBe(question);
		// The text must precede the tool call so the assembled assistant message reads text-then-action.
		expect(events.findIndex((event) => event.type === "text-delta")).toBeLessThan(
			events.findIndex((event) => event.type === "tool-call-delta"),
		);
		expect(events.find((event) => event.type === "tool-call-delta")).toMatchObject({ toolName: "read_file" });
	});

	it("emits no empty text event when a forced tool call has no accompanying content", async () => {
		const direct: SkillApiProfileDirectClient = {
			completeWithTools: async () => ({
				content: "  ",
				toolCalls: [{ id: "call_1", name: "read_file", arguments: { path: "todo.md" } }],
				finishReason: "tool_calls",
				raw: {},
			}),
			complete: async () => ({ content: "" }),
		};
		const model = createSkillApiProfileAgentModel(capturingBase([]), {
			modelId: "deepseek-r1-0528-qwen3-8b",
			profile: { structuredOutput: true },
			directClient: direct,
		});
		const events = await collect(model, request());
		expect(events.some((event) => event.type === "text-delta")).toBe(false);
		expect(events.find((event) => event.type === "tool-call-delta")).toMatchObject({ toolName: "read_file" });
	});

	it("uses native tool_choice required for a reasoning model and falls back safely on an empty direct result", async () => {
		const baseCalls: AgentModelRequest[] = [];
		let toolChoice: string | undefined;
		const direct: SkillApiProfileDirectClient = {
			completeWithTools: async (_input, _tools, opts) => {
				toolChoice = opts?.toolChoice;
				return { content: "", toolCalls: [], finishReason: "stop", raw: {} };
			},
			complete: async () => ({ content: "" }),
		};
		const model = createSkillApiProfileAgentModel(capturingBase(baseCalls), {
			modelId: "deepseek-r1-0528-qwen3-8b",
			profile: { structuredOutput: true },
			directClient: direct,
		});
		const events = await collect(model, request());
		expect(toolChoice).toBe("required");
		expect(baseCalls).toHaveLength(1);
		expect(events.some((event) => event.type === "text-delta")).toBe(true);
	});
});
