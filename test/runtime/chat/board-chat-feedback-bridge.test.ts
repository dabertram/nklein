import { describe, expect, it } from "vitest";
import {
	type BoardChatFeedbackBridgeDeps,
	type BoardSummaryTransition,
	createBoardChatFeedbackBridge,
	type OwningChatRef,
} from "../../../src/chat/board-chat-feedback-bridge";

function harness(overrides: Partial<BoardChatFeedbackBridgeDeps> = {}) {
	const appended: Array<{ sessionId: string; text: string }> = [];
	const asks: Array<{ sessionId: string; signalKey: string }> = [];
	const cleared: Array<{ sessionId: string; signalKey: string }> = [];
	const owner: OwningChatRef = { sessionId: "chat-1", verbosity: "normal", quiet: false };
	const deps: BoardChatFeedbackBridgeDeps = {
		resolveOwningChat: async () => owner,
		appendChatMessage: async (sessionId, text) => {
			appended.push({ sessionId, text });
		},
		getCardTitle: async (_ws, taskId) => `Card ${taskId}`,
		addOutstandingAsk: async (sessionId, ask) => {
			asks.push({ sessionId, signalKey: ask.signalKey });
		},
		clearOutstandingAsk: async (sessionId, signalKey) => {
			cleared.push({ sessionId, signalKey });
		},
		...overrides,
	};
	return { bridge: createBoardChatFeedbackBridge(deps), appended, asks, cleared, owner };
}

function tx(
	over: Partial<BoardSummaryTransition> & Pick<BoardSummaryTransition, "nextSummary" | "columnId">,
): BoardSummaryTransition {
	return { taskId: "t1", workspaceId: "ws-1", prevSummary: null, ...over };
}

