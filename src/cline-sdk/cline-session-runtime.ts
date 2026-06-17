// Owns the live SDK session host plus taskId to sessionId bindings.
// This is the runtime-facing layer for starting, looking up, resuming, and
// stopping native Cline sessions without exposing SDK details upstream.
import type {
	AgentAfterModelContext,
	AgentBeforeModelContext,
	AgentBeforeModelResult,
	AgentMessage,
} from "@clinebot/shared";
import type { RuntimeClineReasoningEffort, RuntimeTaskImage, RuntimeTaskSessionMode } from "../core/api-contract";
import { getWorkspaceChanges } from "../workspace/get-workspace-changes";
import { buildKanbanContextPressurePolicy } from "./cline-context-budgets";
import { compactKanbanFocusedMessages, focusKanbanReadFilesForNextRequest } from "./cline-context-focus-policy";
import { createClineDecompositionTools } from "./cline-decomposition-tool";
import { extractClineSessionId } from "./cline-event-adapter";
import { createFileDiscoveryTools } from "./cline-file-discovery-tools";
import {
	createReadLargeFileTool,
	getClineLargeFileWorkflow,
	releaseAllClineLargeFileWorkflows,
	releaseClineLargeFileWorkflow,
} from "./cline-large-file-workflow";
import {
	type ClineMcpRuntimeService,
	type ClineMcpToolBundle,
	createClineMcpRuntimeService,
} from "./cline-mcp-runtime-service";
import { buildKanbanModelToolRoutingRules } from "./cline-model-tool-routing";
import { buildClineRepoMap } from "./cline-repo-map";
import { createClineRetrievalTools } from "./cline-retrieval-tools";
import { createKanbanClineLogger } from "./cline-runtime-logger";
import { reviewClineAfterModelCompletion } from "./cline-self-review-hook";
import { buildSessionIdPrefix, createSessionId } from "./cline-session-state";
import { resolveClineTeamDelegationPolicy } from "./cline-team-delegation";
import { createWebResearchTool } from "./cline-web-research-tool";
import { createWriteFilesTool, createWriteFileTool } from "./cline-write-files-tool";
import { CLINE_MODEL_CATALOG_DEFAULTS } from "./sdk-provider-boundary";
import {
	type ClineSdkPersistedMessage,
	type ClineSdkSessionHost,
	type ClineSdkSessionRecord,
	type ClineSdkStartSessionInput,
	type ClineSdkTeamEvent,
	type ClineSdkToolApprovalRequest,
	type ClineSdkToolApprovalResult,
	type ClineSdkUserInstructionService,
	createClineSdkSessionHost,
} from "./sdk-runtime-boundary";

export { CLINE_MODEL_CATALOG_DEFAULTS } from "./sdk-provider-boundary";

const DEFAULT_CLINE_MAX_CONSECUTIVE_MISTAKES = 6;
const DEFAULT_CLINE_CONTEXT_WINDOW_TOKENS = 80_000;
const CLINE_CONTEXT_COMPACTION_RESERVE_TOKENS = 16_384;
const CLINE_CONTEXT_COMPACTION_PRESERVE_RECENT_TOKENS = 20_000;
const CLINE_CONTEXT_COMPACTION_RESERVE_RATIO = 0.2;
const CLINE_CONTEXT_COMPACTION_PRESERVE_RECENT_RATIO = 0.25;

type ClineSdkContextCompactionConfig = NonNullable<ClineSdkStartSessionInput["config"]["compaction"]>;
type ClineSdkLocalRuntimeOptions = NonNullable<ClineSdkStartSessionInput["localRuntime"]>;
type ClineSdkRuntimeExtension = NonNullable<ClineSdkLocalRuntimeOptions["extensions"]>[number];

function createRepoMapRailMessage(text: string): AgentMessage {
	return {
		id: `kanban-repo-map-rail-${Date.now()}`,
		role: "user",
		content: [{ type: "text", text }],
		createdAt: Date.now(),
		metadata: {
			kind: "kanban_repo_map_rail",
		},
	};
}

function assistantMessageHasToolCall(context: AgentAfterModelContext): boolean {
	return context.assistantMessage.content.some((part) => part.type === "tool-call");
}

async function appendRepoMapBeforeModel(
	context: AgentBeforeModelContext,
	workspacePath: string,
	contextWindow: number | null | undefined,
	baseResult: AgentBeforeModelResult | null | undefined,
	getCachedRepoMap: () => Promise<string | null>,
): Promise<AgentBeforeModelResult | undefined> {
	if (baseResult?.stop) {
		return baseResult;
	}
	const repoMap = await getCachedRepoMap();
	if (!repoMap) {
		return baseResult ?? undefined;
	}
	const messages = baseResult?.messages ?? context.request.messages;
	const alreadyInjected = messages.some((message) => message.metadata?.kind === "kanban_repo_map_rail");
	if (alreadyInjected) {
		return baseResult ?? undefined;
	}
	return {
		...baseResult,
		messages: [
			...messages,
			createRepoMapRailMessage(
				[
					"[Kanban repo map: compact codebase orientation]",
					`Workspace: ${workspacePath}`,
					`Context window: ${contextWindow ?? "unknown"} tokens`,
					repoMap,
					"Use this map to choose focused read_files calls; prefer symbol-level navigation over whole-file reading.",
				].join("\n"),
			),
		],
	};
}

