/**
 * ZERO-TOKEN TURN LIVENESS (live-found 2026-07-13, real-model rail run — the "planning freeze" root cause).
 *
 * A task session can wedge BEFORE ITS FIRST MODEL TURN ever produces output: state `running`, `lastTokenAt` null,
 * no heartbeat armed (the heartbeat machinery only starts once output starts), zero sockets to the endpoint —
 * live-seen when the queued-start drain raced the decompose seed's teardown. Such a ZOMBIE session is invisible to
 * every existing liveness signal, yet it OWNS a per-machine concurrency slot (cap=1 on a small fleet), so every
 * subsequent start fails `endpoint_busy` naming it and the whole cascade deadlocks with an idle fleet.
 *
 * This module is the pure detector: given the live summaries, list the sessions that have been `running` for longer
 * than a GENEROUS bound without EVER producing a token or arming a heartbeat. The caller (the board-liveness
 * watchdog) interrupts them — the summary event then drives the existing retry machinery, which is healthy once the
 * poisoned slot clears (live-proven: a manual stop resumed the cascade instantly).
 *
 * The bound is deliberately generous: on a low-power fleet, PREFILL is the dominant latency and a legitimate first
 * token can take minutes (§5.AQ) — the default assumes nothing real stays token-less for 15 minutes. A false
 * positive costs one interrupt + auto-retry of that card; a false negative costs the whole board (the deadlock this
 * exists to break), so err toward eventually firing. Pure + total: no clock, no I/O — `nowMs` is injected.
 */

import type { RuntimeTaskSessionSummary } from "./task-session-api-contract";

/** One wedged session: which task, how long it has been token-less, and an operator-facing reason line. */
export interface ZeroTokenWedgeFinding {
	taskId: string;
	/** Milliseconds since the session started (never negative). */
	ageMs: number;
	/** One-line human reason (safe for the watchdog's warn + self-observation). */
	reason: string;
}

export interface ZeroTokenWedgeOptions {
	/** How long a `running` session may stay token-less before it reads as wedged. Default {@link DEFAULT_ZERO_TOKEN_WEDGE_MS}. */
	wedgeAfterMs?: number;
}

/**
 * Default zero-token bound: 15 minutes. Far above any observed real first-token latency on the low-power fleet
 * (worst measured prefills are minutes, not tens of minutes), far below "operator walks away and the board is dead
 * for hours" (the live wedge sat 14+ minutes and was still there).
 */
export const DEFAULT_ZERO_TOKEN_WEDGE_MS = 15 * 60 * 1000;

/**
 * List the sessions wedged pre-first-token. A session qualifies only when EVERY liveness signal is absent:
 * `running`, not paused, started long enough ago, never produced a token, and never armed a heartbeat. A session
 * with ANY token or heartbeat history is left to the existing heartbeat/stale machinery — this detector owns only
 * the shape that machinery cannot see.
 */
export function listZeroTokenWedgedSessions(
	summaries: readonly RuntimeTaskSessionSummary[],
	nowMs: number,
	options?: ZeroTokenWedgeOptions,
): ZeroTokenWedgeFinding[] {
	const bound = normalizeBound(options?.wedgeAfterMs);
	const findings: ZeroTokenWedgeFinding[] = [];
	if (!Array.isArray(summaries) || !Number.isFinite(nowMs)) {
		return findings;
	}
	for (const summary of summaries) {
		if (summary?.state !== "running" || summary.paused === true) {
			continue;
		}
		// A synthetic/auxiliary session (`<taskId>::review` etc.) still holds endpoint capacity — include it.
		if (typeof summary.startedAt !== "number" || !Number.isFinite(summary.startedAt)) {
			continue; // no start stamp — cannot age it; leave to other machinery
		}
		if (summary.lastTokenAt != null || summary.lastHeartbeatAt != null || summary.heartbeatStatus != null) {
			continue; // some liveness signal exists — the heartbeat machinery owns it
		}
		const ageMs = Math.max(0, nowMs - summary.startedAt);
		if (ageMs <= bound) {
			continue;
		}
		findings.push({
			taskId: summary.taskId,
			ageMs,
			reason:
				`session has been "running" for ${Math.round(ageMs / 60_000)} min without a first token or heartbeat ` +
				"(pre-first-turn wedge) — it is holding an endpoint slot while doing nothing",
		});
	}
	return findings;
}

function normalizeBound(wedgeAfterMs: number | undefined): number {
	if (typeof wedgeAfterMs !== "number" || !Number.isFinite(wedgeAfterMs) || wedgeAfterMs <= 0) {
		return DEFAULT_ZERO_TOKEN_WEDGE_MS;
	}
	return wedgeAfterMs;
}
