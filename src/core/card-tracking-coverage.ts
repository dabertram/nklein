/**
 * N18 — the CARD TRACKING COVERAGE CONTRACT. PURE core.
 *
 * David, 2026-07-20: *"!Klein shall always track every detail … a full picture of any activity, state
 * change/transition, attempted activity, and all the results. everything that happens on a project shall be
 * tracked precisely."*
 *
 * ── WHY A COVERAGE TABLE COMES BEFORE MORE EMISSION ──
 * "We track everything" is unfalsifiable, and this project has now been bitten three times in one day by tools
 * that reported coverage they did not have (`dev requirement-coverage` auditing its own map; N5's vacuous
 * `terminal_lanes`; N7c's `mustStayQuiet`, which could not pass at all). Each looked fine while running.
 *
 * **A trail's failure mode is silence, and silence is indistinguishable from "nothing happened".** So the first
 * deliverable is not more events — it is an enumerated list of what CAN happen to a card, each entry naming the
 * source that records it and an `emitterToken` that must literally appear in the codebase. `verifyTrackingCoverage`
 * checks those tokens against real file contents, so **a claim in this table cannot outlive its emitter.**
 *
 * An entry marked `untracked` is a promise, not a defect report — it is the backlog for this epic, in the one
 * place that is checked automatically.
 */

/** Telemetry category for "acceptance ran, and this is what it concluded" — pass, fail or absent alike. */
export const ACCEPTANCE_RUN_CATEGORY = "acceptance_run";

export type TrackingSource =
	/** `.nklein/nklein/telemetry/*.jsonl` — the self-observation sink. */
	| "self_observation"
	/** The agent ledger: attempts, tool calls, their arguments and results. */
	| "agent_ledger"
	/** The runtime log. Human-readable, weakly structured, no reliable timestamps. */
	| "runtime_log"
	/** Board state on disk — lanes and dependency edges. */
	| "board"
	/** Nothing records this yet. */
	| "none";

export type TrackingStatus = "tracked" | "partial" | "untracked";

export interface TrackedLifecycleEvent {
	readonly id: string;
	/** What happens to the card, in plain language. */
	readonly what: string;
	readonly source: TrackingSource;
	/**
	 * A string that must appear literally in the codebase if this really is emitted. Checked, not trusted.
	 * `null` only when the status is `untracked` — a tracked event without a token is exactly the unfalsifiable
	 * claim this file exists to prevent.
	 */
	readonly emitterToken: string | null;
	readonly status: TrackingStatus;
	/** What is still missing. Required for `partial`/`untracked`; a gap without words is not actionable. */
	readonly gap: string | null;
}

/**
 * Everything that can happen to a card, and whether !Klein records it.
 *
 * Ordered by lifecycle rather than by status, so reading it top-to-bottom tells the card's story and the holes
 * appear where they actually fall.
 */
