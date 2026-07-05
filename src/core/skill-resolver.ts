/**
 * The §5.AE dynamic skill RESOLVER — picks the active skill set for a task/turn from the §5.AE `SKILL_REGISTRY`, honoring
 * the role-mode "dynamics level" the user chose. Pure + deterministic so it is fully testable and shared by the board +
 * chat prompt assembly. Its output (active skills → the deduped fragments + tools) is the *producer* the §5.AD smart-zone
 * arrangement orders and §6.2 caps: §5.AE decides WHAT is in the prompt, §5.AD WHERE it goes, §6.2 that it never overflows.
 */

import {
	type ContextFragmentId,
	fragmentsForSkills,
	getSkillById,
	resolveApiProfileForSkills,
	SKILL_REGISTRY,
	type Skill,
	type SkillApiProfile,
	type SkillId,
	skillRelevance,
	toolsForSkills,
} from "./skill-registry";

/**
 * How dynamic vs. strict the skill assignment is (BASIC control set; default = fully dynamic). The MODEL-pinning
 * difference between the two static levels is §5.AB's concern — for SKILL resolution both resolve the role's default
 * bundle; the level is carried through so the caller can apply the model policy.
 */
export type SkillDynamicsLevel = "fully_dynamic" | "static_skills_auto_model" | "assigned_skills" | "fully_static";

export const DEFAULT_SKILL_DYNAMICS_LEVEL: SkillDynamicsLevel = "fully_dynamic";

export interface ResolveActiveSkillsInput {
	/** The active role (architect | worker | reviewer | retriever | researcher | …), when known. */
	role?: string | null;
	/** The task / instruction text driving relevance. */
	taskText: string;
	/** The role-mode dynamics level (defaults to `fully_dynamic`). */
	dynamicsLevel?: SkillDynamicsLevel;
	/** The user-assigned skills (used only by the `assigned_skills` level). */
	assignedSkillIds?: readonly SkillId[];
	/** How many times this task has already failed — on `fully_dynamic`, a positive count VARIES the set (a §5.AA rung). */
	priorFailures?: number;
	/** Relevance score a skill must clear to be auto-included on `fully_dynamic` (default 0.6). */
	relevanceThreshold?: number;
}

export interface ActiveSkillSet {
	skills: Skill[];
	/** The deduped, ordered fragments the active skills need (feeds §5.AD arrangement). */
	fragments: ContextFragmentId[];
	/** The deduped tools the active skills need (still gated by §5.L at use time). */
	tools: string[];
	/** The dynamics level in force (echoed for the caller's model policy). */
	dynamicsLevel: SkillDynamicsLevel;
	/** §5.AE/§5.AN: the merged best-match API-feature profile for the active skills (model-capability-gated at the call seam). */
	apiProfile: SkillApiProfile;
	/** Inspectable reason for the chosen set (for §5.AG surfaces / debugging). */
	reason: string;
}

/** The default skill bundle for a role — the skills that name this role in `defaultRoles`. Case-insensitive: the role
 * is a free-form LLM `suggestedRole` ("Worker"), and `defaultRoles` are lowercase, so match on the normalized form. */
function defaultBundleForRole(role: string | null | undefined): Skill[] {
	const normalized = role?.trim().toLowerCase();
	if (!normalized) {
		return [];
	}
	return SKILL_REGISTRY.filter((skill) => skill.defaultRoles.includes(normalized));
}

/**
 * Resolve the active skills for this turn (pure). Per dynamics level: `assigned_skills` ⇒ exactly the user's list;
 * the two static levels ⇒ the role's default bundle (relevance-selected fallback when no role is known); `fully_dynamic`
 * ⇒ every skill clearing the relevance threshold (a default-role match scores 1.0, so the role bundle is always in),
 * sorted by relevance, and — when the task has already failed — augmented with one untried skill to break a stuck task.
 */
export function resolveActiveSkills(input: ResolveActiveSkillsInput): ActiveSkillSet {
	const dynamicsLevel = input.dynamicsLevel ?? DEFAULT_SKILL_DYNAMICS_LEVEL;
	const role = input.role ?? null;
	const threshold = input.relevanceThreshold ?? 0.6;

	let skills: Skill[];
	let reason: string;

	if (dynamicsLevel === "assigned_skills") {
		skills = (input.assignedSkillIds ?? [])
			.map((id) => getSkillById(id))
			.filter((skill): skill is Skill => skill !== null);
		reason = `assigned skills (${skills.map((skill) => skill.id).join(", ") || "none"})`;
	} else if (dynamicsLevel === "static_skills_auto_model" || dynamicsLevel === "fully_static") {
		const bundle = defaultBundleForRole(role);
		if (bundle.length > 0) {
			skills = bundle;
			reason = `static default bundle for role "${role}"`;
		} else {
			// No role to anchor the static bundle — fall back to relevance so the prompt is never skill-less.
			skills = selectByRelevance(input, threshold);
			reason = "static level with no role — fell back to relevance-selected skills";
		}
	} else {
		// fully_dynamic
		skills = selectByRelevance(input, threshold);
		reason = `dynamic by relevance (≥${threshold})`;
		const priorFailures = input.priorFailures ?? 0;
		if (priorFailures > 0) {
			// Escalate the variation WITH the failure count: the 2nd/3rd retry widens the skill mix instead of
			// re-trying the same single untried skill, so each rung of the §5.AA ladder is genuinely different.
			// Deterministic + saturating (a large count just adds all remaining registry skills, no duplicates).
			const extras = untriedSkills(skills, priorFailures);
			if (extras.length > 0) {
				skills = [...skills, ...extras];
				reason = `${reason}; varied for stuck task (+${extras.map((skill) => skill.id).join(",")})`;
			}
		}
	}

	return {
		skills,
		fragments: fragmentsForSkills(skills),
		tools: toolsForSkills(skills),
		dynamicsLevel,
		apiProfile: resolveApiProfileForSkills(skills),
		reason,
	};
}

/** Skills clearing the relevance threshold, sorted by relevance desc then registry order (stable). */
function selectByRelevance(input: ResolveActiveSkillsInput, threshold: number): Skill[] {
	const scored = SKILL_REGISTRY.map((skill, index) => ({
		skill,
		index,
		score: skillRelevance(skill, { role: input.role ?? null, taskText: input.taskText }),
	})).filter((entry) => entry.score >= threshold);
	scored.sort((left, right) => right.score - left.score || left.index - right.index);
	return scored.map((entry) => entry.skill);
}

/** The first `n` registry skills not already active (registry order) — the deterministic "widen the set" picks for
 *  a stuck task, scaled by the failure count. Saturates at the registry size (returns all remaining when n is large). */
function untriedSkills(active: readonly Skill[], n: number): Skill[] {
	if (n <= 0) {
		return [];
	}
	const activeIds = new Set(active.map((skill) => skill.id));
	return SKILL_REGISTRY.filter((skill) => !activeIds.has(skill.id)).slice(0, n);
}
