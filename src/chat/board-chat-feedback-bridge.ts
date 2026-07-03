// §5.AT/§5.AU board→chat FEEDBACK BRIDGE — the collaborator that turns task-session summary TRANSITIONS into
// operator-facing chat messages on the ONE chat that owns the project (one-chat-per-project). It composes the pure
// §5.AT cores — `mapSessionSummaryToOperatorSignals` (summary → signals), `decideBoardChatFeedback` (prev/next →
// suppress | surface_ask | surface_notify | defer_to_digest, with anti-spam dedupe), `buildBoardChatDigest` (the
// shared renderer), and `createCoalescingScheduler` (quiet-mode digest batching) — while OWNING only the per-task
// prev-signal memory, the per-session surfaced-key set (dedupe + outstanding ASKs), and the per-session digest
// queue. All I/O (resolve the owning chat, append a message, read a card title, record/clear an ASK) is INJECTED,
// so the whole decision+coalescing behavior is unit-testable without a runtime. Best-effort: `onTransition` never
// throws into the summary handler that drives it.

import { type BoardChatDigestItem, buildBoardChatDigest } from "../core/board-chat-digest";
import { activeBoardChatAskKinds, type BoardChatVerbosity, decideBoardChatFeedback } from "../core/board-chat-feedback";
import { type CoalescingScheduler, createCoalescingScheduler } from "../core/coalescing-scheduler";
import {
	mapSessionSummaryToOperatorSignals,
	type OperatorColumnId,
	type OperatorSessionSummaryView,
	type OperatorSignalOverrides,
	type OperatorTaskSignals,
} from "../core/operator-task-state";

/** The owning chat for a workspace + its push preferences (verbosity/quiet), or null when none can be resolved. */
export interface OwningChatRef {
	sessionId: string;
	verbosity: BoardChatVerbosity;
	quiet: boolean;
}

export interface BoardChatFeedbackBridgeDeps {
	/** Resolve (find-or-create) the chat owning a workspace; null ⇒ nothing is pushed (never broadcast to every chat). */
	resolveOwningChat: (workspaceId: string) => Promise<OwningChatRef | null>;
	/** Append a system message (the rendered digest text) to a chat session. */
	appendChatMessage: (sessionId: string, text: string) => Promise<void>;
	/** The card's human title for the digest line. */
	getCardTitle: (workspaceId: string, taskId: string) => Promise<string>;
	/** Record an outstanding ASK on the owning session (drives §5.AU reply-binding); optional. */
	addOutstandingAsk?: (
		sessionId: string,
		ask: { signalKey: string; taskId: string; question: string },
	) => Promise<void>;
	/** Clear an outstanding ASK once its signal resolves; optional. */
	clearOutstandingAsk?: (sessionId: string, signalKey: string) => Promise<void>;
	/** Coalescing window (ms) for quiet-mode deferred NOTIFY digests. Default 15s. */
	digestDelayMs?: number;
	/** Best-effort error sink; never rethrown. */
	onError?: (error: unknown) => void;
}

/** One observed transition to feed the bridge. `prevSummary` null = first observation of the task. */
export interface BoardSummaryTransition {
	taskId: string;
	workspaceId: string;
	columnId: OperatorColumnId;
	/** Ignored by `onTransition` (the bridge tracks prev-signals internally, keyed by taskId); kept for callers/tests. */
	prevSummary?: OperatorSessionSummaryView | null;
	nextSummary: OperatorSessionSummaryView;
	/** Off-summary signals (gate/clarify/block/ack) the summary doesn't carry; omit when unknown. */
	overrides?: OperatorSignalOverrides;
	/** The owning session is mid-autonomous-run ⇒ NOTIFY suppressed (it sees the board via its own tools). */
	sessionInAutonomousRun?: boolean;
	/** The agent's terminal result/error snippet, for the done/failed line; omit when none. */
	resultText?: string;
}

const DEFAULT_DIGEST_DELAY_MS = 15_000;

export interface BoardChatFeedbackBridge {
	/** Feed one summary transition. Best-effort (never throws). */
	onTransition: (transition: BoardSummaryTransition) => Promise<void>;
	/** Seed a task's prev-signals WITHOUT deciding/surfacing — call on startup for each existing session so the first
	 *  LIVE transition compares against the real state instead of replaying an old completion as a new notification. */
	seed: (transition: Pick<BoardSummaryTransition, "taskId" | "columnId" | "nextSummary" | "overrides">) => void;
	/** Flush any queued digest for a session immediately (e.g. on chat open); all sessions when omitted. */
	flush: (sessionId?: string) => Promise<void>;
	/** Cancel all timers (on dispose). */
	dispose: () => void;
}

