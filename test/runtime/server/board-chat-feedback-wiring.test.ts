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
