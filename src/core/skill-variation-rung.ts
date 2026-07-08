/**
 * §5.AE skill-variation escalation rung (ties §5.AA/§5.AB) — when a task stubbornly fails, propose a DIFFERENT skill
 * mix for the next attempt instead of re-running the identical prompt assembly. Pure decider: given the CURRENT skill
 * ids and the mixes already tried, walk a fixed escalation order of variations (add deliberation, add retrieval,
 * strip to the minimal core) and return the first NOT-yet-tried mix — or null when the variation space is exhausted
 * (the ladder moves to its next rung). Never repeats a mix (the §5.AA no-circles rule); the caller records tried
 * mixes + outcomes into the behavior profile so winning mixes are learned per model.
 */

export interface SkillVariationInput {
	/** The skill ids of the CURRENT (failing) attempt. */
	currentSkillIds: readonly string[];
	/** Every skill mix already tried for this task (each a set of ids), including the current one. */
	triedMixes: readonly (readonly string[])[];
	/** Skill ids that exist in the registry (a variation never proposes an unknown skill). */
	availableSkillIds: readonly string[];
}

export interface SkillVariationDecision {
	/** The next mix to try, or null when every variation has been tried (escalate past this rung). */
	nextSkillIds: string[] | null;
	/** Which variation produced it (for the ledger/profile). */
	variation: "add_planning" | "add_web_retrieval" | "minimal_core" | null;
}

/** Canonical set key: sorted ids joined — mix identity is order-insensitive. */
function mixKey(ids: readonly string[]): string {
	return [...new Set(ids)].sort().join("+");
}

export function nextSkillVariation(input: SkillVariationInput): SkillVariationDecision {
	const available = new Set(input.availableSkillIds);
	const tried = new Set(input.triedMixes.map(mixKey));
	tried.add(mixKey(input.currentSkillIds));

	const candidates: Array<{ variation: NonNullable<SkillVariationDecision["variation"]>; ids: string[] }> = [];
	// 1. Add deliberation: a failing mix often lacks an explicit plan (the planning bundle raises reasoning intensity).
	if (available.has("planning") && !input.currentSkillIds.includes("planning")) {
		candidates.push({ variation: "add_planning", ids: [...input.currentSkillIds, "planning"] });
	}
	// 2. Add retrieval: stale/absent knowledge is the other common stall (the §5.AC bundle brings search + freshness).
	if (available.has("web_retrieval") && !input.currentSkillIds.includes("web_retrieval")) {
		candidates.push({ variation: "add_web_retrieval", ids: [...input.currentSkillIds, "web_retrieval"] });
	}
	// 3. Strip to the minimal core: a weak model can also fail from prompt BLOAT — try the leanest viable mix.
	const core = input.currentSkillIds.filter((id) => id === "code_editing");
	if (core.length > 0 && mixKey(core) !== mixKey(input.currentSkillIds)) {
		candidates.push({ variation: "minimal_core", ids: core });
	}

	for (const candidate of candidates) {
		if (!tried.has(mixKey(candidate.ids))) {
			return { nextSkillIds: [...new Set(candidate.ids)], variation: candidate.variation };
		}
	}
	return { nextSkillIds: null, variation: null };
}
