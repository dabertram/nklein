/**
 * §5.AE skill → assembler-fragment bridge (pure). Turns a session's active skill fragment ids (the underscore
 * {@link ContextFragmentId}s a resolved skill set declares) into {@link PromptFragment}s the prompt assembler can order,
 * using the approved {@link resolveSkillFragmentMapping} table. This is the piece that was missing between the resolver
 * (which produces fragment ids) and `assemblePromptFragments` (which takes keyed, volatility-bucketed text).
 *
 * It routes ONLY `wired` fragments and drops empty text, so a `needs_producer` id (repo_map / focus_chain /
 * freshness_rail / refinement_preamble / online_retrieval today) can NEVER silently inject an empty or aspirational
 * block. It is the ready splice point for `assembleSessionSystemPrompt`: today it adds nothing new (the two `wired`
 * fragments — efficiency_rules, temporal — are already produced + keyed unconditionally at that seam, and are deduped
 * here), so wiring it is byte-identical until a producer for a currently-`needs_producer` fragment is built. Pure.
 */

import type { PromptFragment } from "./prompt-fragment-assembly.js";
import { resolveSkillFragmentMapping } from "./skill-fragment-mapping.js";
import type { ContextFragmentId } from "./skill-registry.js";

/** Yields the text block for a fragment id, or null/empty when it has none (the fragment is then skipped). */
export type SkillFragmentProducer = (fragmentId: ContextFragmentId) => string | null | undefined;

/**
 * Build the assembler PromptFragments for a session's active skill fragment ids. Skips `needs_producer` ids (no empty
 * block), maps each `wired` id to its canonical assembler key + volatility, dedups by key, and drops empty-text
 * producers. Order follows `activeFragmentIds` (the assembler re-sorts by volatility, so intra-class order is caller's).
 */
export function buildSkillPromptFragments(
	activeFragmentIds: readonly ContextFragmentId[],
	produce: SkillFragmentProducer,
): PromptFragment[] {
	const seenKeys = new Set<string>();
	const fragments: PromptFragment[] = [];
	for (const fragmentId of activeFragmentIds) {
		const mapping = resolveSkillFragmentMapping(fragmentId);
		if (mapping.producer !== "wired") {
			continue; // needs_producer → never inject an empty/aspirational block
		}
		if (seenKeys.has(mapping.assemblerKey)) {
			continue; // two skills can declare the same fragment — route it once
		}
		const text = produce(fragmentId)?.trim();
		if (!text) {
			continue; // no producer text → skip (the assembler would drop it anyway)
		}
		seenKeys.add(mapping.assemblerKey);
		fragments.push({ key: mapping.assemblerKey, volatility: mapping.volatility, text });
	}
	return fragments;
}
