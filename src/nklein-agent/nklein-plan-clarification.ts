// F1.3b — the answer→revision connector: project a clarification resolution (an operator's dialog answer via
// `applyClarificationAnswer`, or an auto-clarify decision via `applyAutoClarifyDecision`) onto the STORED plan
// question, rewrite `questions.md` in place (F1.3a round-trip), and append a durable `clarification_resolved`
// revision to `revisions.md` so the plan's history records what was decided, by whom, and why. This is the single
// persistence seam both the F1.3c auto pass and the F1.4 dialog call — neither touches artifact files directly.
import type { AssumptionMode } from "../core/assumption-safety";
import {
	type AutoClarifyConfig,
	type AutoClarifyDecision,
	type AutoClarifyRound,
	applyAutoClarifyDecision,
	runAutoClarifyLoop,
} from "../core/auto-clarify";
import { applyClarificationAnswer, type ClarificationAnswerInput } from "../core/clarification-answer";
import { decideOpenQuestionResolution } from "../core/question-clarification-pass";
import {
	appendNKleinPlanRevision,
	type NKleinPlanQuestion,
	readNKleinPlanArtifacts,
	updateNKleinPlanQuestion,
} from "./nklein-plan-artifacts";
import type { NKleinClarifyTurnHandler } from "./nklein-plan-critique-tool";

export const CLARIFICATION_RESOLVED_REVISION_KIND = "clarification_resolved";

export type PlanQuestionResolution =
	/** The operator answered in the clarification dialog (selected options and/or free text). */
	| { source: "operator"; answer: ClarificationAnswerInput }
	/** The automatic question-quality pass decided (architect ↔ reviewer loop, §5.S). */
	| { source: "auto"; decision: AutoClarifyDecision };

export type ResolvePlanQuestionResult =
	/** `blockedTaskId` is the card that was parked on this question (pre-clear) — the caller resumes exactly it. */
	| { ok: true; question: NKleinPlanQuestion; changed: boolean; blockedTaskId: string | null }
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
		return { ok: true, question: stored, changed: false, blockedTaskId: stored.blockedTaskId };
	}
	// F1.3d: resolution releases the block — the caller resumes the returned task; the stored question stops
	// claiming it so a later re-park can claim it afresh.
	const blockedTaskId = stored.blockedTaskId;
	const released: NKleinPlanQuestion = { ...projected, blockedTaskId: null };
	try {
		await updateNKleinPlanQuestion({ workspacePath: input.workspacePath, slug: input.slug, question: released });
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
	return { ok: true, question: released, changed: true, blockedTaskId };
}

/**
 * F1.3d — the resume prompt for a card that was parked on a plan question. Explicit about the decision so the
 * re-driven turn continues instead of re-asking; the plan revision (`clarification_resolved`) is the durable record.
 */
