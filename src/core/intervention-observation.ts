/**
 * P20.10 — turn recorded operator interventions into the events `operator-intervention.ts` scores. PURE core.
 *
 * `computeInterventionMetrics` has existed and been correct for some time with **no consumer**, because nothing
 * emitted an intervention. The metric was built; the observation was not. This is the observation half.
 *
 * ── COVERAGE IS PART OF THE RESULT, NOT A FOOTNOTE ──
 * Only ONE severity is currently instrumented: `nudge`, emitted when a human types into a session that is
 * already running. `correction`, `takeover` and `abort` have no emission site yet.
 *
 * That makes the honest report *"0 takeovers were OBSERVED, and takeovers are not observable"* — which is a
 * completely different statement from *"0 takeovers happened"*, and the difference is the whole point of
 * P20.10. A metric that silently reports zero for an uninstrumented severity is the disengagement-report
 * mistake in miniature: a number that looks like evidence of quality and is actually evidence of nothing.
 * So `observedSeverities` is returned alongside the events and the caller is expected to print it.
 *
 * This mirrors N7c exactly, where `mustStayQuiet` reported `indeterminate` because nothing watched the signal —
 * except that here the un-watched case would produce a FLATTERING zero rather than an honest `indeterminate`,
 * which is worse. Hence the explicit coverage field.
 */

import type { InterventionEvent, InterventionSeverity } from "./operator-intervention";

/** The telemetry category every intervention emission uses. One string, so a typo cannot half-wire this. */
export const INTERVENTION_CATEGORY = "operator_intervention";

/**
 * Severities that some production code path actually emits today.
 *
 * **Add to this list only when an emission site exists** — the same rule as `OBSERVABLE_DRAIN_SIGNALS`. Listing
 * a severity here without an emitter turns "not measured" into a confident zero.
 */
export const INSTRUMENTED_SEVERITIES: readonly InterventionSeverity[] = ["nudge"];

export interface InterventionExtractionResult {
	readonly events: readonly InterventionEvent[];
	readonly instrumentedSeverities: readonly InterventionSeverity[];
	/** Severities with no emission site — their zero counts mean "unmeasured", never "did not happen". */
	readonly uninstrumentedSeverities: readonly InterventionSeverity[];
	readonly unparseableLines: number;
	readonly coverageNote: string;
}

const ALL_SEVERITIES: readonly InterventionSeverity[] = ["nudge", "correction", "takeover", "abort"];

interface TelemetryRecord {
	readonly createdAt?: unknown;
	readonly taskId?: unknown;
	readonly metadata?: {
		readonly category?: unknown;
		readonly interventionSeverity?: unknown;
		readonly humanSeconds?: unknown;
	};
}

function isSeverity(value: unknown): value is InterventionSeverity {
	return typeof value === "string" && (ALL_SEVERITIES as readonly string[]).includes(value);
}

export function extractInterventionEvents(telemetryJsonl: string): InterventionExtractionResult {
	const events: InterventionEvent[] = [];
	let unparseableLines = 0;

	for (const rawLine of telemetryJsonl.split("\n")) {
		const line = rawLine.trim();
		if (line.length === 0) {
			continue;
		}
		let record: TelemetryRecord;
		try {
			record = JSON.parse(line) as TelemetryRecord;
		} catch {
			unparseableLines += 1;
			continue;
		}
		if (record.metadata?.category !== INTERVENTION_CATEGORY) {
			continue;
		}
		const severity = record.metadata?.interventionSeverity;
		const taskId = record.taskId;
		const at = record.createdAt;
		// A malformed intervention record is skipped rather than defaulted. Defaulting severity would invent the
		// very classification the taxonomy exists to record, and a wrong severity is worse than a missing event:
		// it moves a number the go/no-go decision reads.
		if (!isSeverity(severity) || typeof taskId !== "string" || typeof at !== "number") {
			continue;
		}
		events.push({
			taskId,
			severity,
			// Human time is MEASURED or null — never estimated afterwards. `operator-intervention.ts` counts the
			// nulls separately so the total is never read as complete.
			humanSeconds: typeof record.metadata?.humanSeconds === "number" ? record.metadata.humanSeconds : null,
			at,
		});
	}

	const uninstrumented = ALL_SEVERITIES.filter((severity) => !INSTRUMENTED_SEVERITIES.includes(severity));
	return {
		events,
		instrumentedSeverities: INSTRUMENTED_SEVERITIES,
		uninstrumentedSeverities: uninstrumented,
		unparseableLines,
		coverageNote:
			uninstrumented.length === 0
				? "All four severities have an emission site."
				: `⚠️ ONLY ${INSTRUMENTED_SEVERITIES.join(", ")} is instrumented. ${uninstrumented.join(", ")} have NO emission site, so their counts read 0 because nothing measures them — NOT because they did not happen. Do not quote a total or a per-task ratio as if it covered all four.`,
	};
}
