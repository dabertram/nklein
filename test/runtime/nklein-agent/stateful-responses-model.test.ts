import type { AgentMessage, AgentModel, AgentModelEvent, AgentModelRequest } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { createStatefulResponsesModel } from "../../../src/nklein-agent/stateful-responses-model";

type Script = readonly AgentModelEvent[] | Error;

function scriptedBase(scripts: readonly Script[]): {
	model: AgentModel;
	requests: AgentModelRequest[];
} {
	let call = 0;
	const requests: AgentModelRequest[] = [];
	return {
		requests,
		model: {
			stream(request) {
				requests.push(request);
				const script = scripts[call++] ?? [];
				return (async function* () {
					if (script instanceof Error) throw script;
					for (const event of script) yield event;
				})();
			},
		},
	};
}

function user(id: string, text: string, createdAt = 1): AgentMessage {
	return { id, role: "user", createdAt, content: [{ type: "text", text }] };
}

function assistant(id: string, text: string, createdAt = 2): AgentMessage {
	return { id, role: "assistant", createdAt, content: [{ type: "text", text }] };
}

function request(messages: AgentMessage[], overrides: Partial<AgentModelRequest> = {}): AgentModelRequest {
	return {
		systemPrompt: "stable system",
		messages,
		tools: [],
		options: { temperature: 0, metadata: { caller: "preserved" } },
		...overrides,
	};
}

function response(id: string, text: string): AgentModelEvent[] {
	return [
		{ type: "text-delta", text },
		{ type: "finish", reason: "stop", metadata: { openai: { responseId: id } } },
	];
}

async function collect(model: AgentModel, input: AgentModelRequest): Promise<AgentModelEvent[]> {
	const events: AgentModelEvent[] = [];
	for await (const event of await model.stream(input)) events.push(event);
	return events;
}

