import type { AgentMessage, AgentModel, AgentModelEvent, AgentModelRequest, AgentToolDefinition } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	compactAgentMessagesPreservingToolWork,
	createAdaptiveSwarmRecoveryModel,
} from "../../../src/nklein-agent/adaptive-swarm-recovery-model";

type Script = readonly AgentModelEvent[] | Error;

function scriptedBase(scripts: readonly Script[]): { model: AgentModel; requests: AgentModelRequest[] } {
	let call = 0;
	const requests: AgentModelRequest[] = [];
	return {
		requests,
		model: {
			stream(request) {
				requests.push(request);
				const script = scripts[Math.min(call, scripts.length - 1)] ?? [];
				call += 1;
				return (async function* () {
					if (script instanceof Error) throw script;
					for (const event of script) yield event;
				})();
			},
		},
	};
}

function tool(name: string, completesRun = false): AgentToolDefinition {
	return {
		name,
		description: `${name} tool`,
		inputSchema: { type: "object" },
		...(completesRun ? { lifecycle: { completesRun: true } } : {}),
	};
}

function request(overrides: Partial<AgentModelRequest> = {}): AgentModelRequest {
	return {
		systemPrompt: "stable system",
		messages: [
			{
				id: "u1",
				role: "user",
				createdAt: 1,
				content: [{ type: "text", text: "Call submit_review with the verdict." }],
			},
		],
		tools: [tool("read_file"), tool("submit_review", true)],
		...overrides,
	};
}

async function collect(model: AgentModel, input: AgentModelRequest): Promise<AgentModelEvent[]> {
	const events: AgentModelEvent[] = [];
	for await (const event of await model.stream(input)) events.push(event);
	return events;
}

const stopped: AgentModelEvent[] = [
	{ type: "text-delta", text: "I approve." },
	{ type: "finish", reason: "stop" },
];
const called: AgentModelEvent[] = [
	{ type: "tool-call-delta", toolCallId: "call-2", toolName: "submit_review", inputText: "{}" },
	{ type: "finish", reason: "tool-calls" },
];

