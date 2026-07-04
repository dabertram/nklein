/**
 * §5.AT — the pure decision heart of board→chat feedback: given a board/card STATE TRANSITION (prev vs next normalized
 * {@link OperatorTaskSignals} + focus-chain deltas) and the owning chat session's preferences, decide whether — and at
 * what tier — to surface a chat message. Anti-spam is the PRIMARY constraint: the default is SUPPRESS; a transition earns
 * a message only by clearing an explicit gate. No I/O, no clock, no model — every input injected; fully unit-testable.
 *
 * The three tiers (from the §5.AT research):
 *   • ASK    — a genuine human decision-point (needs-input / unsafe-action ack / held delivery gate / sandbox blocked).
 *              Surfaced promptly + standalone; honored even at `concise` verbosity; NEVER batched away. Only `mute`/
 *              `silent` (and dedupe of an already-surfaced still-unresolved signal) suppress it.
 *   • NOTIFY — a terminal outcome (done/ready-for-review, failed/interrupted, lost heartbeat). Prompt but COALESCIBLE
 *              (the bridge routes it through a per-session digest window); deferred under quiet mode; suppressed while the
 *              owning session is mid-autonomous-run (it sees board state through its own tools) and at `silent`.
 *   • MILESTONE — a decomposition phase boundary from {@link FocusChainSummary} (a quartile crossing or `complete`).
 *              Digest-preferred; shown only at `normal`+ verbosity; at most one per crossing.
 *
 * The verdict's `action` tells the bridge what to do; timing/batching (the coalescing window, the while-you-were-away
 * rollup) is the bridge's job, NOT this core's — this core decides SURFACE vs SUPPRESS and the TIER, deterministically.
 */

import type { FocusChainSummary } from "./focus-chain";
import type { OperatorTaskSignals } from "./operator-task-state";

/** Per-session chattiness (default `concise`). Higher = more of the low-priority tiers surface. */
export type BoardChatVerbosity = "silent" | "concise" | "normal" | "verbose";

/** What the bridge should do with this transition. `defer_to_digest` = accumulate into the next digest, don't deliver standalone. */
export type BoardChatAction = "suppress" | "surface_ask" | "surface_notify" | "defer_to_digest";

/** The tier that earned the surface (null when suppressed). */
export type BoardChatTier = "ask" | "notify" | "milestone";

export interface BoardChatFeedbackInput {
	/** The card/task the transition is about — used to build the dedupe `signalKey`. */
	taskId: string;
	/** The previously-observed signals for this task, or `null` on first observation. */
	prev: OperatorTaskSignals | null;
	/** The current signals. */
	next: OperatorTaskSignals;
	/** The task's focus-chain summary before / now — drives the milestone (phase-boundary) check. Omit if none. */
	focusChainPrev?: FocusChainSummary | null;
	focusChainNext?: FocusChainSummary | null;
	/** The owning chat session's verbosity. `silent` ⇒ pure pull (nothing is ever pushed). */
	verbosity: BoardChatVerbosity;
	/** The card or session is muted ⇒ contributes NOTHING to chat (still fully live on the board). Suppresses every tier. */
	muted: boolean;
	/** Quiet / do-not-disturb ⇒ NOTIFY defers to the digest; ASK still breaks through. */
	quiet: boolean;
	/** Whether an owning chat session was resolved for this card. `false` ⇒ suppress (never broadcast to every chat). */
	ownerResolved: boolean;
	/** The owning session is mid-autonomous-run ⇒ suppress NOTIFY (it observes the board through its own tools). */
	sessionInAutonomousRun: boolean;
	/** Signal keys already surfaced and still unresolved — an ASK/NOTIFY with a matching key is suppressed (no re-ping). */
	alreadySurfacedKeys: readonly string[];
}

