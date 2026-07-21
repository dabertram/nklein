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
 *
 * ── ⚠️ WHAT THIS REGISTRY STRUCTURALLY CANNOT COVER (F4.8b, 2026-07-20) ──
 * It is indexed by `metadata.category`, so it can only ever see mechanisms that write a self-observation. Some
 * are observable through a DIFFERENT channel and need no category at all: `NKLEIN_EXPLORER_SUBAGENT` gates the
 * presence of an `explore` TOOL, and the agent ledger records every tool call by name and outcome — so "did the
 * explorer ever run?" is already answerable, from the ledger.
 *
 * **So "absent from this registry" does NOT mean "unobservable", and adding a telemetry category for a mechanism
 * the ledger already covers would be duplicate instrumentation** — a second source of truth that drifts, which
 * N17 spells out at length. Check the ledger before instrumenting: the question is whether the mechanism is
 * observable AT ALL, not whether it is observable *here*.
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
	/**
	 * Flags whose EFFECT this entry observes, when that differs from `enabledBy`.
	 *
	 * Some mechanisms are best recorded unconditionally because the comparison is the measurement —
	 * `sysprompt_level` records lean vs full on every start, so `enabledBy` is null even though it is precisely
	 * what makes NKLEIN_LEAN_SYSPROMPT observable. Without this link, coverage counted by flag name UNDERSTATED
	 * itself: the mechanism was covered and the flag still read as unregistered.
	 *
	 * An understated gap is as misleading as an inflated one — it hides work already done and invites someone to
	 * redo it.
	 */
	readonly covers?: readonly string[];
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
		// A trigger that has NEVER been observed is the strongest possible evidence the mechanism had no chance —
		// stronger than a stale timestamp. The first version required `windowNewest !== null`, so an unfired
		// trigger skipped the check entirely and fell through to an ACCUSATION. Exposed within the hour by adding
		// `sysprompt_level` with `firesWhen: attempt_started`, where the trigger was itself brand new: the audit
		// declared a mechanism silent using a trigger that proved it could not have run.
		const triggerNeverObserved = entry.firesWhen !== undefined && !input.newestByCategory?.has(entry.firesWhen);
		if (
			entry.addedOn !== undefined &&
			(triggerNeverObserved || (windowNewest !== null && windowNewest < entry.addedOn))
		) {
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
		// F4.8b 2026-07-20: the nudge injects only when there is NO chain AND it is a multi-tool turn, so "flag on,
		// condition not met, nothing injected" was indistinguishable from the flag being off.
		category: "focus_chain_nudge",
		item: "§5.N",
		observes: "the focus-chain nudge decision on a chat turn, injected or withheld and why",
		enabledBy: "NKLEIN_FOCUS_CHAIN_NUDGE",
		expectation: "every_run",
		firesWhen: "attempt_started",
		addedOn: Date.UTC(2026, 6, 20),
	},
	{
		// F4.8b 2026-07-20: `isSandboxMcpEnabled()` is a PREDICATE called four times per session, not an event —
		// so it has no category of its own. Its decision is FOLDED into the once-per-session `attempt_started`
		// record (a `sandboxMcpEnabled` field), and this entry maps the flag to that category. `covers` links the
		// flag so coverage does not read it as unregistered; recording it separately would quadruple-count one
		// decision.
		category: "sandbox_mcp_offer",
		item: "§5.AR",
		observes:
			"whether sandbox-hosted MCP servers (and basic-memory) were offered for a session, recorded once at start",
		enabledBy: "NKLEIN_SANDBOX_MCP",
		// F4.8b: basic-memory rides the same record as a distinct FIELD (basicMemoryEnabled), resolved at the same
		// seam through the same MCP bundle. `covers` maps its flag here so coverage does not read it unregistered;
		// it is observable via the field, not via a separate category count.
		covers: ["NKLEIN_BASIC_MEMORY"],
		expectation: "every_run",
		firesWhen: "attempt_started",
		addedOn: Date.UTC(2026, 6, 20),
	},
	{
		// F4.8b 2026-07-20: this reads chat memories, the focus chain, the WHOLE agent ledger and the Basic-Memory
		// corpus on every turn, then projects and ranks them — and recorded nothing. "Is that work producing a
		// note, and from how many sources?" is both the quality question and the cost question for the most
		// expensive recall path in the chat turn, and it had no answer.
		category: "unified_memory_recall",
		item: "F2.9b",
		observes: "how many memory records were banded into the recall note, including when none were",
		enabledBy: "NKLEIN_UNIFIED_MEMORY",
		expectation: "every_run",
	},
	{
		// F4.8b 2026-07-20: **this is the flag that started the whole item.** Its firing was entirely unobserved,
		// which is exactly how F4.8 stayed hidden — every audit reported the requirement satisfied because the
		// IMPORT CHAIN was complete, and nothing could contradict that because nothing recorded whether a block
		// ever reached a prompt.
		//
		// Records `appended: false` too: a flag that is ON while the cadence gate never fires is
		// indistinguishable from the flag being off. This is also what makes a measured A/B on the DEFAULT
		// possible — the decision still open with David — so it is recorded regardless of which way that goes.
		category: "goal_reanchor",
		item: "F4.8",
		observes: "a goal re-anchor block injected or declined by cadence, and which elements it carried",
		enabledBy: "NKLEIN_GOAL_REANCHOR",
		expectation: "every_run",
		firesWhen: "attempt_started",
		addedOn: Date.UTC(2026, 6, 20),
	},
	{
		// F4.8b 2026-07-20: NO code change needed — this was already instrumented and merely unregistered, which
		// is the outcome the check-the-source-first procedure exists to find. Two of the remaining flags turned out
		// this way; reaching for instrumentation without reading would have added a duplicate emission to a
		// mechanism that already had one.
		category: "adaptive_budget_retry",
		item: "§5.AA",
		observes: "an adaptive budget retry re-sending a turn with a raised token budget after a stall",
		enabledBy: "NKLEIN_ADAPTIVE_RETRY",
		expectation: "exceptional",
	},
	{
		// F4.8b 2026-07-20: likewise already instrumented, only unregistered.
		category: "model_lost_residency",
		item: "§5.AL",
		observes: "a model confirmed absent from its endpoint while a task was bound to it",
		enabledBy: "NKLEIN_RESIDENCY_HEARTBEAT",
		expectation: "exceptional",
	},
	{
		// F4.8b 2026-07-20: `useNativeForce` fires when `forceToolCall` is set REGARDLESS of the flag, so the
		// flag's marginal effect is only the `!forceToolCall` case. Recording "native force ran" alone would
		// attribute the force-advance path's traffic to the flag and make it look far more active than it is —
		// `flagDriven` in the metadata isolates the difference the flag actually makes.
		category: "native_force_tool_call",
		item: "§5.AA",
		observes: "the native force tool-call path being taken, and whether the FLAG or force-advance drove it",
		enabledBy: "NKLEIN_NATIVE_FORCE_TOOL_CALL",
		expectation: "exceptional",
	},
	{
		// F4.8b 2026-07-20: the source comment notes an EMPTY panel "still resolves to undefined so nothing is
		// threaded" — so the feature can be enabled, plan a panel, find no eligible lens, and produce a
		// byte-identical prompt. Indistinguishable from the flag being off, and the outcome that says the lens
		// plan is not doing its job.
		category: "review_lenses",
		item: "§5.AW",
		observes: "which review lenses reached the seed prompt, including none",
		enabledBy: "NKLEIN_REVIEW_LENSES",
		expectation: "every_run",
		firesWhen: "second_opinion_review_session",
		addedOn: Date.UTC(2026, 6, 20),
	},
	{
		// F4.8b 2026-07-20: this flag's whole effect is which models it EXCLUDES from fan-out, and that count was
		// unrecorded — so "is the `lms ps` subprocess buying anything?" could not be answered. Zero is the
		// informative case: flag on, subprocess paid for, nothing excluded.
		category: "queue_aware_free_first",
		item: "§5.AB",
		observes: "how many models were excluded as server-busy, including none",
		enabledBy: "NKLEIN_QUEUE_AWARE_FREE_FIRST",
		expectation: "every_run",
	},
	{
		// F4.8b 2026-07-20: recorded at the DISPATCH, not per interval tick — this runs on a timer, so a per-tick
		// or per-budget-denial record would be a steady stream of "nothing happened". The dispatch is the event.
		category: "opportunistic_idle_dispatch",
		item: "F1.36",
		observes: "idle work actually dispatched while the swarm was idle",
		enabledBy: "NKLEIN_OPPORTUNISTIC_IDLE_WORK",
		expectation: "exceptional",
	},
	{
		// F4.8b 2026-07-20: its own comment says "Fleet A/B decides the default" — and it recorded nothing an A/B
		// could read. Same shape as NKLEIN_LEAN_SYSPROMPT, whose comment said "enable to measure".
		category: "ledger_exemplars",
		item: "F12.81",
		observes: "how many behavioural exemplar turns were injected at task start, including zero",
		enabledBy: "NKLEIN_LEDGER_EXEMPLARS",
		expectation: "every_run",
	},
	{
		// F4.8b 2026-07-20: as above — "Fleet A/B decides the default", with nothing recorded to decide from.
		category: "fewshot_exemplars",
		item: "F11.2h",
		observes: "whether a style-exemplar block was rendered for a write-scoped card, including when none was found",
		enabledBy: "NKLEIN_FEWSHOT_EXEMPLARS",
		expectation: "every_run",
	},
	{
		// F4.8b 2026-07-20: the flag only makes the block ELIGIBLE — `decideTemporalContextInjection` then
		// relevance-gates it, so a turn can have the feature ON and render nothing. Observing the flag would have
		// answered the wrong question; this records the DECISION, at the decision.
		covers: ["NKLEIN_KNOWS_TODAY"],
		category: "knows_today_injection",
		item: "§5.AC",
		observes: "whether the knows-today block was injected on a turn, distinct from whether it was enabled",
		enabledBy: null,
		expectation: "every_run",
		firesWhen: "attempt_started",
		addedOn: Date.UTC(2026, 6, 20),
	},
	{
		// F4.8b 2026-07-20: the n-eyes panel silently falls through to the plain panel when no eye returns a
		// verdict, and the plain panel silently falls through to a single reviewer. Two levels of degradation,
		// each invisible — so a run with NKLEIN_N_EYES_REVIEW on that quietly decided by ONE reviewer looked
		// exactly like a run with the flag off.
		//
		// `enabledBy: null` and one category rather than one per flag: the interesting fact is which path WON,
		// which is a single mutually-exclusive outcome recorded on every review regardless of flags.
		covers: ["NKLEIN_N_EYES_REVIEW"],
		category: "review_path",
		item: "§5.AB",
		observes: "which review path produced the verdict — n-eyes, panel, or a single reviewer after silent fallback",
		enabledBy: null,
		expectation: "every_run",
		firesWhen: "second_opinion_review_session",
		addedOn: Date.UTC(2026, 6, 20),
	},
	{
		// F4.8b 2026-07-20: which skill fragments reached the system prompt was unrecorded, and unlike the
		// PROCEDURAL consumer there is no ledger equivalent — attempts carry `surfacedSkillIds` for procedures but
		// nothing for these. So "did enabling this change the prompt at all, and with what?" had no answer.
		category: "skill_prompt_fragments",
		item: "§5.AE",
		observes: "the skill fragments selected for a session's system prompt, including when none are",
		enabledBy: "NKLEIN_SKILL_PROMPT_FRAGMENTS",
		expectation: "every_run",
	},
	{
		// F4.8b 2026-07-20: `progress_stall` already fired, but it fires whether or not this ENFORCING half is
		// enabled — so telemetry could not distinguish "we noticed the stall" from "we actually intervened". The
		// flag's record-only and enforcing modes produced identical observations, making its effect invisible.
		category: "stall_replan_injected",
		item: "F12.22",
		observes:
			"a forced replan actually injected after a progress stall, as opposed to the stall merely being noticed",
		enabledBy: "NKLEIN_STALL_REPLAN",
		expectation: "exceptional",
	},
	{
		// F4.8b 2026-07-20: the skill STORE was the only evidence this ran, and a store records only successes —
		// so a distiller that silently produced nothing from every delivered card looked exactly like one nobody
		// had enabled. The produced/attempted ratio is what says whether distillation works, and it was
		// unobtainable from the store alone.
		category: "procedural_skill_distillation",
		item: "F4.19",
		observes: "a distillation attempt on a delivered card, including when it yields no procedure",
		enabledBy: "NKLEIN_PROCEDURAL_SKILLS",
		expectation: "every_run",
	},
	{
		// F4.8b 2026-07-20: the flag's own comment said "enable to measure" and "default full until the scoreboard
		// proves lean safe (research: measure-first)" — and NOTHING recorded which level was used. Turning it on
		// therefore measured nothing, and the scoreboard the comment defers to could never be built. The entire
		// justification for the flag was unreachable through the flag.
		//
		// `enabledBy: null` is deliberate: the level is now recorded on EVERY session start, flag on or off,
		// because the comparison IS the measurement and a lean-only record has no baseline.
		// `firesWhen: attempt_started` — this records at SESSION START, so the proof it had a chance is that a
		// session started since it landed, not that any telemetry at all was written. Omitting it made the audit
		// immediately flag this entry `enabled_but_silent` on the day it was added: exactly the false alarm the
		// too_new_to_judge check exists to prevent, reproduced by its own author within the hour.
		firesWhen: "attempt_started",
		covers: ["NKLEIN_LEAN_SYSPROMPT"],
		category: "sysprompt_level",
		// §5.AQ, not the code comment's "W2.4a" — the ratchet correctly rejected that, and checking showed W2.4a
		// appears nowhere in todo.md while §5.AQ (context economy) owns this and is cited by sysprompt-level.ts.
		item: "§5.AQ",
		observes: "which system-prompt level a session started with, and the context window that decided it",
		enabledBy: null,
		expectation: "every_run",
		addedOn: Date.UTC(2026, 6, 20),
	},
	{
		// F4.8b 2026-07-20: only decomposition STALLS were observed — the failure modes — so the mechanism's
		// normal operation was invisible and "did fleet-awareness change the breakdown at all?" had no answer.
		// That is the question the feature exists to be judged on, and it alters decompose granularity.
		category: "fleet_aware_decompose",
		item: "F12.110",
		observes:
			"the fleet-aware decompose decision: target class, effective context and depth — including when the fleet summary is empty and it changes nothing",
		enabledBy: "NKLEIN_FLEET_AWARE_DECOMPOSE",
		expectation: "every_run",
	},
	{
		// F4.8b 2026-07-20: the architect phase's failure was swallowed by `.catch(() => null)`, after which the
		// session falls back to the plain prompt and looks IDENTICAL to one where the feature was never enabled.
		// A silent degradation to the default path is indistinguishable from the feature being off.
		category: "architect_editor_phase",
		item: "§5.AV",
		observes: "the architect phase's outcome, including when it produced no brief and silently fell back",
		enabledBy: "NKLEIN_ARCHITECT_EDITOR",
		expectation: "every_run",
	},
	{
		// F4.8b 2026-07-20: emitted nothing, so "does the spec lint ever catch anything?" — the question deciding
		// whether this advisory earns its place in the prompt — had no answer. Records the clean case too, because
		// a found/clean RATIO is the useful number and a gaps-only emission can only ever answer "yes".
		category: "spec_lint",
		item: "F12.10",
		observes: "the decompose spec lint's result, including when it finds nothing",
		enabledBy: "NKLEIN_SPEC_LINT",
		expectation: "every_run",
	},
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
		enabledBy: null,
		covers: ["NKLEIN_REPO_VERIFY"],
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
