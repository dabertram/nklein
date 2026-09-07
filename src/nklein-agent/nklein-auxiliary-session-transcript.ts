import type { NKleinSdkPersistedMessage } from "./sdk-runtime-boundary.js";

/**
 * P0.REVIEWNOVERDICT (2026-09-07): why a follow-up prompt to an auxiliary (`::review` / `::merge` / …) session
 * whose LIVE session is gone could not be resumed from its persisted transcript. Each reason is objective and
 * deterministic — retrying the same follow-up cannot change it, so runners stop nudging and record it instead.
 */
export type AuxiliarySessionTranscriptUnavailableReason =
	/** The service holds no start input for this synthetic id (torn down, or never started through the aux seam). */
	| "no_cached_start"
	/** The SDK has no persisted session record for this id — nothing was ever persisted. */
	| "no_persisted_session"
	/** The persisted transcript holds no assistant turn: resuming it would replay the seed prompt from scratch. */
	| "no_assistant_turn"
	/** The transcript plus the follow-up prompt overflows the model's context window even after compaction. */
	| "transcript_overflows_window";

const REASON_TEXT: Record<AuxiliarySessionTranscriptUnavailableReason, string> = {
	no_cached_start: "no auxiliary start is cached to rebuild the session from",
	no_persisted_session: "the SDK persisted no session record for it",
	no_assistant_turn:
		"its persisted transcript holds no assistant turn — a follow-up would restart the session from its seed prompt with no memory of the work so far",
	transcript_overflows_window:
		"its persisted transcript plus the follow-up prompt overflows the model's context window even after compaction",
};

function describeAuxiliarySessionTranscriptUnavailable(
	taskId: string,
	reason: AuxiliarySessionTranscriptUnavailableReason,
): string {
	return `Auxiliary session ${taskId} has no live session and cannot be resumed from its transcript: ${REASON_TEXT[reason]}.`;
}

/**
 * Thrown by the service's auxiliary follow-up seam when the live session is gone AND the persisted transcript
 * cannot carry the follow-up. Typed so a runner can tell "this nudge can never land" (stop nudging, park with the
 * reason) from a transient turn error (keep nudging).
 */
export class AuxiliarySessionTranscriptUnavailableError extends Error {
	readonly taskId: string;
	readonly reason: AuxiliarySessionTranscriptUnavailableReason;

	constructor(taskId: string, reason: AuxiliarySessionTranscriptUnavailableReason, options?: { cause?: unknown }) {
		super(describeAuxiliarySessionTranscriptUnavailable(taskId, reason), options);
		this.name = "AuxiliarySessionTranscriptUnavailableError";
		this.taskId = taskId;
		this.reason = reason;
	}
}

export function isAuxiliarySessionTranscriptUnavailableError(
	error: unknown,
): error is AuxiliarySessionTranscriptUnavailableError {
	return (
		error instanceof AuxiliarySessionTranscriptUnavailableError ||
		(typeof error === "object" &&
			error !== null &&
			(error as { name?: unknown }).name === "AuxiliarySessionTranscriptUnavailableError")
	);
}

/**
 * The assistant turns a persisted transcript holds. The SDK persists the primary agent's messages on every
 * `iteration_end`, so a session cut mid-exploration keeps every completed iteration; a transcript with ZERO
 * assistant turns is just the seed prompt, and resuming it is the ghost restart P1.REVIEWNUDGE ruled out.
 */
export function countAssistantTurns(messages: readonly NKleinSdkPersistedMessage[] | null | undefined): number {
	if (!messages) {
		return 0;
	}
	let count = 0;
	for (const message of messages) {
		if (message.role === "assistant") {
			count += 1;
		}
	}
	return count;
}
