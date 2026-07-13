import type { RuntimeTaskSessionStartRequest, RuntimeTaskSessionStartResponse } from "../../core/api-contract";
import { parseTaskSessionStartRequest } from "../../core/api-validation";
import { applyWarmthPreference } from "../../core/cache-warmth";
import { createCapabilityBlender } from "../../core/capability-blend";
import { resolveSessionConcurrencyCaps } from "../../core/concurrency-config";
import { ensureModelLoadedOnFittingDevice } from "../../core/ensure-model-loaded";
import { isEnabledByDefaultEnv, isTruthyEnv } from "../../core/env-flag";
import { shouldWaitForBestModel } from "../../core/hard-task-wait";
import { isHomeAgentSessionId } from "../../core/home-agent-session";
import { buildLedgerEvidence } from "../../core/ledger-evidence";
import type { LlmfitRoutingPrior } from "../../core/llmfit-fitness-bridge";
import { fetchLmsLinkDevices } from "../../core/lms-link-status";
import { loadModelExclusive } from "../../core/lms-model-runner";
import { createDefaultLmsRunner, fetchLmsPsModelsCached } from "../../core/lms-ps-json";
import { fetchLoadedModelDescriptors, mergeLoadedModelDescriptors } from "../../core/lmstudio-loaded-model-descriptors";
import {
	fetchLoadedModelIdsCached,
	loadedModelIdsFromLmsPsModels,
	mergeLoadedModelIds,
	shouldBlockUnloadedModel,
} from "../../core/lmstudio-loaded-models";
import { createLmStudioRestModelClient } from "../../core/lmstudio-rest-model-client";
import { DEFAULT_LOCAL_MODEL_BASE_URL } from "../../core/local-model-endpoint";
import {
	assessModelSuitability,
	lookupModelCapability,
	resolveActiveModelSuitabilityPolicy,
} from "../../core/model-capability-catalog";
import { classifyModelClass, isModelAllowedByClassCap } from "../../core/model-class-cap";
import { derivePoolCaps, derivePoolKeyForCandidate } from "../../core/model-pool-key";
import { computePoolFreeSlots } from "../../core/model-pool-routing";
import { explainModelSelection, renderModelSelectionReason } from "../../core/model-selection-reason";
import { selectSwarmRouteForTask } from "../../core/model-swarm-route";
import { affinityTagsForSkills } from "../../core/model-task-affinity";
import type { ModelClassFacts } from "../../core/role-model-class";
import { selectSwarmRoleModel } from "../../core/role-model-swarm-pick";
import { resolveActiveSkills } from "../../core/skill-resolver";
import { applySpeedCapabilityDial } from "../../core/speed-capability-dial";
import { readSwarmStopSignal } from "../../core/swarm-guardrails";
import { resolveSwarmRoleModel } from "../../core/swarm-role-selection";
import { reconcileStartedTaskBoardLane } from "../../core/task-board-lane-reconcile";
import { resolveTaskTitle } from "../../core/task-title";
import { createNKleinCodeEmbeddingProviderFromSettings } from "../../nklein-agent/nklein-code-embeddings";
import { isNKleinContextWindowPolicyError } from "../../nklein-agent/nklein-context-window-policy";
import { scheduleNKleinEndpointStart } from "../../nklein-agent/nklein-endpoint-scheduler";
import {
	llmfitPriorPredictedWallTimeMs,
	loadOptInLlmfitRoutingPriorResolver,
} from "../../nklein-agent/nklein-llmfit-routing-prior";
import { buildLmStudioMachineByModelId } from "../../nklein-agent/nklein-lmstudio-host-map";
import type { LoadedModelRoutingProfile } from "../../nklein-agent/nklein-loaded-model-candidates";
import { resolveLoadedModelProfile } from "../../nklein-agent/nklein-loaded-model-profile";
import {
	assertLocalProviderAllowed,
	isCloudProviderDisabledError,
	isLocalProvider,
} from "../../nklein-agent/nklein-local-only-policy";
import { buildNKleinModelRegistryKey, getDefaultNKleinModelRegistry } from "../../nklein-agent/nklein-model-registry";
import { clearProviderModelDiscoveryCache } from "../../nklein-agent/nklein-provider-model-discovery";
import type {
	createNKleinProviderService,
	ResolvedNKleinLaunchConfig,
} from "../../nklein-agent/nklein-provider-service";
import {
	applyStableRoutingKeysToCandidates,
	buildResidencyModelKeySet,
} from "../../nklein-agent/nklein-stable-routing-candidates";
import { isExplicitDecompositionPrompt } from "../../nklein-agent/nklein-task-prompt-parsing";
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
import { readAllAgentLedger } from "../../state/agent-attempt-ledger-store";
import {
	composeMailboxPromptAddendum,
	listPendingCardMailbox,
	markCardMailboxConsumedUpTo,
} from "../../state/card-mailbox-store";
import {
	learnSharedLoadedDescriptors,
	resolveStableRoutingModelId,
	sharedRuntimeIdModelKeyMap,
} from "../../state/runtime-id-model-key-map-store";
import { readSelfObservationEvents } from "../../telemetry/self-observation-sink";
import type { RuntimeTrpcWorkspaceScope } from "../app-router";
// Type-only import of the factory's deps interface to reuse its exact member types (erased at runtime → no cycle).
import type { CreateRuntimeApiDependencies } from "../runtime-api.js";
import { countActiveProjectTaskSessions, createConcurrencyLimitStartError } from "./task-concurrency-gate.js";
import { resolveEffectiveTaskTimeoutSettings } from "./task-timeout-settings.js";
import { getWorkspaceWorkflowQueue } from "./workflow-queue-registry";

// §5.AB wait_for_best: redrive cadence for a hard card parked waiting on its busy best model (15s).
const HARD_TASK_WAIT_RETRY_MS = 15_000;

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

/** Embedding ids aren't agentic fallbacks (mirror of the candidate builder's filter). */
const FALLBACK_EMBEDDING_ID_PATTERN = /(?:^|[-/@])(?:text-)?embed/i;

function describeRuntimeRolePin(
	role: "architect" | "worker",
	pin: { providerId?: string | null; modelId?: string | null },
): string {
	const provider = pin.providerId?.trim();
	const model = pin.modelId?.trim();
	const label = provider && model ? `${provider}/${model}` : model || provider || "(unspecified)";
	return `${role} model ${label}`;
}

function describeRuntimeTaskModelPin(pin: { providerId?: string | null; modelId?: string | null }): string {
	const provider = pin.providerId?.trim();
	const model = pin.modelId?.trim();
	return provider && model ? `${provider}/${model}` : (model ?? provider ?? "(unspecified)");
}

function createPinnedModelUnavailableStartError(
	role: "architect" | "worker",
	pin: { providerId?: string | null; modelId?: string | null },
): string {
	return (
		`Pinned ${describeRuntimeRolePin(role, pin)} is not currently selectable. ` +
		`Load that model, choose a different pinned ${role} model, or switch the ${role} assignment back to Auto.`
	);
}

function createPinnedTaskModelUnavailableStartError(pin: {
	providerId?: string | null;
	modelId?: string | null;
}): string {
	return (
		`Pinned task model ${describeRuntimeTaskModelPin(pin)} is not currently selectable. ` +
		"Load that model, choose a different task model override, or clear the task model override to use Auto."
	);
}

/**
 * §5.AB "use whatever's loaded": when the configured/DEFAULT model can't resolve (e.g. a stale default pointing to an
 * UNLOADED variant — live-found 2026-07-01), fall back to an already-LOADED model so the card still starts instead of
 * hard-failing before auto-discovery can rescue it. Best-effort: tries each loaded non-embedding id and returns the
 * first that resolves; null when none do (the caller then re-throws the ORIGINAL error, so an empty/unreachable endpoint
 * behaves exactly as before). Only for the DEFAULT case — an EXPLICIT model choice keeps its clear "not loaded" error.
 * Pure of the concrete provider service (takes a narrow resolver + injectable fetch) so it is unit-testable.
 */
