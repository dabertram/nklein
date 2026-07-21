/** F4.15: apply the active skills' request policy at the shared swarm AgentModel seam. */
import type { AgentMessage, AgentMessagePart, AgentModel, AgentModelEvent, AgentModelRequest } from "@cline/shared";
import { type AnswerTaskClass, answerBudgetPrior } from "../core/answer-budget-prior.js";
import { isReasoningModel } from "../core/model-thinking-control.js";
import { resolveApiProfileRequest } from "../core/skill-api-profile-request.js";
import type { SkillApiProfile } from "../core/skill-registry.js";
import { agentMessageToEndpointText } from "./local-alternate-endpoint-model.js";
import { buildConstrainedToolCallSchema, parseConstrainedToolCall } from "./nklein-constrained-tool-call.js";
import type {
	LocalLlmChatMessage,
	LocalLlmSamplingOptions,
	LocalLlmStructuredFormat,
	LocalLlmToolCompletion,
	LocalLlmToolDefinition,
} from "./nklein-local-llm-client.js";

export interface SkillApiProfileDirectClient {
	completeWithTools(
		request: { messages: LocalLlmChatMessage[]; sampling?: LocalLlmSamplingOptions; signal?: AbortSignal },
		tools: readonly LocalLlmToolDefinition[],
		opts?: { toolChoice?: "auto" | "required" },
	): Promise<LocalLlmToolCompletion>;
	complete(request: {
		messages: LocalLlmChatMessage[];
		sampling?: LocalLlmSamplingOptions;
		format?: LocalLlmStructuredFormat;
		signal?: AbortSignal;
	}): Promise<{ content: string }>;
}

export interface SkillApiProfileAgentModelOptions {
	modelId: string;
	profile?: SkillApiProfile;
	contextWindow?: number | null;
	directClient?: SkillApiProfileDirectClient;
}

function withDirective(request: AgentModelRequest, directive: string | null): AgentModelRequest {
	if (!directive) return request;
	for (let messageIndex = request.messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
		const message = request.messages[messageIndex];
		if (message?.role !== "user") continue;
		const partIndex = message.content.findIndex((part) => part.type === "text" && part.text.trim().length > 0);
		if (partIndex < 0) continue;
		const part = message.content[partIndex];
		if (part?.type !== "text" || part.text.includes(directive)) return request;
		const content = [...message.content];
		content[partIndex] = { ...part, text: `${part.text}\n\n${directive}` };
		const messages = [...request.messages];
		messages[messageIndex] = { ...message, content };
		return { ...request, messages };
	}
	return request;
}

function requestTokenEstimate(request: AgentModelRequest): number {
	const text = [
		request.systemPrompt ?? "",
		...request.messages.map(agentMessageToEndpointText),
		...request.tools.map((tool) => `${tool.name}\n${tool.description}\n${JSON.stringify(tool.inputSchema)}`),
	].join("\n");
	return Math.ceil(text.length / 4);
}

function taskClass(request: AgentModelRequest): AnswerTaskClass {
	if (request.tools.length > 1) return "multi_tool";
	if (request.tools.length === 1) return "single_tool";
	const chars =
		(request.systemPrompt?.length ?? 0) +
		request.messages.reduce((n, m) => n + agentMessageToEndpointText(m).length, 0);
	return chars >= 8_000 ? "long_generation" : chars >= 2_000 ? "decomposition" : "trivial_reply";
}

function toDirectMessages(request: AgentModelRequest): LocalLlmChatMessage[] {
	return [
		...(request.systemPrompt?.trim() ? [{ role: "system" as const, content: request.systemPrompt }] : []),
		...request.messages.map((message) => ({
			role: message.role === "assistant" ? ("assistant" as const) : ("user" as const),
			content: agentMessageToEndpointText(message),
		})),
	];
}

function toDirectTools(request: AgentModelRequest): LocalLlmToolDefinition[] {
	return request.tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		parameters: tool.inputSchema,
	}));
}

function containsImage(messages: readonly AgentMessage[]): boolean {
	return messages.some((message) => message.content.some((part: AgentMessagePart) => part.type === "image"));
}

