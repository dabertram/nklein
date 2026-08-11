/**
 * P18.4b — join the off-track remedy's observation stream to card outcomes, producing the
 * `MechanismObservation[]` the P15.2 decision core consumes. PURE.
 *
 * Same shape and honesty rules as `tool-gate-observation-join` (the one existing feed): a record that cannot
 * say what the mechanism recommended is UNUSABLE and counted as such — treating it as agreement would dilute
 * the disagreement rate toward zero and steer the verdict toward `no_op`, which ends in deletion. A record
 * whose task has no ledger outcome joins with `succeeded: null` (counted, not evaluable).
 *
 * ── WHAT `actual` MEANS HERE, AND WHEN IT MUST CHANGE ──
 * The remedy is OBSERVE-ONLY today: whatever the ladder recommends, the live system CONTINUES the session
 * (with the SDK's unconditional pressure-triggered compaction). So `actual` is the constant "continue" — that
 * is a faithful record of current behaviour, not a placeholder. THE ACTING HALF MUST NOT KEEP THIS CONSTANT:
 * once a remedy can be applied, `actual` must come from what was actually done, or every applied remedy would
 * be recorded as a disagreement with itself and the decision stream would poison the very gate that authorised
 * it.
 */

import type { MechanismObservation } from "./mechanism-decision-report";
import type { OffTrackRemedy } from "./off-track-intervention";

/** What the live system does with a drifting card today, regardless of the recorded recommendation. */
export const OFF_TRACK_ACTUAL_TODAY = "continue";

const KNOWN_REMEDIES: ReadonlySet<string> = new Set([
	"continue",
	"compact_and_continue",
	"restart_with_restatement",
	"park",
] satisfies OffTrackRemedy[]);

/** The fields the join needs from one `off_track_remedy_observed` self-observation. */
export interface OffTrackRemedyObservationRecord {
	readonly taskId: string | null;
	readonly remedy: string | null;
	/** What was actually DONE (the acting half stamps this); absent/legacy records mean "continue". */
	readonly actual: string | null;
}

/** Pull the join fields out of a self-observation event (top-level taskId + metadata.remedy/actualAction). */
export function toOffTrackRemedyRecord(event: {
	readonly taskId?: string | null;
	readonly metadata?: Record<string, unknown> | undefined;
}): OffTrackRemedyObservationRecord {
	const remedy = event.metadata?.remedy;
	const actual = event.metadata?.actualAction;
	return {
		taskId: typeof event.taskId === "string" && event.taskId.length > 0 ? event.taskId : null,
		remedy: typeof remedy === "string" && remedy.length > 0 ? remedy : null,
		actual: typeof actual === "string" && actual.length > 0 ? actual : null,
	};
}

export interface OffTrackRemedyJoinReport {
	readonly observations: readonly MechanismObservation[];
	/** Records with no usable remedy value — they cannot say what the mechanism recommended. */
	readonly unusableRecords: number;
	/** Records whose task has no ledger outcome (joined with succeeded: null). */
	readonly unjoinedOutcomes: number;
	readonly summary: string;
}

export function joinOffTrackRemedyObservations(input: {
	readonly records: readonly OffTrackRemedyObservationRecord[];
	readonly outcomeByTaskId: ReadonlyMap<string, boolean>;
}): OffTrackRemedyJoinReport {
	const observations: MechanismObservation[] = [];
	let unusableRecords = 0;
	let unjoinedOutcomes = 0;

	for (const record of input.records) {
		// An unknown remedy string is unusable, not "some disagreement": a typo'd or future value must surface
		// as a data problem rather than silently count toward either side of the verdict.
		if (record.remedy === null || !KNOWN_REMEDIES.has(record.remedy)) {
			unusableRecords += 1;
			continue;
		}
		const outcome = record.taskId === null ? undefined : input.outcomeByTaskId.get(record.taskId);
		if (outcome === undefined) {
			unjoinedOutcomes += 1;
		}
		observations.push({
			recommended: record.remedy,
			// The acting half stamps what was DONE; legacy/observe-only records carry the faithful constant.
			actual: record.actual ?? OFF_TRACK_ACTUAL_TODAY,
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
			`${observations.length} remedy observation(s): ${disagreements} recommending something other than ` +
			`continue, ${evaluable} of those with a known card outcome; ` +
			`${unusableRecords} unusable record(s), ${unjoinedOutcomes} without a ledger outcome.`,
	};
}
