/**
 * §5.AR / §5.AW — the strong-model MEMORY AUDIT (pure core). Authored memory (basic-memory notes) is model-written
 * free-form prose: unlike the §5.AF ledger (schema-gated, harness-written EVIDENCE a model cannot forge), a note can
 * carry a confidently-wrong "fact" that later sessions recall as ground truth and compound. This is the verification
 * the architecture was missing: an idle STRONG model re-reads a recently-written note and checks its claims against
 * two hallucination-RESISTANT stores — the codebase-memory code-graph (structural claims must resolve to real symbols)
 * and the §5.AF ledger (outcome claims must match recorded evidence) — plus internal contradiction.
 *
 * This module is the PURE spine: the effectful checks (querying the code-graph / ledger, reading the note) run at the
 * dispatch site and hand their results in as {@link MemoryAuditSignals}; {@link auditMemoryNote} folds them into a
 * verdict + a recall trust weight, and {@link chooseMemoryAuditor} picks the strongest non-author model to run it.
 */

import { type RoleModelCandidate, selectRoleModel } from "./role-model-selection.js";

export type MemoryAuditVerdict = "confirmed" | "contradicted" | "unverifiable";

/**
 * The pre-computed check results for one note (gathered effectfully at the dispatch site). Structural claims are the
 * qualified symbol names the note references; a claim is `resolved` when the code-graph finds that symbol, `unresolved`
 * when it does not (a strong hallucination signal). Outcome/internal contradictions are already-detected conflicts.
 */
export interface MemoryAuditSignals {
	/** Structural claims (qualified symbol names) the note makes that DID resolve in the code-graph. */
	resolvedSymbols: readonly string[];
	/** Structural claims that did NOT resolve — the note references a symbol the code-graph says does not exist. */
	unresolvedSymbols: readonly string[];
	/** Outcome claims the §5.AF ledger's typed evidence directly CONTRADICTS. */
	ledgerContradictions: readonly string[];
	/** Internal contradictions (mutually-exclusive assertions, relation cycles) detected within/among notes. */
	internalContradictions: readonly string[];
}

export interface MemoryAuditResult {
	verdict: MemoryAuditVerdict;
	reason: string;
	/**
	 * Suggested recall trust weight in [0,1] for provenance-weighted retrieval: `confirmed` ⇒ 1 (fully trusted),
	 * `unverifiable` ⇒ 0.3 (kept but de-weighted — nothing disproved it, but nothing confirmed it either),
	 * `contradicted` ⇒ 0 (do not surface as authoritative; the dispatch supersedes/flags it).
	 */
	recallWeight: number;
}

const RECALL_WEIGHT: Record<MemoryAuditVerdict, number> = {
	confirmed: 1,
	unverifiable: 0.3,
	contradicted: 0,
};

/** The recall trust weight for an audit verdict (provenance-weighted recall de-weights unverifiable, drops contradicted). */
export function recallWeightForVerdict(verdict: MemoryAuditVerdict): number {
	return RECALL_WEIGHT[verdict];
}

/**
 * Fold a note's check results into an audit verdict (pure). A single hard contradiction (an unresolved symbol, a
 * ledger conflict, or an internal contradiction) ⇒ `contradicted`. Otherwise, at least one positively-resolved
 * structural claim + no contradictions ⇒ `confirmed`; nothing checkable resolved ⇒ `unverifiable` (kept, de-weighted).
 */
export function auditMemoryNote(signals: MemoryAuditSignals): MemoryAuditResult {
	const contradictions =
		signals.unresolvedSymbols.length + signals.ledgerContradictions.length + signals.internalContradictions.length;
	if (contradictions > 0) {
		const parts: string[] = [];
		if (signals.unresolvedSymbols.length > 0) {
			parts.push(`${signals.unresolvedSymbols.length} symbol(s) not found in the code-graph`);
		}
		if (signals.ledgerContradictions.length > 0) {
			parts.push(`${signals.ledgerContradictions.length} claim(s) contradicted by the ledger`);
		}
		if (signals.internalContradictions.length > 0) {
			parts.push(`${signals.internalContradictions.length} internal contradiction(s)`);
		}
		return {
			verdict: "contradicted",
			reason: `Note contradicted: ${parts.join("; ")}.`,
			recallWeight: RECALL_WEIGHT.contradicted,
		};
	}
	if (signals.resolvedSymbols.length > 0) {
		return {
			verdict: "confirmed",
			reason: `Note confirmed: ${signals.resolvedSymbols.length} structural claim(s) resolve and nothing contradicts it.`,
			recallWeight: RECALL_WEIGHT.confirmed,
		};
	}
	return {
		verdict: "unverifiable",
		reason:
			"Note unverifiable: no structural claim could be checked against the code-graph or ledger; kept but de-weighted.",
		recallWeight: RECALL_WEIGHT.unverifiable,
	};
}

export interface ChooseMemoryAuditorInput {
	/** The available models to audit with (from the loaded/registered set). */
	candidates: readonly RoleModelCandidate[];
	/** The model that AUTHORED the note — excluded so a model never grades its own memory (anti-anchoring). */
	authorModelKey?: string | null;
	/** Context the auditor must hold (carries the ≥32k floor enforced upstream). */
	requiredContextTokens: number;
}

/**
 * Choose the STRONGEST available model to audit a note, never the note's own author (a model grading its own memory
 * would just re-assert its own error). Reuses the sanctioned capability-first selector; returns null when no eligible
 * model clears the context floor. Pure.
 */
export function chooseMemoryAuditor(input: ChooseMemoryAuditorInput): string | null {
	const eligible = input.candidates.filter((candidate) => candidate.modelKey !== input.authorModelKey);
	if (eligible.length === 0) {
		return null;
	}
	// difficulty 0: every eligible model is feasible on capability; we only want the MOST capable that fits the context.
	const selection = selectRoleModel({
		candidates: eligible,
		difficulty: 0,
		requiredContextTokens: input.requiredContextTokens,
		weighting: "capability",
	});
	return selection.type === "assign" ? selection.modelKey : null;
}
