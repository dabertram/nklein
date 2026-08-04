/**
 * What each default-OFF flag DOES when you turn it on. PURE core.
 *
 * ── WHY THIS EXISTS ──
 * N11's lane (b) is "all safe opt-ins ON (the dark flags shipped observe-first)", and it is the vehicle for
 * breaking the Phase-15 deadlock: 31 of 45 registered mechanisms have never been enabled, P15.3 flips defaults
 * only where P15.2 produced a verdict, P15.2 needs ≥30 observations, and observations need enabling.
 *
 * **But nothing declared which flags are "safe".** `dev env-gated` reports per-FILE gating heuristically and says
 * so in its own output (*"VERIFY BY READING — this check cannot prove the guard wraps the call"*). F4.8b measured
 * the same gap from the other side: the mechanism registry is hand-maintained, so *"it can only report on
 * mechanisms someone remembered to add"* — which is precisely how a default-OFF injection site stayed invisible
 * while every audit reported its requirement satisfied.
 *
 * ── 🔴 THE FINDING THAT CHANGES WHAT LANE (b) IS ──
 * Every gate site below was READ, and the population is not what the item's wording assumes. **The large majority
 * of default-OFF flags CHANGE PRODUCT BEHAVIOUR — they are not observe-first.** `NKLEIN_STALL_REPLAN` is labelled
 * in-source *"F12.22 **enforcing half**"* with *"default OFF = **record-only** stays byte-identical"*: the
 * observing half is already on, and the flag turns on the injection. `NKLEIN_FOCUS_CHAIN_NUDGE` injects a nudge;
 * `NKLEIN_LEAN_SYSPROMPT` swaps the system prompt; `NKLEIN_PROPERTY_GATE` gates acceptance.
 *
 * So lane (b) is not "flip the harmless ones on and collect evidence". It is **a deliberate, behaviour-changing
 * configuration whose interactions need testing** — still worth running, but a different and riskier thing than
 * the phrase "safe opt-ins" suggests, and it cannot be assembled by guessing from flag names.
 *
 * ── THE CLASSIFICATION CRITERION, STATED SO IT IS FALSIFIABLE ──
 * *Does turning this flag ON change what the product DOES for a user's card?* Prompt content, tool set, routing,
 * retry, review outcome, acceptance, delivery — any of those differing makes it `enforcing`. Only additional
 * recording that no decision reads is `observe_only`.
 *
 * ── `unclassified` IS NEVER SAFE ──
 * A flag nobody has read stays `unclassified`, and {@link safeObserveOnlyFlags} excludes it. That is the whole
 * structural point: the safe set grows one honest reading at a time. **A bulk guess here silently flips behaviour
 * in the autonomous runtime**, which is the single failure the entire default-flip campaign exists to avoid.
 */

export type FeatureFlagMode =
	/** Adds recording only. No product decision reads it. Safe for lane (b). */
	| "observe_only"
	/** Changes what the product does for a card. Enabling it is an experiment, not an observation. */
	| "enforcing"
	/** Only affects dev/eval commands, never a user's card. Irrelevant to lane (b) either way. */
	| "dev_only"
	/** Nobody has read the gate site. NEVER treated as safe. */
	| "unclassified";

export interface FeatureFlagSpec {
	readonly flag: string;
	readonly mode: FeatureFlagMode;
	/** Where the gate was read, so the classification is checkable rather than trusted. */
	readonly gate: string;
	/**
	 * True when the flag is ON unless explicitly disabled — a KILL SWITCH, which is N11's lane (c).
	 *
	 * Kept on the same registry rather than a separate one: lane (b) turns things on and lane (c) turns things
	 * off, and a reader deciding either needs to see both in one place. Splitting them is how a flag ends up in
	 * neither.
	 */
	readonly defaultOn?: true;
	readonly note?: string;
}

