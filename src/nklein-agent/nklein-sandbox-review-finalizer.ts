import type { RuntimeTaskSessionSummary } from "../core/api-contract";
import { toErrorMessage } from "../core/error-message";
import { isHomeAgentSessionId } from "../core/home-agent-session";
import { isBusySessionState, isTerminalFailureSessionState } from "../core/session-state-predicates";
import { isEnteringAwaitingReview } from "../core/task-session-guards";
import { recordTaskRunSummary } from "../state/task-run-summary-store";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import { isTaskPatchCaptureError, type TaskPatchCaptureError } from "../workspace/task-patch-capture-diagnostics";
import { applyTaskPatchToResultBranch, resolveTaskResultBranchCommit } from "../workspace/task-result-branches";
import type { AgentSandboxManager } from "./nklein-agent-sandbox";
import {
	createMessage,
	type NKleinTaskMessage,
	type NKleinTaskSessionEntry,
	now,
	updateSummary,
} from "./nklein-session-state";
import type { TaskSandboxStateStore } from "./nklein-task-sandbox-state";
import { isBenignSandboxPatchStagingTeardown, resolveNKleinTaskRole } from "./nklein-task-session-helpers";

/**
 * §5.U — the sandbox-review FINALIZATION concern extracted from `InMemoryNKleinTaskSessionService` as a bounded
 * collaborator. When a sandboxed task enters awaiting-review it captures the workspace patch onto the task result branch
 * (or records an empty/failed capture), records the terminal run summary + patch-capture status, and handles the
 * interrupted-salvage / prior-work rebounds so captured work is never stranded unjudged. The sandbox state store + the
 * sandbox manager + the emit pipeline are injected; the finalize logic is moved VERBATIM.
 */
export interface SandboxReviewFinalizerDeps {
	getSandboxState(): TaskSandboxStateStore;
	getAgentSandboxManager(): AgentSandboxManager | null;
	getTaskEntry(taskId: string): NKleinTaskSessionEntry | null | undefined;
	emitSummary(summary: RuntimeTaskSessionSummary): void;
	emitMessage(taskId: string, message: NKleinTaskMessage): void;
	isExplicitDecomposition(taskId: string): boolean;
	getDiagnosticStoreRoot(): string | undefined;
	releaseSandboxMcpResources(taskId: string): Promise<void>;
}

export interface SandboxReviewFinalizer {
	shouldFinalizeSandboxReview(
		previousSummary: RuntimeTaskSessionSummary,
		nextSummary: RuntimeTaskSessionSummary | null,
	): nextSummary is RuntimeTaskSessionSummary;
	finalizeSandboxReview(taskId: string): void;
}

