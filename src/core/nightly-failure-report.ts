/**
 * N7 — the nightly FAILURE REPORT contract: "debuggable from the summary alone". PURE core.
 *
 * A nightly suite that runs unattended is only worth having if a failure can be acted on the next morning without
 * re-running it. Re-running is exactly what is often impossible: the run took hours, the failure was intermittent,
 * and the state that caused it is gone. So the report is not a courtesy — **it is the only artifact that survives**,
 * and a report missing one field can cost the entire run.
 *
 * N7 names three things a failure must carry: the cell id, the seed, and the HOME path kept on failure. This module
 * builds that report and, more importantly, REFUSES to call an incomplete one debuggable.
 *
 * ── THE FAILURE MODE THIS IS SHAPED AGAINST: "RETAINED" THAT DID NOT RETAIN ──
 * The worst possible report is not an absent one. It is a report that SAYS the HOME directory was kept and gives a
 * path that is empty, or says "retained" with no path at all. An absent report sends someone to re-run; a false one
 * sends them to a directory that explains nothing, and they conclude the bug is unreproducible rather than that the
 * evidence was never saved. **A lie about evidence is worse than no evidence**, so `retained: true` with a blank
 * path is reported as a CONTRADICTION rather than quietly downgraded to "not retained".
 *
 * Same reasoning as N5's `indeterminate`: "we could not tell" and "it was fine" are different claims. Here: "the
 * state was not kept" and "the state was kept, here it is" are different claims, and the middle case — claiming the
 * first while delivering the second — must be loud.
 */

import type { PackResult } from "./nightly-invariant-pack";

export interface NightlyFailureInput {
	readonly cellId: string;
	/** The seed that drove this cell. Without it the failure cannot be re-run deterministically. */
	readonly seed: string | null;
	/** Where the cell's HOME was preserved. Null when nothing was kept. */
	readonly homePath: string | null;
	/** What the runner BELIEVES about retention — checked against `homePath` rather than trusted. */
	readonly homeRetained: boolean;
	/** The invariant-pack verdict, when one ran. Null when the cell died before evaluation. */
	readonly packResult: PackResult | null;
	/** Terminal error, when the cell crashed rather than failing an assertion. */
	readonly error?: string | null;
	readonly durationMs?: number | null;
}

export type ReportDefect =
	| "missing_cell_id"
	| "missing_seed"
	| "retention_contradiction"
	| "no_failure_evidence"
	| "home_not_retained";

export interface FailureReport {
	readonly cellId: string;
	readonly lines: readonly string[];
	readonly defects: readonly ReportDefect[];
	/** True only when the report carries everything needed to act without re-running the suite. */
	readonly debuggable: boolean;
	readonly text: string;
}

/**
 * Build the report and assess it against the contract.
 *
 * `debuggable` is deliberately strict. A soft "mostly debuggable" would be read as "fine" at 9am by someone
 * skimming, which defeats the point of measuring it at all.
 */
export function buildNightlyFailureReport(input: NightlyFailureInput): FailureReport {
	const defects: ReportDefect[] = [];
	const lines: string[] = [];

	const cellId = input.cellId.trim();
	if (cellId.length === 0) {
		defects.push("missing_cell_id");
	}
	lines.push(`cell: ${cellId.length > 0 ? cellId : "<UNNAMED — the failure cannot be located>"}`);

	const seed = input.seed?.trim() ?? "";
	if (seed.length === 0) {
		defects.push("missing_seed");
		lines.push("seed: <MISSING — this failure cannot be re-run deterministically>");
	} else {
		lines.push(`seed: ${seed}`);
	}

	const homePath = input.homePath?.trim() ?? "";
	if (input.homeRetained && homePath.length === 0) {
		// The dangerous case: the report claims evidence exists and cannot say where.
		defects.push("retention_contradiction");
		lines.push(
			"home: CLAIMED RETAINED BUT NO PATH — do not trust this; the state was probably discarded. Treat as lost evidence, not as a path you failed to find.",
		);
	} else if (!input.homeRetained) {
		defects.push("home_not_retained");
		lines.push("home: NOT retained — the failing state is gone; only this summary survives.");
	} else {
		lines.push(`home: ${homePath}`);
	}

	if (input.packResult) {
		lines.push(`verdict: ${input.packResult.summary}`);
	}
	if (input.error && input.error.trim().length > 0) {
		lines.push(`error: ${input.error.trim()}`);
	}
	if (!input.packResult && !(input.error && input.error.trim().length > 0)) {
		// Neither an assertion verdict nor a crash: the report records that something failed without saying what.
		defects.push("no_failure_evidence");
		lines.push("evidence: <NONE — the cell is marked failed but carries neither a pack verdict nor an error>");
	}
	if (typeof input.durationMs === "number" && Number.isFinite(input.durationMs)) {
		lines.push(`duration: ${Math.round(input.durationMs)}ms`);
	}

	// `home_not_retained` alone does not make a report undebuggable — a pack verdict plus a seed is often enough,
	// and demanding retained state for every failure would make the bar unreachable. A CONTRADICTION does, because
	// it actively misleads.
	const blocking = defects.filter((defect) => defect !== "home_not_retained");
	const debuggable = blocking.length === 0;

	if (!debuggable) {
		lines.push(`⚠️ NOT DEBUGGABLE FROM THIS SUMMARY: ${blocking.join(", ")}`);
	}

	return { cellId, lines, defects, debuggable, text: lines.join("\n") };
}

export interface SuiteFailureSummary {
	readonly reports: readonly FailureReport[];
	readonly undebuggable: readonly FailureReport[];
	readonly text: string;
}

/**
 * Summarise a whole nightly run's failures.
 *
 * Undebuggable reports are surfaced SEPARATELY and first. A run with 12 failures where 3 cannot be investigated has
 * two problems, and the second one compounds every future run — it will keep costing mornings until it is fixed,
 * while the 12 are merely today's work.
 */
export function summarizeNightlyFailures(reports: readonly FailureReport[]): SuiteFailureSummary {
	const undebuggable = reports.filter((report) => !report.debuggable);
	const header =
		reports.length === 0
			? "No failing cells."
			: undebuggable.length === 0
				? `${reports.length} failing cell(s); all are debuggable from this summary.`
				: `${reports.length} failing cell(s), of which ${undebuggable.length} CANNOT be investigated from this summary — fix the reporting first, or these will cost a morning every run.`;

	return {
		reports,
		undebuggable,
		text: [header, "", ...reports.map((report) => report.text)].join("\n"),
	};
}
