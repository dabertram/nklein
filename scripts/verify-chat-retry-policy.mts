/**
 * Live F3.8 proof: force one production-shaped no-tool-call baseline, then verify the shared retry-policy controller
 * selects the reduced-tool-set rung and a resident local model emits the requested call on that retry.
 *
 * This never loads, unloads, or downloads models. By default it checks every model already exposed by LM Studio.
 * Optional env: NKLEIN_VERIFY_MODELS (comma-separated ids), NKLEIN_VERIFY_BASE_URL.
 */
import { createChatAgentModel, type ChatAgentCompletionClient } from "../src/chat/chat-local-llm-adapter";
import { LocalLlmClient, type LocalLlmToolDefinition } from "../src/nklein-agent/nklein-local-llm-client";
import { assertModelLoaded } from "../src/core/lmstudio-loaded-models";

const BASE_URL = process.env.NKLEIN_VERIFY_BASE_URL?.trim() || "http://127.0.0.1:1234/v1";
const REQUESTED_MODELS = (process.env.NKLEIN_VERIFY_MODELS ?? "")
	.split(",")
	.map((id) => id.trim())
	.filter(Boolean);

const TOOLS: LocalLlmToolDefinition[] = [
	{
		name: "read_file",
		description: "Read one workspace-relative text file.",
		parameters: {
			type: "object",
			properties: { path: { type: "string" } },
			required: ["path"],
		},
	},
	...(["list_dir", "get_board", "update_focus_chain", "create_card", "run_command"] as const).map((name) => ({
		name,
		description: `Unrelated ${name} tool.`,
		parameters: { type: "object", properties: {} },
	})),
];

async function residentModelIds(): Promise<string[]> {
	if (REQUESTED_MODELS.length > 0) return REQUESTED_MODELS;
	const response = await fetch(`${BASE_URL}/models`);
	if (!response.ok) throw new Error(`Model discovery failed: HTTP ${response.status}`);
	const payload = (await response.json()) as { data?: Array<{ id?: string }> };
	return (payload.data ?? []).flatMap((entry) => (entry.id && !entry.id.includes("embed") ? [entry.id] : []));
}

async function verifyModel(modelId: string): Promise<void> {
	await assertModelLoaded(BASE_URL, modelId);
	const real = new LocalLlmClient({ providerId: "lmstudio", modelId, baseUrl: BASE_URL });
	const offeredCounts: number[] = [];
	let call = 0;
	const controlled: ChatAgentCompletionClient = {
		completeWithTools: async (request, tools, options) => {
			offeredCounts.push(tools.length);
			call += 1;
			if (call === 1) {
				return {
					content: "I should use read_file.",
					toolCalls: [],
					finishReason: "stop",
					raw: { verificationFault: "forced_baseline_no_tool_call" },
				};
			}
			return real.completeWithTools(request, tools, options);
		},
		complete: (request) => real.complete(request),
	};
	const model = createChatAgentModel(controlled, TOOLS, {
		modelId,
		providerId: "lmstudio",
		sampling: { temperature: 0, maxTokens: 1024 },
	});
	const result = await model(
		[{ role: "user", content: "Call read_file with path NOTES.md. Respond by making that tool call now." }],
		true,
	);
	const called = result.toolCalls[0];
	const pass =
		offeredCounts.length === 2 &&
		offeredCounts[0] === TOOLS.length &&
		offeredCounts[1] === 1 &&
		called?.name === "read_file" &&
		result.promptStrategy === "reduced_tool_set";
	process.stdout.write(
		`${JSON.stringify({ modelId, pass, offeredCounts, promptStrategy: result.promptStrategy, toolCall: called ?? null })}\n`,
	);
	if (!pass) throw new Error(`${modelId}: retry-policy verification failed`);
}

async function main(): Promise<void> {
	const models = await residentModelIds();
	if (models.length === 0) throw new Error(`No resident chat model found at ${BASE_URL}`);
	for (const modelId of models) await verifyModel(modelId);
	process.stdout.write(`PASS: ${models.length}/${models.length} resident models recovered through reduced_tool_set.\n`);
}

main().catch((error) => {
	process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
	process.exitCode = 1;
});
