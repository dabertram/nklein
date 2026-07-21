/**
 * Live F3.10 proof: force one no-call AgentModel baseline, then let the production swarm adaptive wrapper select a
 * reduced-tool retry against every resident LM Studio model. Never loads, unloads, or downloads models.
 */
import type { AgentModel, AgentModelEvent, AgentModelRequest, AgentToolDefinition } from "@cline/shared";
import { assertModelLoaded } from "../src/core/lmstudio-loaded-models";
import { createAdaptiveSwarmRecoveryModel } from "../src/nklein-agent/adaptive-swarm-recovery-model";
import { createLocalAlternateEndpointModel } from "../src/nklein-agent/local-alternate-endpoint-model";
import { LocalLlmClient } from "../src/nklein-agent/nklein-local-llm-client";

const BASE_URL = process.env.NKLEIN_VERIFY_BASE_URL?.trim() || "http://127.0.0.1:1234/v1";
const REQUESTED_MODELS = (process.env.NKLEIN_VERIFY_MODELS ?? "")
	.split(",")
	.map((id) => id.trim())
	.filter(Boolean);

const TOOLS: AgentToolDefinition[] = [
	{
		name: "read_file",
		description: "Read one workspace-relative text file.",
		inputSchema: {
			type: "object",
			properties: { path: { type: "string" } },
			required: ["path"],
		},
	},
	...(["list_dir", "get_board", "update_focus_chain", "create_card", "run_command"] as const).map((name) => ({
		name,
		description: `Unrelated ${name} tool.`,
		inputSchema: { type: "object", properties: {} },
	})),
];

async function residentModelIds(): Promise<string[]> {
	if (REQUESTED_MODELS.length > 0) return REQUESTED_MODELS;
	const response = await fetch(`${BASE_URL}/models`);
	if (!response.ok) throw new Error(`Model discovery failed: HTTP ${response.status}`);
	const payload = (await response.json()) as { data?: Array<{ id?: string }> };
	return (payload.data ?? []).flatMap((entry) => (entry.id && !entry.id.includes("embed") ? [entry.id] : []));
}

function requestText(request: AgentModelRequest): string {
	return request.messages
		.flatMap((message) =>
			message.content.flatMap((part) => {
				if (part.type === "text") return [`${message.role}: ${part.text}`];
				if (part.type === "tool-result") return [`tool result ${part.toolName}: ${String(part.output)}`];
				return [];
			}),
		)
		.join("\n");
}

async function verifyModel(modelId: string): Promise<void> {
	await assertModelLoaded(BASE_URL, modelId);
	const agentRequest: AgentModelRequest = {
		systemPrompt: "You are an execution agent. Use the requested tool.",
		messages: [
			{
				id: "user-1",
				role: "user",
				createdAt: 1,
				content: [{ type: "text", text: "Call read_file with path NOTES.md now." }],
			},
		],
		tools: TOOLS,
		options: { maxTokens: 1_024, temperature: 0 },
	};
	const real = new LocalLlmClient({ providerId: "lmstudio", modelId, baseUrl: BASE_URL });
	const offeredCounts: number[] = [];
	let call = 0;
	const controlled: AgentModel = {
		stream(request): AsyncIterable<AgentModelEvent> {
			return (async function* () {
				offeredCounts.push(request.tools.length);
				call += 1;
				if (call === 1) {
					yield { type: "text-delta", text: "I should use read_file." };
					yield { type: "finish", reason: "stop" };
					return;
				}
				const completion = await real.completeWithTools(
					{
						messages: [
							...(request.systemPrompt ? [{ role: "system" as const, content: request.systemPrompt }] : []),
							{ role: "user", content: requestText(request) },
						],
						sampling: {
							temperature: 0,
							maxTokens: typeof request.options?.maxTokens === "number" ? request.options.maxTokens : 1_024,
						},
						signal: request.signal,
					},
					request.tools.map((tool) => ({
						name: tool.name,
						description: tool.description ?? tool.name,
						parameters: tool.inputSchema,
					})),
				);
				if (completion.content) yield { type: "text-delta", text: completion.content };
				for (const [index, toolCall] of completion.toolCalls.entries()) {
					yield {
						type: "tool-call-delta",
						toolCallId: toolCall.id || `call-${index + 1}`,
						toolName: toolCall.name,
						inputText: JSON.stringify(toolCall.arguments),
					};
				}
				yield {
					type: "finish",
					reason:
						completion.toolCalls.length > 0
							? "tool-calls"
							: completion.finishReason === "length"
								? "max-tokens"
								: "stop",
				};
			})();
		},
	};
	let applied: string | null = null;
	const model = createAdaptiveSwarmRecoveryModel(controlled, {
		modelId,
		role: "worker",
		baseMaxTokens: 1_024,
		onStrategyApplied: (strategy) => {
			applied = strategy;
		},
	});
	const events: AgentModelEvent[] = [];
	for await (const event of await model.stream(agentRequest)) {
		events.push(event);
	}
	const called = events.find((event) => event.type === "tool-call-delta");
	const reducedToolPass =
		offeredCounts.length === 2 &&
		offeredCounts[0] === TOOLS.length &&
		offeredCounts[1] === 1 &&
		called?.type === "tool-call-delta" &&
		called.toolName === "read_file" &&
		applied === "reduced_tool_set";

	const unavailable: AgentModel = {
		stream() {
			return (async function* () {
				throw new Error("model not found (injected primary failure)");
			})();
		},
	};
	let endpointApplied: string | null = null;
	const endpointRecovery = createAdaptiveSwarmRecoveryModel(unavailable, {
		modelId,
		role: "worker",
		alternateEndpointModel: createLocalAlternateEndpointModel({ baseUrl: BASE_URL, modelId }),
		onStrategyApplied: (strategy) => {
			endpointApplied = strategy;
		},
	});
	const endpointEvents: AgentModelEvent[] = [];
	for await (const event of await endpointRecovery.stream(agentRequest)) endpointEvents.push(event);
	const endpointCall = endpointEvents.find((event) => event.type === "tool-call-delta");
	const alternateEndpointPass =
		endpointApplied === "alternate_endpoint" &&
		endpointCall?.type === "tool-call-delta" &&
		endpointCall.toolName === "read_file";
	const pass = reducedToolPass && alternateEndpointPass;
	process.stdout.write(
		`${JSON.stringify({ modelId, pass, reducedTool: { pass: reducedToolPass, offeredCounts, applied, toolCall: called ?? null }, alternateEndpoint: { pass: alternateEndpointPass, applied: endpointApplied, toolCall: endpointCall ?? null } })}\n`,
	);
	if (!pass) throw new Error(`${modelId}: swarm retry-policy verification failed`);
}

async function main(): Promise<void> {
	const models = await residentModelIds();
	if (models.length === 0) throw new Error(`No resident chat model found at ${BASE_URL}`);
	for (const modelId of models) await verifyModel(modelId);
	process.stdout.write(`PASS: ${models.length}/${models.length} resident models recovered through the swarm policy.\n`);
}

main().catch((error) => {
	process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
	process.exitCode = 1;
});