function createKanbanContextFocusExtension(
	sessionId: string,
	workspacePath: string,
	contextWindow?: number | null,
): ClineSdkRuntimeExtension {
	const largeFileWorkflow = getClineLargeFileWorkflow(sessionId, workspacePath);
	let cachedRepoMap: Promise<string | null> | null = null;
	const contextPressure = buildKanbanContextPressurePolicy({ contextWindow });
	const getCachedRepoMap = async () => {
		cachedRepoMap ??= buildClineRepoMap({
			workspacePath,
			tokenBudget: contextPressure.repoMapTokenBudget,
		})
			.then((repoMap) => (repoMap.symbols.length > 0 ? repoMap.rendered : null))
			.catch(() => null);
		return await cachedRepoMap;
	};
	const hasChangedFiles = async (): Promise<boolean | null> => {
		try {
			const changes = await getWorkspaceChanges(workspacePath);
			return changes.files.length > 0;
		} catch {
			return null;
		}
	};
	return {
		name: "kanban-context-focus",
		manifest: {
			capabilities: ["messageBuilders", "hooks"],
		},
		hooks: {
			async beforeModel(context) {
				return await appendRepoMapBeforeModel(
					context,
					workspacePath,
					contextWindow,
					await largeFileWorkflow.beforeModel(context),
					getCachedRepoMap,
				);
			},
			async afterModel(context) {
				if (assistantMessageHasToolCall(context)) {
					cachedRepoMap = null;
				}
				const largeFileControl = await largeFileWorkflow.afterModel(context);
				return (
					largeFileControl ??
					reviewClineAfterModelCompletion(context, { hasChangedFiles: await hasChangedFiles() })
				);
			},
		},
		setup(api) {
			api.registerMessageBuilder({
				name: "kanban-read-files-focus",
				build(messages) {
					return focusKanbanReadFilesForNextRequest(messages) ?? messages;
				},
			});
		},
	};
}

type ClineSessionLaunchConfigOverrides = {
	providerId: string;
	modelId: string;
	apiKey?: string | null;
	baseUrl?: string | null;
	reasoningEffort?: RuntimeClineReasoningEffort | null;
	contextWindow?: number | null;
	maxAgentWritableFileLines?: number | null;
	apiTimeoutMs?: number | null;
	turnTimeoutMs?: number | null;
};

interface ClineSessionHostBoundary {
	start(input: ClineSdkStartSessionInput): Promise<{ sessionId: string; result?: unknown }>;
	send(input: Parameters<ClineSdkSessionHost["send"]>[0]): Promise<unknown>;
	stop(sessionId: string): Promise<void>;
	abort(sessionId: string): Promise<void>;
	delete(sessionId: string): Promise<boolean>;
	dispose(reason?: string): Promise<void>;
	get(sessionId: string): Promise<ClineSdkSessionRecord | undefined>;
	list(limit?: number): Promise<ClineSdkSessionRecord[]>;
	update?(
		sessionId: string,
		updates: {
			prompt?: string | null;
			metadata?: Record<string, unknown> | null;
			title?: string | null;
		},
	): Promise<{ updated: boolean }>;
	updateSessionModel?(sessionId: string, modelId: string): Promise<void>;
	readMessages(sessionId: string): Promise<ClineSdkPersistedMessage[]>;
	subscribe(listener: (event: unknown) => void): () => void;
}

function toSdkUserImages(images?: RuntimeTaskImage[]): string[] | undefined {
	if (!images || images.length === 0) {
		return undefined;
	}
	const userImages = images
		.map((image) => {
			const mimeType = image.mimeType.trim();
			const data = image.data.trim();
			if (!mimeType || !data) {
				return null;
			}
			return `data:${mimeType};base64,${data}`;
		})
		.filter((image): image is string => image !== null);
	return userImages.length > 0 ? userImages : undefined;
}

function resolveSdkApiTimeoutMs(timeoutMs: number | null | undefined): number | undefined {
	if (timeoutMs === undefined || timeoutMs === null || timeoutMs === 0) {
		return undefined;
	}
	if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
		return undefined;
	}
	return Math.trunc(timeoutMs);
}

function resolveContextWindowTokens(contextWindow: number | null | undefined): number | null {
	if (typeof contextWindow !== "number" || !Number.isFinite(contextWindow) || contextWindow <= 0) {
		return null;
	}
	return Math.trunc(contextWindow);
}

