/**
 * F1.3c — the deterministic question-quality pass over a decomposition's OPEN plan questions (§5.S "wire into the
 * flow"). For each open question it composes the two shipped gates — `assessClarificationNeed` (is the underlying
 * ask genuinely ambiguous?) and `decideAssumptionSafety` (is the question's default safe to adopt silently?) via
 * `clarifyOrAssume` — and decides whether the question can be auto-resolved with its assumed default or must stay
 * open for the operator / the model-backed auto-clarify loop. Pure + deterministic + NO model call; the candidate
 * estimates (confidence / impact / reversibility) are derived from the question's own observable shape by the
 * documented heuristics below, so the same question always yields the same verdict.
 */

import type { NKleinPlanQuestion } from "../nklein-agent/nklein-plan-artifacts";
import { type AssumptionMode, type CandidateAssumption, clarifyOrAssume } from "./assumption-safety";
import { detectClarificationSignals } from "./clarification-need";

export interface OpenQuestionPassDecision {
	/** Adopt the default (recording it as an `assumed-default` resolution), or keep the question open. */
	action: "assume_default" | "keep_open";
	/** The default text to adopt when assuming (the stored assumption, else the recommended/first option's label). */
	assumption: string | null;
	/** The `clarifyOrAssume` risk scalar in [0,1] (0 when no default existed to evaluate). */
	risk: number;
	/** Whether the pass surfaced residual risk to review (the `assume_but_flag` outcome). */
	flagged: boolean;
	/** Why the pass decided this way — safe to log and to show the operator. */
	reason: string;
}

/**
 * Wording tiers that mark a decision hard to take back. Deliberately coarse: a keyword hit only DOWNGRADES
 * reversibility and raises impact — it never auto-resolves more. Destructive verbs are the worst case
 * (irreversible); security/contract/schema wording is costly-but-undoable.
 */
const DESTRUCTIVE_PATTERN = /\b(delete|drop|destro|wipe|purge|irreversib)\b/i;
const HIGH_STAKES_PATTERN =
	/\b(migrat|auth|security|secret|credential|payment|billing|encrypt|schema|licen[cs]e|contract|public api)\b/i;

function questionCorpus(question: NKleinPlanQuestion): string {
	return [
		question.question,
		question.assumption ?? "",
		...question.options.map((option) => `${option.label} ${option.description ?? ""}`),
	].join(" ");
}

/** Pick the default the pass would adopt: the stored assumption, else the recommended (or only) option's label. */
export function deriveQuestionDefault(question: NKleinPlanQuestion): string | null {
	if (question.assumption?.trim()) {
		return question.assumption.trim();
	}
	const recommended = question.options.find((option) => option.recommended);
	if (recommended) {
		return recommended.label;
	}
	if (question.options.length === 1) {
		const only = question.options[0];
		return only ? only.label : null;
	}
	return null;
}

/**
 * Derive the deterministic `CandidateAssumption` estimates from the question's observable shape:
 * - confidence: an explicit assumption AND a recommended option agree → 0.75; either alone → 0.65; a sole option →
 *   0.55 (nobody marked it recommended, it is just unopposed).
 * - impact/reversibility: destructive verbs (delete/drop/wipe) → impact 0.7 + `irreversible`; security/schema/
 *   contract wording → impact 0.7 + `costly`; otherwise impact 0.35 + `reversible` — a plan-level default is
 *   revisable via re-decompose before code exists. Requester-uncertainty wording lowers confidence (floor 0.4).
 */
export function estimateQuestionAssumption(question: NKleinPlanQuestion, assumption: string): CandidateAssumption {
	const hasStoredAssumption = Boolean(question.assumption?.trim());
	const hasRecommendedOption = question.options.some((option) => option.recommended);
	let confidence =
		hasStoredAssumption && hasRecommendedOption ? 0.75 : hasStoredAssumption || hasRecommendedOption ? 0.65 : 0.55;
	// The requester's own uncertainty in the QUESTION wording ("not sure", "maybe", "either …") lowers confidence
	// that any default matches their intent — reuse the shipped need-detector rather than new heuristics.
	const uncertaintySignals = detectClarificationSignals(question.question).some(
		(signal) => signal.kind === "explicit_uncertainty" || signal.kind === "multiple_interpretations",
	);
	if (uncertaintySignals) {
		confidence = Math.max(0.4, confidence - 0.15);
	}
	const corpus = questionCorpus(question);
	const destructive = DESTRUCTIVE_PATTERN.test(corpus);
	const highStakes = destructive || HIGH_STAKES_PATTERN.test(corpus);
	return {
		reversibility: destructive ? "irreversible" : highStakes ? "costly" : "reversible",
		confidence,
		impact: highStakes ? 0.7 : 0.35,
		summary: assumption,
	};
}

/**
 * Decide one OPEN question. A question with no derivable default always stays open (there is nothing to adopt);
 * otherwise `clarifyOrAssume` arbitrates: `ask` keeps it open, both assume outcomes adopt the default (the
 * `assume_but_flag` residual risk is carried on the decision so the caller can surface it).
 */
export function decideOpenQuestionResolution(
	question: NKleinPlanQuestion,
	mode: AssumptionMode = "balanced",
): OpenQuestionPassDecision {
	const assumption = deriveQuestionDefault(question);
	if (!assumption) {
		return {
			action: "keep_open",
			assumption: null,
			risk: 0,
			flagged: false,
			reason: "No default to adopt (no assumption and no recommended option) — the question needs an answer.",
		};
	}
	const decision = clarifyOrAssume(question.question, estimateQuestionAssumption(question, assumption), mode);
	if (decision.action === "ask") {
		return {
			action: "keep_open",
			assumption,
			risk: decision.risk,
			flagged: false,
			reason: decision.reason,
		};
	}
	return {
		action: "assume_default",
		assumption,
		risk: decision.risk,
		flagged: decision.action === "assume_but_flag",
		reason: decision.reason,
	};
}
