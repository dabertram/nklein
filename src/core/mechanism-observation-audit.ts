/**
 * P15.1b — the observation-count half of the mechanism registry. PURE core.
 *
 * Complement to `unwired-core-audit`: that scan finds cores nothing CALLS; this one finds mechanisms that are
 * wired and reachable but have recorded ZERO observations. **That is the subtler and more dangerous failure** —
 * the code is reachable, the tests pass, nothing is orphaned, and it still never fires. The drift critic's
 * empty-`content` trap looked exactly like this from the outside: no error, no orphan, just silence.
 *
 * ── THE DISTINCTION THAT MAKES THIS USEFUL ──
 * Zero observations has TWO completely different causes, and conflating them makes the report worthless:
 *
 *  - **NEVER ENABLED** — the mechanism sits behind a default-OFF flag that was never switched on. Zero is the
 *    CORRECT and expected result. Reporting it as a defect would bury the real signal under every opt-in feature
 *    the project has deliberately not turned on yet.
 *  - **ENABLED BUT SILENT** — the flag was on, the code ran, and the mechanism still recorded nothing. That is
 *    the actual smell, and it is what a "we shipped it" claim quietly hides.
 *
 * A third case matters too: a mechanism that only fires on an EXCEPTIONAL condition (a breach, a drift, an
 * override) is legitimately silent on a healthy run. Silence there is evidence of health, not of breakage — so
 * the registry records that expectation instead of letting the audit misread good news as a defect.
 */

/** Why a mechanism might legitimately record nothing. */
export type FiringExpectation =
	/** Should record on EVERY run it is enabled for — silence is a defect. */
	| "every_run"
	/** Records only on an exceptional condition; silence may mean the condition never occurred. */
	| "exceptional";

export interface MechanismEntry {
	/** The `metadata.category` this mechanism writes. */
	readonly category: string;
	/** Backlog item that owns it, for traceability back to the decision. */
	readonly item: string;
	/** What an observation from it means. */
	readonly observes: string;
	/** Env flag / setting that enables it, or null when it is always on. */
	readonly enabledBy: string | null;
	/**
	 * Epoch ms at which the mechanism's emission site LANDED, when known.
	 *
	 * ⚠️ **WITHOUT THIS THE AUDIT FALSE-ALARMS ON EVERY NEW MECHANISM.** Found 2026-07-20:
	 * `review_effort_scaling` was reported `enabled_but_silent` — "the code is reachable and still never fired" —
	 * against 139 recorded review sessions. Every one of those sessions ran 07-09→07-17; the emission landed
	 * 07-19. **Zero was the correct answer, and the audit called it a defect.** An all-time observation count
	 * compared against a one-day-old mechanism is not evidence of anything, and a report that cries wolf on every
	 * newly-added mechanism is one people learn to skip.
	 */
	readonly addedOn?: number;
	/**
	 * Category whose presence proves this mechanism's TRIGGERING ACTIVITY occurred.
	 *
	 * `every_run` means every run OF THAT ACTIVITY, not every wall-clock day. `review_effort_scaling` fires per
	 * REVIEW; if no review has happened since its emission landed, silence is not evidence of a defect. Without
	 * this the audit still false-alarms — merely having newer telemetry from some unrelated activity is not proof
	 * the mechanism had a chance.
	 */
	readonly firesWhen?: string;
	readonly expectation: FiringExpectation;
}

export type MechanismStatus =
	| "healthy"
	| "too_new_to_judge"
	| "never_enabled"
	| "enabled_but_silent"
	| "silent_but_exceptional"
	| "unknown_enablement";

export interface MechanismFinding extends MechanismEntry {
	readonly observations: number;
	readonly status: MechanismStatus;
	readonly note: string;
}

