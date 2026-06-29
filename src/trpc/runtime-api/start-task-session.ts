import type { RuntimeTaskSessionStartRequest, RuntimeTaskSessionStartResponse } from "../../core/api-contract";
import { parseTaskSessionStartRequest } from "../../core/api-validation";
import { resolveSessionConcurrencyCaps } from "../../core/concurrency-config";
import { isHomeAgentSessionId } from "../../core/home-agent-session";
import { fetchLoadedModelIds, shouldBlockUnloadedModel } from "../../core/lmstudio-loaded-models";
import { assessModelSuitability, resolveActiveModelSuitabilityPolicy } from "../../core/model-capability-catalog";
import { selectRoleModel } from "../../core/role-model-selection";
import { readSwarmStopSignal } from "../../core/swarm-guardrails";
import { reconcileStartedTaskBoardLane } from "../../core/task-board-lane-reconcile";
import { resolveTaskTitle } from "../../core/task-title";
import { createNKleinCodeEmbeddingProviderFromSettings } from "../../nklein-agent/nklein-code-embeddings";
import { isNKleinContextWindowPolicyError } from "../../nklein-agent/nklein-context-window-policy";
import { scheduleNKleinEndpointStart } from "../../nklein-agent/nklein-endpoint-scheduler";
import {
	assertLocalProviderAllowed,
	isCloudProviderDisabledError,
	isLocalProvider,
} from "../../nklein-agent/nklein-local-only-policy";
import { buildNKleinModelRegistryKey, getDefaultNKleinModelRegistry } from "../../nklein-agent/nklein-model-registry";
import type {
	createNKleinProviderService,
	ResolvedNKleinLaunchConfig,
} from "../../nklein-agent/nklein-provider-service";
import { routeNKleinTask } from "../../nklein-agent/nklein-task-router";
import {
	buildNKleinSandboxStartBlock,
	buildNKleinStartGuardCandidate,
	estimateNKleinStartDifficulty,
	estimateNKleinStartFitBudgetTokens,
	estimateNKleinStartPromptTokens,
	formatNKleinTaskRoutingBlockMessage,
	type NKleinStartGuardCandidate,
} from "../../nklein-agent/nklein-task-start-guard";
import { applyMcsrAwareLocalTimeoutScaling } from "../../nklein-agent/nklein-timeout-scaling";
import type { RuntimeTrpcWorkspaceScope } from "../app-router";
// Type-only import of the factory's deps interface to reuse its exact member types (erased at runtime → no cycle).
import type { CreateRuntimeApiDependencies } from "../runtime-api.js";
import { countActiveProjectTaskSessions, createConcurrencyLimitStartError } from "./task-concurrency-gate.js";
import { resolveEffectiveTaskTimeoutSettings } from "./task-timeout-settings.js";

/**
 * Handler for the start-task-session procedure, extracted from the oversized `runtime-api.ts`
 * (§5.X / architecture recommendation #3). This is the session-start orchestrator: it gates on swarm-stop +
 * concurrency + sandbox, resolves the launch config across the configured model roles/pools (free-first fan-out +
 * routing decision), schedules the endpoint, and starts the session, reconciling the card's board lane. Takes a
 * deps slice picked from the factory's dependency interface plus the factory-local provider service; the local
 * `applyCandidateEffectiveContextWindow` helper moved here with it (startTaskSession-only). Behavior and wire
 * contract are unchanged (the trivial `reconcileRunningTaskBoardLane` adapter is inlined to its core call).
 */
export type StartTaskSessionDeps = Pick<
	CreateRuntimeApiDependencies,
	| "loadScopedRuntimeConfig"
	| "getScopedNKleinTaskSessionService"
	| "getLoadedScopedNKleinTaskSessionService"
	| "refreshAgentSandboxStatus"
	| "getAgentSandboxStatus"
	| "broadcastTaskChatCleared"
	| "taskStartQueue"
> & {
	nkleinProviderService: ReturnType<typeof createNKleinProviderService>;
};

