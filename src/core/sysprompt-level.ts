/**
 * §5.AQ A+B+C — the TIERED SYSPROMPT: a user-facing "sysprompt size" ladder, an AUTO selector, and the intent-mode knob.
 *
 * Pure + deterministic (no I/O, no SDK, no registry) so the `level → component-set` policy and the AUTO `inputs → level`
 * decision are unit-testable in isolation, ahead of wiring into prompt assembly.
 *
 * WHY this exists (the research, §5.AQ pillars 1 & "empirical justification"):
 *  - **LEAN + JIT + MODULAR.** The goal is the "smallest set of HIGH-SIGNAL tokens" (Anthropic). **Minimal ≠ short** — every
 *    level keeps load-bearing content (identity + the non-negotiable safety/output rules + tool *names*); we drop DETAIL
 *    (schemas, examples, skill bodies), never the few instructions whose removal measurably hurts (Aider: dropping the
 *    high-level-diff guidance → +30-50% edit errors). Bloat actively DEGRADES quality (attention dilution / context-rot /
 *    lost-in-the-middle), not just cost.
 *  - **Length alone collapses small/open models hardest** — up to ~85% loss from length alone (arXiv 2510.05381); on a 32k
 *    local window a 14k fixed prompt is ~44% gone BEFORE the task. So we (a) cap the prompt at what the WINDOW affords and
 *    (b) take no more depth than the TASK needs, leaving headroom for the actual task content/retrieval.
 *  - **Progressive disclosure / JIT.** Higher levels add a skill/tool INDEX (names-only) and then full schemas/bodies; the
 *    detail is meant to load on demand, so the resident prefix stays lean (the §5.AE skill-set + §5.O tool-card direction).
 *
 * THREE knobs, combined:
 *  1. {@link SysPromptLevel} — five ADDITIVE depth levels (minimal→max); each level's component set is a strict SUPERSET of
 *     the one below ({@link SYSPROMPT_LEVEL_COMPONENTS}), so "going up a level" only ever ADDS sections — never swaps or
 *     drops them. This is what makes the ladder safe and what {@link resolveSysPromptComponents} returns.
 *  2. AUTO ({@link selectSysPromptLevel}) — pick the level from the available context window AND the task's complexity, then
 *     bias by the intent mode. `base = min(windowCap, complexityNeed)`: you can't exceed what the window affords, and you
 *     don't need more depth than the task wants.
 *  3. Intent mode ({@link SysPromptMode}) — `balance` keeps `base`; `minimize` and `max_task_info` both step DOWN one level
 *     (clamped at minimal). They lean smaller for DIFFERENT reasons (kept as distinct types): `minimize` = smallest level
 *     that still works; `max_task_info` = drive the sysprompt to its leanest viable level to FREE the most window for task
 *     content/retrieval. The clamp happens to be identical here, but the intent — and future calibration — differ.
 *
 * Calibration note: the per-level token budgets in §5.AQ (L0 ≤~250 tok … L4 6k+) live in prompt assembly, not here — this
 * core only owns the ORDERING and the WHICH-COMPONENTS / WHICH-LEVEL policy. The window thresholds below are the AUTO gate.
 */

/** The five additive sysprompt depth levels, leanest → richest (§5.AQ A: L0 minimal … L4 max). */
export type SysPromptLevel = "minimal" | "lean" | "balanced" | "full" | "max";

/** The levels in ascending depth order (minimal → max). Index in this array is the canonical level ordinal. */
export const SYSPROMPT_LEVELS: readonly SysPromptLevel[] = ["minimal", "lean", "balanced", "full", "max"];

/**
 * A modular sysprompt component (a gateable section). Levels are built by ACCUMULATING these (never removing), so a richer
 * level is always a superset of a leaner one. Ordered roughly by the level at which each first appears.
 */
export type SysPromptComponent =
	// minimal — the irreducible, always-resident core (identity + hard rules + tool names).
	| "identity"
	| "safety_rules"
	| "tool_names"
	// lean — + how to respond and a one-liner per tool.
	| "output_contract"
	| "tool_descriptions"
	// balanced (default) — + one worked example, the core workflow, and a JIT names-only skill/tool index.
	| "canonical_example"
	| "workflow"
	| "skill_index"
	// full — + full schemas for the active tool subset, more examples, recovery guidance, project conventions.
	| "tool_schemas"
	| "examples"
	| "recovery_guidance"
	| "project_conventions"
	// max — + extended thinking, self-critique, and full domain skill bodies (hard tasks on big-context strong models).
	| "extended_thinking"
	| "self_critique"
	| "domain_skill_bodies";

