import type { ReviewSubmissionInput } from "../core/review-orchestration";
import {
	combinePanelVerdicts,
	mapReviewSubmissionToPanelVerdict,
	type PanelVerdictOptions,
	type PanelVerdictResult,
} from "../core/review-panel-verdict";

/**
 * §5.AB parallel panel-of-judges ORCHESTRATION (David 2026-07-07: "3 diverse judges, majority + security veto"). The
 * review lifecycle runs ONE review session → ONE submission → `resolveReviewTransition`. This collapses N diverse
 * judges into that SAME single effective submission, so the rest of the lifecycle (deliver / bounce / park / escalation
 * ladder / speculative arbitration) is UNCHANGED — the panel only changes HOW the one verdict is formed.
 *
 * Each judge's review session is run via the injected `runJudgeSession` (kept pure of the live task-session service, so
 * this is unit-testable with fakes). A judge that yields no verdict (unreachable / stalled) is dropped, not fatal;
 * returns null when NO judge produced a verdict (the caller then falls back to the single-reviewer path).
 *
 * ⚠ Judges MUST run SEQUENTIALLY (this loop awaits each). Two reasons: (1) no N-way concurrent load on a shared local
 * endpoint; (2) CORRECTNESS — the live reviewer session id is fixed per task (`<taskId>::review`) and its workspace is
 * shared, so `nklein-second-opinion-review-runner` warns "two concurrent rounds destroy each other" (one round's
 * teardown would nuke another's workspace mid-turn). Sequential judges are safe (each fully completes setup→review→
 * teardown before the next, exactly like sequential review ROUNDS). **A future PARALLEL refinement MUST first give each
 * judge a UNIQUE reviewer session id** (e.g. `<taskId>::review::<judgeIdx>`) — do not parallelize this loop as-is.
 */

export interface PanelJudge {
	/** The judge's stable model key (audit trail + verdict identity). */
	judgeModelKey: string;
	/** The reviewer model the judge's session launches with. */
	reviewer: { providerId: string; modelId: string };
}

export interface ReviewPanelResult {
	/** The single effective submission that feeds the existing `resolveReviewTransition` (approve / request_changes). */
	submission: ReviewSubmissionInput;
	/** The combined panel decision (merge/block + who vetoed) for logging + the review record. */
	decision: PanelVerdictResult;
	/** Each judge's raw submission (dropped judges excluded) — the audit trail. */
	judgeSubmissions: readonly { judgeModelKey: string; submission: ReviewSubmissionInput }[];
}

/** Aggregate the judges into ONE submission: merge⇒approve; block⇒request_changes carrying the dissenters' feedback. */
function buildEffectivePanelSubmission(
	decision: PanelVerdictResult,
	judgeSubmissions: readonly { judgeModelKey: string; submission: ReviewSubmissionInput }[],
): ReviewSubmissionInput {
	const merge = decision.decision === "merge";
	// On a block, give the worker the dissenting/vetoing judges' feedback (actionable direction); on a merge, keep any
	// notes the approving judges left. Each line is attributed to its judge so the worker sees who said what.
	const source = merge
		? judgeSubmissions
		: judgeSubmissions.filter(({ submission }) => submission.verdict === "request_changes");
	const feedback =
		source
			.map(({ judgeModelKey, submission }) =>
				submission.feedback?.trim() ? `[${judgeModelKey}] ${submission.feedback.trim()}` : null,
			)
			.filter((line): line is string => line !== null)
			.join("\n\n") || null;
	const insight =
		judgeSubmissions.map(({ submission }) => submission.insight?.trim()).find((value) => Boolean(value)) ?? null;
	// A/B arbitration: carry the pick of the first APPROVING judge (a blocking panel isn't delivering a candidate anyway).
	const preferred =
		judgeSubmissions.find(({ submission }) => submission.verdict === "approve")?.submission.preferred ?? null;
	return {
		verdict: merge ? "approve" : "request_changes",
		summary: `Panel: ${decision.passes}/${decision.total} judges approved${decision.vetoedBy ? ` — vetoed by ${decision.vetoedBy}` : ""}.`,
		feedback,
		insight,
		preferred,
		blocking: decision.vetoedBy !== null,
	};
}

export async function runReviewPanel(input: {
	judges: readonly PanelJudge[];
	runJudgeSession: (judge: PanelJudge) => Promise<ReviewSubmissionInput | null>;
	panelOptions?: PanelVerdictOptions;
}): Promise<ReviewPanelResult | null> {
	const judgeSubmissions: { judgeModelKey: string; submission: ReviewSubmissionInput }[] = [];
	for (const judge of input.judges) {
		const submission = await input.runJudgeSession(judge).catch(() => null);
		if (submission) {
			judgeSubmissions.push({ judgeModelKey: judge.judgeModelKey, submission });
		}
	}
	if (judgeSubmissions.length === 0) {
		return null;
	}
	const decision = combinePanelVerdicts(
		judgeSubmissions.map(({ judgeModelKey, submission }) =>
			mapReviewSubmissionToPanelVerdict(judgeModelKey, submission),
		),
		input.panelOptions,
	);
	return { submission: buildEffectivePanelSubmission(decision, judgeSubmissions), decision, judgeSubmissions };
}
