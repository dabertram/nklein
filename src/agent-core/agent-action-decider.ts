import type {
	LocalLlmChatMessage,
	LocalLlmClient,
	LocalLlmSamplingOptions,
} from "../nklein-sdk/nklein-local-llm-client";
import { resolveLocalSamplingOptions } from "../nklein-sdk/nklein-sampling-policy";
import type { AgentAction, AgentCoreTool, DecideAction, DecideActionInput } from "./agent-loop";

/**
 * Wires a `LocalLlmClient` to the agent loop's `decideAction`, using **constrained JSON decoding** so a small
 * model reliably emits a valid next action (the tool selection is the part weak models most often botch). The
 * action JSON schema enumerates the available tool names plus a `final` option; the tool input is passed
 * through and validated by each tool's own lenient parser.
 */

export interface LocalLlmActionDeciderOptions {
	client: Pick<LocalLlmClient, "generateStructured">;
	/** Extra system guidance prepended to the standard agent-core instructions. */
	systemPrompt?: string;
	modelId?: string | null;
	sampling?: Partial<LocalLlmSamplingOptions>;
}

function buildToolCatalog(tools: AgentCoreTool[]): string {
	return tools.map((tool) => `- ${tool.name}: ${tool.description}`).join("\n");
}

function buildActionSchema(tools: AgentCoreTool[]): { name: string; schema: Record<string, unknown> } {
	return {
		name: "agent_action",
		schema: {
			type: "object",
			properties: {
				thought: { type: "string", description: "Brief reasoning for this step." },
				action: { type: "string", enum: [...tools.map((tool) => tool.name), "final"] },
				input: { type: "object", description: "Arguments for the chosen tool (omit for final)." },
				message: { type: "string", description: "Final answer to the user (only when action is final)." },
			},
			required: ["action"],
			additionalProperties: true,
		},
	};
}

const BASE_SYSTEM_PROMPT = `You are !Klein's local coding agent. Work in small, verifiable steps.
Each turn, choose exactly one action: either call a tool, or finish with "final".
Reply ONLY with a JSON object: { "thought": string, "action": <tool name or "final">, "input": object, "message": string }.
Use "input" for tool arguments. Use "message" only when action is "final". Prefer edit_file for changes to existing files.`;

function renderTranscript(input: DecideActionInput): string {
	if (input.transcript.length === 0) {
		return "(no steps yet)";
	}
	return input.transcript
		.map((entry) => {
			if (entry.action.kind === "final") {
				return `Step ${entry.turn}: FINAL`;
			}
			const observation = entry.observation ? `\n  observation: ${entry.observation}` : "";
			let inputKey: string;
			try {
				inputKey = JSON.stringify(entry.action.input);
			} catch {
				inputKey = String(entry.action.input);
			}
			return `Step ${entry.turn}: ${entry.action.tool} ${inputKey}${observation}`;
		})
		.join("\n");
}

function toAgentAction(value: unknown): AgentAction {
	const record = (value ?? {}) as Record<string, unknown>;
	const thought = typeof record.thought === "string" ? record.thought : undefined;
	const action = typeof record.action === "string" ? record.action : "final";
	if (action === "final") {
		return { kind: "final", thought, message: typeof record.message === "string" ? record.message : "" };
	}
	return { kind: "tool", thought, tool: action, input: record.input ?? {} };
}

export function createLocalLlmActionDecider(options: LocalLlmActionDeciderOptions): DecideAction {
	return async (input: DecideActionInput): Promise<AgentAction> => {
		const schema = buildActionSchema(input.tools);
		const messages: LocalLlmChatMessage[] = [
			{
				role: "system",
				content: `${BASE_SYSTEM_PROMPT}${options.systemPrompt ? `\n\n${options.systemPrompt}` : ""}`,
			},
			{
				role: "user",
				content: `Task:\n${input.task}\n\nAvailable tools:\n${buildToolCatalog(
					input.tools,
				)}\n\nProgress so far:\n${renderTranscript(input)}\n\nChoose the next action.`,
			},
		];
		const sampling = resolveLocalSamplingOptions({
			role: "structured",
			modelId: options.modelId,
			override: options.sampling,
		});
		return options.client.generateStructured<AgentAction>({
			messages,
			jsonSchema: schema,
			parse: toAgentAction,
			sampling,
		});
	};
}
