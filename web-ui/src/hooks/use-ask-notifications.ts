import { useEffect, useRef, useState } from "react";
import {
	type ActionableAsk,
	deriveActionableAsks,
	type OperatorInboxAsks,
	planAskNotifications,
} from "@/utils/ask-notification-source";
import { getBrowserNotificationPermission } from "@/utils/notification-permission";
import { useWindowEvent } from "@/utils/react-use";

/**
 * F2.15b — fire an OS notification for every actionable "needs you" ASK (needs_input / escalated_to_operator /
 * delivery_gate_held / blocked) the moment it appears, when the operator isn't looking. Sibling to
 * `use-review-ready-notifications` (which owns the `review_ready` ASK); both gate through the same F2.15
 * `decideAskNotification` core. Purely additive: it never mutates board/session state, only reads the inbox.
 *
 * The gate (pure, in `ask-notification-source`) fires ONLY when: OS permission is granted, the app/board is NOT the
 * visible+focused view (a visible board already shows the needs-you inbox), the owning chat is not muted, and — for
 * quiet mode — the ASK is a hard block/escalation. Each ASK notifies once per occurrence (deduped by
 * `${taskId}:${kind}`; a resolved-then-recurring ASK notifies again).
 */

const NOTIFICATION_ICON = "/assets/icon-notification.png";

const ASK_NOTIFICATION_TITLE: Record<ActionableAsk["kind"], string> = {
	needs_input: "A card needs your input",
	escalated_to_operator: "A card was escalated to you",
	delivery_gate_held: "A delivery is held for your review",
	blocked: "A card is blocked and needs you",
	review_ready: "A card is ready for review",
};

function fireAskNotification(ask: ActionableAsk): void {
	if (getBrowserNotificationPermission() !== "granted") {
		return;
	}
	try {
		const notification = new Notification(ASK_NOTIFICATION_TITLE[ask.kind], {
			body: `Task ${ask.taskId}`,
			tag: ask.dedupeKey,
			icon: NOTIFICATION_ICON,
		});
		notification.onclick = () => {
			if (typeof window !== "undefined") {
				window.focus();
			}
			notification.close();
		};
	} catch {
		// Ignore browser notification failures (permission races, unsupported environments).
	}
}

export function useAskNotifications({
	enabled,
	inbox,
	activeWorkspaceId,
	isDocumentVisible,
	muted,
	quiet,
}: {
	/** OS-notification opt-in (the same setting that gates review-ready notifications). */
	enabled: boolean;
	/** The active workspace's operator inbox (the board-health rollup's `inbox`). */
	inbox: OperatorInboxAsks;
	activeWorkspaceId: string | null;
	isDocumentVisible: boolean;
	/** The active workspace's owning chat's F2.14 mute flag (false when there is no owning chat). */
	muted: boolean;
	/** The active workspace's owning chat's F2.14 quiet flag. */
	quiet: boolean;
}): void {
	const notifiedKeysRef = useRef<Set<string>>(new Set());
	const [isWindowFocused, setIsWindowFocused] = useState(() =>
		typeof document === "undefined" ? true : document.hasFocus(),
	);

	useWindowEvent("focus", () => setIsWindowFocused(true));
	useWindowEvent("blur", () => setIsWindowFocused(false));

	// Reset the dedupe set when the active workspace changes — a different board's ASKs are a fresh slate.
	useEffect(() => {
		notifiedKeysRef.current = new Set();
	}, [activeWorkspaceId]);

	useEffect(() => {
		if (!enabled) {
			notifiedKeysRef.current = new Set();
			return;
		}
		const asks = deriveActionableAsks(inbox);
		const plan = planAskNotifications(asks, {
			permission: getBrowserNotificationPermission(),
			// A visible+focused app IS the owning view — the operator can see the needs-you inbox, so don't notify.
			ownerVisible: isDocumentVisible && isWindowFocused,
			muted,
			quiet,
			alreadyNotifiedKeys: notifiedKeysRef.current,
		});
		for (const ask of plan.toFire) {
			fireAskNotification(ask);
		}
		notifiedKeysRef.current = plan.nextNotifiedKeys;
	}, [enabled, inbox, isDocumentVisible, isWindowFocused, muted, quiet]);
}
