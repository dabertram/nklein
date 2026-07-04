/**
 * §5.AE chat-session skill profile (pure) — resolve a chat session's USER-SELECTED skill ids into a merged
 * {@link SkillApiProfile}. David's decision (2026-07-04): a chat session's skills are user-selected per session (the
 * user picks which skills are enabled/allowed), so THIS resolves that selection into the profile the model-call seam
 * folds in via {@link ./skill-api-profile-apply}. Unknown ids are dropped (validated against {@link SKILL_REGISTRY}),
 * duplicates collapse, and the merge is the registry's own {@link resolveApiProfileForSkills} (reasoning = strongest,
 * structuredOutput / forceToolCall = OR-any, temperature = min). An empty / all-unknown selection yields `{}` — inert,
 * so the fold leaves the model call byte-identical.
 */

import { resolveApiProfileForSkills, SKILL_REGISTRY, type Skill, type SkillApiProfile } from "./skill-registry.js";

/** The skill ids a chat session may select (the hand-authored registry set) — for validation + the UI selector. */
export const SELECTABLE_CHAT_SKILL_IDS: readonly string[] = SKILL_REGISTRY.map((skill) => skill.id);

/** Merge the api-profiles of a chat session's user-selected skills (unknown ids dropped, duplicates collapsed). Pure. */
export function resolveSelectedSkillsApiProfile(selectedSkillIds: readonly string[]): SkillApiProfile {
	const seen = new Set<string>();
	const skills: Skill[] = [];
	for (const id of selectedSkillIds) {
		if (seen.has(id)) {
			continue;
		}
		seen.add(id);
		// Compare against the registry directly (SkillId is a closed union; an unknown string simply never matches).
		const skill = SKILL_REGISTRY.find((candidate) => candidate.id === id);
		if (skill) {
			skills.push(skill);
		}
	}
	return resolveApiProfileForSkills(skills);
}
