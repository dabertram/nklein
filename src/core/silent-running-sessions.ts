/**
 * P0.DSTALL close-out (2026-09-07): the POST-first-token liveness sweep — the sibling of `session-turn-liveness.ts`.
 *
 * A working-lane card whose session summary reads `running` while no model turn is open is a ZOMBIE, and every
 * terminating rung the runtime has is scoped to an OPEN turn or to the pre-first-token window:
 *   · the stream / tool / conversation timeouts and the dead-stream probe live INSIDE a turn and are cleared at its
 *     end (`clearActiveTurnState`);
 *   · the zero-token wedge sweep (`listZeroTokenWedgedSessions`) explicitly leaves a session with token history "to
 *     the normal heartbeat/stream machinery";
 *   · the trouble monitor's `silent` verdict (no hook/output for 20 minutes) is RECORD-ONLY by design and defers to
 *     "the killing rungs";
 *   · the marooned-card reconcile trusts the `running` label (a running summary is "busy") and scans only the
 *     In Progress lane, while a plan-mode card parks in Planning (`STARTED_CARD_ENTRY_LANE`);
 *   · the ready sweep counts a `running` summary as an active session and never restarts the card;
 *   · the dead-card ONE-fresh-restart keys on a TERMINAL summary event that a zombie never emits.
 * So the card is owned by nobody. Run-3 of the Dschinn campaign (2026-08-20, `.real-runs/20260820-222524`, ledger
 * `evidence/card-transitions.jsonl`): running → awaiting_review(hook) at 23:08:42 → running 1.4 s later → the
 * record-only `trouble_silent` at 23:29:01 → nothing, until the rig's external reactor killed the run. Layer 1 closed
 * that run's two WRITERS (the tool-event revival and the start-guard swallow); nothing owned the SHAPE, and the
 * P0.DSTALL gate names exactly this invariant: "within the trouble threshold the card either runs a fresh turn or
 * parks — it never sits `running` sessionless".
 *
 * This module is the pure detector: given the board and the live summaries, list the working-lane cards
 * (planning / in_progress / review) whose summary is `running` yet has shown NO liveness evidence — heartbeat, hook,
 * output or token — for longer than a generous bound (default: the trouble monitor's own 20-minute silent threshold).
 * The caller (the board-liveness watchdog) first asks `lms ps` (a model still processing/generating is slow, not
 * dead — the P0.BUSYWEDGE rule), then interrupts: the interrupted summary drives the existing terminal machinery (one
 * fresh restart, then the operator), which every downstream layer already understands.
 *
 * Deliberately OUT of scope (each has an owner):
 *   · pre-first-token sessions (`lastTokenAt` null) — the zero-token wedge sweep and the swept-start force-reclaim;
 *   · sessions with a tool in flight (`toolActiveTaskIds`) — the service's tool timeout owns tool execution, and a
 *     long sandbox command legitimately emits no session event for its whole duration;
 *   · paused sessions (operator intent), derived `<card>::…` sessions and home-agent chats (they name no board card
 *     in a working lane), and cards in backlog / ready / terminal lanes (a running summary there is another leg's
 *     fact — the trashed-card stop owns terminal lanes).
 * Pure + total: no clock, no I/O — `nowMs` is injected; malformed input yields no findings.
 */

import type { RuntimeTaskSessionSummary } from "./task-session-api-contract";

export interface SilentRunningSessionBoard {
	columns: ReadonlyArray<{ id: string; cards: ReadonlyArray<{ id: string }> }>;
}

/** One silent `running` card: which task, where it sits, how long it has been silent, and an operator-facing reason. */
export interface SilentRunningSessionFinding {
	taskId: string;
	/** The working lane the card sits in (`planning` for a plan-mode card, `in_progress` for a worker, `review`). */
	columnId: string;
	/** Milliseconds since the session's last liveness evidence (heartbeat / hook / output / token); never negative. */
	silentMs: number;
	/** Milliseconds since the session started (0 when the start stamp is unknown). */
	ageMs: number;
	/** One-line human reason (safe for the watchdog's warn + self-observation). */
	reason: string;
}

export interface SilentRunningSessionOptions {
	/**
	 * How long a `running` summary may go without liveness evidence before it reads as a dead session.
	 * Default {@link DEFAULT_SILENT_RUNNING_RECONCILE_MS}.
	 */
	silentAfterMs?: number;
	/** Tasks with a tool call in flight (the service's `isToolActive`) — exempt: the tool timeout owns tool execution. */
	toolActiveTaskIds?: ReadonlySet<string>;
}

