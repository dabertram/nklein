// F1.3b — the answer→revision connector: project a clarification resolution (an operator's dialog answer via
// `applyClarificationAnswer`, or an auto-clarify decision via `applyAutoClarifyDecision`) onto the STORED plan
// question, rewrite `questions.md` in place (F1.3a round-trip), and append a durable `clarification_resolved`
// revision to `revisions.md` so the plan's history records what was decided, by whom, and why. This is the single
// persistence seam both the F1.3c auto pass and the F1.4 dialog call — neither touches artifact files directly.
import type { AssumptionMode } from "../core/assumption-safety";
import { type AutoClarifyDecision, applyAutoClarifyDecision } from "../core/auto-clarify";
import { applyClarificationAnswer, type ClarificationAnswerInput } from "../core/clarification-answer";
import { decideOpenQuestionResolution } from "../core/question-clarification-pass";
import {
	appendNKleinPlanRevision,
	type NKleinPlanQuestion,
	readNKleinPlanArtifacts,
	updateNKleinPlanQuestion,
} from "./nklein-plan-artifacts";

export const CLARIFICATION_RESOLVED_REVISION_KIND = "clarification_resolved";

export type PlanQuestionResolution =
	/** The operator answered in the clarification dialog (selected options and/or free text). */
	| { source: "operator"; answer: ClarificationAnswerInput }
	/** The automatic question-quality pass decided (architect ↔ reviewer loop, §5.S). */
	| { source: "auto"; decision: AutoClarifyDecision };

export type ResolvePlanQuestionResult =
	| { ok: true; question: NKleinPlanQuestion; changed: boolean }
	| { ok: false; error: string };

function describeResolution(question: NKleinPlanQuestion, resolution: PlanQuestionResolution): string {
	const by = resolution.source === "operator" ? "the operator" : "the automatic clarification pass";
	if (question.status === "answered") {
		return `Question "${question.id}" answered by ${by}: ${question.answer ?? ""}`;
	}
	return `Question "${question.id}" resolved by ${by} with an assumed default: ${question.assumption ?? ""}`;
}

/**
 * Resolve ONE plan question and persist the outcome. A `keep_asking` auto decision (or an empty operator submission)
 * changes nothing and appends no revision — the question stays `open` for the next pass or the dialog. Best-effort
 * on the revision append is deliberate NOT here: a resolution that cannot be recorded must fail loudly, because a
 * silently-lost decision is exactly the drift `revisions.md` exists to prevent.
 */
export async function resolvePlanQuestion(input: {
	workspacePath: string;
	slug: string;
	questionId: string;
	resolution: PlanQuestionResolution;
}): Promise<ResolvePlanQuestionResult> {
	let stored: NKleinPlanQuestion | undefined;
	try {
		const artifacts = await readNKleinPlanArtifacts(input.workspacePath, input.slug);
		stored = artifacts.questions.find((question) => question.id === input.questionId);
	} catch (error) {
		return { ok: false, error: `Could not read plan artifacts for "${input.slug}": ${String(error)}` };
	}
	if (!stored) {
		return { ok: false, error: `Question "${input.questionId}" was not found in plan "${input.slug}".` };
	}
	const projected =
		input.resolution.source === "operator"
			? applyClarificationAnswer(stored, input.resolution.answer)
			: applyAutoClarifyDecision(stored, input.resolution.decision);
	const changed =
		projected.status !== stored.status ||
		projected.answer !== stored.answer ||
		projected.assumption !== stored.assumption;
	if (!changed || projected.status === "open") {
		return { ok: true, question: stored, changed: false };
	}
	try {
		await updateNKleinPlanQuestion({ workspacePath: input.workspacePath, slug: input.slug, question: projected });
		await appendNKleinPlanRevision({
			workspacePath: input.workspacePath,
			slug: input.slug,
			kind: CLARIFICATION_RESOLVED_REVISION_KIND,
			description: describeResolution(projected, input.resolution),
			evidence: `question: ${projected.question.replaceAll("\n", " ").slice(0, 300)}`,
		});
	} catch (error) {
		return { ok: false, error: `Could not persist the resolution for "${input.questionId}": ${String(error)}` };
	}
	return { ok: true, question: projected, changed: true };
}

export interface DecompositionClarificationPassSummary {
	/** Open questions the pass examined. */
	openQuestionCount: number;
	/** Questions auto-resolved with their assumed default (recorded as `assumed-default` + a revision). */
	assumedCount: number;
	/** Of the assumed, how many carried residual risk (`assume_but_flag`) worth surfacing. */
	flaggedCount: number;
	/** Questions left open for the operator / the model-backed auto-clarify loop (F1.3d parks on these). */
	keptOpenCount: number;
	/** The kept-open question ids, in artifact order — the park/resume linkage keys on these. */
	openQuestionIds: string[];
}

/**
 * F1.3c — the deterministic question-quality pass over a freshly-written decomposition's OPEN questions. Composes
 * the §5.S gates per question (`decideOpenQuestionResolution`) and persists every adopt-the-default outcome through
 * {@link resolvePlanQuestion} (questions.md rewrite + `clarification_resolved` revision). Questions without a safe
 * default stay open — the F1.3d park/resume linkage and the model-backed auto-clarify loop own those. Best-effort
 * per question: one unresolvable question never blocks the rest of the pass.
 */
export async function runDecompositionClarificationPass(input: {
	workspacePath: string;
	slug: string;
	mode?: AssumptionMode;
}): Promise<DecompositionClarificationPassSummary> {
	const summary: DecompositionClarificationPassSummary = {
		openQuestionCount: 0,
		assumedCount: 0,
		flaggedCount: 0,
		keptOpenCount: 0,
		openQuestionIds: [],
	};
	const artifacts = await readNKleinPlanArtifacts(input.workspacePath, input.slug);
	for (const question of artifacts.questions) {
		if (question.status !== "open") {
			continue;
		}
		summary.openQuestionCount += 1;
		const decision = decideOpenQuestionResolution(question, input.mode ?? "balanced");
		if (decision.action === "keep_open" || !decision.assumption) {
			summary.keptOpenCount += 1;
			summary.openQuestionIds.push(question.id);
			continue;
		}
		const resolved = await resolvePlanQuestion({
			workspacePath: input.workspacePath,
			slug: input.slug,
			questionId: question.id,
			resolution: {
				source: "auto",
				decision: { action: "give_up_with_assumption", assumption: decision.assumption, reason: decision.reason },
			},
		});
		if (resolved.ok && resolved.changed) {
			summary.assumedCount += 1;
			if (decision.flagged) {
				summary.flaggedCount += 1;
			}
		} else {
			summary.keptOpenCount += 1;
			summary.openQuestionIds.push(question.id);
		}
	}
	return summary;
}
