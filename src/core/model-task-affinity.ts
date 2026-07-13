/**
 * Best-fit affinity tags (§5.AB/§5.AE) — the small shared vocabulary that lets the router match a TASK to a MODEL
 * without either side knowing the other's taxonomy. A model's §5.AL {@link ModelKind} and a card's resolved
 * {@link SkillId}s both project onto the SAME opaque tags; the router (`routeNKleinTask`) simply prefers, among feasible
 * candidates, the one whose tags overlap the task's tags most (see `taskAffinityTags`). Keeping the tags opaque is what
 * keeps the router decoupled from both enums — the mapping lives here, in one pure place.
 *
 * This is the §5.AB "model auto-selection" half of the vision (the §5.AE skill resolver is the per-card half): with no
 * manual role→model config, a code-editing card gravitates to a `code` model and a planning card to a `reasoning` one.
 */

import type { ModelKind } from "./model-capability-catalog";
import type { SkillId } from "./skill-registry";

/** Opaque strength/need tags shared by models and tasks. The router intersects them; it never interprets them. */
export type AffinityTag = "code" | "reasoning" | "agentic" | "instruct" | "web";

/** What each §5.AL model KIND is good at. A coder/agentic model overlaps code+agentic work; a chat model only the
 * generic instruct lane; roleplay/unknown carry no work signal (so they never win on affinity, only on raw capability). */
const MODEL_KIND_AFFINITY: Record<ModelKind, readonly AffinityTag[]> = {
	code: ["code", "agentic"],
	agentic: ["agentic", "code"],
	reasoning: ["reasoning"],
	instruct: ["instruct"],
	chat: ["instruct"],
	roleplay: [],
	unknown: [],
};

/** What each §5.AE skill NEEDS from a model. Mirrors the kind map so a card's resolved skills name the same tags a
 * fitting model carries (code_editing↔code model, planning↔reasoning model, review wants reasoning+code, …). */
const SKILL_AFFINITY: Record<SkillId, readonly AffinityTag[]> = {
	code_editing: ["code", "agentic"],
	planning: ["reasoning"],
	review: ["reasoning", "code"],
	web_retrieval: ["agentic", "web"],
	// Self-awareness reads/reasons over the repo — a reasoning-capable model that can navigate code.
	self_awareness: ["reasoning", "code"],
};

/** The affinity tags a model of this kind carries (empty for an unknown/absent kind — no affinity preference). */
export function affinityTagsForModelKind(kind: ModelKind | null | undefined): readonly AffinityTag[] {
	return kind ? MODEL_KIND_AFFINITY[kind] : [];
}

/** The union of affinity tags the given skills need (deduped, order-stable). Empty ⇒ no task-side preference. */
export function affinityTagsForSkills(skillIds: Iterable<SkillId>): AffinityTag[] {
	const tags = new Set<AffinityTag>();
	for (const id of skillIds) {
		for (const tag of SKILL_AFFINITY[id] ?? []) {
			tags.add(tag);
		}
	}
	return [...tags];
}

/**
 * Affinity tags inferred directly from RUNTIME capability facts (LM Studio's `/api/v1/models` per-model card — the
 * empirical ground truth, not a static catalog guess): a declared `reasoning` capability ⇒ `reasoning`; a coder name ⇒
 * `code`; `trained_for_tool_use` ⇒ `agentic`. Every LLM also gets the generic `instruct` lane. Combine the result with
 * {@link affinityTagsForModelKind} (catalog) via a Set so the two signals reinforce (e.g. a custom merge the catalog
 * knows is a reasoner still gets `reasoning` even when the API card omits the flag).
 */
export function affinityTagsForCapabilities(input: {
	reasoning?: boolean;
	toolUse?: boolean;
	coder?: boolean;
}): AffinityTag[] {
	const tags = new Set<AffinityTag>(["instruct"]);
	if (input.reasoning) {
		tags.add("reasoning");
	}
	if (input.coder) {
		tags.add("code");
	}
	if (input.toolUse) {
		tags.add("agentic");
	}
	return [...tags];
}
