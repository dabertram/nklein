/**
 * F4.35 — task-scoped continuity for LM Studio native `/api/v1/chat` sessions.
 *
 * The caller's transcript remains authoritative. A native response id is only a transport optimization: before using
 * it, this controller proves that the current transcript is the exact prior request followed by the exact assistant
 * answer LM Studio produced and at least one new turn. The already-stored assistant answer is then omitted and only
 * the new delta is sent. Compaction, replay edits, model/policy changes, or a mismatched answer all fail closed to a
 * full stateless request.
 */

import type { NativeChatMessage, ParsedNativeChatResponse } from "./local-native-chat-shape.js";

export type NativeChatSessionPlanMode = "stateful_delta" | "stateless_full";

export interface NativeChatSessionPlan {
	readonly mode: NativeChatSessionPlanMode;
	readonly messages: readonly NativeChatMessage[];
	readonly previousResponseId: string | null;
	/** Opaque continuity generation; prevents an out-of-order concurrent response from replacing newer state. */
	readonly generation: number;
	/** Full caller-owned transcript snapshot, excluding per-attempt instructions and never the shortened wire delta. */
	readonly fullMessages: readonly NativeChatMessage[];
	readonly policyKey: string;
}

interface NativeChatSessionState {
	readonly responseId: string;
	readonly systemPrompt: string;
	readonly requestMessages: readonly NativeChatMessage[];
	readonly assistantText: string;
	readonly assistantReasoning: string;
	readonly policyKey: string;
}

function cloneMessages(messages: readonly NativeChatMessage[]): NativeChatMessage[] {
	return messages.map((message) => ({ role: message.role, content: message.content }));
}

function systemPrompt(messages: readonly NativeChatMessage[]): string {
	return messages
		.filter((message) => message.role === "system")
		.map((message) => message.content)
		.filter((text) => text.trim().length > 0)
		.join("\n\n");
}

function conversation(messages: readonly NativeChatMessage[]): NativeChatMessage[] {
	return cloneMessages(messages.filter((message) => message.role !== "system"));
}

function sameMessage(left: NativeChatMessage, right: NativeChatMessage): boolean {
	return left.role === right.role && left.content === right.content;
}

function startsWithMessages(current: readonly NativeChatMessage[], prefix: readonly NativeChatMessage[]): boolean {
	return (
		prefix.length <= current.length &&
		prefix.every((message, index) => {
			const candidate = current[index];
			return candidate !== undefined && sameMessage(message, candidate);
		})
	);
}

function matchesStoredAssistant(message: NativeChatMessage, state: NativeChatSessionState): boolean {
	if (message.role !== "assistant") return false;
	const withReasoning = state.assistantReasoning
		? `[reasoning]\n${state.assistantReasoning}${state.assistantText ? `\n${state.assistantText}` : ""}`
		: state.assistantText;
	return message.content === state.assistantText || message.content === withReasoning;
}

/** A session-scoped, in-memory optimization. It deliberately persists no provider-owned response id. */
export class NativeChatSessionController {
	#state: NativeChatSessionState | null = null;
	#generation = 0;

	plan(
		messages: readonly NativeChatMessage[],
		policyKey: string,
		attemptMessages: readonly NativeChatMessage[] = [],
	): NativeChatSessionPlan {
		const fullMessages = cloneMessages(messages);
		const attemptTail = cloneMessages(attemptMessages.filter((message) => message.role !== "system"));
		const currentConversation = conversation(fullMessages);
		const state = this.#state;
		if (
			state &&
			state.policyKey === policyKey &&
			state.systemPrompt === systemPrompt(fullMessages) &&
			startsWithMessages(currentConversation, state.requestMessages)
		) {
			const tail = currentConversation.slice(state.requestMessages.length);
			const priorAssistant = tail[0];
			if (
				tail.length >= 2 &&
				priorAssistant !== undefined &&
				matchesStoredAssistant(priorAssistant, state) &&
				tail.slice(1).some((message) => message.content.trim().length > 0)
			) {
				return {
					mode: "stateful_delta",
					messages: [...cloneMessages(tail.slice(1)), ...attemptTail],
					previousResponseId: state.responseId,
					generation: this.#generation,
					fullMessages,
					policyKey,
				};
			}
		}
		return {
			mode: "stateless_full",
			messages: [...fullMessages, ...attemptTail],
			previousResponseId: null,
			generation: this.#generation,
			fullMessages,
			policyKey,
		};
	}

	/** Accept only a clean, chainable response corresponding to the latest continuity generation. */
	accept(plan: NativeChatSessionPlan, response: ParsedNativeChatResponse): boolean {
		if (plan.generation !== this.#generation || !response.responseId) {
			return false;
		}
		this.#state = {
			responseId: response.responseId,
			systemPrompt: systemPrompt(plan.fullMessages),
			requestMessages: conversation(plan.fullMessages),
			assistantText: response.text,
			assistantReasoning: response.reasoning,
			policyKey: plan.policyKey,
		};
		this.#generation += 1;
		return true;
	}

	invalidate(): boolean {
		const hadState = this.#state !== null;
		this.#state = null;
		this.#generation += 1;
		return hadState;
	}
}
