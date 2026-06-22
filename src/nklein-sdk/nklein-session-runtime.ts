// Owns the live SDK session host plus taskId to sessionId bindings.
// This is the runtime-facing layer for starting, looking up, resuming, and
// stopping native NKlein sessions without exposing SDK details upstream.

import type { ToolExecutors } from "@nklein/core";
import type {
	AgentAfterToolContext,
	AgentBeforeModelContext,
	AgentBeforeModelResult,
	AgentMessage,
	AgentTool,
} from "@nklein/shared";
import {
	type RuntimeNKleinReasoningEffort,
	type RuntimeTaskImage,
	type RuntimeTaskSessionMode,
	runtimeNKleinReasoningEffortSchema,
} from "../core/api-contract";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import { getWorkspaceChanges } from "../workspace/get-workspace-changes";
import { createNKleinCodeEmbeddingProvider, type NKleinCodeEmbeddingProvider } from "./nklein-code-embeddings";
import { buildKanbanContextPressurePolicy } from "./nklein-context-budgets";
import { compactKanbanFocusedMessages, focusKanbanReadFilesForNextRequest } from "./nklein-context-focus-policy";
import { createNKleinDecompositionTools, type NKleinDecompositionAppliedHandler } from "./nklein-decomposition-tool";
import { createEditFileTool } from "./nklein-edit-file-tool";
import { extractNKleinSessionId } from "./nklein-event-adapter";
import { createFileDiscoveryTools } from "./nklein-file-discovery-tools";
import {
	createReadLargeFileTool,
	getNKleinLargeFileWorkflow,
	parseReadFileRequests,
	releaseAllNKleinLargeFileWorkflows,
	releaseNKleinLargeFileWorkflow,
} from "./nklein-large-file-workflow";
import { CLOUD_ENABLED } from "./nklein-local-only-policy";
import {
	createNKleinMcpRuntimeService,
	type NKleinMcpRuntimeService,
	type NKleinMcpToolBundle,
} from "./nklein-mcp-runtime-service";
import { buildKanbanModelToolRoutingRules } from "./nklein-model-tool-routing";
import { buildNKleinRepoMap } from "./nklein-repo-map";
import { createNKleinRetrievalTools } from "./nklein-retrieval-tools";
import { createNKleinReviewTool, type NKleinReviewSubmittedHandler } from "./nklein-review-tool";
import { createKanbanNKleinLogger } from "./nklein-runtime-logger";
import { reviewNKleinAfterModelCompletion } from "./nklein-self-review-hook";
import { buildSessionIdPrefix, createSessionId } from "./nklein-session-state";
import { resolveNKleinTeamDelegationPolicy } from "./nklein-team-delegation";
import { createWebResearchTool } from "./nklein-web-research-tool";
import { createWriteFilesTool, createWriteFileTool } from "./nklein-write-files-tool";
import { NKLEIN_MODEL_CATALOG_DEFAULTS } from "./sdk-provider-boundary";
import {
	createNKleinSdkSessionHost,
	type NKleinSdkPersistedMessage,
	type NKleinSdkSessionHost,
	type NKleinSdkSessionRecord,
	type NKleinSdkStartSessionInput,
	type NKleinSdkTeamEvent,
	type NKleinSdkToolApprovalRequest,
	type NKleinSdkToolApprovalResult,
	type NKleinSdkUserInstructionService,
} from "./sdk-runtime-boundary";

export { NKLEIN_MODEL_CATALOG_DEFAULTS } from "./sdk-provider-boundary";

const DEFAULT_NKLEIN_MAX_CONSECUTIVE_MISTAKES = 3;
const DEFAULT_NKLEIN_CONTEXT_WINDOW_TOKENS = 80_000;
const NKLEIN_CONTEXT_COMPACTION_RESERVE_TOKENS = 16_384;
const NKLEIN_CONTEXT_COMPACTION_PRESERVE_RECENT_TOKENS = 20_000;
const NKLEIN_CONTEXT_COMPACTION_RESERVE_RATIO = 0.2;
const NKLEIN_CONTEXT_COMPACTION_PRESERVE_RECENT_RATIO = 0.25;
const REPO_MAP_INVALIDATING_TOOL_NAMES = new Set([
	"apply_patch",
	"bash",
	"edit_file",
	"editor",
	"execute_command",
	"replace_in_file",
	"terminal",
	"write_file",
	"write_files",
	"write_to_file",
]);

interface ReadFilesTargetKey {
	path: string;
	rangeKey: string;
	fullFile: boolean;
}

function buildReadFilesTargetKeys(input: unknown): ReadFilesTargetKey[] {
	return parseReadFileRequests(input)
		.map((request) => {
			const path = request.path.trim();
			if (!path) {
				return null;
			}
			const startLine = typeof request.startLine === "number" ? request.startLine : null;
			const endLine = typeof request.endLine === "number" ? request.endLine : null;
			const fullFile = startLine === null && endLine === null;
			return {
				path,
				rangeKey: `${path}:${startLine ?? ""}:${endLine ?? ""}`,
				fullFile,
			};
		})
		.filter((key): key is ReadFilesTargetKey => key !== null);
}

