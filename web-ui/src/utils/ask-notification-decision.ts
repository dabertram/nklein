import type { BrowserNotificationPermission } from "@/utils/notification-permission";

/**
 * F2.15 — the pure decision behind ASK-tier desktop/browser notifications. The review-ready hook already fires
 * OS notifications for ONE ASK (a card reaching review); this generalizes the gating to EVERY actionable
 * "needs-you" ASK while honoring the F2.14 per-session mute/quiet + OS permission + tab visibility. Kept pure so
 * the policy is one tested place, separate from the DOM/Notification effects the hook performs.
 *
 * Fire ONLY when ALL hold: the ASK is actionable (a real needs-you tier, not an info NOTIFY), OS permission is
 * granted, the owning chat is NOT currently visible (a visible chat already shows it), the session is not muted,
 * and — for quiet mode — the ASK is high-priority (quiet suppresses the softer asks but never a hard block/
 * escalation). Deduplication is by the stable ASK key: the same still-unresolved ASK never re-notifies.
 */

/** The actionable ASK kinds — a subset of the board→chat ASK kinds that genuinely need the operator. */
export const ASK_NOTIFICATION_KINDS = [
	"needs_input",
	"escalated_to_operator",
	"delivery_gate_held",
	"blocked",
	"review_ready",
] as const;

export type AskNotificationKind = (typeof ASK_NOTIFICATION_KINDS)[number];

/** ASKs that survive quiet mode (a hard stop the operator must see even when they asked for quiet). */
const QUIET_SURVIVING_KINDS: ReadonlySet<AskNotificationKind> = new Set<AskNotificationKind>([
	"escalated_to_operator",
	"delivery_gate_held",
	"blocked",
]);

export function isAskNotificationKind(value: string): value is AskNotificationKind {
	return (ASK_NOTIFICATION_KINDS as readonly string[]).includes(value);
}

export interface AskNotificationInput {
	/** `${taskId}:${kind}` — the stable dedupe key + reply referent (matches the board→chat signalKey). */
	dedupeKey: string;
	kind: AskNotificationKind;
	permission: BrowserNotificationPermission;
	/** Whether the owning chat/tab is currently visible to the user. */
	ownerVisible: boolean;
	/** The session's F2.14 mute flag. */
	muted: boolean;
	/** The session's F2.14 quiet flag. */
	quiet: boolean;
	/** ASK keys already notified and still unresolved. */
	alreadyNotifiedKeys: ReadonlySet<string>;
}

export type AskNotificationDecision =
	| { notify: true; dedupeKey: string }
	| {
			notify: false;
			reason:
				| "not_actionable"
				| "no_permission"
				| "owner_visible"
				| "muted"
				| "quiet_suppressed"
				| "already_notified";
	  };

/** Decide whether to fire an OS notification for one ASK. Pure + total. */
export function decideAskNotification(input: AskNotificationInput): AskNotificationDecision {
	if (!isAskNotificationKind(input.kind)) {
		return { notify: false, reason: "not_actionable" };
	}
	if (input.permission !== "granted") {
		return { notify: false, reason: "no_permission" };
	}
	if (input.ownerVisible) {
		return { notify: false, reason: "owner_visible" };
	}
	if (input.muted) {
		return { notify: false, reason: "muted" };
	}
	if (input.quiet && !QUIET_SURVIVING_KINDS.has(input.kind)) {
		return { notify: false, reason: "quiet_suppressed" };
	}
	if (input.alreadyNotifiedKeys.has(input.dedupeKey)) {
		return { notify: false, reason: "already_notified" };
	}
	return { notify: true, dedupeKey: input.dedupeKey };
}
