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
});