/**
 * Default silent bound: 20 minutes — the trouble monitor's own `silent` threshold
 * (`RUNNING_TASK_TROUBLE_LIVENESS_THRESHOLDS.heartbeatLostAfterMs`), i.e. the exact moment run-3's record-only
 * `trouble_silent` fired. Far above any real between-event gap of a live turn (every streamed token, tool event and
 * model-turn admission wait renews the heartbeat; a slow prefill is caught by the caller's `lms ps` busy check), far
 * below "operator walks away and the board is dead for hours". A false positive costs one interrupt + the card's own
 * terminal retry; a false negative costs the whole board behind the card — err toward eventually firing.
 */
export const DEFAULT_SILENT_RUNNING_RECONCILE_MS = 20 * 60 * 1000;

/**
 * The lanes a card occupies WHILE its session is expected to be alive: a started card parks in Planning
 * (`STARTED_CARD_ENTRY_LANE`), a promoted worker sits In Progress, and a re-work bounce briefly runs from Review.
 */
const WORKING_LANES: ReadonlySet<string> = new Set(["planning", "in_progress", "review"]);

/**
 * List the working-lane cards whose `running` summary has gone silent past the bound. A card qualifies only when its
 * summary is `running`, not paused, not exempt as tool-active, has produced at least one token (otherwise the
 * zero-token wedge sweep owns it), and its NEWEST liveness stamp — heartbeat, hook, output or token — is older than
 * the bound. One finding per card, in summary order.
 */
export function listSilentRunningSessions(
	board: SilentRunningSessionBoard,
	summaries: readonly RuntimeTaskSessionSummary[],
	nowMs: number,
	options?: SilentRunningSessionOptions,
): SilentRunningSessionFinding[] {
	const findings: SilentRunningSessionFinding[] = [];
	if (!Array.isArray(board?.columns) || !Array.isArray(summaries) || !Number.isFinite(nowMs)) {
		return findings;
	}
	const bound = normalizeBound(options?.silentAfterMs);
	const workingLaneByCardId = new Map<string, string>();
	for (const column of board.columns) {
		if (!WORKING_LANES.has(column.id)) {
			continue;
		}
		for (const card of column.cards) {
			// A lane-shadow copy (the same id in two lanes) keeps the first working lane seen; the lane only labels
			// the finding — the reconciliation is the same either way.
			if (!workingLaneByCardId.has(card.id)) {
				workingLaneByCardId.set(card.id, column.id);
			}
		}
	}
	const seen = new Set<string>();
	for (const summary of summaries) {
		if (summary?.state !== "running" || summary.paused === true || seen.has(summary.taskId)) {
			continue;
		}
		const columnId = workingLaneByCardId.get(summary.taskId);
		if (columnId === undefined) {
			continue; // derived / home-agent ids and cards outside the working lanes name no card here
		}
		if (options?.toolActiveTaskIds?.has(summary.taskId)) {
			continue; // a tool is executing — the service's tool timeout owns it
		}
		if (!isFiniteStamp(summary.lastTokenAt)) {
			continue; // pre-first-token: the zero-token wedge sweep's jurisdiction
		}
		const lastEvidenceAt = Math.max(
			summary.lastTokenAt,
			...[summary.lastHeartbeatAt, summary.lastHookAt, summary.lastOutputAt].filter(isFiniteStamp),
		);
		const silentMs = Math.max(0, nowMs - lastEvidenceAt);
		if (silentMs <= bound) {
			continue;
		}
		seen.add(summary.taskId);
		const ageMs = isFiniteStamp(summary.startedAt) ? Math.max(0, nowMs - summary.startedAt) : 0;
		const lastActivity = summary.latestHookActivity?.hookEventName ?? "none";
		findings.push({
			taskId: summary.taskId,
			columnId,
			silentMs,
			ageMs,
			reason:
				`the "running" ${columnId} card has produced no liveness evidence (heartbeat / hook / output / token) ` +
				`for ${Math.round(silentMs / 60_000)} min (heartbeat ${summary.heartbeatStatus ?? "unknown"}, last activity ` +
				`${lastActivity}) — a dead session wearing a live label, past the trouble monitor's silent threshold`,
		});
	}
	return findings;
}

function isFiniteStamp(value: number | null | undefined): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function normalizeBound(silentAfterMs: number | undefined): number {
	if (typeof silentAfterMs !== "number" || !Number.isFinite(silentAfterMs) || silentAfterMs <= 0) {
		return DEFAULT_SILENT_RUNNING_RECONCILE_MS;
	}
	return silentAfterMs;
}