/**
 * Every `isTruthyEnv(process.env.…)` flag in `src/`, classified by reading its gate site (2026-07-31).
 *
 * `mode` is a claim about the gate that was READ, not about the flag's name. Names mislead here:
 * `NKLEIN_TOOL_GATE_OBSERVE` really is observational, while `NKLEIN_BASELINE_PROBE` — which also sounds
 * observational — spawns a sandbox verification.
 */
export const FEATURE_FLAG_REGISTRY: readonly FeatureFlagSpec[] = [
	// ── observe_only: recording that no decision reads ──
	{ flag: "NKLEIN_DEBUG_STREAM_EVENTS", mode: "observe_only", gate: "nklein-task-session-service.ts (debug log)" },
	{ flag: "NKLEIN_TRUNCATION_DIAGNOSTICS", mode: "observe_only", gate: "chat-local-llm-adapter.ts (early return)" },
	{ flag: "NKLEIN_TOOL_GATE_OBSERVE", mode: "observe_only", gate: "nklein-context-focus-extension.ts" },
	{ flag: "NKLEIN_TOOL_GATE_ENFORCE", mode: "enforcing", gate: "nklein-context-focus-extension.ts" },
	{
		flag: "NKLEIN_MODEL_CONSULT",
		mode: "enforcing",
		gate: "nklein-session-runtime.ts (admits consult_stronger_model into stuck worker sessions + runs a consultant completion)",
		note: "F3.37, default-OFF until the aimock+fleet A/B shows consults convert failed cards (evidence bar: consult-then-success vs cross_model_carry).",
	},
	{
		flag: "NKLEIN_A2A_SERVER",
		mode: "enforcing",
		gate: "runtime-server.ts (serves the A2A v1.0 agent card + JSON-RPC ingress, loopback-only, never in remote mode)",
		note: "P17.8 receive-side pilot: SendMessage seeds a ready-lane card (trigger-intake semantics with a standard protocol).",
	},
	{ flag: "NKLEIN_REASONING_CAPTURE", mode: "observe_only", gate: "runtime-api.ts (captureReasoning)" },
	{
		flag: "NKLEIN_BASELINE_PROBE",
		mode: "observe_only",
		gate: "start-task-session.ts (fire-and-forget verifyTaskAcceptanceInSandbox)",
		note: "no decision reads the result, but it SPAWNS A SANDBOX — safe for behaviour, costly for resources",
	},

	// ── dev_only: eval/dev surfaces, never a user's card ──
	{ flag: "NKLEIN_ENFORCED_REASONING", mode: "dev_only", gate: "runtime-api.ts (model eval)" },
	{ flag: "NKLEIN_EVAL_DISTRACTOR_PROBE", mode: "dev_only", gate: "runtime-api.ts (model eval)" },
	{ flag: "NKLEIN_EVAL_RAIL", mode: "dev_only", gate: "runtime-server.ts (eval rail)" },

	// ── enforcing: changes prompt, tools, routing, gating or review ──
	{ flag: "NKLEIN_ARCHITECT_EDITOR", mode: "enforcing", gate: "nklein-task-session-service.ts (split path)" },
	{ flag: "NKLEIN_BASIC_MEMORY", mode: "enforcing", gate: "nklein-agent-sandbox.ts (adds agent tooling)" },
	{ flag: "NKLEIN_EXPLORER_SUBAGENT", mode: "enforcing", gate: "nklein-task-session-service.ts (adds a handler)" },
	{ flag: "NKLEIN_FEWSHOT_EXEMPLARS", mode: "enforcing", gate: "start-task-session.ts (injects exemplars)" },
	{ flag: "NKLEIN_GOAL_REANCHOR", mode: "enforcing", gate: "injection site (the original F4.8 finding)" },
	{ flag: "NKLEIN_HISTORY_BLIND_CORRECTOR", mode: "enforcing", gate: "second-opinion-review-runner.ts" },
	{ flag: "NKLEIN_KNOWS_TODAY", mode: "enforcing", gate: "chat-agent-turn.ts (prompt content)" },
	{ flag: "NKLEIN_LEAN_SYSPROMPT", mode: "enforcing", gate: "nklein-task-session-service.ts (lean vs full)" },
	{ flag: "NKLEIN_LEDGER_EXEMPLARS", mode: "enforcing", gate: "start-task-session.ts (injects messages)" },
	{ flag: "NKLEIN_NATIVE_FORCE_TOOL_CALL", mode: "enforcing", gate: "chat-local-llm-adapter.ts" },
	{ flag: "NKLEIN_OPPORTUNISTIC_IDLE_WORK", mode: "enforcing", gate: "runtime-server.ts (dispatches work)" },
	{ flag: "NKLEIN_PROCEDURAL_SKILLS", mode: "enforcing", gate: "surfaces procedures into the prompt" },
	{ flag: "NKLEIN_PROPERTY_GATE", mode: "enforcing", gate: "nklein-acceptance-verifier.ts (gates acceptance)" },
	{ flag: "NKLEIN_QUEUE_AWARE_FREE_FIRST", mode: "enforcing", gate: "start-task-session.ts (routing)" },
	{ flag: "NKLEIN_REASONING_BREACH", mode: "enforcing", gate: "chat-local-llm-adapter.ts" },
	{ flag: "NKLEIN_REVIEW_LENSES", mode: "enforcing", gate: "runtime-config (force-enables lenses)" },
	{ flag: "NKLEIN_REVIEW_PANEL", mode: "enforcing", gate: "second-opinion-review-runner.ts (panel assembly)" },
	{ flag: "NKLEIN_RUNAWAY_ABORT", mode: "enforcing", gate: "nklein-session-runtime.ts (wraps the model)" },
	{ flag: "NKLEIN_SANDBOX_MCP", mode: "enforcing", gate: "nklein-task-session-service.ts (agent MCP access)" },
	{ flag: "NKLEIN_SKILL_PROMPT_FRAGMENTS", mode: "enforcing", gate: "nklein-session-skill-fragments.ts" },
	{ flag: "NKLEIN_SPEC_DELIBERATION", mode: "enforcing", gate: "nklein-task-session-service.ts (plan mode)" },
	{ flag: "NKLEIN_SPEC_LINT", mode: "enforcing", gate: "nklein-task-prompt-builders.ts (prompt content)" },
	{
		flag: "NKLEIN_STALL_REPLAN",
		mode: "enforcing",
		gate: "nklein-context-focus-extension.ts",
		note: "labelled in-source 'F12.22 ENFORCING HALF' — 'default OFF = record-only stays byte-identical', so the OBSERVING half is already on",
	},
	{ flag: "NKLEIN_STATEFUL_RESPONSES", mode: "enforcing", gate: "nklein-session-runtime.ts (transport opt-in)" },
	{ flag: "NKLEIN_TEST_DRIVEN_MODE", mode: "enforcing", gate: "second-opinion-review-runner.ts (gate)" },
	{ flag: "NKLEIN_TOOL_TRUST_DECAY", mode: "enforcing", gate: "nklein-context-focus-extension.ts (guidance)" },
	{ flag: "NKLEIN_TWO_PHASE_TOOL_PICK", mode: "enforcing", gate: "nklein-session-runtime.ts (tool selection)" },
	{ flag: "NKLEIN_TYPECHECK_FIRST", mode: "enforcing", gate: "nklein-acceptance-gate.ts (runs commands)" },
	{ flag: "NKLEIN_UNIFIED_MEMORY", mode: "enforcing", gate: "runtime-api.ts (adds a memory note builder)" },
	{ flag: "NKLEIN_VERIFICATION_FIRST", mode: "enforcing", gate: "second-opinion-review-runner.ts (gate)" },
	{ flag: "NKLEIN_VISUAL_GATE", mode: "enforcing", gate: "second-opinion-review-runner.ts (gate)" },
	{ flag: "NKLEIN_FOCUS_CHAIN_NUDGE", mode: "enforcing", gate: "chat-agent-turn.ts (injects a nudge)" },
	{
		flag: "NKLEIN_FLEET_AWARE_DECOMPOSE",
		mode: "enforcing",
		gate: "start-task-session.ts (F12.110 — the LOADED fleet as direct decompose input)",
		note: "FOUND BY THE COVERAGE RATCHET, not by the hand sweep that built this registry: it is read across a line break, so a single-line grep missed it. That is the F4.8b failure verbatim, caught mechanically",
	},

	// ── traced 2026-08-01: all three previously-unclassified flags turned out to be ENFORCING ──
	{
		flag: "NKLEIN_ADAPTIVE_RETRY",
		mode: "enforcing",
		gate: "nklein-adaptive-budget-controller.ts",
		note: "gates shouldAttemptAdaptiveBudgetRetry; when it passes the controller RE-SENDS the task with a larger budget",
	},
	{
		flag: "NKLEIN_RESIDENCY_HEARTBEAT",
		mode: "enforcing",
		gate: "nklein-model-residency-watcher.ts",
		note: "it probes AND acts: onModelLost fails the send with 'Model is no longer resident'. Observing is only half of it",
	},
	{
		flag: "NKLEIN_N_EYES_REVIEW",
		mode: "enforcing",
		gate: "second-opinion-review-runner.ts:949",
		note: "runs runNEyesReviewPanel INSTEAD of the plain panel — a different review procedure producing a different verdict",
	},

	// ── boolean flags read WITHOUT a standard helper (found 2026-08-01 — see the ratchet note) ──
	{
		flag: "NKLEIN_ALLOW_UNSUITABLE_MODEL",
		mode: "enforcing",
		gate: 'chat-service.ts / start-task-session.ts (=== "1")',
		note: "DISABLES the model-suitability guard — an override, not an observation",
	},
	{
		flag: "NKLEIN_CHAT_MEMORY_WRITE",
		mode: "enforcing",
		gate: 'chat-service.ts (!== "1" early return)',
		note: "gates memory EXTRACTION and writes",
	},
	{ flag: "NKLEIN_CRASH_RECOVERY_MATRIX", mode: "dev_only", gate: 'crash-recovery-matrix.ts (=== "1" + PHASE)' },
	{
		flag: "NKLEIN_FITNESS_ROUTING",
		mode: "enforcing",
		defaultOn: true,
		gate: "start-task-session.ts (/^(0|false|off)$/i)",
		note: "a KILL SWITCH for fitness-based routing — disabling it empties the fitness table rows",
	},
	{
		flag: "NKLEIN_FLEET_DECOMPOSE_MODE",
		mode: "enforcing",
		gate: 'start-task-session.ts (=== "smallest" | "capability_weighted" | "fixed_target" | "off")',
		note: "an ENUM knob, not a boolean; listed because one of its values is a disable and it changes decompose",
	},
	{
		flag: "NKLEIN_FRAMEWORK_PREAMBLE",
		mode: "enforcing",
		defaultOn: true,
		gate: "nklein-framework-preamble-reader.ts (/^(0|false|off)$/i)",
		note: "kill switch — disabling it returns an empty preamble, changing prompt content",
	},
	{
		flag: "NKLEIN_MODEL_SENSITIVE_PRUNE",
		mode: "enforcing",
		defaultOn: true,
		gate: 'nklein-session-skill-fragments.ts (!== "off")',
		note: "kill switch — prunes skill fragments per model/role",
	},
	{
		flag: "NKLEIN_SANDBOX_SKIP_STARTUP_REAP",
		mode: "enforcing",
		gate: 'runtime-server.ts (=== "1")',
		note: "skips orphan-sandbox reaping at startup (also implied by VITEST=true)",
	},
	{
		flag: "NKLEIN_STRUCTURED_INGESTION",
		mode: "enforcing",
		gate: "nklein-web-research-tool.ts (/^(1|true|on)$/i)",
		note: "changes how fetched web content is parsed and delivered to the model",
	},

	// ── DEFAULT-ON kill switches read via isEnabledByDefaultEnv — N11 lane (c) turns these OFF ──
	{ flag: "NKLEIN_DURABLE_SCHEDULER", mode: "enforcing", defaultOn: true, gate: "runtime-server.ts" },
	{ flag: "NKLEIN_MODEL_FAILOVER", mode: "enforcing", defaultOn: true, gate: "nklein-task-session-service.ts" },
	{ flag: "NKLEIN_REPO_VERIFY", mode: "enforcing", defaultOn: true, gate: "acceptance/verify path" },
	{ flag: "NKLEIN_STABLE_ROUTING_KEY", mode: "enforcing", defaultOn: true, gate: "nklein-task-session-service.ts" },
	{ flag: "NKLEIN_ARCHITECT_PROMPT_DIET", mode: "enforcing", defaultOn: true, gate: "prompt builders" },
	{ flag: "NKLEIN_JUDGE_PROMPT_DIET", mode: "enforcing", defaultOn: true, gate: "review prompt builders" },
	{ flag: "NKLEIN_SWARM_PROMPT_VARIATION", mode: "enforcing", defaultOn: true, gate: "swarm prompt builder" },
];