export function buildClineContextCompactionConfig(
	contextWindow: number | null | undefined,
): ClineSdkContextCompactionConfig | undefined {
	const contextWindowTokens = resolveContextWindowTokens(contextWindow) ?? DEFAULT_CLINE_CONTEXT_WINDOW_TOKENS;
	return {
		enabled: true,
		strategy: "basic",
		contextWindowTokens,
		reserveTokens: Math.max(
			1,
			Math.min(
				CLINE_CONTEXT_COMPACTION_RESERVE_TOKENS,
				Math.round(contextWindowTokens * CLINE_CONTEXT_COMPACTION_RESERVE_RATIO),
			),
		),
		preserveRecentTokens: Math.max(
			1,
			Math.min(
				CLINE_CONTEXT_COMPACTION_PRESERVE_RECENT_TOKENS,
				Math.round(contextWindowTokens * CLINE_CONTEXT_COMPACTION_PRESERVE_RECENT_RATIO),
			),
		),
	};
}

export interface StartClineSessionRuntimeRequest {
	taskId: string;
	cwd: string;
	prompt: string;
	/** Normalized Kanban task title; persisted to SDK session metadata when supported. */
	taskTitle?: string;
	initialMessages?: ClineSdkPersistedMessage[];
	images?: RuntimeTaskImage[];
	providerId: string;
	modelId: string;
	mode?: RuntimeTaskSessionMode;
	apiKey?: string | null;
	baseUrl?: string | null;
	reasoningEffort?: RuntimeClineReasoningEffort | null;
	contextWindow?: number | null;
	maxAgentWritableFileLines?: number | null;
	apiTimeoutMs?: number | null;
	turnTimeoutMs?: number | null;
	systemPrompt: string;
	userInstructionService?: ClineSdkUserInstructionService;
	toolPolicies?: ClineSdkStartSessionInput["toolPolicies"];
	requestToolApproval?: (request: ClineSdkToolApprovalRequest) => Promise<ClineSdkToolApprovalResult>;
	onTeamEvent?: (event: ClineSdkTeamEvent, teamName: string | null) => void;
}

export interface StartClineSessionRuntimeResult {
	sessionId: string;
	result: unknown;
	warnings?: string[];
}

export interface ClinePersistedTaskSessionSnapshot {
	record: ClineSdkSessionRecord;
	messages: ClineSdkPersistedMessage[];
}

export interface ClineSessionRuntime {
	startTaskSession(request: StartClineSessionRuntimeRequest): Promise<StartClineSessionRuntimeResult>;
	restartTaskSession(input: {
		taskId: string;
		prompt: string;
		initialMessages?: ClineSdkPersistedMessage[];
		images?: RuntimeTaskImage[];
		mode?: RuntimeTaskSessionMode;
		launchConfigOverrides?: ClineSessionLaunchConfigOverrides;
		onTeamEvent?: (event: ClineSdkTeamEvent, teamName: string | null) => void;
	}): Promise<StartClineSessionRuntimeResult>;
	sendTaskSessionInput(
		taskId: string,
		prompt: string,
		mode?: RuntimeTaskSessionMode,
		images?: RuntimeTaskImage[],
		delivery?: "queue" | "steer",
		launchConfigOverrides?: ClineSessionLaunchConfigOverrides,
	): Promise<unknown>;
	requiresTaskSessionRestart(
		taskId: string,
		mode?: RuntimeTaskSessionMode,
		launchConfigOverrides?: ClineSessionLaunchConfigOverrides,
	): boolean;
	resumeTaskSession(taskId: string): Promise<ClinePersistedTaskSessionSnapshot | null>;
	stopTaskSession(taskId: string): Promise<void>;
	abortTaskSession(taskId: string): Promise<void>;
	clearTaskSessions(taskId: string): Promise<void>;
	getTaskSessionId(taskId: string): string | null;
	getTaskProviderId(taskId: string): string | null;
	canRestartTaskSession(taskId: string): boolean;
	readPersistedTaskSession(taskId: string): Promise<ClinePersistedTaskSessionSnapshot | null>;
	dispose(): Promise<void>;
}

export interface CreateInMemoryClineSessionRuntimeOptions {
	onTaskEvent?: (taskId: string, event: unknown) => void;
	createSessionHost?: () => Promise<ClineSessionHostBoundary>;
	createMcpRuntimeService?: () => ClineMcpRuntimeService;
}

// Best-effort: write the Kanban task title to the SDK session metadata so external session
// lists (e.g. the Cline extension) show a human-readable name. Kanban never reads this back.
async function persistKanbanTitleToClineSessionMetadata(
	sessionHost: ClineSessionHostBoundary,
	sessionId: string,
	taskTitle: string | undefined,
): Promise<void> {
	const title = taskTitle?.trim();
	if (!title) return;
	try {
		await sessionHost.update?.(sessionId, { title });
	} catch {
		// Best-effort only — Kanban board title remains canonical regardless.
	}
}