function buildReadFilesRequestFingerprint(keys: ReadFilesTargetKey[]): string | null {
	if (keys.length === 0) {
		return null;
	}
	return [...keys]
		.map((key) => key.rangeKey)
		.sort((left, right) => left.localeCompare(right))
		.join("\n");
}

type NKleinSdkContextCompactionConfig = NonNullable<NKleinSdkStartSessionInput["config"]["compaction"]>;
type NKleinSdkLocalRuntimeOptions = NonNullable<NKleinSdkStartSessionInput["localRuntime"]>;
type NKleinSdkRuntimeExtension = NonNullable<NKleinSdkLocalRuntimeOptions["extensions"]>[number];
const KANBAN_SESSION_METADATA_KEY = "kanban";

export interface NKleinPersistedLaunchConfig {
	providerId: string;
	modelId: string;
	workspaceRoot?: string | null;
	baseUrl?: string | null;
	reasoningEffort?: RuntimeNKleinReasoningEffort | null;
	contextWindow?: number | null;
	maxAgentWritableFileLines?: number | null;
	apiTimeoutMs?: number | null;
	turnTimeoutMs?: number | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | null | undefined {
	if (!Object.hasOwn(record, key)) {
		return undefined;
	}
	const value = record[key];
	if (value === null) {
		return null;
	}
	return typeof value === "string" ? value : undefined;
}

function readOptionalNumber(record: Record<string, unknown>, key: string): number | null | undefined {
	if (!Object.hasOwn(record, key)) {
		return undefined;
	}
	const value = record[key];
	if (value === null) {
		return null;
	}
	return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : undefined;
}

function readOptionalReasoningEffort(
	record: Record<string, unknown>,
	key: string,
): RuntimeNKleinReasoningEffort | null | undefined {
	if (!Object.hasOwn(record, key)) {
		return undefined;
	}
	const value = record[key];
	if (value === null) {
		return null;
	}
	const parsed = runtimeNKleinReasoningEffortSchema.safeParse(value);
	return parsed.success ? parsed.data : undefined;
}

export function readKanbanLaunchConfigFromSessionRecord(
	record: NKleinSdkSessionRecord,
): NKleinPersistedLaunchConfig | null {
	const metadata = asRecord(record.metadata);
	const kanban = asRecord(metadata?.[KANBAN_SESSION_METADATA_KEY]);
	const launchConfig = asRecord(kanban?.launchConfig);
	if (!launchConfig) {
		return null;
	}
	const providerId = readOptionalString(launchConfig, "providerId")?.trim().toLowerCase();
	const modelId = readOptionalString(launchConfig, "modelId")?.trim();
	if (!providerId || !modelId) {
		return null;
	}
	return {
		providerId,
		modelId,
		...(readOptionalString(launchConfig, "workspaceRoot") !== undefined
			? { workspaceRoot: readOptionalString(launchConfig, "workspaceRoot") }
			: {}),
		...(readOptionalString(launchConfig, "baseUrl") !== undefined
			? { baseUrl: readOptionalString(launchConfig, "baseUrl") }
			: {}),
		...(readOptionalReasoningEffort(launchConfig, "reasoningEffort") !== undefined
			? { reasoningEffort: readOptionalReasoningEffort(launchConfig, "reasoningEffort") }
			: {}),
		...(readOptionalNumber(launchConfig, "contextWindow") !== undefined
			? { contextWindow: readOptionalNumber(launchConfig, "contextWindow") }
			: {}),
		...(readOptionalNumber(launchConfig, "maxAgentWritableFileLines") !== undefined
			? { maxAgentWritableFileLines: readOptionalNumber(launchConfig, "maxAgentWritableFileLines") }
			: {}),
		...(readOptionalNumber(launchConfig, "apiTimeoutMs") !== undefined
			? { apiTimeoutMs: readOptionalNumber(launchConfig, "apiTimeoutMs") }
			: {}),
		...(readOptionalNumber(launchConfig, "turnTimeoutMs") !== undefined
			? { turnTimeoutMs: readOptionalNumber(launchConfig, "turnTimeoutMs") }
			: {}),
	};
}

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

function readAgentMessageText(message: AgentMessage): string {
	const content = message.content;
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	return content
		.map((part) => {
			if (!part || typeof part !== "object" || !("text" in part)) {
				return "";
			}
			const text = part.text;
			return typeof text === "string" ? text : "";
		})
		.filter(Boolean)
		.join("\n");
}

function collectRepoMapPersonalizationText(messages: readonly AgentMessage[]): string {
	const text = messages
		.filter((message) => message.metadata?.kind !== "kanban_repo_map_rail")
		.map(readAgentMessageText)
		.filter(Boolean)
		.join("\n\n");
	return text.length > 12_000 ? text.slice(-12_000) : text;
}

export function doesNKleinToolInvalidateRepoMap(context: AgentAfterToolContext): boolean {
	if (context.result.isError === true) {
		return false;
	}
	return REPO_MAP_INVALIDATING_TOOL_NAMES.has(context.toolCall.toolName.trim().toLowerCase());
}

async function appendRepoMapBeforeModel(
	context: AgentBeforeModelContext,
	_workspacePath: string,
	contextWindow: number | null | undefined,
	baseResult: AgentBeforeModelResult | null | undefined,
	getCachedRepoMap: (personalizationText: string) => Promise<string | null>,
): Promise<AgentBeforeModelResult | undefined> {
	if (baseResult?.stop) {
		return baseResult;
	}
	const messages = baseResult?.messages ?? context.request.messages;
	const repoMap = await getCachedRepoMap(collectRepoMapPersonalizationText(messages));
	if (!repoMap) {
		return baseResult ?? undefined;
	}
	const alreadyInjected = messages.some((message) => message.metadata?.kind === "kanban_repo_map_rail");
	if (alreadyInjected) {
		return baseResult ?? undefined;
	}
	return {
		...baseResult,
		messages: [
			createRepoMapRailMessage(
				[
					"[!Klein repo map: compact codebase orientation]",
					"Workspace root: .",
					"Use workspace-relative paths for file tools; host absolute paths are not valid inside the agent sandbox.",
					`Context window: ${contextWindow ?? "unknown"} tokens`,
					repoMap,
					"Use this map to choose focused read_files calls; prefer symbol-level navigation over whole-file reading.",
				].join("\n"),
			),
			...messages,
		],
	};
}

function createKanbanContextFocusExtension(
	sessionId: string,
	workspacePath: string,
	contextWindow?: number | null,
): NKleinSdkRuntimeExtension {
	const largeFileWorkflow = getNKleinLargeFileWorkflow(sessionId, workspacePath);
	let cachedRepoMap: { key: string; value: Promise<string | null> } | null = null;
	const contextPressure = buildKanbanContextPressurePolicy({ contextWindow });
	const getCachedRepoMap = async (personalizationText: string) => {
		const cacheKey = personalizationText;
		if (cachedRepoMap?.key !== cacheKey) {
			cachedRepoMap = {
				key: cacheKey,
				value: buildNKleinRepoMap({
					workspacePath,
					tokenBudget: contextPressure.repoMapTokenBudget,
					personalizationText,
				})
					.then((repoMap) => (repoMap.symbols.length > 0 ? repoMap.rendered : null))
					.catch(() => null),
			};
		}
		return await cachedRepoMap.value;
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
				const largeFileControl = await largeFileWorkflow.afterModel(context);
				return (
					largeFileControl ??
					reviewNKleinAfterModelCompletion(context, { hasChangedFiles: await hasChangedFiles() })
				);
			},
			afterTool(context) {
				if (doesNKleinToolInvalidateRepoMap(context)) {
					cachedRepoMap = null;
				}
				return undefined;
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

type NKleinSessionLaunchConfigOverrides = {
	providerId: string;
	modelId: string;
	apiKey?: string | null;
	baseUrl?: string | null;
	reasoningEffort?: RuntimeNKleinReasoningEffort | null;
	contextWindow?: number | null;
	maxAgentWritableFileLines?: number | null;
	apiTimeoutMs?: number | null;
	turnTimeoutMs?: number | null;
};

interface NKleinSessionHostBoundary {
	start(input: NKleinSdkStartSessionInput): Promise<{ sessionId: string; result?: unknown }>;
	send(input: Parameters<NKleinSdkSessionHost["send"]>[0]): Promise<unknown>;
	stop(sessionId: string): Promise<void>;
	abort(sessionId: string): Promise<void>;
	delete(sessionId: string): Promise<boolean>;
	dispose(reason?: string): Promise<void>;
	get(sessionId: string): Promise<NKleinSdkSessionRecord | undefined>;
	list(limit?: number): Promise<NKleinSdkSessionRecord[]>;
	update?(
		sessionId: string,
		updates: {
			prompt?: string | null;
			metadata?: Record<string, unknown> | null;
			title?: string | null;
		},
	): Promise<{ updated: boolean }>;
	updateSessionModel?(sessionId: string, modelId: string): Promise<void>;
	readMessages(sessionId: string): Promise<NKleinSdkPersistedMessage[]>;
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

export function buildNKleinContextCompactionConfig(
	contextWindow: number | null | undefined,
): NKleinSdkContextCompactionConfig | undefined {
	const contextWindowTokens = resolveContextWindowTokens(contextWindow) ?? DEFAULT_NKLEIN_CONTEXT_WINDOW_TOKENS;
	return {
		enabled: true,
		strategy: "basic",
		contextWindowTokens,
		reserveTokens: Math.max(
			1,
			Math.min(
				NKLEIN_CONTEXT_COMPACTION_RESERVE_TOKENS,
				Math.round(contextWindowTokens * NKLEIN_CONTEXT_COMPACTION_RESERVE_RATIO),
			),
		),
		preserveRecentTokens: Math.max(
			1,
			Math.min(
				NKLEIN_CONTEXT_COMPACTION_PRESERVE_RECENT_TOKENS,
				Math.round(contextWindowTokens * NKLEIN_CONTEXT_COMPACTION_PRESERVE_RECENT_RATIO),
			),
		),
	};
}

export interface StartNKleinSessionRuntimeRequest {
	taskId: string;
	cwd: string;
	workspaceRoot?: string | null;
	prompt: string;
	/** Normalized !Klein task title; persisted to SDK session metadata when supported. */
	taskTitle?: string;
	initialMessages?: NKleinSdkPersistedMessage[];
	images?: RuntimeTaskImage[];
	providerId: string;
	modelId: string;
	mode?: RuntimeTaskSessionMode;
	apiKey?: string | null;
	baseUrl?: string | null;
	reasoningEffort?: RuntimeNKleinReasoningEffort | null;
	contextWindow?: number | null;
	maxAgentWritableFileLines?: number | null;
	codeEmbeddingProvider?: NKleinCodeEmbeddingProvider;
	apiTimeoutMs?: number | null;
	turnTimeoutMs?: number | null;
	systemPrompt: string;
	userInstructionService?: NKleinSdkUserInstructionService;
	toolPolicies?: NKleinSdkStartSessionInput["toolPolicies"];
	requestToolApproval?: (request: NKleinSdkToolApprovalRequest) => Promise<NKleinSdkToolApprovalResult>;
	toolExecutors?: Partial<ToolExecutors>;
	extraTools?: AgentTool[];
	onDecompositionApplied?: NKleinDecompositionAppliedHandler;
	/** When provided, this is a second-opinion review turn: the `submit_review` tool is attached and its verdict is reported here. */
	onReviewSubmitted?: NKleinReviewSubmittedHandler;
	onTeamEvent?: (event: NKleinSdkTeamEvent, teamName: string | null) => void;
}

export interface StartNKleinSessionRuntimeResult {
	sessionId: string;
	result: unknown;
	warnings?: string[];
}

export interface NKleinPersistedTaskSessionSnapshot {
	record: NKleinSdkSessionRecord;
	messages: NKleinSdkPersistedMessage[];
}

export interface NKleinSessionRuntime {
	startTaskSession(request: StartNKleinSessionRuntimeRequest): Promise<StartNKleinSessionRuntimeResult>;
	restartTaskSession(input: {
		taskId: string;
		prompt: string;
		initialMessages?: NKleinSdkPersistedMessage[];
		images?: RuntimeTaskImage[];
		mode?: RuntimeTaskSessionMode;
		launchConfigOverrides?: NKleinSessionLaunchConfigOverrides;
		onTeamEvent?: (event: NKleinSdkTeamEvent, teamName: string | null) => void;
	}): Promise<StartNKleinSessionRuntimeResult>;
	sendTaskSessionInput(
		taskId: string,
		prompt: string,
		mode?: RuntimeTaskSessionMode,
		images?: RuntimeTaskImage[],
		delivery?: "queue" | "steer",
		launchConfigOverrides?: NKleinSessionLaunchConfigOverrides,
	): Promise<unknown>;
	requiresTaskSessionRestart(
		taskId: string,
		mode?: RuntimeTaskSessionMode,
		launchConfigOverrides?: NKleinSessionLaunchConfigOverrides,
	): boolean;
	resumeTaskSession(taskId: string): Promise<NKleinPersistedTaskSessionSnapshot | null>;
	stopTaskSession(taskId: string): Promise<void>;
	abortTaskSession(taskId: string): Promise<void>;
	clearTaskSessions(taskId: string): Promise<void>;
	getTaskSessionId(taskId: string): string | null;
	getTaskProviderId(taskId: string): string | null;
	canRestartTaskSession(taskId: string): boolean;
	readPersistedTaskSession(taskId: string): Promise<NKleinPersistedTaskSessionSnapshot | null>;
	dispose(): Promise<void>;
}

export interface CreateInMemoryNKleinSessionRuntimeOptions {
	onTaskEvent?: (taskId: string, event: unknown) => void;
	createSessionHost?: () => Promise<NKleinSessionHostBoundary>;
	createMcpRuntimeService?: () => NKleinMcpRuntimeService;
}

// Best-effort: write the !Klein task title to the SDK session metadata so external session
// lists (e.g. the NKlein extension) show a human-readable name. !Klein never reads this back.
async function persistKanbanTitleToNKleinSessionMetadata(
	sessionHost: NKleinSessionHostBoundary,
	sessionId: string,
	taskTitle: string | undefined,
): Promise<void> {
	const title = taskTitle?.trim();
	if (!title) return;
	try {
		await sessionHost.update?.(sessionId, { title });
	} catch {
		// Best-effort only — !Klein board title remains canonical regardless.
	}
}

function toPersistedLaunchConfig(request: StartNKleinSessionRuntimeRequest): NKleinPersistedLaunchConfig {
	return {
		providerId: request.providerId.trim().toLowerCase(),
		modelId: request.modelId.trim(),
		...(request.workspaceRoot !== undefined ? { workspaceRoot: request.workspaceRoot?.trim() || null } : {}),
		...(request.baseUrl !== undefined ? { baseUrl: request.baseUrl?.trim() || null } : {}),
		...(request.reasoningEffort !== undefined ? { reasoningEffort: request.reasoningEffort } : {}),
		...(request.contextWindow !== undefined ? { contextWindow: request.contextWindow } : {}),
		...(request.maxAgentWritableFileLines !== undefined
			? { maxAgentWritableFileLines: request.maxAgentWritableFileLines }
			: {}),
		...(request.apiTimeoutMs !== undefined ? { apiTimeoutMs: request.apiTimeoutMs } : {}),
		...(request.turnTimeoutMs !== undefined ? { turnTimeoutMs: request.turnTimeoutMs } : {}),
	};
}

async function persistKanbanLaunchConfigToNKleinSessionMetadata(
	sessionHost: NKleinSessionHostBoundary,
	sessionId: string,
	request: StartNKleinSessionRuntimeRequest,
): Promise<void> {
	try {
		await sessionHost.update?.(sessionId, {
			metadata: {
				[KANBAN_SESSION_METADATA_KEY]: {
					launchConfig: toPersistedLaunchConfig(request),
				},
			},
		});
	} catch {
		// Best-effort only — live in-memory restart config still covers the current process.
	}
}

// Own the SDK session host plus the taskId <-> sessionId bindings so higher layers can stay task-oriented.
export class InMemoryNKleinSessionRuntime implements NKleinSessionRuntime {
	private readonly onTaskEvent: ((taskId: string, event: unknown) => void) | null;
	private readonly createSessionHost: () => Promise<NKleinSessionHostBoundary>;
	private readonly nkleinMcpRuntimeService: NKleinMcpRuntimeService;
	private readonly sessionIdByTaskId = new Map<string, string>();
	private readonly taskIdBySessionId = new Map<string, string>();
	private readonly lastStartRequestByTaskId = new Map<
		string,
		Omit<StartNKleinSessionRuntimeRequest, "prompt" | "images" | "initialMessages" | "onTeamEvent">
	>();
	private readonly mcpToolBundleByTaskId = new Map<string, NKleinMcpToolBundle>();
	private sessionHostPromise: Promise<NKleinSessionHostBoundary> | null = null;

	constructor(options: CreateInMemoryNKleinSessionRuntimeOptions = {}) {
		this.onTaskEvent = options.onTaskEvent ?? null;
		this.createSessionHost = options.createSessionHost ?? createNKleinSdkSessionHost;
		const createMcpRuntimeService = options.createMcpRuntimeService ?? createNKleinMcpRuntimeService;
		this.nkleinMcpRuntimeService = createMcpRuntimeService();
	}

	async startTaskSession(request: StartNKleinSessionRuntimeRequest): Promise<StartNKleinSessionRuntimeResult> {
		const requestedSessionId = createSessionId(request.taskId);
		const resolvedMode: RuntimeTaskSessionMode = request.mode ?? "act";
		this.lastStartRequestByTaskId.set(request.taskId, {
			taskId: request.taskId,
			cwd: request.cwd,
			workspaceRoot: request.workspaceRoot,
			providerId: request.providerId,
			modelId: request.modelId,
			mode: resolvedMode,
			apiKey: request.apiKey,
			baseUrl: request.baseUrl,
			reasoningEffort: request.reasoningEffort,
			contextWindow: request.contextWindow,
			maxAgentWritableFileLines: request.maxAgentWritableFileLines,
			apiTimeoutMs: request.apiTimeoutMs,
			turnTimeoutMs: request.turnTimeoutMs,
			systemPrompt: request.systemPrompt,
			taskTitle: request.taskTitle,
			userInstructionService: request.userInstructionService,
			toolPolicies: request.toolPolicies,
			requestToolApproval: request.requestToolApproval,
		});
		this.bindTaskSession(request.taskId, requestedSessionId);

		let mcpToolBundle: NKleinMcpToolBundle | null = null;
		let startWarnings: string[] = [];
		try {
			mcpToolBundle = await this.nkleinMcpRuntimeService.createToolBundle();
			startWarnings = mcpToolBundle.warnings;
		} catch (error) {
			mcpToolBundle = null;
			const message = error instanceof Error ? error.message.trim() : String(error);
			if (message.length > 0) {
				startWarnings = [`Failed to load MCP tools: ${message}`];
			}
		}
		this.replaceTaskMcpToolBundle(request.taskId, mcpToolBundle);
		const largeFileWorkflow = getNKleinLargeFileWorkflow(requestedSessionId, request.cwd);
		const artifactWorkspacePath = request.workspaceRoot?.trim() || request.cwd;
		const baseRequestToolApproval = request.requestToolApproval;
		const fileReadToolByTurn = new Map<string, { toolName: string; toolCallId: string }>();
		const approvedReadFilesRequestFingerprints = new Set<string>();
		const successfulReadFilesTargetKeys = new Set<string>();
		const successfulFullReadFilesPaths = new Set<string>();
		const approvalTurnKey = (approvalRequest: NKleinSdkToolApprovalRequest): string =>
			[
				approvalRequest.sessionId,
				approvalRequest.agentId,
				approvalRequest.conversationId,
				approvalRequest.iteration,
			].join(":");
		const requestToolApproval = baseRequestToolApproval
			? async (approvalRequest: NKleinSdkToolApprovalRequest): Promise<NKleinSdkToolApprovalResult> => {
					const turnKey = approvalTurnKey(approvalRequest);
					const claimedFileReadTool = fileReadToolByTurn.get(turnKey);
					// follow-up-6 §2.6: only serialize additional *content-read* tools within a turn (so a batch
					// read cannot fan out into another big read). Harmless discovery (list_files / find_files /
					// get_file_size) and edits/commands after a read are allowed, and the rejection text tells the
					// model to proceed with the already-shown result rather than "wait" (which it misread as a stall).
					const isContentReadTool =
						approvalRequest.toolName === "read_files" || approvalRequest.toolName === "read_large_file";
					if (
						claimedFileReadTool &&
						claimedFileReadTool.toolCallId !== approvalRequest.toolCallId &&
						isContentReadTool
					) {
						return {
							approved: false,
							reason: `Blocked ${approvalRequest.toolName}: this assistant turn already started ${claimedFileReadTool.toolName}. This tool call was rejected and read nothing; continue with the ${claimedFileReadTool.toolName} result already shown, or start another read in a later model request.`,
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
						const readTargetKeys = buildReadFilesTargetKeys(approvalRequest.input);
						const readRequestFingerprint = buildReadFilesRequestFingerprint(readTargetKeys);
						const repeatedReadTargetKeys = readTargetKeys.filter(
							(key) =>
								successfulReadFilesTargetKeys.has(key.rangeKey) ||
								(key.fullFile && successfulFullReadFilesPaths.has(key.path)),
						);
						if (readTargetKeys.length > 0 && repeatedReadTargetKeys.length === readTargetKeys.length) {
							return {
								approved: false,
								reason: `Blocked read_files: this exact file content was already read successfully in this task. Use the file content already in context, read only a focused line range if verbatim text was compacted away, make the needed edit, or run the acceptance command. No duplicate file content was read.`,
							};
						}
						if (readRequestFingerprint && approvedReadFilesRequestFingerprints.has(readRequestFingerprint)) {
							return {
								approved: false,
								reason: `Blocked read_files: this exact read_files request was already approved in this task. Use the file content already in context if the read succeeded, adjust the paths or line ranges if it failed, make the needed edit, or run the acceptance command. No duplicate file content was read.`,
							};
						}
						const approval = await baseRequestToolApproval(approvalRequest);
						if (approval.approved) {
							fileReadToolByTurn.set(turnKey, {
								toolName: approvalRequest.toolName,
								toolCallId: approvalRequest.toolCallId,
							});
							if (readRequestFingerprint) {
								approvedReadFilesRequestFingerprints.add(readRequestFingerprint);
							}
							if (readTargetKeys.length === 1) {
								for (const key of readTargetKeys) {
									successfulReadFilesTargetKeys.add(key.rangeKey);
									if (key.fullFile) {
										successfulFullReadFilesPaths.add(key.path);
									}
								}
							}
						}
						return approval;
					}
					const approval = await baseRequestToolApproval(approvalRequest);
					if (approval.approved && REPO_MAP_INVALIDATING_TOOL_NAMES.has(approvalRequest.toolName)) {
						approvedReadFilesRequestFingerprints.clear();
						successfulReadFilesTargetKeys.clear();
						successfulFullReadFilesPaths.clear();
					}
					return approval;
				}
			: undefined;
		const hasMcpExtraTools = Boolean(mcpToolBundle && mcpToolBundle.tools.length > 0);
		const useHostWorkspaceTools = !request.extraTools;
		const workspaceExtraTools =
			request.extraTools ??
			([
				...createNKleinRetrievalTools({
					workspacePath: request.cwd,
					embeddingProvider: request.codeEmbeddingProvider ?? createNKleinCodeEmbeddingProvider(),
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
				createEditFileTool({
					workspacePath: request.cwd,
					maxFileLines: request.maxAgentWritableFileLines,
				}),
			] satisfies AgentTool[]);
		const extraTools = [
			// Decomposition / board / plan tools are TRUSTED CONTROL-PLANE: they mutate only !Klein-owned
			// state (`~/.nklein/nklein` plan artifacts + the board via mutateWorkspaceState), never the user's
			// working tree or a shell. They therefore stay host-side even under strict Docker isolation
			// (J0 scope boundary: !Klein's own config/state file I/O is trusted runtime, not agent activity).
			// Keeping them available is what lets a sandboxed planning agent turn a 1-shot idea into a
			// Planning-lane DAG of cards. Data-plane file/shell/edit/patch/search stay sandboxed below.
			...createNKleinDecompositionTools({
				workspacePath: request.cwd,
				artifactWorkspacePath,
				sourceTaskId: request.taskId,
				onApplied: request.onDecompositionApplied,
			}),
			...workspaceExtraTools,
			...createWebResearchTool({
				enabled: CLOUD_ENABLED && useHostWorkspaceTools && process.env.KANBAN_ENABLE_WEB_RESEARCH === "1",
			}),
			// Second-opinion review turns get the structured `submit_review` verdict tool (todo §5.K). Only attached
			// when a verdict handler is provided, so ordinary worker/planning turns never see it.
			...(request.onReviewSubmitted ? [createNKleinReviewTool({ onSubmitted: request.onReviewSubmitted })] : []),
			...(mcpToolBundle?.tools ?? []),
		];

		const sessionHost = await this.ensureSessionHost();
		const userImages = toSdkUserImages(request.images);
		const shouldSendInitialTurn = request.prompt.trim().length > 0 || Boolean(userImages?.length);
		const sdkApiTimeoutMs = resolveSdkApiTimeoutMs(request.apiTimeoutMs);
		const compaction = buildNKleinContextCompactionConfig(request.contextWindow);
		const teamDelegation = resolveNKleinTeamDelegationPolicy({
			taskId: request.taskId,
			mode: resolvedMode,
		});
		const providerConfig: NonNullable<NKleinSdkStartSessionInput["config"]["providerConfig"]> = {
			providerId: request.providerId,
			modelId: request.modelId,
			...(request.apiKey?.trim() ? { apiKey: request.apiKey.trim() } : {}),
			...(request.baseUrl?.trim() ? { baseUrl: request.baseUrl.trim() } : {}),
			...(request.reasoningEffort === null
				? { reasoningEffort: "none" as NonNullable<NKleinSdkStartSessionInput["config"]["reasoningEffort"]> }
				: request.reasoningEffort
					? { reasoningEffort: request.reasoningEffort }
					: {}),
			...(sdkApiTimeoutMs ? { timeoutMs: sdkApiTimeoutMs } : {}),
		};
		const config: NKleinSdkStartSessionInput["config"] = {
			sessionId: requestedSessionId,
			providerId: request.providerId,
			modelId: request.modelId,
			apiKey: request.apiKey?.trim() || undefined,
			baseUrl: request.baseUrl?.trim() || undefined,
			reasoningEffort:
				request.reasoningEffort === null
					? ("none" as NKleinSdkStartSessionInput["config"]["reasoningEffort"])
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
				maxConsecutiveMistakes: DEFAULT_NKLEIN_MAX_CONSECUTIVE_MISTAKES,
			},
			onConsecutiveMistakeLimitReached: async (context) => {
				await recordSelfObservation({
					signal: "task_abandoned",
					severity: "warning",
					message: `!Klein stopped task ${request.taskId} after ${context.consecutiveMistakes}/${context.maxConsecutiveMistakes} consecutive ${context.reason} mistakes.`,
					taskId: request.taskId,
					providerId: request.providerId,
					modelId: request.modelId,
					workspacePath: request.cwd,
					metadata: {
						guardrail: "consecutive_mistake_limit",
						iteration: context.iteration,
						consecutiveMistakes: context.consecutiveMistakes,
						maxConsecutiveMistakes: context.maxConsecutiveMistakes,
						reason: context.reason,
						details: context.details ?? null,
					},
				});
				return {
					action: "stop",
					reason: "!Klein swarm guardrail stopped this task after repeated mistakes.",
				};
			},
			systemPrompt: request.systemPrompt,
		};
		let startResult: Awaited<ReturnType<NKleinSessionHostBoundary["start"]>>;
		try {
			// Hub-backed SDK hosts create the interactive session in start; the first turn runs through send.
			startResult = await sessionHost.start({
				config,
				initialMessages: request.initialMessages,
				interactive: true,
				localRuntime: {
					modelCatalogDefaults: NKLEIN_MODEL_CATALOG_DEFAULTS,
					extensions: [createKanbanContextFocusExtension(requestedSessionId, request.cwd, request.contextWindow)],
					...(request.userInstructionService ? { userInstructionService: request.userInstructionService } : {}),
					...(request.userInstructionService ? { configExtensions: ["skills"] } : {}),
					...(compaction ? { compaction: { ...compaction, compact: compactKanbanFocusedMessages } } : {}),
					logger: createKanbanNKleinLogger({
						runtime: "kanban",
						taskId: request.taskId,
						requestedSessionId,
						providerId: request.providerId,
						modelId: request.modelId,
					}),
					extraTools,
				},
				...(requestToolApproval || request.toolExecutors
					? {
							capabilities: {
								...(requestToolApproval ? { requestToolApproval } : {}),
								...(request.toolExecutors ? { toolExecutors: request.toolExecutors } : {}),
							},
						}
					: {}),
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

		await persistKanbanTitleToNKleinSessionMetadata(sessionHost, startResult.sessionId, request.taskTitle);
		await persistKanbanLaunchConfigToNKleinSessionMetadata(sessionHost, startResult.sessionId, request);

		return {
			sessionId: startResult.sessionId,
			result,
			...(startWarnings.length > 0 ? { warnings: startWarnings } : {}),
		};
	}

	async restartTaskSession(input: {
		taskId: string;
		prompt: string;
		initialMessages?: NKleinSdkPersistedMessage[];
		images?: RuntimeTaskImage[];
		mode?: RuntimeTaskSessionMode;
		launchConfigOverrides?: NKleinSessionLaunchConfigOverrides;
		onTeamEvent?: (event: NKleinSdkTeamEvent, teamName: string | null) => void;
	}): Promise<StartNKleinSessionRuntimeResult> {
		const lastStartRequest = this.lastStartRequestByTaskId.get(input.taskId);
		if (!lastStartRequest) {
			throw new Error(`No previous NKlein session config is available for task ${input.taskId}.`);
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
		launchConfigOverrides?: NKleinSessionLaunchConfigOverrides,
	): Promise<unknown> {
		const sessionId = this.sessionIdByTaskId.get(taskId);
		if (!sessionId) {
			throw new Error(`No active !Klein session for task ${taskId}.`);
		}
		const sessionHost = await this.ensureSessionHost();
		if (launchConfigOverrides) {
			if (this.requiresTaskSessionRestart(taskId, mode, launchConfigOverrides)) {
				throw new Error(
					"The active !Klein session must be restarted before applying the selected launch configuration.",
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
		launchConfigOverrides?: NKleinSessionLaunchConfigOverrides,
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

	async resumeTaskSession(taskId: string): Promise<NKleinPersistedTaskSessionSnapshot | null> {
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
			releaseNKleinLargeFileWorkflow(sessionId);
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

	async readPersistedTaskSession(taskId: string): Promise<NKleinPersistedTaskSessionSnapshot | null> {
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
		releaseAllNKleinLargeFileWorkflows();

		const mcpBundles = [...this.mcpToolBundleByTaskId.values()];
		this.mcpToolBundleByTaskId.clear();
		await Promise.all(
			mcpBundles.map(async (bundle) => {
				await bundle.dispose().catch(() => undefined);
			}),
		);
	}

	private replaceTaskMcpToolBundle(taskId: string, bundle: NKleinMcpToolBundle | null): void {
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
		sessionHost: NKleinSessionHostBoundary,
	): Promise<NKleinSdkSessionRecord | null> {
		const activeSessionId = this.sessionIdByTaskId.get(taskId);
		if (activeSessionId) {
			const activeRecord = (await sessionHost.get(activeSessionId)) ?? null;
			if (activeRecord) {
				return activeRecord;
			}
		}

		const sessionIdPrefix = buildSessionIdPrefix(taskId);
		const records: NKleinSdkSessionRecord[] = await sessionHost.list();
		const matchingRecord = records
			.filter((record: NKleinSdkSessionRecord) => record.sessionId.startsWith(sessionIdPrefix))
			.sort((left: NKleinSdkSessionRecord, right: NKleinSdkSessionRecord) => {
				const leftTimestamp = Date.parse(left.updatedAt || left.startedAt);
				const rightTimestamp = Date.parse(right.updatedAt || right.startedAt);
				return rightTimestamp - leftTimestamp;
			})[0];
		return matchingRecord ?? null;
	}

	private async ensureSessionHost(): Promise<NKleinSessionHostBoundary> {
		if (!this.sessionHostPromise) {
			this.sessionHostPromise = this.createSessionHost().then((sessionHost: NKleinSessionHostBoundary) => {
				sessionHost.subscribe((event: unknown) => {
					this.handleSessionEvent(event);
				});
				return sessionHost;
			});
		}
		return await this.sessionHostPromise;
	}

	private async updateActiveSessionModel(
		sessionHost: NKleinSessionHostBoundary,
		sessionId: string,
		modelId: string,
	): Promise<void> {
		await sessionHost.updateSessionModel?.(sessionId, modelId);
	}

	private updateLastStartRequestLaunchConfig(
		taskId: string,
		launchConfigOverrides: NKleinSessionLaunchConfigOverrides,
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
		const sessionId = extractNKleinSessionId(event);
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

export function createInMemoryNKleinSessionRuntime(
	options: CreateInMemoryNKleinSessionRuntimeOptions = {},
): NKleinSessionRuntime {
	return new InMemoryNKleinSessionRuntime(options);
}