/** N11 lane (c) turns these OFF. Exposed alongside the safe set so a flag cannot fall between the two lanes. */
export function defaultOnKillSwitches(): readonly string[] {
	return FEATURE_FLAG_REGISTRY.filter((spec) => spec.defaultOn === true)
		.map((spec) => spec.flag)
		.sort();
}

/** The flags lane (b) may enable. `unclassified` is excluded BY CONSTRUCTION, not by omission. */
export function safeObserveOnlyFlags(): readonly string[] {
	return FEATURE_FLAG_REGISTRY.filter((spec) => spec.mode === "observe_only")
		.map((spec) => spec.flag)
		.sort();
}

export interface FlagCoverageReport {
	readonly total: number;
	readonly byMode: Readonly<Record<FeatureFlagMode, number>>;
	/** Flags found in the source that the registry does not declare — the F4.8b failure, made visible. */
	readonly undeclared: readonly string[];
	readonly summary: string;
}

/** Compare the registry against the flags actually present in the source. */
export function auditFlagCoverage(flagsFoundInSource: readonly string[]): FlagCoverageReport {
	const declared = new Set(FEATURE_FLAG_REGISTRY.map((spec) => spec.flag));
	const undeclared = [...new Set(flagsFoundInSource)].filter((flag) => !declared.has(flag)).sort();
	const byMode = { observe_only: 0, enforcing: 0, dev_only: 0, unclassified: 0 } as Record<FeatureFlagMode, number>;
	for (const spec of FEATURE_FLAG_REGISTRY) {
		byMode[spec.mode] += 1;
	}
	const behaviourChanging = byMode.enforcing;
	return {
		total: FEATURE_FLAG_REGISTRY.length,
		byMode,
		undeclared,
		summary:
			`${FEATURE_FLAG_REGISTRY.length} flag(s) declared: ${byMode.observe_only} observe-only, ` +
			`${behaviourChanging} ENFORCING, ${byMode.dev_only} dev-only, ${byMode.unclassified} unclassified` +
			(undeclared.length > 0 ? `; ${undeclared.length} found in source but UNDECLARED` : "") +
			`. Lane (b) may enable ${byMode.observe_only} of ${FEATURE_FLAG_REGISTRY.length} — the rest change what the product does for a card`,
	};
}