// Own the SDK session host plus the taskId <-> sessionId bindings so higher layers can stay task-oriented.
export class InMemoryClineSessionRuntime implements ClineSessionRuntime {
	private readonly onTaskEvent: ((taskId: string, event: unknown) => void) | null;
	private readonly createSessionHost: () => Promise<ClineSessionHostBoundary>;
	private readonly clineMcpRuntimeService: ClineMcpRuntimeService;
	private readonly sessionIdByTaskId = new Map<string, string>();
	private readonly taskIdBySessionId = new Map<string, string>();
	private readonly lastStartRequestByTaskId = new Map<
		string,
		Omit<StartClineSessionRuntimeRequest, "prompt" | "images" | "initialMessages" | "onTeamEvent">
	>();
	private readonly mcpToolBundleByTaskId = new Map<string, ClineMcpToolBundle>();
	private sessionHostPromise: Promise<ClineSessionHostBoundary> | null = null;

	constructor(options: CreateInMemoryClineSessionRuntimeOptions = {}) {
		this.onTaskEvent = options.onTaskEvent ?? null;
		this.createSessionHost = options.createSessionHost ?? createClineSdkSessionHost;
		const createMcpRuntimeService = options.createMcpRuntimeService ?? createClineMcpRuntimeService;
		this.clineMcpRuntimeService = createMcpRuntimeService();
	}

