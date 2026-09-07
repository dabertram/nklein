import { createGateway } from "@cline/llms";
import type { AgentModel, AgentModelEvent, AgentModelRequest } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createSimulatorServer, type ScenarioScript } from "../../../packages/llm-simulator/src/index";
import { LocalLlmClient } from "../../../src/nklein-agent/nklein-local-llm-client";
import { createSkillApiProfileAgentModel } from "../../../src/nklein-agent/skill-api-profile-agent-model";

/**
 * P2.SIMMULTICALL (2026-09-07): a 53-call planning turn (update_focus_chain + 52 add_task) served by the simulator
 * reached the runtime as ONE executed/persisted call. Every layer of the transport is exercised here against a
 * two-call track so a regression is attributable to its layer:
 *   1. the raw SSE wire aimock emits (`delta.tool_calls[{index}]` per call),
 *   2. the SDK gateway model the session runtime builds for `lmstudio` (@ai-sdk/openai-compatible → ai → gateway),
 *   3. the swarm's skill-profile decorator on its DIRECT forced-tool path (LocalLlmClient, `stream:false`,
 *      `tool_choice:"required"`) — the layer that actually dropped calls: it forwarded only `toolCalls[0]`.
 * Layer 3 is what a planning session takes under the simflow harness: the project-36 prompt keyword-activates the
 * `web_retrieval` skill (`structuredOutput: true`) for every role, every simulated model id resolves to
 * `native_tool_call`, and the harness — unlike the HITL rig — does not set NKLEIN_SKILL_API_DIRECT=off.
 */
const script: ScenarioScript = {
	name: "multi-call-turn",
	seed: 1,
	tracks: [
		{
			id: "two-reads",
			requestClass: "any",
			turns: [
				{
					behavior: {
						kind: "tool_calls",
						calls: [
							{ name: "read_files", arguments: { paths: ["a.md"] } },
							{ name: "read_files", arguments: { paths: ["b.md"] } },
						],
					},
				},
				{ behavior: { kind: "text", content: "done" } },
			],
			repeatLastTurn: true,
		},
	],
};

const READ_FILES_SCHEMA = { type: "object", properties: { paths: { type: "array", items: { type: "string" } } } };

interface SseToolCallDelta {
	index?: number;
	id?: string;
	function?: { name?: string; arguments?: string };
}

async function captureSse(base: string): Promise<SseToolCallDelta[]> {
	const response = await fetch(`${base}/chat/completions`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			model: "sim",
			stream: true,
			messages: [{ role: "user", content: "Work the card" }],
			tools: [{ type: "function", function: { name: "read_files", parameters: READ_FILES_SCHEMA } }],
		}),
	});
	const deltas: SseToolCallDelta[] = [];
	for (const line of (await response.text()).split("\n")) {
		if (!line.startsWith("data:")) continue;
		const payload = line.slice(5).trim();
		if (payload === "[DONE]") continue;
		const chunk = JSON.parse(payload) as { choices?: Array<{ delta?: { tool_calls?: SseToolCallDelta[] } }> };
		for (const delta of chunk.choices?.[0]?.delta?.tool_calls ?? []) deltas.push(delta);
	}
	return deltas;
}

const request = (): AgentModelRequest => ({
	systemPrompt: "You are a worker.",
	messages: [{ id: "u1", role: "user", createdAt: 1, content: [{ type: "text", text: "Work the card" }] }],
	tools: [{ name: "read_files", description: "read", inputSchema: READ_FILES_SCHEMA }],
	options: {},
});

async function collect(model: AgentModel, input: AgentModelRequest): Promise<AgentModelEvent[]> {
	const events: AgentModelEvent[] = [];
	for await (const event of await model.stream(input)) events.push(event);
	return events;
}

function toolCallSummary(events: readonly AgentModelEvent[]): Array<{ id: string | undefined; paths: unknown }> {
	return events.flatMap((event) =>
		event.type === "tool-call-delta"
			? [{ id: event.toolCallId, paths: (JSON.parse(event.inputText ?? "{}") as { paths?: unknown }).paths }]
			: [],
	);
}

describe("P2.SIMMULTICALL — a multi-call simulator turn reaches the runtime in full", () => {
	it("delivers both calls on the wire, through the SDK gateway, and through the skill-profile direct path", async () => {
		const simulator = createSimulatorServer(script);
		await simulator.start();
		try {
			const base = simulator.url();

			// Layer 1 — aimock's SSE: one `index` per call, the first delta of each carrying its id + name.
			const wire = await captureSse(base);
			expect([...new Set(wire.map((delta) => delta.index))].sort()).toEqual([0, 1]);
			expect(wire.filter((delta) => delta.id).map((delta) => delta.function?.name)).toEqual([
				"read_files",
				"read_files",
			]);

			// Layer 2 — the SDK-native streaming wire the session runtime uses when no profile applies.
			const gateway = createGateway({ providerConfigs: [{ providerId: "lmstudio", baseUrl: base }] });
			const sdkEvents = await collect(
				gateway.createAgentModel({ providerId: "lmstudio", modelId: "sim" }),
				request(),
			);
			expect(toolCallSummary(sdkEvents).map((call) => call.paths)).toEqual([["a.md"], ["b.md"]]);
			expect(new Set(toolCallSummary(sdkEvents).map((call) => call.id)).size).toBe(2);

			// Layer 3 — the skill-profile direct path (the layer that dropped calls). `structuredOutput` on an
			// unrecognized model id resolves to native_tool_call ⇒ LocalLlmClient.completeWithTools, not the SDK.
			let sdkFallbackTurns = 0;
			const fallback: AgentModel = {
				stream(): AsyncIterable<AgentModelEvent> {
					sdkFallbackTurns += 1;
					return (async function* () {
						yield { type: "finish", reason: "stop" };
					})();
				},
			};
			const profiled = createSkillApiProfileAgentModel(fallback, {
				modelId: "sim/architect-r1",
				profile: { structuredOutput: true },
				directClient: new LocalLlmClient({ providerId: "lmstudio", modelId: "sim/architect-r1", baseUrl: base }),
			});
			const directEvents = await collect(profiled, request());
			expect(sdkFallbackTurns).toBe(0);
			expect(toolCallSummary(directEvents).map((call) => call.paths)).toEqual([["a.md"], ["b.md"]]);
			expect(new Set(toolCallSummary(directEvents).map((call) => call.id)).size).toBe(2);
			expect(directEvents.at(-1)).toEqual({ type: "finish", reason: "tool-calls" });
			// The direct path is the non-streaming, forced form of the same request.
			const direct = simulator.mock.getRequests().at(-1)?.body as { stream?: boolean; tool_choice?: string };
			expect(direct).toMatchObject({ stream: false, tool_choice: "required" });
		} finally {
			await simulator.stop();
		}
	}, 30_000);
});
