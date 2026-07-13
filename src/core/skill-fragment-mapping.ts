/**
 * §5.AE skill-fragment → prompt-assembly mapping — APPROVED (David decision-10, 2026-07-04).
 *
 * PROBLEM (verified): the skill registry names context fragments with UNDERSCORES ({@link ContextFragmentId}:
 * `temporal`, `repo_map`, `focus_chain`, `refinement_preamble`, `efficiency_rules`, `freshness_rail`,
 * `online_retrieval`), but the assembler ({@link PromptFragment}) takes free-form HYPHENATED keys (`base`,
 * `efficiency-rules`, `temporal-context`, …) bucketed by volatility. This is the canonical bridge between the two id
 * spaces: each registry fragment id → its canonical assembler key, volatility class, and PRODUCER STATUS.
 *
 * The bridge is applied by {@link ./skill-prompt-fragments}.buildSkillPromptFragments, which routes only `wired`
 * fragments (and drops empty text), so a `needs_producer` fragment can never silently inject an empty block. Producer
 * status (reconciled 2026-07-04 against the real assembler seam — several drafts were optimistic):
 *   - `wired`         — a system-prompt producer exists AND yields a text block that can be pushed to the assembler
 *                       under this key WITHOUT duplicating an existing injection. Today: `efficiency_rules` +
 *                       `temporal` only (both already produced + keyed at the session-prompt seam).
 *   - `needs_producer`— no clean assembler-fragment producer yet, so routing it is deferred until one is built:
 *                       `repo_map` (no prompt producer — built for a status panel), `focus_chain` (formatter exists but
 *                       is injected as a per-turn message, not a system fragment), `freshness_rail` (text is embedded
 *                       inside the temporal block, not independently extractable), `refinement_preamble` (producer
 *                       exists but reaches the prompt via a different concat seam — routing it here would double it),
 *                       `online_retrieval` (only a tool description exists, no system-prompt block).
 *
 * Canonicalization rule: assembler keys are hyphenated lowercase; the registry underscore id maps to the hyphenated
 * key, expanding two names the assembler already spells differently (`temporal`→`temporal-context`).
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

/** Approved table — the mapping for every {@link ContextFragmentId}. Ordered by ascending volatility. */
export const SKILL_FRAGMENT_MAPPINGS: readonly SkillFragmentMapping[] = [
	// Producer exists but reaches the prompt via a separate concat seam (buildNKleinRefinementSystemPrompt →
	// appendSystemPrompt) — routing it as a fragment too would DOUBLE it, so it's needs_producer for the assembler path.
	{
		fragmentId: "refinement_preamble",
		assemblerKey: "refinement-preamble",
		volatility: "static",
		producer: "needs_producer",
	},
	{ fragmentId: "efficiency_rules", assemblerKey: "efficiency-rules", volatility: "static", producer: "wired" },
	{ fragmentId: "temporal", assemblerKey: "temporal-context", volatility: "daily", producer: "wired" },
	// Text is embedded INSIDE the temporal block (TEMPORAL_FRESHNESS_FRAMING), not independently extractable — extract
	// it to its own producer before routing separately, else it duplicates the temporal fragment's framing.
	{ fragmentId: "freshness_rail", assemblerKey: "freshness-rail", volatility: "daily", producer: "needs_producer" },
	// WIRED (2026-07-04): buildSessionSkillFragments produces this from buildNKleinRepoMap().rendered — the one
	// fragment genuinely absent from the system prompt, so routing it adds real new value (a repo map for a
	// code/planning session) with no duplication.
	{ fragmentId: "repo_map", assemblerKey: "repo-map", volatility: "task", producer: "wired" },
	// focus_chain is already effectful as a live PER-TURN rail message (nklein-focus-chain-rail.ts) — it is
	// turn-volatile, so it belongs in the message stream, NOT a static system fragment; needs_producer for THIS path.
	{ fragmentId: "focus_chain", assemblerKey: "focus-chain", volatility: "turn", producer: "needs_producer" },
	// Only a tool DESCRIPTION exists (the research tool), no system-prompt block producer.
	{ fragmentId: "online_retrieval", assemblerKey: "online-retrieval", volatility: "turn", producer: "needs_producer" },
	// F2.19/F2.20: the klein_self corpus (routeKleinSelfCorpus + buildKleinCorpusProvenance exist as cores) reaches
	// the prompt via the self-scope answer seam, not the static assembler — needs_producer until that seam routes it.
	{
		fragmentId: "klein_self_corpus",
		assemblerKey: "klein-self-corpus",
		volatility: "task",
		producer: "needs_producer",
	},
];

const BY_ID: ReadonlyMap<ContextFragmentId, SkillFragmentMapping> = new Map(
	SKILL_FRAGMENT_MAPPINGS.map((mapping) => [mapping.fragmentId, mapping]),
);

/** Resolve a registry fragment id to its assembler mapping. Total over the {@link ContextFragmentId} union. */
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
