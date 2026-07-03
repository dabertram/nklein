/**
 * §5.AU STEP 6a — decide what a message SENT TO A CARD actually does, keeping COMMUNICATION decoupled from EXECUTION
 * (user 2026-07-01). Sending a card a message and *starting its work* are orthogonal: a card with blocking predecessors
 * must never be force-started by a message, but the user must still be able to guide it or ask about it. This pure,
 * deterministic core maps `(card execution state × message intent) → effect`, and it is the invariant guard that a
 * BLOCKED card is NEVER told to start.
 *
 * "Card start" means begin WORK (do the task), which is readiness-gated elsewhere (the §5.AS dependency-unblock logic);
 * this core only ever emits `request_start` for a READY card (a steer/"go"), and even then the start still routes through
 * that gate. Answering a QUESTION about a card is CONSULT (read-only, ungated) — a state-derived answer when cheap, a
 * model turn only when the question is substantive — and is never "starting" the card.
 *
 * Intent is classified by the caller (a light local/deterministic step) into one of the four kinds; this core is pure
 * over the resolved intent + state.
 */

/** The card's execution state as it bears on a message's effect. */
export type CardExecutionState = "running" | "ready" | "blocked" | "done";

/** The classified intent of the user's message to the card. */
export type CardMessageIntent = "guidance" | "steer" | "question" | "answer";

export type CardMessageEffect =
	/** Deliver to the live running agent (continues the existing run — NOT a start). */
	| "deliver_live"
	/** Durably queue in the card's mailbox; consumed as opening context when the card later starts WORK. */
	| "queue_mailbox"
	/** A READY card steered/"go": request a start — STILL routed through the readiness gate (the only start-bearing effect). */
	| "request_start"
	/** Answer a question with a read-only CONSULT turn (substantive question; does the card's context, not its task). */
	| "consult_response"
	/** Answer a question deterministically from board/ledger STATE (cheap; the local-first default). */
	| "answer_from_state"
	/** Append a follow-up comment to a DONE card (no work). */
	| "append_followup"
	/** Steering a BLOCKED card ⇒ surface a gated unblock suggestion (reprioritize / drop the dependency) — never auto. */
	| "suggest_unblock";

export interface ResolveCardMessageEffectInput {
	cardState: CardExecutionState;
	intent: CardMessageIntent;
	/**
	 * For a `question`: whether it is substantive enough to warrant a CONSULT model turn (vs a cheap state-derived answer).
	 * Caller-classified; defaults to false (prefer the frugal state answer, per local-first).
	 */
	questionNeedsConsult?: boolean;
}

export interface CardMessageEffectVerdict {
	effect: CardMessageEffect;
	/** Whether this effect initiates WORK on the card (only ever true for `request_start`). */
	startsWork: boolean;
	reason: string;
}

function verdict(effect: CardMessageEffect, reason: string): CardMessageEffectVerdict {
	return { effect, startsWork: effect === "request_start", reason };
}

/** How a question resolves for a non-running card: a cheap state answer by default, a CONSULT turn only when substantive. */
function questionEffect(input: ResolveCardMessageEffectInput): CardMessageEffectVerdict {
	return input.questionNeedsConsult === true
		? verdict("consult_response", "substantive question — read-only consult turn (not the card's task)")
		: verdict("answer_from_state", "question answered from board/ledger state (cheap, local-first)");
}

/** Question openers/markers for the light deterministic intent classifier. */
const QUESTION_OPENER_RE =
	/^(who|what|when|where|why|how|is|are|was|were|does|do|did|can|could|should|would|will|has|have|any\s+update|status)\b/i;
/** A clear "go" — the only phrasing that reads as steer (start-bearing on a READY card, so keep this strict). */
const STEER_RE =
	/^(go|start|begin|proceed|resume|continue|run\s+it|ship\s+it|kick\s+it\s+off|do\s+it|go\s+ahead)\b[.!]?/i;

/**
 * Classify a card-addressed message's intent — the "light local/deterministic step" the effect core expects from
 * its caller. Deliberately conservative: only an explicit interrogative reads as `question`, only a clear leading
 * "go" reads as `steer` (steer can start a READY card, so ambiguity must fall to `guidance`). Never returns
 * `answer` — that binding comes from the addressing ladder (an outstanding ASK), not from the text.
 */
export function classifyCardMessageIntent(text: string): Exclude<CardMessageIntent, "answer"> {
	const trimmed = text.trim();
	if (STEER_RE.test(trimmed)) {
		return "steer";
	}
	if (trimmed.endsWith("?") || QUESTION_OPENER_RE.test(trimmed)) {
		return "question";
	}
	return "guidance";
}

/**
 * Decide the effect of a message to a card. Pure + deterministic. INVARIANT: a `blocked` card can never yield
 * `request_start`/`startsWork` — communication reaches it, execution does not.
 */
export function resolveCardMessageEffect(input: ResolveCardMessageEffectInput): CardMessageEffectVerdict {
	// An ANSWER (to the card's own pending question) always reaches the session that asked — it continues, never starts.
	if (input.intent === "answer") {
		return verdict("deliver_live", "answer delivered to the session awaiting it");
	}

	switch (input.cardState) {
		case "running":
			// A live agent is working — deliver guidance/steer/question straight into the turn.
			return input.intent === "question"
				? verdict("deliver_live", "question posed to the running agent")
				: verdict("deliver_live", "guidance/steer delivered to the running agent");

		case "ready":
			if (input.intent === "question") {
				return questionEffect(input);
			}
			// guidance ⇒ prep the mailbox (don't auto-start); steer/"go" ⇒ request a start (still readiness-gated).
			return input.intent === "steer"
				? verdict("request_start", "steer on a ready card — request a (readiness-gated) start")
				: verdict("queue_mailbox", "guidance queued to the ready card's mailbox (no auto-start)");

		case "blocked":
			if (input.intent === "question") {
				return questionEffect(input);
			}
			// NEVER start a blocked card. Steering it surfaces a gated unblock suggestion; guidance waits in the mailbox.
			return input.intent === "steer"
				? verdict(
						"suggest_unblock",
						"steering a blocked card — surface a gated unblock suggestion (never auto-start)",
					)
				: verdict("queue_mailbox", "guidance queued to the blocked card's mailbox, consumed when it becomes ready");

		default:
			// done — a question is answered from the result; guidance/steer become a follow-up comment.
			return input.intent === "question"
				? questionEffect(input)
				: verdict("append_followup", "follow-up on a completed card");
	}
}
