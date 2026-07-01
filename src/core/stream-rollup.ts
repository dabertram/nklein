/**
 * §5.AU STEP 3 — roll a STREAM's member cards up into one status the main chat can show at "group altitude". Pure +
 * deterministic (injected `now`): folds each member's normalized {@link OperatorTaskSignals} (via the SAME
 * `classifyOperatorTaskState` vocabulary the board-health rollup uses) into counts + a count-based progress fraction + a
 * health BADGE + a lifecycle + the running frontier.
 *
 * The health badge is a status-FRONTIER roll-up, not percent-only (the research pitfall): a stream at 90% "done" that has
 * a member blocked on an operator decision reads `blocked`, never `on_track` — the worst live signal wins. And
 * stale-vs-no-signal is explicit: an active stream with no recent transition reads `stale`, never a false-green
 * `on_track`. Progress is count-based (`done cards / total cards`) with the method disclosed — there are no story points,
 * so no weighted variant to be ambiguous about.
 */

import { classifyOperatorTaskState, type OperatorTaskSignals, type OperatorTaskState } from "./operator-task-state";

/** One member card of a stream, with its signals + when it last had a transition (for staleness). */
export interface StreamRollupMember {
	taskId: string;
	signals: OperatorTaskSignals;
	/** Epoch ms of the member's last signal transition / activity. */
	lastActivityAt: number;
}

export interface DeriveStreamRollupInput {
	members: readonly StreamRollupMember[];
	/** Injected clock (epoch ms). */
	now: number;
	/** No transition within this window ⇒ the stream reads `stale` instead of `on_track`. */
	stalenessMs: number;
}

/** The stream's headline badge (worst live signal wins; `stale` only downgrades an otherwise-on_track stream). */
export type StreamHealth = "on_track" | "stale" | "at_risk" | "blocked" | "done" | "empty";

/** Derived lifecycle — never a manual state machine. */
export type StreamLifecycle = "active" | "done" | "empty";

export interface StreamRollup {
	counts: Record<OperatorTaskState, number>;
	progress: { done: number; total: number; method: "card_count" };
	health: StreamHealth;
	lifecycle: StreamLifecycle;
	/** The cards running right now ("now: card #42"), in input order. */
	frontierTaskIds: readonly string[];
	/** Whether the stream has had no recent activity (drives the `stale` badge; honest even under other badges). */
	stale: boolean;
}

/**
 * Roll a stream's members up into one status. Pure + deterministic. An empty stream is `empty`/GC-eligible; otherwise the
 * badge is the worst live signal (`blocked` > `at_risk`), then `done` when every member is terminal, then `stale` for a
 * quiet active stream, else `on_track`.
 */
export function deriveStreamRollup(input: DeriveStreamRollupInput): StreamRollup {
	const counts: Record<OperatorTaskState, number> = { healthy: 0, stuck: 0, risky: 0, done: 0 };
	const total = input.members.length;

	if (total === 0) {
		return {
			counts,
			progress: { done: 0, total: 0, method: "card_count" },
			health: "empty",
			lifecycle: "empty",
			frontierTaskIds: [],
			stale: false,
		};
	}

	const frontierTaskIds: string[] = [];
	let maxLastActivityAt = Number.NEGATIVE_INFINITY;
	for (const member of input.members) {
		counts[classifyOperatorTaskState(member.signals)] += 1;
		if (member.signals.sessionState === "running") {
			frontierTaskIds.push(member.taskId);
		}
		if (member.lastActivityAt > maxLastActivityAt) {
			maxLastActivityAt = member.lastActivityAt;
		}
	}

	const lifecycle: StreamLifecycle = counts.done === total ? "done" : "active";
	const stale = lifecycle !== "done" && input.now - maxLastActivityAt > input.stalenessMs;

	const health: StreamHealth =
		counts.risky > 0
			? "blocked"
			: counts.stuck > 0
				? "at_risk"
				: lifecycle === "done"
					? "done"
					: stale
						? "stale"
						: "on_track";

	return {
		counts,
		progress: { done: counts.done, total, method: "card_count" },
		health,
		lifecycle,
		frontierTaskIds,
		stale,
	};
}
