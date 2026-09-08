/**
 * A task whose sandbox workspace has been DISPOSED cannot do any work — and today nothing notices.
 *
 * ── WHY ──
 * Live 2026-09-08, reported by the agent in the rig's model seat and confirmed against the queue: THIRTY of the
 * drive's requests carried `No Docker sandbox workspace is prepared for task <id>`, concentrated on the decompose
 * cards of projects 39 and 40 — the two projects that produced no usable recording. `AgentSandboxUnavailableError`
 * is thrown by `requirePlacement` and is caught NOWHERE outside the sandbox module, so it reaches the model as an
 * ordinary tool-result error. The model then does the reasonable thing: it tries a different tool, which fails the
 * same way, and again, and again. Every one of those turns is a real request against a strictly-serial endpoint,
 * on a session that cannot succeed at anything.
 *
 * The distinction that matters is DISPOSED versus NEVER-PLACED. A task that never had a placement may simply be
 * early — the acquisition is queued, and the next attempt can succeed. A task whose placement was disposed is
 * finished with its sandbox forever: the workdir was removed and the slot handed to someone else. The first is
 * worth retrying, the second is worth stopping, and telling them apart is the whole job of this core.
 *
 * Pure so the rule is testable without a Docker pool.
 */

export type SandboxAbsence = "never_placed" | "disposed";

export interface SandboxFailureInputs {
	/** The task ever HELD a placement in this process (it was disposed, not merely not-yet-acquired). */
	readonly everPlaced: boolean;
	/** Consecutive sandbox-unavailable tool failures for this task since its last success. */
	readonly consecutiveFailures: number;
	/** How many consecutive failures are tolerated before the session is stopped. */
	readonly limit?: number;
}

export interface SandboxFailureDecision {
	readonly absence: SandboxAbsence;
	readonly action: "retry" | "stop_session";
	readonly reason: string;
}

/**
 * One failure is not a verdict even for a disposed task — a dispose can race a tool call that was already in
 * flight, and stopping on that would turn a benign race into a killed session. Two consecutive failures cannot be
 * that race: the second was issued after the first had already reported the workspace gone.
 */
export const DEFAULT_SANDBOX_FAILURE_LIMIT = 2;

export function classifySandboxFailure(input: SandboxFailureInputs): SandboxFailureDecision {
	const limit = input.limit ?? DEFAULT_SANDBOX_FAILURE_LIMIT;
	const absence: SandboxAbsence = input.everPlaced ? "disposed" : "never_placed";
	if (absence === "never_placed") {
		// The acquisition may still be queued behind the pool; the next call can legitimately succeed.
		return {
			absence,
			action: "retry",
			reason:
				"the task has never held a sandbox placement — the acquisition may still be queued, so this is not proof the session is dead",
		};
	}
	if (input.consecutiveFailures < limit) {
		return {
			absence,
			action: "retry",
			reason: `the workspace was disposed but only ${input.consecutiveFailures} call has failed — a dispose can race a tool call already in flight`,
		};
	}
	return {
		absence,
		action: "stop_session",
		reason: `the sandbox workspace was disposed and ${input.consecutiveFailures} consecutive tool calls have failed because of it — this session cannot do any work, and every further turn spends a real model request proving it again`,
	};
}