export type LaneExclusionKind =
	/** Must NEVER be in the lane — enabling it would defeat the lane's own purpose or damage the run. */
	| "permanent"
	/** Belongs in the lane; not added yet because doing so needs a nightly run to validate. */
	| "pending_validation";

export interface FlagsOnLaneExclusion {
	readonly flag: string;
	readonly kind: LaneExclusionKind;
	readonly reason: string;
}

/**
 * Default-OFF opt-ins the N11 `flags_on` lane does NOT enable, and why.
 *
 * ── WHY THIS EXISTS ──
 * The lane's own header says it replays the baseline recording *"with EVERY default-OFF opt-in enabled"*. Checked
 * against this registry on 2026-08-01 it enabled **32 of 46**. The existing `nightly-flag-matrix-coverage` ratchet
 * only requires flags the MECHANISM registry names as a gate — a subset — so the broader claim went unchecked.
 *
 * **Bulk-enabling the other 14 would be wrong, which is exactly why the gap needs declaring rather than closing.**
 * Some must never be enabled; others simply have not been validated. Both are legitimate, and they are different,
 * so each is stated with its kind — a flat "known exceptions" list would let a temporary omission calcify into an
 * apparent rule.
 */
export const FLAGS_ON_LANE_EXCLUSIONS: readonly FlagsOnLaneExclusion[] = [
	{
		flag: "NKLEIN_EXPLORER_SUBAGENT",
		kind: "pending_validation",
		reason:
			"adds an explore handler. DRAIN-GREEN one-at-a-time 2026-08-05 (solo flags_on run passed) — the remaining precondition is NOT another run: the lane ratchet only admits flags a REGISTERED MECHANISM claims, and none claims this one. Register a consuming mechanism (emit site + registry entry), then it joins the lane. Same correction shape as NKLEIN_TRUNCATION_DIAGNOSTICS 2026-08-02.",
	},
	{
		flag: "NKLEIN_PROPERTY_GATE",
		kind: "pending_validation",
		reason:
			"gates acceptance. DRAIN-GREEN one-at-a-time 2026-08-05 (solo flags_on run passed) — the remaining precondition is NOT another run: the lane ratchet only admits flags a REGISTERED MECHANISM claims, and none claims this one. Register a consuming mechanism (emit site + registry entry), then it joins the lane. Same correction shape as NKLEIN_TRUNCATION_DIAGNOSTICS 2026-08-02.",
	},
	{
		flag: "NKLEIN_SPEC_DELIBERATION",
		kind: "pending_validation",
		reason:
			"adds a plan-mode deliberation step. DRAIN-GREEN one-at-a-time 2026-08-05 (solo flags_on run passed) — the remaining precondition is NOT another run: the lane ratchet only admits flags a REGISTERED MECHANISM claims, and none claims this one. Register a consuming mechanism (emit site + registry entry), then it joins the lane. Same correction shape as NKLEIN_TRUNCATION_DIAGNOSTICS 2026-08-02.",
	},
	{
		flag: "NKLEIN_VISUAL_GATE",
		kind: "pending_validation",
		reason:
			"adds a review gate. DRAIN-GREEN one-at-a-time 2026-08-05 (solo flags_on run passed) — the remaining precondition is NOT another run: the lane ratchet only admits flags a REGISTERED MECHANISM claims, and none claims this one. Register a consuming mechanism (emit site + registry entry), then it joins the lane. Same correction shape as NKLEIN_TRUNCATION_DIAGNOSTICS 2026-08-02.",
	},
	{
		flag: "NKLEIN_N_EYES_REVIEW",
		kind: "pending_validation",
		reason:
			"runs a different review procedure. DRAIN-GREEN one-at-a-time 2026-08-05 (solo flags_on run passed) — the remaining precondition is NOT another run: the lane ratchet only admits flags a REGISTERED MECHANISM claims, and none claims this one. Register a consuming mechanism (emit site + registry entry), then it joins the lane. Same correction shape as NKLEIN_TRUNCATION_DIAGNOSTICS 2026-08-02.",
	},
	{
		flag: "NKLEIN_ALLOW_UNSUITABLE_MODEL",
		kind: "permanent",
		reason:
			"DISABLES the model-suitability guard. A lane that enables it stops testing the guard and masks exactly the failures the drain should surface",
	},
	{
		flag: "NKLEIN_SANDBOX_SKIP_STARTUP_REAP",
		kind: "permanent",
		reason: "skips orphan-sandbox reaping — a nightly lane that leaks sandboxes every run degrades the host",
	},
	{
		flag: "NKLEIN_FLEET_DECOMPOSE_MODE",
		kind: "permanent",
		reason:
			'an ENUM ("smallest" | "capability_weighted" | "fixed_target" | "off"), not a boolean — the lane\'s "1" is not a valid value for it at all',
	},
	{
		flag: "NKLEIN_CHAT_MEMORY_WRITE",
		kind: "permanent",
		reason: "gates the CHAT surface; this lane replays a board drain, which never reaches it",
	},
	{
		flag: "NKLEIN_STRUCTURED_INGESTION",
		kind: "permanent",
		reason: "changes how fetched WEB content is parsed; the drain runs without egress, so it is unreachable here",
	},
	{
		flag: "NKLEIN_DEBUG_STREAM_EVENTS",
		kind: "permanent",
		reason: "pure debug logging at high volume; no mechanism reads it, so it adds noise and no evidence",
	},
	{
		flag: "NKLEIN_TRUNCATION_DIAGNOSTICS",
		kind: "pending_validation",
		reason:
			"NOT blocked on a nightly run — corrected 2026-08-02 after trying to add it and being refused by the lane ratchet. NO REGISTERED MECHANISM READS IT, so enabling it here adds recording nothing consumes: exactly the reason NKLEIN_DEBUG_STREAM_EVENTS is permanently excluded. The precondition is registering the mechanism that consumes truncation diagnostics, not another run.",
	},
	{
		flag: "NKLEIN_REASONING_CAPTURE",
		kind: "pending_validation",
		reason:
			"Same correction as NKLEIN_TRUNCATION_DIAGNOSTICS (2026-08-02): no registered mechanism reads it, so the lane ratchet refuses it and a nightly run cannot change that. Register a consuming mechanism first.",
	},
	{
		flag: "NKLEIN_MODEL_CONSULT",
		kind: "permanent",
		reason:
			"F3.37: structurally excluded for the SAME reason as NKLEIN_TOOL_GATE_ENFORCE, mirrored — where enforcement NARROWS the tools array, an admitted consult EXTENDS the tool tail of every stuck worker session, which changes those replayed requests and guarantees unmatched-request failures on any recording containing genuine failures. Its validation is the dedicated aimock+fleet A/B (consult-then-success vs cross_model_carry), not this lane.",
	},
	{
		flag: "NKLEIN_TOOL_GATE_ENFORCE",
		kind: "permanent",
		reason:
			"The ENFORCE arm of F12.18's paired A/B (built 2026-08-02 after the observe arm's real-drain verdict said `enforce`). Structurally excluded from the replay lane for the SAME reason as NKLEIN_LEAN_SYSPROMPT: when it fires it narrows the tools array, which changes every affected replayed request and guarantees unmatched-request failures — no run can green it here. Its validation is the paired A/B on REAL drains, not this lane.",
	},
	{
		flag: "NKLEIN_LEAN_SYSPROMPT",
		kind: "permanent",
		reason:
			"swaps the system prompt below a context threshold, so it would change EVERY replayed request — and aimock matches on the request. In a REPLAY lane that is not a validation risk, it is a guaranteed unmatched-request failure, so no run can ever green it. Reclassified from pending_validation 2026-08-02: labelling a structural impossibility as 'pending' invites someone to keep attempting it.",
	},
	{
		flag: "NKLEIN_STATEFUL_RESPONSES",
		kind: "permanent",
		reason:
			"changes the provider TRANSPORT, and its own stated reason — 'a replay lane is the wrong place to first exercise that' — is an argument about where this belongs, not about needing one more run. Reclassified from pending_validation 2026-08-02: it needs a REAL-transport exercise, which this lane structurally is not.",
	},
];
