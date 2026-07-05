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
import {
	addChatOutstandingAsk,
	clearChatOutstandingAsk,
	ensureChatSessionForWorkspace,
} from "../chat/chat-session-store";
import { appendChatMessage } from "../chat/chat-transcript-store";
import type { RuntimeTaskSessionState, RuntimeTaskSessionSummary } from "../core/api-contract";
import type { OperatorColumnId, OperatorSignalOverrides } from "../core/operator-task-state";
import { assessRunAttention, type RunBudgetCeiling } from "../core/run-attention-signals";
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

/**
 * The derived attention read the caller folds in: a partial {@link OperatorSignalOverrides} fragment carrying ONLY the
 * two override-channel signals (`noProgressOrLoop` / `approachingBudgetCeiling`), plus a separate `heartbeatLost` flag.
 * `heartbeatLost` is NOT an `OperatorSignalOverrides` key — the classifier reads it from the summary's
 * `heartbeatStatus`, so the caller must fold a derived lost heartbeat into `nextSummary.heartbeatStatus`, not the
 * overrides (spreading it into the overrides object would be a silent no-op the signal map drops).
 */
interface DerivedAttention {
	overrides: Pick<OperatorSignalOverrides, "noProgressOrLoop" | "approachingBudgetCeiling">;
	heartbeatLost: boolean;
}

/**
 * §5.AG live-wiring: derive the time/budget-aware attention signals (heartbeatLost / noProgressOrLoop /
 * approachingBudgetCeiling) from a summary's telemetry via the pure `assessRunAttention` deriver, using an injected
 * clock. BYTE-IDENTICAL SAFETY: a summary with no heartbeat/activity timestamps and no capped ceiling yields all-false
 * overrides (expectsHeartbeat is false without a heartbeat timestamp, so a `null` heartbeat can never read `silent`),
 * and this returns `null` in that case so the caller adds NO extra keys AND leaves `heartbeatStatus` untouched — the
 * pre-change transition is preserved exactly. Only when at least one signal trips is a `DerivedAttention` returned; the
 * caller spreads the (possibly empty) overrides fragment and, separately, folds `heartbeatLost` into
 * `nextSummary.heartbeatStatus` — the channel the signal map actually reads for `heartbeatLost`.
 */
function deriveAttentionOverrides(summary: RuntimeTaskSessionSummary, nowMs: number): DerivedAttention | null {
	const lastHeartbeatAtMs = summary.lastHeartbeatAt ?? null;
	const lastActivityAtMs = summary.lastOutputAt ?? null;
	// Only a run we've actually seen beat is EXPECTED to keep beating; without a heartbeat timestamp a missing
	// heartbeat is not `silent` (this is what keeps the no-telemetry default byte-identical).
	const expectsHeartbeat = lastHeartbeatAtMs !== null;

	// The only capped ceiling the summary carries is the context-token budget (used working tokens vs the effective
	// window). Absent breakdown ⇒ no ceiling ⇒ no budget pressure.
	const ceilings: RunBudgetCeiling[] = [];
	const budget = summary.contextBudgetBreakdown;
	if (budget) {
		ceilings.push({ kind: "tokens", used: budget.usedWorkingTokens, cap: budget.effectiveContextWindow });
	}

	const { overrides } = assessRunAttention({ nowMs, lastActivityAtMs, lastHeartbeatAtMs, expectsHeartbeat }, ceilings);
	// All-false ⇒ return null so the caller emits the pre-change transition unchanged (byte-identical default).
	if (!overrides.heartbeatLost && !overrides.noProgressOrLoop && !overrides.approachingBudgetCeiling) {
		return null;
	}
	const fragment: Pick<OperatorSignalOverrides, "noProgressOrLoop" | "approachingBudgetCeiling"> = {};
	if (overrides.noProgressOrLoop) {
		fragment.noProgressOrLoop = true;
	}
	if (overrides.approachingBudgetCeiling) {
		fragment.approachingBudgetCeiling = true;
	}
	return { overrides: fragment, heartbeatLost: overrides.heartbeatLost };
}

export function createBoardChatFeedbackWiring(overrides?: {
	bridge?: BoardChatFeedbackBridge;
	/** Injected clock (ms). Defaults to `Date.now`; the test threads a fixed clock for deterministic attention reads. */
	now?: () => number;
}): {
	bridge: BoardChatFeedbackBridge;
	observeNKleinSummary: (input: ObserveNKleinSummaryInput) => void;
} {
	const now = overrides?.now ?? Date.now;
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
			// §5.AT/§5.AU (bug-hunt 2026-07-05): the reply-binding ladder (resolveMessageTarget's "bind the next message to
			// the ASK it answers" rung) depends on `session.outstandingAsks`, but nothing ever wrote to it — these two
			// optional hooks existed on the bridge's DI interface and were called internally, yet were never SUPPLIED here,
			// so they silently no-op'd end-to-end. Wire them to the store so a surfaced ASK actually becomes reply-bindable.
			addOutstandingAsk: async (sessionId, ask) => {
				await addChatOutstandingAsk(sessionId, ask);
			},
			clearOutstandingAsk: async (sessionId, signalKey) => {
				await clearChatOutstandingAsk(sessionId, signalKey);
			},
		});

	const observeNKleinSummary = (input: ObserveNKleinSummaryInput): void => {
		workspacePathById.set(input.workspaceId, input.workspacePath);
		// Synthetic sessions (::review / ::acceptance / ::spec / ::merge / ::plan-critique) are auxiliary — feedback is
		// about the CARD, not its judges. Skip them.
		if (input.summary.taskId.includes("::")) {
			return;
		}
		// §5.AG: fold time/budget-aware attention signals derived from the summary's telemetry into the transition. This
		// is a no-op when the summary carries no heartbeat/activity timestamps and no capped ceiling — `null` ⇒ the
		// transition is exactly the pre-change one (byte-identical default routing). The two override-channel signals
		// (noProgressOrLoop / approachingBudgetCeiling) spread into `overrides`; a derived lost heartbeat is folded into
		// `heartbeatStatus` (the channel the signal map reads for `heartbeatLost` — the overrides object has no such key).
		const attention = deriveAttentionOverrides(input.summary, now());
		const heartbeatStatus = attention?.heartbeatLost === true ? "lost" : (input.summary.heartbeatStatus ?? null);
		const transition = {
			taskId: input.summary.taskId,
			workspaceId: input.workspaceId,
			columnId: deriveColumnIdFromState(input.summary.state),
			nextSummary: {
				state: input.summary.state,
				paused: input.summary.paused ?? null,
				heartbeatStatus,
			},
			// A card parked with reviewReason "attention" is HELD awaiting the operator's decision — surface it as an
			// ASK (approve/edit/reject), which breaks through quiet mode, rather than a plain terminal NOTIFY. The
			// other reasons (error/interrupted/exit/hook) are outcomes the NOTIFY path already covers.
			overrides: {
				deliveryGateHeld: input.summary.reviewReason === "attention",
				...attention?.overrides,
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
