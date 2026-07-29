import type { RuntimeTaskChatSendRequest, RuntimeTaskChatSendResponse } from "../../core/api-contract";
import { parseTaskChatSendRequest } from "../../core/api-validation";
import { isHomeAgentSessionId } from "../../core/home-agent-session";
import { INTERVENTION_CATEGORY } from "../../core/intervention-observation";
import { reconcileStartedTaskBoardLane } from "../../core/task-board-lane-reconcile";
import type { createNKleinProviderService } from "../../nklein-agent/nklein-provider-service";
import { isNKleinClearSlashCommand } from "../../nklein-agent/nklein-slash-commands";
import type { NKleinTaskSessionService } from "../../nklein-agent/nklein-task-session-service";
import { loadWorkspaceState } from "../../state/workspace-state";
import { recordSelfObservation } from "../../telemetry/self-observation-sink";
import type { RuntimeTrpcWorkspaceScope } from "../app-router";

/**
 * Handler for the send-task-chat-message procedure, extracted from the oversized `runtime-api.ts`
 * (§5.X / architecture recommendation #3). It routes a chat turn into a task session: the `/clear` slash command
 * clears the session, otherwise it sends the input (with optional provider/model/reasoning overrides), rebinding +
 * resuming a persisted/home-agent session if none is running, and reconciles the card's board lane. Takes a
 * `{ getScopedNKleinTaskSessionService, nkleinProviderService, broadcastTaskChatCleared? }` deps slice. Behavior and
 * wire contract are unchanged (the trivial `reconcileRunningTaskBoardLane` adapter is inlined to its core call).
 */
export interface TaskChatSendDeps {
	getScopedNKleinTaskSessionService: (scope: RuntimeTrpcWorkspaceScope) => Promise<NKleinTaskSessionService>;
	nkleinProviderService: ReturnType<typeof createNKleinProviderService>;
	broadcastTaskChatCleared?: (workspaceId: string, taskId: string) => void;
}