export function buildClarificationResumePrompt(question: NKleinPlanQuestion): string {
	const decision =
		question.status === "answered"
			? `Answer: ${question.answer ?? ""}`
			: `Assumed default: ${question.assumption ?? ""}`;
	return [
		`Your open question has been resolved — continue the task with this decision and do NOT re-ask it.`,
		`Question: ${question.question}`,
		decision,
		`Proceed from exactly where you stopped, applying this decision.`,
	].join("\n");
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

/** Embedder-free token-Jaccard similarity (parity with the chat memory store's lexical fallback; local to avoid a
 * chat-layer import cycle). Feeds the auto-clarify no-progress detector; an embedder can replace it later. */
export function clarifyTextSimilarity(a: string, b: string): number {
	const tokenize = (text: string) =>
		new Set(
			text
				.toLowerCase()
				.split(/[^a-z0-9]+/)
				.filter((token) => token.length > 1),
		);
	const left = tokenize(a);
	const right = tokenize(b);
	if (left.size === 0 || right.size === 0) {
		return 0;
	}
	let intersection = 0;
	for (const token of left) {
		if (right.has(token)) {
			intersection += 1;
		}
	}
	return intersection / (left.size + right.size - intersection);
}

/** F1.3e loop config: each round costs 1-2 bounded sessions, so the budget is TIGHT (2 rounds, then assume). */
const MODEL_CLARIFY_LOOP_CONFIG: AutoClarifyConfig = {
	safetyCap: 2,
	userHardLimit: 2,
	noProgressSimilarityThreshold: 0.92,
	minRoundsBeforeStallCheck: 3,
};

function buildClarifyProposeSeedPrompt(question: NKleinPlanQuestion, rounds: readonly AutoClarifyRound[]): string {
	const history = rounds
		.map(
			(round, index) =>
				`Round ${index + 1} proposal: ${round.proposal}${round.reviewerOpinion ? `\nReviewer objection: ${round.reviewerOpinion}` : ""}`,
		)
		.join("\n");
	return [
		"You are the ARCHITECT resolving an open planning question for this project. Investigate briefly if needed, then call submit_plan_critique EXACTLY ONCE to deliver your proposal:",
		'- `verdict: "proceed"` when you are CONFIDENT in an answer; put the ANSWER ITSELF in `summary`.',
		'- `verdict: "revise"` when you cannot answer without the user; put what is missing in `feedback`.',
		`Question: ${question.question}`,
		question.options.length > 0
			? `Known options:\n${question.options.map((option) => `- ${option.label}${option.recommended ? " (recommended)" : ""}${option.description ? ` — ${option.description}` : ""}`).join("\n")}`
			: "",
		history ? `Prior rounds:\n${history}` : "",
	]
		.filter(Boolean)
		.join("\n\n");
}

function buildClarifyReviewSeedPrompt(question: NKleinPlanQuestion, proposal: string): string {
	return [
		"You are a REVIEWER giving a second opinion on a proposed answer to an open planning question. Call submit_plan_critique EXACTLY ONCE:",
		'- `verdict: "proceed"` if the proposed answer is sound (no objection).',
		'- `verdict: "revise"` with a concrete objection in `feedback` if it is wrong, risky, or under-specified.',
		`Question: ${question.question}`,
		`Proposed answer: ${proposal}`,
	].join("\n\n");
}

export interface ModelClarifyLoopSummary {
	/** Questions the loop resolved (answer or assumption persisted through resolvePlanQuestion). */
	resolvedCount: number;
	/** Question ids that remain open (loop kept asking, a turn was unavailable, or persistence failed). */
	keptOpenIds: string[];
}

/**
 * F1.3e — the model-backed auto-clarify loop over the questions the deterministic pass kept open. Each question
 * drives `runAutoClarifyLoop` with REAL bounded turns (architect propose on its own model, §5.K lineage-diverse
 * review) mapped through the injected clarify-turn handler; decisions persist via {@link resolvePlanQuestion}.
 * A null turn (budget spent / no diverse model / degraded session) aborts THAT question — it stays open for the
 * operator — and the loop never blocks the decomposition flow.
 */
export async function runModelBackedClarifyLoop(input: {
	workspacePath: string;
	slug: string;
	questionIds: readonly string[];
	requestClarifyTurn: NKleinClarifyTurnHandler;
	/** Cap on questions attempted per decomposition (each costs up to ~4 bounded sessions). Default 2. */
	maxQuestions?: number;
}): Promise<ModelClarifyLoopSummary> {
	const summary: ModelClarifyLoopSummary = { resolvedCount: 0, keptOpenIds: [] };
	const artifacts = await readNKleinPlanArtifacts(input.workspacePath, input.slug).catch(() => null);
	if (!artifacts) {
		summary.keptOpenIds.push(...input.questionIds);
		return summary;
	}
	const budget = Math.max(0, input.maxQuestions ?? 2);
	let attempted = 0;
	for (const questionId of input.questionIds) {
		const question = artifacts.questions.find(
			(candidate) => candidate.id === questionId && candidate.status === "open",
		);
		if (!question) {
			continue;
		}
		if (attempted >= budget) {
			summary.keptOpenIds.push(questionId);
			continue;
		}
		attempted += 1;
		let turnUnavailable = false;
		const loopResult = await runAutoClarifyLoop(
			question,
			{
				propose: async (target, rounds) => {
					const turn = await input.requestClarifyTurn({
						seedPrompt: buildClarifyProposeSeedPrompt(target, rounds),
						role: "propose",
					});
					if (!turn) {
						turnUnavailable = true;
						// A no-progress, unresolved echo terminates the loop at the budget with give-up semantics.
						return { proposal: "", resolved: false, selfReportedProgress: false };
					}
					return {
						proposal: turn.verdict === "proceed" ? turn.summary : (turn.feedback ?? turn.summary),
						resolved: turn.verdict === "proceed",
						selfReportedProgress: turn.verdict === "proceed",
					};
				},
				review: async (target, proposal) => {
					if (turnUnavailable) {
						return null;
					}
					const turn = await input.requestClarifyTurn({
						seedPrompt: buildClarifyReviewSeedPrompt(target, proposal),
						role: "review",
					});
					if (!turn) {
						return null;
					}
					return turn.verdict === "proceed" ? null : (turn.feedback ?? turn.summary);
				},
				similarity: clarifyTextSimilarity,
			},
			MODEL_CLARIFY_LOOP_CONFIG,
		).catch(() => null);
		if (
			!loopResult ||
			turnUnavailable ||
			loopResult.decision.action === "keep_asking" ||
			(loopResult.decision.action === "give_up_with_assumption" && !loopResult.decision.assumption.trim())
		) {
			summary.keptOpenIds.push(questionId);
			continue;
		}
		const resolved = await resolvePlanQuestion({
			workspacePath: input.workspacePath,
			slug: input.slug,
			questionId,
			resolution: { source: "auto", decision: loopResult.decision },
		});
		if (resolved.ok && resolved.changed) {
			summary.resolvedCount += 1;
		} else {
			summary.keptOpenIds.push(questionId);
		}
	}
	return summary;
}
