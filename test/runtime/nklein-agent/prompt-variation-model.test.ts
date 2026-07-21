import type { AgentMessage, AgentModel, AgentModelEvent, AgentModelRequest, AgentToolDefinition } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	createSwarmPromptVariationModel,
	planSwarmPromptVariation,
	promptVariantOrderForRole,
} from "../../../src/nklein-agent/prompt-variation-model";

function message(id: string, role: AgentMessage["role"], text: string): AgentMessage {
	return { id, role, content: [{ type: "text", text }], createdAt: 1 };
}

function tool(name: string, completesRun = false): AgentToolDefinition {
	return {
		name,
		description: `${name} description`,
		inputSchema: { type: "object" },
		...(completesRun ? { lifecycle: { completesRun: true } } : {}),
	};
}

function request(
	input: { instruction?: string; tools?: AgentToolDefinition[]; signal?: AbortSignal } = {},
): AgentModelRequest {
	return {
		systemPrompt: "stable system prefix",
		messages: [
			message("u0", "user", "stable earlier user turn"),
			message("a0", "assistant", "stable earlier answer"),
			message("u1", "user", input.instruction ?? "Finish the review."),
		],
		tools: input.tools ?? [tool("submit_review", true)],
		...(input.signal ? { signal: input.signal } : {}),
	};
}

function scriptedBase(scripts: readonly AgentModelEvent[][]): {
	model: AgentModel;
	requests: AgentModelRequest[];
} {
	const requests: AgentModelRequest[] = [];
	let call = 0;
	return {
		requests,
		model: {
			stream(input) {
				requests.push(input);
				const events = scripts[Math.min(call, scripts.length - 1)] ?? [];
				call += 1;
				return (async function* () {
					for (const event of events) yield event;
				})();
			},
		},
	};
}

async function collect(model: AgentModel, input: AgentModelRequest): Promise<AgentModelEvent[]> {
	const events: AgentModelEvent[] = [];
	for await (const event of await model.stream(input)) events.push(event);
	return events;
}

const stopped: AgentModelEvent[] = [
	{ type: "text-delta", text: "I would approve this." },
	{ type: "finish", reason: "stop" },
];
const called: AgentModelEvent[] = [
	{ type: "tool-call-delta", toolCallId: "call-1", toolName: "submit_review", inputText: "{}" },
	{ type: "finish", reason: "tool-calls" },
];

