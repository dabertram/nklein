// Coordinates the runtime-side TRPC handlers used by the browser.
// This is the main backend entrypoint for sessions, settings, git, and
// workspace actions, but detailed Cline, terminal, and config behavior
// should stay in focused services instead of accumulating here.

import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { TRPCError } from "@trpc/server";
import { buildClineAdvisorRequest } from "../cline-sdk/cline-advisor";
import { getClineCodeIndexStatus } from "../cline-sdk/cline-code-index";
import { isClineContextWindowPolicyError } from "../cline-sdk/cline-context-window-policy";
import { writeClineDogfoodBacklog } from "../cline-sdk/cline-dogfood-engine";
import { scheduleClineEndpointStart } from "../cline-sdk/cline-endpoint-scheduler";
import { runClineDevSmokeEval } from "../cline-sdk/cline-eval-harness";
import {
	assertLocalProviderAllowed,
	isCloudProviderDisabledError,
	isLocalProvider,
} from "../cline-sdk/cline-local-only-policy";
import { createClineMcpRuntimeService } from "../cline-sdk/cline-mcp-runtime-service";
import { createClineMcpSettingsService } from "../cline-sdk/cline-mcp-settings-service";
import {
	buildClineModelRegistryKey,
	type ClineModelRegistryEntry,
	type ClineModelRegistryKeyInput,
	createClineModelRegistryEntry,
	getDefaultClineModelRegistry,
} from "../cline-sdk/cline-model-registry";
import { buildClineModelFreshnessAdvisorRequest } from "../cline-sdk/cline-model-research";
import { createClineProviderService } from "../cline-sdk/cline-provider-service";
import { buildClineRepoMap } from "../cline-sdk/cline-repo-map";
import { isClineClearSlashCommand } from "../cline-sdk/cline-slash-commands";
import { routeClineTask } from "../cline-sdk/cline-task-router";
import type { ClineTaskSessionService } from "../cline-sdk/cline-task-session-service";
import {
	buildClineStartGuardCandidate,
	type ClineStartGuardCandidate,
	estimateClineStartDifficulty,
	estimateClineStartFitBudgetTokens,
	estimateClineStartPromptTokens,
	formatClineTaskRoutingBlockMessage,
} from "../cline-sdk/cline-task-start-guard";
import { applyMcsrAwareLocalTimeoutScaling } from "../cline-sdk/cline-timeout-scaling";
import type { RuntimeConfigState } from "../config/runtime-config";
import { updateGlobalRuntimeConfig, updateRuntimeConfig } from "../config/runtime-config";
import type {
	RuntimeClineProviderSettings,
	RuntimeCommandRunResponse,
	RuntimeRunUpdateResponse,
	RuntimeTaskSessionSummary,
	RuntimeUpdateStatusResponse,
} from "../core/api-contract";
import {
	parseClineAccountSwitchRequest,
	parseClineAddProviderRequest,
	parseClineAdvisorBuildRequest,
	parseClineDeviceAuthCompleteRequest,
	parseClineDogfoodBacklogRequest,
	parseClineMcpOAuthRequest,
	parseClineMcpSettingsSaveRequest,
	parseClineOauthLoginRequest,
	parseClineProviderModelsRequest,
	parseClineProviderSettingsSaveRequest,
	parseClineUpdateProviderRequest,
	parseCommandRunRequest,
	parseRuntimeConfigSaveRequest,
	parseShellSessionStartRequest,
	parseTaskChatAbortRequest,
	parseTaskChatCancelRequest,
	parseTaskChatMessagesRequest,
	parseTaskChatReloadRequest,
	parseTaskChatSendRequest,
	parseTaskSessionInputRequest,
	parseTaskSessionStartRequest,
	parseTaskSessionStopRequest,
} from "../core/api-validation";
import { isHomeAgentSessionId } from "../core/home-agent-session";
import { clearSwarmStop, readSwarmStopSignal, requestSwarmStop } from "../core/swarm-guardrails";
import { resolveTaskTitle } from "../core/task-title.js";
import { openInBrowser } from "../server/browser";
import { readSelfObservationEvents } from "../telemetry/self-observation-sink";
import { buildRuntimeConfigResponse, resolveAgentCommand } from "../terminal/agent-registry";
import type { TerminalSessionManager } from "../terminal/session-manager";
import { resolveTaskCwd } from "../workspace/task-worktree";
import { captureTaskTurnCheckpoint } from "../workspace/turn-checkpoints";
import type { RuntimeTrpcContext, RuntimeTrpcWorkspaceScope } from "./app-router";
import type { RuntimeTaskStartQueue } from "./runtime-task-start-queue";

type ResolvedClineLaunchConfig = Awaited<
	ReturnType<ReturnType<typeof createClineProviderService>["resolveLaunchConfig"]>
>;

export interface CreateRuntimeApiDependencies {
	getActiveWorkspaceId: () => string | null;
	getActiveRuntimeConfig?: () => RuntimeConfigState;
	loadScopedRuntimeConfig: (scope: RuntimeTrpcWorkspaceScope) => Promise<RuntimeConfigState>;
	setActiveRuntimeConfig: (config: RuntimeConfigState) => void;
	getScopedTerminalManager: (scope: RuntimeTrpcWorkspaceScope) => Promise<TerminalSessionManager>;
	getScopedClineTaskSessionService: (scope: RuntimeTrpcWorkspaceScope) => Promise<ClineTaskSessionService>;
	getLoadedScopedClineTaskSessionService?: (scope: RuntimeTrpcWorkspaceScope) => ClineTaskSessionService | null;
	resolveInteractiveShellCommand: () => { binary: string; args: string[] };
	runCommand: (command: string, cwd: string) => Promise<RuntimeCommandRunResponse>;
	broadcastClineMcpAuthStatusesUpdated?: (
		statuses: Awaited<ReturnType<ReturnType<typeof createClineMcpRuntimeService>["getAuthStatuses"]>>,
	) => void;
	broadcastTaskChatCleared?: (workspaceId: string, taskId: string) => void;
	bumpClineSessionContextVersion?: () => void;
	prepareForStateReset?: () => Promise<void>;
	taskStartQueue?: RuntimeTaskStartQueue;
	getDogfoodTelemetryRoot?: () => string;
	getUpdateStatus: () => RuntimeUpdateStatusResponse;
	runUpdateNow: () => Promise<RuntimeRunUpdateResponse>;
}

