import { describe, expect, it } from "vitest";
import {
	activeBoardChatAskKinds,
	BOARD_CHAT_ASK_KINDS,
	type BoardChatFeedbackInput,
	type BoardChatVerbosity,
	decideBoardChatFeedback,
} from "../../../src/core/board-chat-feedback";
import type { FocusChainSummary } from "../../../src/core/focus-chain";
import type { OperatorTaskSignals } from "../../../src/core/operator-task-state";

function signals(overrides: Partial<OperatorTaskSignals> = {}): OperatorTaskSignals {
	return {
		sessionState: "running",
		columnId: "in_progress",
		paused: false,
		heartbeatLost: false,
		blockedKind: null,
		awaitingHostActionAck: false,
		deliveryGateHeld: false,
		clarifyingQuestionPending: false,
		noProgressOrLoop: false,
		approachingBudgetCeiling: false,
		escalatedToOperator: false,
		...overrides,
	};
}

function input(overrides: Partial<BoardChatFeedbackInput> = {}): BoardChatFeedbackInput {
	return {
		taskId: "task-1",
		prev: signals(),
		next: signals(),
		verbosity: "concise",
		muted: false,
		quiet: false,
		ownerResolved: true,
		sessionInAutonomousRun: false,
		alreadySurfacedKeys: [],
		...overrides,
	};
}

const chain = (over: Partial<FocusChainSummary> = {}): FocusChainSummary => ({
	total: 4,
	done: 0,
	inProgress: 0,
	pending: 4,
	skipped: 0,
	complete: false,
	...over,
});

describe("decideBoardChatFeedback — hard suppressors", () => {
	it("suppresses when no owning session is resolved (never broadcast to every chat)", () => {
		const v = decideBoardChatFeedback(
			input({ ownerResolved: false, next: signals({ sessionState: "awaiting_review" }) }),
		);
		expect(v.action).toBe("suppress");
		expect(v.reason).toContain("no owning chat session");
	});

	it("suppresses everything at silent verbosity (pull-only)", () => {
		const v = decideBoardChatFeedback(input({ verbosity: "silent", next: signals({ awaitingHostActionAck: true }) }));
		expect(v.action).toBe("suppress");
	});

	it("suppresses everything when muted — even an ASK transition", () => {
		const v = decideBoardChatFeedback(input({ muted: true, next: signals({ clarifyingQuestionPending: true }) }));
		expect(v.action).toBe("suppress");
	});
});

describe("decideBoardChatFeedback — ASK tier (immediate, honored even at concise + quiet)", () => {
	const asks: Array<[string, Partial<OperatorTaskSignals>, string]> = [
		["unsafe-action ack", { awaitingHostActionAck: true }, "unsafe_action_ack"],
		["held delivery gate", { deliveryGateHeld: true }, "delivery_gate_held"],
		["escalated/parked card", { escalatedToOperator: true }, "escalated_to_operator"],
		["clarifying question", { clarifyingQuestionPending: true }, "needs_input"],
		["sandbox unavailable", { blockedKind: "agent_sandbox_unavailable" }, "sandbox_unavailable"],
	];
	for (const [name, sig, kind] of asks) {
		it(`surfaces ${name} as ASK with verbs, even in quiet mode`, () => {
			const v = decideBoardChatFeedback(input({ quiet: true, next: signals(sig) }));
			expect(v.action).toBe("surface_ask");
			expect(v.tier).toBe("ask");
			expect(v.signalKey).toBe(`task-1:${kind}`);
			expect(v.suggestedVerbs?.length ?? 0).toBeGreaterThan(0);
		});
	}

	it("only surfaces a NEWLY-raised ASK (not one already true in prev)", () => {
		const v = decideBoardChatFeedback(
			input({
				prev: signals({ awaitingHostActionAck: true }),
				next: signals({ awaitingHostActionAck: true }),
			}),
		);
		expect(v.action).toBe("suppress");
	});

	it("surfaces an ASK on first observation (prev = null)", () => {
		const v = decideBoardChatFeedback(input({ prev: null, next: signals({ deliveryGateHeld: true }) }));
		expect(v.action).toBe("surface_ask");
	});

	it("dedupes an already-surfaced still-unresolved ASK", () => {
		const v = decideBoardChatFeedback(
			input({
				prev: null,
				next: signals({ clarifyingQuestionPending: true }),
				alreadySurfacedKeys: ["task-1:needs_input"],
			}),
		);
		expect(v.action).toBe("suppress");
		expect(v.reason).toContain("already surfaced");
	});

	it("ASK beats a co-occurring NOTIFY (priority order)", () => {
		const v = decideBoardChatFeedback(
			input({
				prev: signals(),
				next: signals({ sessionState: "awaiting_review", deliveryGateHeld: true }),
			}),
		);
		expect(v.tier).toBe("ask");
	});
});

