/**
 * F12.37 anti-decomposition guard — PURE core.
 *
 * Under EQUAL token budgets a single agent matches or beats a multi-agent fan-out on interdependent work
 * (Data-Processing-Inequality result; Anthropic flags "most coding" as a poor fan-out fit): decomposing a small or
 * tightly-coupled task MANUFACTURES the coordination conflicts you later pay to reconcile. This guard decides,
 * BEFORE decomposition, whether a task should skip the architect fan-out and run as ONE linear worker card —
 * from the task's own complexity read and, when a draft card set exists, the file-overlap coupling between the
 * proposed cards. Advisory to the decompose path (the operator's explicit decompose click always wins).
 */

import { classifyTaskComplexity, type TaskComplexitySignals } from "./task-complexity";

export interface DraftCardScope {
	/** Files a proposed card expects to touch (its filesLikelyTouched). */
	readonly files: readonly string[];
}

export interface AntiDecompositionVerdict {
	readonly decompose: boolean;
	readonly reason: string;
	/** Pairwise file-overlap coupling of the draft set in [0,1]; null when no draft set was supplied. */
	readonly coupling: number | null;
}

/** Above this pairwise overlap, the "parallel" cards would fight over the same files — serialize instead. */
export const COUPLING_CEILING = 0.5;

/** Jaccard overlap of two file sets. */
function overlap(a: readonly string[], b: readonly string[]): number {
	if (a.length === 0 || b.length === 0) {
		return 0;
	}
	const setA = new Set(a);
	let shared = 0;
	for (const file of new Set(b)) {
		if (setA.has(file)) {
			shared += 1;
		}
	}
	return shared / new Set([...a, ...b]).size;
}

/** Mean pairwise coupling of a draft card set (0 when fewer than 2 scoped cards). */
export function draftSetCoupling(cards: readonly DraftCardScope[]): number {
	const scoped = cards.filter((card) => card.files.length > 0);
	if (scoped.length < 2) {
		return 0;
	}
	let total = 0;
	let pairs = 0;
	for (let i = 0; i < scoped.length; i += 1) {
		for (let j = i + 1; j < scoped.length; j += 1) {
			total += overlap((scoped[i] as DraftCardScope).files, (scoped[j] as DraftCardScope).files);
			pairs += 1;
		}
	}
	return pairs === 0 ? 0 : total / pairs;
}

/**
 * Decide decompose-vs-single-worker. `trivial` complexity never decomposes (a fan-out of one small task is pure
 * overhead); a draft set whose mean pairwise file overlap exceeds the ceiling serializes (the cards would conflict);
 * everything else decomposes as planned.
 */
export function decideDecomposition(
	signals: TaskComplexitySignals,
	draftCards?: readonly DraftCardScope[],
): AntiDecompositionVerdict {
	const complexity = classifyTaskComplexity(signals);
	if (complexity === "trivial") {
		return {
			decompose: false,
			reason: "trivial-complexity task — one linear worker beats a manufactured fan-out.",
			coupling: null,
		};
	}
	if (draftCards && draftCards.length >= 2) {
		const coupling = draftSetCoupling(draftCards);
		if (coupling > COUPLING_CEILING) {
			return {
				decompose: false,
				reason: `draft cards share ${Math.round(coupling * 100)}% of their files (ceiling ${Math.round(COUPLING_CEILING * 100)}%) — "parallel" cards would fight over the same code; run it linearly.`,
				coupling,
			};
		}
		return { decompose: true, reason: "draft cards are loosely coupled — fan-out is safe.", coupling };
	}
	return { decompose: true, reason: `${complexity} task — decomposition proceeds.`, coupling: null };
}