	async startTaskSession(request: StartClineSessionRuntimeRequest): Promise<StartClineSessionRuntimeResult> {
		const requestedSessionId = createSessionId(request.taskId);
		const resolvedMode: RuntimeTaskSessionMode = request.mode ?? "act";
		this.lastStartRequestByTaskId.set(request.taskId, {
			taskId: request.taskId,
			cwd: request.cwd,
			providerId: request.providerId,
			modelId: request.modelId,
			mode: resolvedMode,
			apiKey: request.apiKey,
			baseUrl: request.baseUrl,
			reasoningEffort: request.reasoningEffort,
			contextWindow: request.contextWindow,
			apiTimeoutMs: request.apiTimeoutMs,
			turnTimeoutMs: request.turnTimeoutMs,
			systemPrompt: request.systemPrompt,
			taskTitle: request.taskTitle,
			userInstructionService: request.userInstructionService,
			toolPolicies: request.toolPolicies,
			requestToolApproval: request.requestToolApproval,
		});
		this.bindTaskSession(request.taskId, requestedSessionId);

		let mcpToolBundle: ClineMcpToolBundle | null = null;
		let startWarnings: string[] = [];
		try {
			mcpToolBundle = await this.clineMcpRuntimeService.createToolBundle();
			startWarnings = mcpToolBundle.warnings;
		} catch (error) {
			mcpToolBundle = null;
			const message = error instanceof Error ? error.message.trim() : String(error);
			if (message.length > 0) {
				startWarnings = [`Failed to load MCP tools: ${message}`];
			}
		}
		this.replaceTaskMcpToolBundle(request.taskId, mcpToolBundle);
		const largeFileWorkflow = getClineLargeFileWorkflow(requestedSessionId, request.cwd);
		const baseRequestToolApproval = request.requestToolApproval;
		const fileReadToolByTurn = new Map<string, { toolName: string; toolCallId: string }>();
		const approvalTurnKey = (approvalRequest: ClineSdkToolApprovalRequest): string =>
			[
				approvalRequest.sessionId,
				approvalRequest.agentId,
				approvalRequest.conversationId,
				approvalRequest.iteration,
			].join(":");
		const requestToolApproval = baseRequestToolApproval
			? async (approvalRequest: ClineSdkToolApprovalRequest): Promise<ClineSdkToolApprovalResult> => {
					const turnKey = approvalTurnKey(approvalRequest);
					const claimedFileReadTool = fileReadToolByTurn.get(turnKey);
					if (claimedFileReadTool && claimedFileReadTool.toolCallId !== approvalRequest.toolCallId) {
						return {
							approved: false,
							reason: `Blocked ${approvalRequest.toolName}: this assistant turn already started ${claimedFileReadTool.toolName}. Wait for that tool result, analyze it, then start the next tool call in a later model request. No tool content was read.`,
						};
					}
					if (approvalRequest.toolName === "read_large_file") {
						const blockedReason = await largeFileWorkflow.getReadLargeFileBlockingReason();
						if (blockedReason) {
							return {
								approved: false,
								reason: blockedReason,
							};
						}
						const approval = await baseRequestToolApproval(approvalRequest);
						if (approval.approved) {
							fileReadToolByTurn.set(turnKey, {
								toolName: approvalRequest.toolName,
								toolCallId: approvalRequest.toolCallId,
							});
						}
						return approval;
					}
					if (approvalRequest.toolName === "read_files") {
						const blockedReason = await largeFileWorkflow.getReadFilesBlockingReason();
						if (blockedReason) {
							return {
								approved: false,
								reason: blockedReason,
							};
						}
						const approval = await baseRequestToolApproval(approvalRequest);
						if (approval.approved) {
							fileReadToolByTurn.set(turnKey, {
								toolName: approvalRequest.toolName,
								toolCallId: approvalRequest.toolCallId,
							});
						}
						return approval;
					}
					return await baseRequestToolApproval(approvalRequest);
				}
			: undefined;
		const hasMcpExtraTools = Boolean(mcpToolBundle && mcpToolBundle.tools.length > 0);
		const extraTools = [
			...createClineDecompositionTools({
				workspacePath: request.cwd,
			}),
			...createClineRetrievalTools({
				workspacePath: request.cwd,
			}),
			...createFileDiscoveryTools({
				workspacePath: request.cwd,
				contextWindow: request.contextWindow,
			}),
			createReadLargeFileTool({
				sessionId: requestedSessionId,
				workspacePath: request.cwd,
				contextWindow: request.contextWindow,
			}),
			createWriteFilesTool({
				workspacePath: request.cwd,
				maxFileLines: request.maxAgentWritableFileLines,
			}),
			createWriteFileTool({
				workspacePath: request.cwd,
				maxFileLines: request.maxAgentWritableFileLines,
			}),
			...createWebResearchTool({
				enabled: process.env.KANBAN_ENABLE_WEB_RESEARCH === "1",
			}),
			...(mcpToolBundle?.tools ?? []),
		];

		const sessionHost = await this.ensureSessionHost();
		const userImages = toSdkUserImages(request.images);
		const shouldSendInitialTurn = request.prompt.trim().length > 0 || Boolean(userImages?.length);
		const sdkApiTimeoutMs = resolveSdkApiTimeoutMs(request.apiTimeoutMs);
		const compaction = buildClineContextCompactionConfig(request.contextWindow);
		const teamDelegation = resolveClineTeamDelegationPolicy({
			taskId: request.taskId,
			mode: resolvedMode,
		});
		const providerConfig: NonNullable<ClineSdkStartSessionInput["config"]["providerConfig"]> = {
			providerId: request.providerId,
			modelId: request.modelId,
			...(request.apiKey?.trim() ? { apiKey: request.apiKey.trim() } : {}),
			...(request.baseUrl?.trim() ? { baseUrl: request.baseUrl.trim() } : {}),
			...(request.reasoningEffort === null
				? { reasoningEffort: "none" as NonNullable<ClineSdkStartSessionInput["config"]["reasoningEffort"]> }
				: request.reasoningEffort
					? { reasoningEffort: request.reasoningEffort }
					: {}),
			...(sdkApiTimeoutMs ? { timeoutMs: sdkApiTimeoutMs } : {}),
		};
		const config: ClineSdkStartSessionInput["config"] = {
			sessionId: requestedSessionId,
			providerId: request.providerId,
			modelId: request.modelId,
			apiKey: request.apiKey?.trim() || undefined,
			baseUrl: request.baseUrl?.trim() || undefined,
			reasoningEffort:
				request.reasoningEffort === null
					? ("none" as ClineSdkStartSessionInput["config"]["reasoningEffort"])
					: (request.reasoningEffort ?? undefined),
			cwd: request.cwd,
			mode: resolvedMode,
			enableTools: true,
			enableSpawnAgent: teamDelegation.enabled,
			enableAgentTeams: teamDelegation.enabled,
			...(teamDelegation.teamName ? { teamName: teamDelegation.teamName } : {}),
			...(teamDelegation.enabled && request.onTeamEvent
				? {
						onTeamEvent: (event) => {
							request.onTeamEvent?.(event, teamDelegation.teamName ?? null);
						},
					}
				: {}),
			...(hasMcpExtraTools ? { disableMcpSettingsTools: true } : {}),
			providerConfig,
			...(compaction ? { compaction } : {}),
			toolRoutingRules: buildKanbanModelToolRoutingRules(),
			execution: {
				maxConsecutiveMistakes: DEFAULT_CLINE_MAX_CONSECUTIVE_MISTAKES,
			},
			systemPrompt: request.systemPrompt,
		};
		let startResult: Awaited<ReturnType<ClineSessionHostBoundary["start"]>>;
		try {
			// Hub-backed SDK hosts create the interactive session in start; the first turn runs through send.
			startResult = await sessionHost.start({
				config,
				initialMessages: request.initialMessages,
				interactive: true,
				localRuntime: {
					modelCatalogDefaults: CLINE_MODEL_CATALOG_DEFAULTS,
					extensions: [createKanbanContextFocusExtension(requestedSessionId, request.cwd, request.contextWindow)],
					...(request.userInstructionService ? { userInstructionService: request.userInstructionService } : {}),
					...(compaction ? { compaction: { ...compaction, compact: compactKanbanFocusedMessages } } : {}),
					logger: createKanbanClineLogger({
						runtime: "kanban",
						taskId: request.taskId,
						requestedSessionId,
						providerId: request.providerId,
						modelId: request.modelId,
					}),
					extraTools,
				},
				...(requestToolApproval ? { capabilities: { requestToolApproval } } : {}),
				...(request.toolPolicies ? { toolPolicies: request.toolPolicies } : {}),
			});
		} catch (error) {
			this.clearTaskSessionBinding(request.taskId, requestedSessionId);
			await this.releaseTaskMcpToolBundle(request.taskId);
			throw error;
		}

		this.bindTaskSession(request.taskId, startResult.sessionId);
		if (startResult.sessionId !== requestedSessionId) {
			this.taskIdBySessionId.delete(requestedSessionId);
		}

		let result: unknown = startResult.result ?? null;
		if (shouldSendInitialTurn) {
			try {
				result = await sessionHost.send({
					sessionId: startResult.sessionId,
					prompt: request.prompt,
					userImages,
					...(request.turnTimeoutMs ? { timeoutMs: request.turnTimeoutMs } : {}),
				});
			} catch (error) {
				this.clearTaskSessionBinding(request.taskId, startResult.sessionId);
				await this.releaseTaskMcpToolBundle(request.taskId);
				throw error;
			}
		}

		await persistKanbanTitleToClineSessionMetadata(sessionHost, startResult.sessionId, request.taskTitle);

		return {
			sessionId: startResult.sessionId,
			result,
			...(startWarnings.length > 0 ? { warnings: startWarnings } : {}),
		};
	}