describe("decideBoardChatFeedback — NOTIFY tier (terminal outcomes)", () => {
	it("surfaces done (session → awaiting_review) as coalescible notify", () => {
		const v = decideBoardChatFeedback(input({ next: signals({ sessionState: "awaiting_review" }) }));
		expect(v.action).toBe("surface_notify");
		expect(v.signalKey).toBe("task-1:done");
	});

	it("surfaces done when the card moves to the review column", () => {
		const v = decideBoardChatFeedback(input({ next: signals({ columnId: "review" }) }));
		expect(v.action).toBe("surface_notify");
		expect(v.reason).toBe("done");
	});

	it("surfaces failed / interrupted", () => {
		expect(decideBoardChatFeedback(input({ next: signals({ sessionState: "failed" }) })).reason).toBe("failed");
		expect(decideBoardChatFeedback(input({ next: signals({ sessionState: "interrupted" }) })).reason).toBe("failed");
	});

	it("surfaces a newly-lost heartbeat", () => {
		const v = decideBoardChatFeedback(input({ next: signals({ heartbeatLost: true }) }));
		expect(v.signalKey).toBe("task-1:heartbeat_lost");
	});

	it("defers NOTIFY to the digest in quiet mode", () => {
		const v = decideBoardChatFeedback(input({ quiet: true, next: signals({ sessionState: "awaiting_review" }) }));
		expect(v.action).toBe("defer_to_digest");
		expect(v.tier).toBe("notify");
	});

	it("suppresses NOTIFY while the owning session is mid-autonomous-run", () => {
		const v = decideBoardChatFeedback(
			input({ sessionInAutonomousRun: true, next: signals({ sessionState: "failed" }) }),
		);
		expect(v.action).toBe("suppress");
		expect(v.reason).toContain("autonomous-run");
	});

	it("does not re-surface a done that was already surfaced", () => {
		const v = decideBoardChatFeedback(
			input({
				next: signals({ sessionState: "awaiting_review" }),
				alreadySurfacedKeys: ["task-1:done"],
			}),
		);
		expect(v.action).toBe("suppress");
	});

	it("produces nothing for a steady running state (no transition)", () => {
		expect(decideBoardChatFeedback(input()).action).toBe("suppress");
	});
});

describe("decideBoardChatFeedback — MILESTONE tier (focus-chain phase boundary)", () => {
	const withChain = (v: BoardChatVerbosity, prev: FocusChainSummary, next: FocusChainSummary) =>
		decideBoardChatFeedback(input({ verbosity: v, focusChainPrev: prev, focusChainNext: next }));

	it("surfaces a halfway crossing as a digest-preferred milestone at normal+ verbosity", () => {
		const v = withChain("normal", chain({ done: 0, pending: 4 }), chain({ done: 2, pending: 2 }));
		expect(v.action).toBe("defer_to_digest");
		expect(v.tier).toBe("milestone");
		expect(v.milestone).toEqual({ done: 2, total: 4 });
	});

	it("surfaces the complete flip as a milestone", () => {
		const v = withChain("normal", chain({ done: 3, pending: 1 }), chain({ done: 4, pending: 0, complete: true }));
		expect(v.tier).toBe("milestone");
	});

	it("suppresses milestones at concise verbosity", () => {
		expect(withChain("concise", chain({ done: 0 }), chain({ done: 2 })).action).toBe("suppress");
	});

	it("does NOT fire on a step tick that doesn't cross the halfway mark", () => {
		// 0/4 → 1/4 is still below 50% ⇒ no milestone (anti-spam: not every step tick).
		expect(withChain("normal", chain({ done: 0, pending: 4 }), chain({ done: 1, pending: 3 })).action).toBe(
			"suppress",
		);
	});

	it("suppresses a milestone while mid-autonomous-run", () => {
		const v = decideBoardChatFeedback(
			input({
				verbosity: "verbose",
				sessionInAutonomousRun: true,
				focusChainPrev: chain({ done: 0 }),
				focusChainNext: chain({ done: 2 }),
			}),
		);
		expect(v.action).toBe("suppress");
	});
});

describe("activeBoardChatAskKinds — which operator 'needs-you' asks are pending", () => {
	it("no asks when nothing is awaiting the operator", () => {
		expect(activeBoardChatAskKinds(signals())).toEqual([]);
	});

	it("maps each triggering signal to its ask kind", () => {
		expect(activeBoardChatAskKinds(signals({ awaitingHostActionAck: true }))).toContain("unsafe_action_ack");
		expect(activeBoardChatAskKinds(signals({ deliveryGateHeld: true }))).toContain("delivery_gate_held");
		expect(activeBoardChatAskKinds(signals({ clarifyingQuestionPending: true }))).toContain("needs_input");
		expect(activeBoardChatAskKinds(signals({ escalatedToOperator: true }))).toContain("escalated_to_operator");
		expect(activeBoardChatAskKinds(signals({ blockedKind: "agent_sandbox_unavailable" }))).toContain(
			"sandbox_unavailable",
		);
	});

	it("a non-sandbox block does NOT raise the sandbox ask", () => {
		expect(activeBoardChatAskKinds(signals({ blockedKind: "needs_decomposition" }))).not.toContain(
			"sandbox_unavailable",
		);
	});

	it("surfaces multiple asks at once", () => {
		const kinds = activeBoardChatAskKinds(signals({ awaitingHostActionAck: true, clarifyingQuestionPending: true }));
		expect(kinds).toContain("unsafe_action_ack");
		expect(kinds).toContain("needs_input");
	});

	it("every kind it returns is a member of the exported BOARD_CHAT_ASK_KINDS bridge set", () => {
		const kinds = activeBoardChatAskKinds(
			signals({
				awaitingHostActionAck: true,
				deliveryGateHeld: true,
				clarifyingQuestionPending: true,
				escalatedToOperator: true,
				blockedKind: "agent_sandbox_unavailable",
			}),
		);
		expect(kinds.length).toBeGreaterThan(0);
		for (const kind of kinds) {
			expect(BOARD_CHAT_ASK_KINDS).toContain(kind);
		}
	});
});
