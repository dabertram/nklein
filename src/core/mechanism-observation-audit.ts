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
	readonly expectation: FiringExpectation;
}

export type MechanismStatus =
	| "healthy"
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
