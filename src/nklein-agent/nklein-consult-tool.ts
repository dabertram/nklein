import {
	buildConsultantPrompt,
	CONSULT_TOOL_DESCRIPTION,
	CONSULT_TOOL_NAME,
	type ConsultCandidate,
	type ConsultRequest,
	clampConsultRequest,
	decideConsultAdmission,
	selectConsultant,
	wrapConsultAnswer,
} from "../core/model-consult";
import {
	buildConsultObservation,
	type ConsultObservation,
	formatConsultAnswerNotice,
	formatConsultDeclinedNotice,
	formatConsultStartNotice,
} from "../core/model-consult-visibility";
import type { AgentTool } from "./sdk-agent-types";

/**
 * F3.37 wire: `consult_stronger_model` as an `AgentTool`. The pure cores decide (admission, selection, prompt,
 * framing); this file threads them to the runtime's seams, all injected so tests drive every path:
 *
 *  - THE GATE RUNS TWICE, deliberately. Registration (session-runtime) admits the tool only when the card is
 *    already stuck, so an un-stuck session never even sees the schema (harness-enforced, per the core's design —
 *    a prompt-side rule alone would let an eager model consult on turn one). Execute re-derives admission from
 *    the LIVE ledger because a session can outlive its registration-time facts (budget spent by a sibling
 *    session of the same card, attempts reclassified) — and a declined consult must be a visible reply, not a
 *    silent no-op.
 *  - THE §5.AB VETO is the `loadedAndIdle` input: a candidate counts as idle only when no ACTIVE sibling !Klein
 *    session is running on it (the runtime's own session registry is the measurement — the same object that
 *    starts and stops sessions). A consult therefore never queues behind or preempts sibling card work; when
 *    every stronger model is occupied, it DECLINES, honestly. Scope stated plainly: traffic !Klein did not start
 *    (another app hitting the same gateway) is invisible to this veto — the receipt is about siblings, and the
 *    consultant call itself still runs under the gateway's own queueing.
 *  - `followUpOutcome` is recorded as null (pending) ALWAYS. Observations are append-only JSONL; whether the
 *    consult converted the card is joined at ANALYSIS time from subsequent attempt outcomes (the P15.3 pattern:
 *    the emit site records what it knows, the campaign joins what it needs — never a guess at emit time).
 */

export interface ConsultToolDeps {
	/** The CARD id (attempts and observations key on it). */
	taskId: string;
	askerModelId: string;
	/** Asker capability on the SAME scale as candidates (one derivation for both — mixed scales corrupt the margin). */
	askerCapability: number;
	/** Per-card consult budget (the harness bound; the core enforces it). */
	consultBudget: number;
	/** Live ledger-derived genuine-failure count (never `!== "success"` — see consult-failed-attempts.ts). */
	countFailedAttempts: () => Promise<number>;
	/** Consults already spent on this card (observation-derived at the wire). */
	countConsultsUsed: () => Promise<number>;
	/** Loaded models × sibling-idle × capability, joined at the wire. */
	gatherCandidates: () => Promise<readonly ConsultCandidate[]>;
	/** One bounded completion against the SELECTED consultant. Null = transport/endpoint failure (never throws). */
	runConsultCompletion: (input: { consultantModelId: string; prompt: string }) => Promise<string | null>;
	/** `recordSelfObservation(buildConsultObservation(…))` at the wire; injected so tests assert the record. */
	recordObservation: (observation: ConsultObservation) => void;
}

function asString(record: Record<string, unknown>, field: string): string {
	const value = record[field];
	return typeof value === "string" ? value : "";
}

export function createConsultTool(deps: ConsultToolDeps): AgentTool {
	return {
		name: CONSULT_TOOL_NAME,
		description: CONSULT_TOOL_DESCRIPTION,
		inputSchema: {
			type: "object",
			properties: {
				problem: {
					type: "string",
					description: "What you are trying to achieve and where exactly you are stuck.",
				},
				attempts_tried: {
					type: "string",
					description: "The materially different approaches you already tried, and how each failed.",
				},
				error_output: {
					type: "string",
					description: "The exact current error output, if any.",
				},
				relevant_context: {
					type: "string",
					description: "Only the relevant code/config snippets — never whole files you have not narrowed.",
				},
			},
			required: ["problem", "attempts_tried"],
			additionalProperties: false,
		},
		async execute(input) {
			const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
			const request: ConsultRequest = clampConsultRequest({
				problem: asString(record, "problem"),
				attemptsTried: asString(record, "attempts_tried"),
				errorOutput: asString(record, "error_output"),
				relevantContext: asString(record, "relevant_context"),
			});
			if (request.problem.length === 0 || request.attemptsTried.length === 0) {
				return { ok: false, error: "problem and attempts_tried must both be non-empty." };
			}

			// Re-derive the stuck-gate from live state (registration-time facts can be stale — see docblock).
			const [failedAttempts, consultsUsed] = await Promise.all([
				deps.countFailedAttempts(),
				deps.countConsultsUsed(),
			]);
			const admission = decideConsultAdmission({
				failedAttempts,
				consultsUsed,
				consultBudget: deps.consultBudget,
			});
			if (!admission.admitted) {
				return { ok: false, declined: formatConsultDeclinedNotice(admission.reason) };
			}

			const selection = selectConsultant({
				askerModelId: deps.askerModelId,
				askerCapability: deps.askerCapability,
				candidates: await deps.gatherCandidates(),
			});
			if (!selection.selected) {
				return { ok: false, declined: formatConsultDeclinedNotice(selection.reason) };
			}
			const consultant = selection.selected;

			const prompt = buildConsultantPrompt(request);
			const startNotice = formatConsultStartNotice({
				askerModelId: deps.askerModelId,
				consultantModelId: consultant.modelId,
				failedAttempts,
				problem: request.problem,
			});
			const startedAt = Date.now();
			const answer = await deps.runConsultCompletion({ consultantModelId: consultant.modelId, prompt });
			const durationMs = Date.now() - startedAt;
			if (answer === null || answer.trim().length === 0) {
				// An errored consult is visible AND does not spend the budget: `countConsultsUsed` derives usage
				// from recorded observations, and a failed completion records none.
				return {
					ok: false,
					declined: formatConsultDeclinedNotice(
						`${consultant.modelId} did not answer (endpoint error or empty completion after ${durationMs}ms) — continue with your own next approach.`,
					),
				};
			}

			deps.recordObservation(
				buildConsultObservation({
					taskId: deps.taskId,
					askerModelId: deps.askerModelId,
					consultantModelId: consultant.modelId,
					admissionReason: admission.reason,
					requestBytes: Buffer.byteLength(prompt, "utf8"),
					answerBytes: Buffer.byteLength(answer, "utf8"),
					durationMs,
					followUpOutcome: null,
				}),
			);
			// The notices head the tool RESULT: chat renders the call (start visibility) and this result (answer
			// visibility) in the transcript; the observation above carries the same facts into the N18 timeline.
			return {
				ok: true,
				notice: `${startNotice}\n${formatConsultAnswerNotice({
					consultantModelId: consultant.modelId,
					durationMs,
					answerBytes: Buffer.byteLength(answer, "utf8"),
				})}`,
				answer: wrapConsultAnswer({ consultantModelId: consultant.modelId, answer }),
			};
		},
	};
}
