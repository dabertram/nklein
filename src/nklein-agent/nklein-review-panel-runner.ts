import {
	buildConferAssignments,
	type ConferResponse,
	type ConferredFinding,
	dedupeEyeFindings,
	type EyeFinding,
	type EyeFindingsReport,
	type NEyesEye,
	planNEyesSchedule,
	resolveConferredFindings,
	shouldScheduleAnotherEye,
} from "../core/n-eyes-review-schedule";
import type { ReviewSubmissionInput } from "../core/review-orchestration";
import {
	combinePanelVerdicts,
	mapReviewSubmissionToPanelVerdict,
	type PanelVerdictOptions,
	type PanelVerdictResult,
	type PanelVerdictSeverity,
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

// ─── F1.37b: the N-eyes mount — blind lens-diverse eyes, marginal-value stop, then confer ───────────────────────

/** Appended to each eye's seed prompt so findings arrive machine-parseable alongside the normal verdict. */
export const EYE_FINDINGS_FORMAT_INSTRUCTION = `

Additionally, END your feedback with a FINDINGS block — one line per DISTINCT issue you found, formatted exactly:
FINDING: [<category>|<severity>] <one-line summary>
where <category> is one of security, correctness, performance, style, testing, other and <severity> is one of low, medium, high, critical. No findings ⇒ no FINDING lines.`;

const FINDING_LINE = /^FINDING:\s*\[([a-z_-]+)\|(low|medium|high|critical)\]\s*(.+)$/i;
const SEVERITIES: ReadonlySet<string> = new Set(["low", "medium", "high", "critical"]);

/**
 * Parse an eye's FINDING lines from its feedback (tolerant: weak models mangle formats). Fallback: a blocking
 * submission with NO parseable lines still yields ONE finding from its first feedback line, so a
 * request_changes verdict is never invisible to the dedupe/confer machinery; an approving, findings-less eye
 * legitimately yields none.
 */
export function parseEyeFindings(submission: ReviewSubmissionInput, fallbackCategory: string): EyeFinding[] {
	const findings: EyeFinding[] = [];
	for (const line of (submission.feedback ?? "").split(/\r?\n/)) {
		const match = FINDING_LINE.exec(line.trim());
		if (match?.[1] && match[2] && match[3]) {
			const severity = match[2].toLowerCase();
			findings.push({
				category: match[1].toLowerCase(),
				severity: (SEVERITIES.has(severity) ? severity : "medium") as PanelVerdictSeverity,
				summary: match[3].trim(),
			});
		}
	}
	if (findings.length === 0 && submission.verdict === "request_changes") {
		const firstLine = (submission.feedback ?? submission.summary ?? "").split(/\r?\n/)[0]?.trim();
		if (firstLine) {
			findings.push({ category: fallbackCategory, severity: "medium", summary: firstLine.slice(0, 300) });
		}
	}
	return findings;
}

const CONFER_LINE = /^CONFER:\s*(\d+)\s*(confirm|dispute)\b/i;

/** Build the confer prompt for one eye: the OTHER eyes' findings, numbered, with the strict response format. */
export function buildConferPrompt(findings: readonly { index: number; finding: ConferredFindingSource }[]): string {
	const lines = findings.map(
		({ index, finding }) => `${index}. (${finding.severity}/${finding.category}) ${finding.summary}`,
	);
	return `

CONFER ROUND: other reviewers raised the findings below. For EACH, judge against the diff you reviewed and answer with one line per finding, formatted exactly:
CONFER: <number> confirm
or
CONFER: <number> dispute
Findings:
${lines.join("\n")}`;
}

interface ConferredFindingSource {
	key: string;
	category: string;
	severity: PanelVerdictSeverity;
	summary: string;
}

/** Parse an eye's CONFER lines back into responses (unparseable lines are ignored — silence is neither vote). */
export function parseConferResponses(
	eyeId: string,
	text: string | null,
	numbered: readonly { index: number; finding: ConferredFindingSource }[],
): ConferResponse[] {
	if (!text) {
		return [];
	}
	const byIndex = new Map(numbered.map(({ index, finding }) => [index, finding.key]));
	const responses: ConferResponse[] = [];
	for (const line of text.split(/\r?\n/)) {
		const match = CONFER_LINE.exec(line.trim());
		const findingKey = match?.[1] ? byIndex.get(Number(match[1])) : undefined;
		if (match?.[2] && findingKey) {
			responses.push({ eyeId, findingKey, stance: match[2].toLowerCase() as "confirm" | "dispute" });
		}
	}
	return responses;
}

export interface NEyesPanelResult extends ReviewPanelResult {
	/** The blind-then-confer outcome (empty when no findings surfaced or no confer runner was supplied). */
	conferred: readonly ConferredFinding[];
	/** The eyes that actually ran (schedule order; early-stopped schedules list fewer than planned). */
	eyesRun: readonly NEyesEye[];
}

/**
 * F1.37b — run the N-eyes protocol over the SAME sequential judge-session machinery as the plain panel:
 * each eye is a DISTINCT (judge, lens) pair (`planNEyesSchedule`), eyes run blind with the lens stance + the
 * findings format appended to the shared seed, the marginal-value stop ends the schedule early once eyes stop
 * finding anything new, and an optional confer round re-prompts each judge with the OTHERS' findings
 * (`resolveConferredFindings` — out-vote drops, disputes surface, veto-class security/correctness findings are
 * never silently dropped). The final submission is the plain panel combine, with the conferred findings block
 * appended so the worker/operator sees what survived. ⚠ Eyes MUST stay sequential (same reviewer-session-id
 * constraint as `runReviewPanel`).
 */
export async function runNEyesReviewPanel(input: {
	judges: readonly PanelJudge[];
	reviewerTier: "weak" | "mid" | "strong";
	maxEyes: number;
	/** Run one eye's review session; `promptSuffix` = lens stance + findings format (append to the seed). */
	runEyeSession: (eye: NEyesEye, judge: PanelJudge, promptSuffix: string) => Promise<ReviewSubmissionInput | null>;
	/** Optional confer round (re-prompt the eye's judge; return its raw text). Absent ⇒ findings stand as deduped. */
	runConferSession?: (eye: NEyesEye, judge: PanelJudge, conferPrompt: string) => Promise<string | null>;
	panelOptions?: PanelVerdictOptions;
	warn?: (line: string) => void;
}): Promise<NEyesPanelResult | null> {
	const judgeByKey = new Map(input.judges.map((judge) => [judge.judgeModelKey, judge]));
	const schedule = planNEyesSchedule({
		judges: input.judges.map((judge) => ({ judgeModelKey: judge.judgeModelKey })),
		reviewerTier: input.reviewerTier,
		maxEyes: input.maxEyes,
	});
	if (schedule.length === 0) {
		return null;
	}
	const eyesRun: NEyesEye[] = [];
	const reports: EyeFindingsReport[] = [];
	const judgeSubmissions: { judgeModelKey: string; submission: ReviewSubmissionInput }[] = [];
	const submissionByEyeId = new Map<string, ReviewSubmissionInput>();
	for (const eye of schedule) {
		const judge = judgeByKey.get(eye.judgeModelKey);
		if (!judge) {
			continue;
		}
		const promptSuffix = `\n\n${eye.lens.stance}${EYE_FINDINGS_FORMAT_INSTRUCTION}`;
		const submission = await input.runEyeSession(eye, judge, promptSuffix).catch(() => null);
		if (!submission) {
			continue; // a dropped eye is not fatal — same posture as the plain panel
		}
		eyesRun.push(eye);
		submissionByEyeId.set(eye.eyeId, submission);
		judgeSubmissions.push({ judgeModelKey: eye.judgeModelKey, submission });
		reports.push({ eyeId: eye.eyeId, findings: parseEyeFindings(submission, eye.lens.id) });
		if (eyesRun.length >= 2 && !shouldScheduleAnotherEye(dedupeEyeFindings(reports))) {
			input.warn?.(`N-eyes: stopping after ${eyesRun.length}/${schedule.length} eyes (marginal value exhausted).`);
			break;
		}
	}
	if (judgeSubmissions.length === 0) {
		return null;
	}
	const dedup = dedupeEyeFindings(reports);
	let conferred: ConferredFinding[] = [];
	if (input.runConferSession && dedup.unique.length > 0 && eyesRun.length > 1) {
		const responses: ConferResponse[] = [];
		for (const assignment of buildConferAssignments(dedup, eyesRun)) {
			if (assignment.findingKeys.length === 0) {
				continue;
			}
			const eye = eyesRun.find((candidate) => candidate.eyeId === assignment.eyeId);
			const judge = eye ? judgeByKey.get(eye.judgeModelKey) : undefined;
			if (!eye || !judge) {
				continue;
			}
			const numbered = assignment.findingKeys
				.map((key, index) => {
					const finding = dedup.unique.find((candidate) => candidate.key === key);
					return finding ? { index: index + 1, finding } : null;
				})
				.filter((entry): entry is { index: number; finding: (typeof dedup.unique)[number] } => entry !== null);
			const text = await input.runConferSession(eye, judge, buildConferPrompt(numbered)).catch(() => null);
			responses.push(...parseConferResponses(eye.eyeId, text, numbered));
		}
		conferred = resolveConferredFindings(dedup, responses);
	} else if (dedup.unique.length > 0) {
		conferred = resolveConferredFindings(dedup, []);
	}
	const decision = combinePanelVerdicts(
		judgeSubmissions.map(({ judgeModelKey, submission }) =>
			mapReviewSubmissionToPanelVerdict(judgeModelKey, submission),
		),
		input.panelOptions,
	);
	const submission = buildEffectivePanelSubmission(decision, judgeSubmissions);
	const surviving = conferred.filter((finding) => finding.status !== "dropped");
	if (surviving.length > 0) {
		const findingsBlock = surviving
			.map((finding) => `[${finding.status}] (${finding.severity}/${finding.category}) ${finding.summary}`)
			.join("\n");
		submission.feedback = [submission.feedback, `Panel findings after confer:\n${findingsBlock}`]
			.filter(Boolean)
			.join("\n\n");
	}
	return { submission, decision, judgeSubmissions, conferred, eyesRun };
}
