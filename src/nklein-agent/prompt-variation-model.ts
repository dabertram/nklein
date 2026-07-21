/** F3.3 — bounded, role-aware prompt variation at the shared swarm AgentModel seam. */
import type { AgentMessage, AgentMessagePart, AgentModel, AgentModelRequest } from "@cline/shared";
import { stripFocusBrief } from "./nklein-observed-path-extraction";
import { buildPromptVariant, PROMPT_VARIANT_LADDER, type PromptVariantFamily } from "./nklein-prompt-variation";
import { createRecoveryLadderModel } from "./recovery-ladder-model";

export type SwarmPromptVariationRole = "architect" | "worker" | "reviewer" | "unknown";

export interface SwarmPromptVariationOutcome {
	role: SwarmPromptVariationRole;
	family: PromptVariantFamily;
	toolName: string;
	recovered: boolean;
}

const ROLE_VARIANT_ORDER: Record<SwarmPromptVariationRole, readonly PromptVariantFamily[]> = {
	architect: ["explicit_format", "reason_then_act", "example_led", "imperative"],
	worker: ["imperative", "explicit_format", "example_led", "reason_then_act"],
	reviewer: ["explicit_format", "imperative", "example_led", "reason_then_act"],
	unknown: PROMPT_VARIANT_LADDER,
};

export function promptVariantOrderForRole(role: SwarmPromptVariationRole): readonly PromptVariantFamily[] {
	return ROLE_VARIANT_ORDER[role];
}

function textFromMessage(message: AgentMessage): string {
	return message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}

function toolMentionIndex(text: string, toolName: string): number {
	const escaped = toolName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
	return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}([^\\p{L}\\p{N}_]|$)`, "iu").exec(text)?.index ?? -1;
}

function replaceMessageText(message: AgentMessage, text: string): AgentMessage {
	let inserted = false;
	const content: AgentMessagePart[] = [];
	for (const part of message.content) {
		if (part.type !== "text") {
			content.push(part);
		} else if (!inserted) {
			content.push({ type: "text", text });
			inserted = true;
		}
	}
	return { ...message, content: inserted ? content : [{ type: "text", text }, ...content] };
}

export interface PromptVariationPlan {
	family: PromptVariantFamily;
	toolName: string;
	request: AgentModelRequest;
}

/**
 * Build a safe suffix-only variant. A retry is eligible only when the latest user instruction explicitly names an
 * offered tool, or exactly one run-completing tool is offered. This prevents a legitimate prose final answer from
 * being reframed into an invented action. The system prompt and every earlier message remain byte-identical.
 */
export function planSwarmPromptVariation(
	request: AgentModelRequest,
	role: SwarmPromptVariationRole,
): PromptVariationPlan | null {
	let userIndex = -1;
	for (let index = request.messages.length - 1; index >= 0; index -= 1) {
		const candidate = request.messages[index];
		// An agent iteration commonly ends in a user-role message containing only tool results. Keep walking to the
		// latest actual instruction; otherwise recovery silently disappears immediately after the first completed tool.
		if (candidate?.role === "user" && textFromMessage(candidate).trim().length > 0) {
			userIndex = index;
			break;
		}
	}
	const userMessage = userIndex >= 0 ? request.messages[userIndex] : undefined;
	if (!userMessage) return null;
	// Context focusing prepends a machine-generated coverage rail to the original user instruction. Tool names in that
	// rail (especially `read_files`) are evidence labels, not requested actions; using them as retry anchors caused a
	// live decomposition recovery to force an endless read loop (run 20260721-144558).
	const instruction = stripFocusBrief(textFromMessage(userMessage)).trim();
	if (!instruction) return null;
	const namedTool = request.tools
		.map((tool, order) => ({ tool, order, index: toolMentionIndex(instruction, tool.name) }))
		.filter((candidate) => candidate.index >= 0)
		.sort((left, right) => left.index - right.index || left.order - right.order)[0]?.tool;
	const completingTools = request.tools.filter((tool) => tool.lifecycle?.completesRun === true);
	const tool = namedTool ?? (completingTools.length === 1 ? completingTools[0] : undefined);
	if (!tool) return null;
	const family = promptVariantOrderForRole(role)[0] ?? "imperative";
	const variant = buildPromptVariant(family, { instruction, toolName: tool.name });
	const messages = request.messages.map((message, index) =>
		index === userIndex ? replaceMessageText(message, variant) : message,
	);
	return { family, toolName: tool.name, request: { ...request, messages } };
}

/**
 * Give a stopped, no-tool-call swarm turn one replacement-safe retry using its role's bounded variant. Provider errors,
 * caller aborts, tool-call turns, and unanchored final-answer turns pass through unchanged.
 */
export function createSwarmPromptVariationModel(
	base: AgentModel,
	options: {
		role?: SwarmPromptVariationRole;
		onOutcome?: (outcome: SwarmPromptVariationOutcome) => void;
	} = {},
): AgentModel {
	const role = options.role ?? "unknown";
	return {
		stream(request) {
			const plan = planSwarmPromptVariation(request, role);
			if (!plan) return base.stream(request);
			return createRecoveryLadderModel({
				base,
				maxAttempts: 1,
				shouldRecover: (signal) =>
					!signal.callerAborted &&
					!signal.hadToolCall &&
					signal.offeredTools &&
					signal.finishReason === "stop" &&
					signal.finishError === null &&
					signal.thrownError === null,
				reframe: () => plan.request,
				onAttemptComplete: (signal) => {
					if (signal.attempt !== 1) return;
					options.onOutcome?.({
						role,
						family: plan.family,
						toolName: plan.toolName,
						recovered: signal.hadToolCall,
					});
				},
			}).stream(request);
		},
	};
}
