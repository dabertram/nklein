/**
 * The §5.AE Skill registry + context-fragment catalog — the PURE, hand-authored foundation for dynamic prompts. A
 * `Skill` is a small composable unit (a behavioural bundle): the context FRAGMENTS it needs, the TOOLS it needs, an
 * optional preamble, plus relevance signals (default roles + task keywords + temporal sensitivity). Roles become default
 * skill bundles; the §5.AE `resolveActiveSkills` resolver (built on top) picks the active set per task/turn, whose
 * fragments §5.AD arranges and §6.2 caps. Deliberately SMALL + hand-authored (the research caveat: skills are a
 * transitional layer — don't over-architect); grow as real usage demands. Pure + data-driven (no closures) so it is
 * trivially testable and serialisable.
 */

import { isTemporalContextRelevant } from "./temporal-awareness";

/**
 * The named prompt blocks that exist today as hard-coded always-on content — each becomes a fragment a skill can request,
 * so a turn carries only the blocks its active skills need (the JIT-prompt fix for the §5.AC date-everywhere waste).
 */
export type ContextFragmentId =
	| "temporal"
	| "repo_map"
	| "focus_chain"
	| "refinement_preamble"
	| "efficiency_rules"
	| "freshness_rail"
	| "online_retrieval";

export type SkillId = "code_editing" | "planning" | "review" | "web_retrieval";

/**
 * §5.AE/§5.AN per-skill API-feature profile — declares the BEST-MATCH LM Studio API configuration for this skill's work
 * (the levers the §5.AN sweep surfaced). The resolver merges the active skills' profiles; the model-call seam applies
 * each lever only if the chosen model actually supports it (§5.AN/§5.AL gate it — e.g. `/no_think` only for a
 * switch-capable family). The profile expresses INTENT; per-task difficulty (§5.AB) + per-model capability filter it.
 */
export interface SkillApiProfile {
	/** Reasoning intensity intent: `off` (`/no_think` for a switch-capable model) · `low` · `high` · `inherit` (model default). */
	reasoning?: "off" | "low" | "high" | "inherit";
	/** Prefer constrained structured output (`response_format json_schema`) for this skill's result. */
	structuredOutput?: boolean;
	/** Force a tool call (the constrained rung) when the model won't call on its own — PROACTIVELY (§5.AA: a no-call turn ends the loop). */
	forceToolCall?: boolean;
	/** Sampling temperature override for this skill's turns. */
	temperature?: number;
}

export interface Skill {
	id: SkillId;
	description: string;
	/** Roles for which this skill is a DEFAULT bundle member (an exact role match ⇒ maximal relevance). */
	defaultRoles: readonly string[];
	/** The context fragments this skill needs (feeds §5.AD arrangement + §6.3 budget). */
	contextFragments: readonly ContextFragmentId[];
	/** The tool names this skill needs (still pass the §5.L capability gate at use time). */
	tools: readonly string[];
	/** An optional one-line preamble the skill contributes to the system framing. */
	preamble?: string;
	/** Lowercased task-text signals that raise relevance when present (a soft signal, below a role match). */
	keywords: readonly string[];
	/** When true, a §5.AC temporal/freshness signal in the task (or a temporal role) raises relevance. */
	temporalSensitive?: boolean;
	/** §5.AE/§5.AN: the best-match API-feature configuration for this skill (resolver-merged; model-capability-gated). */
	apiProfile?: SkillApiProfile;
}

/** The hand-authored skill set (small by design). Each existing role maps to a default bundle here. */
export const SKILL_REGISTRY: readonly Skill[] = [
	{
		id: "code_editing",
		description: "Make and verify concrete code changes in the repo.",
		defaultRoles: ["worker"],
		contextFragments: ["repo_map", "focus_chain", "efficiency_rules"],
		tools: ["read_file", "list_dir", "edit_file", "run_command"],
		keywords: ["fix", "implement", "edit", "add", "refactor", "bug", "test", "code", "function", "file"],
		// Reasoning scales with task difficulty (modulated at the call site, §5.AB) — `inherit` = no fixed opinion.
		apiProfile: { reasoning: "inherit" },
	},
	{
		id: "planning",
		description: "Decompose and design before acting (architect bundle).",
		defaultRoles: ["architect"],
		contextFragments: ["repo_map", "refinement_preamble"],
		tools: ["read_file", "list_dir"],
		preamble: "Plan the approach before making changes; decompose the work into ordered steps.",
		keywords: ["plan", "design", "decompose", "architecture", "approach", "break down", "strategy"],
		// Planning/architecture benefits from deliberation.
		apiProfile: { reasoning: "high" },
	},
	{
		id: "review",
		description: "Review work for correctness and catch defects (reviewer bundle).",
		defaultRoles: ["reviewer"],
		contextFragments: ["focus_chain", "efficiency_rules"],
		tools: ["read_file", "run_command"],
		keywords: ["review", "check", "verify", "validate", "inspect", "audit", "correct"],
		// A reviewer benefits from deliberation to catch defects.
		apiProfile: { reasoning: "high" },
	},
	{
		id: "web_retrieval",
		description: "Look up current/external knowledge (retriever/researcher bundle).",
		defaultRoles: ["retriever", "researcher"],
		contextFragments: ["temporal", "freshness_rail", "online_retrieval"],
		tools: ["web_search", "browse_url"],
		keywords: ["search", "look up", "find out", "documentation", "online", "latest", "release"],
		temporalSensitive: true,
		// Retrieval results are consumed structured; prefer constrained JSON output.
		apiProfile: { structuredOutput: true },
	},
];