export async function handleSendTaskChatMessage(
	workspaceScope: RuntimeTrpcWorkspaceScope,
	input: RuntimeTaskChatSendRequest,
	deps: TaskChatSendDeps,
): Promise<RuntimeTaskChatSendResponse> {
	try {
		const body = parseTaskChatSendRequest(input);
		const nkleinTaskSessionService = await deps.getScopedNKleinTaskSessionService(workspaceScope);
		// /clear is a pure teardown (forget the provider selection + abort the session + dispose the sandbox) that
		// needs NO launch config. Resolve it BEFORE the resolveLaunchConfig call below — that call throws when the
		// selected model can't be resolved (e.g. an LM Studio model was unloaded), which is exactly the recovery
		// state where a user reaches for /clear. Gating teardown behind model resolution made /clear fail when it is
		// needed most; the clear branch reads none of the launch-config overrides.
		// G6.8a v14 ghost (2026-07-29): guidance sent to a card whose work is DONE must not silently start a fresh
		// worker session — a post-completion send left an `awaiting_review` ghost on a completed-lane card that
		// occupied a concurrency slot forever (the gate now also excludes such ghosts, but the session itself is
		// still wasted compute + repeated work). Reopening a finished card is an explicit restart affordance, not a
		// chat side effect. A send racing the completion in the same instant can still slip through (the lane moves
		// after the session accepts) — that residue is bounded by the gate's ghost exclusion.
		if (!isHomeAgentSessionId(body.taskId) && !isNKleinClearSlashCommand(body.text)) {
			const terminalLane = await loadWorkspaceState(workspaceScope.workspacePath)
				.then(
					(state) =>
						state.board.columns.find(
							(column) =>
								(column.id === "completed" || column.id === "trash") &&
								column.cards.some((card) => card.id === body.taskId),
						)?.id ?? null,
				)
				.catch(() => null);
			if (terminalLane) {
				return {
					ok: false,
					summary: null,
					error: `Task is already ${terminalLane === "trash" ? "in the trash" : "completed"} — chat guidance cannot restart it. Reopen or restart the card explicitly to continue work on it.`,
				};
			}
		}
		if (isNKleinClearSlashCommand(body.text)) {
			const summary = await nkleinTaskSessionService.clearTaskSession(body.taskId);
			deps.broadcastTaskChatCleared?.(workspaceScope.workspaceId, body.taskId);
			return {
				ok: true,
				summary,
				message: null,
			};
		}
		const providerIdOverride = body.providerId?.trim() || undefined;
		const modelIdOverride = body.modelId?.trim() || undefined;
		const hasReasoningEffortOverride = Object.hasOwn(body, "reasoningEffort");
		const launchConfigOverrides =
			providerIdOverride || modelIdOverride || hasReasoningEffortOverride
				? await deps.nkleinProviderService.resolveLaunchConfig({
						providerIdOverride,
						modelIdOverride,
						...(hasReasoningEffortOverride ? { reasoningEffortOverride: body.reasoningEffort ?? null } : {}),
					})
				: null;
		const sessionLaunchConfigOverrides = launchConfigOverrides?.modelId
			? {
					providerId: launchConfigOverrides.providerId,
					modelId: launchConfigOverrides.modelId,
					apiKey: launchConfigOverrides.apiKey,
					baseUrl: launchConfigOverrides.baseUrl,
					reasoningEffort: launchConfigOverrides.reasoningEffort,
					contextWindow: launchConfigOverrides.contextWindow,
				}
			: undefined;
		const requestedMode = body.mode;
		let summary = sessionLaunchConfigOverrides
			? await nkleinTaskSessionService.sendTaskSessionInput(
					body.taskId,
					body.text,
					requestedMode,
					body.images,
					sessionLaunchConfigOverrides,
				)
			: await nkleinTaskSessionService.sendTaskSessionInput(body.taskId, body.text, requestedMode, body.images);
		// P20.10: a NUDGE — a human typed into a session that was ALREADY RUNNING.
		//
		// A truthy summary here is exactly that condition: `sendTaskSessionInput` returns null when no live session
		// accepted the input, and every path below STARTS or rebinds one. Starting a session is not an intervention;
		// steering a running one is. Recording it at this branch is what keeps the two apart — doing it any earlier
		// would count every task kickoff as an operator correction and inflate the metric with normal use.
		//
		// Best-effort: telemetry must never fail a user's message.
		if (summary) {
			try {
				recordSelfObservation({
					signal: "custom",
					severity: "info",
					message: `Operator sent guidance to running task ${body.taskId}.`,
					taskId: body.taskId,
					metadata: {
						category: INTERVENTION_CATEGORY,
						interventionSeverity: "nudge",
						// P16.5b: composer-measured typing span; absent stays absent (measured-or-null, never estimated).
						...(typeof body.interventionHumanSeconds === "number"
							? { humanSeconds: body.interventionHumanSeconds }
							: {}),
					},
				});
			} catch {
				// Swallowed deliberately — see above.
			}
		}
		if (!summary) {
			if (!isHomeAgentSessionId(body.taskId)) {
				const reboundSummary = await nkleinTaskSessionService.rebindPersistedTaskSession(body.taskId);
				if (reboundSummary) {
					const nkleinLaunchConfig =
						launchConfigOverrides ?? (await deps.nkleinProviderService.resolveLaunchConfig());
					summary = await nkleinTaskSessionService.startTaskSession({
						taskId: body.taskId,
						cwd: reboundSummary.workspacePath ?? workspaceScope.workspacePath,
						workspaceRoot: workspaceScope.workspacePath,
						prompt: body.text,
						images: body.images,
						resumeFromPersistence: true,
						providerId: nkleinLaunchConfig.providerId,
						modelId: nkleinLaunchConfig.modelId,
						mode: requestedMode,
						apiKey: nkleinLaunchConfig.apiKey,
						baseUrl: nkleinLaunchConfig.baseUrl,
						reasoningEffort: nkleinLaunchConfig.reasoningEffort,
						contextWindow: nkleinLaunchConfig.contextWindow ?? null,
					});
				}
				if (!summary) {
					return {
						ok: false,
						summary: null,
						error: "Task chat session is not running.",
					};
				}
			} else {
				const nkleinLaunchConfig =
					launchConfigOverrides ?? (await deps.nkleinProviderService.resolveLaunchConfig());
				summary = await nkleinTaskSessionService.startTaskSession({
					taskId: body.taskId,
					cwd: workspaceScope.workspacePath,
					workspaceRoot: workspaceScope.workspacePath,
					prompt: body.text,
					images: body.images,
					resumeFromPersistence: true,
					providerId: nkleinLaunchConfig.providerId,
					modelId: nkleinLaunchConfig.modelId,
					mode: requestedMode,
					apiKey: nkleinLaunchConfig.apiKey,
					baseUrl: nkleinLaunchConfig.baseUrl,
					reasoningEffort: nkleinLaunchConfig.reasoningEffort,
					contextWindow: nkleinLaunchConfig.contextWindow ?? null,
				});
			}
		}
		const latestMessage = nkleinTaskSessionService.listMessages(body.taskId).at(-1) ?? null;
		await reconcileStartedTaskBoardLane({ workspacePath: workspaceScope.workspacePath, summary });
		return {
			ok: true,
			summary,
			message: latestMessage,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			summary: null,
			error: message,
		};
	}
}