async function resolveExistingTaskCwdOrEnsure(options: {
	cwd: string;
	taskId: string;
	baseRef: string;
}): Promise<string> {
	try {
		return await resolveTaskCwd({
			cwd: options.cwd,
			taskId: options.taskId,
			baseRef: options.baseRef,
			ensure: false,
		});
	} catch {
		return await resolveTaskCwd({
			cwd: options.cwd,
			taskId: options.taskId,
			baseRef: options.baseRef,
			ensure: true,
		});
	}
}

function getProfileTimeoutDefaults(profile: "cloud" | "local" | "custom"): {
	requestTimeoutMs: number | null;
	streamTimeoutMs: number | null;
	toolTimeoutMs: number | null;
	agentTimeoutMs: number | null;
	conversationTimeoutMs: number | null;
} {
	if (profile === "cloud" || profile === "local") {
		return {
			requestTimeoutMs: 60 * 60 * 1000,
			streamTimeoutMs: 24 * 60 * 60 * 1000,
			toolTimeoutMs: 24 * 60 * 60 * 1000,
			agentTimeoutMs: 24 * 60 * 60 * 1000,
			conversationTimeoutMs: 7 * 24 * 60 * 60 * 1000,
		};
	}
	return {
		requestTimeoutMs: null,
		streamTimeoutMs: null,
		toolTimeoutMs: null,
		agentTimeoutMs: null,
		conversationTimeoutMs: null,
	};
}

function scaleTimeoutMs(value: number | null, factor: number): number | null {
	if (value === null) {
		return null;
	}
	return Math.max(0, Math.trunc(value * factor));
}

const MIN_POSITIVE_CLINE_TIMEOUT_MS = 60 * 1000;

function enforceLocalClineTimeoutFloor(value: number | null): number | null {
	if (value === null || value === 0) {
		return value;
	}
	return Math.max(MIN_POSITIVE_CLINE_TIMEOUT_MS, value);
}

function resolveEffectiveTaskTimeoutSettings(input: {
	runtimeConfig: RuntimeConfigState;
	taskSettings?: {
		timeoutMode?: "normal" | "long" | "extended" | "unlimited";
		requestTimeoutMs?: number | null;
		streamTimeoutMs?: number | null;
		toolTimeoutMs?: number | null;
		agentTimeoutMs?: number | null;
		conversationTimeoutMs?: number | null;
	};
}): {
	timeoutMode: "normal" | "long" | "extended" | "unlimited";
	requestTimeoutMs: number | null;
	streamTimeoutMs: number | null;
	toolTimeoutMs: number | null;
	agentTimeoutMs: number | null;
	conversationTimeoutMs: number | null;
	timeoutProfile: "cloud" | "local" | "custom";
} {
	const timeoutProfile = input.runtimeConfig.agentTimeoutProfile;
	const timeoutMode = input.taskSettings?.timeoutMode ?? input.runtimeConfig.agentTimeoutMode;
	const profileDefaults = getProfileTimeoutDefaults(timeoutProfile);
	const requestTimeoutMs =
		input.taskSettings?.requestTimeoutMs ?? input.runtimeConfig.requestTimeoutMs ?? profileDefaults.requestTimeoutMs;
	const streamTimeoutMs =
		input.taskSettings?.streamTimeoutMs ?? input.runtimeConfig.streamTimeoutMs ?? profileDefaults.streamTimeoutMs;
	const toolTimeoutMs =
		input.taskSettings?.toolTimeoutMs ?? input.runtimeConfig.toolTimeoutMs ?? profileDefaults.toolTimeoutMs;
	const agentTimeoutMs =
		input.taskSettings?.agentTimeoutMs ?? input.runtimeConfig.agentTimeoutMs ?? profileDefaults.agentTimeoutMs;
	const conversationTimeoutMs =
		input.taskSettings?.conversationTimeoutMs ??
		input.runtimeConfig.conversationTimeoutMs ??
		profileDefaults.conversationTimeoutMs;

	if (timeoutMode === "unlimited") {
		return {
			timeoutMode,
			timeoutProfile,
			requestTimeoutMs: null,
			streamTimeoutMs: null,
			toolTimeoutMs: null,
			agentTimeoutMs: null,
			conversationTimeoutMs: null,
		};
	}

	const scale = timeoutMode === "extended" ? 6 : timeoutMode === "long" ? 3 : 1;
	return {
		timeoutMode,
		timeoutProfile,
		requestTimeoutMs: enforceLocalClineTimeoutFloor(scaleTimeoutMs(requestTimeoutMs, scale)),
		streamTimeoutMs: enforceLocalClineTimeoutFloor(scaleTimeoutMs(streamTimeoutMs, scale)),
		toolTimeoutMs: enforceLocalClineTimeoutFloor(scaleTimeoutMs(toolTimeoutMs, scale)),
		agentTimeoutMs: enforceLocalClineTimeoutFloor(scaleTimeoutMs(agentTimeoutMs, scale)),
		conversationTimeoutMs: enforceLocalClineTimeoutFloor(scaleTimeoutMs(conversationTimeoutMs, scale)),
	};
}

function isActiveProjectTaskSession(summary: RuntimeTaskSessionSummary): boolean {
	return (
		!isHomeAgentSessionId(summary.taskId) &&
		summary.state !== "idle" &&
		(summary.state === "running" || summary.state === "awaiting_review")
	);
}

function countActiveProjectTaskSessions(summaries: RuntimeTaskSessionSummary[], startingTaskId: string): number {
	const activeTaskIds = new Set<string>();
	for (const summary of summaries) {
		if (summary.taskId === startingTaskId || !isActiveProjectTaskSession(summary)) {
			continue;
		}
		activeTaskIds.add(summary.taskId);
	}
	return activeTaskIds.size;
}

function createConcurrencyLimitStartError(maxConcurrentTasks: number): string {
	return `Maximum concurrent task limit reached (${maxConcurrentTasks}). Wait for a running task to finish, or stop an active task before starting another.`;
}

