/**
 * Turn recorded tool-gate counterfactuals into decidable observations. PURE core — P15.3.
 *
 * ── THE SHAPE MISMATCH THIS BRIDGES ──
 * The F12.18 tool-catalog gate runs RECORD-ONLY and emits `{offered, wouldKeep, wouldDrop, …}` per turn.
 * {@link ../core/mechanism-decision-report#buildMechanismDecision} needs `{recommended, actual, succeeded}`. The
 * first two fall out of the counterfactual; **`succeeded` is the whole difficulty**, because it is a fact about how
 * the CARD ended and lives nowhere near the observation. Until the emit site carried a `taskId` there was no way to
 * join them at all, and the report would have returned `insufficient_data` forever with `evaluable: 0` — a verdict
 * a reader takes as "not enough samples yet" when no amount of sampling could have changed it.
 *
 * ── WHY `actual` IS ALWAYS "keep_all", AND WHY THAT IS THE POINT ──
 * The gate never withholds anything; it only records what it WOULD have withheld. So the system's actual behaviour
 * is "keep every offered tool", every time, and a disagreement is exactly an observation where `wouldDrop > 0`.
 * That is what makes this a clean counterfactual: the mechanism's recommendation and the world's behaviour are
 * independent, because the mechanism has never influenced the world.
 *
 * ── UNKNOWN OUTCOMES ARE NOT FAILURES ──
 * A turn whose card outcome is unavailable — no `taskId` on a legacy record, a card still running, a task the
 * outcome map does not cover — yields `succeeded: null`. The decision core counts those as observations but NOT as
 * evaluable, which is the honest treatment: the gate demonstrably fired, and whether enforcing would have helped is
 * simply unknown. Defaulting them to `false` would manufacture evidence that enforcement was needed; defaulting to
 * `true` would manufacture evidence that it was not. Both would be inventing the answer the campaign exists to find.
 */

import type { MechanismObservation } from "./mechanism-decision-report";
import { resolveOutcomeForObservation } from "./observation-outcome-bridge";

/** What the gate wrote, as a reader recovers it from the self-observation stream. */
export interface ToolGateObservationRecord {
	/** The join key (P15.3). Absent on records written before it was added — those stay unevaluable, not dropped. */
	readonly taskId?: string | null;
	/** Tools the model was offered on this turn. */
	readonly offered?: number | null;
	/** Tools the gate would have kept had it been enforcing. */
	readonly wouldKeep?: number | null;
	/** Tools the gate would have withheld. `> 0` IS the disagreement. */
	readonly wouldDrop?: number | null;
}

/** The recommendation vocabulary. Two values, because the gate's decision is binary at this granularity. */
export const GATE_RECOMMENDED_WITHHOLD = "withhold";
export const GATE_KEEP_ALL = "keep_all";

export interface ToolGateJoinReport {
	readonly observations: readonly MechanismObservation[];
	/** Records that carried no usable `wouldDrop` — malformed, and excluded rather than read as agreement. */
	readonly unusableRecords: number;
	/** Observations with no joinable outcome. Reported so `evaluable: 0` is never mistaken for "no disagreements". */
	readonly unjoinedOutcomes: number;
	readonly summary: string;
}

/**
 * Join gate counterfactuals to card outcomes.
 *
 * `outcomeByTaskId` maps a task to whether it ultimately succeeded. A task absent from the map is UNKNOWN, not
 * failed — the map is expected to be partial (cards still running, older tasks pruned from the board).
 */
export function joinToolGateObservations(input: {
	readonly records: readonly ToolGateObservationRecord[];
	readonly outcomeByTaskId: ReadonlyMap<string, boolean>;
}): ToolGateJoinReport {
	const observations: MechanismObservation[] = [];
	let unusableRecords = 0;
	let unjoinedOutcomes = 0;

	for (const record of input.records) {
		// A record with no `wouldDrop` cannot say whether the gate agreed. Counting it as agreement would dilute the
		// disagreement rate toward zero and make the gate look like a no-op — the verdict that ends in DELETION.
		if (typeof record.wouldDrop !== "number" || !Number.isFinite(record.wouldDrop) || record.wouldDrop < 0) {
			unusableRecords += 1;
			continue;
		}
		const taskId = typeof record.taskId === "string" && record.taskId.length > 0 ? record.taskId : null;
		const outcome = taskId === null ? undefined : resolveOutcomeForObservation(taskId, input.outcomeByTaskId);
		if (outcome === undefined) {
			unjoinedOutcomes += 1;
		}
		observations.push({
			recommended: record.wouldDrop > 0 ? GATE_RECOMMENDED_WITHHOLD : GATE_KEEP_ALL,
			// The gate is record-only: the system kept every offered tool, on every turn, without exception.
			actual: GATE_KEEP_ALL,
			succeeded: outcome ?? null,
		});
	}

	const disagreements = observations.filter((entry) => entry.recommended !== entry.actual).length;
	const evaluable = observations.filter(
		(entry) => entry.recommended !== entry.actual && entry.succeeded !== null,
	).length;
	return {
		observations,
		unusableRecords,
		unjoinedOutcomes,
		summary:
			observations.length === 0
				? "no usable tool-gate observations — this says nothing about whether the gate should enforce"
				: `${observations.length} observation(s), ${disagreements} disagreement(s), ${evaluable} EVALUABLE` +
					(evaluable === 0
						? " — a verdict is impossible until outcomes join; this is a data gap, NOT evidence the gate is a no-op"
						: "") +
					(unjoinedOutcomes > 0 ? ` (${unjoinedOutcomes} without a joinable outcome)` : "") +
					(unusableRecords > 0 ? ` (${unusableRecords} malformed record(s) excluded)` : ""),
	};
}

