/**
 * Model-initiated peer consultation (`consult_stronger_model`) — adopted from the pattern described in the XDA
 * Developers article "I taught my local LLM to call Fable 5 when it gets stuck" (see docs/attributions.md):
 * instead of the HARNESS tearing the session down and re-driving on a different model (`cross_model_carry` —
 * full redrive, cold prompt cache, work redone), the STUCK MODEL ITSELF calls a tool that puts a scoped,
 * distilled question to a stronger model and continues in place with the answer as a tool result. The weak
 * model keeps its session, its prompt cache, and its agency; the strong model spends tokens on ONE focused
 * completion instead of taking over the whole card.
 *
 * !Klein's adaptation, per the local-only prime directive: the consultant is the strongest ELIGIBLE **local**
 * model (loaded, idle, materially stronger, not the asker). A cloud consultant (the article's actual setup) is
 * a Phase 14 variant and stays hard-gated until David's explicit cloud go.
 *
 * The stuck-gate is enforced BOTH ways: the tool description states the conditions (the article's prompt-side
 * gate), and the harness admits the tool only after enough failed attempts (recover in !Klein — never trust a
 * prompt rule alone). Pure + total: candidates and counters in, decisions and prompts out; the effectful wire
 * (tool registration, gateway call, ledger event) is a separate package.
 */

/** The tool name the worker sees. */
export const CONSULT_TOOL_NAME = "consult_stronger_model";

/** Cap each request field so a consult can never smuggle a whole repository into the consultant's context. */
export const CONSULT_FIELD_CHAR_CAP = 4_000;

/**
 * The article's three stuck-conditions, adapted — embedded in the tool description so the model self-gates.
 * The harness-side gate below is the enforcement; this text is the guidance.
 */
export const CONSULT_TOOL_DESCRIPTION =
	`Ask a stronger model for help with a problem you are genuinely stuck on. Call ${CONSULT_TOOL_NAME} ONLY when: ` +
	"(1) two materially different approaches have failed, (2) the same error persists after both, and (3) you cannot " +
	"identify another reasonable approach. Repeating test runs without conceptual changes does not qualify. " +
	"Describe the problem, what you tried, the exact error, and only the RELEVANT code — never whole files you have " +
	"not narrowed. The answer is advisory: verify every claim against the repository before acting on it.";

export interface ConsultRequest {
	/** What the model is trying to achieve and where it is stuck. */
	problem: string;
	/** The materially different approaches already tried (the stuck-gate's own evidence). */
	attemptsTried: string;
	/** The exact current error output, if any. */
	errorOutput: string;
	/** Only the relevant snippets — capped, never a repository dump. */
	relevantContext: string;
}

/** Clamp every field to the cap so the consultant prompt stays a scoped question. */
export function clampConsultRequest(request: ConsultRequest): ConsultRequest {
	const clamp = (value: string): string =>
		value.length <= CONSULT_FIELD_CHAR_CAP ? value : `${value.slice(0, CONSULT_FIELD_CHAR_CAP)}\n…[truncated]`;
	return {
		problem: clamp(request.problem.trim()),
		attemptsTried: clamp(request.attemptsTried.trim()),
		errorOutput: clamp(request.errorOutput.trim()),
		relevantContext: clamp(request.relevantContext.trim()),
	};
}

/**
 * HARNESS-side stuck gate: the tool is admitted into the session's tool set only after the card has recorded
 * enough failed attempts — a prompt-side rule alone would let an eager model consult on turn one.
 */
export const CONSULT_MIN_FAILED_ATTEMPTS = 2;

export interface ConsultAdmissionInput {
	/** Failed/bounced attempts recorded for this card so far (ledger-derived). */
	failedAttempts: number;
	/** Consults already spent on this card (bounded so consultation cannot become the loop). */
	consultsUsed: number;
	/** Per-card consult budget. */
	consultBudget: number;
}

export interface ConsultAdmission {
	admitted: boolean;
	reason: string;
}

