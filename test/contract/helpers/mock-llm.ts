import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A tiny OpenAI-compatible mock LLM server for the §5.V fast-gate contract suites (todo §5.V). It lets a SPAWNED
 * !Klein server run chat/pipeline flows deterministically with NO real model — point the runtime's chat/provider
 * `baseUrl` at `server.baseUrl` and the runtime's `LocalLlmClient` (chat, structured ops) and OpenAI-compatible SDK
 * host (the task agent loop) both talk to this mock instead of LM Studio.
 *
 * It mirrors exactly what `LocalLlmClient` (src/nklein-agent/nklein-local-llm-client.ts) calls:
 *  - `GET /models` (and `/v1/models`) → `{ data: [{ id }] }` so `discoverLoadedModelId` finds a "loaded" model.
 *  - `POST /chat/completions` (and `/v1/chat/completions`) → an OpenAI chat completion; SSE when `stream: true`.
 *
 * Responses are **scriptable**: `enqueue` a FIFO of canned replies (plain text and/or tool calls); when the queue is
 * empty the `default` reply is used. Every request is captured on `requests` for assertions.
 */

export interface MockLlmToolCall {
	name: string;
	arguments: Record<string, unknown>;
}

export interface MockLlmResponse {
	/** Assistant text content (streamed in a few chunks when the request asks for `stream: true`). */
	content?: string;
	/** OpenAI function tool calls to return (non-streaming path; the agent loop drives these). */
	toolCalls?: MockLlmToolCall[];
	/** Defaults to "tool_calls" when toolCalls are present, else "stop". */
	finishReason?: string;
}

export interface MockLlmRequestRecord {
	path: string;
	stream: boolean;
	model: unknown;
	messages: unknown;
	tools: unknown;
	body: Record<string, unknown>;
}

export interface MockLlmServer {
	/** Base URL with no trailing `/v1` — the client adds it. e.g. http://127.0.0.1:PORT */
	baseUrl: string;
	modelId: string;
	/** Queue a reply for the next chat/completions call (FIFO). */
	enqueue: (response: MockLlmResponse) => void;
	/** Reply used when the queue is empty (defaults to a fixed "OK" text). */
	setDefault: (response: MockLlmResponse) => void;
	/** Every chat/completions request received, in order. */
	requests: MockLlmRequestRecord[];
	close: () => Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let raw = "";
		req.on("data", (chunk) => {
			raw += chunk;
		});
		req.on("end", () => resolve(raw));
		req.on("error", reject);
	});
}

function toOpenAiToolCalls(toolCalls: MockLlmToolCall[]) {
	return toolCalls.map((call, index) => ({
		id: `call_${index}`,
		type: "function" as const,
		function: { name: call.name, arguments: JSON.stringify(call.arguments) },
	}));
}

function chunkContent(content: string): string[] {
	if (content.length === 0) {
		return [];
	}
	// Split into a few chunks so streaming is exercised (token-by-token isn't required).
	const size = Math.max(1, Math.ceil(content.length / 4));
	const chunks: string[] = [];
	for (let i = 0; i < content.length; i += size) {
		chunks.push(content.slice(i, i + size));
	}
	return chunks;
}

function writeNonStreaming(res: ServerResponse, modelId: string, reply: MockLlmResponse): void {
	const hasTools = (reply.toolCalls?.length ?? 0) > 0;
	const message: Record<string, unknown> = { role: "assistant", content: reply.content ?? "" };
	if (hasTools && reply.toolCalls) {
		message.tool_calls = toOpenAiToolCalls(reply.toolCalls);
	}
	const payload = {
		id: "chatcmpl-mock",
		object: "chat.completion",
		created: Math.floor(Date.now() / 1000),
		model: modelId,
		choices: [
			{
				index: 0,
				message,
				finish_reason: reply.finishReason ?? (hasTools ? "tool_calls" : "stop"),
			},
		],
	};
	res.writeHead(200, { "content-type": "application/json" });
	res.end(JSON.stringify(payload));
}

function writeStreaming(res: ServerResponse, modelId: string, reply: MockLlmResponse): void {
	res.writeHead(200, {
		"content-type": "text/event-stream",
		"cache-control": "no-cache",
		connection: "keep-alive",
	});
	const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
	for (const delta of chunkContent(reply.content ?? "")) {
		send({
			id: "chatcmpl-mock",
			object: "chat.completion.chunk",
			model: modelId,
			choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
		});
	}
	send({
		id: "chatcmpl-mock",
		object: "chat.completion.chunk",
		model: modelId,
		choices: [{ index: 0, delta: {}, finish_reason: reply.finishReason ?? "stop" }],
	});
	res.write("data: [DONE]\n\n");
	res.end();
}

export async function startMockLlm(options: { modelId?: string } = {}): Promise<MockLlmServer> {
	const modelId = options.modelId ?? "mock-model";
	const queue: MockLlmResponse[] = [];
	const requests: MockLlmRequestRecord[] = [];
	let defaultResponse: MockLlmResponse = { content: "OK" };

	const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
		const url = req.url ?? "";
		const path = url.split("?")[0] ?? "";
		if (req.method === "GET" && (path === "/models" || path === "/v1/models")) {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ object: "list", data: [{ id: modelId, object: "model" }] }));
			return;
		}
		if (req.method === "POST" && (path === "/chat/completions" || path === "/v1/chat/completions")) {
			const raw = await readBody(req);
			let body: Record<string, unknown> = {};
			try {
				body = JSON.parse(raw) as Record<string, unknown>;
			} catch {
				body = {};
			}
			const stream = body.stream === true;
			requests.push({ path, stream, model: body.model, messages: body.messages, tools: body.tools, body });
			const reply = queue.shift() ?? defaultResponse;
			if (stream) {
				writeStreaming(res, modelId, reply);
			} else {
				writeNonStreaming(res, modelId, reply);
			}
			return;
		}
		res.writeHead(404, { "content-type": "application/json" });
		res.end(JSON.stringify({ error: { message: `mock-llm: no route for ${req.method} ${path}` } }));
	};

	const server: Server = createServer((req, res) => {
		handle(req, res).catch((error) => {
			if (!res.headersSent) {
				res.writeHead(500, { "content-type": "application/json" });
			}
			res.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error) } }));
		});
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve());
	});
	const address = server.address() as AddressInfo;
	const baseUrl = `http://127.0.0.1:${address.port}`;

	return {
		baseUrl,
		modelId,
		enqueue: (response) => {
			queue.push(response);
		},
		setDefault: (response) => {
			defaultResponse = response;
		},
		requests,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			}),
	};
}