	async restartTaskSession(input: {
		taskId: string;
		prompt: string;
		initialMessages?: ClineSdkPersistedMessage[];
		images?: RuntimeTaskImage[];
		mode?: RuntimeTaskSessionMode;
		launchConfigOverrides?: ClineSessionLaunchConfigOverrides;
		onTeamEvent?: (event: ClineSdkTeamEvent, teamName: string | null) => void;
	}): Promise<StartClineSessionRuntimeResult> {
		const lastStartRequest = this.lastStartRequestByTaskId.get(input.taskId);
		if (!lastStartRequest) {
			throw new Error(`No previous Cline session config is available for task ${input.taskId}.`);
		}

		return await this.startTaskSession({
			...lastStartRequest,
			...(input.launchConfigOverrides ?? {}),
			prompt: input.prompt,
			initialMessages: input.initialMessages,
			images: input.images,
			mode: input.mode ?? lastStartRequest.mode,
			onTeamEvent: input.onTeamEvent,
		});
	}

	async sendTaskSessionInput(
		taskId: string,
		prompt: string,
		mode?: RuntimeTaskSessionMode,
		images?: RuntimeTaskImage[],
		delivery?: "queue" | "steer",
		launchConfigOverrides?: ClineSessionLaunchConfigOverrides,
	): Promise<unknown> {
		const sessionId = this.sessionIdByTaskId.get(taskId);
		if (!sessionId) {
			throw new Error(`No active Cline session for task ${taskId}.`);
		}
		const sessionHost = await this.ensureSessionHost();
		if (launchConfigOverrides) {
			if (this.requiresTaskSessionRestart(taskId, mode, launchConfigOverrides)) {
				throw new Error(
					"The active Cline session must be restarted before applying the selected launch configuration.",
				);
			}
			await this.updateActiveSessionModel(sessionHost, sessionId, launchConfigOverrides.modelId);
			this.updateLastStartRequestLaunchConfig(taskId, launchConfigOverrides);
		}
		const turnTimeoutMs =
			launchConfigOverrides && Object.hasOwn(launchConfigOverrides, "turnTimeoutMs")
				? launchConfigOverrides.turnTimeoutMs
				: this.lastStartRequestByTaskId.get(taskId)?.turnTimeoutMs;
		return await sessionHost.send({
			sessionId,
			prompt,
			userImages: toSdkUserImages(images),
			...(delivery ? { delivery } : {}),
			...(turnTimeoutMs ? { timeoutMs: turnTimeoutMs } : {}),
		});
	}

	requiresTaskSessionRestart(
		taskId: string,
		mode?: RuntimeTaskSessionMode,
		launchConfigOverrides?: ClineSessionLaunchConfigOverrides,
	): boolean {
		const lastStartRequest = this.lastStartRequestByTaskId.get(taskId);
		if (!lastStartRequest) {
			return false;
		}
		if (mode && mode !== lastStartRequest.mode) {
			return true;
		}
		if (!launchConfigOverrides) {
			return false;
		}
		return (
			launchConfigOverrides.providerId.trim().toLowerCase() !== lastStartRequest.providerId.trim().toLowerCase() ||
			(Object.hasOwn(launchConfigOverrides, "apiKey") &&
				(launchConfigOverrides.apiKey?.trim() || null) !== (lastStartRequest.apiKey?.trim() || null)) ||
			(Object.hasOwn(launchConfigOverrides, "baseUrl") &&
				(launchConfigOverrides.baseUrl?.trim() || null) !== (lastStartRequest.baseUrl?.trim() || null)) ||
			(Object.hasOwn(launchConfigOverrides, "reasoningEffort") &&
				(launchConfigOverrides.reasoningEffort ?? null) !== (lastStartRequest.reasoningEffort ?? null)) ||
			(Object.hasOwn(launchConfigOverrides, "contextWindow") &&
				(launchConfigOverrides.contextWindow ?? null) !== (lastStartRequest.contextWindow ?? null)) ||
			(Object.hasOwn(launchConfigOverrides, "apiTimeoutMs") &&
				(launchConfigOverrides.apiTimeoutMs ?? null) !== (lastStartRequest.apiTimeoutMs ?? null)) ||
			(Object.hasOwn(launchConfigOverrides, "turnTimeoutMs") &&
				(launchConfigOverrides.turnTimeoutMs ?? null) !== (lastStartRequest.turnTimeoutMs ?? null))
		);
	}

