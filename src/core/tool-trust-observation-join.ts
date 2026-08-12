/**
 * P15.3 mechanism #3 — join the tool-trust-decay observation stream (F12.24) to card outcomes for the P15.2
 * decision core. PURE. Same honesty rules as the gate and remedy joins.
 *
 * The stream is a true SHADOW record: tier transitions are recorded UNCONDITIONALLY (the decay computation runs
 * from tool-error history already in memory), while `NKLEIN_TOOL_TRUST_DECAY` gates only the EFFECT (guidance
 * injection + withholding dropped tools). Each record's `enforced` field says which world it was recorded in,
 * so `actual` never has to be guessed:
 *
 *   enforced=false → the mechanism recommended demote/withhold and the system kept offering everything.
 *   enforced=true  → the recommendation was applied (guidance queued; dropped tools withheld).
 *
 * Legacy records predate the `enforced` field; their world is unknowable, and guessing either way would
 * manufacture agreement or disagreement — they are counted as unusable, the same rule as an unknown remedy.
 */

import type { MechanismObservation } from "./mechanism-decision-report";
import { resolveOutcomeForObservation } from "./observation-outcome-bridge";

export interface ToolTrustObservationRecord {
	readonly taskId: string | null;
	readonly tool: string | null;
	/** The tier the tool transitioned to ("demoted" | "dropped" — "trusted" transitions are not recorded). */
	readonly tier: string | null;
	/** Whether the enforcement flag was ON at record time; null on legacy records (unusable). */
	readonly enforced: boolean | null;
}

/** Pull the join fields out of a `tool_trust_decay` self-observation. */
export function toToolTrustRecord(event: {
	readonly taskId?: string | null;
	readonly metadata?: Record<string, unknown> | undefined;
}): ToolTrustObservationRecord {
	const metadata = event.metadata ?? {};
	return {
		taskId: typeof event.taskId === "string" && event.taskId.length > 0 ? event.taskId : null,
		tool: typeof metadata.tool === "string" && metadata.tool.length > 0 ? metadata.tool : null,
		tier: typeof metadata.tier === "string" && metadata.tier.length > 0 ? metadata.tier : null,
		enforced: typeof metadata.enforced === "boolean" ? metadata.enforced : null,
	};
}

export interface ToolTrustJoinReport {
	readonly observations: readonly MechanismObservation[];
	readonly unusableRecords: number;
	readonly unjoinedOutcomes: number;
	readonly summary: string;
}

export function joinToolTrustObservations(input: {
	readonly records: readonly ToolTrustObservationRecord[];
	readonly outcomeByTaskId: ReadonlyMap<string, boolean>;
}): ToolTrustJoinReport {
	const observations: MechanismObservation[] = [];
	let unusableRecords = 0;
	let unjoinedOutcomes = 0;

	for (const record of input.records) {
		// A record that cannot name the recommendation, or whose world (enforced?) is unknown, is unusable —
		// counting it either way invents the answer the campaign exists to find.
		if (
			record.tool === null ||
			(record.tier !== "demoted" && record.tier !== "dropped") ||
			record.enforced === null
		) {
			unusableRecords += 1;
			continue;
		}
		// Session/card id namespace bridge (audit 2026-08-12): records emit under SESSION ids (`<cardId>-<ts>-<rand>`,
		// `<cardId>::review`) while outcomes key on CARD ids — the shared bridge joins them; exact `.get` never did.
		const outcome =
			record.taskId === null ? undefined : resolveOutcomeForObservation(record.taskId, input.outcomeByTaskId);
		if (outcome === undefined) {
			unjoinedOutcomes += 1;
		}
		const recommended = record.tier === "dropped" ? "withhold_tool" : "demote_tool";
		observations.push({
			recommended,
			actual: record.enforced ? recommended : "kept_offering",
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
			`${observations.length} trust-decay observation(s): ${disagreements} unapplied recommendation(s), ` +
			`${evaluable} of those with a known card outcome; ` +
			`${unusableRecords} unusable record(s), ${unjoinedOutcomes} without a ledger outcome.`,
	};
}