describe("swarm prompt variation", () => {
	it("orders variants by role", () => {
		expect(promptVariantOrderForRole("architect")[0]).toBe("explicit_format");
		expect(promptVariantOrderForRole("reviewer")[0]).toBe("explicit_format");
		expect(promptVariantOrderForRole("worker")[0]).toBe("imperative");
		expect(promptVariantOrderForRole("unknown")[0]).toBe("imperative");
	});

	it("changes only the latest user suffix and preserves the stable cache prefix", () => {
		const original = request();
		const plan = planSwarmPromptVariation(original, "reviewer");

		expect(plan).not.toBeNull();
		expect(plan?.family).toBe("explicit_format");
		expect(plan?.toolName).toBe("submit_review");
		expect(plan?.request.systemPrompt).toBe(original.systemPrompt);
		expect(plan?.request.messages[0]).toBe(original.messages[0]);
		expect(plan?.request.messages[1]).toBe(original.messages[1]);
		expect(plan?.request.messages[2]).not.toBe(original.messages[2]);
		expect(plan?.request.messages[2]?.content).toEqual([
			{
				type: "text",
				text: "Respond with a single submit_review tool call and nothing else — no explanation.\nTask: Finish the review.",
			},
		]);
	});

	it("retries one clean no-call stop and records a successful role-aware recovery", async () => {
		const base = scriptedBase([stopped, called]);
		const onOutcome = vi.fn();
		const model = createSwarmPromptVariationModel(base.model, { role: "worker", onOutcome });

		expect(await collect(model, request())).toEqual(called);
		expect(base.requests).toHaveLength(2);
		expect(base.requests[1]?.messages.at(-1)?.content).toEqual([
			{ type: "text", text: "Do this now — call the submit_review tool:\nFinish the review." },
		]);
		expect(onOutcome).toHaveBeenCalledOnce();
		expect(onOutcome).toHaveBeenCalledWith({
			role: "worker",
			family: "imperative",
			toolName: "submit_review",
			recovered: true,
		});
	});

	it("reports failure after the single bounded retry also stops without a tool call", async () => {
		const base = scriptedBase([stopped]);
		const onOutcome = vi.fn();

		expect(
			await collect(createSwarmPromptVariationModel(base.model, { role: "architect", onOutcome }), request()),
		).toEqual(stopped);
		expect(base.requests).toHaveLength(2);
		expect(onOutcome).toHaveBeenCalledWith({
			role: "architect",
			family: "explicit_format",
			toolName: "submit_review",
			recovered: false,
		});
	});

	it("does not retry an unanchored final-answer turn", async () => {
		const base = scriptedBase([stopped, called]);
		const input = request({
			instruction: "Explain the result.",
			tools: [tool("read_file"), tool("write_file")],
		});

		expect(await collect(createSwarmPromptVariationModel(base.model), input)).toEqual(stopped);
		expect(base.requests).toHaveLength(1);
	});

	it("uses an explicitly named offered tool as the retry anchor", async () => {
		const base = scriptedBase([stopped, called]);
		const input = request({
			instruction: "Call write_file with the completed patch.",
			tools: [tool("read_file"), tool("write_file")],
		});

		await collect(createSwarmPromptVariationModel(base.model), input);
		expect(base.requests).toHaveLength(2);
		expect(base.requests[1]?.messages.at(-1)?.content).toEqual([
			{ type: "text", text: "Do this now — call the write_file tool:\nCall write_file with the completed patch." },
		]);
	});

	it("keeps the prior instruction as the anchor after a completed tool-result message", () => {
		const baseInput = request({
			instruction: "Call submit_review after checking the evidence.",
			tools: [tool("submit_review", true)],
		});
		const input: AgentModelRequest = {
			...baseInput,
			messages: [
				...baseInput.messages,
				{
					id: "a1",
					role: "assistant",
					content: [{ type: "tool-call", toolCallId: "read-1", toolName: "read_file", input: { path: "a.ts" } }],
					createdAt: 2,
				},
				{
					id: "u2",
					role: "user",
					content: [
						{
							type: "tool-result",
							toolCallId: "read-1",
							toolName: "read_file",
							output: "evidence",
							isError: false,
						},
					],
					createdAt: 3,
				},
			],
		};

		const plan = planSwarmPromptVariation(input, "reviewer");
		expect(plan?.toolName).toBe("submit_review");
		expect(plan?.request.messages.at(-1)).toBe(input.messages.at(-1));
		expect(plan?.request.messages[2]?.content[0]).toEqual({
			type: "text",
			text: "Respond with a single submit_review tool call and nothing else — no explanation.\nTask: Call submit_review after checking the evidence.",
		});
	});

	it("never retries a turn that already emitted a tool call", async () => {
		const base = scriptedBase([called, stopped]);
		const onOutcome = vi.fn();

		expect(await collect(createSwarmPromptVariationModel(base.model, { onOutcome }), request())).toEqual(called);
		expect(base.requests).toHaveLength(1);
		expect(onOutcome).not.toHaveBeenCalled();
	});

	it("never retries a caller-cancelled turn", async () => {
		const controller = new AbortController();
		controller.abort();
		const base = scriptedBase([stopped, called]);

		expect(
			await collect(createSwarmPromptVariationModel(base.model), request({ signal: controller.signal })),
		).toEqual(stopped);
		expect(base.requests).toHaveLength(1);
	});
});
