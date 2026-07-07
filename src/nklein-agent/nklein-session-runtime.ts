import {
	clearAllSessionFocusState,
	createKanbanContextFocusExtension,
	forgetSessionFocusState,
	recordSessionFocusChain,
} from "./nklein-context-focus-extension";
import { KANBAN_SESSION_METADATA_KEY, toPersistedLaunchConfig } from "./nklein-session-launch-config";
import { createTaskToolApprovalWrapper } from "./nklein-task-tool-approval";

export { doesNKleinToolInvalidateRepoMap } from "./nklein-context-focus-extension";
export {
	type NKleinPersistedLaunchConfig,
	readKanbanLaunchConfigFromSessionRecord,
} from "./nklein-session-launch-config";

// Owns the live SDK session host plus taskId to sessionId bindings.
// This is the runtime-facing layer for starting, looking up, resuming, and
// stopping native NKlein sessions without exposing SDK details upstream.

import {
	RUNTIME_NKLEIN_DEFAULT_CONTEXT_WINDOW_TOKENS,
	type RuntimeTaskImage,
	type RuntimeTaskSessionMode,
} from "../core/api-contract";
import { isTruthyEnv } from "../core/env-flag";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import { resolveNKleinAgentPerceivedCwd } from "./nklein-agent-sandbox";
import { createNKleinCodeEmbeddingProvider } from "./nklein-code-embeddings";
import { compactKanbanFocusedMessages } from "./nklein-context-focus-policy";
import { createNKleinDecompositionTools } from "./nklein-decomposition-tool";
import { createEditFileTool } from "./nklein-edit-file-tool";
import { extractNKleinSessionId } from "./nklein-event-adapter";
import { createFileDiscoveryTools } from "./nklein-file-discovery-tools";
import { createNKleinFocusChainTool } from "./nklein-focus-chain-tool";
import {
	createReadLargeFileTool,
	getNKleinLargeFileWorkflow,
	releaseAllNKleinLargeFileWorkflows,
	releaseNKleinLargeFileWorkflow,
} from "./nklein-large-file-workflow";
import { CLOUD_ENABLED } from "./nklein-local-only-policy";
import {
	createNKleinMcpRuntimeService,
	type NKleinMcpRuntimeService,
	type NKleinMcpToolBundle,
} from "./nklein-mcp-runtime-service";
import { createNKleinMergeResolutionTool } from "./nklein-merge-resolution-tool";
import { buildKanbanModelToolRoutingRules } from "./nklein-model-tool-routing";
import { createNKleinPlanCritiqueTool } from "./nklein-plan-critique-tool";
import { createNKleinPromotionTool } from "./nklein-promotion-tool";
import { createNKleinRetrievalTools } from "./nklein-retrieval-tools";
import { createNKleinReviewTool } from "./nklein-review-tool";
import { createKanbanNKleinLogger } from "./nklein-runtime-logger";
import { resolveContextWindowTokens, resolveSdkApiTimeoutMs, toSdkUserImages } from "./nklein-session-sdk-inputs";
import { buildSessionIdPrefix, createSessionId } from "./nklein-session-state";
import { resolveNKleinTeamDelegationPolicy } from "./nklein-team-delegation";
import { createWebResearchTool } from "./nklein-web-research-tool";
import { createWriteFilesTool, createWriteFileTool } from "./nklein-write-files-tool";
import type { AgentTool } from "./sdk-agent-types";
import { NKLEIN_MODEL_CATALOG_DEFAULTS } from "./sdk-provider-boundary";
import {
	createNKleinSdkSessionHost,
	type NKleinSdkPersistedMessage,
	type NKleinSdkSessionRecord,
	type NKleinSdkStartSessionInput,
	type NKleinSdkTeamEvent,
} from "./sdk-runtime-boundary";
import { createOpenAiCompatPhaseOnePickCaller } from "./two-phase-before-model";

export { NKLEIN_MODEL_CATALOG_DEFAULTS } from "./sdk-provider-boundary";

const DEFAULT_NKLEIN_MAX_CONSECUTIVE_MISTAKES = 3;
const NKLEIN_CONTEXT_COMPACTION_RESERVE_TOKENS = 16_384;
const NKLEIN_CONTEXT_COMPACTION_PRESERVE_RECENT_TOKENS = 20_000;
const NKLEIN_CONTEXT_COMPACTION_RESERVE_RATIO = 0.2;
const NKLEIN_CONTEXT_COMPACTION_PRESERVE_RECENT_RATIO = 0.25;

type NKleinSdkContextCompactionConfig = NonNullable<NKleinSdkStartSessionInput["config"]["compaction"]>;

import type {
	CreateInMemoryNKleinSessionRuntimeOptions,
	NKleinPersistedTaskSessionSnapshot,
	NKleinSessionHostBoundary,
	NKleinSessionLaunchConfigOverrides,
	NKleinSessionRuntime,
	StartNKleinSessionRuntimeRequest,
	StartNKleinSessionRuntimeResult,
} from "./nklein-session-runtime-types";

