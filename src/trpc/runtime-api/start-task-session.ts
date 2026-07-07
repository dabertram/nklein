import type { RuntimeTaskSessionStartRequest, RuntimeTaskSessionStartResponse } from "../../core/api-contract";
import { parseTaskSessionStartRequest } from "../../core/api-validation";
import { applyWarmthPreference } from "../../core/cache-warmth";
import { createCapabilityBlender } from "../../core/capability-blend";
import { resolveSessionConcurrencyCaps } from "../../core/concurrency-config";
import { isEnabledByDefaultEnv, isTruthyEnv } from "../../core/env-flag";
import { isHomeAgentSessionId } from "../../core/home-agent-session";
import { buildLedgerEvidence } from "../../core/ledger-evidence";
import { createDefaultLmsRunner, fetchLmsPsModelsCached } from "../../core/lms-ps-json";
import { fetchLoadedModelDescriptors } from "../../core/lmstudio-loaded-model-descriptors";
import { fetchLoadedModelIdsCached, shouldBlockUnloadedModel } from "../../core/lmstudio-loaded-models";
import { DEFAULT_LOCAL_MODEL_BASE_URL } from "../../core/local-model-endpoint";
import { assessModelSuitability, resolveActiveModelSuitabilityPolicy } from "../../core/model-capability-catalog";
import { classifyModelClass, isModelAllowedByClassCap } from "../../core/model-class-cap";
import { derivePoolCaps, derivePoolKeyForCandidate } from "../../core/model-pool-key";
import { computePoolFreeSlots } from "../../core/model-pool-routing";
import { explainModelSelection, renderModelSelectionReason } from "../../core/model-selection-reason";
import { selectSwarmRouteForTask } from "../../core/model-swarm-route";
import { affinityTagsForSkills } from "../../core/model-task-affinity";
import { selectRoleModel } from "../../core/role-model-selection";
import { resolveActiveSkills } from "../../core/skill-resolver";
import { readSwarmStopSignal } from "../../core/swarm-guardrails";
import { resolveSwarmRoleModel } from "../../core/swarm-role-selection";
import { reconcileStartedTaskBoardLane } from "../../core/task-board-lane-reconcile";
import { resolveTaskTitle } from "../../core/task-title";
import { createNKleinCodeEmbeddingProviderFromSettings } from "../../nklein-agent/nklein-code-embeddings";
import { isNKleinContextWindowPolicyError } from "../../nklein-agent/nklein-context-window-policy";
import { scheduleNKleinEndpointStart } from "../../nklein-agent/nklein-endpoint-scheduler";
import type { LoadedModelRoutingProfile } from "../../nklein-agent/nklein-loaded-model-candidates";
import { resolveLoadedModelProfile } from "../../nklein-agent/nklein-loaded-model-profile";
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
		let nkleinLaunchConfig: ResolvedNKleinLaunchConfig;
		try {
			nkleinLaunchConfig = await deps.nkleinProviderService.resolveLaunchConfig({
				providerIdOverride: body.nkleinSettings?.providerId ?? undefined,
				modelIdOverride: body.nkleinSettings?.modelId ?? undefined,
				...(hasTaskLevelNKleinSettingsOverride
					? {
							reasoningEffortOverride: body.nkleinSettings?.reasoningEffort ?? null,
						}
					: {}),
			});
		} catch (primaryError) {
			// §5.AB: the DEFAULT model didn't resolve (e.g. a stale default → an unloaded variant). Fall back to an
			// already-loaded model so the card still starts. Only for the default case — an EXPLICIT model keeps its error.
			const fallback = body.nkleinSettings?.modelId
				? null
				: await resolveLoadedFallbackLaunchConfig({
						resolveLaunchConfig: (overrides) => deps.nkleinProviderService.resolveLaunchConfig(overrides),
						// Use the configured provider endpoint (not a hardcoded localhost) so the fallback also works for a
						// LAN/remote LM Studio; default to the local endpoint when the provider carries no explicit baseUrl.
						baseUrl:
							deps.nkleinProviderService.getProviderSettingsSummary().baseUrl ?? DEFAULT_LOCAL_MODEL_BASE_URL,
					});
			if (!fallback) {
				throw primaryError;
			}
			nkleinLaunchConfig = fallback;
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
		const loadedModelIds =
			residencyCheckEnabled && isLocalProvider(nkleinLaunchConfig.providerId, nkleinLaunchConfig.baseUrl)
				? await fetchLoadedModelIdsCached(residencyBaseUrl)
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
		// §5.BG: runtime id → STABLE publisher key for the loaded set, so the chosen model's telemetry keys off the
		// stable key (not the renamable runtime id). Populated only when descriptors are fetched (local + residency on).
		const stableModelKeyByRuntimeId = new Map<string, string>();
		if (residencyCheckEnabled && isLocalProvider(nkleinLaunchConfig.providerId, nkleinLaunchConfig.baseUrl)) {
			try {
				const loadedDescriptors = await fetchLoadedModelDescriptors(residencyBaseUrl);
				// §5.BG: learn each loaded runtime id's stable key into the persisted map so a COLD model still resolves.
				learnSharedLoadedDescriptors(loadedDescriptors);
				for (const descriptor of loadedDescriptors) {
					const profile = resolveLoadedModelProfile(descriptor);
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
		// reuse for both the swarm free-pick (`selectRoleModel`) and the main router (`routeNKleinTask`).
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
		const selfObservationEvents = await readSelfObservationEvents({ limit: 500 }).catch(
			() => [] as Awaited<ReturnType<typeof readSelfObservationEvents>>,
		);
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
		// W2.5 role auto-assignment (auto is the DEFAULT): the card's role never REQUIRES a configured model — a
		// configured effectiveModelRoles entry is an optional PIN layered on top of automatic selection, resolved
		// through the pure core so pin-vs-auto semantics + reasons are uniform across seams. A loaded pin wins
		// (byte-equivalent with the previous ad-hoc architect-role preference, including its primary-then-pool
		// insertion order via the role-tagged candidates); a configured-but-unavailable pin FALLS THROUGH to the
		// auto chain below with the waiver surfaced on selectionReason (previously a silent fallback) — never a
		// hard start failure. Act-mode cards layer the worker pin only when the card carries no explicit model
		// choice (a decompose-pinned nkleinSettings model outranks the role config — the §5.AB carry-through);
		// plan mode keeps its shipped architect-over-card-settings precedence. The downstream free-first/pool/
		// warmth/router chain stays authoritative for feasibility and availability (a pin is a preference here,
		// not a bypass), and the task-start residency gate above is untouched (an explicitly chosen unloaded
		// model still hard-fails with the clear "load it first" error — deliberate §5.AB no-load safety).
		const cardRole = body.startInPlanMode ? ("architect" as const) : ("worker" as const);
		const cardRoleSettings = scopedRuntimeConfig.effectiveModelRoles[cardRole];
		const cardRoleHasConfiguredModel = Boolean(
			cardRoleSettings &&
				[cardRoleSettings, ...(cardRoleSettings.additionalModels ?? [])].some(
					(model) => model.providerId || model.modelId,
				),
		);
		const rolePinApplies = body.startInPlanMode || !(body.nkleinSettings?.providerId || body.nkleinSettings?.modelId);
		const cardRolePin =
			rolePinApplies && cardRoleHasConfiguredModel
				? { providerId: cardRoleSettings?.providerId ?? null, modelId: cardRoleSettings?.modelId ?? null }
				: null;
		const roleAssignment = resolveSwarmRoleModel({
			role: cardRole,
			pinned: cardRolePin,
			candidates: [...guardCandidates.values()].map((candidate) => ({
				modelKey: candidate.entry.key,
				modelId: candidate.entry.modelId,
				score: blendedCapabilityForKey(
					candidate.entry.key,
					candidate.entry.capability.effectiveScore,
					candidate.role,
					candidate.entry.modelId,
				),
				// Pin membership = the candidate came from the card role's configured pool (primary or member).
				isPinned: candidate.role === cardRole,
			})),
		});
		const preferredCandidate =
			roleAssignment.source === "pinned" && roleAssignment.pick
				? (guardCandidates.get(roleAssignment.pick.modelKey) ?? selectedCandidate)
				: selectedCandidate;
		const freeFirstSelection = selectRoleModel({
			candidates: [...guardCandidates.values()].map((candidate) => ({
				modelKey: candidate.entry.key,
				capability: blendedCapabilityForKey(
					candidate.entry.key,
					candidate.entry.capability.effectiveScore,
					candidate.role,
				),
				contextWindow: candidate.entry.contextWindow.effective ?? 0,
				predictedWallTimeMs: candidate.entry.speed.wallTimeMsEwma,
				isFree: isModelFree(candidate.entry.key, candidate.entry.modelId),
			})),
			difficulty: taskDifficulty,
			requiredContextTokens,
			weighting: "efficient",
		});
		const freeFirstModelKey =
			runningModelKeys.has(preferredCandidate.entry.key) &&
			freeFirstSelection.type === "assign" &&
			!freeFirstSelection.busyFallback
				? freeFirstSelection.modelKey
				: null;
		// §5.AB LM-Link per-MACHINE handling (opt-in via NKLEIN_PER_MACHINE_MAX_CONCURRENCY): resolved ONCE here and
		// reused for BOTH the routing pool keys (below) and the admission gate (further down) — a SINGLE `lms ps`
		// subprocess. When set, fetch each loaded model's owning machine so LM-Link machines sharing one endpoint are
		// told apart. OFF by default ⇒ no subprocess, `machineByModelIdRaw` stays undefined ⇒ routing keeps ENDPOINT
		// keys and the admission gate stays inert (byte-identical). Best-effort: an empty/failed map ⇒ endpoint keying.
		const rawPerMachineCap = Number(process.env.NKLEIN_PER_MACHINE_MAX_CONCURRENCY);
		const perMachineCap =
			Number.isInteger(rawPerMachineCap) && rawPerMachineCap > 0 && residencyCheckEnabled ? rawPerMachineCap : null;
		const machineByModelIdRaw =
			perMachineCap !== null
				? new Map(
						(await fetchLmsPsModelsCached(createDefaultLmsRunner())).map((model) => [
							model.identifier,
							model.machineId,
						]),
					)
				: undefined;
		// Only key ROUTING pools by machine when the map resolved NON-EMPTY; an empty map (flag on but `lms ps`
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
			const candidateList = [...guardCandidates.values()];
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
									predictedWallTimeMs: candidate.entry.speed.wallTimeMsEwma,
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
		const warmthCandidatesByScore = [...guardCandidates.values()]
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
		const routingDecision = routeNKleinTask({
			difficulty: taskDifficulty,
			fitBudgetTokens: requiredContextTokens,
			promptTokens,
			outputTokens: 1_000,
			preferredModelKey: warmthPreferredKey ?? baselinePreferredKey,
			candidates: [...guardCandidates.values()].map((candidate) => {
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
		// W2.5 observability: pin honored / pin waived is part of "why this model" — append the role-assignment
		// reasons (empty for the plain unconfigured auto path, so the common selectionReason stays byte-identical).
		const rolePinReasonSuffix = roleAssignment.reasons.length > 0 ? ` ${roleAssignment.reasons.join(" ")}` : "";
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
					candidates: [...guardCandidates.values()].map((candidate) => {
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
							predictedWallTimeMs: candidate.entry.speed.wallTimeMsEwma,
							...(affinityTags ? { affinityTags } : {}),
						};
					}),
				}),
			) +
			warmthReasonSuffix +
			rolePinReasonSuffix;
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
		const concurrencyCaps = resolveSessionConcurrencyCaps({
			providerId: nkleinLaunchConfig.providerId,
			modelId: buildNKleinModelRegistryKey({
				providerId: nkleinLaunchConfig.providerId,
				modelId: nkleinLaunchConfig.modelId ?? "",
				endpoint: nkleinLaunchConfig.baseUrl ?? null,
			}),
			// §5.AB per-machine pools: the endpoint/baseUrl is the machine pool key for the per-pool cap.
			endpoint: nkleinLaunchConfig.baseUrl ?? null,
			global: scopedRuntimeConfig.concurrencyDefaults,
			override: scopedRuntimeConfig.concurrencyOverride,
		});
		// §5.AB LM-Link per-MACHINE gate (opt-in via NKLEIN_PER_MACHINE_MAX_CONCURRENCY): admit per MACHINE using the
		// model→machine map resolved ONCE above (the linked machines share one endpoint). OFF by default ⇒ the raw map
		// is undefined ⇒ no gate (byte-identical). Best-effort: an empty raw map leaves the gate inert, as before.
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
			endpointConcurrencyCap: concurrencyCaps.endpointCap,
			...(perMachineCap !== null ? { perMachineCap } : {}),
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
		await reconcileStartedTaskBoardLane({ workspacePath: workspaceScope.workspacePath, summary });

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