function toolEvents(call: { id: string; name: string; arguments: unknown }): AgentModelEvent[] {
	return [
		{
			type: "tool-call-delta",
			toolCallId: call.id,
			toolName: call.name,
			inputText: JSON.stringify(call.arguments),
		},
		{ type: "finish", reason: "tool-calls" },
	];
}

/**
 * Decorate an AgentModel without patching the SDK. Empty profiles are a strict pass-through. Structured/forced tool
 * turns use !Klein's local direct client proactively; unsupported/invalid direct results fall back to the normal SDK
 * model with the same sampler, budget, and thinking policy.
 */
export function createSkillApiProfileAgentModel(
	base: AgentModel,
	options: SkillApiProfileAgentModelOptions,
): AgentModel {
	if (!options.profile || Object.keys(options.profile).length === 0) return base;
	const resolved = resolveApiProfileRequest(options.profile, options.modelId);
	return {
		stream(request): AsyncIterable<AgentModelEvent> {
			return (async function* () {
				const directClient = options.directClient;
				let profiled = withDirective(request, resolved.thinkingDirective);
				const requestOptions = { ...profiled.options };
				if (resolved.temperature !== null) requestOptions.temperature = resolved.temperature;
				if (options.profile?.reasoning === "off") requestOptions.thinking = false;
				if (options.profile?.reasoning === "high") requestOptions.thinking = true;
				if (typeof requestOptions.maxTokens !== "number") {
					const mode =
						resolved.forceToolCall || resolved.structuredOutputStrategy === "native_tool_call"
							? "forced_tool_call"
							: resolved.preferStructuredOutput
								? "structured"
								: "free_generation";
					requestOptions.maxTokens = answerBudgetPrior({
						reasoning: isReasoningModel(options.modelId),
						taskClass: taskClass(profiled),
						outputMode: mode,
						contextWindow: options.contextWindow ?? 32_000,
						inputTokens: requestTokenEstimate(profiled),
					}).maxTokens;
				}
				profiled = { ...profiled, options: requestOptions };

				const directEligible =
					directClient &&
					profiled.tools.length > 0 &&
					!containsImage(profiled.messages) &&
					(resolved.forceToolCall || resolved.preferStructuredOutput);
				if (directEligible) {
					const tools = toDirectTools(profiled);
					const messages = toDirectMessages(profiled);
					const sampling: LocalLlmSamplingOptions = {
						...(typeof requestOptions.temperature === "number"
							? { temperature: requestOptions.temperature }
							: {}),
						...(typeof requestOptions.maxTokens === "number" ? { maxTokens: requestOptions.maxTokens } : {}),
					};
					try {
						if (resolved.forceToolCall || resolved.structuredOutputStrategy === "native_tool_call") {
							const completion = await directClient.completeWithTools(
								{ messages, sampling, signal: profiled.signal },
								tools,
								{ toolChoice: "required" },
							);
							const call = completion.toolCalls[0];
							if (call) {
								for (const event of toolEvents({ id: call.id, name: call.name, arguments: call.arguments }))
									yield event;
								return;
							}
						} else if (resolved.structuredOutputStrategy === "json_schema_grammar") {
							const schema = buildConstrainedToolCallSchema(tools);
							if (!schema) throw new Error("No tools available for constrained skill-profile call.");
							const completion = await directClient.complete({
								messages: [
									...messages,
									{
										role: "system",
										content: "Return the next required tool call as the constrained JSON object.",
									},
								],
								sampling,
								format: { jsonSchema: schema },
								signal: profiled.signal,
							});
							const call = parseConstrainedToolCall(completion.content, tools);
							if (call) {
								for (const event of toolEvents({
									id: `skill-profile-${Date.now().toString(36)}`,
									name: call.name,
									arguments: call.arguments,
								}))
									yield event;
								return;
							}
						}
					} catch {
						// The normal SDK path is the correctness fallback; local profile controls must not lose a turn.
					}
				}

				for await (const event of await base.stream(profiled)) yield event;
			})();
		},
	};
}
