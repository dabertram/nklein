/**
 * P16.7b — Layer A/C candidate ASSEMBLY: recorded self-observations → report fields. PURE core.
 *
 * This is the missing effect-free half of the field-report seam: everything downstream (consent projection,
 * hidden-character detection, the draft renderer) shipped as pure cores in P16.1–P16.7, but nothing turned REAL
 * telemetry into candidate fields — so the review UI would have had nothing honest to show. The runtime hands
 * this module the observation records it already keeps; the module does arithmetic and nothing else.
 *
 * ── LAYER DISCIPLINE (the load-bearing part) ──
 * Layer A fields are COUNTS OVER ENUMS, never free text. An observation's `message` can name the user's project,
 * paths, or failing commands — so message content is categorically excluded from Layer A, not merely redacted.
 * The only free text that appears at all is the Layer C verbatim excerpts, and those pass through the P16.4
 * redaction engine BEFORE they become candidates (the pipeline order the adversarial acceptance pins:
 * grounding → redaction → consent → transport). Layer B (narrative) does not exist until P16.6b wires the model
 * call — this module deliberately produces none rather than fabricating prose from a template.
 *
 * The input is a structural view of `SelfObservationEventRecord` (duck-typed, not imported) so the core layer
 * does not grow a dependency on the telemetry layer.
 */

import { type ReportField, structuralField, verbatimField } from "./field-report-content";
import { redactForFieldReport } from "./field-report-redaction";
import type { ReviewItem } from "./field-report-transport";

/** Structural view of a recorded self-observation — the fields aggregation is allowed to see. */
export interface ObservationForAssembly {
	readonly signal: string;
	readonly severity: string;
	readonly message: string;
	readonly modelId?: string | null;
	readonly metadata?: Record<string, unknown>;
	readonly createdAt: number;
}

/** Verbatim excerpts offered as Layer C candidates. Few and recent — a report, not a log export. */
const VERBATIM_EXCERPT_LIMIT = 5;
/** Mechanism categories listed in the fired-mechanisms field. Beyond this the tail is summed, not dropped silently. */
const MECHANISM_CATEGORY_LIMIT = 10;

function countBy<T>(items: readonly T[], keyOf: (item: T) => string | null): Map<string, number> {
	const counts = new Map<string, number>();
	for (const item of items) {
		const key = keyOf(item);
		if (key === null) {
			continue;
		}
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return counts;
}

/** Render a count map as stable text: descending count, then name — so identical telemetry yields identical bytes. */
function formatCounts(counts: Map<string, number>): string {
	return [...counts.entries()]
		.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
		.map(([name, count]) => `${name}: ${count}`)
		.join("\n");
}

/**
 * Aggregate observations into candidate report fields.
 *
 * Always returns at least one Layer A field, even for zero observations — `checkLayerAAlwaysProducible` treats an
 * empty Layer A as a telemetry defect, and "0 observations recorded" is itself a true, useful report.
 */
export function assembleFieldReportCandidates(events: readonly ObservationForAssembly[]): ReportField[] {
	const fields: ReportField[] = [];

	const spanText =
		events.length === 0
			? "0 observations recorded"
			: (() => {
					const oldest = Math.min(...events.map((event) => event.createdAt));
					const newest = Math.max(...events.map((event) => event.createdAt));
					const spanDays = Math.max(1, Math.ceil((newest - oldest) / (24 * 60 * 60 * 1000)));
					return `${events.length} observations over ${spanDays} day(s)`;
				})();
	fields.push(
		structuralField(
			"observations.count",
			spanText,
			"how much telemetry exists and its time span — counts only, no content",
		),
	);

	if (events.length > 0) {
		fields.push(
			structuralField(
				"observations.by_severity",
				formatCounts(countBy(events, (event) => event.severity)),
				"the severity mix of recorded events — counts only",
			),
			structuralField(
				"observations.by_signal",
				formatCounts(countBy(events, (event) => event.signal)),
				"which kinds of events occurred (error/timeout/verification classes) — counts only",
			),
		);

		const mechanismCounts = countBy(events, (event) => {
			const category = event.metadata?.category;
			return typeof category === "string" && category.length > 0 ? category : null;
		});
		if (mechanismCounts.size > 0) {
			const ranked = [...mechanismCounts.entries()].sort(
				(left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
			);
			const head = ranked.slice(0, MECHANISM_CATEGORY_LIMIT);
			const tailTotal = ranked.slice(MECHANISM_CATEGORY_LIMIT).reduce((sum, [, count]) => sum + count, 0);
			const lines = head.map(([name, count]) => `${name}: ${count}`);
			if (tailTotal > 0) {
				// A silent top-N cap would present a partial list as the whole story.
				lines.push(`(+${ranked.length - MECHANISM_CATEGORY_LIMIT} more categories, ${tailTotal} events)`);
			}
			fields.push(
				structuralField(
					"mechanisms.fired",
					lines.join("\n"),
					"which !Klein mechanisms fired and how often — mechanism names are !Klein's, not yours",
				),
			);
		}

		const distinctModels = new Set(
			events.map((event) => event.modelId).filter((modelId): modelId is string => Boolean(modelId)),
		);
		if (distinctModels.size > 0) {
			// The COUNT of models is arithmetic; the model IDS are not — an id can reveal what the user runs
			// locally, so ids are Layer C material and only the count appears here.
			fields.push(
				structuralField(
					"models.distinct_count",
					`${distinctModels.size} distinct local model(s) produced observations`,
					"how many different local models were involved — not which ones",
				),
			);
		}

		const excerpts = events
			.filter((event) => event.severity === "warning" || event.severity === "error")
			.sort((left, right) => right.createdAt - left.createdAt)
			.slice(0, VERBATIM_EXCERPT_LIMIT);
		for (const [index, event] of excerpts.entries()) {
			const redacted = redactForFieldReport(event.message).text;
			fields.push(
				verbatimField(
					`verbatim.${event.signal}.${index + 1}`,
					redacted,
					"the exact (redacted) text of a recorded warning/error — may describe your project's failures",
				),
			);
		}
	}

	return fields;
}

/**
 * Default review items over a rendered payload: Layer A starts included, everything above starts EXCLUDED.
 * This is `ReviewItem`'s documented default made testable in one place instead of re-derived by each caller.
 */
export function defaultReviewItems(
	payload: readonly { key: string; layer: "A" | "B" | "C"; bytes: string; reveals: string }[],
): ReviewItem[] {
	return payload.map((entry) => ({
		key: entry.key,
		layer: entry.layer,
		bytes: entry.bytes,
		reveals: entry.reveals,
		included: entry.layer === "A",
	}));
}