export function createSandboxReviewFinalizer(deps: SandboxReviewFinalizerDeps): SandboxReviewFinalizer {
	function recordPatchCaptureStatus(taskId: string, status: "captured" | "empty" | "error"): void {
		const entry = deps.getTaskEntry(taskId);
		const summary = entry?.summary ?? null;
		if (!summary) {
			return;
		}
		// RESURRECTION (run18 live finding — the last stall class): an INTERRUPTED card whose dying-terminal
		// salvage (W0.2) just CAPTURED real work has no path back into the flow — isReviewableNKleinSummary
		// excludes `interrupted`, so the captured work sat unjudged and the run stalled. Rebind it into the
		// reviewable flow: the review + fail-closed gate machinery decides its fate exactly like any handoff.
		if (status === "captured" && summary.state === "interrupted" && entry) {
			deps.emitSummary(
				updateSummary(entry, {
					state: "awaiting_review",
					reviewReason: "exit",
					lastOutputAt: now(),
					lastHookAt: now(),
					latestHookActivity: {
						activityText:
							"Interrupted session's captured work rebound into review (salvage → judge, never lost).",
						toolName: null,
						toolInputSummary: null,
						finalMessage: null,
						hookEventName: "interrupted_salvage_rebound",
						notificationType: null,
						source: "nklein",
					},
				}),
			);
		} else if ((status === "empty" || status === "error") && summary.state === "interrupted" && entry) {
			// run21 stall class: an abandoned/interrupted session whose FINAL round captured nothing — but a
			// PRIOR round already delivered a result branch (e.g. delivered → bounced → the re-drive died) —
			// stranded the card in In Progress forever: the rebound above only looks at THIS capture, and the
			// terminal sweep only rescues OTHER waiting cards. If reviewable work exists from any earlier round,
			// rebind to review exactly like the salvage case — the review loop (bounce/escalate/park) owns it.
			const repoPath = deps.getSandboxState().getRepoPath(taskId) ?? summary.workspacePath ?? null;
			if (repoPath) {
				void resolveTaskResultBranchCommit({ repoPath, taskId })
					.catch(() => null)
					.then((priorResultCommit) => {
						const current = deps.getTaskEntry(taskId);
						if (!priorResultCommit || !current || current.summary.state !== "interrupted") {
							return;
						}
						deps.emitSummary(
							updateSummary(current, {
								state: "awaiting_review",
								reviewReason: "exit",
								lastOutputAt: now(),
								lastHookAt: now(),
								latestHookActivity: {
									activityText:
										"Interrupted session left no new changes, but a prior round's result branch exists — rebound into review so the existing work gets judged instead of stranding the card.",
									toolName: null,
									toolInputSummary: null,
									finalMessage: null,
									hookEventName: "interrupted_prior_work_rebound",
									notificationType: null,
									source: "nklein",
								},
							}),
						);
					});
			}
		}
		// The store records TERMINAL states only; capture always completes around the awaiting_review/failed/
		// interrupted transition, so a non-terminal snapshot (a benign race) maps to awaiting_review.
		const terminalState = isTerminalFailureSessionState(summary.state) ? summary.state : ("awaiting_review" as const);
		void recordTaskRunSummary(
			{
				taskId,
				workspacePath: summary.workspacePath ?? null,
				state: terminalState,
				reviewReason: summary.reviewReason ?? null,
				providerId: summary.providerId ?? null,
				modelId: summary.modelId ?? null,
				endpoint: summary.endpoint ?? null,
				lastActivity: `patch capture: ${status}`,
				warningMessage: null,
				exitCode: summary.exitCode ?? null,
				startedAt: summary.startedAt ?? null,
				endedAt: summary.updatedAt,
				promptTokens: null,
				completionTokens: null,
				totalTokens: null,
				timeoutReason: null,
				timeoutSource: null,
				role: resolveNKleinTaskRole(taskId, deps.isExplicitDecomposition(taskId)),
				scenario: null,
				focusChain: null,
				patchCaptureStatus: status,
			},
			{ rootDir: deps.getDiagnosticStoreRoot() },
		);
	}

	function shouldFinalizeSandboxReview(
		previousSummary: RuntimeTaskSessionSummary,
		nextSummary: RuntimeTaskSessionSummary | null,
	): nextSummary is RuntimeTaskSessionSummary {
		if (!isEnteringAwaitingReview(previousSummary, nextSummary)) {
			return false;
		}
		if (isHomeAgentSessionId(nextSummary.taskId) || deps.getSandboxState().isFinalizing(nextSummary.taskId)) {
			return false;
		}
		return Boolean(deps.getAgentSandboxManager() && deps.getSandboxState().hasSandbox(nextSummary.taskId));
	}

	function finalizeSandboxReview(taskId: string): void {
		const manager = deps.getAgentSandboxManager();
		const repoPath = deps.getSandboxState().getRepoPath(taskId);
		const baseRef = deps.getSandboxState().getBaseRef(taskId);
		const entry = deps.getTaskEntry(taskId);
		if (!manager || !repoPath || !baseRef || !entry || deps.getSandboxState().isFinalizing(taskId)) {
			return;
		}
		deps.getSandboxState().markFinalizing(taskId);
		void (async () => {
			try {
				const patch = await manager.captureWorkspacePatch(taskId, { baseRef });
				const branch = await applyTaskPatchToResultBranch({
					repoPath,
					taskId,
					baseRef,
					patch,
				});
				if (branch) {
					deps.getSandboxState().setResultBranch(taskId, branch);
					recordSelfObservation({
						signal: "custom",
						severity: "info",
						message: `Sandbox task result branch updated: ${branch.branchName}`,
						taskId,
						workspacePath: repoPath,
						metadata: {
							category: "agent_sandbox_result_patch",
							branchName: branch.branchName,
							headCommit: branch.headCommit,
							baseCommit: branch.baseCommit,
						},
					});
					const message = createMessage(
						taskId,
						"system",
						`Captured sandbox changes to task result branch ${branch.branchName} (${branch.headCommit.slice(
							0,
							12,
						)}).`,
					);
					entry.messages.push(message);
					deps.emitMessage(taskId, message);
					deps.emitSummary(
						updateSummary(entry, {
							workspacePath: repoPath,
							lastOutputAt: now(),
							lastHookAt: now(),
							latestHookActivity: {
								activityText: `Result patch captured: ${branch.branchName}`,
								toolName: null,
								toolInputSummary: null,
								finalMessage: branch.headCommit,
								hookEventName: "sandbox_patch_captured",
								notificationType: null,
								source: "nklein",
							},
						}),
					);
					recordPatchCaptureStatus(taskId, "captured");
				} else {
					deps.emitSummary(
						updateSummary(entry, {
							workspacePath: repoPath,
							lastOutputAt: now(),
							lastHookAt: now(),
							latestHookActivity: {
								activityText: "Sandbox finished with no file changes",
								toolName: null,
								toolInputSummary: null,
								finalMessage: null,
								hookEventName: "sandbox_patch_empty",
								notificationType: null,
								source: "nklein",
							},
						}),
					);
					recordPatchCaptureStatus(taskId, "empty");
				}
				// #31 (run32 live): a fast bounce can RE-DRIVE the worker (restore + running) while this
				// fire-and-forget finalize is still capturing. Disposing then rips the workspace out from under
				// the live turn (ENOENT '/workspaces', capture-unavailable, dead round-2 reviews). Dispose only
				// while the card is still parked; a session back in flight owns its workspace, and the NEXT
				// handoff re-finalizes (and disposes) as usual.
				const stateAfterCapture = deps.getTaskEntry(taskId)?.summary.state;
				if (!isBusySessionState(stateAfterCapture)) {
					await deps.releaseSandboxMcpResources(taskId).catch(() => undefined);
					await manager.disposeWorkspace(taskId);
				}
				// Keep the sandbox STATE (repoPath/baseRef): the card is only AWAITING REVIEW — a bounce or
				// escalation re-drive needs it to RESTORE the disposed workspace (run20 #17 / harness v3: with the
				// state forgotten here, the restore helper no-op'd, the re-driven worker's tools had no placement,
				// and the session could never finalize a second round). True terminal cleanup forgets it.
				deps.getSandboxState().unmarkFinalizing(taskId);
			} catch (error) {
				deps.getSandboxState().unmarkFinalizing(taskId);
				const errorMessage = toErrorMessage(error);
				// Benign teardown race: the sandbox workspace was disposed concurrently before the patch could
				// be captured. Genuine capture failures while the workspace still exists fall through below.
				const hasWorkspace = manager.hasWorkspace(taskId);
				const benignReason = !hasWorkspace
					? "workspace_disposed_before_capture"
					: isBenignSandboxPatchStagingTeardown(error)
						? "workspace_missing_before_capture"
						: null;
				if (benignReason) {
					recordSelfObservation({
						signal: "custom",
						severity: "info",
						message: `Sandbox workspace for task ${taskId} was unavailable before a result patch could be captured; nothing to capture.`,
						taskId,
						workspacePath: repoPath,
						metadata: {
							category: "agent_sandbox_result_patch",
							reason: benignReason,
						},
					});
					if (hasWorkspace && deps.getTaskEntry(taskId)?.summary.state !== "running") {
						await deps.releaseSandboxMcpResources(taskId).catch(() => undefined);
						await manager.disposeWorkspace(taskId).catch(() => null);
					}
					// Same as the capture path above: keep the sandbox state for a possible re-drive round.
					deps.getSandboxState().unmarkFinalizing(taskId);
					return;
				}
				recordPatchCaptureStatus(taskId, "error");
				const captureError: TaskPatchCaptureError | null = isTaskPatchCaptureError(error) ? error : null;
				// follow-up-6 §3.5: distinguish a corrupt/garbled captured diff (an infrastructure capture
				// problem) from an agent failure, and keep the failing file/hunk + preserved artifact on the card.
				const classification = captureError?.classification ?? null;
				const cardNote = captureError
					? `Could not capture sandbox task result patch (${captureError.classification})${
							captureError.firstFailingFile ? ` in ${captureError.firstFailingFile}` : ""
						}${
							captureError.firstFailingHunkHeader ? ` ${captureError.firstFailingHunkHeader}` : ""
						}: ${captureError.gitError.trim()}${
							captureError.preservedPatchPath
								? ` Preserved failing patch: ${captureError.preservedPatchPath}`
								: ""
						}`
					: `Could not capture sandbox task result patch: ${errorMessage}`;
				recordSelfObservation({
					signal: "runtime_error",
					severity: "error",
					message: cardNote,
					taskId,
					workspacePath: repoPath,
					metadata: {
						category: "agent_sandbox_result_patch",
						...(classification ? { patchCaptureClassification: classification } : {}),
						...(captureError?.firstFailingFile ? { firstFailingFile: captureError.firstFailingFile } : {}),
						...(captureError?.firstFailingHunkHeader
							? { firstFailingHunkHeader: captureError.firstFailingHunkHeader }
							: {}),
						...(captureError?.failingLine !== null && captureError?.failingLine !== undefined
							? { failingLine: captureError.failingLine }
							: {}),
						...(captureError?.preservedPatchPath ? { preservedPatchPath: captureError.preservedPatchPath } : {}),
					},
				});
				const latestEntry = deps.getTaskEntry(taskId);
				if (!latestEntry) {
					return;
				}
				deps.emitSummary(
					updateSummary(latestEntry, {
						warningMessage: cardNote,
						lastHookAt: now(),
						latestHookActivity: {
							activityText: `Result patch capture failed${classification ? ` (${classification})` : ""}: ${errorMessage}`,
							toolName: null,
							toolInputSummary: null,
							finalMessage: errorMessage,
							hookEventName: "sandbox_patch_capture_failed",
							notificationType: null,
							source: "nklein",
						},
					}),
				);
			}
		})();
	}

	return { shouldFinalizeSandboxReview, finalizeSandboxReview };
}
