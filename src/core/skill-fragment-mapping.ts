/**
 * §5.AE skill-fragment → prompt-assembly mapping — DRAFT PROPOSAL (David decision-10, 2026-07-04), held for approval.
 *
 * PROBLEM (verified): the skill registry names context fragments with UNDERSCORES ({@link ContextFragmentId}:
 * `temporal`, `repo_map`, `focus_chain`, `refinement_preamble`, `efficiency_rules`, `freshness_rail`,
 * `online_retrieval`), but the assembler ({@link PromptFragment}) takes free-form HYPHENATED keys (`base`,
 * `efficiency-rules`, `temporal-context`, …) bucketed by volatility. There is no bridge between the two id spaces, and
 * `repo_map` / `focus_chain` have no assembler fragment yet.
 *
 * THIS DRAFT proposes the bridge as a PURE table: each registry fragment id → its canonical assembler key, volatility
 * class, and PRODUCER STATUS. It is NOT wired into `assembleSessionSystemPrompt` — it's a proposal for David to approve
 * (or amend the keys/volatilities) before it goes live. Producer status:
 *   - `wired`         — the text already exists in the runtime and just needs routing to this key.
 *   - `needs_producer`— no producer exists yet; the block is aspirational (`repo_map`, `focus_chain`) and needs a
 *                       real builder before enabling. Marked so nothing silently injects an empty fragment.
 *
 * Canonicalization rule proposed: assembler keys are hyphenated lowercase; the registry underscore id maps to the
 * hyphenated key, expanding two names that the assembler already spells differently (`temporal`→`temporal-context`).
 */

import type { PromptFragmentVolatility } from "./prompt-fragment-assembly";
import type { ContextFragmentId } from "./skill-registry";

export type FragmentProducerStatus = "wired" | "needs_producer";

export interface SkillFragmentMapping {
	/** The registry id (underscored). */
	fragmentId: ContextFragmentId;
	/** The proposed canonical assembler key (hyphenated lowercase). */
	assemblerKey: string;
	/** The volatility bucket that decides its assembly order (slowest-changing first). */
	volatility: PromptFragmentVolatility;
	/** Whether a text producer exists today, or the block is aspirational and needs one built first. */
	producer: FragmentProducerStatus;
}

/** DRAFT table — the proposed mapping for every {@link ContextFragmentId}. Ordered by ascending volatility. */
export const DRAFT_SKILL_FRAGMENT_MAPPINGS: readonly SkillFragmentMapping[] = [
	{ fragmentId: "refinement_preamble", assemblerKey: "refinement-preamble", volatility: "static", producer: "wired" },
	{ fragmentId: "efficiency_rules", assemblerKey: "efficiency-rules", volatility: "static", producer: "wired" },
	{ fragmentId: "temporal", assemblerKey: "temporal-context", volatility: "daily", producer: "wired" },
	{ fragmentId: "freshness_rail", assemblerKey: "freshness-rail", volatility: "daily", producer: "wired" },
	// Aspirational — no skill-fragment producer today (the runtime builds a repo map / focus chain via other seams,
	// not as an assembler fragment). Do NOT enable until a real producer is wired, else an empty block is injected.
	{ fragmentId: "repo_map", assemblerKey: "repo-map", volatility: "task", producer: "needs_producer" },
	{ fragmentId: "focus_chain", assemblerKey: "focus-chain", volatility: "turn", producer: "needs_producer" },
	{ fragmentId: "online_retrieval", assemblerKey: "online-retrieval", volatility: "turn", producer: "wired" },
];

const BY_ID: ReadonlyMap<ContextFragmentId, SkillFragmentMapping> = new Map(
	DRAFT_SKILL_FRAGMENT_MAPPINGS.map((mapping) => [mapping.fragmentId, mapping]),
);

/** Resolve a registry fragment id to its proposed assembler mapping (draft). Total over the {@link ContextFragmentId} union. */
export function resolveSkillFragmentMapping(fragmentId: ContextFragmentId): SkillFragmentMapping {
	const mapping = BY_ID.get(fragmentId);
	if (!mapping) {
		// Unreachable while the table covers the union (a parity test pins this); fail-soft to a static stub.
		return {
			fragmentId,
			assemblerKey: fragmentId.replaceAll("_", "-"),
			volatility: "static",
			producer: "needs_producer",
		};
	}
	return mapping;
}
