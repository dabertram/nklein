/**
 * F12.108 zero-touch autonomy KPIs — PURE projection over the attempt ledger.
 *
 * !Klein measures cost (F12.48) and process quality (F12.42) but not AUTONOMY: how often does a card ship with
 * ZERO human touches? This core folds the ledger's transition stream into per-bucket KPIs the operator can steer
 * by (the ADW "your codebase runs itself" measurement thread).
 *
 * Honesty contract:
 *  - Only ledger-VISIBLE interventions are counted: `reopened` transitions and cancellations. Parks, steer notes,
 *    and operator merges do not reach the ledger today — they are named in `captureGaps`, so the zero-touch rate
 *    is explicitly an UPPER bound until those events are ledgered.
 *  - Extra start cycles beyond a task's first are reported as `restarts` but NOT counted as human touches — the
 *    board-liveness watchdog and failover legs restart cards autonomously, and conflating them would fake a low
 *    autonomy score.
 *  - Dev-test tasks (devtest-/dev- prefixes) land in their own bucket and never inflate the production rate.
 */

import type { AgentLedgerEvent } from "./agent-attempt-ledger";

export interface ZeroTouchBucketKpis {
	readonly bucket: "production" | "dev_test";
	/** Tasks that reached a terminal delivery transition (merge / commit / open_pr). */
	readonly tasksDelivered: number;
	/** Delivered tasks with zero ledger-visible interventions. */
	readonly zeroTouch: number;
	/** zeroTouch / tasksDelivered; null when nothing delivered. */
	readonly zeroTouchRate: number | null;
	/** Ledger-visible interventions across the bucket's tasks. */
	readonly reopens: number;
	readonly cancellations: number;
	/** Extra start cycles beyond each task's first — autonomous retries included, so reported, not counted. */
	readonly restarts: number;
	/** Longest run of consecutive zero-touch deliveries, in delivery order. */
	readonly longestZeroTouchStreak: number;
	readonly failed: number;
}

export interface ZeroTouchKpis {
	readonly buckets: ZeroTouchBucketKpis[];
	/** Human-touch channels the ledger cannot see yet — the rate is an upper bound while these exist. */
	readonly captureGaps: readonly string[];
}

const CAPTURE_GAPS = [
	"parks (reviewReason=attention) are summary-state, not ledgered — a parked-then-human-resolved card can look zero-touch",
	"steer notes (card mailbox) are not ledgered",
	"operator merges (mergeTaskWorktrees) are not distinguishable from auto-delivery merges",
] as const;

const DELIVERY_PREFIX = "delivery_";

function isDevTestTaskId(taskId: string): boolean {
	return /^dev(test)?-/.test(taskId);
}

export function computeZeroTouchKpis(events: readonly AgentLedgerEvent[]): ZeroTouchKpis {
	interface TaskState {
		delivered: boolean;
		deliveredAt: number;
		reopens: number;
		cancellations: number;
		startCycles: number;
		failed: boolean;
	}
	const byTask = new Map<string, TaskState>();
	const stateFor = (taskId: string): TaskState => {
		const existing = byTask.get(taskId);
		if (existing) {
			return existing;
		}
		const created: TaskState = {
			delivered: false,
			deliveredAt: 0,
			reopens: 0,
			cancellations: 0,
			startCycles: 0,
			failed: false,
		};
		byTask.set(taskId, created);
		return created;
	};
	for (const event of events) {
		if (event.kind !== "transition" || !event.taskId) {
			continue;
		}
		const state = stateFor(event.taskId);
		const to = event.to;
		const reason = event.reason ?? "";
		if (to.startsWith(DELIVERY_PREFIX) && to !== "delivery_quality_scan") {
			state.delivered = true;
			state.deliveredAt = Math.max(state.deliveredAt, event.recordedAt);
		}
		if (reason === "reopened") {
			state.reopens += 1;
		}
		if (to === "wf:cancelled") {
			state.cancellations += 1;
		}
		if (reason === "start_requested") {
			state.startCycles += 1;
		}
		if (to === "wf:failed" || to === "failed") {
			state.failed = true;
		}
	}

	const buckets: ZeroTouchBucketKpis[] = (["production", "dev_test"] as const).map((bucket) => {
		const tasks = [...byTask.entries()].filter(([taskId]) => (bucket === "dev_test") === isDevTestTaskId(taskId));
		const delivered = tasks.filter(([, state]) => state.delivered);
		const deliveredOrdered = [...delivered].sort((left, right) => left[1].deliveredAt - right[1].deliveredAt);
		let streak = 0;
		let longest = 0;
		for (const [, state] of deliveredOrdered) {
			if (state.reopens === 0 && state.cancellations === 0) {
				streak += 1;
				longest = Math.max(longest, streak);
			} else {
				streak = 0;
			}
		}
		const zeroTouch = delivered.filter(([, state]) => state.reopens === 0 && state.cancellations === 0).length;
		return {
			bucket,
			tasksDelivered: delivered.length,
			zeroTouch,
			zeroTouchRate: delivered.length > 0 ? zeroTouch / delivered.length : null,
			reopens: tasks.reduce((sum, [, state]) => sum + state.reopens, 0),
			cancellations: tasks.reduce((sum, [, state]) => sum + state.cancellations, 0),
			restarts: tasks.reduce((sum, [, state]) => sum + Math.max(0, state.startCycles - 1), 0),
			longestZeroTouchStreak: longest,
			failed: tasks.filter(([, state]) => state.failed).length,
		};
	});

	return { buckets, captureGaps: CAPTURE_GAPS };
}
