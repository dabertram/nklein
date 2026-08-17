/**
 * §dsh#32 — SESSION FORK AT A STEP BOUNDARY (pure core). DeepSeek Harness's `ctx.sessions.fork(source,
 * boundary)` duplicates a live session's context into a new session that continues independently — a cheaper
 * best-of-N than !Klein's ::spec full-restart mirror, and the substrate for checkpoint-retry of risky steps.
 *
 * !Klein already owns the effectful halves: `readPersistedTaskSession` (the transcript snapshot) and the
 * overflow controller's `restartOrStartWithMessages` (start a session from initialMessages). This core supplies
 * the missing pure piece: pick a SAFE boundary in the persisted transcript and produce the fork's initial
 * messages + provenance. The safety rule mirrors the SDK's interrupt rule: a fork may only cut where every
 * tool_use so far has its tool_result — forking a dangling side effect would hand the fork a half-executed
 * step it never sees the outcome of.
 */

import { z } from "zod";

/** Structural view of a persisted message — role + Anthropic-style content parts (tolerant of extras). */
export interface ForkSourceMessage {
	role: string;
	content?: unknown;
}

export const sessionForkBoundarySchema = z.union([
	z.literal("latest"),
	z.object({ afterMessageIndex: z.number().int().min(0) }),
]);
export type SessionForkBoundary = z.infer<typeof sessionForkBoundarySchema>;

export interface SessionForkPlan<T extends ForkSourceMessage = ForkSourceMessage> {
	forkTaskId: string;
	/** The messages the fork starts from (source transcript up to and including the boundary message). */
	initialMessages: T[];
	provenance: {
		sourceTaskId: string;
		/** Index of the LAST source message included. */
		boundaryIndex: number;
		forkedAt: string;
	};
}

export type SessionForkRefusal =
	| { kind: "same_id" }
	| { kind: "empty_source" }
	| { kind: "index_out_of_range"; index: number; messageCount: number }
	| { kind: "dangling_tool_use"; index: number; unresolvedToolUseIds: string[] };

function collectPartIds(message: ForkSourceMessage, type: "tool_use" | "tool_result"): string[] {
	if (!Array.isArray(message.content)) {
		return [];
	}
	const ids: string[] = [];
	for (const part of message.content) {
		if (part && typeof part === "object" && (part as { type?: unknown }).type === type) {
			const id =
				(part as { id?: unknown; tool_use_id?: unknown }).id ?? (part as { tool_use_id?: unknown }).tool_use_id;
			if (typeof id === "string" && id.length > 0) {
				ids.push(id);
			}
		}
	}
	return ids;
}

/** Tool_use ids in [0..index] that have no tool_result in the same prefix — must be empty at a step boundary. */
export function unresolvedToolUseIdsAt(messages: readonly ForkSourceMessage[], index: number): string[] {
	const used = new Set<string>();
	const resolved = new Set<string>();
	for (let cursor = 0; cursor <= index && cursor < messages.length; cursor++) {
		const message = messages[cursor] as ForkSourceMessage;
		for (const id of collectPartIds(message, "tool_use")) {
			used.add(id);
		}
		for (const id of collectPartIds(message, "tool_result")) {
			resolved.add(id);
		}
	}
	return [...used].filter((id) => !resolved.has(id));
}

/** The latest index that is a valid step boundary, or null when none exists. */
export function latestStepBoundaryIndex(messages: readonly ForkSourceMessage[]): number | null {
	for (let index = messages.length - 1; index >= 0; index--) {
		if (unresolvedToolUseIdsAt(messages, index).length === 0) {
			return index;
		}
	}
	return null;
}

/** Plan a fork, or refuse with a typed reason. PURE — the caller supplies the clock. */
export function buildSessionForkPlan<T extends ForkSourceMessage>(input: {
	sourceTaskId: string;
	forkTaskId: string;
	messages: readonly T[];
	boundary: SessionForkBoundary;
	forkedAt: string;
}): { plan: SessionForkPlan<T> } | { refusal: SessionForkRefusal } {
	if (input.sourceTaskId === input.forkTaskId) {
		return { refusal: { kind: "same_id" } };
	}
	if (input.messages.length === 0) {
		return { refusal: { kind: "empty_source" } };
	}
	let boundaryIndex: number;
	if (input.boundary === "latest") {
		const latest = latestStepBoundaryIndex(input.messages);
		if (latest === null) {
			return {
				refusal: {
					kind: "dangling_tool_use",
					index: input.messages.length - 1,
					unresolvedToolUseIds: unresolvedToolUseIdsAt(input.messages, input.messages.length - 1),
				},
			};
		}
		boundaryIndex = latest;
	} else {
		boundaryIndex = input.boundary.afterMessageIndex;
		if (boundaryIndex >= input.messages.length) {
			return { refusal: { kind: "index_out_of_range", index: boundaryIndex, messageCount: input.messages.length } };
		}
		const unresolved = unresolvedToolUseIdsAt(input.messages, boundaryIndex);
		if (unresolved.length > 0) {
			return { refusal: { kind: "dangling_tool_use", index: boundaryIndex, unresolvedToolUseIds: unresolved } };
		}
	}
	return {
		plan: {
			forkTaskId: input.forkTaskId,
			initialMessages: input.messages.slice(0, boundaryIndex + 1).map((message) => ({ ...message })),
			provenance: {
				sourceTaskId: input.sourceTaskId,
				boundaryIndex,
				forkedAt: input.forkedAt,
			},
		},
	};
}