describe("createAdaptiveSwarmRecoveryModel", () => {
	it("lets the shared policy narrow the tool set before prompt variation", async () => {
		const base = scriptedBase([stopped, called]);
		const onStrategyApplied = vi.fn();
		const model = createAdaptiveSwarmRecoveryModel(base.model, {
			modelId: "google/gemma-4-31b-qat",
			role: "reviewer",
			onStrategyApplied,
		});

		expect(await collect(model, request())).toEqual(called);
		expect(base.requests.map((item) => item.tools.map((candidate) => candidate.name))).toEqual([
			["read_file", "submit_review"],
			["submit_review"],
		]);
		expect(onStrategyApplied).toHaveBeenCalledWith("reduced_tool_set");
	});

	it("continues to the next untried rung and carries a failure capsule", async () => {
		const base = scriptedBase([stopped, stopped, called]);
		const onStrategyApplied = vi.fn();
		const model = createAdaptiveSwarmRecoveryModel(base.model, {
			modelId: "google/gemma-4-31b-qat",
			role: "reviewer",
			minRetryBudget: 3,
			onStrategyApplied,
		});

		expect(await collect(model, request())).toEqual(called);
		expect(base.requests).toHaveLength(3);
		expect(base.requests[2]?.messages.at(-1)?.content[0]).toEqual(
			expect.objectContaining({ type: "text", text: expect.stringContaining("tried reduced_tool_set") }),
		);
		expect(onStrategyApplied).toHaveBeenCalledWith("prompt_variant:explicit_format");
	});

	it("raises maxTokens for a truncated turn and replaces the buffered partial", async () => {
		const truncated: AgentModelEvent[] = [
			{ type: "reasoning-delta", text: "discarded" },
			{ type: "finish", reason: "max-tokens" },
		];
		const base = scriptedBase([truncated, called]);
		const model = createAdaptiveSwarmRecoveryModel(base.model, {
			modelId: "google/gemma-4-31b-qat",
			baseMaxTokens: 1_024,
		});

		expect(await collect(model, request())).toEqual(called);
		expect(base.requests[1]?.options?.maxTokens).toBe(2_048);
		expect(base.requests.every((item) => item.options?.metadata)).toBe(true);
	});

	it("shrinks context-overflow payloads while preserving completed tool call/result pairs", async () => {
		const huge = "evidence ".repeat(1_000);
		const messages: AgentMessage[] = [
			...request().messages,
			{
				id: "a1",
				role: "assistant",
				createdAt: 2,
				content: [{ type: "tool-call", toolCallId: "read-1", toolName: "read_file", input: { path: "a.ts" } }],
			},
			{
				id: "u2",
				role: "user",
				createdAt: 3,
				content: [
					{ type: "tool-result", toolCallId: "read-1", toolName: "read_file", output: huge, isError: false },
				],
			},
		];
		const base = scriptedBase([new Error("maximum context length exceeded"), called]);
		const model = createAdaptiveSwarmRecoveryModel(base.model, { modelId: "google/gemma-4-31b-qat" });

		expect(await collect(model, request({ messages }))).toEqual(called);
		const compacted = base.requests[1]?.messages;
		expect(compacted?.[1]?.content[0]).toEqual(
			expect.objectContaining({ type: "tool-call", toolCallId: "read-1", toolName: "read_file" }),
		);
		expect(compacted?.[2]?.content[0]).toEqual(
			expect.objectContaining({ type: "tool-result", toolCallId: "read-1", toolName: "read_file", isError: false }),
		);
		expect(JSON.stringify(compacted?.[2]?.content[0]).length).toBeLessThan(huge.length);
	});

	it("never retries a caller-owned abort", async () => {
		const controller = new AbortController();
		controller.abort("stop");
		const aborted: AgentModelEvent[] = [{ type: "finish", reason: "aborted" }];
		const base = scriptedBase([aborted, called]);
		const model = createAdaptiveSwarmRecoveryModel(base.model, { modelId: "google/gemma-4-31b-qat" });

		expect(await collect(model, request({ signal: controller.signal }))).toEqual(aborted);
		expect(base.requests).toHaveLength(1);
	});

	it("executes alternate_endpoint for an unavailable primary model", async () => {
		const base = scriptedBase([new Error("model not found")]);
		const alternate = scriptedBase([called]);
		const onStrategyApplied = vi.fn();
		const model = createAdaptiveSwarmRecoveryModel(base.model, {
			modelId: "google/gemma-4-31b-qat",
			alternateEndpointModel: alternate.model,
			onStrategyApplied,
		});

		expect(await collect(model, request())).toEqual(called);
		expect(base.requests).toHaveLength(1);
		expect(alternate.requests).toHaveLength(1);
		expect(alternate.requests[0]?.options?.metadata).toMatchObject({ nkleinProviderMaxRetries: 0 });
		expect(onStrategyApplied).toHaveBeenCalledWith("alternate_endpoint");
	});

	it("surfaces a content-filter refusal without retrying another endpoint or model", async () => {
		const filtered = new Error("content_filter policy refusal");
		const base = scriptedBase([filtered]);
		const alternate = scriptedBase([called]);
		const crossModel = scriptedBase([called]);
		const model = createAdaptiveSwarmRecoveryModel(base.model, {
			modelId: "google/gemma-4-31b-qat",
			alternateEndpointModel: alternate.model,
			crossModel: crossModel.model,
		});

		await expect(collect(model, request())).rejects.toBe(filtered);
		expect(base.requests).toHaveLength(1);
		expect(alternate.requests).toHaveLength(0);
		expect(crossModel.requests).toHaveLength(0);
	});
});

describe("compactAgentMessagesPreservingToolWork", () => {
	it("does not mutate the source transcript", () => {
		const source = request().messages;
		const compacted = compactAgentMessagesPreservingToolWork(source);
		expect(compacted).not.toBe(source);
		expect(source[0]?.content[0]).toEqual({ type: "text", text: "Call submit_review with the verdict." });
	});
});