	async resumeTaskSession(taskId: string): Promise<ClinePersistedTaskSessionSnapshot | null> {
		const sessionHost = await this.ensureSessionHost();
		const record = await this.findPersistedTaskSessionRecord(taskId, sessionHost);
		if (!record) {
			return null;
		}
		this.bindTaskSession(taskId, record.sessionId);
		const messages = await sessionHost.readMessages(record.sessionId);
		return {
			record,
			messages,
		};
	}

	async stopTaskSession(taskId: string): Promise<void> {
		const sessionId = this.sessionIdByTaskId.get(taskId);
		if (!sessionId) {
			await this.releaseTaskMcpToolBundle(taskId);
			return;
		}
		const sessionHost = await this.ensureSessionHost();
		try {
			await sessionHost.stop(sessionId);
			this.clearTaskSessionBinding(taskId, sessionId);
		} catch (error) {
			const persistedRecord = await sessionHost.get(sessionId).catch(() => undefined);
			if (!persistedRecord) {
				this.clearTaskSessionBinding(taskId, sessionId);
			}
			throw error;
		} finally {
			await this.releaseTaskMcpToolBundle(taskId);
		}
	}

	async abortTaskSession(taskId: string): Promise<void> {
		const sessionId = this.sessionIdByTaskId.get(taskId);
		if (!sessionId) {
			await this.releaseTaskMcpToolBundle(taskId);
			return;
		}
		const sessionHost = await this.ensureSessionHost();
		try {
			await sessionHost.abort(sessionId);
			this.clearTaskSessionBinding(taskId, sessionId);
		} catch (error) {
			const persistedRecord = await sessionHost.get(sessionId).catch(() => undefined);
			if (!persistedRecord) {
				this.clearTaskSessionBinding(taskId, sessionId);
			}
			throw error;
		} finally {
			await this.releaseTaskMcpToolBundle(taskId);
		}
	}

	async clearTaskSessions(taskId: string): Promise<void> {
		const sessionHost = await this.ensureSessionHost();
		const sessionIdPrefix = buildSessionIdPrefix(taskId);
		const records = await sessionHost.list();
		const matchingSessionIds = new Set(
			records.filter((record) => record.sessionId.startsWith(sessionIdPrefix)).map((record) => record.sessionId),
		);
		const activeSessionId = this.sessionIdByTaskId.get(taskId);
		if (activeSessionId) {
			matchingSessionIds.add(activeSessionId);
			await sessionHost.abort(activeSessionId).catch(() => undefined);
		}

		for (const sessionId of matchingSessionIds) {
			await sessionHost.delete(sessionId).catch(() => false);
			this.taskIdBySessionId.delete(sessionId);
			releaseClineLargeFileWorkflow(sessionId);
		}
		this.clearTaskSessionBinding(taskId);
		await this.releaseTaskMcpToolBundle(taskId);
	}

	getTaskSessionId(taskId: string): string | null {
		return this.sessionIdByTaskId.get(taskId) ?? null;
	}

	getTaskProviderId(taskId: string): string | null {
		return this.lastStartRequestByTaskId.get(taskId)?.providerId ?? null;
	}

	canRestartTaskSession(taskId: string): boolean {
		return this.lastStartRequestByTaskId.has(taskId);
	}

	async readPersistedTaskSession(taskId: string): Promise<ClinePersistedTaskSessionSnapshot | null> {
		const sessionHost = await this.ensureSessionHost();
		const record = await this.findPersistedTaskSessionRecord(taskId, sessionHost);
		if (!record) {
			return null;
		}
		const messages = await sessionHost.readMessages(record.sessionId);
		return {
			record,
			messages,
		};
	}

	async dispose(): Promise<void> {
		const hostPromise = this.sessionHostPromise;
		this.sessionHostPromise = null;
		if (hostPromise) {
			try {
				const host = await hostPromise;
				await host.dispose("kanban-runtime-dispose");
			} catch {
				// Ignore host disposal errors.
			}
		}
		this.sessionIdByTaskId.clear();
		this.taskIdBySessionId.clear();
		this.lastStartRequestByTaskId.clear();
		releaseAllClineLargeFileWorkflows();

		const mcpBundles = [...this.mcpToolBundleByTaskId.values()];
		this.mcpToolBundleByTaskId.clear();
		await Promise.all(
			mcpBundles.map(async (bundle) => {
				await bundle.dispose().catch(() => undefined);
			}),
		);
	}

	private replaceTaskMcpToolBundle(taskId: string, bundle: ClineMcpToolBundle | null): void {
		const current = this.mcpToolBundleByTaskId.get(taskId);
		if (current) {
			void current.dispose().catch(() => undefined);
			this.mcpToolBundleByTaskId.delete(taskId);
		}
		if (bundle) {
			this.mcpToolBundleByTaskId.set(taskId, bundle);
		}
	}