export interface BoardChatFeedbackVerdict {
	action: BoardChatAction;
	tier: BoardChatTier | null;
	/** Stable `${taskId}:${kind}` for dedupe across ticks; null when suppressed with no underlying signal. */
	signalKey: string | null;
	/** Operator-facing reason (telemetry / the message's framing). */
	reason: string;
	/** For ASK: the decision verbs to offer (approve/edit/reject/respond). */
	suggestedVerbs?: readonly string[];
	/** For MILESTONE: the crossed progress point. */
	milestone?: { done: number; total: number };
}

/** The ASK-tier signals, in priority order — the first one that became newly true wins. */
const ASK_SIGNALS: readonly {
	kind: string;
	verbs: readonly string[];
	active: (s: OperatorTaskSignals) => boolean;
}[] = [
	{ kind: "unsafe_action_ack", verbs: ["approve", "reject"], active: (s) => s.awaitingHostActionAck },
	{ kind: "delivery_gate_held", verbs: ["approve", "edit", "reject"], active: (s) => s.deliveryGateHeld },
	// A card the review ladder parked / escalated for a human — surface it as an ASK so the operator can act from chat
	// (review what was tried, retry on a stronger model, or reassign) instead of hunting the board (§5.AW).
	{ kind: "escalated_to_operator", verbs: ["review", "retry", "reassign"], active: (s) => s.escalatedToOperator },
	{ kind: "needs_input", verbs: ["respond"], active: (s) => s.clarifyingQuestionPending },
	{
		kind: "sandbox_unavailable",
		verbs: ["retry", "fix_setup"],
		active: (s) => s.blockedKind === "agent_sandbox_unavailable",
	},
];

/** The ASK kinds currently active for these signals — the feedback bridge clears a surfaced key once its ASK
 *  goes inactive (resolved), so a later re-raise surfaces again instead of being permanently deduped. */
export function activeBoardChatAskKinds(signals: OperatorTaskSignals): string[] {
	return ASK_SIGNALS.filter((ask) => ask.active(signals)).map((ask) => ask.kind);
}

/**
 * EVERY ASK-signal kind (independent of current activeness). The feedback bridge uses this to distinguish a
 * resolvable ASK key from a terminal NOTIFY / milestone key — both are namespaced `${taskId}:${kind}`, so only
 * keys whose kind is a known ASK kind may be cleared on resolve. Deriving it from `ASK_SIGNALS` keeps the bridge
 * from silently missing a kind (e.g. a hand-maintained regex once omitted `escalated_to_operator`).
 */
export const BOARD_CHAT_ASK_KINDS: readonly string[] = ASK_SIGNALS.map((ask) => ask.kind);

/** True when the signals represent the clean terminal "done / awaiting human review" state. */
function isDone(s: OperatorTaskSignals): boolean {
	return s.columnId === "completed" || s.columnId === "review" || s.sessionState === "awaiting_review";
}

/** True when the session ended negatively (failed or interrupted). */
function isFailed(s: OperatorTaskSignals): boolean {
	return s.sessionState === "failed" || s.sessionState === "interrupted";
}

/** A signal is "newly true" when next has it and prev did not (or prev is the first observation). */
function newlyTrue(
	prev: OperatorTaskSignals | null,
	next: OperatorTaskSignals,
	active: (s: OperatorTaskSignals) => boolean,
): boolean {
	return active(next) && (prev === null || !active(prev));
}

/** Fraction done, guarding an empty chain. */
function ratio(summary: FocusChainSummary): number {
	return summary.total > 0 ? summary.done / summary.total : 0;
}

/**
 * Detect a focus-chain phase boundary worth reporting: `complete` flips true, or `done/total` crosses the HALFWAY mark.
 * Halves (not finer quartiles) are used deliberately — on a small chain every step is a quartile, which would surface a
 * milestone on each tick and defeat the anti-spam goal. Halves give ~one mid-run milestone + the completion, and the
 * bridge additionally rate-limits to one milestone per card per digest window.
 */
function detectMilestone(
	prev: FocusChainSummary | null | undefined,
	next: FocusChainSummary | null | undefined,
): { done: number; total: number } | null {
	if (!next || next.total === 0) {
		return null;
	}
	if (next.complete && !prev?.complete) {
		return { done: next.done, total: next.total };
	}
	if (!prev) {
		return null;
	}
	if (next.done > prev.done && Math.floor(ratio(next) * 2) > Math.floor(ratio(prev) * 2)) {
		return { done: next.done, total: next.total };
	}
	return null;
}

