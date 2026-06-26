import type { RuntimeTaskChatSendRequest, RuntimeTaskChatSendResponse } from "../../core/api-contract";
import { parseTaskChatSendRequest } from "../../core/api-validation";
import { isHomeAgentSessionId } from "../../core/home-agent-session";
import { reconcileStartedTaskBoardLane } from "../../core/task-board-lane-reconcile";
import type { createNKleinProviderService } from "../../nklein-sdk/nklein-provider-service";
import { isNKleinClearSlashCommand } from "../../nklein-sdk/nklein-slash-commands";
import type { NKleinTaskSessionService } from "../../nklein-sdk/nklein-task-session-service";
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
		if (isNKleinClearSlashCommand(body.text)) {
			const summary = await nkleinTaskSessionService.clearTaskSession(body.taskId);
			deps.broadcastTaskChatCleared?.(workspaceScope.workspaceId, body.taskId);
			return {
				ok: true,
				summary,
				message: null,
			};
		}
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
