/**
 * Distill CAPTURED aimock fixtures (from a {@link createRecordProxy} campaign) into simulator scenario TRACKS.
 * This closes the reflection loop: real-LLM behavior observed while working on !Klein → tracks keyed by request
 * class + failure-catalog id → grow the deterministic mock library. Pure over the parsed fixture entries — I/O
 * (reading the fixture files) lives in the caller/CLI so this stays trivially testable.
 *
 * Failure-mode classification here is deliberately CONSERVATIVE: it recognizes the mechanically-detectable
 * catalog ids (empty content, reasoning-only, http error, truncated tool-JSON, stringified args) and leaves the
 * rest as `perfect-*`/`observed-*` for a human to reclassify. Over-labeling would poison the library.
 */

import { classifyRequest, type ClassifierRequestShape, DEFAULT_REQUEST_CLASS_MARKERS } from "../aimock/request-classifier.js";
import type { RequestClass, ScenarioTrack, TurnBehavior } from "../scenario/track-types.js";

/** A captured request/response pair as read from the aimock fixture library (subset we consume). */
export interface CapturedInteraction {
	request: ClassifierRequestShape & { messages?: Array<{ role?: string; content?: unknown }> };
	response: {
		status?: number;
		content?: string | null;
		reasoning?: string | null;
		toolCalls?: Array<{ name: string; arguments: unknown }>;
		finishReason?: string;
	};
}

/** The failure-catalog id a captured interaction most conservatively maps to (or a `perfect`/`observed` bucket). */
export function classifyObservedFailure(interaction: CapturedInteraction): string {
	const { response } = interaction;
	if (typeof response.status === "number" && response.status >= 400) {
		return `t-${response.status}`;
	}
	const hasContent = typeof response.content === "string" && response.content.trim().length > 0;
	const hasReasoning = typeof response.reasoning === "string" && response.reasoning.trim().length > 0;
	const hasTools = Array.isArray(response.toolCalls) && response.toolCalls.length > 0;
	if (!hasContent && !hasTools && hasReasoning) {
		return "c-reasoning-only";
	}
	if (!hasContent && !hasTools && !hasReasoning) {
		return "c-empty-completion";
	}
	if (hasTools) {
		for (const call of response.toolCalls ?? []) {
			if (typeof call.arguments === "string") {
				try {
					JSON.parse(call.arguments);
				} catch {
					return "c-bad-json-args";
				}
			}
		}
	}
	if (response.finishReason === "length") {
		return "c-trunc-length";
	}
	return "perfect-observed";
}

function firstUserMessage(request: CapturedInteraction["request"]): string | undefined {
	const user = (request.messages ?? []).find((message) => message.role === "user");
	if (!user || typeof user.content !== "string") {
		return undefined;
	}
	// A short, stable slice keys the track without over-fitting to the full prompt.
	return user.content.trim().split("\n")[0]?.slice(0, 60);
}

function responseToBehavior(response: CapturedInteraction["response"]): TurnBehavior {
	if (typeof response.status === "number" && response.status >= 400) {
		return { kind: "http_error", status: response.status as never, message: "captured upstream error" };
	}
	if (Array.isArray(response.toolCalls) && response.toolCalls.length > 0) {
		return {
			kind: "tool_calls",
			calls: response.toolCalls.map((call) => ({
				name: call.name,
				arguments: typeof call.arguments === "string" ? safeParse(call.arguments) : (call.arguments as Record<string, unknown>),
			})),
			...(typeof response.content === "string" && response.content ? { content: response.content } : {}),
		};
	}
	const content = typeof response.content === "string" ? response.content : "";
	return {
		kind: "text",
		content,
		...(response.reasoning ? { reasoning: response.reasoning } : {}),
		...(response.finishReason === "length" ? { finishReason: "length" as const } : {}),
	};
}

function safeParse(value: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(value);
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : { raw: value };
	} catch {
		return { raw: value };
	}
}

/**
 * Distill one captured interaction into a scenario track. `index` disambiguates ids when many interactions share
 * a request class + failure id in one campaign.
 */
export function distillInteraction(interaction: CapturedInteraction, index: number): ScenarioTrack {
	const requestClass: RequestClass = classifyRequest(interaction.request, DEFAULT_REQUEST_CLASS_MARKERS);
	const failureId = classifyObservedFailure(interaction);
	const userMessageIncludes = firstUserMessage(interaction.request);
	return {
		id: `${failureId}:${requestClass}:${index}`,
		requestClass,
		...(userMessageIncludes ? { userMessageIncludes } : {}),
		turns: [{ behavior: responseToBehavior(interaction.response) }],
		provenance: `distilled from real capture (${failureId})`,
	};
}

/** Distill a whole campaign of captured interactions into tracks. */
export function distillCampaign(interactions: readonly CapturedInteraction[]): ScenarioTrack[] {
	return interactions.map((interaction, index) => distillInteraction(interaction, index));
}
