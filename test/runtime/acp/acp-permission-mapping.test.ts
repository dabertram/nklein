import { describe, expect, it } from "vitest";
import {
	ACP_ALLOW_ONCE_OPTION_ID,
	ACP_REJECT_ONCE_OPTION_ID,
	acpPermissionOptions,
	buildAcpPermissionRequest,
	interpretAcpPermissionOutcome,
} from "../../../src/acp/acp-permission-mapping";
import type { PendingHostActionConfirm } from "../../../src/core/host-action-confirm-queue";

/**
 * P17.2 — the permission round trip's fail-closed contract: the editor picks an OPTION, never the identity of
 * what it approves; anything that is not an explicit allow denies; and a client `cancelled` withdraws the
 * question rather than answering it (the entry keeps its own expiry-is-deny path).
 */
const pending: PendingHostActionConfirm = {
	attemptId: "attempt-7",
	sessionId: "chat-3",
	action: "host_command",
	target: "rm -rf build",
	actionLabel: "Run a host command",
	scope: "the project checkout",
	consequence: "deletes the build directory",
	duration: "this attempt only",
	requestedAt: 1_000,
	expiresAt: 61_000,
};

describe("buildAcpPermissionRequest", () => {
	it("carries the describer enrichment into the prompt the operator reads", () => {
		const request = buildAcpPermissionRequest({ sessionId: "acp-1", pending });
		expect(request.sessionId).toBe("acp-1");
		expect(request.toolCall.toolCallId).toBe("attempt-7");
		expect(request.toolCall.title).toContain("Run a host command");
		const rendered = JSON.stringify(request.toolCall.content);
		expect(rendered).toContain("the project checkout");
		expect(rendered).toContain("deletes the build directory");
		expect(rendered).toContain("rm -rf build");
	});

	it("falls back to action+target when no describer enrichment exists", () => {
		const bare: PendingHostActionConfirm = {
			attemptId: "a",
			sessionId: "s",
			action: "host_write",
			target: "/etc/hosts",
			requestedAt: 0,
			expiresAt: 60_000,
		};
		expect(buildAcpPermissionRequest({ sessionId: "acp-1", pending: bare }).toolCall.title).toBe(
			"host_write: /etc/hosts",
		);
	});

	it("offers ONCE options only — the queue's decisions are one-shot, so an 'always' would be a false promise", () => {
		expect(acpPermissionOptions().map((option) => option.kind)).toEqual(["allow_once", "reject_once"]);
	});
});

describe("interpretAcpPermissionOutcome", () => {
	it("an explicit allow resolves with the PENDING entry's identity, not anything from the reply", () => {
		const result = interpretAcpPermissionOutcome(
			{ outcome: "selected", optionId: ACP_ALLOW_ONCE_OPTION_ID },
			pending,
		);
		expect(result).toEqual({
			kind: "resolve",
			decision: {
				attemptId: "attempt-7",
				sessionId: "chat-3",
				action: "host_command",
				target: "rm -rf build",
				approve: true,
			},
		});
	});

	it("reject denies", () => {
		const result = interpretAcpPermissionOutcome(
			{ outcome: "selected", optionId: ACP_REJECT_ONCE_OPTION_ID },
			pending,
		);
		expect(result.kind).toBe("resolve");
		if (result.kind === "resolve") {
			expect(result.decision.approve).toBe(false);
		}
	});

	it("an UNKNOWN option id denies — a reply we cannot interpret must never widen access", () => {
		const result = interpretAcpPermissionOutcome({ outcome: "selected", optionId: "something-else" }, pending);
		expect(result.kind).toBe("resolve");
		if (result.kind === "resolve") {
			expect(result.decision.approve).toBe(false);
		}
	});

	it("client cancellation LEAVES the entry pending — withdrawing the question is not answering it", () => {
		expect(interpretAcpPermissionOutcome({ outcome: "cancelled" }, pending)).toEqual({
			kind: "leave_pending",
			reason: "client_cancelled",
		});
	});
});