export async function resolveLoadedFallbackLaunchConfig(input: {
	resolveLaunchConfig: (overrides: { modelIdOverride: string }) => Promise<ResolvedNKleinLaunchConfig>;
	baseUrl: string;
	fetchImpl?: typeof fetch;
}): Promise<ResolvedNKleinLaunchConfig | null> {
	const loadedIds = await fetchLoadedModelIdsCached(input.baseUrl, input.fetchImpl).catch(() => [] as string[]);
	for (const modelId of loadedIds) {
		if (!modelId || FALLBACK_EMBEDDING_ID_PATTERN.test(modelId)) {
			continue;
		}
		try {
			return await input.resolveLaunchConfig({ modelIdOverride: modelId });
		} catch {
			// This loaded model isn't runnable either (context policy, etc.) — try the next.
		}
	}
	return null;
}

/**
 * F1.27b (leaf 2): emit the start path's workflow commands, fire-and-forget. Commands are dispatched in order on
 * the per-task serialized queue; the kernel HOLDS duplicates, so a queued-then-drained start (which re-enters this
 * handler) simply re-applies the missing grants — replay-proof by construction.
 */
export function dispatchWorkflowStartCommands(
	workspaceScope: RuntimeTrpcWorkspaceScope,
	taskId: string,
	kinds: readonly ("start_requested" | "board_capacity_granted" | "endpoint_granted" | "sandbox_granted")[],
): void {
	const queue = getWorkspaceWorkflowQueue(workspaceScope.workspacePath, workspaceScope.workspaceId);
	void (async () => {
		// A redriven/parked card's mirror may sit failed/cancelled — `reopened` re-admits it so the ladder
		// replays. Conditional: an ACTIVE mirror (e.g. queued_for_endpoint on the drained retry) must NOT reset;
		// its duplicates are absorbed by the kernel's holds instead. A stale phase read at worst skips the reopen
		// (the ladder then holds) — the serialized dispatch keeps the mirror consistent either way.
		const phase = queue.phaseOf(taskId);
		if (phase === "failed" || phase === "cancelled") {
			await queue.dispatch(taskId, { kind: "reopened" });
		}
		for (const kind of kinds) {
			await queue.dispatch(taskId, { kind });
		}
	})().catch(() => {});
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
					// Live-found 2026-07-02 (runs 9/10): the auto-start cascade needs to RECOGNIZE this failure so it can
					// defer + retry the card instead of orphaning it (a lingering just-finished session can transiently
					// hold a slot — e.g. the decompose seed at root-start time).
					errorCode: "concurrency_limit" as const,
				};
			}
		}
		// Under the local-only lockdown every task runs on the NKlein agent path; terminal/CLI agents are
		// disabled and the host-worktree subsystem is retired (§5.A). The card's nkleinSettings override
		// (model + reasoning profile) is read fresh below, and resumeFromTrash is self-hydrated inside
		// nkleinTaskSessionService.startTaskSession (readPersistedTaskSession), so no path probe is needed.
		const taskModelPin = body.nkleinSettings?.modelId?.trim()
			? {
					providerId: body.nkleinSettings.providerId ?? null,
					modelId: body.nkleinSettings.modelId,
				}
			: null;
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
		const resolveOverrides = {
			providerIdOverride: body.nkleinSettings?.providerId ?? undefined,
			modelIdOverride: body.nkleinSettings?.modelId ?? undefined,
			...(hasTaskLevelNKleinSettingsOverride
				? { reasoningEffortOverride: body.nkleinSettings?.reasoningEffort ?? null }
				: {}),
		};
		const providerBaseUrlForLoad =
			deps.nkleinProviderService.getProviderSettingsSummary().baseUrl ?? DEFAULT_LOCAL_MODEL_BASE_URL;
		// §5.AB autonomous loader closure: LOAD a model on a linked device that FITS (opt-in NKLEIN_DEVICE_RAM_GB,
		// fail-safe). Used both here (before resolveLaunchConfig's residency gate) and at the later start block.
		const attemptAutonomousModelLoad = (modelId: string, contextLength: number) =>
			ensureModelLoadedOnFittingDevice(
				{ modelId, contextLength },
				{
					configuredDeviceRamGb: scopedRuntimeConfig.deviceRamGb,
					fetchLinkDevices: () => fetchLmsLinkDevices(createDefaultLmsRunner()),
					listModelSizes: async () => {
						const listed = await createLmStudioRestModelClient({ baseUrl: providerBaseUrlForLoad }).listModels();
						const modelSizes = new Map<string, number>();
						if (listed.ok) {
							for (const model of listed.value) {
								if (model.sizeBytes != null && model.sizeBytes > 0) {
									modelSizes.set(model.key, model.sizeBytes);
								}
							}
						}
						return modelSizes;
					},
					loadExclusive: async (request) => {
						const loadResult = await loadModelExclusive(createDefaultLmsRunner(), {
							modelId: request.modelId,
							candidateSizeBytes: request.candidateSizeBytes,
							totalRamBytes: request.totalRamBytes,
							contextLength: request.contextLength,
							targetDevice: request.targetDevice,
							targetDeviceIdentifier: request.targetDeviceIdentifier,
						});
						return { loaded: loadResult.loaded, reason: loadResult.reason };
					},
				},
			).catch(() => ({ loaded: false as const, reason: "autonomous load error" }));
		let nkleinLaunchConfig: ResolvedNKleinLaunchConfig;
		try {
			nkleinLaunchConfig = await deps.nkleinProviderService.resolveLaunchConfig(resolveOverrides);
		} catch (primaryError) {
			// §5.AB: an EXPLICIT non-resident model — LOAD it on a fitting device, clear the 30s roster cache, and retry
			// resolveLaunchConfig ONCE so it now sees the model. Opt-in (NKLEIN_DEVICE_RAM_GB) + fail-safe: a failed load
			// falls through to the original behavior (DEFAULT ⇒ loaded-fallback; EXPLICIT ⇒ rethrow).
			const autoLoad = body.nkleinSettings?.modelId
				? await attemptAutonomousModelLoad(body.nkleinSettings.modelId, 40_000)
				: { loaded: false as const, reason: "no explicit model" };
			if (autoLoad.loaded) {
				clearProviderModelDiscoveryCache();
				nkleinLaunchConfig = await deps.nkleinProviderService.resolveLaunchConfig(resolveOverrides);
			} else {
				const fallback = body.nkleinSettings?.modelId
					? null
					: await resolveLoadedFallbackLaunchConfig({
							resolveLaunchConfig: (overrides) => deps.nkleinProviderService.resolveLaunchConfig(overrides),
							baseUrl: providerBaseUrlForLoad,
						});
				if (!fallback) {
					throw primaryError;
				}
				nkleinLaunchConfig = fallback;
			}
		}
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
		const residencyBaseUrl = nkleinLaunchConfig.baseUrl ?? DEFAULT_LOCAL_MODEL_BASE_URL;
		const shouldReadLocalResidency =
			residencyCheckEnabled && isLocalProvider(nkleinLaunchConfig.providerId, nkleinLaunchConfig.baseUrl);
		const lmsPsModelsForResidency = shouldReadLocalResidency
			? await fetchLmsPsModelsCached(createDefaultLmsRunner()).catch(() => [])
			: [];
		const loadedModelIds = shouldReadLocalResidency
			? mergeLoadedModelIds(
					await fetchLoadedModelIdsCached(residencyBaseUrl),
					loadedModelIdsFromLmsPsModels(lmsPsModelsForResidency),
				)
			: [];
		if (
			residencyCheckEnabled &&
			nkleinLaunchConfig.modelId &&
			isLocalProvider(nkleinLaunchConfig.providerId, nkleinLaunchConfig.baseUrl) &&
			shouldBlockUnloadedModel(nkleinLaunchConfig.modelId, loadedModelIds)
		) {
			// §5.AB machine-aware AUTONOMOUS LOAD (OPT-IN via NKLEIN_DEVICE_RAM_GB): rather than block a non-resident
			// model, LOAD it on a linked device that FITS — guarded by loadModelExclusive (capability gate +
			// one-at-a-time unload + headroom). This is the EFFECTIVE hook: the device is decided at LOAD time, and
			// LM-Link serves a loaded model from where it sits (dispatch-time steering was proven inert, 2026-07-12).
			// Fail-safe + opt-in: disabled / no-fit / load-error ⇒ loaded:false ⇒ fall through to the original block.
			// With NKLEIN_DEVICE_RAM_GB unset, the adapter returns immediately with NO fleet I/O ⇒ byte-identical.
			const autoLoad = await attemptAutonomousModelLoad(
				nkleinLaunchConfig.modelId,
				nkleinLaunchConfig.contextWindow ?? 40_000,
			);
			if (!autoLoad.loaded) {
				return {
					ok: false,
					summary: null,
					errorCode: "model_not_loaded",
					error: `Model "${nkleinLaunchConfig.modelId}" is not loaded in LM Studio${autoLoad.reason ? ` (auto-load: ${autoLoad.reason})` : ""}. Load it in LM Studio, or set NKLEIN_DEVICE_RAM_GB so !Klein loads it on a fitting device (loaded: ${loadedModelIds.join(", ") || "none"}).`,
					modelNotLoaded: {
						requestedModelId: nkleinLaunchConfig.modelId,
						loadedModelIds,
					},
				};
			}
			// Loaded on a fitting device — proceed past the block (the model is now resident).
		}
		// §5.AL capability gate: a task session is an agentic, tool-using run, so REFUSE a catalog-`reject` primary model
		// (e.g. a reasoning-only variant that can't drive tool chains) up front rather than burning a whole task on it.
		// Honors the default warn-and-reject policy; override with NKLEIN_ALLOW_UNSUITABLE_MODEL=1. Pure (no live endpoint),
		// so it applies in tests too — but only a `reject` blocks, and `warn`/`unknown` proceed, so it can't wedge an
		// ordinary run. (A non-reject caveat is left to the §5.AG operator-UX surface, not a hard block here.)
		if (nkleinLaunchConfig.modelId && process.env.NKLEIN_ALLOW_UNSUITABLE_MODEL !== "1") {
			// Base policy = the project's effective runtime-config policy (global default ← per-project override), with the
			// env knobs (NKLEIN_MODEL_GATE_*) layered on top as the always-available override.
			const suitability = assessModelSuitability(
				nkleinLaunchConfig.modelId,
				resolveActiveModelSuitabilityPolicy(process.env, scopedRuntimeConfig.effectiveModelSuitabilityPolicy),
			);
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
				...(settings.additionalModels ?? []).map((model) => ({
					model,
					primary: false,
				})),
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
					// §5.AE per-role model-class cap: skip a candidate whose class exceeds the role's configured cap
					// (no-op when unset — the cap is absent by default, so today's fan-out is unchanged).
					const candidateClass = classifyModelClass({
						isLocal: isLocalProvider(roleCandidate.entry.providerId, roleCandidate.entry.endpoint),
						capabilityScore: roleCandidate.entry.capability.effectiveScore,
					});
					if (!isModelAllowedByClassCap(settings.modelClassCap, candidateClass)) {
						continue;
					}
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
		// §5.AB auto-selection (DEFAULT, no manual config): also offer every LOADED model as a role-less candidate, so a
		// directly-started card auto-picks a best-fit model even with no configured roles (user "forget my config"). Each is
		// keyed on its REAL model name (the descriptor's key, NOT the per-machine alias) for the affinity tags + prior.
		// Best-effort + local-only + no-load (descriptors ARE the already-loaded set); any failure degrades to the configured
		// candidates. Skipped under the test runner (residency disabled ⇒ no live endpoint ⇒ empty), so tests are unchanged.
		const loadedModelProfilesByRuntimeId = new Map<string, LoadedModelRoutingProfile>();
		const llmfitRoutingPriorByRuntimeId = new Map<string, LlmfitRoutingPrior>();
		// §5.BG: runtime id → STABLE publisher key for the loaded set, so the chosen model's telemetry keys off the
		// stable key (not the renamable runtime id). Populated only when descriptors are fetched (local + residency on).
		const stableModelKeyByRuntimeId = new Map<string, string>();
		if (residencyCheckEnabled && isLocalProvider(nkleinLaunchConfig.providerId, nkleinLaunchConfig.baseUrl)) {
			try {
				const loadedDescriptors = mergeLoadedModelDescriptors(
					await fetchLoadedModelDescriptors(residencyBaseUrl),
					lmsPsModelsForResidency,
				);
				// §5.AB llmfit prior (opt-in via NKLEIN_LLMFIT_PRIOR): same cached resolver as decomposition routing.
				// OFF by default, so task-start auto-discovery remains local-only unless the operator explicitly enables it.
				const resolveLlmfitRoutingPrior = await loadOptInLlmfitRoutingPriorResolver();
				// §5.BG: learn each loaded runtime id's stable key into the persisted map so a COLD model still resolves.
				learnSharedLoadedDescriptors(loadedDescriptors);
				for (const descriptor of loadedDescriptors) {
					const routingPrior = resolveLlmfitRoutingPrior?.(descriptor.modelKey) ?? null;
					if (routingPrior) {
						llmfitRoutingPriorByRuntimeId.set(descriptor.runtimeId, routingPrior);
					}
					const profile = resolveLoadedModelProfile(
						descriptor,
						resolveLlmfitRoutingPrior ? { llmfitPrior: () => routingPrior?.capabilityPrior ?? null } : undefined,
					);
					loadedModelProfilesByRuntimeId.set(descriptor.runtimeId, profile);
					stableModelKeyByRuntimeId.set(descriptor.runtimeId, descriptor.modelKey);
					if (profile.isEmbedding) {
						continue; // an embedding model is not an agentic candidate
					}
					// W2.5b (audit 2026-07-02): suitability-gate the AUTO-OFFERED candidates — run17 proved
					// auto-discovery delivers (nano4-m5), so the catalog gate must apply to it too: a
					// catalog-REJECTED family (reasoning-only, no tool training) must not enter routing as a
					// worker candidate just because it happens to be loaded. Gate on the REAL model key.
					const loadedSuitability = assessModelSuitability(
						descriptor.modelKey,
						resolveActiveModelSuitabilityPolicy(process.env, scopedRuntimeConfig.effectiveModelSuitabilityPolicy),
					);
					if (loadedSuitability.severity === "reject") {
						continue;
					}
					try {
						const loadedLaunchConfig = await deps.nkleinProviderService.resolveLaunchConfig({
							modelIdOverride: descriptor.runtimeId,
						});
						const loadedCandidate = buildNKleinStartGuardCandidate({
							launchConfig: loadedLaunchConfig,
							role: null,
							modelRegistry: modelRegistrySnapshot,
						});
						if (!guardCandidates.has(loadedCandidate.entry.key)) {
							guardCandidates.set(loadedCandidate.entry.key, loadedCandidate);
						}
					} catch {
						// A loaded model that can't resolve into a runnable launch config (context policy, etc.) is skipped.
					}
				}
			} catch {
				// Best-effort discovery — a missing/unreadable endpoint just leaves the configured candidates in place.
			}
		}
		// §5.BG (c) routing-key flip — DEFAULT-ON (David 2026-07-07 rollout; opt out with NKLEIN_STABLE_ROUTING_KEY=0).
		// Now that the runtimeId→stable-key map is fully learned (the descriptor loop above fed this request's loaded set
		// into it), re-key EVERY routing candidate's `entry.key` to the STABLE routing key in ONE pass — so the
		// ledger-evidence lookup, the residency set, and the ledger WRITE all agree on the stable identity (all resolve the
		// same runtime id through the same map: map hit ⇒ all stable, miss ⇒ all runtime — no mismatch / double-start by
		// construction). `entry.modelId` stays the RUNTIME id (the launch + verdict identity, per the alignment guard).
		// Doing it here (one pass, after the map is populated and BEFORE residency/ledger read) is what makes the flip safe.
		const stableRoutingEnabled = isEnabledByDefaultEnv(process.env.NKLEIN_STABLE_ROUTING_KEY);
		if (stableRoutingEnabled) {
			applyStableRoutingKeysToCandidates(guardCandidates, resolveStableRoutingModelId);
		}
		const taskPinnedModelKey =
			taskModelPin && nkleinLaunchConfig.modelId
				? buildNKleinModelRegistryKey({
						providerId: nkleinLaunchConfig.providerId,
						modelId: stableRoutingEnabled
							? resolveStableRoutingModelId(nkleinLaunchConfig.modelId)
							: nkleinLaunchConfig.modelId,
						endpoint: nkleinLaunchConfig.baseUrl ?? null,
					})
				: null;
		// Best-fit affinity tags for a candidate, matched by its runtime model id against the loaded descriptors (undefined
		// when the model isn't in the loaded set — e.g. a configured cloud role — so it simply carries no affinity).
		const affinityTagsForCandidateModel = (modelId: string): readonly string[] | undefined => {
			const tags = loadedModelProfilesByRuntimeId.get(modelId)?.affinityTags;
			return tags && tags.length > 0 ? tags : undefined;
		};
		// §5.AE→§5.AB: the card's resolved skills → the affinity tags a fitting model should carry (code card → `code`,
		// planning/architect card → `reasoning`), so the router prefers a best-fit model BEFORE smallest-sufficient.
		const startTaskText = `${body.taskTitle ?? ""}\n${body.prompt}`;
		const resolvedSkillIds = resolveActiveSkills({
			role: body.startInPlanMode ? "architect" : "worker",
			taskText: startTaskText,
			// §5.AE live-wiring: honor the user's persisted skill-dynamics level (global default ← per-project override).
			// RuntimeSkillDynamicsLevel is 1:1 with the resolver's SkillDynamicsLevel, so it passes through directly. Default
			// (`fully_dynamic`) == the resolver's own default ⇒ byte-identical; only a user-picked static/assigned level
			// diverges. NOTE: the `assigned_skills` level has no config-side assignedSkillIds source yet, so it resolves to
			// an EMPTY skill set (the relevance fallback is only for the static levels with no role) — acceptable for now.
			dynamicsLevel: scopedRuntimeConfig.effectiveSkillDynamicsLevel,
		}).skills.map((skill) => skill.id);
		const taskAffinityTags = affinityTagsForSkills(resolvedSkillIds);
		const promptTokens = estimateNKleinStartPromptTokens({
			prompt: body.prompt,
			taskTitle: body.taskTitle,
			images: body.images,
		});
		const routingOutputTokens = 1_000;
		const llmfitWallTimeForModel = (modelId: string): number | null =>
			llmfitPriorPredictedWallTimeMs(llmfitRoutingPriorByRuntimeId.get(modelId), routingOutputTokens);
		const predictedWallTimeForCandidate = (candidate: NKleinStartGuardCandidate<ResolvedNKleinLaunchConfig>) =>
			candidate.entry.speed.wallTimeMsEwma ?? llmfitWallTimeForModel(candidate.entry.modelId);
		const tokensPerSecondForCandidate = (candidate: NKleinStartGuardCandidate<ResolvedNKleinLaunchConfig>) =>
			candidate.entry.speed.decodeTokensPerSecondEwma ??
			llmfitRoutingPriorByRuntimeId.get(candidate.entry.modelId)?.estimatedTps ??
			null;
		const largestContextWindow =
			[...guardCandidates.values()]
				.map((candidate) => candidate.entry.contextWindow.effective ?? 0)
				.filter((contextWindow) => contextWindow > 0)
				.sort((left, right) => right - left)[0] ?? null;
		// #4 swarm fan-out: when several candidates are feasible, prefer one that is not currently busy so
		// parallel tasks spread across free models instead of all queueing on the single smallest-sufficient
		// one. Fully fallback-safe — with a single candidate this resolves to that candidate (no change), and
		// when no free feasible candidate exists the preferred candidate below is used unchanged.
		// §5.AF live consumption: blend each candidate's registry capability with its LEDGER-observed success rate so
		// routing follows real-run evidence. Best-effort — an unreadable/empty ledger (e.g. first run, or test) yields no
		// rows, the blend returns the registry score unchanged, and routing behaves exactly as before. Read once here and
		// reuse for both the swarm role class/instance pick (`selectSwarmRoleModel`) and the main router (`routeNKleinTask`).
		// routing evidence (5.AF/5.AL): read the ledger ONCE and project it into the three evidence structures the
		// router blends into capability (global rollup, per-role rollup, verdict-run denominator). Best-effort (empty
		// on error). Extracted to ledger-evidence.ts (5.U DI-injectable I/O helper); the per-role lookup below keys by
		// the same NUL separator, so it can never drift between the write and the read.
		const {
			successByKey: ledgerSuccessByKey,
			roleSuccessByKey: ledgerRoleSuccessByKey,
			verdictRuns: runtimeVerdictRuns,
		} = await buildLedgerEvidence(readAllAgentLedger);
		// W2.6b (audit 2026-07-02): runtime-VERDICT penalty — penalizeFitnessByRuntimeVerdict was display-only, so
		// the strongest unsuitability signal (chronic stalls observed in real runs) never steered selection. Read the
		// self-observation evidence once per start (best-effort; empty ⇒ UNKNOWN ⇒ multiplier 1 ⇒ unchanged) and scale
		// each candidate's blended capability: TOOL_UNSUITABLE ×0.1, TOOL_WEAK ×0.5 (the §5.AB default penalties).
		const selfObservationEvents = await readSelfObservationEvents({
			limit: 500,
		}).catch(() => [] as Awaited<ReturnType<typeof readSelfObservationEvents>>);
		// 5.AF/5.AB capability blender (extracted to core/capability-blend.ts, 5.U): given the ledger evidence + the
		// self-observation events it returns the verdict-multiplier + blended-capability functions the router uses
		// (per-model verdict memo + role-outranks-global preference encapsulated; role evidence keyed by the shared
		// roleEvidenceKey, so the write and read keys can never drift).
		const { blendedCapabilityForKey } = createCapabilityBlender({
			successByKey: ledgerSuccessByKey,
			roleSuccessByKey: ledgerRoleSuccessByKey,
			verdictRuns: runtimeVerdictRuns,
			selfObservationEvents,
		});
		// §5.BG (c): the residency key resolves the STABLE id the SAME way the re-keyed candidates do (both via
		// `resolveStableRoutingModelId`), so a running model is recognized as running (never looks FREE → double-start).
		// Flag OFF ⇒ the identity resolver ⇒ runtime keys, byte-identical to before.
		const runningModelKeys = buildResidencyModelKeySet(
			nkleinTaskSessionService.listModelEndpointSessions().filter((session) => session.state === "running"),
			stableRoutingEnabled ? resolveStableRoutingModelId : (modelId) => modelId,
		);
		// W1.2 (audit 2026-07-02): blend content signals into difficulty — plan cards + planning skill raise the
		// floor, hard/easy task text nudges — so trivial-verbose stops over-provisioning and terse-hard stops
		// under-routing (this score also gates the W1.3 /no_think decision).
		const taskDifficulty = estimateNKleinStartDifficulty(promptTokens, {
			skillIds: resolvedSkillIds,
			isPlanCard: body.startInPlanMode === true,
			taskText: startTaskText,
		});
		const requiredContextTokens = estimateNKleinStartFitBudgetTokens(promptTokens, largestContextWindow);
		// §5.AB queue-aware free-first (opt-in via NKLEIN_QUEUE_AWARE_FREE_FIRST): a model the LM Studio SERVER is BUSY on
		// isn't truly "free" for fan-out even if !Klein isn't running it — busy = a non-empty `queued` (another client /
		// backlog) OR a non-idle `status` (an in-flight prefill/generation). OFF by default ⇒ no `lms ps` subprocess,
		// `isModelFree` = own-sessions only (byte-identical).
		const busyModelIds = isTruthyEnv(process.env.NKLEIN_QUEUE_AWARE_FREE_FIRST)
			? new Set(
					(await fetchLmsPsModelsCached(createDefaultLmsRunner()))
						.filter((model) => model.queued > 0 || (model.status !== null && model.status !== "idle"))
						.map((model) => model.identifier),
				)
			: null;
		const isModelFree = (modelKey: string, modelId: string): boolean =>
			!runningModelKeys.has(modelKey) && !busyModelIds?.has(modelId);
		// W2.5 role/task auto-assignment (auto is the DEFAULT): a role's primary model is a USER PIN only when that role
		// explicitly sets modelSelectionMode:"pinned" on a concrete primary model id. A card's concrete task model override
		// is also an explicit pin for that specific start. A valid explicit pin wins when loaded, class-eligible, and
		// feasible.
		// Later optimization passes (free-first, pool, cache-warmth, speed/capability) may diagnose that another model would
		// be better, but they must NOT silently replace an explicit pin. If an explicit pin is absent/unrunnable or fails
		// the class/feasibility gate, fail closed with an operator-visible error instead of falling through to auto-selection.
		// Role pins apply only when the card did not name a concrete task model; a task model override is the narrower
		// choice. The task-start residency gate above is untouched: an explicitly chosen unloaded model still hard-fails with
		// the clear "load it first" error (§5.AB no-load safety).
		const cardRole = body.startInPlanMode ? ("architect" as const) : ("worker" as const);
		const cardRoleSettings = scopedRuntimeConfig.effectiveModelRoles[cardRole];
		const cardRoleHasConfiguredModel = Boolean(
			cardRoleSettings &&
				[cardRoleSettings, ...(cardRoleSettings.additionalModels ?? [])].some(
					(model) => model.providerId || model.modelId,
				),
		);
		const rolePinApplies =
			taskModelPin === null &&
			(body.startInPlanMode || !(body.nkleinSettings?.providerId || body.nkleinSettings?.modelId));
		const cardRolePin =
			rolePinApplies &&
			cardRoleHasConfiguredModel &&
			cardRoleSettings?.modelSelectionMode === "pinned" &&
			cardRoleSettings.modelId?.trim()
				? {
						providerId: cardRoleSettings?.providerId ?? null,
						modelId: cardRoleSettings?.modelId ?? null,
					}
				: null;
		const allGuardCandidates = [...guardCandidates.values()];
		const cardRoleGuardCandidates = allGuardCandidates.filter((candidate) => candidate.role === cardRole);
		const roleScopedSelectionCandidates =
			!taskModelPin && !cardRolePin && cardRoleHasConfiguredModel && cardRoleGuardCandidates.length > 0
				? cardRoleGuardCandidates
				: allGuardCandidates;
		const roleAssignment = resolveSwarmRoleModel({
			role: cardRole,
			pinned: cardRolePin,
			candidates: allGuardCandidates.map((candidate) => ({
				modelKey: candidate.entry.key,
				modelId: candidate.entry.modelId,
				score: blendedCapabilityForKey(
					candidate.entry.key,
					candidate.entry.capability.effectiveScore,
					candidate.role,
					candidate.entry.modelId,
				),
				// Explicit role pins target the role's PRIMARY configured model. Additional role models stay in the
				// auto-selection pool; they are not silently promoted to hard pins.
				isPinned:
					cardRolePin?.modelId !== undefined &&
					cardRolePin.modelId !== null &&
					candidate.role === cardRole &&
					candidate.entry.modelId === cardRolePin.modelId,
			})),
		});
		if (cardRolePin && roleAssignment.source !== "pinned") {
			return {
				ok: false,
				summary: null,
				error: createPinnedModelUnavailableStartError(cardRole, cardRolePin),
				errorCode: "pinned_model_unavailable",
				selectionReason: roleAssignment.reasons.join(" "),
			};
		}
		const modelClassFactsForCandidate = (
			candidate: NKleinStartGuardCandidate<ResolvedNKleinLaunchConfig>,
		): ModelClassFacts | undefined => {
			const catalogEntry = lookupModelCapability(
				stableModelKeyByRuntimeId.get(candidate.entry.modelId) ?? candidate.entry.modelId,
			);
			return catalogEntry ? { kind: catalogEntry.kind, toolUse: catalogEntry.toolUse } : undefined;
		};
		const swarmRoleDecision = selectSwarmRoleModel({
			role: cardRole,
			candidates: roleScopedSelectionCandidates.map((candidate) => ({
				modelKey: candidate.entry.key,
				facts: modelClassFactsForCandidate(candidate),
				capability: blendedCapabilityForKey(
					candidate.entry.key,
					candidate.entry.capability.effectiveScore,
					candidate.role,
					candidate.entry.modelId,
				),
				contextWindow: candidate.entry.contextWindow.effective ?? 0,
				predictedWallTimeMs: predictedWallTimeForCandidate(candidate),
				isFree: isModelFree(candidate.entry.key, candidate.entry.modelId),
			})),
			difficulty: taskDifficulty,
			requiredContextTokens,
			pinnedModelKey:
				taskPinnedModelKey ?? (roleAssignment.source === "pinned" ? (roleAssignment.pick?.modelKey ?? null) : null),
			weighting: "efficient",
		});
		const freeFirstSelection = swarmRoleDecision.selection;
		const honoredTaskPinKey =
			taskPinnedModelKey &&
			freeFirstSelection.type === "assign" &&
			freeFirstSelection.modelKey === taskPinnedModelKey
				? taskPinnedModelKey
				: null;
		if (taskModelPin && taskPinnedModelKey && !honoredTaskPinKey) {
			const selectionReason = `Pinned task model ${describeRuntimeTaskModelPin(taskModelPin)} is not selectable for the ${cardRole} role: ${freeFirstSelection.reason}`;
			return {
				ok: false,
				summary: null,
				error: createPinnedTaskModelUnavailableStartError(taskModelPin),
				errorCode: "pinned_model_unavailable",
				selectionReason,
			};
		}
		const rolePinnedModelKey =
			roleAssignment.source === "pinned" && roleAssignment.pick ? roleAssignment.pick.modelKey : null;
		const honoredRolePinKey =
			rolePinnedModelKey &&
			freeFirstSelection.type === "assign" &&
			freeFirstSelection.modelKey === rolePinnedModelKey
				? rolePinnedModelKey
				: null;
		if (cardRolePin && rolePinnedModelKey && !honoredRolePinKey) {
			const selectionReason = [...roleAssignment.reasons, freeFirstSelection.reason].filter(Boolean).join(" ");
			return {
				ok: false,
				summary: null,
				error: createPinnedModelUnavailableStartError(cardRole, cardRolePin),
				errorCode: "pinned_model_unavailable",
				selectionReason,
			};
		}
		const classSelectedCandidate =
			freeFirstSelection.type === "assign" ? (guardCandidates.get(freeFirstSelection.modelKey) ?? null) : null;
		const preferredCandidate = classSelectedCandidate ?? selectedCandidate;
		const freeFirstModelKey =
			runningModelKeys.has(preferredCandidate.entry.key) &&
			freeFirstSelection.type === "assign" &&
			!freeFirstSelection.busyFallback
				? freeFirstSelection.modelKey
				: null;
		// §5.AB wait-vs-attempt: under `wait_for_best`, a HARD card whose qualified models are ALL busy WAITS for the
		// best one to free up (via the same queued defer protocol as endpoint-busy) instead of starting on a busy or
		// lesser model. Default mode (attempt_with_available) skips this entirely — byte-identical behavior.
		const allQualifiedBusy = freeFirstSelection.type === "assign" && freeFirstSelection.busyFallback;
		if (
			shouldWaitForBestModel({
				mode: scopedRuntimeConfig.hardTaskRoutingMode,
				difficulty: taskDifficulty,
				busyFallback: allQualifiedBusy,
			})
		) {
			const waitReason =
				"Hard task is waiting for its best qualified model to free up (hardTaskRoutingMode: wait_for_best).";
			if (body.queueOnEndpointBusy) {
				deps.taskStartQueue?.enqueue({
					workspaceScope,
					request: body,
					delayMs: HARD_TASK_WAIT_RETRY_MS,
					error: waitReason,
				});
			}
			if (body.queueOnEndpointBusy) {
				// The card is admitted (board capacity held) but waiting on the endpoint — kernel-truth for the queue.
				dispatchWorkflowStartCommands(workspaceScope, body.taskId, ["start_requested", "board_capacity_granted"]);
			}
			return {
				ok: false,
				summary: null,
				error: `${waitReason} It will start automatically when the model is free, or switch hardTaskRoutingMode to attempt_with_available.`,
				errorCode: "endpoint_busy",
				retryAfterMs: HARD_TASK_WAIT_RETRY_MS,
				queued: body.queueOnEndpointBusy ? true : undefined,
			};
		}
		// §5.AB LM-Link per-HOST handling: resolved ONCE here and reused for BOTH routing pool keys (below) and the
		// admission gate (further down). Host caps from Settings are keyed by `lms ps --json` machine id (`local` for this
		// box, linked device ids for LM Link machines). The older NKLEIN_PER_MACHINE_MAX_CONCURRENCY env remains as a
		// uniform fallback ABOVE the new default. DEFAULT ON (user 2026-07-12, §10c#5+6): the host map now resolves on
		// EVERY dispatch (one cached `lms ps`) so every mapped host is gated at DEFAULT_HOST_CONCURRENCY_CAP=1 unless
		// Settings raises it; environments without `lms` (tests/simulator) resolve an empty map ⇒ no hostId ⇒ inert.
		const rawPerMachineCap = Number(process.env.NKLEIN_PER_MACHINE_MAX_CONCURRENCY);
		const legacyPerMachineCap =
			Number.isInteger(rawPerMachineCap) && rawPerMachineCap > 0 && residencyCheckEnabled ? rawPerMachineCap : null;
		const shouldResolveHostMap = residencyCheckEnabled;
		const hostMapProviderIds = [
			...new Set([...guardCandidates.values()].map((candidate) => candidate.entry.providerId)),
		];
		const hostMapEndpoints = [...new Set([...guardCandidates.values()].map((candidate) => candidate.entry.endpoint))];
		const lmsPsModelsForHostMap = shouldResolveHostMap
			? lmsPsModelsForResidency.length > 0
				? lmsPsModelsForResidency
				: await fetchLmsPsModelsCached(createDefaultLmsRunner())
			: [];
		const machineByModelIdRaw = shouldResolveHostMap
			? buildLmStudioMachineByModelId(lmsPsModelsForHostMap, {
					providerIds: hostMapProviderIds,
					endpoints: hostMapEndpoints,
				})
			: undefined;
		// Only key ROUTING pools by machine when the map resolved NON-EMPTY; an empty map (flag/config on but `lms ps`
		// unavailable) falls back to endpoint keying so routing never collapses into one synthetic pool. The admission
		// gate keeps using the RAW map below, unchanged, so its shipped behavior is untouched.
		const machineByModelId = machineByModelIdRaw && machineByModelIdRaw.size > 0 ? machineByModelIdRaw : undefined;
		// §5.AB per-machine pools: ONLY when per-endpoint/pool caps are configured, route the task to a free machine
		// pool (easy cards → secondary machines, hard → strong) and prefer the in-pool model. Inert by default (no
		// perEndpoint caps ⇒ poolRoutedModelKey stays null ⇒ selection unchanged). Behavior-changing only once an
		// operator configures pools; gate on the resolved per-endpoint caps so the default single-machine path is identical.
		const perEndpointPoolCaps: Record<string, number> = {
			...(scopedRuntimeConfig.concurrencyDefaults?.perEndpoint ?? {}),
			...(scopedRuntimeConfig.concurrencyOverride?.perEndpoint ?? {}),
		};
		let poolRoutedModelKey: string | null = null;
		if (Object.keys(perEndpointPoolCaps).length > 0) {
			const candidateList = roleScopedSelectionCandidates;
			// §5.AB LM-Link: the ROUTING pool key. With no machine map (flag off) it is the endpoint (byte-identical);
			// with a map it is the model's owning machine (endpoint fallback for an unmapped candidate), so LM-Link
			// machines sharing one endpoint are FANNED across distinct pools instead of collapsing into one.
			const poolKeyForCandidate = (candidate: (typeof candidateList)[number]): string =>
				derivePoolKeyForCandidate(candidate.entry.endpoint ?? "", candidate.entry.modelId, machineByModelId);
			const poolEndpoints = [
				...new Set(
					candidateList
						.filter((candidate) => !!candidate.entry.endpoint)
						.map((candidate) => poolKeyForCandidate(candidate)),
				),
			];
			const runningEndpoints = nkleinTaskSessionService
				.listModelEndpointSessions()
				.filter((session) => session.state === "running")
				// Map each running session's endpoint to its pool key the SAME way, so per-pool running counts line up
				// with the candidate pool keys above (endpoint unchanged when no map / model unmapped).
				.map((session) =>
					session.endpoint
						? derivePoolKeyForCandidate(session.endpoint, session.modelId, machineByModelId)
						: session.endpoint,
				);
			const route = selectSwarmRouteForTask({
				role: body.startInPlanMode ? "architect" : "worker",
				candidates: candidateList.flatMap((candidate) =>
					candidate.entry.endpoint
						? [
								{
									modelKey: candidate.entry.key,
									poolId: poolKeyForCandidate(candidate),
									capability: blendedCapabilityForKey(
										candidate.entry.key,
										candidate.entry.capability.effectiveScore,
										candidate.role,
										candidate.entry.modelId,
									),
									contextWindow: candidate.entry.contextWindow.effective ?? 0,
									predictedWallTimeMs: predictedWallTimeForCandidate(candidate),
									isFree: isModelFree(candidate.entry.key, candidate.entry.modelId),
								},
							]
						: [],
				),
				difficulty: taskDifficulty,
				requiredContextTokens,
				// Caps re-keyed onto the pool keys (endpoint caps unchanged when no map). Each machine pool inherits its
				// endpoint's configured cap under LM-Link; an uncapped endpoint stays uncapped.
				poolFreeSlots: computePoolFreeSlots(
					poolEndpoints,
					runningEndpoints,
					derivePoolCaps(
						candidateList
							.filter((candidate) => !!candidate.entry.endpoint)
							.map((candidate) => ({
								endpoint: candidate.entry.endpoint ?? "",
								modelId: candidate.entry.modelId,
							})),
						perEndpointPoolCaps,
						machineByModelId,
					),
				),
			});
			if (route.model?.selection.type === "assign") {
				poolRoutedModelKey = route.model.selection.modelKey;
			}
		}
		// §5.AQ (a)+(b) CACHE-WARMTH-AWARE routing: after the blend + verdict multiplier (inside
		// `blendedCapabilityForKey`) and the free-first/pool preference chain, prefer — margin-bounded — the
		// candidate whose last assembled prompt SHELL (session kind + workspace) matches this start, so a new card
		// lands on a model whose KV cache already holds most of its prefix (context RAILS fall out: re-drives
		// already stay on their session's model; new cards now prefer their workspace's warm models). STRICTLY a
		// tiebreaker: the warmth pick is expressed as the router's `preferredModelKey`, and `routeNKleinTask`'s
		// feasibility guards (difficulty floor + per-candidate context fit) remain authoritative — an infeasible
		// warm candidate is simply routed past (fail-open, never a correctness override). Card starts are
		// GENERATION picks with no §5.AB diversity constraint; DECISION-role picks apply diversity FIRST and
		// warmth only within the diverse set (see `pickDiverseReviewerModel`).
		const baselinePreferredKey = poolRoutedModelKey ?? freeFirstModelKey ?? preferredCandidate.entry.key;
		const warmthCandidatesByScore = roleScopedSelectionCandidates
			.map((candidate) => ({
				modelKey: candidate.entry.key,
				// The warmth ledger is keyed by the LAUNCH model id (what the prompt assembler records under).
				modelId: candidate.entry.modelId,
				score: blendedCapabilityForKey(
					candidate.entry.key,
					candidate.entry.capability.effectiveScore,
					candidate.role,
					candidate.entry.modelId,
				),
			}))
			.sort((left, right) => right.score - left.score);
		const warmthRanked = [
			// Anchor the baseline pick at rank 0 so the warmth margin is measured against what would ship WITHOUT
			// warmth (mirrors applyDiversityPreference's "within margin of the top" contract).
			...warmthCandidatesByScore.filter((candidate) => candidate.modelKey === baselinePreferredKey),
			...warmthCandidatesByScore.filter((candidate) => candidate.modelKey !== baselinePreferredKey),
		];
		const warmthPreference = applyWarmthPreference({
			ranked: warmthRanked,
			// Matches what the service will RECORD for this start (`derivePromptSessionKind` at the assemble seam):
			// an explicit-decomposition plan start assembles the architect shell; every other card start is a worker.
			sessionKind: body.startInPlanMode && isExplicitDecompositionPrompt(body.prompt) ? "architect" : "worker",
			workspacePath: workspaceScope.workspacePath,
			lastShellKeyByModel: nkleinTaskSessionService.getPromptWarmthLedger(),
			now: Date.now(),
		});
		const warmthPreferredKey = warmthPreference.warmthApplied ? (warmthPreference.ranked[0]?.modelKey ?? null) : null;
		// §5.I#4 speed-vs-capability dial: the USER'S explicit per-role bias, applied margin-bounded to the same
		// score-ranked list (baseline anchored at rank 0, mirroring warmth). It outranks warmth (an optimization)
		// but composes the same way — expressed as the router's preferred key, with routeNKleinTask's feasibility
		// guards authoritative. Omitted dial ⇒ "capability" ⇒ no-op ⇒ byte-identical routing.
		const dialPreference = applySpeedCapabilityDial({
			ranked: [
				...warmthRanked.map((candidate) => {
					const guardCandidate = guardCandidates.get(candidate.modelKey);
					return {
						modelKey: candidate.modelKey,
						fitScore: candidate.score,
						tokensPerSecond: guardCandidate ? tokensPerSecondForCandidate(guardCandidate) : null,
					};
				}),
			],
			dial: cardRoleSettings?.speedVsCapability,
		});
		const dialPreferredKey = dialPreference.reordered ? (dialPreference.ranked[0]?.modelKey ?? null) : null;
		const optimizationPreferredKey = dialPreferredKey ?? warmthPreferredKey ?? baselinePreferredKey;
		const routingDecision = routeNKleinTask({
			difficulty: taskDifficulty,
			fitBudgetTokens: requiredContextTokens,
			promptTokens,
			outputTokens: routingOutputTokens,
			preferredModelKey: honoredTaskPinKey ?? honoredRolePinKey ?? optimizationPreferredKey,
			candidates: roleScopedSelectionCandidates.map((candidate) => {
				const affinityTags = affinityTagsForCandidateModel(candidate.entry.modelId);
				return {
					entry: candidate.entry,
					role: candidate.role,
					observedCapability: blendedCapabilityForKey(
						candidate.entry.key,
						candidate.entry.capability.effectiveScore,
						candidate.role,
						candidate.entry.modelId,
					),
					predictedWallTimeMs: llmfitWallTimeForModel(candidate.entry.modelId),
					...(affinityTags ? { affinityTags } : {}),
				};
			}),
			taskAffinityTags,
		});
		// §5.AQ observability: when the warmth preference is what steered the routed pick, say so on the selection
		// reason the start log prints — the promotion is a surfaced signal (mirrors the diversity-waiver contract).
		const warmthReasonSuffix =
			warmthPreferredKey !== null &&
			(routingDecision.type === "assign" || routingDecision.type === "route_up") &&
			routingDecision.modelKey === warmthPreferredKey &&
			warmthPreference.warmthReason
				? ` Cache-warmth preference: ${warmthPreference.warmthReason}.`
				: "";
		// W2.5 observability: pin honored / unmatched pin is part of "why this model" — append the role-assignment
		// reasons (empty for the plain unconfigured auto path, so the common selectionReason stays byte-identical).
		const rolePinReasonSuffix = roleAssignment.reasons.length > 0 ? ` ${roleAssignment.reasons.join(" ")}` : "";
		const classIgnoredPinnedModel =
			roleAssignment.source === "pinned" &&
			roleAssignment.pick &&
			(freeFirstSelection.type !== "assign" || freeFirstSelection.modelKey !== roleAssignment.pick.modelKey)
				? roleAssignment.pick.modelKey
				: null;
		const classGateChangedBaseline =
			freeFirstSelection.type === "assign" && freeFirstSelection.modelKey !== selectedCandidate.entry.key;
		const roleClassReasonSuffix =
			classGateChangedBaseline || classIgnoredPinnedModel
				? freeFirstSelection.type === "assign"
					? ` Role class gate (${cardRole}) selected ${freeFirstSelection.modelKey}: ${freeFirstSelection.reason}`
					: ` Role class gate (${cardRole}) found no fit: ${freeFirstSelection.reason}`
				: "";
		const roleClassPinSuffix = classIgnoredPinnedModel
			? ` Pinned ${cardRole} model ${classIgnoredPinnedModel} was not used because it did not pass the role class/feasibility gate.`
			: "";
		const optimizationPreferenceReason =
			dialPreferredKey && dialPreferredKey !== baselinePreferredKey
				? `the ${cardRole} speed-vs-capability dial preferred it`
				: warmthPreferredKey && warmthPreferredKey !== baselinePreferredKey && warmthPreference.warmthReason
					? `cache-warmth preferred it: ${warmthPreference.warmthReason}`
					: poolRoutedModelKey && poolRoutedModelKey !== baselinePreferredKey
						? "pool routing preferred a less-busy model endpoint"
						: "automatic routing preferred it";
		const pinnedModelRecommendationSuffix =
			honoredRolePinKey && optimizationPreferredKey !== honoredRolePinKey
				? ` Pinned-model recommendation: ${optimizationPreferredKey} looks preferable because ${optimizationPreferenceReason}, but configured ${cardRole} pin ${honoredRolePinKey} was honored.`
				: "";
		const taskPinReasonSuffix =
			honoredTaskPinKey && taskModelPin
				? ` Pinned task model ${describeRuntimeTaskModelPin(taskModelPin)} is available — honoring the task model override.`
				: "";
		const taskModelRecommendationSuffix =
			honoredTaskPinKey && optimizationPreferredKey !== honoredTaskPinKey
				? ` Pinned-model recommendation: ${optimizationPreferredKey} looks preferable because ${optimizationPreferenceReason}, but task model override ${honoredTaskPinKey} was honored.`
				: "";
		// §5.AB "why this model" — explain the routing decision so the operator (and §5.AG surfaces) can see the basis.
		const selectionReason =
			renderModelSelectionReason(
				explainModelSelection({
					difficulty: taskDifficulty,
					requiredContextTokens,
					decisionKind: routingDecision.type,
					selectedModelKey:
						routingDecision.type === "assign" || routingDecision.type === "route_up"
							? routingDecision.modelKey
							: null,
					decisionReason: routingDecision.reason,
					taskAffinityTags,
					candidates: roleScopedSelectionCandidates.map((candidate) => {
						const ledgerSamples = ledgerSuccessByKey.get(candidate.entry.key)?.samples ?? 0;
						const affinityTags = affinityTagsForCandidateModel(candidate.entry.modelId);
						return {
							modelKey: candidate.entry.key,
							role: candidate.role,
							registryCapability: candidate.entry.capability.effectiveScore,
							observedCapability:
								ledgerSamples > 0
									? blendedCapabilityForKey(candidate.entry.key, candidate.entry.capability.effectiveScore)
									: null,
							ledgerSamples,
							contextWindow: candidate.entry.contextWindow.effective ?? 0,
							isFree: isModelFree(candidate.entry.key, candidate.entry.modelId),
							predictedWallTimeMs: predictedWallTimeForCandidate(candidate),
							...(affinityTags ? { affinityTags } : {}),
						};
					}),
				}),
			) +
			warmthReasonSuffix +
			taskPinReasonSuffix +
			rolePinReasonSuffix +
			roleClassReasonSuffix +
			roleClassPinSuffix +
			taskModelRecommendationSuffix +
			pinnedModelRecommendationSuffix;
		const routedModelKey =
			routingDecision.type === "assign" || routingDecision.type === "route_up" ? routingDecision.modelKey : null;
		if (taskModelPin && taskPinnedModelKey && routedModelKey !== taskPinnedModelKey) {
			return {
				ok: false,
				summary: null,
				error: createPinnedTaskModelUnavailableStartError(taskModelPin),
				errorCode: "pinned_model_unavailable",
				selectionReason,
			};
		}
		if (routingDecision.type === "decompose" || routingDecision.type === "escalate") {
			return {
				ok: false,
				summary: null,
				error: formatNKleinTaskRoutingBlockMessage(routingDecision),
				errorCode: routingDecision.type === "decompose" ? "needs_decomposition" : "routing_escalation",
				selectionReason,
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
		const launchHostId = machineByModelIdRaw?.get(nkleinLaunchConfig.modelId ?? "")?.trim() || null;
		const concurrencyCaps = resolveSessionConcurrencyCaps({
			providerId: nkleinLaunchConfig.providerId,
			modelId: buildNKleinModelRegistryKey({
				providerId: nkleinLaunchConfig.providerId,
				modelId: nkleinLaunchConfig.modelId ?? "",
				endpoint: nkleinLaunchConfig.baseUrl ?? null,
			}),
			// §5.AB per-machine pools: the endpoint/baseUrl is the machine pool key for the per-pool cap.
			endpoint: nkleinLaunchConfig.baseUrl ?? null,
			// §5.AB per-LM-Studio-host caps: the host id comes from `lms ps`; unmapped models skip host caps.
			hostId: launchHostId,
			global: scopedRuntimeConfig.concurrencyDefaults,
			override: scopedRuntimeConfig.concurrencyOverride,
			hostFallback: legacyPerMachineCap,
		});
		// §5.AB LM-Link per-HOST gate: admit per LM Studio host using the model→machine map resolved ONCE above. Settings
		// caps win per host; the legacy env acts only as the fallback cap. With no cap, the gate is inert.
		const endpointDecision = scheduleNKleinEndpointStart({
			taskId: body.taskId,
			providerId: nkleinLaunchConfig.providerId,
			modelId: nkleinLaunchConfig.modelId ?? "",
			endpoint: nkleinLaunchConfig.baseUrl ?? null,
			hostId: launchHostId,
			runningSessions: nkleinTaskSessionService.listModelEndpointSessions(),
			modelRegistry: modelRegistrySnapshot,
			now: Date.now(),
			providerConcurrencyCap: concurrencyCaps.providerCap,
			modelConcurrencyCap: concurrencyCaps.modelCap,
			endpointConcurrencyCap: concurrencyCaps.endpointCap,
			hostConcurrencyCap: concurrencyCaps.hostCap,
			// Keep the legacy uniform gate only for callers/tests that still pass it directly; runtime now resolves the env
			// fallback into hostConcurrencyCap above so explicit per-host caps can vary by machine.
			...(machineByModelIdRaw ? { machineByModelId: machineByModelIdRaw } : {}),
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
			if (body.queueOnEndpointBusy) {
				// The card is admitted (board capacity held) but waiting on the endpoint — kernel-truth for the queue.
				dispatchWorkflowStartCommands(workspaceScope, body.taskId, ["start_requested", "board_capacity_granted"]);
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
		// §5.AU: fold the card's pending mailbox notes (chat guidance queued while it waited) into the opening
		// prompt — the "consumed as opening context when the card starts WORK" half of the communication/execution
		// split. Every start path funnels through this handler, so nothing queued is silently dropped. Read the
		// notes NON-destructively here and only mark them consumed AFTER the start succeeds (below) — a start that
		// throws (Docker down, bad baseRef, stale workspace) then leaves the guidance pending for the next attempt
		// instead of losing it. Best-effort: a mailbox read failure must never block a start.
		const mailboxNotes = await listPendingCardMailbox(body.taskId).catch(() => []);
		const promptWithMailbox = `${body.prompt}${composeMailboxPromptAddendum(mailboxNotes)}`;
		const summary = await nkleinTaskSessionService.startTaskSession({
			taskId: body.taskId,
			cwd: workspaceScope.workspacePath,
			workspaceRoot: workspaceScope.workspacePath,
			baseRef: body.baseRef,
			prompt: promptWithMailbox,
			taskTitle: resolvedNKleinTitle.length > 0 ? resolvedNKleinTitle : undefined,
			images: body.images,
			filesLikelyTouched: body.filesLikelyTouched,
			writeScope: body.writeScope,
			forbiddenPaths: body.forbiddenPaths,
			resumeFromTrash: body.resumeFromTrash,
			providerId: nkleinLaunchConfig.providerId,
			modelId: nkleinLaunchConfig.modelId,
			// §5.BG: the stable publisher key for the chosen model — telemetry keys off this, not the runtime id. Prefer
			// the LIVE descriptor, then the PERSISTED map (so a COLD/not-currently-loaded model still resolves), else null
			// (cloud/unknown ⇒ the service falls back to the runtime id).
			stableModelKey: nkleinLaunchConfig.modelId
				? (stableModelKeyByRuntimeId.get(nkleinLaunchConfig.modelId) ??
					sharedRuntimeIdModelKeyMap()[nkleinLaunchConfig.modelId] ??
					null)
				: null,
			mode: requestedNKleinTaskMode,
			startInPlanMode: body.startInPlanMode,
			apiKey: nkleinLaunchConfig.apiKey,
			baseUrl: nkleinLaunchConfig.baseUrl,
			reasoningEffort: nkleinLaunchConfig.reasoningEffort,
			contextScope: body.nkleinSettings?.contextScope,
			// §5.AE forward the user's effective skill-dynamics level so the session-service's skill-fragment resolution
			// honors the SAME setting as the affinity-tag resolveActiveSkills above (was defaulting to fully_dynamic).
			skillDynamicsLevel: scopedRuntimeConfig.effectiveSkillDynamicsLevel,
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

		// The start SUCCEEDED and the mailbox-augmented prompt is now bound into the session — durably consume the
		// notes we folded in. Do this FIRST (before the best-effort lane reconcile below), so the durability-critical
		// consume can never be skipped by a later step throwing. Consume by EXACT id (the notes we actually read), not
		// just a timestamp boundary — a note that arrives during the start window can share the same millisecond as
		// the newest note we read (bug-hunt 2026-07-05), and an id-set has no such tie ambiguity: it stays pending for
		// the next turn rather than being wrongly swept up.
		if (mailboxNotes.length > 0) {
			const newestConsumedAt = mailboxNotes[mailboxNotes.length - 1]?.createdAt;
			if (newestConsumedAt !== undefined) {
				await markCardMailboxConsumedUpTo(
					body.taskId,
					newestConsumedAt,
					undefined,
					mailboxNotes.map((note) => note.id),
				).catch(() => {});
			}
		}

		// Starting a task must move its card out of backlog (→ planning / in_progress) so the board reflects
		// that the agent is now working it — a card should never show agent activity while it sits in backlog.
		// Previously only the input/resume paths reconciled the lane, so a freshly-started card (e.g. a
		// dev-test seed started programmatically) stayed in backlog. Best-effort; never blocks the start.
		await reconcileStartedTaskBoardLane({
			workspacePath: workspaceScope.workspacePath,
			summary,
		});

		// F1.27b (leaf 2): the session is RUNNING — every admission grant has effectively happened. Held
		// duplicates absorb the queued-start re-entry; the mirror lands on `planning` (§5.B entry lane).
		dispatchWorkflowStartCommands(workspaceScope, body.taskId, [
			"start_requested",
			"board_capacity_granted",
			"endpoint_granted",
			"sandbox_granted",
		]);
		return {
			ok: true,
			summary,
			selectionReason,
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