export const CARD_TRACKING_CONTRACT: readonly TrackedLifecycleEvent[] = [
	{
		id: "card_entered_board",
		what: "A card appears on the board for the first time.",
		source: "self_observation",
		emitterToken: "entered the board in",
		status: "tracked",
		gap: null,
	},
	{
		id: "card_lane_change",
		what: "The card moves between lanes (queued → planning → in progress → review → done).",
		source: "self_observation",
		emitterToken: "card_lane_change",
		status: "tracked",
		gap: null,
	},
	{
		id: "card_left_board",
		what: "The card is removed from the board.",
		source: "self_observation",
		emitterToken: "left the board",
		status: "tracked",
		gap: null,
	},
	{
		id: "attempt_started",
		what: "A worker or reviewer attempt begins on the card.",
		source: "agent_ledger",
		emitterToken: "attempt",
		status: "partial",
		gap: "The ledger records attempts, but the timeline reads them without a reliable per-attempt START marker — an attempt is inferred from its first tool call, so an attempt that died before calling anything is invisible.",
	},
	{
		id: "tool_call",
		what: "The agent attempts a tool call, and what it returned.",
		source: "agent_ledger",
		emitterToken: "recordedAt",
		status: "tracked",
		gap: null,
	},
	{
		id: "model_usage",
		what: "Token usage for an attempt: prompt and completion tokens, gated by the configured tracking level.",
		source: "agent_ledger",
		emitterToken: "applyModelStatsTrackingLevel",
		status: "partial",
		gap:
			"Recorded per ATTEMPT, not per model REQUEST — an attempt that makes many calls collapses into one figure, " +
			"so a retry storm is indistinguishable from one expensive call. `totalTokens` and `reasoningTokens` are " +
			"hardcoded null at the recording site, and neither LATENCY nor the model id that served the request is " +
			"captured, so a slow card still cannot be told from a slow model. Suppressed entirely when the level is `off`.",
	},
	{
		id: "review_verdict",
		what: "A review round completes with approve / request_changes, by which reviewer.",
		source: "runtime_log",
		emitterToken: "[review-phase]",
		status: "partial",
		gap: "Present only in the runtime log, which carries no reliable timestamps — so verdicts order correctly relative to each other but not against telemetry events.",
	},
	{
		id: "bounce_to_worker",
		what: "A review bounces the card back for another worker round.",
		source: "runtime_log",
		emitterToken: "bounced",
		status: "partial",
		gap: "Same runtime-log limitation as review_verdict. The s03 investigation needed the bounce COUNT, which had to be derived by counting log lines.",
	},
	{
		id: "sandbox_workspace_disposed",
		what: "The card's sandbox workspace is torn down, and why.",
		source: "self_observation",
		emitterToken: "sandbox_workspace_disposed",
		status: "tracked",
		gap: null,
	},
	{
		id: "result_patch_captured",
		what: "The card's work is captured to a result branch or patch.",
		source: "self_observation",
		emitterToken: "agent_sandbox_result_patch",
		status: "tracked",
		gap: null,
	},
	{
		id: "acceptance_run",
		what: "Acceptance/verification runs for the card, and its result.",
		source: "self_observation",
		emitterToken: "ACCEPTANCE_RUN_CATEGORY",
		status: "tracked",
		gap: null,
	},
	{
		id: "operator_intervention",
		what: "A human steps in: nudge, correction, takeover or abort.",
		source: "self_observation",
		emitterToken: "operator_intervention",
		status: "partial",
		gap: "Only `nudge` has an emission site. correction, takeover and abort are unmeasured — see INSTRUMENTED_SEVERITIES.",
	},
	{
		id: "held_for_operator",
		what: "The card stops and waits for a person, with a reason code.",
		source: "runtime_log",
		emitterToken: "held in Review",
		status: "tracked",
		gap: null,
	},
	{
		id: "runtime_error",
		what: "An error is raised while working the card.",
		source: "self_observation",
		emitterToken: "runtime_error",
		status: "tracked",
		gap: null,
	},
];

export interface CoverageVerificationInput {
	/** Concatenated source text the tokens are searched in. Injected, so this stays pure. */
	readonly sourceText: string;
}

export interface CoverageVerification {
	readonly totals: Readonly<Record<TrackingStatus, number>>;
	/** Entries claiming to be tracked whose `emitterToken` does NOT appear — the table is lying. */
	readonly brokenClaims: readonly string[];
	/** Entries that are `tracked`/`partial` but carry no token to check. */
	readonly uncheckableClaims: readonly string[];
	/** `partial`/`untracked` entries with no stated gap. */
	readonly unexplainedGaps: readonly string[];
	readonly ok: boolean;
	readonly summary: string;
}

export function verifyTrackingCoverage(input: CoverageVerificationInput): CoverageVerification {
	const totals: Record<TrackingStatus, number> = { tracked: 0, partial: 0, untracked: 0 };
	const brokenClaims: string[] = [];
	const uncheckableClaims: string[] = [];
	const unexplainedGaps: string[] = [];

	for (const entry of CARD_TRACKING_CONTRACT) {
		totals[entry.status] += 1;

		if (entry.status !== "untracked") {
			if (entry.emitterToken === null) {
				uncheckableClaims.push(entry.id);
			} else if (!input.sourceText.includes(entry.emitterToken)) {
				// The emitter was renamed or deleted while the table went on claiming coverage. This is the exact
				// rot that makes a trail untrustworthy, and it is silent without this check.
				brokenClaims.push(`${entry.id} (token "${entry.emitterToken}" not found)`);
			}
		}

		if (entry.status !== "tracked" && (entry.gap === null || entry.gap.trim().length === 0)) {
			unexplainedGaps.push(entry.id);
		}
	}

	const ok = brokenClaims.length === 0 && uncheckableClaims.length === 0 && unexplainedGaps.length === 0;
	return {
		totals,
		brokenClaims,
		uncheckableClaims,
		unexplainedGaps,
		ok,
		summary: ok
			? `${CARD_TRACKING_CONTRACT.length} card lifecycle events declared: ${totals.tracked} tracked, ${totals.partial} partial, ${totals.untracked} untracked. Every tracked claim was verified against a real emitter.`
			: `COVERAGE TABLE IS NOT TRUSTWORTHY — ${brokenClaims.length} broken claim(s), ${uncheckableClaims.length} uncheckable, ${unexplainedGaps.length} unexplained gap(s).`,
	};
}
