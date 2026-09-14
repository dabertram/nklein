/**
 * F3.41 (d) — the per-card DIFFICULTY FACTS persisted on every generated card. PURE core.
 *
 * ── WHY PERSIST THEM ──
 * The decomposer declares each child's `complexity` and its likely files, and F3.41 (b) turns those into a
 * required capability floor and the smallest model tier that clears it — but until now that mapping was computed
 * only while GUIDING the decomposer and then thrown away. The card reached the board with the raw complexity in
 * its prompt text and nothing a router, a DAG/ETA surface or a later calibration pass could read back. The start
 * path re-estimated difficulty from PROMPT TOKENS and content heuristics, blind to the plan's own sizing.
 *
 * ── WHAT IS STAMPED, AND WHY THESE FOUR ──
 * `complexity` and `likelyFileCount` are the task's own declaration — the inputs, kept so a future re-calibration
 * (F3.41 (c): measured floors replacing the researched priors) can recompute from facts instead of reading the
 * number a stale prior produced. `requiredCapability` and `smallestTier` are the current mapping's answer, kept so
 * consumers that only want the floor need not know the formula.
 *
 * ── OBSERVE-FIRST ──
 * Nothing routes on these yet. The mapping is a researched PRIOR; routing on it before the fitness store has
 * judged it would be a plausible number standing in for a fact never established. The start path records the
 * persisted floor beside its own estimate (`card_difficulty_floor`) so the flip can be decided from evidence.
 *
 * Pure + total: no clock, no I/O; a missing file list counts as one file, as the capability mapping already does.
 */
import type { RuntimeCardDifficultyFacts } from "./board-api-contract";
import { requiredCapabilityForCard, smallestTierClearing } from "./model-size-tier-capability";

export interface CardDifficultyFactsSource {
	/** Decomposition sizing complexity 0-100 (`NKleinPlanTask.complexity`). */
	readonly complexity: number;
	/** The task's declared likely files; absent/empty reads as one file. */
	readonly filesLikelyTouched?: readonly string[] | null;
}

export function deriveCardDifficultyFacts(task: CardDifficultyFactsSource): RuntimeCardDifficultyFacts {
	const complexity = Math.min(100, Math.max(0, Number.isFinite(task.complexity) ? task.complexity : 0));
	const likelyFileCount = Math.max(1, task.filesLikelyTouched?.length ?? 1);
	const requiredCapability = requiredCapabilityForCard({ complexity, likelyFileCount });
	return {
		complexity,
		likelyFileCount,
		requiredCapability,
		smallestTier: smallestTierClearing(requiredCapability),
	};
}
