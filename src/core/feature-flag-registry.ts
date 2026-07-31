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

	// ── unclassified: read but genuinely ambiguous. NEVER treated as safe. ──
	{
		flag: "NKLEIN_ADAPTIVE_RETRY",
		mode: "unclassified",
		gate: "nklein-adaptive-budget-controller.ts (passed as adaptiveRetryEnabled)",
		note: "fed into a controller decision; whether the decision only RECORDS or also retries was not traced",
	},
	{
		flag: "NKLEIN_RESIDENCY_HEARTBEAT",
		mode: "unclassified",
		gate: "nklein-model-residency-watcher.ts",
		note: "a heartbeat may merely OBSERVE residency loss or actively KEEP a model resident; not traced",
	},
	{
		flag: "NKLEIN_N_EYES_REVIEW",
		mode: "unclassified",
		gate: "second-opinion-review-runner.ts",
		note: "only a log line was read at the grep site; its effect on panel assembly was not traced",
	},
];

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
