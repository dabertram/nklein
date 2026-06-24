import type { ChatPromptMessage } from "./chat-turn-context";

/**
 * Chat agent tool-call loop (todo §5.M — the tool-using multi-turn agent). The pure orchestration of "ask the
 * model → it may call tools → execute them → feed results back → repeat until it answers". The model call and the
 * tool execution are injected, so this is fully unit-testable; the live wiring supplies a tools-aware local-model
 * completion and an executor that applies the execution-mode policy gate + audit log before running each tool.
 *
 * Tool execution governance (the §5.M invariant — host access never default, always confirmed + logged) lives in
 * the injected `executeTool`; this loop only orchestrates and bounds the iterations so it always terminates.
 */

export interface ChatToolCall {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

export interface ChatToolResult {
	callId: string;
	content: string;
}

export interface ChatAgentModelResponse {
	/** The assistant's natural-language text (the final answer when there are no tool calls). */
	text: string;
	toolCalls: ChatToolCall[];
}

export interface ChatAgentStep {
	toolCall: ChatToolCall;
	result: ChatToolResult;
}

export interface ChatAgentLoopDeps {
	/** Call the model; `allowTools` is false on the final, forced answer turn so it stops requesting tools. */
	complete: (messages: readonly ChatPromptMessage[], allowTools: boolean) => Promise<ChatAgentModelResponse>;
	/** Execute one tool call (after the policy gate + audit, in the live wiring); returns the result content. */
	executeTool: (call: ChatToolCall) => Promise<ChatToolResult>;
	/** Fold an assistant turn's tool calls + their results back into the message list for the next turn. */
	appendToolExchange: (
		messages: readonly ChatPromptMessage[],
		response: ChatAgentModelResponse,
		results: readonly ChatToolResult[],
	) => ChatPromptMessage[];
}

export interface ChatAgentLoopResult {
	finalText: string;
	steps: ChatAgentStep[];
	/** True when the loop was cut off at `maxIterations` and forced a final answer. */
	hitIterationLimit: boolean;
}

export async function runChatAgentLoop(
	input: { messages: readonly ChatPromptMessage[]; maxIterations?: number },
	deps: ChatAgentLoopDeps,
): Promise<ChatAgentLoopResult> {
	const maxIterations = Math.max(1, input.maxIterations ?? 8);
	let messages: readonly ChatPromptMessage[] = input.messages;
	const steps: ChatAgentStep[] = [];

	for (let iteration = 0; iteration < maxIterations; iteration++) {
		const response = await deps.complete(messages, true);
		if (response.toolCalls.length === 0) {
			return { finalText: response.text, steps, hitIterationLimit: false };
		}
		const results: ChatToolResult[] = [];
		for (const toolCall of response.toolCalls) {
			const result = await deps.executeTool(toolCall);
			results.push(result);
			steps.push({ toolCall, result });
		}
		messages = deps.appendToolExchange(messages, response, results);
	}

	// Out of tool iterations — force one final answer turn with tools disabled so it must conclude.
	const finalResponse = await deps.complete(messages, false);
	return { finalText: finalResponse.text, steps, hitIterationLimit: true };
}
