/**
 * §5.AD / §5.N cadence-gated GOAL re-anchor for the SDK `beforeModel` seam. Over a long agentic run, after many tool
 * calls / retrieval results / partial progress updates a model can lose the ORIGINAL top-level task and start optimising
 * for the wrong sub-goal ("goal dilution", distinct from lost-in-the-middle). This helper periodically re-injects a
 * compact re-anchor block carrying the IMMUTABLE top-level goal near the END of the assembled context (the strong
 * end-zone), right before the model generates its next action.
 *
 * DISTINCT from `reanchorFocusChainMessages` (§5.N), which re-projects the agent's OWN self-authored focus-chain
 * checklist. This one re-anchors the immutable top-level GOAL the agent was originally given — a different failure mode
 * (the model drifting off the *task*, not just off its own plan).
 *
 * The policy layer ({@link shouldReanchor} cadence gate + {@link buildContextReanchor} formatting) lives in the pure
 * `src/core/context-reanchor.ts` core. This module is the thin `beforeModel` adapter: it derives the immutable goal from
 * the request messages themselves (the first user message = the original task prompt), applies the cadence gate, and —
 * when it fires — returns the messages with a synthetic re-anchor message appended at the end. Pure over its inputs (no
 * I/O, no model, no session state), so the whole decision is unit-testable with synthetic messages + a fixed turn count.
 */

import { buildContextReanchor, shouldReanchor } from "../core/context-reanchor";
import type { AgentMessage } from "./sdk-agent-types";

/** Metadata kind stamped on the injected re-anchor message (mirrors the repo-map rail's kind, for detect/skip). */
export const TASK_REANCHOR_MESSAGE_KIND = "kanban_task_reanchor";

/** Cap the goal text we echo back so an unusually long original prompt can't blow the re-anchor block's budget. */
const GOAL_REANCHOR_MAX_CHARS = 2_000;
/**
 * Payload size (tokens) above which this turn re-anchors regardless of cadence. Set where a payload is big enough
 * to push the goal out of the model's effective attention — deliberately well below any context limit, because
 * the burial effect is about POSITION, not about running out of room.
 */
export const PAYLOAD_REANCHOR_TOKENS = 2_000;

/** Read the concatenated text of an AgentMessage's content (string or typed-part array); "" when there is none. */
function readMessageText(message: { role?: string; content?: unknown }): string {
	const content = message.content;
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	return content
		.map((part) =>
			part && typeof part === "object" && "text" in part ? String((part as { text?: unknown }).text ?? "") : "",
		)
		.filter(Boolean)
		.join(" ");
}

/**
 * The IMMUTABLE top-level goal for this request: the text of the FIRST user message (the original task prompt), skipping
 * any synthetic rail messages we ourselves inject. "" when there is no user-authored goal to anchor to.
 *
 * First-user (not last-user) is deliberate: the last user message is the *current step* (what `latestStepText` reads);
 * the FIRST is the original, immutable task — which is exactly what goal-dilution loses.
 */
export function firstUserGoalText(
	messages: readonly { role?: string; content?: unknown; metadata?: unknown }[],
): string {
	for (const message of messages) {
		if (message?.role !== "user") {
			continue;
		}
		// Skip our own injected rail messages (they carry a `metadata.kind`); the goal is a real user-authored message.
		const kind = (message.metadata as { kind?: unknown } | undefined)?.kind;
		if (typeof kind === "string" && kind.length > 0) {
			continue;
		}
		const text = readMessageText(message).trim();
		if (text) {
			return text.length > GOAL_REANCHOR_MAX_CHARS ? text.slice(0, GOAL_REANCHOR_MAX_CHARS) : text;
		}
	}
	return "";
}

/** Build the synthetic user message that carries the re-anchor block, stamped so it is detectable/skippable. */
function createTaskReanchorMessage(block: string): AgentMessage {
	return {
		id: `kanban-task-reanchor-${Date.now()}`,
		role: "user",
		content: [{ type: "text", text: block }],
		createdAt: Date.now(),
		metadata: { kind: TASK_REANCHOR_MESSAGE_KIND },
	};
}