function suppress(reason: string, signalKey: string | null = null): BoardChatFeedbackVerdict {
	return { action: "suppress", tier: null, signalKey, reason };
}

/**
 * Decide the board→chat feedback for one observed transition. Pure + deterministic; order of the gates is significant
 * (hard suppressors → ASK → NOTIFY → MILESTONE → default suppress) so the highest-priority tier wins and the `reason`
 * names the FIRST gate hit.
 */
export function decideBoardChatFeedback(input: BoardChatFeedbackInput): BoardChatFeedbackVerdict {
	const { taskId, prev, next } = input;

	// 0. Hard suppressors — no owner to route to, pull-only session, or an explicitly muted card/session.
	if (!input.ownerResolved) {
		return suppress("no owning chat session — never broadcast to every chat");
	}
	if (input.verbosity === "silent") {
		return suppress("session verbosity = silent (pull-only; use get_board_status)");
	}
	if (input.muted) {
		return suppress("card/session muted");
	}

	// 1. ASK-tier — a human decision-point newly raised. Highest priority; honored even at concise + in quiet mode.
	for (const ask of ASK_SIGNALS) {
		if (newlyTrue(prev, next, ask.active)) {
			const signalKey = `${taskId}:${ask.kind}`;
			if (input.alreadySurfacedKeys.includes(signalKey)) {
				return suppress(`ASK ${ask.kind} already surfaced (still unresolved)`, signalKey);
			}
			return {
				action: "surface_ask",
				tier: "ask",
				signalKey,
				reason: `needs the operator: ${ask.kind}`,
				suggestedVerbs: ask.verbs,
			};
		}
	}

	// 2. NOTIFY-tier — a terminal outcome transition. Coalescible; deferred in quiet; suppressed mid-autonomous-run.
	const notifyKind = newlyTrue(prev, next, isFailed)
		? "failed"
		: newlyTrue(prev, next, isDone)
			? "done"
			: newlyTrue(prev, next, (s) => s.heartbeatLost)
				? "heartbeat_lost"
				: null;
	if (notifyKind) {
		const signalKey = `${taskId}:${notifyKind}`;
		if (input.alreadySurfacedKeys.includes(signalKey)) {
			return suppress(`${notifyKind} already surfaced`, signalKey);
		}
		if (input.sessionInAutonomousRun) {
			return suppress("owning session is mid-autonomous-run (sees the board via its own tools)", signalKey);
		}
		if (input.quiet) {
			return {
				action: "defer_to_digest",
				tier: "notify",
				signalKey,
				reason: `${notifyKind} — quiet mode, deferred to digest`,
			};
		}
		return { action: "surface_notify", tier: "notify", signalKey, reason: notifyKind };
	}

	// 3. MILESTONE-tier — a decomposition phase boundary. Only at normal+ verbosity; always digest-preferred.
	const milestone = detectMilestone(input.focusChainPrev, input.focusChainNext);
	if (milestone) {
		if (input.verbosity === "concise") {
			return suppress("milestone suppressed at concise verbosity");
		}
		if (input.sessionInAutonomousRun) {
			return suppress("owning session is mid-autonomous-run (milestone visible via its own tools)");
		}
		return {
			action: "defer_to_digest",
			tier: "milestone",
			signalKey: `${taskId}:milestone:${milestone.done}/${milestone.total}`,
			reason: "decomposition phase boundary",
			milestone,
		};
	}

	// Default: a steady state (running/queued/checkpoint churn) or a non-reportable change ⇒ nothing. The verdict here is
	// TRANSITION-driven, so a card that is merely "still risky" without a NEW ASK signal produces no push (the digest
	// builder uses `classifyOperatorTaskState` for the pull/rollup payload; this core only decides per-transition surface).
	return suppress("no reportable transition");
}
