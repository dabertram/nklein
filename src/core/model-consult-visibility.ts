/**
 * Operator visibility for `consult_stronger_model` (F3.37 companion; David 2026-07-23: "make sure details of
 * what is happening are properly shown — in chat, and wherever it makes sense"). A consult is a cross-model
 * hand-off the operator must be able to SEE: which model asked, which answered, why the gate admitted it, what
 * it cost, and whether it helped. These are the PURE presentation/observation builders; the wire emits them at
 * four surfaces (no new UI chrome — !Klein's no-bloat rule reuses existing streams):
 *
 *  1. CHAT transcript — a distinct notice when the consult starts and when it answers, so the hand-off reads as
 *     an explicit step in the session, never buried inside generic tool-call rendering.
 *  2. LIVE session status — a "Consulting <model>…" label for the running-state chip while the consult is in
 *     flight (the F12.51 "whose turn is it" surface).
 *  3. CARD trail/timeline — one compact entry per consult so post-hoc review shows the escalation without
 *     replaying the transcript.
 *  4. TELEMETRY/ledger — a `model_consult` self-observation carrying the measurable facts (asker, consultant,
 *     admission reason, bytes, duration, and the follow-up outcome once known) so `dev mechanism-registry` and
 *     the P15.3 evidence bar can judge the mechanism from data.
 */

/** The single telemetry category every consult emission uses (one string, so a typo cannot half-wire this). */
export const MODEL_CONSULT_CATEGORY = "model_consult";

export interface ConsultObservationInput {
	taskId: string;
	askerModelId: string;
	consultantModelId: string;
	/** Why the harness gate admitted this consult (from `decideConsultAdmission`). */
	admissionReason: string;
	requestBytes: number;
	answerBytes: number;
	durationMs: number;
	/**
	 * The asker's NEXT attempt outcome once known ("success" | "failed" | null while pending) — the one number
	 * that says whether consulting converts stuck cards (the F3.37 evidence bar reads this).
	 */
	followUpOutcome: "success" | "failed" | null;
}

export interface ConsultObservation {
	signal: "custom";
	severity: "info";
	message: string;
	taskId: string;
	metadata: {
		category: typeof MODEL_CONSULT_CATEGORY;
		askerModelId: string;
		consultantModelId: string;
		admissionReason: string;
		requestBytes: number;
		answerBytes: number;
		durationMs: number;
		followUpOutcome: "success" | "failed" | null;
	};
}

/** Build the `model_consult` self-observation record (the telemetry/ledger surface). */
export function buildConsultObservation(input: ConsultObservationInput): ConsultObservation {
	return {
		signal: "custom",
		severity: "info",
		message: `Model consult on ${input.taskId}: ${input.askerModelId} asked ${input.consultantModelId} (${input.durationMs}ms, ${input.answerBytes}B answer).`,
		taskId: input.taskId,
		metadata: {
			category: MODEL_CONSULT_CATEGORY,
			askerModelId: input.askerModelId,
			consultantModelId: input.consultantModelId,
			admissionReason: input.admissionReason,
			requestBytes: input.requestBytes,
			answerBytes: input.answerBytes,
			durationMs: input.durationMs,
			followUpOutcome: input.followUpOutcome,
		},
	};
}

const CONSULT_PROBLEM_SUMMARY_CHARS = 140;

/** One-line problem summary for notices (first line, hard-capped). */
export function summarizeConsultProblem(problem: string): string {
	const firstLine = problem.trim().split("\n", 1)[0] ?? "";
	return firstLine.length <= CONSULT_PROBLEM_SUMMARY_CHARS
		? firstLine
		: `${firstLine.slice(0, CONSULT_PROBLEM_SUMMARY_CHARS)}…`;
}

/**
 * CHAT surface, consult START: emitted into the session stream the moment the consult fires, so the operator
 * sees the hand-off as it happens (not only after the answer lands).
 */
export function formatConsultStartNotice(input: {
	askerModelId: string;
	consultantModelId: string;
	failedAttempts: number;
	problem: string;
}): string {
	return `🤝 Consulting stronger model ${input.consultantModelId} — ${input.askerModelId} is stuck after ${input.failedAttempts} failed attempt(s): "${summarizeConsultProblem(input.problem)}"`;
}

/** CHAT surface, consult ANSWER: pairs with the start notice; the advisory answer itself follows as the tool result. */
export function formatConsultAnswerNotice(input: {
	consultantModelId: string;
	durationMs: number;
	answerBytes: number;
}): string {
	const seconds = Math.round(input.durationMs / 100) / 10;
	return `🤝 ${input.consultantModelId} answered in ${seconds}s (${input.answerBytes}B, advisory) — the worker verifies and applies below.`;
}

/** CHAT surface, consult DECLINED: a declined consult must be as visible as a granted one (never a silent no-op). */
export function formatConsultDeclinedNotice(reason: string): string {
	return `🤝 Consult declined: ${reason}`;
}

/** LIVE status label while the consult is in flight (the running-state chip / session summary surface). */
export function consultInFlightStatusLabel(consultantModelId: string): string {
	return `Consulting ${consultantModelId}…`;
}

/** CARD trail/timeline entry: the whole consult in one compact line for post-hoc review. */
export function describeConsultForTrail(input: {
	askerModelId: string;
	consultantModelId: string;
	durationMs: number;
	followUpOutcome: "success" | "failed" | null;
}): string {
	const outcome =
		input.followUpOutcome === null
			? "follow-up pending"
			: input.followUpOutcome === "success"
				? "next attempt SUCCEEDED"
				: "next attempt still failed";
	return `Consult: ${input.askerModelId} → ${input.consultantModelId} (${Math.round(input.durationMs / 1000)}s; ${outcome})`;
}
