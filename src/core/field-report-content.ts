/**
 * P16.1 — the Field Report CONTENT MODEL. PURE core.
 *
 * A Field Report lets a user send !Klein's maintainer evidence from their own machine. David's non-negotiables
 * (2026-07-20): never automatic, fully reviewable before it exists, generated locally, **privacy by construction
 * rather than by promise**, and transport decided last.
 *
 * ── WHY THE LAYER IS A TYPE, NOT A FLAG ──
 * "Privacy by construction" has to mean something a reviewer can check. If layers were a runtime boolean, a
 * Layer-C verbatim excerpt could reach a Layer-A structural report through one mistaken assignment, and the bug
 * would be invisible in review — the data would simply be there. So each field carries its layer in the TYPE,
 * and {@link buildFieldReport} accepts only fields at or below the consented layer. **A Layer-C field cannot be
 * placed into a Layer-A report because the compiler refuses it**, not because a check happened to run.
 *
 * The three layers, in ascending disclosure:
 *  - **A — structural/behavioural** (default ON): what the harness DID. Counts, outcomes, model CLASS and size
 *    band, which mechanisms fired, where cards stalled, wall-clock, hardware shape. **No project content.**
 *  - **B — redacted narrative** (default OFF, per-item opt-in): model-written prose about a pattern, with
 *    identifiers replaced by stable placeholders.
 *  - **C — verbatim excerpt** (default OFF, explicit per item): actual prompt/diff/error text.
 *
 * Honesty stance: a report states which layers were INCLUDED and which were withheld. A reader must be able to
 * tell "there were no Layer-C findings" from "Layer C was declined" — collapsing those makes an incomplete
 * report look complete.
 */

export type DisclosureLayer = "A" | "B" | "C";

/** Ascending disclosure order — the only place the layer ranking is defined. */
const LAYER_RANK: Readonly<Record<DisclosureLayer, number>> = { A: 0, B: 1, C: 2 };

/**
 * A single report field, branded with its disclosure layer. The layer is a TYPE PARAMETER so a Layer-C value
 * cannot be assigned where a Layer-A value is required.
 */
export interface ReportField<L extends DisclosureLayer = DisclosureLayer> {
	readonly layer: L;
	readonly key: string;
	readonly value: string;
	/** What this field reveals, shown to the user in the review surface BEFORE they consent. */
	readonly reveals: string;
}

/** Constructors — the only supported way to make a field, so the layer is never guessed. */
export function structuralField(key: string, value: string, reveals: string): ReportField<"A"> {
	return { layer: "A", key, value, reveals };
}
export function narrativeField(key: string, value: string, reveals: string): ReportField<"B"> {
	return { layer: "B", key, value, reveals };
}
export function verbatimField(key: string, value: string, reveals: string): ReportField<"C"> {
	return { layer: "C", key, value, reveals };
}

export interface FieldReportConsent {
	/** The highest layer the user consented to. Layer A alone is the default. */
	readonly maxLayer: DisclosureLayer;
	/**
	 * Keys the user explicitly approved at a layer ABOVE `maxLayer`. Per-item consent is the point: the user
	 * approves individual findings, not a blanket disclosure level.
	 */
	readonly approvedKeys?: readonly string[];
}

export interface FieldReport {
	readonly included: readonly ReportField[];
	/** Fields withheld, with the reason — so the report can state what it is NOT showing. */
	readonly withheld: readonly { readonly key: string; readonly layer: DisclosureLayer; readonly reason: string }[];
	readonly layersIncluded: readonly DisclosureLayer[];
	/** Human-readable disclosure statement. Never omitted, even when nothing was withheld. */
	readonly disclosure: string;
}

/**
 * Assemble a report from candidate fields under a consent decision.
 *
 * A field above the consented layer is INCLUDED ONLY if the user approved that specific key. Everything else is
 * withheld WITH ITS REASON — silently dropping it would leave the user believing they had seen the whole report.
 */
export function buildFieldReport(candidates: readonly ReportField[], consent: FieldReportConsent): FieldReport {
	const approved = new Set(consent.approvedKeys ?? []);
	const maxRank = LAYER_RANK[consent.maxLayer];
	const included: ReportField[] = [];
	const withheld: { key: string; layer: DisclosureLayer; reason: string }[] = [];

	for (const field of candidates) {
		if (LAYER_RANK[field.layer] <= maxRank) {
			included.push(field);
			continue;
		}
		if (approved.has(field.key)) {
			included.push(field);
			continue;
		}
		withheld.push({
			key: field.key,
			layer: field.layer,
			reason: `layer ${field.layer} exceeds the consented layer ${consent.maxLayer} and this key was not individually approved`,
		});
	}

	const layersIncluded = [...new Set(included.map((field) => field.layer))].sort(
		(left, right) => LAYER_RANK[left] - LAYER_RANK[right],
	);

	// The disclosure must distinguish "no findings at this layer" from "this layer was declined" — a reader who
	// cannot tell those apart will read an incomplete report as a complete one.
	const declined = [...new Set(withheld.map((field) => field.layer))].sort(
		(left, right) => LAYER_RANK[left] - LAYER_RANK[right],
	);
	const disclosure = [
		`This report includes layer(s): ${layersIncluded.length > 0 ? layersIncluded.join(", ") : "(none)"}.`,
		declined.length > 0
			? `${withheld.length} field(s) at layer(s) ${declined.join(", ")} were WITHHELD — they exist but were not consented to. This report is therefore incomplete by your choice, not empty.`
			: "No fields were withheld: everything generated is shown.",
	].join(" ");

	return { included, withheld, layersIncluded, disclosure };
}

/**
 * The review surface's payload: exactly what would leave the machine, per field, so the user reviews BYTES and
 * not a description of them (P16.3). Returned as data rather than rendered text so the caller cannot accidentally
 * show a prettified version that differs from what is sent.
 */
export function renderReviewPayload(
	report: FieldReport,
): readonly { key: string; layer: DisclosureLayer; bytes: string; reveals: string }[] {
	return report.included.map((field) => ({
		key: field.key,
		layer: field.layer,
		bytes: field.value,
		reveals: field.reveals,
	}));
}
