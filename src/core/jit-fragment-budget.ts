/**
 * §5.AE JIT context-fragment BUDGET selection — the pure seam between "which fragments the active skills need" and
 * "which of them actually FIT". `fragmentsForSkills` ([skill-registry.ts](./skill-registry.ts)) emits the deduped UNION
 * of fragments the resolved skills request (no budget); §5.AD `arrangeContextForSmartZone` then ORDERS them but leaves
 * "trimming to a budget a separate concern"; §6.2 requires the prompt NEVER overflow the window. This module owns the
 * missing middle step: given the candidate fragments (each with an estimated token cost + an importance + an optional
 * `required` flag) and a token budget, choose the subset that fits — the just-in-time "include only what helps THIS turn
 * AND fits" decision the §5.AE vision calls for.
 *
 * Policy (deliberately simple + deterministic, matching the rest of §5.AE): REQUIRED fragments are kept first (they may
 * push the total over budget — but the result reports `overBudget` truthfully so §6.2's hard cap still governs; we never
 * hide an overflow); then the remaining budget is filled GREEDILY by importance descending (ties broken by lower cost,
 * then input order). Greedy-by-importance — not a full knapsack — is the right fit here: it honors the same priority
 * ordering §5.AD uses, matches the research ("keep the clearly-relevant, drop the marginal tail"), and stays trivial to
 * reason about for the handful of fragments a turn carries. Pure: never mutates input; returns fresh arrays + an
 * inspectable reason (for §5.AG surfaces / debugging), analogous to the resolver's `reason` and the API-bridge `notes`.
 */

/** A context fragment competing for the turn's token budget, tagged with what it costs and how much it helps. */
export interface FragmentBudgetCandidate {
	/** The fragment's stable id — a registry string or any dynamic fragment key (F4.17 consumer). */
	id: string;
	/** Estimated token cost of including this fragment. Non-finite / negative values are floored to 0. */
	estimatedTokens: number;
	/**
	 * Relative importance within the turn (higher ⇒ kept first when the budget is tight). Default 0. Callers typically
	 * source this from the max relevance of the skills that requested the fragment (§5.AE `skillRelevance`).
	 */
	importance?: number;
	/**
	 * When true, the fragment is kept even if it overruns the budget (e.g. a non-negotiable safety/output rail). Required
	 * fragments never cause OTHER required fragments to be dropped; the overflow they may cause is reported, not hidden.
	 */
	required?: boolean;
}

/** The outcome of a budget selection: which fragments made the cut, which were dropped, and the accounting. */
export interface FragmentBudgetSelection {
	/** The chosen fragment ids, in a stable order (required first — in input order — then kept optionals by rank). */
	kept: string[];
	/** The fragments that did not fit, in the order they were considered and rejected. */
	dropped: string[];
	/** Total estimated tokens of the `kept` set. */
	usedTokens: number;
	/** Whether `usedTokens` exceeds the budget — only ever true because REQUIRED fragments alone overran it. */
	overBudget: boolean;
	/** Inspectable one-line reason for the selection (for §5.AG surfaces / debugging). */
	reason: string;
}

/** Floor a possibly-messy token count to a non-negative integer (a fragment can't cost less than nothing). */
function normalizeTokens(value: number): number {
	if (!Number.isFinite(value) || value <= 0) {
		return 0;
	}
	return Math.trunc(value);
}

/**
 * Select the fragments that fit the token budget (pure). REQUIRED candidates are kept first (in input order); they may
 * push the used total over `budgetTokens`, in which case `overBudget` is true and no optional fragment is added. The
 * remaining budget is then filled greedily by importance descending, ties broken by lower cost then input order; a
 * candidate whose cost would exceed the remaining budget is dropped (later, cheaper candidates may still fit). A
 * non-positive budget keeps only the required fragments. Never mutates the input; returns fresh arrays.
 */
export function selectFragmentsWithinBudget(
	candidates: readonly FragmentBudgetCandidate[],
	budgetTokens: number,
): FragmentBudgetSelection {
	const budget = normalizeTokens(budgetTokens);

	const kept: string[] = [];
	const dropped: string[] = [];
	let usedTokens = 0;

	// 1) Required fragments are non-negotiable — keep them all (in input order), letting the total overrun if it must.
	for (const candidate of candidates) {
		if (candidate.required) {
			kept.push(candidate.id);
			usedTokens += normalizeTokens(candidate.estimatedTokens);
		}
	}
	const overBudget = usedTokens > budget;

	// 2) Rank the optionals by importance desc, then lower cost, then original input order (stable + deterministic).
	const optionals = candidates
		.map((candidate, index) => ({ candidate, index }))
		.filter((entry) => !entry.candidate.required)
		.sort((left, right) => {
			const byImportance = (right.candidate.importance ?? 0) - (left.candidate.importance ?? 0);
			if (byImportance !== 0) {
				return byImportance;
			}
			const byCost =
				normalizeTokens(left.candidate.estimatedTokens) - normalizeTokens(right.candidate.estimatedTokens);
			if (byCost !== 0) {
				return byCost;
			}
			return left.index - right.index;
		});

	// 3) Greedily admit each optional whose cost fits the remaining budget; drop the rest.
	for (const { candidate } of optionals) {
		const cost = normalizeTokens(candidate.estimatedTokens);
		if (!overBudget && usedTokens + cost <= budget) {
			kept.push(candidate.id);
			usedTokens += cost;
		} else {
			dropped.push(candidate.id);
		}
	}

	return {
		kept,
		dropped,
		usedTokens,
		overBudget,
		reason: buildReason({ budget, usedTokens, keptCount: kept.length, droppedCount: dropped.length, overBudget }),
	};
}

/** Compose the human-readable selection reason (kept separate so the selector body stays about the policy). */
function buildReason(parts: {
	budget: number;
	usedTokens: number;
	keptCount: number;
	droppedCount: number;
	overBudget: boolean;
}): string {
	const base = `kept ${parts.keptCount} fragment(s) using ${parts.usedTokens}/${parts.budget} tokens, dropped ${parts.droppedCount}`;
	return parts.overBudget ? `${base} — OVER BUDGET (required fragments alone exceed the budget)` : base;
}
