// §5.AT/§5.AU — the LIVE wiring for the board→chat feedback bridge: binds the runtime-agnostic
// `createBoardChatFeedbackBridge` core to the production chat/board stores, and adapts each NKlein task-session
// summary (from the runtime-state-hub's `observeNKleinSummary` seam) into a bridge transition. Kept out of the hub
// (which stays store-agnostic) and out of cli.ts (which just calls this factory + passes the observer through).
//
// Hot-path discipline: `observeNKleinSummary` fires on EVERY summary, so it does NO disk I/O itself — the owning
// chat is resolved+cached once per workspace (find-or-create is a disk replay), and the card title is only read (on
// disk) inside `getCardTitle`, which the bridge calls solely when it actually surfaces a message (rare). columnId is
// derived from the session state (the summary carries no column), which is exact for the operative transitions:
// `awaiting_review` → the review lane (the "ready for you" moment), everything else non-terminal.

import { basename } from "node:path";
import {
	type BoardChatFeedbackBridge,
	createBoardChatFeedbackBridge,
	type OwningChatRef,
} from "../chat/board-chat-feedback-bridge";
import { ensureChatSessionForWorkspace } from "../chat/chat-session-store";
import { appendChatMessage } from "../chat/chat-transcript-store";
import type { RuntimeTaskSessionState, RuntimeTaskSessionSummary } from "../core/api-contract";
import type { OperatorColumnId } from "../core/operator-task-state";
import { loadWorkspaceState } from "../state/workspace-state";

/** The card's session state → the board lane that matters for feedback. `awaiting_review` = the actionable moment. */
function deriveColumnIdFromState(state: RuntimeTaskSessionState): OperatorColumnId {
	return state === "awaiting_review" ? "review" : "in_progress";
}

export interface ObserveNKleinSummaryInput {
	workspaceId: string;
	workspacePath: string;
	summary: RuntimeTaskSessionSummary;
	isInitial: boolean;
}

export function createBoardChatFeedbackWiring(overrides?: { bridge?: BoardChatFeedbackBridge }): {
	bridge: BoardChatFeedbackBridge;
	observeNKleinSummary: (input: ObserveNKleinSummaryInput) => void;
} {
	const workspacePathById = new Map<string, string>();
	const owningChatCache = new Map<string, OwningChatRef>();

	const bridge =
		overrides?.bridge ??
		createBoardChatFeedbackBridge({
			resolveOwningChat: async (workspaceId) => {
				const cached = owningChatCache.get(workspaceId);
				if (cached) {
					return cached;
				}
				const workspacePath = workspacePathById.get(workspaceId);
				const title = workspacePath ? basename(workspacePath) : workspaceId;
				const session = await ensureChatSessionForWorkspace({ workspaceId, title });
				const ref: OwningChatRef = { sessionId: session.id, verbosity: "normal", quiet: false };
				owningChatCache.set(workspaceId, ref);
				return ref;
			},
			appendChatMessage: async (sessionId, text) => {
				await appendChatMessage(sessionId, { role: "system", content: text });
			},
			getCardTitle: async (workspaceId, taskId) => {
				const workspacePath = workspacePathById.get(workspaceId);
				if (!workspacePath) {
					return taskId;
				}
				try {
					const board = (await loadWorkspaceState(workspacePath)).board;
					const card = board.columns.flatMap((column) => column.cards).find((entry) => entry.id === taskId);
					return card?.title?.trim() || taskId;
				} catch {
					return taskId;
				}
			},
		});

	const observeNKleinSummary = (input: ObserveNKleinSummaryInput): void => {
		workspacePathById.set(input.workspaceId, input.workspacePath);
		// Synthetic sessions (::review / ::acceptance / ::spec / ::merge / ::plan-critique) are auxiliary — feedback is
		// about the CARD, not its judges. Skip them.
		if (input.summary.taskId.includes("::")) {
			return;
		}
		const transition = {
			taskId: input.summary.taskId,
			workspaceId: input.workspaceId,
			columnId: deriveColumnIdFromState(input.summary.state),
			nextSummary: {
				state: input.summary.state,
				paused: input.summary.paused ?? null,
				heartbeatStatus: input.summary.heartbeatStatus ?? null,
			},
		};
		if (input.isInitial) {
			bridge.seed(transition);
		} else {
			void bridge.onTransition(transition);
		}
	};

	return { bridge, observeNKleinSummary };
}
