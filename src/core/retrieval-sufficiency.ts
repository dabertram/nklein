/**
 * Sufficiency judgment for the §5.AC retrieval loop. After gathering evidence the loop must decide: is what we have
 * enough to answer the original query, or should we search again? This module is the pure judge for that decision.
 *
 * The verdict is based on three orthogonal conditions, all of which must hold for sufficiency:
 *   1. Every sub-question derived from the query plan has been covered by at least one retrieved source.
 *   2. The total number of sources meets or exceeds the caller-specified minimum (avoids single-source brittleness).
 *   3. The freshness gate has been satisfied (delegated to the caller — typically via retrieval-freshness.ts).
 *
 * Coverage is intentionally fuzzy: sub-questions are normalised (trimmed, lowercased, internal whitespace collapsed)
 * before comparison so minor phrasing differences in how the query plan records a question vs. how the retrieval
 * pipeline marks it as covered do not create spurious "uncovered" entries.
 *
 * Pure + deterministic. Never reads the clock, never calls a model, never performs I/O. Inputs are never mutated.
 */

/**
 * Input to the sufficiency judge.
 *
 * @property subQuestions        - The full set of sub-questions that must be answered (order-preserving; may contain
 *                                 duplicates — deduplication by normalised form is applied internally, keeping the
 *                                 first occurrence). Typically derived from `RetrievalQueryPlan.alternateQueries` — the
 *                                 queries that must each be covered before the loop terminates.
 * @property coveredSubQuestions - The sub-questions that retrieval has satisfied so far. Matched via normalised form
 *                                 (trimmed, lowercased, collapsed whitespace), so exact capitalisation/spacing is not
 *                                 required.
 * @property sourceCount         - Total number of distinct retrieved sources available.
 * @property minSources          - Minimum number of sources required for the verdict to be sufficient. A value ≤ 0
 *                                 means "no minimum" (the source-count gate always passes).
 * @property freshnessSatisfied  - Whether the freshness gate (e.g. assessed by retrieval-freshness.ts) has been met.
 */
export interface SufficiencyInput {
	readonly subQuestions: readonly string[];
	readonly coveredSubQuestions: readonly string[];
	readonly sourceCount: number;
	readonly minSources: number;
	readonly freshnessSatisfied: boolean;
}

/**
 * The output of the sufficiency judge.
 *
 * @property sufficient           - True IFF all sub-questions are covered, sourceCount >= minSources, and
 *                                  freshnessSatisfied is true.
 * @property unmetSubQuestions    - The ORIGINAL (un-normalised) sub-questions whose normalised form was not found in
 *                                  coveredSubQuestions. Duplicates are collapsed by normalised form (first original
 *                                  wins). Empty when all sub-questions are covered.
 * @property reasons              - Human-readable description of every UNMET condition, in the order: coverage →
 *                                  source count → freshness. Empty array when sufficient.
 */
export interface SufficiencyVerdict {
	sufficient: boolean;
	unmetSubQuestions: string[];
	reasons: string[];
}

/** Normalise a sub-question string for comparison: trim, lowercase, collapse internal whitespace. */
function normalise(s: string): string {
	return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Assess whether the current retrieval state is sufficient to answer the original query without another search round.
 *
 * Invariant: empty `subQuestions` + `sourceCount >= minSources` + `freshnessSatisfied` ⇒ sufficient (nothing left
 * to cover). Inputs are never mutated.
 */
export function assessRetrievalSufficiency(input: SufficiencyInput): SufficiencyVerdict {
	// Build the covered-normalised set once.
	const coveredNorm = new Set<string>(input.coveredSubQuestions.map(normalise));

	// Deduplicate subQuestions by normalised form, keeping the first original occurrence.
	const seenNorm = new Set<string>();
	const dedupedSubQuestions: string[] = [];
	for (const sq of input.subQuestions) {
		const norm = normalise(sq);
		if (!seenNorm.has(norm)) {
			seenNorm.add(norm);
			dedupedSubQuestions.push(sq);
		}
	}

	// Collect un-covered originals.
	const unmetSubQuestions: string[] = dedupedSubQuestions.filter((sq) => !coveredNorm.has(normalise(sq)));

	// Evaluate conditions.
	const allCovered = unmetSubQuestions.length === 0;
	// minSources <= 0 means "no source floor" (gate always passes) — made explicit so a stray non-positive value can't
	// silently look like a bypassed comparison.
	const enoughSources = input.minSources <= 0 || input.sourceCount >= input.minSources;
	const fresh = input.freshnessSatisfied;

	// Build reasons for every UNMET condition.
	const reasons: string[] = [];
	if (!allCovered) {
		reasons.push(`${unmetSubQuestions.length} sub-question(s) still uncovered`);
	}
	if (!enoughSources) {
		reasons.push(`only ${input.sourceCount} source(s), need ${input.minSources}`);
	}
	if (!fresh) {
		reasons.push("freshness not satisfied");
	}

	return {
		sufficient: allCovered && enoughSources && fresh,
		unmetSubQuestions,
		reasons,
	};
}
