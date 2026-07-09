/**
 * Model-aware stall decisions for live verification harnesses.
 *
 * A workspace session saying "running" is not itself proof of model progress. The ground truth is a combination of
 * observable workspace/session output and the LM Studio `lms ps --json` state for the model that is supposed to be serving
 * that session. This pure helper keeps the "do not wait on false hope" rule testable.
 */

export interface QuietRunningSession {
	id: string;
	modelId?: string | null;
}

export interface LmsSessionModelSnapshot {
	identifier: string;
	modelKey?: string | null;
	machineId?: string | null;
	status?: string | null;
	queued?: number | null;
}

export type QuietRunningSessionStallReason =
	| "idle_running_session"
	| "active_running_session_timeout"
	| "unobservable_running_session_timeout";

export type QuietRunningSessionStallVerdict =
	| {
			action: "wait";
			reason: string;
			lmsSummary: string;
	  }
	| {
			action: "abort";
			reasonCode: QuietRunningSessionStallReason;
			reason: string;
			lmsSummary: string;
	  };

export interface EvaluateQuietRunningSessionStallInput {
	runningSessions: readonly QuietRunningSession[];
	lmsModels: readonly LmsSessionModelSnapshot[];
	quietMs: number;
	idleStallMs: number;
	activeStallMs: number;
}

type ObservedModelState = "active" | "idle" | "unknown";

interface SessionObservation {
	session: QuietRunningSession;
	model: LmsSessionModelSnapshot | null;
	state: ObservedModelState;
}

function normalizeModelText(value: string | null | undefined): string {
	return (value ?? "").trim().toLowerCase();
}

function normalizeStatus(value: string | null | undefined): string {
	return normalizeModelText(value).replace(/[\s_-]/g, "");
}

function matchesRequestedModel(model: LmsSessionModelSnapshot, requestedModelId: string | null | undefined): boolean {
	const wanted = normalizeModelText(requestedModelId);
	if (!wanted) {
		return false;
	}
	const candidates = [model.identifier, model.modelKey].map(normalizeModelText).filter(Boolean);
	return candidates.some(
		(candidate) => candidate === wanted || candidate.includes(wanted) || wanted.includes(candidate),
	);
}

function classifyModelState(model: LmsSessionModelSnapshot | null): ObservedModelState {
	if (!model) {
		return "unknown";
	}
	if ((model.queued ?? 0) > 0) {
		return "active";
	}
	const status = normalizeStatus(model.status);
	if (!status) {
		return "unknown";
	}
	if (status === "idle" || status === "loaded") {
		return "idle";
	}
	return "active";
}

function observeSessions(input: EvaluateQuietRunningSessionStallInput): SessionObservation[] {
	return input.runningSessions.map((session) => {
		const model = input.lmsModels.find((candidate) => matchesRequestedModel(candidate, session.modelId)) ?? null;
		return { session, model, state: classifyModelState(model) };
	});
}

function formatObservation(observation: SessionObservation): string {
	const sessionLabel = `${observation.session.id}:${observation.session.modelId ?? "model=?"}`;
	if (!observation.model) {
		return `${sessionLabel}=unobserved`;
	}
	const model = observation.model;
	const location = model.machineId ? `@${model.machineId}` : "";
	return `${sessionLabel}=${model.identifier}${location}:${model.status ?? "unknown"} q=${model.queued ?? 0}`;
}

function summarizeObservations(observations: readonly SessionObservation[]): string {
	return observations.length > 0 ? observations.map(formatObservation).join("; ") : "(no running sessions)";
}

/**
 * Decide whether quiet `running` sessions are still worth waiting on.
 *
 * - An LM Studio-observed IDLE model behind a still-running session is a short-window stall.
 * - A model that remains PROCESSINGPROMPT/GENERATING/etc. gets a longer bounded window, but never an infinite waiver.
 * - If `lms ps` cannot observe the running session's model, the same long bounded window applies.
 */
export function evaluateQuietRunningSessionStall(
	input: EvaluateQuietRunningSessionStallInput,
): QuietRunningSessionStallVerdict {
	if (input.runningSessions.length === 0) {
		return { action: "wait", reason: "No running sessions.", lmsSummary: "(no running sessions)" };
	}

	const observations = observeSessions(input);
	const lmsSummary = summarizeObservations(observations);
	const quietSeconds = Math.round(input.quietMs / 1000);
	const hasIdleModel = observations.some((observation) => observation.state === "idle");
	const hasActiveModel = observations.some((observation) => observation.state === "active");

	if (hasIdleModel && input.quietMs >= input.idleStallMs) {
		return {
			action: "abort",
			reasonCode: "idle_running_session",
			reason: `running session(s) had no observable progress for ${quietSeconds}s while LM Studio reports a serving model idle`,
			lmsSummary,
		};
	}

	if (input.quietMs >= input.activeStallMs) {
		if (hasActiveModel) {
			return {
				action: "abort",
				reasonCode: "active_running_session_timeout",
				reason: `running session(s) had no observable progress for ${quietSeconds}s even though LM Studio still reports model activity`,
				lmsSummary,
			};
		}
		return {
			action: "abort",
			reasonCode: "unobservable_running_session_timeout",
			reason: `running session(s) had no observable progress for ${quietSeconds}s and LM Studio did not confirm active model work`,
			lmsSummary,
		};
	}

	return {
		action: "wait",
		reason: hasActiveModel
			? "LM Studio still reports active model work inside the bounded quiet window."
			: "No abort threshold crossed for quiet running sessions.",
		lmsSummary,
	};
}
