/**
 * A2A ↔ !Klein task mapping — P17.8, PURE. Translates between A2A v1.0 task semantics and !Klein's own
 * board/summary vocabulary, in both directions:
 *
 *   inbound  — a validated `SendMessage` becomes a SEED-CARD REQUEST (title + prompt), never anything more
 *              powerful: an external agent gets exactly the capability a human seeding a card has, and its
 *              text enters the same S2-fence path every prompt does (peer output is untrusted input).
 *   outbound — a card's (lane, summary state, reviewReason) triple projects onto the A2A TaskState enum.
 *
 * ── MAPPING PHILOSOPHY (the part that is a decision, not a translation) ──
 * A2A's client cares about ONE question per state: "is the ball with the agent, with me, or done?". !Klein's
 * richer lifecycle collapses accordingly:
 *   - `review` lane with the AUTO-review pipeline driving is still WORKING — the pipeline is the agent's own
 *     machinery; a client told INPUT_REQUIRED would wait forever for a question that is not coming.
 *   - `awaiting_review` with reviewReason "attention" (a park) IS INPUT_REQUIRED — !Klein stopped and wants an
 *     operator; that operator is the A2A client's side of the fence.
 *   - `interrupted` maps to CANCELED (someone withdrew the work), `failed` to FAILED, `completed` to COMPLETED
 *     — all three terminal per a2a.proto's own comments.
 * The mapping READS the same fields the UI reads (summary state + reviewReason + lane) rather than inventing a
 * parallel status channel — N21's lesson stands: presentation state has races, so the wire also exposes the
 * authoritative lane, and the summary only refines WITHIN a lane.
 */

import type { A2aArtifact, A2aMessage, A2aTask, A2aTaskState } from "./a2a-wire-shapes";

/** The slice of card/board/summary truth the projection needs — kept minimal so the wire can supply it cheaply. */
export interface A2aTaskProjectionInput {
	cardId: string;
	/** Board lane (column id) — the authoritative placement. */
	columnId: string;
	/** Live session summary state, when a session exists (running | awaiting_review | idle | failed | interrupted). */
	summaryState?: string | null;
	/** Summary reviewReason — "attention" marks an operator-park (todo §5.AA vocabulary). */
	reviewReason?: string | null;
	/** ISO 8601 timestamp for TaskStatus.timestamp (the caller supplies its clock; pure code takes no Date.now). */
	timestamp?: string | null;
	/** Optional agent-authored status text to surface as the status message. */
	statusText?: string | null;
	/** Completed delivery artifacts (already assembled by the wire from delivery evidence). */
	artifacts?: readonly A2aArtifact[];
}

/**
 * Project !Klein card truth onto the A2A TaskState enum (exact strings per a2a-wire-shapes).
 *
 * Order matters: terminal summary states outrank lane, lane outranks non-terminal summary refinement —
 * a `failed` summary in the review lane is FAILED, but a `running` summary in the completed lane is COMPLETED
 * (the lane is authoritative; a late summary emit must not resurrect a live-looking state — N21).
 */
export function projectA2aTaskState(input: A2aTaskProjectionInput): A2aTaskState {
	if (input.columnId === "completed") {
		return "TASK_STATE_COMPLETED";
	}
	if (input.columnId === "trash") {
		return "TASK_STATE_CANCELED";
	}
	if (input.summaryState === "failed") {
		return "TASK_STATE_FAILED";
	}
	if (input.summaryState === "interrupted") {
		return "TASK_STATE_CANCELED";
	}
	if (input.summaryState === "awaiting_review" && input.reviewReason === "attention") {
		return "TASK_STATE_INPUT_REQUIRED";
	}
	if (input.columnId === "backlog" || input.columnId === "ready") {
		return "TASK_STATE_SUBMITTED";
	}
	// planning / in_progress / review with the pipeline driving — the ball is with the agent.
	return "TASK_STATE_WORKING";
}

/** Build the outbound Task object for GetTask/SendMessage responses. */
export function buildA2aTaskView(input: A2aTaskProjectionInput): A2aTask {
	const statusMessage: A2aMessage | undefined = input.statusText?.trim()
		? {
				messageId: `${input.cardId}-status`,
				taskId: input.cardId,
				role: "ROLE_AGENT",
				parts: [{ text: input.statusText.trim() }],
			}
		: undefined;
	return {
		id: input.cardId,
		contextId: input.cardId,
		status: {
			state: projectA2aTaskState(input),
			...(statusMessage ? { message: statusMessage } : {}),
			...(input.timestamp ? { timestamp: input.timestamp } : {}),
		},
		...(input.artifacts && input.artifacts.length > 0 ? { artifacts: [...input.artifacts] } : {}),
	};
}

/** What an accepted SendMessage becomes: exactly a seed-card request, nothing more. */
export interface A2aSeedCardRequest {
	title: string;
	prompt: string;
	/** The client's messageId, echoed into card metadata so the ingress is traceable end-to-end. */
	sourceMessageId: string;
}

const A2A_TITLE_MAX_CHARS = 80;

/**
 * Derive the seed-card request from validated inbound text. Title = first non-empty line, hard-capped —
 * boards render titles, and an unbounded peer-supplied title is a layout injection even before it is a
 * prompt-injection question. The FULL text (title line included) stays in the prompt.
 */
export function buildSeedCardRequestFromA2a(input: { text: string; messageId: string }): A2aSeedCardRequest {
	const firstLine =
		input.text
			.split("\n")
			.find((line) => line.trim().length > 0)
			?.trim() ?? "A2A task";
	const title = firstLine.length <= A2A_TITLE_MAX_CHARS ? firstLine : `${firstLine.slice(0, A2A_TITLE_MAX_CHARS)}…`;
	return { title, prompt: input.text, sourceMessageId: input.messageId };
}
