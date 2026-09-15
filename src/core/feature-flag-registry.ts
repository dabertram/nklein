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
	{
		flag: "NKLEIN_LLMFIT_PRIOR",
		mode: "enforcing",
		gate: "nklein-llmfit-routing-prior.ts (isTruthyEnv)",
		note: "§5.AB opt-in: runs and caches `llmfit recommend` for score/tok-s routing priors, which CHANGE which model a card is routed to. Undeclared until 2026-09-08 — the coverage ratchet could not see the read because it goes through an INJECTED env rather than the literal `process.env`, so nothing could say whether turning it on was safe.",
	},
	{ flag: "NKLEIN_TOOL_GATE_ENFORCE", mode: "enforcing", gate: "nklein-context-focus-extension.ts" },
	{
		flag: "NKLEIN_BOUNCE_FORK_RETRY",
		mode: "enforcing",
		gate: "second-opinion-review-runner.ts (onBounce: rewind-to-boundary retry instead of the in-context re-drive)",
		note: "#37 acting half, David-authorized 2026-08-23. Eligibility via planBounceForkRetry (the observe stream keeps recording); every refusal/error falls back to the ordinary re-drive.",
	},
	{
		flag: "NKLEIN_PLAN_SIZING_ENFORCE",
		mode: "enforcing",
		gate: "nklein-decomposition-tool.ts (decompose_project: reject oversized planned tasks, remedy = expansions)",
		note: "P21.6b enforce half, David-authorized 2026-08-23. Evidence-first: only a PRESENT two-ceiling verdict enforces; missing evidence or a failed evidence read degrades to the observe-only stream.",
	},
	{
		flag: "NKLEIN_REFINEMENT_STALL_NUDGE",
		mode: "enforcing",
		gate: "nklein-task-session-service.ts turn-end seam (DecompositionStallNudger.maybeNudgeStalledRefinement: one begin_implementation re-prompt for a refinable --no-plan card that ended in Planning)",
		note: "Default-OFF worker-loop behaviour change (F1.21 observe-before-enforce). A refinable card that ends a turn without begin_implementation gets ONE bounded nudge to promote; gating in the pure decideRefinementStallRecovery. Flip ON only after a live-drain shows the model actually transitions (efficacy is empirical), protecting the accrual campaign's evidence from a misfire until then.",
	},
	{
		flag: "NKLEIN_LOOP_GUARD_AUTO_NUDGE",
		mode: "enforcing",
		gate: "nklein-task-session-service.ts buildGuardCallbacks (RepeatedToolCallGuard.autoNudgeBeforePark: ONE cancel-then-re-prompt per task instead of the loop-guard park; the second loop parks as before)",
		note: "Default-OFF worker-loop behaviour change (P1.LOOPGUARDNUDGE, 2026-09-15). In a headless run (SWE-bench arms, drains) the loop guard's park — 'send a new instruction to continue' — has nobody to answer it and the card is lost with nothing delivered (muse requests-1921, Legion pytest-7521). The rig/drain launchers set it; the interactive product keeps the park so an operator still sees a looping card.",
	},
	{
		flag: "NKLEIN_SKILL_API_DIRECT",
		mode: "dev_only",
		gate: 'skill-api-profile-agent-model.ts (value "off" bypasses the direct forced-tool/structured path; the SDK-native wire serves profile turns)',
		note: "Dschinn tee-capture 2026-08-30: the direct path's text-flattened history + toolChoice:required degraded a Flash-Next architect's payloads to minimal-valid junk. Rig kill-switch; unset keeps the validated forced path.",
	},
	{
		flag: "NKLEIN_ALTERNATE_ENDPOINT",
		mode: "dev_only",
		gate: 'nklein-session-runtime.ts model wiring (value "off" removes the text-wire alternate-endpoint recovery strategy)',
		note: 'Dschinn hunt 2026-08-30: one alternate-wire turn taught a Flash-Next architect the "[tool_call id=…]" pseudo-syntax and poisoned the session. Rig kill-switch; unset keeps the recovery available.',
	},
	{
		flag: "NKLEIN_STOP_STACKS",
		mode: "dev_only",
		gate: "nklein-task-session-service.ts stopTaskSession + vendored local-runtime-host.stopSession (caller-stack capture)",
		note: "Debugger directive 2026-08-30: headless-drain breakpoint equivalent — records the caller stack of every session stop (telemetry category stop_stack + runtime-log warn). Rig diagnosis only; zero cost when off.",
	},
	{
		flag: "NKLEIN_EMPTY_FINAL_REDRIVE",
		mode: "enforcing",
		gate: "nklein-task-session-service.ts turn-end seam (DecompositionStallNudger.maybeNudgeEmptyFinal: one continue re-prompt when a run ends on an EMPTY final — glitched-completion recovery, last rung)",
		note: "Rig/drain opt-in (2026-08-29, dschinn on Flash-Next): llama.cpp multi-slot slot-reuse degradation returned empty completions mid-run and the SDK read them as the final answer. Default OFF — mock/manual flows end legitimately on empty finals.",
	},
	{
		flag: "NKLEIN_DRIFT_REMEDY_ENFORCE",
		mode: "enforcing",
		gate: "nklein-session-runtime.ts (hands the extension the onOffTrackRemedy action callback)",
		note: "P18.4b acting half, default-OFF (F1.21 observe-before-enforce). Both remedies discard or freeze real work; flip ONLY per dev mechanism-decision on the off_track_remedy_observed stream — insufficient_data means keep observing, not flip.",
	},
	{
		flag: "NKLEIN_DRIFT_CRITIC",
		mode: "enforcing",
		gate: "nklein-session-runtime.ts (constructs the F12.92 drift-critic caller for worker-card sessions)",
		note: "Behaviour-affecting despite the observational-sounding name: an off-track verdict INJECTS a worker nudge. The remedy stays observe-only (off_track_remedy_observed); only the nudge acts. Registered 2026-08-11 when the missing production constructor was found — the flag had been read nowhere in src.",
	},
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
	{
		flag: "NKLEIN_REASONING_BREACH",
		mode: "enforcing",
		gate: "chat-local-llm-adapter.ts (chat turns) + nklein-session-runtime.ts (F3.36 b: the swarm-path reasoning-breach model wrapper)",
	},
	{ flag: "NKLEIN_REVIEW_LENSES", mode: "enforcing", gate: "runtime-config (force-enables lenses)" },
	{ flag: "NKLEIN_REVIEW_PANEL", mode: "enforcing", gate: "second-opinion-review-runner.ts (panel assembly)" },
	{ flag: "NKLEIN_RUNAWAY_ABORT", mode: "enforcing", gate: "nklein-session-runtime.ts (wraps the model)" },
	{ flag: "NKLEIN_WORKER_USE_ALL_LOADED", mode: "enforcing", gate: "start-task-session.ts (F2.34 worker auto-pool)" },
	{ flag: "NKLEIN_MAIN_CUSTODIAN", mode: "enforcing", gate: "runtime-server.ts (F2.35 main-branch custodian sweep)" },
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
	// 2026-09-07 v31 stall mechanisms (all default ON; `=0` disables):
	{
		flag: "NKLEIN_SANDBOX_LEAK_GATE",
		mode: "enforcing",
		gate: "second-opinion-review-runner.ts (P0.SANDBOXLEAK gate)",
	},
	{
		flag: "NKLEIN_LAZY_BASELINE_PROBE",
		mode: "enforcing",
		gate: "second-opinion-review-runner.ts (P0.LAZYBASELINE base-tree sample feeds the pre-existing waiver)",
	},
	// 2026-09-14 P0.POOLLOSS proactive fleet sweep (default ON; `=0` disables):
	{
		flag: "NKLEIN_FLEET_POOL_SWEEP",
		mode: "enforcing",
		gate: "runtime-server.ts (P0.POOLLOSS minute-cadence fleet pool sweep: loss → dead mark + observation + board notice)",
	},
	{
		flag: "NKLEIN_CAPTURE_KEEP_GENERATED_LOCKFILES",
		mode: "enforcing",
		gate: "nklein-agent-sandbox.ts (P0.LOCKFILECAPTURE — keeps install-generated lockfile churn in the patch)",
	},
	{
		flag: "NKLEIN_CARRY_PREEXISTING_BREAKAGE",
		mode: "enforcing",
		gate: "runtime-server.ts (inherited debt — set only to deliberately CARRY a pre-existing breakage instead of planning its repair)",
	},
	{
		flag: "NKLEIN_SANDBOX_NPM_CACHE_SEED",
		mode: "enforcing",
		gate: "nklein-sandbox-package-cache-seed.ts (P1.NPMSEED — warm per-workspace npm cache seeded into every placement)",
	},
	{
		flag: "NKLEIN_RESULT_BASE_REFRESH",
		mode: "enforcing",
		gate: "runtime-server.ts (P1.STALEBASE — a result captured on an older base head is re-captured onto the current one before review)",
	},
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
	{
		flag: "NKLEIN_CONSTRAINED_TOOL_CALL",
		mode: "enforcing",
		defaultOn: true,
		gate: 'nklein-session-runtime.ts model wiring (!== "off")',
		note:
			"P23.5 (2) 2026-09-14 kill switch — removes the swarm ladder's constrained_schema rung (forces a tool call the " +
			"model emitted without usable arguments over the direct local client: native tool_choice:required, then a " +
			"per-tool json_schema). Fires only after a malformed call, on one turn; the same flattened-prompt exposure " +
			"family as NKLEIN_ALTERNATE_ENDPOINT, but a structured reply is demanded.",
	},
	{
		flag: "NKLEIN_CONTEXT_OVERFLOW_REDRIVE",
		mode: "enforcing",
		defaultOn: true,
		gate: "nklein-context-overflow-terminal-controller.ts (maybeRecoverTerminalOverflow: isEnabledByDefaultEnv)",
		note: "P0.CTX500 2026-09-07: the terminal context-overflow ladder ahead of model failover (same-model compaction re-drive, then failover, then park). Off restores the pre-fix terminal handling: an overflow error terminal goes straight to the failover leg's model-side check.",
	},
	{ flag: "NKLEIN_REPO_VERIFY", mode: "enforcing", defaultOn: true, gate: "acceptance/verify path" },
	{ flag: "NKLEIN_STABLE_ROUTING_KEY", mode: "enforcing", defaultOn: true, gate: "nklein-task-session-service.ts" },
	{ flag: "NKLEIN_ARCHITECT_PROMPT_DIET", mode: "enforcing", defaultOn: true, gate: "prompt builders" },
	{ flag: "NKLEIN_JUDGE_PROMPT_DIET", mode: "enforcing", defaultOn: true, gate: "review prompt builders" },
	{ flag: "NKLEIN_SWARM_PROMPT_VARIATION", mode: "enforcing", defaultOn: true, gate: "swarm prompt builder" },
	{
		flag: "NKLEIN_RECONCILE_REDELIVERY_RULES",
		mode: "enforcing",
		defaultOn: true,
		gate: "runtime-server.ts (P0.RECONCILE-SKIP boot reconcile — decideReviewReconcileCandidate honourRedeliveryRules)",
		note: "kill switch — off restores the pre-fix boot: an approved card whose last delivery failed is re-finalized at once, the watchdog's 10-min gap and 24/day cap ignored (the re-delivery is still recorded)",
	},
	{
		flag: "NKLEIN_REVIEWER_CAPABILITY_RANKING",
		mode: "enforcing",
		defaultOn: true,
		gate: "nklein-reviewer-capability-evidence.ts (isEnabledByDefaultEnv)",
		note: "P0.REVRANK kill switch — disabling it ranks reviewer/critic/escalation candidates by catalog class fit alone again (no registry/ledger/fitness/verdict evidence, no strictly-stronger escalation gate), the capability-blind order that escalated a stuck review to a 9B",
	},
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
		flag: "NKLEIN_LLMFIT_PRIOR",
		kind: "permanent",
		reason:
			"shells out to the external `llmfit` binary for routing priors — the nightly lane is hermetic and offline, so enabling it would either fail or measure whether that binary happens to be installed",
	},
	// 2026-09-07 v31 stall mechanisms: default ON via isEnabledByDefaultEnv — `=0` is the opt-OUT, so the lane
	// already runs with every one of them enabled; there is nothing to switch on.
	{
		flag: "NKLEIN_SANDBOX_LEAK_GATE",
		kind: "permanent",
		reason: "default ON; `=0` is the opt-out — the lane already runs the sandbox-leak gate",
	},
	{
		flag: "NKLEIN_LAZY_BASELINE_PROBE",
		kind: "permanent",
		reason: "default ON; `=0` is the opt-out — the lane already samples the base tree on a red acceptance",
	},
	{
		flag: "NKLEIN_CARRY_PREEXISTING_BREAKAGE",
		kind: "permanent",
		reason:
			"an explicit OPT-OUT of taking pre-existing breakage into the plan; enabling it in the lane would restore the silent-decay behaviour the mechanism exists to remove",
	},
	{
		flag: "NKLEIN_SANDBOX_NPM_CACHE_SEED",
		kind: "permanent",
		reason: "default ON; `=0` is the opt-out — the lane already seeds and harvests the npm cache",
	},
	{
		flag: "NKLEIN_RESULT_BASE_REFRESH",
		kind: "permanent",
		reason: "default ON; `=0` is the opt-out — the lane already refreshes stale results onto the current base",
	},
	{
		flag: "NKLEIN_FLEET_POOL_SWEEP",
		kind: "permanent",
		reason: "default ON; `=0` is the opt-out — the lane already runs the fleet pool sweep",
	},
	{
		flag: "NKLEIN_CAPTURE_KEEP_GENERATED_LOCKFILES",
		kind: "permanent",
		reason:
			"an opt-OUT of P0.LOCKFILECAPTURE (keeps install churn in patches); enabling it would disable the mechanism under test",
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
		flag: "NKLEIN_REFINEMENT_STALL_NUDGE",
		kind: "pending_validation",
		reason:
			"A worker-loop behaviour change (one begin_implementation re-prompt for a wander-stuck refinable card) whose EFFICACY is empirical — does the model actually promote when nudged? Enabling it in the nightly replay lane before a live drain confirms that would bake an unvalidated behaviour into the baseline. The precondition is a live-drain validation (run cli-parser-medium --no-plan with the flag on, confirm the card transitions), not a replay run — then flip it on for real.",
	},
	{
		flag: "NKLEIN_LOOP_GUARD_AUTO_NUDGE",
		kind: "pending_validation",
		reason:
			"A worker-loop behaviour change (one automatic re-drive of a looping card before the loop-guard park) whose EFFICACY is empirical — does the re-prompted model stop looping and deliver? The SWE-bench pass-2 arms run with it on and their receipts (loop_guard_auto_nudge observations joined with resolved/unresolved) are the validation; until that lands it stays out of the replay baseline.",
	},
	{
		flag: "NKLEIN_EMPTY_FINAL_REDRIVE",
		kind: "pending_validation",
		reason:
			"A rig-recovery behaviour (one continue re-prompt when a run ends on an EMPTY final) targeting the llama.cpp multi-slot slot-reuse degradation observed live 2026-08-29. In the replay lane an empty final is a RECORDED legitimate ending — re-driving it would send an input the recording never contained and guarantee unmatched requests. Validation is a live Flash-Next drain with the flag on (does a glitched session resume and complete?), not a replay; flip for the lane only if it ever becomes default-relevant.",
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