/** The slice of a `scheduler` ledger event this index needs. */
export interface SchedulerOutcomeEvent {
	readonly kind?: string;
	readonly event?: string;
	readonly taskId?: string | null;
	readonly detail?: string | null;
}

/**
 * Per-task success, from the durable scheduler's own terminal records.
 *
 * `completed` carries `detail` = `succeeded` | `failed` | `transient_retry`. **`transient_retry` is deliberately
 * NOT an outcome** — it is the scheduler returning a job to `ready` after a transient fault, and recording it as a
 * failure would blame the mechanism under test for an infrastructure hiccup. A task that only ever retried stays
 * ABSENT from the index, which the join reads as "unknown" rather than as failure.
 *
 * A task with several terminal records keeps the LAST, because a late `succeeded` legitimately supersedes an
 * earlier `failed` — that exact late-success path is a documented behaviour of `reportCompletion`.
 */
/** One `card_lane_change` observation: the board move that terminates (or does not terminate) a card. */
export interface CardLaneChangeRecord {
	readonly taskId: string | null;
	readonly toLane: string | null;
}

/**
 * Outcome index from BOARD LANE CHANGES — the fallback source when no durable-scheduler events exist.
 *
 * Measured 2026-08-20, not assumed: `buildTaskOutcomeIndex` reads `scheduler`/`completed` ledger events, and
 * those are written ONLY while a durable run owns the workspace. Ordinary dev-test/rig drains never create
 * one, so their ledgers hold transitions and attempts but ZERO scheduler events — the outcome index came back
 * empty and every mechanism observation joined to "unknown outcome" forever (44 disagreements, 0 evaluable).
 * The campaign could not have concluded from those runs at any volume, which is the same "no data yet vs no
 * data possible" trap this file's own history documents.
 *
 * A card's terminal lane IS its outcome and the lane-change stream records it with a task id: `completed`
 * succeeded, `trash` did not. Any other lane is NON-TERMINAL and deliberately yields no entry — a card still
 * moving between review and in_progress has no outcome yet, and inventing one would fabricate the very
 * counterfactual the campaign exists to measure.
 */
export function buildTaskOutcomeIndexFromLaneChanges(records: readonly CardLaneChangeRecord[]): Map<string, boolean> {
	const index = new Map<string, boolean>();
	for (const record of records) {
		const taskId = typeof record.taskId === "string" && record.taskId.length > 0 ? record.taskId : null;
		if (taskId === null) {
			continue;
		}
		if (record.toLane === "completed") {
			index.set(taskId, true);
		} else if (record.toLane === "trash") {
			index.set(taskId, false);
		}
	}
	return index;
}

/**
 * Merge outcome indexes, preferring the AUTHORITATIVE scheduler-derived entry where both exist. The fallback
 * only fills gaps, so enabling it can never overwrite a durable-run verdict.
 */
export function mergeTaskOutcomeIndexes(
	authoritative: ReadonlyMap<string, boolean>,
	fallback: ReadonlyMap<string, boolean>,
): Map<string, boolean> {
	const merged = new Map(fallback);
	for (const [taskId, succeeded] of authoritative) {
		merged.set(taskId, succeeded);
	}
	return merged;
}

export function buildTaskOutcomeIndex(events: readonly SchedulerOutcomeEvent[]): Map<string, boolean> {
	const index = new Map<string, boolean>();
	for (const event of events) {
		if (event.kind !== "scheduler" || event.event !== "completed") {
			continue;
		}
		const taskId = typeof event.taskId === "string" && event.taskId.length > 0 ? event.taskId : null;
		if (taskId === null || (event.detail !== "succeeded" && event.detail !== "failed")) {
			continue;
		}
		index.set(taskId, event.detail === "succeeded");
	}
	return index;
}
