import { describe, expect, it } from "vitest";
import type { BoardChatFeedbackBridge, BoardSummaryTransition } from "../../../src/chat/board-chat-feedback-bridge";
import type { RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import { createBoardChatFeedbackWiring } from "../../../src/server/board-chat-feedback-wiring";

function fakeBridge() {
	const seeded: Array<Pick<BoardSummaryTransition, "taskId" | "columnId">> = [];
	const transitioned: BoardSummaryTransition[] = [];
	const bridge: BoardChatFeedbackBridge = {
		seed: (t) => {
			seeded.push({ taskId: t.taskId, columnId: t.columnId });
		},
		onTransition: async (t) => {
			transitioned.push(t);
		},
		flush: async () => {},
		dispose: () => {},
	};
	return { bridge, seeded, transitioned };
}

function summary(taskId: string, state: RuntimeTaskSessionSummary["state"]): RuntimeTaskSessionSummary {
	return { taskId, state, reviewReason: null } as RuntimeTaskSessionSummary;
}

describe("board-chat feedback wiring dispatch (§5.AT/§5.AU)", () => {
	it("seeds on the initial snapshot and drives onTransition on live updates", () => {
		const f = fakeBridge();
		const { observeNKleinSummary } = createBoardChatFeedbackWiring({ bridge: f.bridge });
		observeNKleinSummary({
			workspaceId: "ws",
			workspacePath: "/p",
			summary: summary("t1", "running"),
			isInitial: true,
		});
		observeNKleinSummary({
			workspaceId: "ws",
			workspacePath: "/p",
			summary: summary("t1", "awaiting_review"),
			isInitial: false,
		});
		expect(f.seeded).toEqual([{ taskId: "t1", columnId: "in_progress" }]);
		expect(f.transitioned).toHaveLength(1);
	});

	it("derives the review lane from awaiting_review and in_progress from other states", () => {
		const f = fakeBridge();
		const { observeNKleinSummary } = createBoardChatFeedbackWiring({ bridge: f.bridge });
		observeNKleinSummary({
			workspaceId: "ws",
			workspacePath: "/p",
			summary: summary("a", "awaiting_review"),
			isInitial: false,
		});
		observeNKleinSummary({
			workspaceId: "ws",
			workspacePath: "/p",
			summary: summary("b", "failed"),
			isInitial: false,
		});
		expect(f.transitioned[0]?.columnId).toBe("review");
		expect(f.transitioned[1]?.columnId).toBe("in_progress");
		expect(f.transitioned[0]?.workspaceId).toBe("ws");
	});

	it("maps reviewReason 'attention' to a delivery-gate-held ASK override (not just a NOTIFY)", () => {
		const f = fakeBridge();
		const { observeNKleinSummary } = createBoardChatFeedbackWiring({ bridge: f.bridge });
		observeNKleinSummary({
			workspaceId: "ws",
			workspacePath: "/p",
			summary: { taskId: "t1", state: "awaiting_review", reviewReason: "attention" } as RuntimeTaskSessionSummary,
			isInitial: false,
		});
		observeNKleinSummary({
			workspaceId: "ws",
			workspacePath: "/p",
			summary: { taskId: "t2", state: "awaiting_review", reviewReason: "error" } as RuntimeTaskSessionSummary,
			isInitial: false,
		});
		expect(f.transitioned[0]?.overrides).toEqual({ deliveryGateHeld: true });
		expect(f.transitioned[1]?.overrides).toEqual({ deliveryGateHeld: false });
	});

	// §5.AG — time/budget-aware attention overrides derived from summary telemetry via `assessRunAttention`, with an
	// injected clock so the ages are deterministic. Fixed clock: 2026-07-03T00:00:00Z.
	const NOW = 1_751_500_000_000;

	it("routes a heartbeat aged past the lost window (≈130s > 120s) via nextSummary.heartbeatStatus='lost'", () => {
		const f = fakeBridge();
		const { observeNKleinSummary } = createBoardChatFeedbackWiring({ bridge: f.bridge, now: () => NOW });
		observeNKleinSummary({
			workspaceId: "ws",
			workspacePath: "/p",
			summary: {
				taskId: "t1",
				state: "running",
				reviewReason: null,
				// Heartbeat 130s in the past ⇒ age 130_000 ≥ default lost window 120_000 ⇒ silent ⇒ heartbeatLost.
				lastHeartbeatAt: NOW - 130_000,
				// Upstream hasn't flipped heartbeatStatus yet — the TIME-BASED deriver is what must surface the loss.
				heartbeatStatus: "healthy",
			} as RuntimeTaskSessionSummary,
			isInitial: false,
		});
		// The classifier reads `heartbeatLost` from the summary's heartbeatStatus, NOT from overrides — so a derived
		// lost heartbeat must land in nextSummary.heartbeatStatus (upgraded from "healthy" to "lost") to actually route.
		// This would FAIL if the wiring only spread `heartbeatLost` into the overrides object (a silent no-op the map drops).
		expect(f.transitioned[0]?.nextSummary.heartbeatStatus).toBe("lost");
		// It is NOT smuggled into the overrides object (which has no heartbeatLost key the map would honour).
		expect(f.transitioned[0]?.overrides).not.toHaveProperty("heartbeatLost");
	});

	it("never derives a lost heartbeat for an ENDED session (interrupted teardown keeps its status verbatim)", () => {
		// An ended session's heartbeat naturally ages — deriving attention from it flooded healthy boards with
		// "heartbeat lost (the run may be dead)" digests for cards that had already delivered (2026-07-10).
		const f = fakeBridge();
		const { observeNKleinSummary } = createBoardChatFeedbackWiring({ bridge: f.bridge, now: () => NOW });
		observeNKleinSummary({
			workspaceId: "ws",
			workspacePath: "/p",
			summary: {
				taskId: "t1",
				state: "interrupted",
				reviewReason: "interrupted",
				lastHeartbeatAt: NOW - 500_000, // long past the lost window — but no live run expects beats
				heartbeatStatus: "healthy",
			} as RuntimeTaskSessionSummary,
			isInitial: false,
		});
		expect(f.transitioned[0]?.nextSummary.heartbeatStatus).toBe("healthy");
		expect(f.transitioned[0]?.overrides).not.toHaveProperty("noProgressOrLoop");
	});

	it("leaves nextSummary.heartbeatStatus untouched when the heartbeat is still fresh", () => {
		const f = fakeBridge();
		const { observeNKleinSummary } = createBoardChatFeedbackWiring({ bridge: f.bridge, now: () => NOW });
		observeNKleinSummary({
			workspaceId: "ws",
			workspacePath: "/p",
			summary: {
				taskId: "t1",
				state: "running",
				reviewReason: null,
				// 30s in the past ⇒ well within the 120s lost window ⇒ NOT silent ⇒ heartbeatStatus passes through verbatim.
				lastHeartbeatAt: NOW - 30_000,
				heartbeatStatus: "healthy",
			} as RuntimeTaskSessionSummary,
			isInitial: false,
		});
		expect(f.transitioned[0]?.nextSummary.heartbeatStatus).toBe("healthy");
	});

	it("derives approachingBudgetCeiling from a context budget at ≈90% of its window", () => {
		const f = fakeBridge();
		const { observeNKleinSummary } = createBoardChatFeedbackWiring({ bridge: f.bridge, now: () => NOW });
		observeNKleinSummary({
			workspaceId: "ws",
			workspacePath: "/p",
			summary: {
				taskId: "t1",
				state: "running",
				reviewReason: null,
				// 90/100 = 0.90 ≥ default warn fraction 0.80 ⇒ approaching. No heartbeat telemetry ⇒ never silent.
				contextBudgetBreakdown: { usedWorkingTokens: 90, effectiveContextWindow: 100 },
			} as RuntimeTaskSessionSummary,
			isInitial: false,
		});
		expect(f.transitioned[0]?.overrides).toMatchObject({ deliveryGateHeld: false, approachingBudgetCeiling: true });
		// A live-but-not-silent, not-stalled run adds ONLY the budget key — no heartbeatLost/noProgressOrLoop keys.
		expect(f.transitioned[0]?.overrides).not.toHaveProperty("heartbeatLost");
		expect(f.transitioned[0]?.overrides).not.toHaveProperty("noProgressOrLoop");
	});

	it("adds NO attention keys when the summary carries no telemetry (byte-identical default overrides)", () => {
		const f = fakeBridge();
		const { observeNKleinSummary } = createBoardChatFeedbackWiring({ bridge: f.bridge, now: () => NOW });
		observeNKleinSummary({
			workspaceId: "ws",
			workspacePath: "/p",
			summary: { taskId: "t1", state: "awaiting_review", reviewReason: "attention" } as RuntimeTaskSessionSummary,
			isInitial: false,
		});
		observeNKleinSummary({
			workspaceId: "ws",
			workspacePath: "/p",
			summary: { taskId: "t2", state: "running", reviewReason: "error" } as RuntimeTaskSessionSummary,
			isInitial: false,
		});
		// Exact equality proves no extra keys were spread in — the pre-change routing object is preserved verbatim.
		expect(f.transitioned[0]?.overrides).toEqual({ deliveryGateHeld: true });
		expect(f.transitioned[1]?.overrides).toEqual({ deliveryGateHeld: false });
	});

	it("sources clarifyingQuestionPending from a user_attention hook (ask_followup_question) as an ASK override", () => {
		const f = fakeBridge();
		const { observeNKleinSummary } = createBoardChatFeedbackWiring({ bridge: f.bridge, now: () => NOW });
		// A card that called ask_followup_question: state awaiting_review + reviewReason "hook" + the dedicated
		// notificationType "user_attention" marker (nklein-event-adapter stamps exactly this for user-attention tools).
		observeNKleinSummary({
			workspaceId: "ws",
			workspacePath: "/p",
			summary: {
				taskId: "asks",
				state: "awaiting_review",
				reviewReason: "hook",
				latestHookActivity: { toolName: "ask_followup_question", notificationType: "user_attention" },
			} as RuntimeTaskSessionSummary,
			isInitial: false,
		});
		// deliveryGateHeld is false (reviewReason is "hook", not "attention") — the two ASKs are distinct signals.
		expect(f.transitioned[0]?.overrides).toEqual({ deliveryGateHeld: false, clarifyingQuestionPending: true });
	});

	it("does NOT source clarifyingQuestionPending for a non-attention hook (byte-identical default overrides)", () => {
		const f = fakeBridge();
		const { observeNKleinSummary } = createBoardChatFeedbackWiring({ bridge: f.bridge, now: () => NOW });
		// A regular tool-call hook (notificationType null) must not spuriously trip the question ASK.
		observeNKleinSummary({
			workspaceId: "ws",
			workspacePath: "/p",
			summary: {
				taskId: "t1",
				state: "running",
				reviewReason: null,
				latestHookActivity: { toolName: "bash", notificationType: null },
			} as RuntimeTaskSessionSummary,
			isInitial: false,
		});
		// Exact equality proves no clarifyingQuestionPending key was spread in.
		expect(f.transitioned[0]?.overrides).toEqual({ deliveryGateHeld: false });
	});

	it("skips synthetic (::review / ::acceptance / …) sessions — feedback is about the card", () => {
		const f = fakeBridge();
		const { observeNKleinSummary } = createBoardChatFeedbackWiring({ bridge: f.bridge });
		observeNKleinSummary({
			workspaceId: "ws",
			workspacePath: "/p",
			summary: summary("t1::review", "awaiting_review"),
			isInitial: false,
		});
		observeNKleinSummary({
			workspaceId: "ws",
			workspacePath: "/p",
			summary: summary("t1::acceptance", "failed"),
			isInitial: true,
		});
		expect(f.transitioned).toHaveLength(0);
		expect(f.seeded).toHaveLength(0);
	});
});