/**
 * The components present at each level — STRICTLY ADDITIVE: every level contains all components of the level below it plus
 * its own additions. Authored as `lower + additions` so the superset invariant is structural, not a thing to remember.
 */
const MINIMAL_COMPONENTS: readonly SysPromptComponent[] = ["identity", "safety_rules", "tool_names"];
const LEAN_COMPONENTS: readonly SysPromptComponent[] = [...MINIMAL_COMPONENTS, "output_contract", "tool_descriptions"];
const BALANCED_COMPONENTS: readonly SysPromptComponent[] = [
	...LEAN_COMPONENTS,
	"canonical_example",
	"workflow",
	"skill_index",
];
const FULL_COMPONENTS: readonly SysPromptComponent[] = [
	...BALANCED_COMPONENTS,
	"tool_schemas",
	"examples",
	"recovery_guidance",
	"project_conventions",
];
const MAX_COMPONENTS: readonly SysPromptComponent[] = [
	...FULL_COMPONENTS,
	"extended_thinking",
	"self_critique",
	"domain_skill_bodies",
];

/**
 * Level → its full component set (additive; each a superset of the one below). The canonical source of truth for what a
 * level contains; {@link resolveSysPromptComponents} returns a fresh copy of the matching entry.
 */
export const SYSPROMPT_LEVEL_COMPONENTS: Record<SysPromptLevel, SysPromptComponent[]> = {
	minimal: [...MINIMAL_COMPONENTS],
	lean: [...LEAN_COMPONENTS],
	balanced: [...BALANCED_COMPONENTS],
	full: [...FULL_COMPONENTS],
	max: [...MAX_COMPONENTS],
};

/** Resolve a level to the components it includes (a fresh array, so callers may sort/filter without mutating the table). */
export function resolveSysPromptComponents(level: SysPromptLevel): SysPromptComponent[] {
	return [...SYSPROMPT_LEVEL_COMPONENTS[level]];
}

/**
 * Intent mode — biases AUTO selection (§5.AQ C). `minimize` = smallest level that still clears the task's bar; `balance` =
 * trade prompt depth vs task-info room (no bias); `max_task_info` = drive the sysprompt to its leanest viable level to FREE
 * the most window for task content/retrieval. (`minimize` and `max_task_info` are distinct INTENTS even where the bias coincides.)
 */
export type SysPromptMode = "minimize" | "balance" | "max_task_info";

/** How demanding the task is — drives how much sysprompt DEPTH it warrants (§5.AQ B: size/complexity/role/knowledge-debt). */
export type TaskComplexity = "trivial" | "standard" | "complex" | "novel";

/** Inputs to the AUTO level selector: the window the prompt may occupy, the task's complexity, and the intent bias. */
export interface SelectSysPromptLevelInput {
	/** The available (quality-effective) context budget in TOKENS — the window the system prompt is allowed to occupy. */
	availableContextTokens: number;
	/** How demanding the task is (drives the depth it warrants). */
	taskComplexity: TaskComplexity;
	/** The intent-mode bias applied after `base = min(windowCap, complexityNeed)`. */
	mode: SysPromptMode;
}

/** Ordinal of a level in {@link SYSPROMPT_LEVELS} (its ascending-depth position). */
function levelOrdinal(level: SysPromptLevel): number {
	return SYSPROMPT_LEVELS.indexOf(level);
}

/** The LOWER (leaner) of two levels by ascending-depth order. */
function lowerLevel(a: SysPromptLevel, b: SysPromptLevel): SysPromptLevel {
	return levelOrdinal(a) <= levelOrdinal(b) ? a : b;
}

/** Step DOWN one depth level, clamped at `minimal` (the leanest level — never below the irreducible core). */
function stepDown(level: SysPromptLevel): SysPromptLevel {
	const next = SYSPROMPT_LEVELS[Math.max(0, levelOrdinal(level) - 1)];
	return next ?? "minimal";
}

