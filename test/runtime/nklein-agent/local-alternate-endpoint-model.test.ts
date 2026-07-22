import type { AgentMessage, AgentModelEvent, AgentModelRequest } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	agentMessageToEndpointText,
	createLocalAlternateEndpointModel,
} from "../../../src/nklein-agent/local-alternate-endpoint-model";

async function collect(model: ReturnType<typeof createLocalAlternateEndpointModel>, request: AgentModelRequest) {
	const events: AgentModelEvent[] = [];
	for await (const event of await model.stream(request)) events.push(event);
	return events;
}

describe("local alternate endpoint AgentModel", () => {
	it("preserves completed tool identity in the endpoint transcript", () => {
		const message: AgentMessage = {
			id: "u1",
			role: "user",
			createdAt: 1,
			content: [{ type: "tool-result", toolCallId: "read-1", toolName: "read_file", output: { text: "evidence" } }],
		};
		expect(agentMessageToEndpointText(message)).toContain("tool_result id=read-1 name=read_file");
		expect(agentMessageToEndpointText(message)).toContain('"evidence"');
	});

	it("skips native when tools are required and emits a forced Messages tool call", async () => {
		const urls: string[] = [];
		const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			urls.push(url);
			if (url.endsWith("/api/v1/chat")) {
				return new Response(JSON.stringify({ output: [{ type: "message", content: "prose only" }] }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			const body = JSON.parse(String(init?.body)) as { tool_choice?: { type?: string }; messages?: unknown[] };
			expect(body.tool_choice).toEqual({ type: "any" });
			expect(JSON.stringify(body.messages)).toContain("tool_result id=read-1");
			return new Response(
				JSON.stringify({
					content: [{ type: "tool_use", id: "submit-1", name: "submit_review", input: { verdict: "approve" } }],
					stop_reason: "tool_use",
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		const onWinningKind = vi.fn();
		const model = createLocalAlternateEndpointModel({
			baseUrl: "http://127.0.0.1:1234/v1",
			modelId: "local-model",
			fetchImpl: fetchImpl as typeof fetch,
			onWinningKind,
		});
		const request: AgentModelRequest = {
			systemPrompt: "judge",
			messages: [
				{
					id: "u1",
					role: "user",
					createdAt: 1,
					content: [{ type: "tool-result", toolCallId: "read-1", toolName: "read_file", output: "evidence" }],
				},
			],
			tools: [{ name: "submit_review", description: "submit", inputSchema: { type: "object" } }],
		};

		expect(await collect(model, request)).toEqual([
			{
				type: "tool-call-delta",
				toolCallId: "submit-1",
				toolName: "submit_review",
				inputText: '{"verdict":"approve"}',
			},
			{ type: "finish", reason: "tool-calls" },
		]);
		expect(urls).toEqual(["http://127.0.0.1:1234/v1/messages"]);
		expect(onWinningKind).toHaveBeenCalledWith("anthropic_messages");
	});

	it("uses the native endpoint first for a prose-only recovery turn", async () => {
		const urls: string[] = [];
		const fetchImpl = vi.fn(async (input: string | URL | Request) => {
			urls.push(String(input));
			return new Response(JSON.stringify({ output: [{ type: "message", content: "recovered" }] }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		});
		const model = createLocalAlternateEndpointModel({
			baseUrl: "http://127.0.0.1:1234/v1",
			modelId: "local-model",
			fetchImpl: fetchImpl as typeof fetch,
		});
		const proseRequest: AgentModelRequest = {
			systemPrompt: "answer",
			messages: [{ id: "u1", role: "user", createdAt: 1, content: [{ type: "text", text: "Reply." }] }],
			tools: [],
		};

		expect(await collect(model, proseRequest)).toEqual([
			{ type: "text-delta", text: "recovered" },
			{ type: "finish", reason: "stop" },
		]);
		expect(urls).toEqual(["http://127.0.0.1:1234/api/v1/chat"]);
	});

	it("chains a verified native response id and sends only the new transcript delta", async () => {
		const bodies: Array<Record<string, unknown>> = [];
		const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			bodies.push(body);
			const turn = bodies.length;
			return new Response(
				JSON.stringify({
					output: [{ type: "message", content: turn === 1 ? "First answer" : "Second answer" }],
					response_id: `resp_${turn}`,
					stats: {},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		const observations: string[] = [];
		const model = createLocalAlternateEndpointModel({
			baseUrl: "http://127.0.0.1:1234/v1",
			modelId: "local-model",
			fetchImpl: fetchImpl as typeof fetch,
			onNativeSessionObservation: (observation) => observations.push(observation.type),
		});
		const first: AgentModelRequest = {
			systemPrompt: "answer",
			messages: [
				{ id: "u1", role: "user", createdAt: 1, content: [{ type: "text", text: "First" }] },
				{
					id: "nklein-retry-2",
					role: "user",
					createdAt: 2,
					content: [{ type: "text", text: "First retry instruction" }],
				},
			],
			tools: [],
		};
		expect(await collect(model, first)).toContainEqual({ type: "text-delta", text: "First answer" });
		const second: AgentModelRequest = {
			systemPrompt: "answer",
			messages: [
				...first.messages.slice(0, 1),
				{
					id: "a1",
					role: "assistant",
					createdAt: 2,
					content: [{ type: "text", text: "First answer" }],
				},
				{ id: "u2", role: "user", createdAt: 3, content: [{ type: "text", text: "Second" }] },
				{
					id: "nklein-retry-4",
					role: "user",
					createdAt: 4,
					content: [{ type: "text", text: "Second retry instruction" }],
				},
			],
			tools: [],
		};
		expect(await collect(model, second)).toContainEqual({ type: "text-delta", text: "Second answer" });
		expect(bodies).toEqual([
			expect.objectContaining({
				input: "First\n\nFirst retry instruction",
				system_prompt: "answer",
				store: true,
			}),
			expect.objectContaining({
				input: "Second\n\nSecond retry instruction",
				previous_response_id: "resp_1",
				store: true,
			}),
		]);
		expect(bodies[1]).not.toHaveProperty("system_prompt");
		expect(observations).toEqual(["session_started", "stateful_delta"]);
	});

	it("retries a failed stateful continuation once with the full caller-owned transcript", async () => {
		const bodies: Array<Record<string, unknown>> = [];
		const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			bodies.push(body);
			if (bodies.length === 2) return new Response("stale", { status: 400 });
			return new Response(
				JSON.stringify({
					output: [{ type: "message", content: bodies.length === 1 ? "First answer" : "Recovered stateless" }],
					response_id: `resp_${bodies.length}`,
					stats: {},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		const observations: string[] = [];
		const model = createLocalAlternateEndpointModel({
			baseUrl: "http://127.0.0.1:1234/v1",
			modelId: "local-model",
			fetchImpl: fetchImpl as typeof fetch,
			onNativeSessionObservation: (observation) => observations.push(observation.type),
		});
		const firstMessage: AgentMessage = {
			id: "u1",
			role: "user",
			createdAt: 1,
			content: [{ type: "text", text: "First" }],
		};
		await collect(model, { systemPrompt: "answer", messages: [firstMessage], tools: [] });
		const events = await collect(model, {
			systemPrompt: "answer",
			messages: [
				firstMessage,
				{
					id: "a1",
					role: "assistant",
					createdAt: 2,
					content: [{ type: "text", text: "First answer" }],
				},
				{ id: "u2", role: "user", createdAt: 3, content: [{ type: "text", text: "Second" }] },
			],
			tools: [],
		});
		expect(events).toContainEqual({ type: "text-delta", text: "Recovered stateless" });
		expect(bodies).toHaveLength(3);
		expect(bodies[1]).toMatchObject({ input: "Second", previous_response_id: "resp_1" });
		expect(bodies[2]).toMatchObject({
			input: "First\n\n[assistant]\nFirst answer\n\nSecond",
			system_prompt: "answer",
		});
		expect(bodies[2]).not.toHaveProperty("previous_response_id");
		expect(observations).toContain("stateless_fallback");
	});

	it("composes only replay-safe allowlisted native MCP plugins and keeps server-executed calls out of SDK tools", async () => {
		let sent: Record<string, unknown> | null = null;
		const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
			sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
			return new Response(
				JSON.stringify({
					output: [
						{ type: "tool_call", tool: "lookup", arguments: { q: "x" }, output: "evidence" },
						{ type: "message", content: "Grounded answer" },
					],
					response_id: "resp_mcp",
					stats: {},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		const observations: string[] = [];
		const model = createLocalAlternateEndpointModel({
			baseUrl: "http://127.0.0.1:1234/v1",
			modelId: "local-model",
			fetchImpl: fetchImpl as typeof fetch,
			nativeMcpIntegrations: [{ pluginId: " mcp/search ", allowedTools: ["lookup", " lookup "], replaySafe: true }],
			onNativeSessionObservation: (observation) => observations.push(observation.type),
		});
		const events = await collect(model, {
			messages: [{ id: "u1", role: "user", createdAt: 1, content: [{ type: "text", text: "Find x" }] }],
			tools: [],
		});
		expect(sent).toMatchObject({
			integrations: [{ type: "plugin", id: "mcp/search", allowed_tools: ["lookup"] }],
		});
		expect(events).toEqual([
			{ type: "text-delta", text: "Grounded answer" },
			{ type: "finish", reason: "stop" },
		]);
		expect(observations).toContain("mcp_tools_executed");
	});
});
