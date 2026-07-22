import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { filterToolsByPolicyEnabled } from "../core/judge-tool-policy";
import { normalizeProviderBaseUrl } from "../core/openai-compat-base-url";
import { decideResearchFreshnessGate } from "../core/research-freshness-gate";
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

import { resolveOutwardFanoutCap } from "../core/action-fanout-cap";
import { buildRetrievalEvent } from "../core/agent-attempt-ledger";
import { isAirGappedMode } from "../core/air-gap-posture";
import {
	RUNTIME_NKLEIN_DEFAULT_CONTEXT_WINDOW_TOKENS,
	type RuntimeTaskImage,
	type RuntimeTaskSessionMode,
} from "../core/api-contract";
import { isEnabledByDefaultEnv, isTruthyEnv } from "../core/env-flag";
import { preferredEndpointKind } from "../core/model-behavior-profile";
import { isMeasuredRetrievalDiscriminatorModel } from "../core/retrieval-discriminator";
import { appendAgentLedgerEvent } from "../state/agent-attempt-ledger-store";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import { createAdaptiveSwarmRecoveryModel } from "./adaptive-swarm-recovery-model";
import { createLocalAlternateEndpointModel } from "./local-alternate-endpoint-model";
import {
	createActionPlanExecutionTool,
	createActionPlanProducerModel,
	selectActionPlanTools,
} from "./nklein-action-plan-mode";
import { resolveNKleinAgentPerceivedCwd } from "./nklein-agent-sandbox";
import { createNKleinArchitectBriefTool } from "./nklein-architect-tool";
import { createNKleinCodeEmbeddingProvider } from "./nklein-code-embeddings";
import { compactKanbanFocusedMessages } from "./nklein-context-focus-policy";
import { createNKleinDecompositionTools } from "./nklein-decomposition-tool";
import { createEditFileTool } from "./nklein-edit-file-tool";
import { extractNKleinSessionId } from "./nklein-event-adapter";
import { createNKleinExplorerCitationsTool, createNKleinExploreTool } from "./nklein-explorer-tool";
import { createFileDiscoveryTools } from "./nklein-file-discovery-tools";
import { createNKleinFocusChainTool } from "./nklein-focus-chain-tool";
import {
	createReadLargeFileTool,
	getNKleinLargeFileWorkflow,
	releaseAllNKleinLargeFileWorkflows,
	releaseNKleinLargeFileWorkflow,
} from "./nklein-large-file-workflow";
import { hashWorkspacePathForLedger } from "./nklein-ledger-attempt";
import { LocalLlmClient } from "./nklein-local-llm-client";
import { CLOUD_ENABLED } from "./nklein-local-only-policy";
import {
	createNKleinMcpRuntimeService,
	type NKleinMcpRuntimeService,
	type NKleinMcpToolBundle,
} from "./nklein-mcp-runtime-service";
import { createNKleinMergeResolutionTool } from "./nklein-merge-resolution-tool";
import { buildKanbanModelToolRoutingRules } from "./nklein-model-tool-routing";
import { createNKleinPlanCritiqueTool } from "./nklein-plan-critique-tool";
import { createPredictOutputTool } from "./nklein-predict-output-tool";
import { createNKleinPromotionTool } from "./nklein-promotion-tool";
import { createRequestCompactionTool } from "./nklein-request-compaction-tool";
import { createSessionResultHandles } from "./nklein-result-handle-tool";
import { createLocalModelRetrievalDiscriminator } from "./nklein-retrieval-discriminator";
import { createNKleinRetrievalTools } from "./nklein-retrieval-tools";
import { createNKleinReviewTool } from "./nklein-review-tool";
import { createKanbanNKleinLogger } from "./nklein-runtime-logger";
import { resolveContextWindowTokens, resolveSdkApiTimeoutMs, toSdkUserImages } from "./nklein-session-sdk-inputs";
import { buildSessionIdPrefix, createSessionId } from "./nklein-session-state";
import {
	createSwarmToolBrokerState,
	type SwarmToolBrokerState,
	type SwarmToolHardDenial,
	wrapSwarmAgentTools,
	wrapSwarmToolExecutors,
} from "./nklein-swarm-tool-broker";
import { resolveNKleinTeamDelegationPolicy } from "./nklein-team-delegation";
import { createWebResearchTool } from "./nklein-web-research-tool";
import { createWriteFilesTool, createWriteFileTool } from "./nklein-write-files-tool";
import { createRunawayInterruptModel } from "./runaway-interrupt-model";
import type { AgentTool } from "./sdk-agent-types";
import { NKLEIN_MODEL_CATALOG_DEFAULTS } from "./sdk-provider-boundary";
import {
	createNKleinSdkSessionHost,
	type NKleinSdkPersistedMessage,
	type NKleinSdkSessionRecord,
	type NKleinSdkStartSessionInput,
	type NKleinSdkTeamEvent,
} from "./sdk-runtime-boundary";
import { createSkillApiProfileAgentModel } from "./skill-api-profile-agent-model";
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