export interface MechanismAuditInput {
	readonly registry: readonly MechanismEntry[];
	/** Observation counts by category, from `readSelfObservationEvents`. */
	readonly countsByCategory: ReadonlyMap<string, number>;
	/**
	 * Which enabling flags were ON for the observed window. A flag absent from this set is treated as UNKNOWN
	 * rather than off — we usually cannot prove a flag's history, and claiming "never enabled" without evidence
	 * would excuse a real silence.
	 */
	readonly knownEnabledFlags?: ReadonlySet<string>;
	/**
	 * Epoch ms of the NEWEST observation read. Used only to answer "could this mechanism have fired yet?" — a
	 * mechanism whose emission site postdates all available telemetry is `too_new_to_judge`, never a defect.
	 */
	readonly newestObservationAt?: number;
	/** Newest observation timestamp per category, so a mechanism can be judged against ITS trigger's window. */
	readonly newestByCategory?: ReadonlyMap<string, number>;
	/**
	 * True when the observation read hit its cap, so older events were TRUNCATED away.
	 *
	 * ⚠️ LIVE-FOUND 2026-07-20, and it nearly produced a false finding: the first real run read 500 events and
	 * **all 500 were a single high-frequency category** (`board_liveness_watchdog_tick`). Every other mechanism
	 * therefore counted zero — not because they never fired, but because one chatty mechanism had pushed them out
	 * of the window entirely. The audit reported `review_effort_scaling` as ENABLED_BUT_SILENT on that basis.
	 * **A zero from a saturated window is not evidence of silence**, so when this is set the audit refuses to
	 * conclude silence and reports the truncation instead.
	 */
	readonly windowSaturated?: boolean;
}

export interface MechanismAuditResult {
	readonly findings: readonly MechanismFinding[];
	/** The subset worth a human's attention: enabled, expected to fire, and silent. */
	readonly actionable: readonly MechanismFinding[];
	readonly summary: string;
}

/**
 * Audit the registry against recorded observations. Never reports a mechanism as broken on evidence it does not
 * have: an unknown flag state yields `unknown_enablement`, not an accusation.
 */
export function auditMechanismObservations(input: MechanismAuditInput): MechanismAuditResult {
	const findings: MechanismFinding[] = [];

	for (const entry of input.registry) {
		const observations = input.countsByCategory.get(entry.category) ?? 0;
		if (observations > 0) {
			findings.push({
				...entry,
				observations,
				status: "healthy",
				note: `${observations} observation(s) recorded — the mechanism demonstrably fires`,
			});
			continue;
		}
		// Judge the WINDOW before judging the mechanism. If no telemetry postdates the emission site, the
		// mechanism has not had a chance to fire and silence carries no information either way.
		// Prefer the TRIGGER's newest timestamp over the global one: the question is whether the activity this
		// mechanism attaches to has occurred since it landed, not whether any telemetry at all has been written.
		// `every_run` means every run OF THAT ACTIVITY — newer telemetry from something unrelated proves nothing.
		const windowNewest =
			entry.firesWhen !== undefined
				? (input.newestByCategory?.get(entry.firesWhen) ?? null)
				: (input.newestObservationAt ?? null);
		if (entry.addedOn !== undefined && windowNewest !== null && windowNewest < entry.addedOn) {
			findings.push({
				...entry,
				observations,
				status: "too_new_to_judge",
				note:
					entry.firesWhen !== undefined
						? `no observations, but no "${entry.firesWhen}" has occurred since this mechanism's emission site landed — its triggering activity has not run, so silence says nothing`
						: "no observations, but the newest telemetry PREDATES this mechanism's emission site — it has not had a chance to fire, so silence says nothing",
			});
			continue;
		}

		const alwaysOn = entry.enabledBy === null;
		const known = input.knownEnabledFlags;
		const enabled = alwaysOn || (known ? known.has(entry.enabledBy) : false);
		const enablementKnown = alwaysOn || (known?.has(entry.enabledBy) ?? false) || known !== undefined;

		if (!enablementKnown) {
			findings.push({
				...entry,
				observations,
				status: "unknown_enablement",
				note: `no observations, and we cannot show whether ${entry.enabledBy} was ever on — inconclusive, not a defect`,
			});
			continue;
		}
		if (!enabled) {
			findings.push({
				...entry,
				observations,
				status: "never_enabled",
				note: `no observations, but ${entry.enabledBy} was not enabled — zero is the CORRECT result, not a smell`,
			});
			continue;
		}
		if (input.windowSaturated === true) {
			findings.push({
				...entry,
				observations,
				status: "unknown_enablement",
				note: "zero observations, but the read window was SATURATED (it hit its cap, so older events were truncated) — this is a truncation artifact, not evidence of silence",
			});
			continue;
		}
		if (entry.expectation === "exceptional") {
			findings.push({
				...entry,
				observations,
				status: "silent_but_exceptional",
				note: "enabled and silent, but this mechanism only fires on an exceptional condition — silence may be evidence of HEALTH",
			});
			continue;
		}
		findings.push({
			...entry,
			observations,
			status: "enabled_but_silent",
			note: "ENABLED, expected to fire on every run, and recorded NOTHING — the code is reachable and still never fired",
		});
	}

	const actionable = findings.filter((finding) => finding.status === "enabled_but_silent");
	const saturationNote =
		input.windowSaturated === true
			? " ⚠️ The observation window was SATURATED, so every zero here is inconclusive — widen the window or filter the dominant category before drawing conclusions."
			: "";
	const healthy = findings.filter((finding) => finding.status === "healthy").length;
	const summary =
		actionable.length > 0
			? `${actionable.length} mechanism(s) are ENABLED, expected to fire, and recorded nothing. ${healthy} of ${findings.length} are demonstrably firing.${saturationNote}`
			: `No enabled-but-silent mechanisms. ${healthy} of ${findings.length} are demonstrably firing; the rest are either not enabled or fire only on exceptional conditions.${saturationNote}`;

	return { findings, actionable, summary };
}