export function applyCandidateEffectiveContextWindow<TLaunchConfig extends ResolvedNKleinLaunchConfig>(
	launchConfig: TLaunchConfig,
	candidate: NKleinStartGuardCandidate<TLaunchConfig>,
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

export async function handleStartTaskSession(
	workspaceScope: RuntimeTrpcWorkspaceScope,
	input: RuntimeTaskSessionStartRequest,
	deps: StartTaskSessionDeps,
): Promise<RuntimeTaskSessionStartResponse> {
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
		const requestedNKleinTaskMode = body.mode ?? "act";
		const scopedRuntimeConfig = await deps.loadScopedRuntimeConfig(workspaceScope);
		const effectiveTimeouts = resolveEffectiveTaskTimeoutSettings({
			runtimeConfig: scopedRuntimeConfig,
			taskSettings: body.nkleinSettings,
		});
		if (!isHomeAgentSessionId(body.taskId)) {
			const loadedNKleinTaskSessionService = deps.getLoadedScopedNKleinTaskSessionService?.(workspaceScope) ?? null;
			const activeProjectTaskCount = countActiveProjectTaskSessions(
				loadedNKleinTaskSessionService?.listSummaries() ?? [],
				body.taskId,
			);
			if (activeProjectTaskCount >= scopedRuntimeConfig.effectiveMaxConcurrentTasks) {
				return {
					ok: false,
					summary: null,
					error: createConcurrencyLimitStartError(scopedRuntimeConfig.effectiveMaxConcurrentTasks),
				};
			}
		}
		// Under the local-only lockdown every task runs on the NKlein agent path; terminal/CLI agents are
		// disabled and the host-worktree subsystem is retired (§5.A). The card's nkleinSettings override
		// (model + reasoning profile) is read fresh below, and resumeFromTrash is self-hydrated inside
		// nkleinTaskSessionService.startTaskSession (readPersistedTaskSession), so no path probe is needed.
		const sandboxStatus = deps.refreshAgentSandboxStatus
			? await deps.refreshAgentSandboxStatus()
			: deps.getAgentSandboxStatus?.();
		const sandboxStartBlock = buildNKleinSandboxStartBlock(sandboxStatus);
		if (sandboxStartBlock) {
			return {
				ok: false,
				summary: null,
				error: sandboxStartBlock.error,
				errorCode: sandboxStartBlock.errorCode,
			};
		}
		const hasTaskLevelNKleinSettingsOverride = body.nkleinSettings !== undefined;
		let nkleinLaunchConfig = await deps.nkleinProviderService.resolveLaunchConfig({
			providerIdOverride: body.nkleinSettings?.providerId ?? undefined,
			modelIdOverride: body.nkleinSettings?.modelId ?? undefined,
			...(hasTaskLevelNKleinSettingsOverride
				? {
						reasoningEffortOverride: body.nkleinSettings?.reasoningEffort ?? null,
					}
				: {}),
		});
		const nkleinTaskSessionService = await deps.getScopedNKleinTaskSessionService(workspaceScope);
		const modelRegistrySnapshot = await Promise.resolve(getDefaultNKleinModelRegistry().getSnapshot()).catch(() => ({
			schemaVersion: 1,
			updatedAt: 0,
			models: {},
		}));
		const guardCandidates = new Map<string, NKleinStartGuardCandidate<ResolvedNKleinLaunchConfig>>();
		const selectedCandidate = buildNKleinStartGuardCandidate({
			launchConfig: nkleinLaunchConfig,
			role: null,
			modelRegistry: modelRegistrySnapshot,
		});
		nkleinLaunchConfig = applyCandidateEffectiveContextWindow(nkleinLaunchConfig, selectedCandidate);
		guardCandidates.set(selectedCandidate.entry.key, selectedCandidate);
		// Never load models — only use ALREADY-LOADED ones (user directive 2026-06-28): !Klein must not trigger a model
		// load. Fetch the loaded set ONCE (test-runner-skipped — no live endpoint to query) and reuse it for both the
		// primary guard (error) and the role-pool filter (skip). Lenient: block only a positively-non-resident model.
		const residencyCheckEnabled = !(process.env.VITEST || process.env.NODE_ENV === "test");
		const residencyBaseUrl = nkleinLaunchConfig.baseUrl ?? "http://127.0.0.1:1234/v1";
		const loadedModelIds =
			residencyCheckEnabled && isLocalProvider(nkleinLaunchConfig.providerId, nkleinLaunchConfig.baseUrl)
				? await fetchLoadedModelIds(residencyBaseUrl)
				: [];
		if (
			residencyCheckEnabled &&
			nkleinLaunchConfig.modelId &&
			isLocalProvider(nkleinLaunchConfig.providerId, nkleinLaunchConfig.baseUrl) &&
			shouldBlockUnloadedModel(nkleinLaunchConfig.modelId, loadedModelIds)
		) {
			return {
				ok: false,
				summary: null,
				error: `Model "${nkleinLaunchConfig.modelId}" is not loaded in LM Studio. !Klein does not load models — load it in LM Studio first (loaded: ${loadedModelIds.join(", ") || "none"}).`,
			};
		}
		// §5.AL capability gate: a task session is an agentic, tool-using run, so REFUSE a catalog-`reject` primary model
		// (e.g. a reasoning-only variant that can't drive tool chains) up front rather than burning a whole task on it.
		// Honors the default warn-and-reject policy; override with NKLEIN_ALLOW_UNSUITABLE_MODEL=1. Pure (no live endpoint),
		// so it applies in tests too — but only a `reject` blocks, and `warn`/`unknown` proceed, so it can't wedge an
		// ordinary run. (A non-reject caveat is left to the §5.AG operator-UX surface, not a hard block here.)
		if (nkleinLaunchConfig.modelId && process.env.NKLEIN_ALLOW_UNSUITABLE_MODEL !== "1") {
			const suitability = assessModelSuitability(nkleinLaunchConfig.modelId, resolveActiveModelSuitabilityPolicy());
			if (suitability.severity === "reject") {
				return {
					ok: false,
					summary: null,
					error: `Model "${nkleinLaunchConfig.modelId}" is not suitable for agentic tasks — ${suitability.reason} Set NKLEIN_ALLOW_UNSUITABLE_MODEL=1 to override.`,
				};
			}
		}
		for (const [role, settings] of Object.entries(scopedRuntimeConfig.effectiveModelRoles)) {
			// #4 model pools: a role contributes its primary model plus every member of its additionalModels
			// pool, all tagged with the same role, so task-start fans out across the free, feasible ones.
			const roleModels = [
				{ model: settings, primary: true },
				...(settings.additionalModels ?? []).map((model) => ({ model, primary: false })),
			];
			for (const { model, primary } of roleModels) {
				if (!model.providerId && !model.modelId) {
					continue;
				}
				try {
					const roleLaunchConfig = await deps.nkleinProviderService.resolveLaunchConfig({
						providerIdOverride: model.providerId ?? undefined,
						modelIdOverride: model.modelId ?? undefined,
						reasoningEffortOverride: model.reasoningEffort ?? null,
					});
					// Skip a non-resident pool member on the SAME endpoint we queried — !Klein won't load it (directive).
					if (
						residencyCheckEnabled &&
						roleLaunchConfig.modelId &&
						roleLaunchConfig.baseUrl === nkleinLaunchConfig.baseUrl &&
						isLocalProvider(roleLaunchConfig.providerId, roleLaunchConfig.baseUrl) &&
						shouldBlockUnloadedModel(roleLaunchConfig.modelId, loadedModelIds)
					) {
						continue;
					}
					const roleCandidate = buildNKleinStartGuardCandidate({
						launchConfig: roleLaunchConfig,
						role,
						modelRegistry: modelRegistrySnapshot,
					});
					guardCandidates.set(roleCandidate.entry.key, roleCandidate);
				} catch (error) {
					// The primary role model keeps the fatal-on-context-policy behavior; an over-budget or
					// unrunnable *pool* member is skipped so the rest of the role's models still participate.
					if (primary && isNKleinContextWindowPolicyError(error)) {
						return {
							ok: false,
							summary: null,
							error: error.message,
							errorCode: "routing_escalation",
						};
					}
					// Ignore role models that are not currently runnable; the configured default still participates.
				}
			}
		}
		const preferredCandidate = body.startInPlanMode
			? ([...guardCandidates.values()].find((candidate) => candidate.role === "architect") ?? selectedCandidate)
			: selectedCandidate;
		const promptTokens = estimateNKleinStartPromptTokens({
			prompt: body.prompt,
			taskTitle: body.taskTitle,
			images: body.images,
		});
		const largestContextWindow =
			[...guardCandidates.values()]
				.map((candidate) => candidate.entry.contextWindow.effective ?? 0)
				.filter((contextWindow) => contextWindow > 0)
				.sort((left, right) => right - left)[0] ?? null;
		// #4 swarm fan-out: when several candidates are feasible, prefer one that is not currently busy so
		// parallel tasks spread across free models instead of all queueing on the single smallest-sufficient
		// one. Fully fallback-safe — with a single candidate this resolves to that candidate (no change), and
		// when no free feasible candidate exists the preferred candidate below is used unchanged.
		const runningModelKeys = new Set(
			nkleinTaskSessionService
				.listModelEndpointSessions()
				.filter((session) => session.state === "running")
				.map((session) =>
					buildNKleinModelRegistryKey({
						providerId: session.providerId,
						modelId: session.modelId,
						endpoint: session.endpoint,
					}),
				),
		);
		const freeFirstSelection = selectRoleModel({
			candidates: [...guardCandidates.values()].map((candidate) => ({
				modelKey: candidate.entry.key,
				capability: candidate.entry.capability.effectiveScore,
				contextWindow: candidate.entry.contextWindow.effective ?? 0,
				predictedWallTimeMs: candidate.entry.speed.wallTimeMsEwma,
				isFree: !runningModelKeys.has(candidate.entry.key),
			})),
			difficulty: estimateNKleinStartDifficulty(promptTokens),
			requiredContextTokens: estimateNKleinStartFitBudgetTokens(promptTokens, largestContextWindow),
			weighting: "efficient",
		});
		const freeFirstModelKey =
			runningModelKeys.has(preferredCandidate.entry.key) &&
			freeFirstSelection.type === "assign" &&
			!freeFirstSelection.busyFallback
				? freeFirstSelection.modelKey
				: null;
		const routingDecision = routeNKleinTask({
			difficulty: estimateNKleinStartDifficulty(promptTokens),
			fitBudgetTokens: estimateNKleinStartFitBudgetTokens(promptTokens, largestContextWindow),
			promptTokens,
			outputTokens: 1_000,
			preferredModelKey: freeFirstModelKey ?? preferredCandidate.entry.key,
			candidates: [...guardCandidates.values()].map((candidate) => ({
				entry: candidate.entry,
				role: candidate.role,
			})),
		});
		if (routingDecision.type === "decompose" || routingDecision.type === "escalate") {
			return {
				ok: false,
				summary: null,
				error: formatNKleinTaskRoutingBlockMessage(routingDecision),
				errorCode: routingDecision.type === "decompose" ? "needs_decomposition" : "routing_escalation",
			};
		}
		const routedCandidate = guardCandidates.get(routingDecision.modelKey) ?? null;
		if (routedCandidate) {
			nkleinLaunchConfig = applyCandidateEffectiveContextWindow(routedCandidate.launchConfig, routedCandidate);
		}
		assertLocalProviderAllowed({
			providerId: nkleinLaunchConfig.providerId,
			baseUrl: nkleinLaunchConfig.baseUrl,
		});
		const mcsrAwareTimeouts = applyMcsrAwareLocalTimeoutScaling({
			timeouts: effectiveTimeouts,
			launchConfig: nkleinLaunchConfig,
			modelRegistry: modelRegistrySnapshot,
			promptTokens,
		});
		const codeEmbeddingProvider = createNKleinCodeEmbeddingProviderFromSettings(
			scopedRuntimeConfig.effectiveCodeEmbeddingSettings,
		);
		// §5.W: resolve the effective per-provider/per-model concurrency caps (project override ?? global default) and
		// feed them to the scheduler gate. The per-model registry `maxConcurrentRequests` fallback stays inside the
		// scheduler, so a null cap here leaves today's behavior unchanged.
		const concurrencyCaps = resolveSessionConcurrencyCaps({
			providerId: nkleinLaunchConfig.providerId,
			modelId: buildNKleinModelRegistryKey({
				providerId: nkleinLaunchConfig.providerId,
				modelId: nkleinLaunchConfig.modelId ?? "",
				endpoint: nkleinLaunchConfig.baseUrl ?? null,
			}),
			global: scopedRuntimeConfig.concurrencyDefaults,
			override: scopedRuntimeConfig.concurrencyOverride,
		});
		const endpointDecision = scheduleNKleinEndpointStart({
			taskId: body.taskId,
			providerId: nkleinLaunchConfig.providerId,
			modelId: nkleinLaunchConfig.modelId ?? "",
			endpoint: nkleinLaunchConfig.baseUrl ?? null,
			runningSessions: nkleinTaskSessionService.listModelEndpointSessions(),
			modelRegistry: modelRegistrySnapshot,
			now: Date.now(),
			providerConcurrencyCap: concurrencyCaps.providerCap,
			modelConcurrencyCap: concurrencyCaps.modelCap,
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
		const resolvedNKleinTitle = resolveTaskTitle(body.taskTitle?.trim(), body.prompt);
		const summary = await nkleinTaskSessionService.startTaskSession({
			taskId: body.taskId,
			cwd: workspaceScope.workspacePath,
			workspaceRoot: workspaceScope.workspacePath,
			baseRef: body.baseRef,
			prompt: body.prompt,
			taskTitle: resolvedNKleinTitle.length > 0 ? resolvedNKleinTitle : undefined,
			images: body.images,
			filesLikelyTouched: body.filesLikelyTouched,
			resumeFromTrash: body.resumeFromTrash,
			providerId: nkleinLaunchConfig.providerId,
			modelId: nkleinLaunchConfig.modelId,
			mode: requestedNKleinTaskMode,
			startInPlanMode: body.startInPlanMode,
			apiKey: nkleinLaunchConfig.apiKey,
			baseUrl: nkleinLaunchConfig.baseUrl,
			reasoningEffort: nkleinLaunchConfig.reasoningEffort,
			contextScope: body.nkleinSettings?.contextScope,
			contextWindow: nkleinLaunchConfig.contextWindow ?? null,
			timeoutMode: mcsrAwareTimeouts.timeoutMode,
			requestTimeoutMs: mcsrAwareTimeouts.requestTimeoutMs,
			turnTimeoutMs: mcsrAwareTimeouts.agentTimeoutMs,
			streamTimeoutMs: mcsrAwareTimeouts.streamTimeoutMs,
			toolTimeoutMs: mcsrAwareTimeouts.toolTimeoutMs,
			conversationTimeoutMs: mcsrAwareTimeouts.conversationTimeoutMs,
			streamTimeoutSource: mcsrAwareTimeouts.streamTimeoutSource,
			toolTimeoutSource: mcsrAwareTimeouts.toolTimeoutSource,
			conversationTimeoutSource: mcsrAwareTimeouts.conversationTimeoutSource,
			maxAgentWritableFileLines: scopedRuntimeConfig.maxAgentWritableFileLines,
			codeEmbeddingProvider,
		});

		// Starting a task must move its card out of backlog (→ planning / in_progress) so the board reflects
		// that the agent is now working it — a card should never show agent activity while it sits in backlog.
		// Previously only the input/resume paths reconciled the lane, so a freshly-started card (e.g. a
		// dev-test seed started programmatically) stayed in backlog. Best-effort; never blocks the start.
		await reconcileStartedTaskBoardLane({ workspacePath: workspaceScope.workspacePath, summary });

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
			...(isCloudProviderDisabledError(error) ? { errorCode: "cloud_provider_disabled" as const } : {}),
		};
	}
}