/** Run-controller evidence seam: auxiliary sessions are deleted immediately after their bounded turn, so periodic
 * polling can miss the final submission/result. When explicitly enabled, preserve the exact final messages before
 * deletion. Ordinary product runs do no extra I/O. */
async function snapshotSessionBeforeEvidenceDeletion(
	sessionHost: NKleinSessionHostBoundary,
	sessionId: string,
): Promise<void> {
	const outputDir = process.env.NKLEIN_EVIDENCE_SESSION_SNAPSHOT_DIR?.trim();
	if (!outputDir) {
		return;
	}
	const messages = await sessionHost.readMessages(sessionId);
	await mkdir(outputDir, { recursive: true });
	await writeFile(
		join(outputDir, `${sessionId}.messages.json`),
		`${JSON.stringify({ sessionId, messages }, null, 2)}\n`,
		"utf8",
	);
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
	/** Accepted model turns, independent of their asynchronously projected summary state. */
	private readonly turnGenerationByTaskId = new Map<string, number>();
	// F1.21: the swarm broker state per task, so the terminal write can record the session's accumulated taint.
	private readonly swarmBrokerStateByTaskId = new Map<string, SwarmToolBrokerState>();
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
			sourcePrompt: request.sourcePrompt ?? request.prompt,
			providerId: request.providerId,
			modelId: request.modelId,
			mode: resolvedMode,
			executionMode: request.executionMode,
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
				memoryWriteProvenance: { authorModelKey: request.modelId, taskId: request.taskId },
				sandboxExecTarget: request.sandboxMcpExecTarget ?? null,
				...(request.basicMemoryExecEnv ? { basicMemoryExecEnv: request.basicMemoryExecEnv } : {}),
				...(request.basicMemoryEnabled !== undefined ? { basicMemoryEnabled: request.basicMemoryEnabled } : {}),
				...(request.sandboxMcpServerControls ? { sandboxMcpServerControls: request.sandboxMcpServerControls } : {}),
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
		const sessionResultHandles = createSessionResultHandles();
		const retrievalDiscriminator =
			request.baseUrl?.trim() && isMeasuredRetrievalDiscriminatorModel(request.modelId)
				? createLocalModelRetrievalDiscriminator(
						new LocalLlmClient({
							providerId: request.providerId,
							modelId: request.modelId,
							baseUrl: request.baseUrl,
							apiKey: request.apiKey,
							...(request.apiTimeoutMs
								? { timeoutMs: Math.min(request.apiTimeoutMs, 15_000) }
								: { timeoutMs: 15_000 }),
						}),
					)
				: undefined;
		const workspaceExtraTools =
			request.extraTools ??
			([
				...createNKleinRetrievalTools({
					workspacePath: agentPerceivedCwd,
					embeddingProvider: request.codeEmbeddingProvider ?? createNKleinCodeEmbeddingProvider(),
					taskContext: request.sourcePrompt ?? request.prompt,
					...(retrievalDiscriminator ? { discriminateRetrieval: retrievalDiscriminator } : {}),
					// §5.AC: record each search_code turn to the agent ledger (workflowId = taskId; signal stays "unknown"
					// — this seam knows what was retrieved, not whether it helped). Best-effort; never breaks the tool.
					recordRetrieval: (retrieval) => {
						void appendAgentLedgerEvent(
							buildRetrievalEvent({
								taskId: request.taskId,
								workflowId: request.taskId,
								// FIX 2026-07-20: this is a LEDGER KEY, so it must hash the HOST path — every reader
								// (readAgentLedger callers in the review runner, start-task-session, runtime-server,
								// the dev CLIs) derives its hash from a host path. Hashing `agentPerceivedCwd` wrote
								// retrieval events under `/workspaces/<taskId>`, a key nothing ever computes, so they
								// were invisible to every consumer — the ledger held ZERO retrieval events across all
								// 76 workspace hashes despite this call site being wired. The retrieval TOOL above
								// correctly uses `agentPerceivedCwd` (it operates in the agent's filesystem); only the
								// control-plane key is host-scoped. Same class as the repo-map bug the extension
								// docblock records.
								workspacePathHash: hashWorkspacePathForLedger(hostWorkspaceRoot),
								query: retrieval.query,
								hitsConsidered: retrieval.hitsConsidered,
								// F11.2e: tool-side distractor prunes (ego_graph hub names today) reach the ledger so
								// the precision telemetry sees kept vs dropped, not just kept.
								distractorsPruned: retrieval.pruned ?? 0,
								citations: retrieval.citations,
							}),
						).catch(() => {});
					},
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
		const rawExtraTools: AgentTool[] = [
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
				sourcePrompt: request.sourcePrompt ?? request.prompt,
				onApplied: request.onDecompositionApplied,
				requestPlanCritique: request.requestPlanCritique,
				requestClarifyTurn: request.requestClarifyTurn,
			}),
			...workspaceExtraTools,
			...(mcpToolBundle?.tools ?? []),
			// F12.96 predict-then-execute: let the worker state its expected acceptance output BEFORE the run; the
			// acceptance seam compares prediction vs reality (record-only) — a divergence localizes mental-trace bugs.
			...createPredictOutputTool(request.taskId),
			// F12.6 self-compaction: the agent proposes a safe forget-moment, the rubric disposes (fire/hold); a
			// fire records a per-task request the service consults at the next turn boundary (budget fallback intact).
			...createRequestCompactionTool(request.taskId),
			// F4.7: stable-shell resolver for per-session large result handles. Its schema is present from turn one so a
			// later oversized read/search/command result does not churn the tool-prefix cache when the handle appears.
			sessionResultHandles.tool,
			// ---- CONDITIONAL TAIL (config/kind-divergent tools only, slowest-churning gate first) ----
			...createWebResearchTool({
				// F12.101: the enforcing air-gap switch hard-closes web research regardless of the enable flag.
				enabled:
					CLOUD_ENABLED &&
					useHostWorkspaceTools &&
					process.env.KANBAN_ENABLE_WEB_RESEARCH === "1" &&
					!isAirGappedMode(),
				// F4.2: the freshness gate's advisory (topic volatility vs local-knowledge age) rides the tool
				// description so retrieval is staleness-REASONED, not just egress-gated. Local knowledge age is
				// unknown at assembly ⇒ the gate leans on volatility alone (fast-moving topics push online).
				freshnessAdvisory: decideResearchFreshnessGate({
					taskText: request.prompt ?? "",
					knowledgeAt: null,
					now: new Date(),
					egressAvailable: true,
				}).reason,
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
			// F11.2j `::explore` turns get the structured `submit_citations` findings tool — same gating pattern.
			...(request.onExplorerCitationsSubmitted
				? [createNKleinExplorerCitationsTool({ onSubmitted: request.onExplorerCitationsSubmitted })]
				: []),
			...(request.onArchitectBriefSubmitted
				? [createNKleinArchitectBriefTool({ onSubmitted: request.onArchitectBriefSubmitted })]
				: []),
			// F11.2j worker sessions get the `explore` delegation tool when the service wired a query handler.
			...(request.runExplorerQuery ? [createNKleinExploreTool(request.runExplorerQuery)] : []),
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
		const mcpToolNames = new Set((mcpToolBundle?.tools ?? []).map((tool) => tool.name));
		// S9: a GENEROUS session-total outward-action backstop is default-ON (only trips on egregious injection-driven
		// fan-out / API-exhaustion; realistic sessions stay far under it). Tune or disable via NKLEIN_OUTWARD_FANOUT_CAP.
		const outwardFanoutCap = resolveOutwardFanoutCap(process.env.NKLEIN_OUTWARD_FANOUT_CAP);
		const swarmToolBrokerState = createSwarmToolBrokerState(
			[],
			outwardFanoutCap === null ? {} : { maxTotal: outwardFanoutCap },
		);
		this.swarmBrokerStateByTaskId.set(request.taskId, swarmToolBrokerState);
		// Offer-layer policy filter: the SDK only policy-filters extension-registered tools — config-declared tools
		// merge unfiltered — so a disabled tool's schema still reached the model (28KB judge block, live 2026-07-18).
		const extraTools = filterToolsByPolicyEnabled(
			wrapSwarmAgentTools(rawExtraTools, swarmToolBrokerState, { mcpToolNames }),
			request.toolPolicies,
		);
		const toolExecutors = wrapSwarmToolExecutors(request.toolExecutors, swarmToolBrokerState, { mcpToolNames });
		const actionPlanTools = selectActionPlanTools(extraTools, mcpToolNames);
		const sessionExtraTools =
			request.executionMode === "action_plan"
				? [
						createActionPlanExecutionTool({
							tools: actionPlanTools,
							requestToolApproval,
							mcpToolNames,
							onCheckpoint: ({ completedStepIds, latestStepId }) => {
								recordSelfObservation({
									signal: "custom",
									severity: "info",
									message: `ActionPlan checkpoint ${latestStepId} completed for ${request.taskId}.`,
									taskId: request.taskId,
									providerId: request.providerId,
									modelId: request.modelId,
									workspacePath: hostWorkspaceRoot,
									metadata: {
										category: "action_plan_checkpoint",
										latestStepId,
										completedStepIds,
									},
								});
							},
						}),
					]
				: extraTools;

		const sessionHost = await this.ensureSessionHost();
		const userImages = toSdkUserImages(request.images);
		const shouldSendInitialTurn = request.prompt.trim().length > 0 || Boolean(userImages?.length);
		// The local SDK treats a session seeded with history but no start prompt as a read-only resume: it persists the
		// messages and transitions the session to completed before a later `send` can run. In a live cross-model carry
		// that left the replacement manifest at running after `agent_start`, emitted no LM Studio request, and never
		// appended the carry prompt (run 20260721-165902). Start the first turn atomically whenever retained history is
		// present; fresh sessions keep the established start-then-send path.
		const runInitialTurnInStart = Boolean(request.initialMessages?.length) && shouldSendInitialTurn;
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
			// A bare-host base makes the SDK POST /chat/completions at the server root — LM Studio 200s it EMPTY
			// (live 2026-07-18: every session "completed" instantly with no output). Normalize to the /v1 API root.
			...(request.baseUrl?.trim() ? { baseUrl: normalizeProviderBaseUrl(request.providerId, request.baseUrl) } : {}),
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
			baseUrl: request.baseUrl?.trim() ? normalizeProviderBaseUrl(request.providerId, request.baseUrl) : undefined,
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
			if (runInitialTurnInStart) {
				this.bumpTaskTurnGeneration(request.taskId);
			}
			// Hub-backed SDK hosts create the interactive session in start; the first turn runs through send.
			startResult = await sessionHost.start({
				config,
				initialMessages: request.initialMessages,
				...(runInitialTurnInStart
					? {
							prompt: request.prompt,
							userImages,
						}
					: {}),
				interactive: true,
				localRuntime: {
					modelCatalogDefaults: NKLEIN_MODEL_CATALOG_DEFAULTS,
					// F3.10: buffer at the shared AgentModel seam so a failed provider turn can be replaced by the next
					// executable shared-policy rung before any partial text/reasoning/usage event becomes visible. Caller
					// cancellation is authoritative, and a turn that emitted a tool call is never replayed.
					modelWrapper: (base) => {
						const guardedBase = isTruthyEnv(process.env.NKLEIN_RUNAWAY_ABORT)
							? createRunawayInterruptModel(base, {
									onInterrupt: (verdict) => {
										process.stderr.write(
											`[nklein] Runaway generation interrupted for ${request.taskId}: ${verdict.detail ?? verdict.reason ?? "degenerate output"}\n`,
										);
										// F4.8b: an ABORTED TURN was reported only to stderr — not countable, not
										// attributable to a card, gone the moment the process exits. This mechanism kills
										// a generation mid-flight; how often it does so is both the argument for enabling
										// it and the first thing you would want after a card behaved oddly.
										try {
											recordSelfObservation({
												signal: "custom",
												severity: "warning",
												message: `Runaway generation interrupted for ${request.taskId}: ${verdict.detail ?? verdict.reason ?? "degenerate output"}`,
												taskId: request.taskId,
												metadata: {
													category: "runaway_generation_interrupted",
													reason: verdict.reason ?? null,
													detail: verdict.detail ?? null,
												},
											});
										} catch {
											// Telemetry must never break an interrupt.
										}
									},
								})
							: base;
						const directClient = request.baseUrl?.trim()
							? new LocalLlmClient({
									providerId: request.providerId,
									modelId: request.modelId,
									baseUrl: request.baseUrl,
									apiKey: request.apiKey,
									...(request.apiTimeoutMs ? { timeoutMs: request.apiTimeoutMs } : {}),
								})
							: undefined;
						const profileOptions = {
							modelId: request.modelId,
							profile: request.skillApiProfile,
							contextWindow: request.contextWindow,
							...(directClient ? { directClient } : {}),
						};
						const alternateEndpointModel = request.baseUrl?.trim()
							? createLocalAlternateEndpointModel({
									baseUrl: request.baseUrl,
									modelId: request.modelId,
									baseMaxTokens: request.maxTokensPerTurn,
									headers: request.apiKey?.trim()
										? { authorization: `Bearer ${request.apiKey.trim()}` }
										: undefined,
									preferredKind: request.behaviorProfile
										? preferredEndpointKind(request.behaviorProfile)
										: null,
									onWinningKind: (kind) => {
										try {
											recordSelfObservation({
												signal: "custom",
												severity: "info",
												message: `Alternate endpoint ${kind} recovered the model turn for ${request.taskId}.`,
												taskId: request.taskId,
												providerId: request.providerId,
												modelId: request.modelId,
												workspacePath: agentPerceivedCwd,
												metadata: { category: "swarm_alternate_endpoint", kind },
											});
										} catch {
											// Telemetry must never alter endpoint recovery.
										}
									},
								})
							: undefined;
						const adaptiveModel = createAdaptiveSwarmRecoveryModel(guardedBase, {
							modelId: request.modelId,
							profile: request.behaviorProfile,
							strategyEffectivenessLedger: request.strategyEffectivenessLedger,
							role: request.role ?? "unknown",
							baseMaxTokens: request.maxTokensPerTurn,
							promptVariationEnabled: isEnabledByDefaultEnv(process.env.NKLEIN_SWARM_PROMPT_VARIATION),
							alternateEndpointModel,
							onBufferedToken: () => this.onTaskEvent?.(request.taskId, { type: "nklein_buffered_model_token" }),
							onStrategyApplied: (strategy) => request.onPromptStrategyApplied?.(strategy),
							onAttempt: (attempt) => {
								if (attempt.strategy === null) return;
								if (attempt.triggerOutcome !== null) {
									try {
										request.onRetryStrategyOutcome?.({
											outcome: attempt.triggerOutcome,
											strategy: attempt.strategy,
											strategyLabel: attempt.strategyLabel,
											resultOutcome: attempt.outcome,
											recovered: attempt.recovered,
											durationMs: attempt.durationMs,
											totalTokens:
												attempt.inputTokens !== null && attempt.outputTokens !== null
													? attempt.inputTokens + attempt.outputTokens
													: null,
										});
									} catch {
										// Durable observation must never alter recovery semantics.
									}
								}
								try {
									recordSelfObservation({
										signal: "custom",
										severity: attempt.recovered ? "info" : "warning",
										message: `Swarm retry ${attempt.strategyLabel ?? attempt.strategy} ${attempt.recovered ? "recovered" : "did not recover"} the model turn for ${request.taskId}.`,
										taskId: request.taskId,
										providerId: request.providerId,
										modelId: request.modelId,
										workspacePath: agentPerceivedCwd,
										metadata: {
											category:
												attempt.strategy === "prompt_variant"
													? "swarm_prompt_variation"
													: "swarm_adaptive_retry",
											role: request.role ?? "unknown",
											strategy: attempt.strategy,
											strategyLabel: attempt.strategyLabel,
											family: attempt.promptFamily,
											toolName: attempt.toolName,
											outcome: attempt.outcome,
											recovered: attempt.recovered,
											finishReason: attempt.finishReason,
											evidence: attempt.evidence,
										},
									});
								} catch {
									// Telemetry must never alter model recovery semantics.
								}
							},
						});
						// Profile the BASELINE request outside recovery: every retry inherits it, while an explicit adaptive rung
						// (notably thinking_disable) remains authoritative instead of being re-overridden by the profile decorator.
						const profiledModel = createSkillApiProfileAgentModel(adaptiveModel, profileOptions);
						if (request.executionMode !== "action_plan") return profiledModel;
						if (!directClient) {
							throw new Error("ActionPlan mode requires a configured local OpenAI-compatible endpoint.");
						}
						return createActionPlanProducerModel(profiledModel, {
							directClient,
							tools: actionPlanTools,
							onPlanProduced: ({ stepCount, toolNames }) => {
								recordSelfObservation({
									signal: "custom",
									severity: "info",
									message: `Bounded ActionPlan produced for ${request.taskId} (${stepCount} steps).`,
									taskId: request.taskId,
									providerId: request.providerId,
									modelId: request.modelId,
									workspacePath: hostWorkspaceRoot,
									metadata: { category: "action_plan_produced", stepCount, toolNames },
								});
							},
						});
					},
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
							sessionResultHandles.store,
							undefined,
							{ providerId: request.providerId, modelId: request.modelId },
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
					extraTools: sessionExtraTools,
				},
				...(requestToolApproval || toolExecutors
					? {
							capabilities: {
								...(requestToolApproval ? { requestToolApproval } : {}),
								...(toolExecutors ? { toolExecutors } : {}),
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
		if (shouldSendInitialTurn && !runInitialTurnInStart) {
			try {
				this.bumpTaskTurnGeneration(request.taskId);
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
		this.bumpTaskTurnGeneration(taskId);
		return await sessionHost.send({
			sessionId,
			prompt,
			userImages: toSdkUserImages(images),
			...(delivery ? { delivery } : {}),
			...(turnTimeoutMs ? { timeoutMs: turnTimeoutMs } : {}),
		});
	}

	getTaskTurnGeneration(taskId: string): number {
		return this.turnGenerationByTaskId.get(taskId) ?? 0;
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

	async stopTaskSession(taskId: string, options: { suppressTaskEvents?: boolean } = {}): Promise<void> {
		const sessionId = this.sessionIdByTaskId.get(taskId);
		if (!sessionId) {
			await this.releaseTaskMcpToolBundle(taskId);
			return;
		}
		const sessionHost = await this.ensureSessionHost();
		// A restart replaces this session deliberately. Some SDK hosts synchronously emit `ended/exit` from stop();
		// routing that event into the task service marks the replacement round awaiting_review before it even starts,
		// which can launch a stale review and several concurrent redrives. Remove only the reverse event route before
		// stopping; the forward binding remains available for the exact cleanup below.
		if (options.suppressTaskEvents) {
			this.taskIdBySessionId.delete(sessionId);
		}
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
			await snapshotSessionBeforeEvidenceDeletion(sessionHost, sessionId).catch(() => undefined);
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

	/** F1.21: the taint labels the task's session accumulated (broker state), or null when unknown. */
	getSessionTaintLabels(taskId: string): readonly string[] | null {
		return this.swarmBrokerStateByTaskId.get(taskId)?.taintLabels ?? null;
	}

	/** F2.2b: the active hard broker refusal that can explain a worker's subsequent turn loop. */
	getSessionCapabilityBrokerHardDenial(taskId: string): SwarmToolHardDenial | null {
		return this.swarmBrokerStateByTaskId.get(taskId)?.hardDenial ?? null;
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

	async releaseTaskMcpTools(taskId: string): Promise<void> {
		await this.releaseTaskMcpToolBundle(taskId);
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
		this.turnGenerationByTaskId.clear();
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

	private bumpTaskTurnGeneration(taskId: string): void {
		this.turnGenerationByTaskId.set(taskId, this.getTaskTurnGeneration(taskId) + 1);
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
