/**
 * P17.2 — `session/request_permission` ↔ the S3 host-action confirm queue, pure.
 *
 * When a card's turn parks a confirm-tier host action, the operator has to answer somewhere. Inside an editor
 * that somewhere should be the EDITOR: ACP's `session/request_permission` is exactly the shape the confirm
 * queue already speaks — a described action, a bounded choice, a fail-closed default.
 *
 * ── WHAT THIS MAPPING MUST NOT DO ──
 * The queue's fail-closed contract is that a resolution BINDS to (attemptId, sessionId, action, target) and any
 * mismatch resolves nothing. So the round trip carries those four back VERBATIM from the pending entry rather
 * than rebuilding them from the editor's answer — the editor chooses an OPTION, never the identity of what it
 * is approving. A mapping that let the reply restate the target would be a mapping that could approve a
 * different action than the one displayed.
 *
 * ── ALWAYS-OPTIONS ARE DELIBERATELY ABSENT ──
 * ACP offers `allow_always` / `reject_always`. This mapping emits only the ONCE options, because the queue's
 * decisions are one-shot by construction and !Klein's standing grants live in the F2.2 capability-grant store
 * with their own scope keys and TTL. Emitting an "always" the queue cannot honour would promise the operator a
 * persistence that does not exist — worse than not offering it.
 */

import type { PermissionOption, RequestPermissionOutcome, RequestPermissionRequest } from "@agentclientprotocol/sdk";
import type { PendingHostActionConfirm } from "../core/host-action-confirm-queue";

export const ACP_ALLOW_ONCE_OPTION_ID = "nklein-allow-once";
export const ACP_REJECT_ONCE_OPTION_ID = "nklein-reject-once";

/** The two options every !Klein permission prompt offers — one-shot, matching the queue's one-shot decisions. */
export function acpPermissionOptions(): PermissionOption[] {
	return [
		{ optionId: ACP_ALLOW_ONCE_OPTION_ID, name: "Allow once", kind: "allow_once" },
		{ optionId: ACP_REJECT_ONCE_OPTION_ID, name: "Reject", kind: "reject_once" },
	];
}

/**
 * Render a pending confirm as an ACP permission request. The F2.12b describer fields (label/scope/consequence/
 * duration) are DISPLAY enrichment — they ride in the title/content so the operator sees where the action acts
 * and what approving does, and they are never part of the binding.
 */
export function buildAcpPermissionRequest(input: {
	readonly sessionId: string;
	readonly pending: PendingHostActionConfirm;
}): RequestPermissionRequest {
	const { pending } = input;
	const title = pending.headline?.trim() || `${pending.actionLabel?.trim() || pending.action}: ${pending.target}`;
	const detail = [
		pending.scope ? `Scope: ${pending.scope}` : null,
		pending.consequence ? `Approving: ${pending.consequence}` : null,
		pending.duration ? `Duration: ${pending.duration}` : null,
		`Target: ${pending.target}`,
	]
		.filter((line): line is string => line !== null)
		.join("\n");
	return {
		sessionId: input.sessionId,
		toolCall: {
			toolCallId: pending.attemptId,
			title,
			kind: "execute",
			status: "pending",
			content: [{ type: "content", content: { type: "text", text: detail } }],
		},
		options: acpPermissionOptions(),
	};
}

/**
 * Turn the editor's answer into the queue decision — or into "no decision at all".
 *
 * Everything that is not an explicit allow is a DENY except `cancelled`, which is the client withdrawing the
 * question rather than answering it: the pending entry must be left to its own expiry-is-deny path instead of
 * being resolved on the client's behalf. An unknown option id is likewise not an approval; it resolves as a
 * deny, because a reply we cannot interpret must never widen access.
 */
export function interpretAcpPermissionOutcome(
	outcome: RequestPermissionOutcome,
	pending: PendingHostActionConfirm,
):
	| {
			readonly kind: "resolve";
			readonly decision: { attemptId: string; sessionId: string; action: string; target: string; approve: boolean };
	  }
	| { readonly kind: "leave_pending"; readonly reason: "client_cancelled" } {
	if (outcome.outcome === "cancelled") {
		return { kind: "leave_pending", reason: "client_cancelled" };
	}
	// The identity comes from the PENDING entry, never from the reply — the editor picks an option, not a target.
	return {
		kind: "resolve",
		decision: {
			attemptId: pending.attemptId,
			sessionId: pending.sessionId,
			action: pending.action,
			target: pending.target,
			approve: outcome.optionId === ACP_ALLOW_ONCE_OPTION_ID,
		},
	};
}
