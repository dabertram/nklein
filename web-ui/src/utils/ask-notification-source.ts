import { type AskNotificationKind, decideAskNotification } from "@/utils/ask-notification-decision";
import type { BrowserNotificationPermission } from "@/utils/notification-permission";

/**
 * F2.15b — turn the operator inbox (the board-health rollup's `inbox`) into the actionable ASK signals the
 * {@link decideAskNotification} gate fires OS notifications for, and plan which ones actually fire this tick. Kept
 * pure so the mapping + the gate composition are one tested place, separate from the effectful hook that reads
 * permission/visibility and calls `new Notification`.
 *
 * `review_ready` is intentionally NOT derived here — the pre-existing `use-review-ready-notifications` hook owns
 * that ASK (off the task-ready-for-review state-stream event); this sibling covers the OTHER four needs-you kinds.
 */

/** The subset of the operator inbox this maps to notifications (structurally satisfied by `OperatorInbox`). */
export interface OperatorInboxAsks {
	clarifyingQuestions: readonly string[];
	escalatedToOperator: readonly string[];
	heldDeliveries: readonly string[];
	protectedWrites: readonly string[];
	blockedOnSetup: readonly string[];
}

export interface ActionableAsk {
	taskId: string;
	kind: AskNotificationKind;
	/** `${taskId}:${kind}` — the stable dedupe key (matches the board→chat signalKey shape). */
	dedupeKey: string;
}

/**
 * Map the inbox lists to actionable ASKs. A held delivery and a protected-write hold are both `delivery_gate_held`
 * (a card in both lists yields ONE ask — deduped by key). Unsafe-action acks are deliberately excluded: they are a
 * distinct ack flow, not one of the five `AskNotificationKind`s.
 */
export function deriveActionableAsks(inbox: OperatorInboxAsks): ActionableAsk[] {
	const byKey = new Map<string, ActionableAsk>();
	const add = (taskIds: readonly string[], kind: AskNotificationKind): void => {
		for (const taskId of taskIds) {
			const dedupeKey = `${taskId}:${kind}`;
			if (!byKey.has(dedupeKey)) {
				byKey.set(dedupeKey, { taskId, kind, dedupeKey });
			}
		}
	};
	add(inbox.clarifyingQuestions, "needs_input");
	add(inbox.escalatedToOperator, "escalated_to_operator");
	add(inbox.heldDeliveries, "delivery_gate_held");
	add(inbox.protectedWrites, "delivery_gate_held");
	add(inbox.blockedOnSetup, "blocked");
	return [...byKey.values()];
}

export interface AskNotificationPlanContext {
	permission: BrowserNotificationPermission;
	/** Whether the owning chat/board view is currently visible to the user (a visible view already shows the ASK). */
	ownerVisible: boolean;
	/** The owning chat's F2.14 mute flag (all ASKs for a workspace share its owning chat). */
	muted: boolean;
	/** The owning chat's F2.14 quiet flag — suppresses the softer asks, never a hard block/escalation. */
	quiet: boolean;
	/** ASK keys already notified and still unresolved (from the previous tick). */
	alreadyNotifiedKeys: ReadonlySet<string>;
}

export interface AskNotificationPlan {
	/** The ASKs to fire a notification for this tick (each already passed every gate). */
	toFire: ActionableAsk[];
	/** The next `alreadyNotifiedKeys` set — notified keys that are STILL active (a resolved-then-recurring ASK re-fires). */
	nextNotifiedKeys: Set<string>;
}

/**
 * Compose {@link decideAskNotification} over the derived ASKs: collect the ones to fire and carry forward the
 * notified-keys set, pruned to the ASKs still present (so a resolved ASK that recurs later notifies again). Pure.
 */
export function planAskNotifications(
	asks: readonly ActionableAsk[],
	context: AskNotificationPlanContext,
): AskNotificationPlan {
	const activeKeys = new Set(asks.map((ask) => ask.dedupeKey));
	const notified = new Set(context.alreadyNotifiedKeys);
	const toFire: ActionableAsk[] = [];
	for (const ask of asks) {
		const decision = decideAskNotification({
			dedupeKey: ask.dedupeKey,
			kind: ask.kind,
			permission: context.permission,
			ownerVisible: context.ownerVisible,
			muted: context.muted,
			quiet: context.quiet,
			alreadyNotifiedKeys: notified,
		});
		if (decision.notify) {
			toFire.push(ask);
			notified.add(ask.dedupeKey);
		}
	}
	const nextNotifiedKeys = new Set([...notified].filter((key) => activeKeys.has(key)));
	return { toFire, nextNotifiedKeys };
}
