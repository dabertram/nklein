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
	},
	{
		id: "planning",
		description: "Decompose and design before acting (architect bundle).",
		defaultRoles: ["architect"],
		contextFragments: ["repo_map", "refinement_preamble"],
		tools: ["read_file", "list_dir"],
		preamble: "Plan the approach before making changes; decompose the work into ordered steps.",
		keywords: ["plan", "design", "decompose", "architecture", "approach", "break down", "strategy"],
	},
	{
		id: "review",
		description: "Review work for correctness and catch defects (reviewer bundle).",
		defaultRoles: ["reviewer"],
		contextFragments: ["focus_chain", "efficiency_rules"],
		tools: ["read_file", "run_command"],
		keywords: ["review", "check", "verify", "validate", "inspect", "audit", "correct"],
	},
	{
		id: "web_retrieval",
		description: "Look up current/external knowledge (retriever/researcher bundle).",
		defaultRoles: ["retriever", "researcher"],
		contextFragments: ["temporal", "freshness_rail", "online_retrieval"],
		tools: ["web_search", "browse_url"],
		keywords: ["search", "look up", "find out", "documentation", "online", "latest", "release"],
		temporalSensitive: true,
	},
];

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