/** Reasoning-intensity rank for merging (higher = more deliberation). `inherit` carries no opinion (excluded). */
const REASONING_RANK: Record<"off" | "low" | "high", number> = { off: 0, low: 1, high: 2 };

/**
 * Merge the active skills' `apiProfile`s into one (pure). Per field, the STRONGEST need wins: reasoning takes the highest
 * explicit intensity (off<low<high; `inherit` is no-opinion and ignored); `structuredOutput`/`forceToolCall` are true if
 * ANY active skill asks; `temperature` takes the lowest defined (most deterministic). Returns `{}` when no skill opines.
 */
export function resolveApiProfileForSkills(skills: readonly Skill[]): SkillApiProfile {
	const profile: SkillApiProfile = {};
	let bestReasoningRank = -1;
	for (const skill of skills) {
		const p = skill.apiProfile;
		if (!p) {
			continue;
		}
		if (p.reasoning && p.reasoning !== "inherit") {
			const rank = REASONING_RANK[p.reasoning];
			if (rank > bestReasoningRank) {
				bestReasoningRank = rank;
				profile.reasoning = p.reasoning;
			}
		}
		if (p.structuredOutput) {
			profile.structuredOutput = true;
		}
		if (p.forceToolCall) {
			profile.forceToolCall = true;
		}
		if (typeof p.temperature === "number") {
			profile.temperature =
				profile.temperature === undefined ? p.temperature : Math.min(profile.temperature, p.temperature);
		}
	}
	return profile;
}

export interface SkillRelevanceInput {
	/** The active role (architect | worker | reviewer | retriever | researcher | …), when known. */
	role?: string | null;
	/** The task / instruction text. */
	taskText: string;
}

/**
 * Score a skill's relevance to a task/turn in [0, 1] (pure). A DEFAULT-role match dominates (1.0); otherwise a task
 * keyword hit is a soft signal (0.6), and a temporal/freshness signal lifts a temporally-sensitive skill (0.7, reusing
 * the §5.AC predicate). 0 ⇒ not relevant for this turn.
 */
export function skillRelevance(skill: Skill, input: SkillRelevanceInput): number {
	if (input.role && skill.defaultRoles.includes(input.role)) {
		return 1;
	}
	const text = input.taskText.toLowerCase();
	let score = 0;
	for (const keyword of skill.keywords) {
		if (text.includes(keyword)) {
			score = Math.max(score, 0.6);
			break;
		}
	}
	if (skill.temporalSensitive && isTemporalContextRelevant({ text: input.taskText, role: input.role ?? null })) {
		score = Math.max(score, 0.7);
	}
	return score;
}

/** Look up a skill by id (pure). */
export function getSkillById(id: SkillId): Skill | null {
	return SKILL_REGISTRY.find((skill) => skill.id === id) ?? null;
}

/** The deduped, order-preserving union of every fragment the given skills need — feeds §5.AD arrangement. */
export function fragmentsForSkills(skills: readonly Skill[]): ContextFragmentId[] {
	const seen = new Set<ContextFragmentId>();
	const out: ContextFragmentId[] = [];
	for (const skill of skills) {
		for (const fragment of skill.contextFragments) {
			if (!seen.has(fragment)) {
				seen.add(fragment);
				out.push(fragment);
			}
		}
	}
	return out;
}

/** The deduped, order-preserving union of every tool the given skills need (still gated by §5.L at use time). */
export function toolsForSkills(skills: readonly Skill[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const skill of skills) {
		for (const tool of skill.tools) {
			if (!seen.has(tool)) {
				seen.add(tool);
				out.push(tool);
			}
		}
	}
	return out;
}
