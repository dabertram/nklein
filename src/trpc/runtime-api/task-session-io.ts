import type {
	RuntimeTaskSessionInputRequest,
	RuntimeTaskSessionInputResponse,
	RuntimeTaskSessionStopRequest,
	RuntimeTaskSessionStopResponse,
} from "../../core/api-contract";
import { parseTaskSessionInputRequest, parseTaskSessionStopRequest } from "../../core/api-validation";
import { setCardPaused } from "../../core/card-pause";
import { INTERVENTION_CATEGORY } from "../../core/intervention-observation";
import { reconcileStartedTaskBoardLane } from "../../core/task-board-lane-reconcile";
import type { NKleinTaskSessionService } from "../../nklein-agent/nklein-task-session-service";
import { recordSelfObservation } from "../../telemetry/self-observation-sink";
import type { RuntimeTrpcWorkspaceScope } from "../app-router";
import { withTaskPausedState } from "../runtime-task-paused-state";
import { getWorkspaceWorkflowQueue } from "./workflow-queue-registry";

interface TaskSessionIoDeps {
	getScopedNKleinTaskSessionService: (scope: RuntimeTrpcWorkspaceScope) => Promise<NKleinTaskSessionService>;
}

/**
 * Stop a task's session and clear its paused flag (the runtime-api `stopTaskSession` procedure handler,
 * extracted from the factory). Returns the paused-state-projected summary; ok reflects whether a session
 * was actually stopped. The session-service resolver is the only factory dependency.
 */
export async function handleStopTaskSession(
	workspaceScope: RuntimeTrpcWorkspaceScope,
	input: RuntimeTaskSessionStopRequest,
	deps: TaskSessionIoDeps,
): Promise<RuntimeTaskSessionStopResponse> {
	try {
		const body = parseTaskSessionStopRequest(input);
		// N18: the caller sets this only for the explicit operator gesture that moves an already-started card to
		// Trash. Record the abandonment even when the worker has already stopped (review is the common case): the
		// intervention is the card being discarded, not the existence of a live process at cleanup time. It is also
		// recorded BEFORE cleanup so a failed stop cannot erase the already-completed user gesture from the timeline.
		if (body.interventionSeverity === "abort") {
			try {
				recordSelfObservation({
					signal: "custom",
					severity: "warning",
					message: `Operator abandoned task ${body.taskId} to Trash.`,
					taskId: body.taskId,
					metadata: { category: INTERVENTION_CATEGORY, interventionSeverity: "abort" },
				});
			} catch {
				// Telemetry must never prevent cleanup after the board move already succeeded.
			}
		}
		const nkleinTaskSessionService = await deps.getScopedNKleinTaskSessionService(workspaceScope);
		const nkleinSummary = await nkleinTaskSessionService.stopTaskSession(body.taskId);
		// F1.27b (leaf 1): the operator stop emits a `cancel_requested` through the workflow command queue —
		// fire-and-forget audit + phase mirror (a stop IS a cancel in the kernel's vocabulary; a task the kernel
		// never saw start cancels from idle, which is kernel-truth for an operator stop). Zero behavior change:
		// the stop effect above already ran through the proven service path.
		if (nkleinSummary) {
			void getWorkspaceWorkflowQueue(workspaceScope.workspacePath, workspaceScope.workspaceId)
				.dispatch(body.taskId, { kind: "cancel_requested" })
				.catch(() => {});
		}
		const pausedTaskIds = await setCardPaused({
			workspacePath: workspaceScope.workspacePath,
			taskId: body.taskId,
			paused: false,
		});
		// Terminal/CLI agents are disabled under the local-only lockdown (§5.A); only NKlein sessions exist.
		return {
			ok: Boolean(nkleinSummary),
			summary: withTaskPausedState(nkleinSummary, pausedTaskIds),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, summary: null, error: message };
	}
}

/**
 * Send input to a running task session (the runtime-api `sendTaskSessionInput` procedure handler).
 * Appends a newline when requested, then reconciles the board lane so a resumed/continued task shows as
 * running. Returns ok:false when no session is running.
 */
export async function handleSendTaskSessionInput(
	workspaceScope: RuntimeTrpcWorkspaceScope,
	input: RuntimeTaskSessionInputRequest,
	deps: TaskSessionIoDeps,
): Promise<RuntimeTaskSessionInputResponse> {
	try {
		const body = parseTaskSessionInputRequest(input);
		const payloadText = body.appendNewline ? `${body.text}\n` : body.text;
		const nkleinTaskSessionService = await deps.getScopedNKleinTaskSessionService(workspaceScope);
		// F12.56: only widen the call when steering is requested — the default path stays byte-identical.
		const nkleinSummary = body.delivery
			? await nkleinTaskSessionService.sendTaskSessionInput(
					body.taskId,
					payloadText,
					undefined,
					undefined,
					undefined,
					{
						delivery: body.delivery,
					},
				)
			: await nkleinTaskSessionService.sendTaskSessionInput(body.taskId, payloadText);
		// Terminal/CLI agents are disabled under the local-only lockdown (§5.A); only NKlein sessions exist.
		if (!nkleinSummary) {
			return { ok: false, summary: null, error: "Task session is not running." };
		}
		if (body.interventionSeverity === "correction") {
			try {
				recordSelfObservation({
					signal: "custom",
					severity: "info",
					message: `Operator submitted corrective review feedback for ${body.taskId}.`,
					taskId: body.taskId,
					metadata: {
						category: INTERVENTION_CATEGORY,
						interventionSeverity: "correction",
						// P16.5b: composer-measured typing span; absent stays absent (measured-or-null, never estimated).
						...(typeof body.interventionHumanSeconds === "number"
							? { humanSeconds: body.interventionHumanSeconds }
							: {}),
					},
				});
			} catch {
				// Telemetry must never break feedback delivery.
			}
		}
		// N2 observability (2026-07-27): EVERY accepted operator input to a live session is recorded — a steer of
		// a running worker or the answer that resumes a parked ask_question card was previously invisible unless
		// marked a correction, so the nightly could not assert the park/resume or steering mechanisms at all.
		try {
			recordSelfObservation({
				signal: "custom",
				severity: "info",
				message: `Operator input delivered to task session ${body.taskId} (${payloadText.length} chars).`,
				taskId: body.taskId,
				metadata: { category: "task_session_operator_input", textLength: payloadText.length },
			});
		} catch {
			// Telemetry must never break input delivery.
		}
		await reconcileStartedTaskBoardLane({ workspacePath: workspaceScope.workspacePath, summary: nkleinSummary });
		return { ok: true, summary: nkleinSummary };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, summary: null, error: message };
	}
}
