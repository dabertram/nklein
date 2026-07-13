import { describe, expect, it } from "vitest";
import {
	type AskNotificationInput,
	decideAskNotification,
	isAskNotificationKind,
} from "@/utils/ask-notification-decision";

/**
 * F2.15 — the ASK notification gate: fires only for actionable needs-you ASKs when granted + not visible + not
 * muted, honors quiet (softer asks suppressed, hard blocks survive), and dedupes by ASK key.
 */

function input(overrides: Partial<AskNotificationInput> = {}): AskNotificationInput {
	return {
		dedupeKey: "t1:needs_input",
		kind: "needs_input",
		permission: "granted",
		ownerVisible: false,
		muted: false,
		quiet: false,
		alreadyNotifiedKeys: new Set(),
		...overrides,
	};
}

describe("decideAskNotification", () => {
	it("fires when actionable, granted, not visible, not muted, not duplicated", () => {
		expect(decideAskNotification(input())).toEqual({ notify: true, dedupeKey: "t1:needs_input" });
	});

	it("suppresses in every gating case with a typed reason", () => {
		expect(decideAskNotification(input({ permission: "default" }))).toMatchObject({ reason: "no_permission" });
		expect(decideAskNotification(input({ permission: "denied" }))).toMatchObject({ reason: "no_permission" });
		expect(decideAskNotification(input({ ownerVisible: true }))).toMatchObject({ reason: "owner_visible" });
		expect(decideAskNotification(input({ muted: true }))).toMatchObject({ reason: "muted" });
		expect(decideAskNotification(input({ alreadyNotifiedKeys: new Set(["t1:needs_input"]) }))).toMatchObject({
			reason: "already_notified",
		});
	});

	it("quiet suppresses soft asks but NEVER a hard block/escalation", () => {
		expect(decideAskNotification(input({ quiet: true, kind: "needs_input" }))).toMatchObject({
			reason: "quiet_suppressed",
		});
		expect(decideAskNotification(input({ quiet: true, kind: "review_ready" }))).toMatchObject({
			reason: "quiet_suppressed",
		});
		// Hard stops survive quiet.
		expect(
			decideAskNotification(
				input({ quiet: true, kind: "escalated_to_operator", dedupeKey: "t1:escalated_to_operator" }),
			),
		).toMatchObject({ notify: true });
		expect(decideAskNotification(input({ quiet: true, kind: "blocked", dedupeKey: "t1:blocked" }))).toMatchObject({
			notify: true,
		});
		expect(
			decideAskNotification(input({ quiet: true, kind: "delivery_gate_held", dedupeKey: "t1:delivery_gate_held" })),
		).toMatchObject({ notify: true });
	});

	it("mute and permission gate BEFORE the dedupe check (order of precedence)", () => {
		// Muted + already-notified → the earlier gate (muted) is the reason.
		expect(
			decideAskNotification(input({ muted: true, alreadyNotifiedKeys: new Set(["t1:needs_input"]) })),
		).toMatchObject({ reason: "muted" });
	});

	it("isAskNotificationKind rejects non-actionable kinds (info NOTIFYs)", () => {
		expect(isAskNotificationKind("needs_input")).toBe(true);
		expect(isAskNotificationKind("completed")).toBe(false);
		expect(isAskNotificationKind("progress")).toBe(false);
		expect(decideAskNotification(input({ kind: "completed" as never }))).toMatchObject({
			reason: "not_actionable",
		});
	});
});