export function createBoardChatFeedbackBridge(deps: BoardChatFeedbackBridgeDeps): BoardChatFeedbackBridge {
	const digestDelayMs = deps.digestDelayMs ?? DEFAULT_DIGEST_DELAY_MS;
	// Per-task last signals (prev vs next). Per-session: surfaced keys (dedupe), queued digest items, scheduler.
	const prevSignalsByTask = new Map<string, OperatorTaskSignals>();
	const surfacedKeysBySession = new Map<string, Set<string>>();
	const pendingDigestBySession = new Map<string, BoardChatDigestItem[]>();
	const schedulerBySession = new Map<string, CoalescingScheduler<string>>();

	const surfacedKeys = (sessionId: string): Set<string> => {
		const existing = surfacedKeysBySession.get(sessionId);
		if (existing) {
			return existing;
		}
		const created = new Set<string>();
		surfacedKeysBySession.set(sessionId, created);
		return created;
	};

	const flushSession = async (sessionId: string): Promise<void> => {
		const items = pendingDigestBySession.get(sessionId);
		if (!items || items.length === 0) {
			return;
		}
		pendingDigestBySession.delete(sessionId);
		const digest = buildBoardChatDigest({ items });
		if (digest.message.length > 0) {
			await deps.appendChatMessage(sessionId, digest.message).catch((error) => deps.onError?.(error));
		}
	};

	const scheduler = (sessionId: string): CoalescingScheduler<string> => {
		const existing = schedulerBySession.get(sessionId);
		if (existing) {
			return existing;
		}
		const created = createCoalescingScheduler<string>((id) => {
			void flushSession(id).catch((error) => deps.onError?.(error));
		}, digestDelayMs);
		schedulerBySession.set(sessionId, created);
		return created;
	};

	const surfaceNow = async (sessionId: string, item: BoardChatDigestItem): Promise<void> => {
		const digest = buildBoardChatDigest({ items: [item] });
		if (digest.message.length > 0) {
			await deps.appendChatMessage(sessionId, digest.message).catch((error) => deps.onError?.(error));
		}
	};

	const onTransition = async (transition: BoardSummaryTransition): Promise<void> => {
		try {
			const next = mapSessionSummaryToOperatorSignals(
				transition.nextSummary,
				transition.columnId,
				transition.overrides ?? {},
			);
			const prev = prevSignalsByTask.get(transition.taskId) ?? null;
			prevSignalsByTask.set(transition.taskId, next);

			const owner = await deps.resolveOwningChat(transition.workspaceId);
			const keys = owner ? surfacedKeys(owner.sessionId) : new Set<string>();

			const verdict = decideBoardChatFeedback({
				taskId: transition.taskId,
				prev,
				next,
				verbosity: owner?.verbosity ?? "normal",
				muted: false,
				quiet: owner?.quiet ?? false,
				ownerResolved: owner !== null,
				sessionInAutonomousRun: transition.sessionInAutonomousRun ?? false,
				alreadySurfacedKeys: [...keys],
			});

			// Clear surfaced ASK keys whose signal has resolved (so a later re-raise surfaces again).
			if (owner) {
				const activeAsks = new Set(activeBoardChatAskKinds(next).map((kind) => `${transition.taskId}:${kind}`));
				for (const key of [...keys]) {
					const isAskKey = key.startsWith(`${transition.taskId}:`) && !activeAsks.has(key);
					// Only clear ASK keys — NOTIFY keys (done/failed) are terminal and stay deduped.
					if (isAskKey && key.match(/:(unsafe_action_ack|delivery_gate_held|needs_input|sandbox_unavailable)$/)) {
						keys.delete(key);
						await deps.clearOutstandingAsk?.(owner.sessionId, key).catch((error) => deps.onError?.(error));
					}
				}
			}

			if (!owner || verdict.action === "suppress" || verdict.signalKey === null) {
				return;
			}

			const item: BoardChatDigestItem = {
				taskId: transition.taskId,
				title: await deps.getCardTitle(transition.workspaceId, transition.taskId),
				tier: verdict.tier ?? "notify",
				reason: verdict.reason,
				...(transition.resultText ? { resultText: transition.resultText } : {}),
				...(verdict.suggestedVerbs ? { suggestedVerbs: verdict.suggestedVerbs } : {}),
			};

			if (verdict.action === "defer_to_digest") {
				const queue = pendingDigestBySession.get(owner.sessionId) ?? [];
				queue.push(item);
				pendingDigestBySession.set(owner.sessionId, queue);
				keys.add(verdict.signalKey);
				scheduler(owner.sessionId).schedule(owner.sessionId);
				return;
			}

			// surface_ask / surface_notify — push now.
			keys.add(verdict.signalKey);
			if (verdict.action === "surface_ask") {
				await deps
					.addOutstandingAsk?.(owner.sessionId, {
						signalKey: verdict.signalKey,
						taskId: transition.taskId,
						question: verdict.reason,
					})
					.catch((error) => deps.onError?.(error));
			}
			await surfaceNow(owner.sessionId, item);
		} catch (error) {
			deps.onError?.(error);
		}
	};

	const flush = async (sessionId?: string): Promise<void> => {
		if (sessionId) {
			schedulerBySession.get(sessionId)?.cancel();
			await flushSession(sessionId);
			return;
		}
		for (const id of [...pendingDigestBySession.keys()]) {
			schedulerBySession.get(id)?.cancel();
			await flushSession(id);
		}
	};

	const seed = (
		transition: Pick<BoardSummaryTransition, "taskId" | "columnId" | "nextSummary" | "overrides">,
	): void => {
		prevSignalsByTask.set(
			transition.taskId,
			mapSessionSummaryToOperatorSignals(transition.nextSummary, transition.columnId, transition.overrides ?? {}),
		);
	};

	const dispose = (): void => {
		for (const scheduled of schedulerBySession.values()) {
			scheduled.cancel();
		}
		schedulerBySession.clear();
	};

	return { onTransition, seed, flush, dispose };
}