/**
 * The richest level the WINDOW affords (§5.AQ B). A 14k fixed prompt on a 32k window is already ~44% gone, so AUTO never
 * lets the window be the thing that overruns: thresholds (tokens) `<2000 → minimal`, `<8000 → lean`, `<32000 → balanced`,
 * `<128000 → full`, else `max`. (Boundaries are EXCLUSIVE upper bounds: exactly 8000 → balanced, 32000 → full, 128000 → max.)
 */
export function windowCapLevel(availableContextTokens: number): SysPromptLevel {
	if (availableContextTokens < 2000) {
		return "minimal";
	}
	if (availableContextTokens < 8000) {
		return "lean";
	}
	if (availableContextTokens < 32000) {
		return "balanced";
	}
	if (availableContextTokens < 128000) {
		return "full";
	}
	return "max";
}

/** The depth the TASK warrants (§5.AQ B): trivial→minimal, standard→balanced, complex→full, novel→max. */
export function complexityNeedLevel(taskComplexity: TaskComplexity): SysPromptLevel {
	switch (taskComplexity) {
		case "trivial":
			return "minimal";
		case "standard":
			return "balanced";
		case "complex":
			return "full";
		case "novel":
			return "max";
	}
}

/**
 * AUTO-select the sysprompt level (§5.AQ B+C). `base = min(windowCap, complexityNeed)` — you can't exceed what the window
 * affords, and you don't need more depth than the task wants — then the intent {@link SysPromptMode} biases it: `balance`
 * keeps `base`; `minimize` and `max_task_info` both step down one level (clamped at `minimal`) to free window for task
 * content. Always leaves the sysprompt at or below what the window can hold.
 */
export function selectSysPromptLevel(input: SelectSysPromptLevelInput): SysPromptLevel {
	const windowCap = windowCapLevel(input.availableContextTokens);
	const complexityNeed = complexityNeedLevel(input.taskComplexity);
	const base = lowerLevel(windowCap, complexityNeed);

	switch (input.mode) {
		case "balance":
			return base;
		case "minimize":
		case "max_task_info":
			// Both lean smaller (distinct intents, same clamp here): step down one level, never below minimal.
			return stepDown(base);
	}
}

// ─── F4.37 first live consumer (evidence 2026-07-18): the judge-session prompt diet ────────────────────────────
//
// Controlled A/B on the fleet: with the full ~19.8KB worker system prompt, gemma-4-31b produced finish=length,
// EMPTY content, and no `submit_review` call on a trivial review — the exact live "no submission" failure that
// parked every review chain; with a lean system prompt the same model submitted a clean verdict immediately.
// Judgment sessions (review / plan-critique / merge) judge presented materials — they do not need the worker's
// operating manual, and carrying it actively breaks small/medium reviewers.

/** Session kinds that judge presented work rather than produce it. */
export const JUDGE_SESSION_KINDS = new Set(["review", "plan-critique", "merge", "architect-brief"]);

/**
 * The minimal judge base prompt: identity + tool posture + the submission contract. The seed (user message)
 * carries every task-specific detail. Static text ⇒ a cache-stable shell across judge sessions.
 */
export const JUDGE_MINIMAL_BASE_PROMPT = [
	"You are !Klein's focused SPECIALIST for exactly one bounded deliverable (a review, plan critique, merge decision, or implementation brief).",
	"Judge ONLY what is presented plus anything you verify yourself with the available read/inspection tools — use them when the presented materials are not enough.",
	"Be concrete and evidence-based; cite files/lines for findings.",
	"You MUST conclude by calling the required submission tool named in the task (e.g. submit_review) with your verdict — prose without the tool call is a failed session.",
].join(" ");

export interface JudgePromptDietInput {
	basePrompt: string;
	baseIsStaticShell: boolean;
	efficiencyRules: string;
	planningPrompt: string | null;
	attemptRetryNote: string | null;
	skillFragments: readonly unknown[];
}

/**
 * Apply the judge-session prompt diet: swap the worker shell for the minimal judge base and drop worker-only
 * sections (efficiency rules, planning, retry notes, skill fragments). Pure; the caller applies it only for
 * {@link JUDGE_SESSION_KINDS} (and may expose an env opt-out).
 */
export function applyJudgeSessionPromptDiet<T extends JudgePromptDietInput>(input: T): T {
	return {
		...input,
		basePrompt: JUDGE_MINIMAL_BASE_PROMPT,
		baseIsStaticShell: true,
		efficiencyRules: "",
		planningPrompt: null,
		attemptRetryNote: null,
		skillFragments: [],
	};
}