describe("board→chat feedback bridge (§5.AT/§5.AU)", () => {
	it("surfaces a NOTIFY on a terminal (done) transition to the owning chat", async () => {
		const h = harness();
		await h.bridge.onTransition(
			tx({
				columnId: "in_progress",
				prevSummary: { state: "running" },
				nextSummary: { state: "running" }, // running in review-column → done signal
			}),
		);
		// A first observation into a non-terminal state should NOT notify.
		expect(h.appended).toHaveLength(0);
		await h.bridge.onTransition(
			tx({
				columnId: "completed",
				prevSummary: { state: "running" },
				nextSummary: { state: "idle" },
			}),
		);
		expect(h.appended).toHaveLength(1);
		expect(h.appended[0]?.sessionId).toBe("chat-1");
		expect(h.appended[0]?.text).toContain("Card t1");
	});

	it("§5.AT: a MUTED owning chat suppresses every tier (the same done transition surfaces nothing)", async () => {
		const h = harness({
			resolveOwningChat: async () => ({ sessionId: "chat-1", verbosity: "normal", quiet: false, muted: true }),
		});
		await h.bridge.onTransition(
			tx({ columnId: "in_progress", prevSummary: { state: "running" }, nextSummary: { state: "running" } }),
		);
		await h.bridge.onTransition(
			tx({ columnId: "completed", prevSummary: { state: "running" }, nextSummary: { state: "idle" } }),
		);
		// muted ⇒ decideBoardChatFeedback returns `suppress` for every tier — nothing reaches the chat.
		expect(h.appended).toHaveLength(0);
	});

	it("suppresses everything when no owning chat resolves (never broadcast to every chat)", async () => {
		const h = harness({ resolveOwningChat: async () => null });
		await h.bridge.onTransition(
			tx({ columnId: "completed", prevSummary: { state: "running" }, nextSummary: { state: "idle" } }),
		);
		expect(h.appended).toHaveLength(0);
	});

	it("surfaces an ASK (clarifying question) once, records the outstanding ASK, and dedupes re-raises", async () => {
		const h = harness();
		const asking = tx({
			columnId: "in_progress",
			prevSummary: { state: "running" },
			nextSummary: { state: "running" },
			overrides: { clarifyingQuestionPending: true },
		});
		await h.bridge.onTransition(asking);
		expect(h.appended).toHaveLength(1);
		expect(h.asks).toEqual([{ sessionId: "chat-1", signalKey: "t1:needs_input" }]);
		// Still pending on the next tick ⇒ no re-ping.
		await h.bridge.onTransition(asking);
		expect(h.appended).toHaveLength(1);
	});

	it("clears a surfaced ASK once its signal resolves, so a later re-raise surfaces again", async () => {
		const h = harness();
		const asking = tx({
			columnId: "in_progress",
			prevSummary: { state: "running" },
			nextSummary: { state: "running" },
			overrides: { clarifyingQuestionPending: true },
		});
		await h.bridge.onTransition(asking); // surface #1
		await h.bridge.onTransition(
			tx({
				columnId: "in_progress",
				prevSummary: { state: "running" },
				nextSummary: { state: "running" },
				overrides: { clarifyingQuestionPending: false },
			}),
		); // resolved
		expect(h.cleared).toEqual([{ sessionId: "chat-1", signalKey: "t1:needs_input" }]);
		await h.bridge.onTransition(asking); // re-raise ⇒ surfaces again
		expect(h.appended).toHaveLength(2);
	});

	it("clears a resolved escalated_to_operator ASK so a re-escalation re-notifies the operator", async () => {
		// Regression: the clear-loop's hand-maintained regex omitted `escalated_to_operator`, so a resolved
		// escalation key was never cleared and a later re-escalation was deduped away — the operator was never
		// re-notified. The ASK-kind list (single source of truth) now covers every kind.
		const h = harness();
		const escalated = tx({
			columnId: "in_progress",
			prevSummary: { state: "running" },
			nextSummary: { state: "running" },
			overrides: { escalatedToOperator: true },
		});
		await h.bridge.onTransition(escalated); // surface #1
		expect(h.asks).toEqual([{ sessionId: "chat-1", signalKey: "t1:escalated_to_operator" }]);
		await h.bridge.onTransition(
			tx({
				columnId: "in_progress",
				prevSummary: { state: "running" },
				nextSummary: { state: "running" },
				overrides: { escalatedToOperator: false },
			}),
		); // resolved ⇒ must clear
		expect(h.cleared).toEqual([{ sessionId: "chat-1", signalKey: "t1:escalated_to_operator" }]);
		await h.bridge.onTransition(escalated); // re-escalation ⇒ surfaces + re-binds again
		expect(h.appended).toHaveLength(2);
		expect(h.asks).toHaveLength(2);
	});

	it("coalesces deferred (quiet-mode) NOTIFYs and flush() emits one combined digest", async () => {
		const owner: OwningChatRef = { sessionId: "chat-1", verbosity: "normal", quiet: true };
		const h = harness({ resolveOwningChat: async () => owner, digestDelayMs: 10_000 });
		await h.bridge.onTransition(
			tx({ taskId: "a", columnId: "completed", prevSummary: { state: "running" }, nextSummary: { state: "idle" } }),
		);
		await h.bridge.onTransition(
			tx({ taskId: "b", columnId: "completed", prevSummary: { state: "running" }, nextSummary: { state: "idle" } }),
		);
		expect(h.appended).toHaveLength(0); // deferred, not yet flushed
		await h.bridge.flush("chat-1");
		expect(h.appended).toHaveLength(1);
		expect(h.appended[0]?.text).toContain("Card a");
		expect(h.appended[0]?.text).toContain("Card b");
		h.bridge.dispose();
	});

	it("suppresses NOTIFY while the owning session is mid-autonomous-run", async () => {
		const h = harness();
		await h.bridge.onTransition(
			tx({
				columnId: "completed",
				prevSummary: { state: "running" },
				nextSummary: { state: "idle" },
				sessionInAutonomousRun: true,
			}),
		);
		expect(h.appended).toHaveLength(0);
	});
});
