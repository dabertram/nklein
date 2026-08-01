/**
 * P21.1 step 1 — per-model EDIT RELIABILITY from the existing ledger. PURE core.
 *
 * ── WHY THIS MATTERS ──
 * Aider's leaderboard shows **Qwen2.5-Coder-32B at 16.4% with `whole` format vs 8.0% with `diff`** — a 2× swing
 * from edit format alone, on exactly !Klein's target model class. Aider tracks edit-format correctness as its own
 * metric; !Klein does not. The routing payoff (weak model → whole-file edits) needs a measured signal first.
 *
 * ── ⚠️ WHAT THIS IS NOT, AND THE NAME IS DELIBERATE ──
 * **This is NOT Aider's "correct edit format %".** The ledger records each tool call's outcome as success/error
 * from the `tool_result`'s `is_error` flag, which lumps a malformed-diff-FORMAT failure together with a
 * context-mismatch, a file-not-found, and a permission error. So this measures *"this model struggles to edit"*,
 * **not** *"this model struggles with DIFF format specifically"* — and only the second would justify switching a
 * model to whole-file edits. Format-specific attribution needs the apply site to tag the failure KIND (P21.1
 * step 2). Calling this "edit format correctness" would be a number that looks like the thing it is not.
 *
 * ── THE TWO WAYS THIS METRIC COULD LIE, BOTH CLOSED ──
 * **(1) An UNKNOWN outcome is not a success.** `outcome` is nullable and the schema says so — *"absent on legacy
 * lines"*. The obvious implementation, `outcome !== "error"`, silently counts every legacy and unrecorded call as
 * a success, and reports near-perfect reliability for a model whose data simply predates the field. Unknowns are
 * excluded from the denominator and reported separately, so a mostly-unknown model reads as unmeasured rather
 * than as excellent.
 *
 * **(2) A rate from a handful of calls is noise.** Below {@link MIN_EDIT_CALLS_FOR_RATE} classified calls the row
 * reports `insufficient_data` and a NULL rate rather than a confident-looking fraction — the same
 * absence-of-evidence rule `mechanism-decision-report` and `null-agent-baseline` already follow.
 *
 * ── WHY IT RANKS INSTEAD OF JUDGING ──
 * There is no absolute "unreliable" threshold here, deliberately. No measurement in this project establishes one,
 * and an invented cutoff would decide model routing on a number nobody derived. P21.1's actual use — *route the
 * WEAK models to whole-file* — is a comparison, and a comparison needs no absolute. Rows come back worst-first;
 * choosing how far down that list to act is a policy decision made with the rates visible.
 */

import { classifyEditFailure, isEditFormatSkillFailure } from "./edit-failure-kind";
import { isAttributableModelKey } from "./model-identity";

/** Edit-class tools as registered today. Overridable, because tool names drift and a stale list silently measures nothing. */
export const DEFAULT_EDIT_TOOL_NAMES: readonly string[] = [
	"apply_patch",
	"edit_file",
	"editor",
	"write_file",
	"write_files",
];

/**
 * Classified edit calls needed before a rate is reported.
 *
 * OPERATIONAL DEFAULT, not measured — set where a single bad call cannot move the rate by more than a few points.
 */
export const MIN_EDIT_CALLS_FOR_RATE = 20;

/** The slice of a ledger attempt this core needs. */
export interface EditReliabilityAttempt {
	readonly modelId: string;
	readonly toolCalls: readonly {
		readonly name: string;
		readonly outcome: string | null;
		/**
		 * P21.1 step 2: the tool result's bounded preview. Already captured for EVERY result including errors, so
		 * the FORMAT-specific rate needs no new instrumentation — verified on the live ledger, which carries
		 * `Blocked edit_file: edit block 2 did not match …`. Absent on legacy lines.
		 */
		readonly resultSummary?: string | null;
	}[];
}

export interface EditReliabilityRow {
	readonly modelId: string;
	/** Calls whose outcome was recorded as success or error — the rate's denominator. */
	readonly classifiedCalls: number;
	readonly successes: number;
	readonly errors: number;
	/** Calls with no recorded outcome. EXCLUDED from the rate; a high count means unmeasured, not healthy. */
	readonly unknownOutcome: number;
	/** successes / classifiedCalls, or null below the floor. */
	readonly reliability: number | null;
	readonly verdict: "measured" | "insufficient_data";
	/**
	 * P21.1 step 2 — errors attributable to edit FORMAT (a search block that did not match), as opposed to the six
	 * guard/environment refusals. This is the number Aider's 2x whole-vs-diff swing is about; `errors` alone is a
	 * proxy for "struggles to edit" and would be moved by whichever guard happens to fire most.
	 */
	readonly formatFailures: number;
}

