import type { AgentMessage, AgentModel, AgentModelEvent, AgentModelRequest, AgentToolDefinition } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { REASONING_BUDGET_BREACH_NUDGE } from "../../../src/core/reasoning-budget-breach";
import {
	compactAgentMessagesPreservingToolWork,
	createAdaptiveSwarmRecoveryModel,
} from "../../../src/nklein-agent/adaptive-swarm-recovery-model";
import { ReasoningBudgetBreachError } from "../../../src/nklein-agent/reasoning-breach-model";

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
		// The note MERGES into the trailing user turn (alternation-safe): original text first, note appended.
		expect(base.requests[2]?.messages.at(-1)?.content.at(-1)).toEqual(
			expect.objectContaining({ type: "text", text: expect.stringContaining("tried reduced_tool_set") }),
		);
		// The retry request must never contain consecutive same-role messages — Mistral-family Jinja templates
		// hard-500 that shape (N3's ministral tripwire caught the old append-as-new-user form live, 2026-08-04).
		for (const req of base.requests) {
			const conversational = req.messages;
			for (let index = 1; index < conversational.length; index += 1) {
				expect(conversational[index]?.role).not.toBe(conversational[index - 1]?.role);
			}
		}
		expect(onStrategyApplied).toHaveBeenCalledWith("prompt_variant:explicit_format");
	});

	it("reports the exact trigger, result, and provider usage for each retry attempt", async () => {
		const stoppedWithUsage: AgentModelEvent[] = [
			{ type: "usage", usage: { inputTokens: 40, outputTokens: 5 } },
			...stopped,
		];
		const calledWithUsage: AgentModelEvent[] = [
			{ type: "usage", usage: { inputTokens: 30, outputTokens: 7 } },
			...called,
		];
		const base = scriptedBase([stoppedWithUsage, calledWithUsage]);
		const onAttempt = vi.fn();
		const model = createAdaptiveSwarmRecoveryModel(base.model, {
			modelId: "google/gemma-4-31b-qat",
			role: "reviewer",
			onAttempt,
		});

		expect(await collect(model, request())).toEqual(calledWithUsage);
		expect(onAttempt).toHaveBeenCalledTimes(2);
		expect(onAttempt.mock.calls[1]?.[0]).toMatchObject({
			strategy: "reduced_tool_set",
			triggerOutcome: "no_tool_call",
			outcome: "success",
			recovered: true,
			inputTokens: 30,
			outputTokens: 7,
		});
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

	it("treats a tool call CUT by max-tokens as truncation, not success (live 20260810-222735)", async () => {
		// Six consecutive write_file calls arrived as {} — the args were cut mid-emission and salvaged empty.
		// hadToolCall used to short-circuit to success, so the raise_token_budget ladder was unreachable and the
		// worker re-ran the same oversized emission at the same budget forever.
		const cutMidCall: AgentModelEvent[] = [
			{ type: "tool-call-delta", toolCallId: "w1", toolName: "write_file", inputText: '{"path":"src/do' },
			{ type: "finish", reason: "max-tokens" },
		];
		const base = scriptedBase([cutMidCall, called]);
		const model = createAdaptiveSwarmRecoveryModel(base.model, {
			modelId: "google/gemma-4-31b-qat",
			baseMaxTokens: 1_024,
		});

		expect(await collect(model, request())).toEqual(called);
		expect(base.requests[1]?.options?.maxTokens).toBe(2_048);
	});

	it("a COMPLETED tool call whose turn stops normally stays a success", async () => {
		const base = scriptedBase([called]);
		const model = createAdaptiveSwarmRecoveryModel(base.model, {
			modelId: "google/gemma-4-31b-qat",
			baseMaxTokens: 1_024,
		});
		expect(await collect(model, request())).toEqual(called);
		expect(base.requests).toHaveLength(1);
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

	it("routes the LM Studio engine-500 overflow to context_shrink, never to the alternate endpoint (P0.CTX500)", async () => {
		// Live 2026-09-03: this wording classified as `unknown_error` → a blind same-size retry. The alternate text
		// wire re-sends the same transcript, so it cannot fix an overflow either; only shrink is a remedy here.
		const overflow = new Error(
			"Engine protocol predict stream returned an error: {code:500, message:'Context size has been exceeded'}",
		);
		const base = scriptedBase([overflow, overflow]);
		const alternate = scriptedBase([called]);
		const attempts: string[] = [];
		const model = createAdaptiveSwarmRecoveryModel(base.model, {
			modelId: "google/gemma-4-31b-qat",
			alternateEndpointModel: alternate.model,
			onAttempt: (attempt) => attempts.push(`${attempt.strategy ?? "baseline"}:${attempt.outcome}`),
		});

		await expect(collect(model, request())).rejects.toBe(overflow);
		expect(attempts).toEqual(["baseline:aborted", "context_shrink:aborted"]);
		expect(base.requests).toHaveLength(2);
		expect(alternate.requests).toHaveLength(0);
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

describe("F3.36 (b) reasoning-budget breach in the ladder", () => {
	it("takes thinking-off FIRST after a mid-stream breach and carries the commit-to-implementation nudge", async () => {
		const base = scriptedBase([new ReasoningBudgetBreachError(5_000, 4_096), called]);
		const onStrategyApplied = vi.fn();
		const model = createAdaptiveSwarmRecoveryModel(base.model, {
			// The qwen3.8 line: thinking off rides the request (`reasoning_effort:"none"`), a verified soft switch.
			modelId: "qwen/qwen3.8-27b",
			role: "worker",
			onStrategyApplied,
		});
		expect(await collect(model, request())).toEqual(called);
		expect(onStrategyApplied).toHaveBeenCalledWith("thinking_disable");
		const retry = base.requests[1];
		expect(retry?.options?.thinking).toBe(false);
		const lastUser = [...(retry?.messages ?? [])].reverse().find((message) => message.role === "user");
		const text = (lastUser?.content ?? []).map((part) => (part.type === "text" ? part.text : "")).join("\n");
		expect(text).toContain(REASONING_BUDGET_BREACH_NUDGE);
	});
});