function addConfiguredLocalModelRegistryEntries(input: {
	models: Record<string, ClineModelRegistryEntry>;
	runtimeConfig: RuntimeConfigState | null;
	launchConfig: ResolvedClineLaunchConfig | null;
	providerSettings: RuntimeClineProviderSettings | null;
	now: number;
}): Record<string, ClineModelRegistryEntry> {
	const nextModels = { ...input.models };
	const candidates: ClineModelRegistryKeyInput[] = [];
	if (input.launchConfig?.providerId && input.launchConfig.modelId) {
		candidates.push({
			providerId: input.launchConfig.providerId,
			modelId: input.launchConfig.modelId,
			endpoint: input.launchConfig.baseUrl ?? null,
		});
	}
	if (input.providerSettings?.providerId && input.providerSettings.modelId) {
		candidates.push({
			providerId: input.providerSettings.providerId,
			modelId: input.providerSettings.modelId,
			endpoint: input.providerSettings.baseUrl ?? null,
		});
	}
	for (const settings of Object.values(input.runtimeConfig?.modelRoles ?? {})) {
		const providerId = settings.providerId?.trim();
		const modelId = settings.modelId?.trim();
		if (!providerId || !modelId) {
			continue;
		}
		candidates.push({ providerId, modelId, endpoint: null });
	}
	for (const candidate of candidates) {
		if (!isLocalProvider(candidate.providerId, candidate.endpoint)) {
			continue;
		}
		const key = buildClineModelRegistryKey(candidate);
		if (nextModels[key]) {
			continue;
		}
		nextModels[key] = createClineModelRegistryEntry(candidate, input.now);
	}
	return nextModels;
}

function applyCandidateEffectiveContextWindow<TLaunchConfig extends ResolvedClineLaunchConfig>(
	launchConfig: TLaunchConfig,
	candidate: ClineStartGuardCandidate<TLaunchConfig>,
): TLaunchConfig {
	const effectiveContextWindow = candidate.entry.contextWindow.effective;
	if (
		typeof effectiveContextWindow !== "number" ||
		!Number.isFinite(effectiveContextWindow) ||
		effectiveContextWindow <= 0 ||
		launchConfig.contextWindow === effectiveContextWindow
	) {
		return launchConfig;
	}
	return {
		...launchConfig,
		contextWindow: effectiveContextWindow,
	};
}

