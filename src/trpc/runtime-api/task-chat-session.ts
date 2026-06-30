import type {
	RuntimeSlashCommandsResponse,
	RuntimeTaskChatMessagesRequest,
	RuntimeTaskChatMessagesResponse,
	RuntimeTaskChatReloadRequest,
	RuntimeTaskChatReloadResponse,
} from "../../core/api-contract";
import { parseTaskChatMessagesRequest, parseTaskChatReloadRequest } from "../../core/api-validation";
import { isHomeAgentSessionId } from "../../core/home-agent-session";
import type { createNKleinProviderService } from "../../nklein-agent/nklein-provider-service";
import type { NKleinTaskSessionService } from "../../nklein-agent/nklein-task-session-service";
import type { RuntimeTrpcWorkspaceScope } from "../app-router";

interface TaskChatSessionDeps {
	getScopedNKleinTaskSessionService: (scope: RuntimeTrpcWorkspaceScope) => Promise<NKleinTaskSessionService>;
	nkleinProviderService: ReturnType<typeof createNKleinProviderService>;
}

/**
 * Load a task's persisted chat messages + summary (the runtime-api `getTaskChatMessages` procedure
 * handler, extracted from the factory). Returns ok:false when neither a live summary nor any persisted
 * messages exist.
 */
export async function handleGetTaskChatMessages(
	workspaceScope: RuntimeTrpcWorkspaceScope,
	input: RuntimeTaskChatMessagesRequest,
	deps: TaskChatSessionDeps,
): Promise<RuntimeTaskChatMessagesResponse> {
	try {
		const body = parseTaskChatMessagesRequest(input);
		const nkleinTaskSessionService = await deps.getScopedNKleinTaskSessionService(workspaceScope);
		const summary = nkleinTaskSessionService.getSummary(body.taskId);
		const messages = await nkleinTaskSessionService.loadTaskSessionMessages(body.taskId);
		if (!summary && messages.length === 0) {
			return { ok: false, messages: [], error: "Task chat session is not available." };
		}
		return { ok: true, messages };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, messages: [], error: message };
	}
}

/** List the workspace's available slash commands (the runtime-api `getNKleinSlashCommands` procedure handler). */
export async function handleGetNKleinSlashCommands(
	workspaceScope: RuntimeTrpcWorkspaceScope | null,
	deps: TaskChatSessionDeps,
): Promise<RuntimeSlashCommandsResponse> {
	if (!workspaceScope) {
		return { commands: [] };
	}
	const nkleinTaskSessionService = await deps.getScopedNKleinTaskSessionService(workspaceScope);
	return { commands: await nkleinTaskSessionService.listSlashCommands(workspaceScope.workspacePath) };
}

/**
 * Reload a task's chat session (the runtime-api `reloadTaskChatSession` procedure handler). For a home-agent
 * session that has no live session, transparently restarts it from persistence using the resolved launch
 * config so the home sidebar reconnects. Returns ok:false when the session can't be made available.
 */
export async function handleReloadTaskChatSession(
	workspaceScope: RuntimeTrpcWorkspaceScope,
	input: RuntimeTaskChatReloadRequest,
	deps: TaskChatSessionDeps,
): Promise<RuntimeTaskChatReloadResponse> {
	try {
		const body = parseTaskChatReloadRequest(input);
		const nkleinTaskSessionService = await deps.getScopedNKleinTaskSessionService(workspaceScope);
		let summary = await nkleinTaskSessionService.reloadTaskSession(body.taskId);
		if (!summary && isHomeAgentSessionId(body.taskId)) {
			const nkleinLaunchConfig = await deps.nkleinProviderService.resolveLaunchConfig();
			summary = await nkleinTaskSessionService.startTaskSession({
				taskId: body.taskId,
				cwd: workspaceScope.workspacePath,
				workspaceRoot: workspaceScope.workspacePath,
				prompt: "",
				resumeFromPersistence: true,
				providerId: nkleinLaunchConfig.providerId,
				modelId: nkleinLaunchConfig.modelId,
				apiKey: nkleinLaunchConfig.apiKey,
				baseUrl: nkleinLaunchConfig.baseUrl,
				reasoningEffort: nkleinLaunchConfig.reasoningEffort,
				contextWindow: nkleinLaunchConfig.contextWindow ?? null,
			});
		}
		if (!summary) {
			return { ok: false, summary: null, error: "Task chat session is not available." };
		}
		return { ok: true, summary };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, summary: null, error: message };
	}
}