/** Input for the `beforeModel` re-anchor decision. */
export interface DecideTaskReanchorInput {
	/** The request messages as they stand this turn (after any earlier `beforeModel` rewrites). */
	messages: readonly AgentMessage[];
	/** Current turn index (0-based); the SDK snapshot's `iteration`. Re-anchoring never fires on turn 0. */
	turnCount: number;
	/** The turn at which the last re-anchor was injected, or `null` when none has been injected yet. */
	lastReanchorTurn: number | null;
	/** How many turns must elapse between re-anchors (clamped to ≥ 1 by the cadence gate). */
	everyNTurns: number;
	/**
	 * P18.2: tokens of PAYLOAD this turn is adding (a large tool result, retrieved documents, a pasted file).
	 *
	 * The cadence gate alone is not enough, and the evidence says why: "Lost in the Middle" measured a gold
	 * document buried mid-context scoring **57.2% against a 56.1% CLOSED-BOOK baseline** — a buried document
	 * contributes almost nothing. The same paper found query-aware contextualization (restating the task AFTER
	 * the data as well as before) restored near-perfect retrieval. That effect is about THIS turn's payload, not
	 * about elapsed turns: on a 6-turn cadence, five of every six large-payload turns would bury the goal with no
	 * restatement at all. So a payload above {@link PAYLOAD_REANCHOR_TOKENS} fires the re-anchor regardless of
	 * cadence. Absent/zero ⇒ cadence-only, exactly as before.
	 */
	payloadTokensThisTurn?: number;
	/**
	 * The current step / sub-task, if known — echoed into the block to situate the model. Optional; the immutable GOAL
	 * itself is derived from the messages and never overridden by this.
	 */
	currentStep?: string | null;
	/** The Kanban card title, if the context is card-scoped. Optional. */
	cardTitle?: string | null;
}

/** Outcome of the re-anchor decision. `messages` is the (possibly) rewritten list; identical reference when no-op. */
export interface DecideTaskReanchorResult {
	/** Whether a re-anchor block was appended this turn. */
	appended: boolean;
	/** The messages to use for the request — the SAME reference as the input when nothing was appended. */
	messages: readonly AgentMessage[];
	/** The re-anchor block text, when one was appended; `null` otherwise. */
	block: string | null;
	/** The `lastReanchorTurn` to carry forward: `turnCount` when appended, else the input `lastReanchorTurn`. */
	nextLastReanchorTurn: number | null;
}

/**
 * Decide whether to re-inject the immutable top-level GOAL this turn, and if so return the messages with a compact
 * `<reanchor>` block appended at the END (the strong end-zone). Pure over its inputs.
 *
 * No-op (returns the input `messages` reference unchanged, `appended: false`) when:
 *  - the cadence gate says it is not time (turn 0, or fewer than `everyNTurns` since the last re-anchor), OR
 *  - there is no immutable goal to anchor to (no user-authored first message).
 *
 * When it fires, `nextLastReanchorTurn` advances to `turnCount` so the caller can persist it for the next turn.
 */
export function decideTaskReanchorForRequest(input: DecideTaskReanchorInput): DecideTaskReanchorResult {
	const noop: DecideTaskReanchorResult = {
		appended: false,
		messages: input.messages,
		block: null,
		nextLastReanchorTurn: input.lastReanchorTurn,
	};

	// P18.2: a large payload buries the goal THIS turn, so it overrides the cadence. Turn 0 is still excluded —
	// there is nothing to re-anchor to before the goal has been stated once.
	const largePayload = input.turnCount > 0 && (input.payloadTokensThisTurn ?? 0) >= PAYLOAD_REANCHOR_TOKENS;
	if (
		!largePayload &&
		!shouldReanchor({
			turnCount: input.turnCount,
			lastReanchorTurn: input.lastReanchorTurn,
			everyNTurns: input.everyNTurns,
		})
	) {
		return noop;
	}

	const goal = firstUserGoalText(input.messages);
	if (!goal) {
		return noop;
	}

	const block = buildContextReanchor({
		goal,
		currentStep: input.currentStep ?? null,
		cardTitle: input.cardTitle ?? null,
	});

	return {
		appended: true,
		messages: [...input.messages, createTaskReanchorMessage(block)],
		block,
		nextLastReanchorTurn: input.turnCount,
	};
}