export function decideConsultAdmission(input: ConsultAdmissionInput): ConsultAdmission {
	if (input.consultsUsed >= input.consultBudget) {
		return {
			admitted: false,
			reason: `Consult budget spent (${input.consultsUsed}/${input.consultBudget}) — the ladder, not more consulting, owns further recovery.`,
		};
	}
	if (input.failedAttempts < CONSULT_MIN_FAILED_ATTEMPTS) {
		return {
			admitted: false,
			reason: `Only ${input.failedAttempts} failed attempt(s) recorded — the stuck-gate needs ${CONSULT_MIN_FAILED_ATTEMPTS} materially different failures first.`,
		};
	}
	return { admitted: true, reason: "Stuck-gate satisfied: repeated failure with budget remaining." };
}

/** A candidate consultant, dependency-light (derived from the model registry + live fleet state at the wire). */
export interface ConsultCandidate {
	/** Registry key (provider:model:endpoint). */
	key: string;
	modelId: string;
	/** Effective capability score (registry `capability.effectiveScore`). */
	capability: number;
	/** Resident AND currently idle — a consult must never queue behind or preempt sibling card work. */
	loadedAndIdle: boolean;
}

/** The asker must gain real capability for the consult to be worth its tokens. */
export const CONSULT_MIN_CAPABILITY_MARGIN = 10;

export interface ConsultantSelection {
	selected: ConsultCandidate | null;
	reason: string;
}

/**
 * Pick the strongest eligible LOCAL consultant: loaded+idle, not the asker's own model, and materially stronger
 * (≥ margin). Never loads/unloads anything — a fleet with no eligible consultant declines, honestly.
 */
export function selectConsultant(input: {
	askerModelId: string;
	askerCapability: number;
	candidates: readonly ConsultCandidate[];
}): ConsultantSelection {
	const eligible = input.candidates
		.filter((candidate) => candidate.loadedAndIdle)
		.filter((candidate) => candidate.modelId !== input.askerModelId)
		.filter((candidate) => candidate.capability >= input.askerCapability + CONSULT_MIN_CAPABILITY_MARGIN)
		.sort((a, b) => b.capability - a.capability || a.key.localeCompare(b.key));
	const selected = eligible[0] ?? null;
	if (!selected) {
		return {
			selected: null,
			reason: `No loaded, idle local model is ≥${CONSULT_MIN_CAPABILITY_MARGIN} capability points stronger than ${input.askerModelId} — declining the consult (never load/unload for one).`,
		};
	}
	return {
		selected,
		reason: `Selected ${selected.modelId} (capability ${selected.capability} vs asker ${input.askerCapability}).`,
	};
}

/**
 * The consultant's single-turn prompt: diagnose + concrete fix, bounded. Framed as a peer consult so the
 * consultant answers the QUESTION instead of re-planning the whole card.
 */
export function buildConsultantPrompt(request: ConsultRequest): string {
	const clamped = clampConsultRequest(request);
	return [
		"You are a senior engineer consulted by a colleague who is stuck. Answer THEIR question — diagnose the likely root cause and give a concrete, minimal fix or next approach. Do not re-plan their whole task.",
		`## Problem\n${clamped.problem}`,
		`## Approaches already tried (both failed)\n${clamped.attemptsTried}`,
		clamped.errorOutput ? `## Current error\n${clamped.errorOutput}` : null,
		clamped.relevantContext ? `## Relevant code/context\n${clamped.relevantContext}` : null,
		"Reply with: (1) the most likely root cause, (2) the concrete fix or next approach, (3) what to check if that fails. Be specific and brief.",
	]
		.filter((section): section is string => section !== null)
		.join("\n\n");
}

/**
 * Wrap the consultant's answer for the asker's tool result: clearly advisory (same trust framing as the plan
 * critic — the asker verifies against the repository, never treats the consult as ground truth).
 */
export function wrapConsultAnswer(input: { consultantModelId: string; answer: string }): string {
	return (
		`[consult answer from ${input.consultantModelId} — ADVISORY: verify every claim against the actual repository behavior before acting on it]\n\n` +
		input.answer.trim()
	);
}