describe("createStatefulResponsesModel", () => {
	it("chains exact transcript deltas while keeping adaptive retry notes wire-only", async () => {
		const base = scriptedBase([
			response("resp_1", "First answer"),
			response("resp_2", "Second answer"),
			response("resp_3", "Third answer"),
		]);
		const onObservation = vi.fn();
		const model = createStatefulResponsesModel(base.model, { onObservation });
		const u1 = user("u1", "First");
		const retry1 = user("nklein-retry-1", "Try a stricter format", 2);

		await collect(model, request([u1, retry1]));
		const u2 = user("u2", "Second", 3);
		const retry2 = user("nklein-retry-2", "Use the requested schema", 4);
		await collect(model, request([u1, assistant("a1", "First answer"), u2, retry2]));
		const u3 = user("u3", "Third", 5);
		await collect(model, request([u1, assistant("a1", "First answer"), u2, assistant("a2", "Second answer", 4), u3]));

		expect(base.requests[0]?.messages).toEqual([u1, retry1]);
		expect(base.requests[0]?.options?.metadata).toMatchObject({
			caller: "preserved",
			nkleinStatefulResponses: true,
		});
		expect(base.requests[0]?.options?.metadata).not.toHaveProperty("nkleinPreviousResponseId");
		expect(base.requests[1]?.messages).toEqual([u2, retry2]);
		expect(base.requests[1]?.systemPrompt).toBe("stable system");
		expect(base.requests[1]?.options?.metadata).toMatchObject({ nkleinPreviousResponseId: "resp_1" });
		expect(base.requests[2]?.messages).toEqual([u3]);
		expect(base.requests[2]?.options?.metadata).toMatchObject({ nkleinPreviousResponseId: "resp_2" });
		expect(onObservation.mock.calls.map(([value]) => value.type)).toEqual([
			"session_started",
			"stateful_delta",
			"stateful_delta",
		]);
	});

	it("invalidates on transcript divergence and sends the authoritative full transcript", async () => {
		const base = scriptedBase([response("resp_1", "First answer"), response("resp_2", "Fresh answer")]);
		const onObservation = vi.fn();
		const model = createStatefulResponsesModel(base.model, { onObservation });
		const u1 = user("u1", "First");
		await collect(model, request([u1]));
		const divergent = [u1, assistant("a1", "Edited answer"), user("u2", "Continue", 3)];

		await collect(model, request(divergent));

		expect(base.requests[1]?.messages).toEqual(divergent);
		expect(base.requests[1]?.systemPrompt).toBe("stable system");
		expect(base.requests[1]?.options?.metadata).not.toHaveProperty("nkleinPreviousResponseId");
		expect(onObservation).toHaveBeenCalledWith(expect.objectContaining({ type: "invalidated" }));
	});

	it("treats changed prior image bytes as transcript divergence", async () => {
		const base = scriptedBase([response("resp_1", "Seen"), response("resp_2", "Fresh")]);
		const model = createStatefulResponsesModel(base.model);
		const original: AgentMessage = {
			id: "u1",
			role: "user",
			createdAt: 1,
			content: [{ type: "image", image: new Uint8Array([1, 2, 3]), mediaType: "image/png" }],
		};
		await collect(model, request([original]));
		const edited: AgentMessage = {
			...original,
			content: [{ type: "image", image: new Uint8Array([1, 2, 4]), mediaType: "image/png" }],
		};
		const full = [edited, assistant("a1", "Seen"), user("u2", "Continue", 3)];

		await collect(model, request(full));

		expect(base.requests[1]?.messages).toEqual(full);
		expect(base.requests[1]?.options?.metadata).not.toHaveProperty("nkleinPreviousResponseId");
	});

	it("buffers a failed continuation, replays once from the full transcript, and retains all usage", async () => {
		const failed: AgentModelEvent[] = [
			{ type: "reasoning-delta", text: "discard me" },
			{ type: "usage", usage: { inputTokens: 10, outputTokens: 2 } },
			{ type: "finish", reason: "error", error: "expired response" },
		];
		const recovered: AgentModelEvent[] = [
			{ type: "text-delta", text: "Recovered" },
			{ type: "usage", usage: { inputTokens: 20, outputTokens: 5 } },
			{ type: "finish", reason: "stop", metadata: { openai: { responseId: "resp_3" } } },
		];
		const base = scriptedBase([response("resp_1", "First answer"), failed, recovered]);
		const onObservation = vi.fn();
		const model = createStatefulResponsesModel(base.model, { onObservation });
		const u1 = user("u1", "First");
		await collect(model, request([u1]));
		const full = [u1, assistant("a1", "First answer"), user("u2", "Continue", 3)];

		const events = await collect(model, request(full));

		expect(events).toEqual([
			{ type: "text-delta", text: "Recovered" },
			{ type: "usage", usage: { inputTokens: 30, outputTokens: 7 } },
			recovered[2],
		]);
		expect(base.requests[1]?.messages).toEqual([full[2]]);
		expect(base.requests[2]?.messages).toEqual(full);
		expect(base.requests[2]?.options?.metadata).not.toHaveProperty("nkleinPreviousResponseId");
		expect(onObservation).toHaveBeenCalledWith(expect.objectContaining({ type: "stateless_fallback" }));
	});

	it("chains an assistant tool call to its authoritative tool result", async () => {
		const toolTurn: AgentModelEvent[] = [
			{
				type: "tool-call-delta",
				toolCallId: "call_1",
				toolName: "read_file",
				inputText: '{"path":"a.ts"}',
				input: { path: "a.ts" },
			},
			{ type: "finish", reason: "tool-calls", metadata: { openai: { responseId: "resp_tool" } } },
		];
		const base = scriptedBase([toolTurn, response("resp_done", "Done")]);
		const model = createStatefulResponsesModel(base.model);
		const u1 = user("u1", "Read a.ts");
		await collect(model, request([u1]));
		const call: AgentMessage = {
			id: "a1",
			role: "assistant",
			createdAt: 2,
			content: [{ type: "tool-call", toolCallId: "call_1", toolName: "read_file", input: { path: "a.ts" } }],
		};
		const result: AgentMessage = {
			id: "u2",
			role: "user",
			createdAt: 3,
			content: [
				{ type: "tool-result", toolCallId: "call_1", toolName: "read_file", output: "contents", isError: false },
			],
		};

		await collect(model, request([u1, call, result]));

		expect(base.requests[1]?.messages).toEqual([result]);
		expect(base.requests[1]?.options?.metadata).toMatchObject({
			nkleinPreviousResponseId: "resp_tool",
		});
	});

	it("never replays a caller-owned abort", async () => {
		const aborted: AgentModelEvent[] = [{ type: "finish", reason: "aborted" }];
		const base = scriptedBase([response("resp_1", "First answer"), aborted, response("unused", "Wrong")]);
		const model = createStatefulResponsesModel(base.model);
		const u1 = user("u1", "First");
		await collect(model, request([u1]));
		const controller = new AbortController();
		controller.abort("caller stopped");

		const events = await collect(
			model,
			request([u1, assistant("a1", "First answer"), user("u2", "Continue", 3)], {
				signal: controller.signal,
			}),
		);

		expect(events).toEqual(aborted);
		expect(base.requests).toHaveLength(2);
	});

	it("lets the outer recovery layer retry truncation without a redundant stateless replay", async () => {
		const truncated: AgentModelEvent[] = [
			{ type: "text-delta", text: "partial" },
			{ type: "finish", reason: "max-tokens", metadata: { openai: { responseId: "resp_partial" } } },
		];
		const base = scriptedBase([response("resp_1", "First answer"), truncated, response("resp_2", "Expanded")]);
		const model = createStatefulResponsesModel(base.model);
		const u1 = user("u1", "First");
		await collect(model, request([u1]));
		const u2 = user("u2", "Continue", 3);
		const full = [u1, assistant("a1", "First answer"), u2];

		expect(await collect(model, request(full))).toEqual(truncated);
		expect(base.requests).toHaveLength(2);
		const retry = user("nklein-retry-3", "Use a larger output budget", 4);
		await collect(model, request([...full, retry], { options: { temperature: 0, maxTokens: 128 } }));

		expect(base.requests[2]?.messages).toEqual([u2, retry]);
		expect(base.requests[2]?.options?.metadata).toMatchObject({ nkleinPreviousResponseId: "resp_1" });
	});
});