export interface EditReliabilityReport {
	/**
	 * Attempts whose model could not be resolved, EXCLUDED from every row above.
	 *
	 * These are historical: the ledger door now refuses them ({@link ../state/agent-attempt-ledger-store}), but
	 * 70 of 238 attempts on the live ledger predate that fix and carry 1074 tool calls belonging to other models.
	 * Reported as a data-quality figure rather than folded into a `unknown` row, because a phantom model with a
	 * plausible success rate is worse than a visible gap.
	 */
	readonly unattributableAttempts: number;
	/** Models with enough data, WORST FIRST — the order P21.1's routing half would walk. */
	readonly ranked: readonly EditReliabilityRow[];
	/** Models seen but not measurable yet. Kept separate so "no data" is never mistaken for "no problem". */
	readonly unmeasured: readonly EditReliabilityRow[];
	readonly summary: string;
}

export function computeEditReliability(input: {
	readonly attempts: readonly EditReliabilityAttempt[];
	readonly editToolNames?: readonly string[];
	readonly minCalls?: number;
}): EditReliabilityReport {
	const editTools = new Set(input.editToolNames ?? DEFAULT_EDIT_TOOL_NAMES);
	const minCalls = input.minCalls ?? MIN_EDIT_CALLS_FOR_RATE;
	const byModel = new Map<string, { successes: number; errors: number; unknown: number }>();
	// P21.1 step 2 — the FORMAT cut, kept beside the coarse rate rather than replacing it. Six of the edit tool's
	// seven refusals are guards or environment and say nothing about a model's edit-format skill; only a
	// context mismatch does. See `edit-failure-kind.ts`.
	const formatFailuresByModel = new Map<string, number>();
	let unattributableAttempts = 0;

	for (const attempt of input.attempts) {
		// A key whose model segment is the `unknown` sentinel names NO model. Folding it into a row would create a
		// phantom competitor in a ranking that decides model routing.
		if (!isAttributableModelKey(attempt.modelId)) {
			unattributableAttempts += 1;
			continue;
		}
		for (const call of attempt.toolCalls) {
			if (!editTools.has(call.name)) {
				continue;
			}
			const bucket = byModel.get(attempt.modelId) ?? { successes: 0, errors: 0, unknown: 0 };
			// Positively classify BOTH sides and treat everything else as unknown. A `!== "error"` test would fold
			// nulls and unrecognised strings into the success count and report a model as near-perfect on the
			// strength of data that was never recorded.
			if (call.outcome === "success") {
				bucket.successes += 1;
			} else if (call.outcome === "error") {
				bucket.errors += 1;
				if (isEditFormatSkillFailure(classifyEditFailure(call.resultSummary))) {
					formatFailuresByModel.set(attempt.modelId, (formatFailuresByModel.get(attempt.modelId) ?? 0) + 1);
				}
			} else {
				bucket.unknown += 1;
			}
			byModel.set(attempt.modelId, bucket);
		}
	}

	const rows: EditReliabilityRow[] = [...byModel.entries()]
		.map(([modelId, counts]) => {
			const classifiedCalls = counts.successes + counts.errors;
			const measured = classifiedCalls >= minCalls;
			return {
				modelId,
				classifiedCalls,
				successes: counts.successes,
				errors: counts.errors,
				unknownOutcome: counts.unknown,
				reliability: measured ? counts.successes / classifiedCalls : null,
				verdict: measured ? ("measured" as const) : ("insufficient_data" as const),
				formatFailures: formatFailuresByModel.get(modelId) ?? 0,
			};
		})
		// Stable, deterministic order before partitioning, so equal rates never shuffle between runs.
		.sort((left, right) => left.modelId.localeCompare(right.modelId));

	const ranked = rows
		.filter((row) => row.verdict === "measured")
		.sort(
			(left, right) =>
				(left.reliability ?? 0) - (right.reliability ?? 0) || left.modelId.localeCompare(right.modelId),
		);
	const unmeasured = rows.filter((row) => row.verdict === "insufficient_data");

	const worst = ranked[0];
	const unattributableNote =
		unattributableAttempts > 0
			? ` ⚠️ ${unattributableAttempts} attempt(s) named no model and were EXCLUDED — their tool calls belong to models that are not being credited for them`
			: "";
	return {
		ranked,
		unmeasured,
		unattributableAttempts,
		summary:
			ranked.length === 0
				? `no model has ${minCalls}+ classified edit calls yet — ${unmeasured.length} model(s) seen but unmeasured. This is NOT evidence that editing is reliable${unattributableNote}`
				: `${ranked.length} model(s) measured; weakest is ${worst?.modelId} at ${((worst?.reliability ?? 0) * 100).toFixed(1)}% of ${worst?.classifiedCalls} edit calls` +
					(unmeasured.length > 0 ? `; ${unmeasured.length} more seen but below the ${minCalls}-call floor` : "") +
					". Measures 'struggles to EDIT', not 'struggles with DIFF FORMAT' — the ledger cannot tell those apart" +
					unattributableNote,
	};
}