export function createRuntimeApi(deps: CreateRuntimeApiDependencies): RuntimeTrpcContext["runtimeApi"] {
	const clineProviderService = createClineProviderService();
	const clineMcpSettingsService = createClineMcpSettingsService();
	const clineMcpRuntimeService = createClineMcpRuntimeService({
		onAuthStatusesChanged: (statuses) => {
			deps.broadcastClineMcpAuthStatusesUpdated?.(statuses);
		},
	});
	const debugResetTargetPaths = [
		join(homedir(), ".cline", "data"),
		join(homedir(), ".cline", "kanban"),
		join(homedir(), ".cline", "worktrees"),
	] as const;

	const buildConfigResponse = (runtimeConfig: RuntimeConfigState) =>
		buildRuntimeConfigResponse(runtimeConfig, clineProviderService.getProviderSettingsSummary());

	return {
		loadConfig: async (workspaceScope) => {
			const activeRuntimeConfig = deps.getActiveRuntimeConfig?.();
			if (!workspaceScope && !activeRuntimeConfig) {
				throw new Error("No active runtime config provider is available.");
			}
			let scopedRuntimeConfig: RuntimeConfigState;
			if (workspaceScope) {
				scopedRuntimeConfig = await deps.loadScopedRuntimeConfig(workspaceScope);
			} else if (activeRuntimeConfig) {
				scopedRuntimeConfig = activeRuntimeConfig;
			} else {
				throw new Error("No active runtime config provider is available.");
			}
			return buildConfigResponse(scopedRuntimeConfig);
		},
		saveConfig: async (workspaceScope, input) => {
			const parsed = parseRuntimeConfigSaveRequest(input);
			let nextRuntimeConfig: RuntimeConfigState;
			if (workspaceScope) {
				nextRuntimeConfig = await updateRuntimeConfig(workspaceScope.workspacePath, parsed);
			} else {
				const activeRuntimeConfig = deps.getActiveRuntimeConfig?.();
				if (!activeRuntimeConfig) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "No active runtime config is available.",
					});
				}
				nextRuntimeConfig = await updateGlobalRuntimeConfig(activeRuntimeConfig, parsed);
			}
			if (workspaceScope && workspaceScope.workspaceId === deps.getActiveWorkspaceId()) {
				deps.setActiveRuntimeConfig(nextRuntimeConfig);
			}
			if (!workspaceScope) {
				deps.setActiveRuntimeConfig(nextRuntimeConfig);
			}
			return buildConfigResponse(nextRuntimeConfig);
		},
		getSwarmStop: async (workspaceScope) => {
			return {
				ok: true,
				signal: await readSwarmStopSignal(workspaceScope.workspacePath),
			};
		},
		requestSwarmStop: async (workspaceScope, input) => {
			const signal = await requestSwarmStop({
				workspacePath: workspaceScope.workspacePath,
				reason: input.reason,
			});
			return {
				ok: true,
				signal,
			};
		},
		clearSwarmStop: async (workspaceScope) => {
			await clearSwarmStop(workspaceScope.workspacePath);
			return {
				ok: true,
				signal: null,
			};
		},
		getTaskDiagnostics: async (_workspaceScope, input) => {
			return {
				ok: true,
				events: await readSelfObservationEvents({
					taskId: input.taskId,
					limit: input.limit ?? 25,
				}),
			};
		},
		saveClineProviderSettings: async (_workspaceScope, input) => {
			const body = parseClineProviderSettingsSaveRequest(input);
			const response = await clineProviderService.saveProviderSettings(body);
			deps.bumpClineSessionContextVersion?.();
			return response;
		},
		addClineProvider: async (_workspaceScope, input) => {
			const body = parseClineAddProviderRequest(input);
			const response = await clineProviderService.addCustomProvider(body);
			deps.bumpClineSessionContextVersion?.();
			return response;
		},
		updateClineProvider: async (_workspaceScope, input) => {
			const body = parseClineUpdateProviderRequest(input);
			const response = await clineProviderService.updateCustomProvider(body);
			deps.bumpClineSessionContextVersion?.();
			return response;
		},
		startTaskSession: async (workspaceScope, input) => {
			try {
				const body = parseTaskSessionStartRequest(input);
				if (body.resumeFromTrash) {
					deps.broadcastTaskChatCleared?.(workspaceScope.workspaceId, body.taskId);
				}
				if (!isHomeAgentSessionId(body.taskId)) {
					const swarmStop = await readSwarmStopSignal(workspaceScope.workspacePath);
					if (swarmStop) {
						return {
							ok: false,
							summary: null,
							error: `Swarm stop signal is active: ${swarmStop.reason}`,
							errorCode: "swarm_stopped" as const,
						};
					}
				}
				const requestedClineTaskMode = body.mode ?? "act";
				const scopedRuntimeConfig = await deps.loadScopedRuntimeConfig(workspaceScope);
				const effectiveTimeouts = resolveEffectiveTaskTimeoutSettings({
					runtimeConfig: scopedRuntimeConfig,
					taskSettings: body.clineSettings,
				});
				const terminalManager = await deps.getScopedTerminalManager(workspaceScope);
				if (!isHomeAgentSessionId(body.taskId)) {
					const loadedClineTaskSessionService =
						deps.getLoadedScopedClineTaskSessionService?.(workspaceScope) ?? null;
					const activeProjectTaskCount = countActiveProjectTaskSessions(
						[...terminalManager.listSummaries(), ...(loadedClineTaskSessionService?.listSummaries() ?? [])],
						body.taskId,
					);
					if (activeProjectTaskCount >= scopedRuntimeConfig.maxConcurrentTasks) {
						return {
							ok: false,
							summary: null,
							error: createConcurrencyLimitStartError(scopedRuntimeConfig.maxConcurrentTasks),
						};
					}
				}
				const taskCwd = isHomeAgentSessionId(body.taskId)
					? workspaceScope.workspacePath
					: await resolveExistingTaskCwdOrEnsure({
							cwd: workspaceScope.workspacePath,
							taskId: body.taskId,
							baseRef: body.baseRef,
						});
				const shouldCaptureTurnCheckpoint = !body.resumeFromTrash && !isHomeAgentSessionId(body.taskId);

				// Per-task config source-of-truth precedence:
				//
				// agentId resolution (which agent runtime to use):
				//   1. previousTerminalAgentId — persisted in the terminal session summary from
				//      the last run; ensures trash-restore resumes with the same agent runtime.
				//   2. body.agentId — the card's current per-task agent override.
				//   3. scopedRuntimeConfig.selectedAgentId — the workspace-level default.
				//
				// clineSettings (which LLM model and reasoning profile the Cline agent uses):
				//   Always taken from the card's current override object. There is no
				//   session-level persistence for these;
				//   if the user changes the model on the card, the next session launch
				//   (including trash-restore) uses the updated values.
				const previousTerminalAgentId = body.resumeFromTrash
					? (terminalManager.getSummary(body.taskId)?.agentId ?? null)
					: null;
				const effectiveAgentId = previousTerminalAgentId ?? body.agentId ?? scopedRuntimeConfig.selectedAgentId;
				let useClinePath = effectiveAgentId === "cline";
				const shouldProbePersistedClineSession =
					body.resumeFromTrash && !useClinePath && previousTerminalAgentId === null;
				if (shouldProbePersistedClineSession) {
					// If the terminal summary already has a concrete non-Cline agentId,
					// skip Cline persisted-session probing. That probe can cold-start the
					// Cline session host and adds multi-second latency to Codex restores.
					const clineTaskSessionService = await deps.getScopedClineTaskSessionService(workspaceScope);
					const persistedSession = await clineTaskSessionService
						.rebindPersistedTaskSession(body.taskId)
						.catch(() => null);
					if (persistedSession) {
						useClinePath = true;
					}
				}

				if (useClinePath) {
					const hasTaskLevelClineSettingsOverride = body.clineSettings !== undefined;
					let clineLaunchConfig = await clineProviderService.resolveLaunchConfig({
						providerIdOverride: body.clineSettings?.providerId ?? undefined,
						modelIdOverride: body.clineSettings?.modelId ?? undefined,
						...(hasTaskLevelClineSettingsOverride
							? {
									reasoningEffortOverride: body.clineSettings?.reasoningEffort ?? null,
								}
							: {}),
					});
					const clineTaskSessionService = await deps.getScopedClineTaskSessionService(workspaceScope);
					const modelRegistrySnapshot = await Promise.resolve(getDefaultClineModelRegistry().getSnapshot()).catch(
						() => ({
							schemaVersion: 1,
							updatedAt: 0,
							models: {},
						}),
					);
					const guardCandidates = new Map<string, ClineStartGuardCandidate<ResolvedClineLaunchConfig>>();
					const selectedCandidate = buildClineStartGuardCandidate({
						launchConfig: clineLaunchConfig,
						role: null,
						modelRegistry: modelRegistrySnapshot,
					});
					clineLaunchConfig = applyCandidateEffectiveContextWindow(clineLaunchConfig, selectedCandidate);
					guardCandidates.set(selectedCandidate.entry.key, selectedCandidate);
					for (const [role, settings] of Object.entries(scopedRuntimeConfig.modelRoles)) {
						if (!settings.providerId && !settings.modelId) {
							continue;
						}
						try {
							const roleLaunchConfig = await clineProviderService.resolveLaunchConfig({
								providerIdOverride: settings.providerId ?? undefined,
								modelIdOverride: settings.modelId ?? undefined,
								reasoningEffortOverride: settings.reasoningEffort ?? null,
							});
							const roleCandidate = buildClineStartGuardCandidate({
								launchConfig: roleLaunchConfig,
								role,
								modelRegistry: modelRegistrySnapshot,
							});
							guardCandidates.set(roleCandidate.entry.key, roleCandidate);
						} catch (error) {
							if (isClineContextWindowPolicyError(error)) {
								return {
									ok: false,
									summary: null,
									error: error.message,
									errorCode: "routing_escalation",
								};
							}
							// Ignore roles that are not currently runnable; the configured default still participates.
						}
					}
					const promptTokens = estimateClineStartPromptTokens({
						prompt: body.prompt,
						taskTitle: body.taskTitle,
						images: body.images,
					});
					const largestContextWindow =
						[...guardCandidates.values()]
							.map((candidate) => candidate.entry.contextWindow.effective ?? 0)
							.filter((contextWindow) => contextWindow > 0)
							.sort((left, right) => right - left)[0] ?? null;
					const routingDecision = routeClineTask({
						difficulty: estimateClineStartDifficulty(promptTokens),
						fitBudgetTokens: estimateClineStartFitBudgetTokens(promptTokens, largestContextWindow),
						promptTokens,
						outputTokens: 1_000,
						preferredModelKey: selectedCandidate.entry.key,
						candidates: [...guardCandidates.values()].map((candidate) => ({
							entry: candidate.entry,
							role: candidate.role,
						})),
					});
					if (routingDecision.type === "decompose" || routingDecision.type === "escalate") {
						return {
							ok: false,
							summary: null,
							error: formatClineTaskRoutingBlockMessage(routingDecision),
							errorCode: routingDecision.type === "decompose" ? "needs_decomposition" : "routing_escalation",
						};
					}
					const routedCandidate = guardCandidates.get(routingDecision.modelKey) ?? null;
					if (routedCandidate) {
						clineLaunchConfig = applyCandidateEffectiveContextWindow(
							routedCandidate.launchConfig,
							routedCandidate,
						);
					}
					assertLocalProviderAllowed({
						providerId: clineLaunchConfig.providerId,
						baseUrl: clineLaunchConfig.baseUrl,
					});
					const mcsrAwareTimeouts = applyMcsrAwareLocalTimeoutScaling({
						timeouts: effectiveTimeouts,
						launchConfig: clineLaunchConfig,
						modelRegistry: modelRegistrySnapshot,
						promptTokens,
					});
					const endpointDecision = scheduleClineEndpointStart({
						taskId: body.taskId,
						providerId: clineLaunchConfig.providerId,
						modelId: clineLaunchConfig.modelId ?? "",
						endpoint: clineLaunchConfig.baseUrl ?? null,
						runningSessions: clineTaskSessionService.listModelEndpointSessions(),
						modelRegistry: modelRegistrySnapshot,
						now: Date.now(),
					});
					if (!endpointDecision.ok) {
						if (body.queueOnEndpointBusy) {
							deps.taskStartQueue?.enqueue({
								workspaceScope,
								request: body,
								delayMs: endpointDecision.estimatedWaitMs,
								error: endpointDecision.reason,
							});
						}
						return {
							ok: false,
							summary: null,
							error: `${endpointDecision.reason} Wait for task "${endpointDecision.blockedByTaskId}" to finish, or choose a different model endpoint.`,
							errorCode: "endpoint_busy",
							retryAfterMs: endpointDecision.estimatedWaitMs,
							queued: body.queueOnEndpointBusy ? true : undefined,
						};
					}
					deps.taskStartQueue?.remove(workspaceScope.workspaceId, body.taskId);
					const resolvedClineTitle = resolveTaskTitle(body.taskTitle?.trim(), body.prompt);
					const summary = await clineTaskSessionService.startTaskSession({
						taskId: body.taskId,
						cwd: taskCwd,
						prompt: body.prompt,
						taskTitle: resolvedClineTitle.length > 0 ? resolvedClineTitle : undefined,
						images: body.images,
						resumeFromTrash: body.resumeFromTrash,
						providerId: clineLaunchConfig.providerId,
						modelId: clineLaunchConfig.modelId,
						mode: requestedClineTaskMode,
						startInPlanMode: body.startInPlanMode,
						apiKey: clineLaunchConfig.apiKey,
						baseUrl: clineLaunchConfig.baseUrl,
						reasoningEffort: clineLaunchConfig.reasoningEffort,
						contextScope: body.clineSettings?.contextScope,
						contextWindow: clineLaunchConfig.contextWindow ?? null,
						timeoutMode: mcsrAwareTimeouts.timeoutMode,
						requestTimeoutMs: mcsrAwareTimeouts.requestTimeoutMs,
						turnTimeoutMs: mcsrAwareTimeouts.agentTimeoutMs,
						streamTimeoutMs: mcsrAwareTimeouts.streamTimeoutMs,
						toolTimeoutMs: mcsrAwareTimeouts.toolTimeoutMs,
						conversationTimeoutMs: mcsrAwareTimeouts.conversationTimeoutMs,
						maxAgentWritableFileLines: scopedRuntimeConfig.maxAgentWritableFileLines,
					});

					let nextSummary = summary;
					if (shouldCaptureTurnCheckpoint) {
						try {
							const nextTurn = (summary.latestTurnCheckpoint?.turn ?? 0) + 1;
							const checkpoint = await captureTaskTurnCheckpoint({
								cwd: taskCwd,
								taskId: body.taskId,
								turn: nextTurn,
							});
							nextSummary = clineTaskSessionService.applyTurnCheckpoint(body.taskId, checkpoint) ?? summary;
						} catch {
							// Best effort checkpointing only.
						}
					}

					return {
						ok: true,
						summary: nextSummary,
					};
				}

				const resolvedConfig =
					effectiveAgentId !== scopedRuntimeConfig.selectedAgentId
						? { ...scopedRuntimeConfig, selectedAgentId: effectiveAgentId }
						: scopedRuntimeConfig;
				const resolved = resolveAgentCommand(resolvedConfig);
				if (!resolved) {
					return {
						ok: false,
						summary: null,
						error: "No runnable agent command is configured. Open Settings, install a supported CLI, and select it.",
					};
				}
				const summary = await terminalManager.startTaskSession({
					taskId: body.taskId,
					agentId: resolved.agentId,
					binary: resolved.binary,
					args: resolved.args,
					autonomousModeEnabled: scopedRuntimeConfig.agentAutonomousModeEnabled,
					cwd: taskCwd,
					prompt: body.prompt,
					images: body.images,
					startInPlanMode: body.startInPlanMode,
					resumeFromTrash: body.resumeFromTrash,
					cols: body.cols,
					rows: body.rows,
					workspaceId: workspaceScope.workspaceId,
				});

				let nextSummary = summary;
				if (shouldCaptureTurnCheckpoint) {
					try {
						const nextTurn = (summary.latestTurnCheckpoint?.turn ?? 0) + 1;
						const checkpoint = await captureTaskTurnCheckpoint({
							cwd: taskCwd,
							taskId: body.taskId,
							turn: nextTurn,
						});
						nextSummary = terminalManager.applyTurnCheckpoint(body.taskId, checkpoint) ?? summary;
					} catch {
						// Best effort checkpointing only.
					}
				}
				return {
					ok: true,
					summary: nextSummary,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					summary: null,
					error: message,
					...(isCloudProviderDisabledError(error) ? { errorCode: "cloud_provider_disabled" as const } : {}),
				};
			}
		},
		stopTaskSession: async (workspaceScope, input) => {
			try {
				const body = parseTaskSessionStopRequest(input);
				const clineTaskSessionService = await deps.getScopedClineTaskSessionService(workspaceScope);
				const clineSummary = await clineTaskSessionService.stopTaskSession(body.taskId);
				if (clineSummary) {
					return {
						ok: true,
						summary: clineSummary,
					};
				}
				const terminalManager = await deps.getScopedTerminalManager(workspaceScope);
				const summary = terminalManager.stopTaskSession(body.taskId);
				return {
					ok: Boolean(summary),
					summary,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					summary: null,
					error: message,
				};
			}
		},
		sendTaskSessionInput: async (workspaceScope, input) => {
			try {
				const body = parseTaskSessionInputRequest(input);
				const payloadText = body.appendNewline ? `${body.text}\n` : body.text;
				const clineTaskSessionService = await deps.getScopedClineTaskSessionService(workspaceScope);
				const clineSummary = await clineTaskSessionService.sendTaskSessionInput(body.taskId, payloadText);
				if (clineSummary) {
					return {
						ok: true,
						summary: clineSummary,
					};
				}
				const terminalManager = await deps.getScopedTerminalManager(workspaceScope);
				const summary = terminalManager.writeInput(body.taskId, Buffer.from(payloadText, "utf8"));
				if (!summary) {
					return {
						ok: false,
						summary: null,
						error: "Task session is not running.",
					};
				}
				return {
					ok: true,
					summary,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					summary: null,
					error: message,
				};
			}
		},
		getTaskChatMessages: async (workspaceScope, input) => {
			try {
				const body = parseTaskChatMessagesRequest(input);
				const clineTaskSessionService = await deps.getScopedClineTaskSessionService(workspaceScope);
				const summary = clineTaskSessionService.getSummary(body.taskId);
				const messages = await clineTaskSessionService.loadTaskSessionMessages(body.taskId);
				if (!summary && messages.length === 0) {
					return {
						ok: false,
						messages: [],
						error: "Task chat session is not available.",
					};
				}
				return {
					ok: true,
					messages,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					messages: [],
					error: message,
				};
			}
		},
		getClineSlashCommands: async (workspaceScope) => {
			if (!workspaceScope) {
				return {
					commands: [],
				};
			}
			const clineTaskSessionService = await deps.getScopedClineTaskSessionService(workspaceScope);
			return {
				commands: await clineTaskSessionService.listSlashCommands(workspaceScope.workspacePath),
			};
		},
		reloadTaskChatSession: async (workspaceScope, input) => {
			try {
				const body = parseTaskChatReloadRequest(input);
				const clineTaskSessionService = await deps.getScopedClineTaskSessionService(workspaceScope);
				let summary = await clineTaskSessionService.reloadTaskSession(body.taskId);
				if (!summary && isHomeAgentSessionId(body.taskId)) {
					const clineLaunchConfig = await clineProviderService.resolveLaunchConfig();
					summary = await clineTaskSessionService.startTaskSession({
						taskId: body.taskId,
						cwd: workspaceScope.workspacePath,
						prompt: "",
						resumeFromPersistence: true,
						providerId: clineLaunchConfig.providerId,
						modelId: clineLaunchConfig.modelId,
						apiKey: clineLaunchConfig.apiKey,
						baseUrl: clineLaunchConfig.baseUrl,
						reasoningEffort: clineLaunchConfig.reasoningEffort,
						contextWindow: clineLaunchConfig.contextWindow ?? null,
					});
				}
				if (!summary) {
					return {
						ok: false,
						summary: null,
						error: "Task chat session is not available.",
					};
				}
				return {
					ok: true,
					summary,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					summary: null,
					error: message,
				};
			}
		},
		abortTaskChatTurn: async (workspaceScope, input) => {
			try {
				const body = parseTaskChatAbortRequest(input);
				const clineTaskSessionService = await deps.getScopedClineTaskSessionService(workspaceScope);
				const summary = await clineTaskSessionService.abortTaskSession(body.taskId);
				if (!summary) {
					return {
						ok: false,
						summary: null,
						error: "Task chat session is not running.",
					};
				}
				return {
					ok: true,
					summary,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					summary: null,
					error: message,
				};
			}
		},
		cancelTaskChatTurn: async (workspaceScope, input) => {
			try {
				const body = parseTaskChatCancelRequest(input);
				const clineTaskSessionService = await deps.getScopedClineTaskSessionService(workspaceScope);
				const summary = await clineTaskSessionService.cancelTaskTurn(body.taskId);
				if (!summary) {
					return {
						ok: false,
						summary: null,
						error: "Task chat session turn is not running.",
					};
				}
				return {
					ok: true,
					summary,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					summary: null,
					error: message,
				};
			}
		},
		getClineProviderCatalog: async (_workspaceScope) => {
			return await clineProviderService.getProviderCatalog();
		},
		getClineAccountProfile: async (_workspaceScope) => {
			return await clineProviderService.getClineAccountProfile();
		},
		getClineKanbanAccess: async (_workspaceScope) => {
			return await clineProviderService.getClineKanbanAccess();
		},
		getFeaturebaseToken: async (_workspaceScope) => {
			return await clineProviderService.getFeaturebaseToken();
		},
		getClineAccountBalance: async (_workspaceScope) => {
			return await clineProviderService.getClineAccountBalance();
		},
		getClineAccountOrganizations: async (_workspaceScope) => {
			return await clineProviderService.getClineAccountOrganizations();
		},
		switchClineAccount: async (_workspaceScope, input) => {
			const body = parseClineAccountSwitchRequest(input);
			return await clineProviderService.switchClineAccount(body.organizationId);
		},
		getClineProviderModels: async (_workspaceScope, input) => {
			const body = parseClineProviderModelsRequest(input);
			return await clineProviderService.getProviderModels(body.providerId);
		},
		getClineModelRegistry: async (workspaceScope) => {
			const snapshot = await getDefaultClineModelRegistry().getSnapshot();
			const runtimeConfig = workspaceScope ? await deps.loadScopedRuntimeConfig(workspaceScope) : null;
			const launchConfig =
				runtimeConfig?.selectedAgentId === "cline"
					? await clineProviderService.resolveLaunchConfig().catch(() => null)
					: null;
			const providerSettings =
				runtimeConfig?.selectedAgentId === "cline" ? clineProviderService.getProviderSettingsSummary() : null;
			const models = addConfiguredLocalModelRegistryEntries({
				models: snapshot.models,
				runtimeConfig,
				launchConfig,
				providerSettings,
				now: Date.now(),
			});
			return {
				schemaVersion: snapshot.schemaVersion,
				updatedAt: snapshot.updatedAt,
				models: Object.values(models)
					.filter((entry) => isLocalProvider(entry.providerId, entry.endpoint))
					.sort((left, right) => {
						const updatedDelta = right.updatedAt - left.updatedAt;
						return updatedDelta !== 0 ? updatedDelta : left.key.localeCompare(right.key);
					}),
			};
		},
		getClineCodeIntelligenceStatus: async (workspaceScope) => {
			if (!workspaceScope) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "A workspace is required to inspect code intelligence status.",
				});
			}
			const [repoMapResult, codeIndexResult] = await Promise.allSettled([
				buildClineRepoMap({ workspacePath: workspaceScope.workspacePath }),
				getClineCodeIndexStatus({ workspacePath: workspaceScope.workspacePath }),
			]);
			const repoMap =
				repoMapResult.status === "fulfilled"
					? {
							filesScanned: repoMapResult.value.filesScanned,
							symbols: repoMapResult.value.symbols.length,
							tokenCount: repoMapResult.value.tokenCount,
							truncated: repoMapResult.value.truncated,
							available: repoMapResult.value.symbols.length > 0,
							error: null,
						}
					: {
							filesScanned: 0,
							symbols: 0,
							tokenCount: 0,
							truncated: false,
							available: false,
							error:
								repoMapResult.reason instanceof Error
									? repoMapResult.reason.message
									: String(repoMapResult.reason),
						};
			const codeIndex =
				codeIndexResult.status === "fulfilled"
					? {
							...codeIndexResult.value,
							error: null,
						}
					: {
							cachePath: null,
							cacheExists: false,
							embeddingProvider: null,
							embeddingModel: null,
							updatedAt: null,
							totalFiles: 0,
							totalChunks: 0,
							indexedFiles: 0,
							indexedChunks: 0,
							staleFiles: 0,
							missingFiles: 0,
							searchAvailable: false,
							error:
								codeIndexResult.reason instanceof Error
									? codeIndexResult.reason.message
									: String(codeIndexResult.reason),
						};
			return { repoMap, codeIndex };
		},
		buildClineModelFreshnessAdvisor: async (_workspaceScope) => {
			return await buildClineModelFreshnessAdvisorRequest();
		},
		buildClineAdvisor: async (workspaceScope, input) => {
			const body = parseClineAdvisorBuildRequest(input);
			if (body.kind === "model_freshness") {
				return await buildClineModelFreshnessAdvisorRequest();
			}
			return buildClineAdvisorRequest(body.kind, {
				workspacePath: workspaceScope?.workspacePath,
				repoSummary: body.repoSummary,
				modelRegistrySummary: body.modelRegistrySummary,
				runtimeConfigSummary: body.runtimeConfigSummary,
				telemetrySummary: body.telemetrySummary,
				taskSummary: body.taskSummary,
				userQuestion: body.userQuestion,
			});
		},
		writeClineDogfoodBacklog: async (workspaceScope, input) => {
			if (!workspaceScope) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "A workspace is required to write dogfood backlog artifacts.",
				});
			}
			const body = parseClineDogfoodBacklogRequest(input);
			const artifacts = await writeClineDogfoodBacklog({
				workspacePath: workspaceScope.workspacePath,
				telemetryRootDir: deps.getDogfoodTelemetryRoot?.() ?? join(homedir(), ".cline", "kanban", "telemetry"),
				slug: body.slug,
				userSuggestions: body.suggestion?.trim() ? [body.suggestion] : undefined,
			});
			return {
				rootPath: artifacts.rootPath,
				specPath: artifacts.specPath,
				planPath: artifacts.planPath,
				questionsPath: artifacts.questionsPath,
				decisionsPath: artifacts.decisionsPath,
				revisionsPath: artifacts.revisionsPath,
				summaryPath: artifacts.summaryPath,
				taskGraphPath: artifacts.taskGraphPath,
				slug: artifacts.taskGraph.slug,
				taskCount: artifacts.taskGraph.tasks.length,
				nextCommand: `kanban task decompose --slug ${artifacts.taskGraph.slug} --project-path ${workspaceScope.workspacePath}`,
			};
		},
		runClineSmokeEval: async (_workspaceScope) => {
			const launchConfig = await clineProviderService.resolveLaunchConfig();
			const modelId = launchConfig.modelId?.trim() || "unknown";
			const result = await runClineDevSmokeEval({
				modelObservation: {
					providerId: launchConfig.providerId,
					modelId,
					endpoint: launchConfig.baseUrl ?? null,
				},
			});
			return {
				...result,
				providerId: launchConfig.providerId,
				modelId,
				endpoint: launchConfig.baseUrl ?? null,
			};
		},
		getClineMcpAuthStatuses: async (_workspaceScope) => {
			const statuses = await clineMcpRuntimeService.getAuthStatuses();
			return {
				statuses,
			};
		},
		runClineMcpServerOAuth: async (_workspaceScope, input) => {
			const body = parseClineMcpOAuthRequest(input);
			const response = await clineMcpRuntimeService.authorizeServer({
				serverName: body.serverName,
				onAuthorizationUrl: (url: string) => {
					openInBrowser(url);
				},
			});
			deps.bumpClineSessionContextVersion?.();
			return response;
		},
		getClineMcpSettings: async (_workspaceScope) => {
			return clineMcpSettingsService.loadSettings();
		},
		saveClineMcpSettings: async (_workspaceScope, input) => {
			const body = parseClineMcpSettingsSaveRequest(input);
			const response = await clineMcpSettingsService.saveSettings(body);
			deps.bumpClineSessionContextVersion?.();
			return response;
		},
		runClineProviderOAuthLogin: async (_workspaceScope, input) => {
			const body = parseClineOauthLoginRequest(input);
			const response = await clineProviderService.runOauthLogin({
				providerId: body.provider,
				baseUrl: body.baseUrl,
			});
			if (response.ok) {
				deps.bumpClineSessionContextVersion?.();
			}
			return response;
		},
		startClineDeviceAuth: async () => {
			return await clineProviderService.startDeviceAuth();
		},
		completeClineDeviceAuth: async (_workspaceScope, input) => {
			const body = parseClineDeviceAuthCompleteRequest(input);
			const response = await clineProviderService.completeDeviceAuth({
				deviceCode: body.deviceCode,
				expiresInSeconds: body.expiresInSeconds,
				pollIntervalSeconds: body.pollIntervalSeconds,
				baseUrl: body.baseUrl,
			});
			if (response.ok) {
				deps.bumpClineSessionContextVersion?.();
			}
			return response;
		},
		sendTaskChatMessage: async (workspaceScope, input) => {
			try {
				const body = parseTaskChatSendRequest(input);
				const clineTaskSessionService = await deps.getScopedClineTaskSessionService(workspaceScope);
				const providerIdOverride = body.providerId?.trim() || undefined;
				const modelIdOverride = body.modelId?.trim() || undefined;
				const hasReasoningEffortOverride = Object.hasOwn(body, "reasoningEffort");
				const launchConfigOverrides =
					providerIdOverride || modelIdOverride || hasReasoningEffortOverride
						? await clineProviderService.resolveLaunchConfig({
								providerIdOverride,
								modelIdOverride,
								...(hasReasoningEffortOverride
									? { reasoningEffortOverride: body.reasoningEffort ?? null }
									: {}),
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
				if (isClineClearSlashCommand(body.text)) {
					const summary = await clineTaskSessionService.clearTaskSession(body.taskId);
					deps.broadcastTaskChatCleared?.(workspaceScope.workspaceId, body.taskId);
					return {
						ok: true,
						summary,
						message: null,
					};
				}
				const requestedMode = body.mode;
				let summary = sessionLaunchConfigOverrides
					? await clineTaskSessionService.sendTaskSessionInput(
							body.taskId,
							body.text,
							requestedMode,
							body.images,
							sessionLaunchConfigOverrides,
						)
					: await clineTaskSessionService.sendTaskSessionInput(body.taskId, body.text, requestedMode, body.images);
				if (!summary) {
					if (!isHomeAgentSessionId(body.taskId)) {
						const reboundSummary = await clineTaskSessionService.rebindPersistedTaskSession(body.taskId);
						if (reboundSummary) {
							const clineLaunchConfig =
								launchConfigOverrides ?? (await clineProviderService.resolveLaunchConfig());
							summary = await clineTaskSessionService.startTaskSession({
								taskId: body.taskId,
								cwd: reboundSummary.workspacePath ?? workspaceScope.workspacePath,
								prompt: body.text,
								images: body.images,
								resumeFromPersistence: true,
								providerId: clineLaunchConfig.providerId,
								modelId: clineLaunchConfig.modelId,
								mode: requestedMode,
								apiKey: clineLaunchConfig.apiKey,
								baseUrl: clineLaunchConfig.baseUrl,
								reasoningEffort: clineLaunchConfig.reasoningEffort,
								contextWindow: clineLaunchConfig.contextWindow ?? null,
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
						const clineLaunchConfig = launchConfigOverrides ?? (await clineProviderService.resolveLaunchConfig());
						summary = await clineTaskSessionService.startTaskSession({
							taskId: body.taskId,
							cwd: workspaceScope.workspacePath,
							prompt: body.text,
							images: body.images,
							resumeFromPersistence: true,
							providerId: clineLaunchConfig.providerId,
							modelId: clineLaunchConfig.modelId,
							mode: requestedMode,
							apiKey: clineLaunchConfig.apiKey,
							baseUrl: clineLaunchConfig.baseUrl,
							reasoningEffort: clineLaunchConfig.reasoningEffort,
							contextWindow: clineLaunchConfig.contextWindow ?? null,
						});
					}
				}
				const latestMessage = clineTaskSessionService.listMessages(body.taskId).at(-1) ?? null;
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
		},
		startShellSession: async (workspaceScope, input) => {
			try {
				const body = parseShellSessionStartRequest(input);
				const terminalManager = await deps.getScopedTerminalManager(workspaceScope);
				const shell = deps.resolveInteractiveShellCommand();
				const shellCwd = body.workspaceTaskId
					? await resolveTaskCwd({
							cwd: workspaceScope.workspacePath,
							taskId: body.workspaceTaskId,
							baseRef: body.baseRef,
							ensure: true,
						})
					: workspaceScope.workspacePath;
				const summary = await terminalManager.startShellSession({
					taskId: body.taskId,
					cwd: shellCwd,
					cols: body.cols,
					rows: body.rows,
					binary: shell.binary,
					args: shell.args,
				});
				return {
					ok: true,
					summary,
					shellBinary: shell.binary,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					summary: null,
					shellBinary: null,
					error: message,
				};
			}
		},
		runCommand: async (workspaceScope, input) => {
			try {
				const body = parseCommandRunRequest(input);
				return await deps.runCommand(body.command, workspaceScope.workspacePath);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message,
				});
			}
		},
		resetAllState: async (_workspaceScope) => {
			await deps.prepareForStateReset?.();
			await Promise.all(
				debugResetTargetPaths.map(async (path) => {
					await rm(path, { recursive: true, force: true });
				}),
			);
			return {
				ok: true,
				clearedPaths: [...debugResetTargetPaths],
			};
		},
		openFile: async (input) => {
			const filePath = input.filePath.trim();
			if (!filePath) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "File path cannot be empty.",
				});
			}
			openInBrowser(filePath);
			return { ok: true };
		},
		getUpdateStatus: async () => {
			return deps.getUpdateStatus();
		},
		runUpdateNow: async () => {
			return await deps.runUpdateNow();
		},
	};
}