	private async releaseTaskMcpToolBundle(taskId: string): Promise<void> {
		const current = this.mcpToolBundleByTaskId.get(taskId);
		if (!current) {
			return;
		}
		this.mcpToolBundleByTaskId.delete(taskId);
		await current.dispose().catch(() => undefined);
	}

	private bindTaskSession(taskId: string, sessionId: string): void {
		const previousSessionId = this.sessionIdByTaskId.get(taskId);
		if (previousSessionId) {
			this.taskIdBySessionId.delete(previousSessionId);
		}
		this.sessionIdByTaskId.set(taskId, sessionId);
		this.taskIdBySessionId.set(sessionId, taskId);
	}

	private clearTaskSessionBinding(taskId: string, sessionId?: string): void {
		const activeSessionId = this.sessionIdByTaskId.get(taskId);
		if (!activeSessionId) {
			return;
		}
		if (sessionId && activeSessionId !== sessionId) {
			return;
		}
		this.sessionIdByTaskId.delete(taskId);
		this.taskIdBySessionId.delete(activeSessionId);
	}

	private async findPersistedTaskSessionRecord(
		taskId: string,
		sessionHost: ClineSessionHostBoundary,
	): Promise<ClineSdkSessionRecord | null> {
		const activeSessionId = this.sessionIdByTaskId.get(taskId);
		if (activeSessionId) {
			const activeRecord = (await sessionHost.get(activeSessionId)) ?? null;
			if (activeRecord) {
				return activeRecord;
			}
		}

		const sessionIdPrefix = buildSessionIdPrefix(taskId);
		const records: ClineSdkSessionRecord[] = await sessionHost.list();
		const matchingRecord = records
			.filter((record: ClineSdkSessionRecord) => record.sessionId.startsWith(sessionIdPrefix))
			.sort((left: ClineSdkSessionRecord, right: ClineSdkSessionRecord) => {
				const leftTimestamp = Date.parse(left.updatedAt || left.startedAt);
				const rightTimestamp = Date.parse(right.updatedAt || right.startedAt);
				return rightTimestamp - leftTimestamp;
			})[0];
		return matchingRecord ?? null;
	}

	private async ensureSessionHost(): Promise<ClineSessionHostBoundary> {
		if (!this.sessionHostPromise) {
			this.sessionHostPromise = this.createSessionHost().then((sessionHost: ClineSessionHostBoundary) => {
				sessionHost.subscribe((event: unknown) => {
					this.handleSessionEvent(event);
				});
				return sessionHost;
			});
		}
		return await this.sessionHostPromise;
	}

	private async updateActiveSessionModel(
		sessionHost: ClineSessionHostBoundary,
		sessionId: string,
		modelId: string,
	): Promise<void> {
		await sessionHost.updateSessionModel?.(sessionId, modelId);
	}

	private updateLastStartRequestLaunchConfig(
		taskId: string,
		launchConfigOverrides: ClineSessionLaunchConfigOverrides,
	): void {
		const lastStartRequest = this.lastStartRequestByTaskId.get(taskId);
		if (!lastStartRequest) {
			return;
		}
		this.lastStartRequestByTaskId.set(taskId, {
			...lastStartRequest,
			providerId: launchConfigOverrides.providerId,
			modelId: launchConfigOverrides.modelId,
			...(Object.hasOwn(launchConfigOverrides, "apiKey") ? { apiKey: launchConfigOverrides.apiKey } : {}),
			...(Object.hasOwn(launchConfigOverrides, "baseUrl") ? { baseUrl: launchConfigOverrides.baseUrl } : {}),
			...(Object.hasOwn(launchConfigOverrides, "reasoningEffort")
				? { reasoningEffort: launchConfigOverrides.reasoningEffort }
				: {}),
			...(Object.hasOwn(launchConfigOverrides, "contextWindow")
				? { contextWindow: launchConfigOverrides.contextWindow }
				: {}),
			...(Object.hasOwn(launchConfigOverrides, "apiTimeoutMs")
				? { apiTimeoutMs: launchConfigOverrides.apiTimeoutMs }
				: {}),
			...(Object.hasOwn(launchConfigOverrides, "turnTimeoutMs")
				? { turnTimeoutMs: launchConfigOverrides.turnTimeoutMs }
				: {}),
		});
	}

	private handleSessionEvent(event: unknown): void {
		const sessionId = extractClineSessionId(event);
		if (!sessionId) {
			return;
		}
		const taskId = this.taskIdBySessionId.get(sessionId);
		if (!taskId) {
			return;
		}
		const eventRecord = event && typeof event === "object" ? (event as { type?: unknown }) : null;
		const ended = eventRecord?.type === "ended";
		if (this.onTaskEvent) {
			this.onTaskEvent(taskId, event);
		}
		if (ended) {
			this.clearTaskSessionBinding(taskId, sessionId);
			void this.releaseTaskMcpToolBundle(taskId);
		}
	}
}

export function createInMemoryClineSessionRuntime(
	options: CreateInMemoryClineSessionRuntimeOptions = {},
): ClineSessionRuntime {
	return new InMemoryClineSessionRuntime(options);
}