/**
 * The declared registry. Hand-maintained ONLY in the sense that a mechanism's INTENT cannot be derived from code
 * — the observation counts that judge it are always read live, so the part that would rot is generated.
 */
export const MECHANISM_REGISTRY: readonly MechanismEntry[] = [
	// F4.8b 2026-07-20: registering four opt-in mechanisms that the registry had never heard of.
	//
	// 5 of 40 default-OFF flags were registered, so for 35 nothing could report whether they run — the hole F4.8
	// fell through. These four are added because their category is VERIFIED (the flag name derives a category
	// that genuinely exists in the codebase and was read at its emission site), not inferred from co-location in
	// the same file. The rest stay out until each is read: **registering a guessed category would make the
	// registry report on a mechanism that does not emit it**, which is worse than the silence it replaces.
	{
		// F4.8b 2026-07-20: an ABORTED TURN reported only to stderr — not countable, not attributable to a card,
		// and gone when the process exits. This mechanism kills a generation mid-flight; how often it fires is
		// both the argument for enabling it and the first thing wanted after a card behaved oddly.
		category: "runaway_generation_interrupted",
		item: "§5.AA",
		observes: "a degenerate generation interrupted mid-flight",
		enabledBy: "NKLEIN_RUNAWAY_ABORT",
		expectation: "exceptional",
	},
	{
		// F4.8b 2026-07-20: emitted ONLY on a bounce, so "how often would this fire if I enabled it?" — the
		// question asked BEFORE turning it on — had no answer. Now records the decision either way.
		category: "test_driven_gate",
		item: "F12.37",
		observes: "the test-driven delivery gate's decision, allowed or bounced",
		enabledBy: "NKLEIN_TEST_DRIVEN_MODE",
		expectation: "every_run",
		firesWhen: "second_opinion_review_session",
		addedOn: Date.UTC(2026, 6, 20),
	},
	{
		// F4.8b 2026-07-20: as above. This gate saves reviewer TOKENS by short-circuiting a review the machine
		// already rejected, so its firing RATE is the entire argument for enabling it — unobtainable from bounces.
		category: "verification_first_gate",
		item: "F12.36",
		observes: "the verification-first gate's decision on a card with a fresh acceptance result",
		enabledBy: "NKLEIN_VERIFICATION_FIRST",
		expectation: "every_run",
		firesWhen: "second_opinion_review_session",
		addedOn: Date.UTC(2026, 6, 20),
	},
	{
		// F4.8b 2026-07-20: reported ONLY to the runtime log (weakly structured, no reliable timestamp, not
		// countable), so "did the panel ever assemble, and with how many judges?" needed log archaeology — which
		// is how it silently fell back to the single-reviewer path on the rig. Registered once measurable.
		category: "review_panel_assembly",
		item: "§5.AB",
		observes:
			"a review panel assembling, including when it comes out EMPTY — a thin panel is the failure worth catching",
		enabledBy: "NKLEIN_REVIEW_PANEL",
		expectation: "every_run",
		firesWhen: "second_opinion_review_session",
		addedOn: Date.UTC(2026, 6, 20),
	},
	{
		// F4.8b 2026-07-20: this mechanism EMITTED NOTHING until an observation was added for it. Verified by
		// reading the full guarded block — it spent an extra model round-trip per turn and left no trace, so
		// enabling it produced no evidence it ran. Registered only after it became measurable.
		category: "two_phase_tool_pick",
		item: "§5.O",
		observes: "a two-phase pick narrowing the offered tools for the current step — including when it changes nothing",
		enabledBy: "NKLEIN_TWO_PHASE_TOOL_PICK",
		expectation: "every_run",
	},
	{
		category: "baseline_probe",
		item: "F12.60",
		observes:
			"the BASE tree already failing a card's acceptance check — a red acceptance at review may be pre-existing rather than the worker's",
		enabledBy: "NKLEIN_BASELINE_PROBE",
		expectation: "exceptional",
	},
	{
		category: "repo_verify",
		item: "F11.2",
		observes:
			"a repo verify check failing AFTER a green acceptance — the acceptance passed and the repo is still broken",
		enabledBy: "NKLEIN_REPO_VERIFY",
		expectation: "exceptional",
	},
	{
		category: "tool_trust_decay",
		item: "F12.24",
		observes: "a tool demoted after consecutive failures in one session",
		enabledBy: "NKLEIN_TOOL_TRUST_DECAY",
		expectation: "exceptional",
	},
	{
		category: "typecheck_first",
		item: "F12.86",
		observes: "the cheap type check failing before the expensive acceptance command ran",
		enabledBy: "NKLEIN_TYPECHECK_FIRST",
		expectation: "exceptional",
	},
	{
		category: "quant_floor_breach",
		item: "F12.27",
		observes: "a routed model below the Q4_K_M tool-call floor",
		enabledBy: null,
		expectation: "exceptional",
	},
	{
		category: "language_floor_breach",
		item: "F12.83",
		observes: "a routed model below the language/task-shape size floor",
		enabledBy: null,
		expectation: "exceptional",
	},
	{
		category: "adaptive_thinking_recommendation",
		item: "F12.27",
		observes: "a thinking-budget recommendation that DISAGREES with the configured effort",
		enabledBy: null,
		expectation: "exceptional",
	},
	{
		category: "scaffold_profile_recommendation",
		item: "F12.14",
		observes: "a model whose ledger says it would do better on the minimal scaffold",
		enabledBy: null,
		expectation: "exceptional",
	},
	{
		category: "review_effort_scaling",
		item: "F12.35",
		observes: "the review depth a card would have been given",
		enabledBy: null,
		expectation: "every_run",
		// cf69c28de, 2026-07-19 — the emission landed AFTER every review session in the local telemetry.
		addedOn: Date.UTC(2026, 6, 19),
		firesWhen: "second_opinion_review_session",
	},
	{
		category: "mcp_tool_surface_drift",
		item: "F12.31",
		observes: "an MCP server whose tool surface changed after being pinned",
		enabledBy: null,
		expectation: "exceptional",
	},
	{
		category: "history_blind_corrector_override",
		item: "F12.91",
		observes: "the corrector tightening an approve to request_changes",
		enabledBy: "NKLEIN_HISTORY_BLIND_CORRECTOR",
		expectation: "exceptional",
	},
	{
		category: "history_blind_corrector_agreed",
		item: "F12.91",
		observes: "the corrector agreeing with an approve",
		enabledBy: "NKLEIN_HISTORY_BLIND_CORRECTOR",
		expectation: "every_run",
	},
	{
		category: "drift_critic_flagged",
		item: "F12.92",
		observes: "the drift critic naming a subgoal drift",
		enabledBy: "NKLEIN_DRIFT_CRITIC",
		expectation: "exceptional",
	},
	{
		category: "drift_critic_on_track",
		item: "F12.92",
		observes: "the drift critic finding the run on-track",
		enabledBy: "NKLEIN_DRIFT_CRITIC",
		expectation: "every_run",
	},
	{
		category: "tool_catalog_gate_observation",
		item: "F12.18",
		observes: "how far an offered tool catalog sits above the ~7-tool target",
		enabledBy: "NKLEIN_TOOL_GATE_OBSERVE",
		expectation: "every_run",
	},
];