export type {
	CreateInMemoryNKleinSessionRuntimeOptions,
	NKleinPersistedTaskSessionSnapshot,
	NKleinSessionRuntime,
	StartNKleinSessionRuntimeRequest,
	StartNKleinSessionRuntimeResult,
} from "./nklein-session-runtime-types";

export function buildNKleinContextCompactionConfig(
	contextWindow: number | null | undefined,
): NKleinSdkContextCompactionConfig | undefined {
	const contextWindowTokens =
		resolveContextWindowTokens(contextWindow) ?? RUNTIME_NKLEIN_DEFAULT_CONTEXT_WINDOW_TOKENS;
	return {
		enabled: true,
		strategy: "basic",
		maxInputTokens: contextWindowTokens,
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
			maxTokensPerTurn: request.maxTokensPerTurn,
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
			mcpToolBundle = await this.nkleinMcpRuntimeService.createToolBundle({
				modelId: request.modelId,
				sandboxExecTarget: request.sandboxMcpExecTarget ?? null,
				...(request.basicMemoryExecEnv ? { basicMemoryExecEnv: request.basicMemoryExecEnv } : {}),
			});
			startWarnings = mcpToolBundle.warnings;
		} catch (error) {
			mcpToolBundle = null;
			const message = error instanceof Error ? error.message.trim() : String(error);
			if (message.length > 0) {
				startWarnings = [`Failed to load MCP tools: ${message}`];
			}
		}
		this.replaceTaskMcpToolBundle(request.taskId, mcpToolBundle);
		// The two distinct path concepts, named so a future surface can't silently pick the wrong one
		// (see the StartNKleinSessionRuntimeRequest field docs). `agentPerceivedCwd` is what the agent sees
		// (sandbox under isolation); `hostWorkspaceRoot` is the host path for trusted control-plane reads.
		const agentPerceivedCwd = request.cwd;
		const hostWorkspaceRoot = request.workspaceRoot?.trim() || request.cwd;
		const largeFileWorkflow = getNKleinLargeFileWorkflow(requestedSessionId, agentPerceivedCwd);
		const baseRequestToolApproval = request.requestToolApproval;
		const requestToolApproval = createTaskToolApprovalWrapper({
			baseRequestToolApproval,
			largeFileWorkflow,
			taskId: request.taskId,
			hostWorkspaceRoot,
			onCardPromoted: request.onCardPromoted,
		});
		const hasMcpExtraTools = Boolean(mcpToolBundle && mcpToolBundle.tools.length > 0);
		const useHostWorkspaceTools = !request.extraTools;
		const workspaceExtraTools =
			request.extraTools ??
			([
				...createNKleinRetrievalTools({
					workspacePath: agentPerceivedCwd,
					embeddingProvider: request.codeEmbeddingProvider ?? createNKleinCodeEmbeddingProvider(),
				}),
				...createFileDiscoveryTools({
					workspacePath: agentPerceivedCwd,
					contextWindow: request.contextWindow,
				}),
				createReadLargeFileTool({
					sessionId: requestedSessionId,
					workspacePath: agentPerceivedCwd,
					contextWindow: request.contextWindow,
				}),
				createWriteFilesTool({
					workspacePath: agentPerceivedCwd,
					maxFileLines: request.maxAgentWritableFileLines,
				}),
				createWriteFileTool({
					workspacePath: agentPerceivedCwd,
					maxFileLines: request.maxAgentWritableFileLines,
				}),
				createEditFileTool({
					workspacePath: agentPerceivedCwd,
					maxFileLines: request.maxAgentWritableFileLines,
				}),
			] satisfies AgentTool[]);
		// §5.AQ(e) ORDER INVARIANT: the tools array must be DETERMINISTIC, with the STABLE SHELL first (tools every
		// session kind gets, in a fixed order) and every CONDITIONALLY-ATTACHED tool appended at the TAIL. Serialized
		// tool schemas are part of the prompt bytes local endpoints prefix-cache, so a worker-vs-reviewer (etc.)
		// toolset must diverge only at the end — never interleave a conditional tool between the stable ones.
		const extraTools = [
			// ---- STABLE SHELL (attached for every session on this path, fixed relative order) ----
			// Decomposition / board / plan tools are TRUSTED CONTROL-PLANE: they mutate only !Klein-owned
			// state (`~/.nklein/nklein` plan artifacts + the board via mutateWorkspaceState), never the user's
			// working tree or a shell. They therefore stay host-side even under strict Docker isolation
			// (J0 scope boundary: !Klein's own config/state file I/O is trusted runtime, not agent activity).
			// Keeping them available is what lets a sandboxed planning agent turn a 1-shot idea into a
			// Planning-lane DAG of cards. Data-plane file/shell/edit/patch/search stay sandboxed below.
			...createNKleinDecompositionTools({
				// Host-side trusted control-plane: the plan artifacts + board mutations resolve against the
				// host workspace root, never the sandbox workdir (which doesn't exist on the host).
				workspacePath: hostWorkspaceRoot,
				sourceTaskId: request.taskId,
				onApplied: request.onDecompositionApplied,
				requestPlanCritique: request.requestPlanCritique,
			}),
			...workspaceExtraTools,
			...(mcpToolBundle?.tools ?? []),
			// ---- CONDITIONAL TAIL (config/kind-divergent tools only, slowest-churning gate first) ----
			...createWebResearchTool({
				enabled: CLOUD_ENABLED && useHostWorkspaceTools && process.env.KANBAN_ENABLE_WEB_RESEARCH === "1",
			}),
			// Planning/Refinement → In Progress promotion (todo §5.B). Trusted control-plane board mutation, so it
			// resolves against the host workspace root like the decomposition tools. Attached only when the service
			// wires `onCardPromoted` (work-card starts), so decompose/plan-mode and home/chat sessions never see it.
			...(request.onCardPromoted
				? [
						createNKleinPromotionTool({
							workspacePath: hostWorkspaceRoot,
							taskId: request.taskId,
							onPromoted: request.onCardPromoted,
						}),
					]
				: []),
			// Second-opinion review turns get the structured `submit_review` verdict tool (todo §5.K). Only attached
			// when a verdict handler is provided, so ordinary worker/planning turns never see it.
			...(request.onReviewSubmitted ? [createNKleinReviewTool({ onSubmitted: request.onReviewSubmitted })] : []),
			// W4.3 plan-critique turns get the structured `submit_plan_critique` verdict tool — same gating pattern.
			...(request.onPlanCritiqueSubmitted
				? [createNKleinPlanCritiqueTool({ onSubmitted: request.onPlanCritiqueSubmitted })]
				: []),
			// §5.AK `::merge` turns get the structured `submit_merge_resolution` verdict tool — same gating pattern.
			...(request.onMergeResolutionSubmitted
				? [createNKleinMergeResolutionTool({ onSubmitted: request.onMergeResolutionSubmitted })]
				: []),
			// Focus-chain checklist tool (todo §5.N): attached whenever the runtime wires a persistence handler.
			...(request.onFocusChainUpdated
				? [
						createNKleinFocusChainTool({
							// Capture the latest chain for beforeModel re-anchoring (todo §5.N), then forward to the runtime handler.
							onUpdated: (chain) => {
								recordSessionFocusChain(requestedSessionId, chain);
								return request.onFocusChainUpdated?.(chain);
							},
						}),
					]
				: []),
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
			// The agent's perceived working directory must be the in-container sandbox path (`/workspaces/<taskId>`),
			// never the host mount — see "agents must never see host details" (AGENTS.md). A task's tools execute in
			// that sandbox, so this is the logical cwd the model sees and writes paths relative to. Home/chat sessions
			// are not sandbox-backed, so they keep the host project cwd. Shared with the system-prompt working-dir
			// line via resolveNKleinAgentPerceivedCwd so the two never diverge.
			cwd: resolveNKleinAgentPerceivedCwd(request.taskId, agentPerceivedCwd),
			mode: resolvedMode,
			// W1.1a: per-turn output budget → the SDK gateway's max_tokens; absent ⇒ provider default (unchanged).
			...(typeof request.maxTokensPerTurn === "number" && request.maxTokensPerTurn > 0
				? { maxTokensPerTurn: Math.floor(request.maxTokensPerTurn) }
				: {}),
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
					// NOTE: preserves the prior value (the agent-perceived cwd) verbatim. Whether host-side
					// telemetry should instead key on `hostWorkspaceRoot` for stable per-workspace scoping is a
					// separate behavior question tracked in todo.md §5.U, not part of this rename.
					workspacePath: agentPerceivedCwd,
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
					extensions: [
						createKanbanContextFocusExtension(
							requestedSessionId,
							// The agent-perceived cwd keys the per-session large-file workflow state only.
							agentPerceivedCwd,
							// Host workspace root for orientation reads (repo map / git changes) — the sandbox workdir
							// doesn't exist on the host, which previously left the repo map silently empty.
							hostWorkspaceRoot,
							request.contextWindow,
							// §5.O opt-in two-phase tool narrowing: construct a phase-1 pick caller ONLY when the flag is set,
							// we have a local endpoint+model, AND this is a WORK-card session (`onCardPromoted`, like the
							// promotion tool above) — two-phase is a WORKER file-tool selector; on the architect/decompose,
							// plan-mode, or home/chat turn it is pure overhead (a wasted phase-1 round-trip whose card menu
							// doesn't fit `decompose_project` etc.) — a suspected cause of a stuck decompose in run44.
							isTruthyEnv(process.env.NKLEIN_TWO_PHASE_TOOL_PICK) &&
								request.baseUrl &&
								request.modelId &&
								request.onCardPromoted
								? createOpenAiCompatPhaseOnePickCaller({ baseUrl: request.baseUrl, modelId: request.modelId })
								: undefined,
						),
					],
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
			forgetSessionFocusState(sessionId);
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
		clearAllSessionFocusState();

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
