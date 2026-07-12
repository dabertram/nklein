// Public config type surface for the runtime-config facade (§5.AK decomposition, first slice). Pure type
// declarations only — the load / save / normalize / change-detection implementation stays in runtime-config.ts,
// which imports these back and re-exports them from its original module path for import-compatibility.

import type {
	AgentRulesetsConfigPayload,
	RuntimeAgentId,
	RuntimeAgentTimeoutMode,
	RuntimeAgentTimeoutProfile,
	RuntimeCodeEmbeddingSettings,
	RuntimeFileOverlapParallelism,
	RuntimeLlmfitCatalogUpdateMode,
	RuntimeLostHeartbeatPolicy,
	RuntimeModelRoles,
	RuntimeModelSuitabilityPolicy,
	RuntimeProjectShortcut,
	RuntimeSandboxIsolationProfile,
	RuntimeSkillDynamicsLevel,
	RuntimeSwarmGuardrails,
} from "../core/api-contract";
import type { ConcurrencyConfig, ConcurrencyOverride } from "../core/concurrency-config";
import type { ModelStatsTrackingLevel } from "../core/model-stats-tracking-level";

export interface RuntimeConfigState {
	globalConfigPath: string;
	projectConfigPath: string | null;
	selectedAgentId: RuntimeAgentId;
	selectedShortcutLabel: string | null;
	developerModeEnabled: boolean;
	replayCardsEnabled: boolean;
	/** §5.BA global guided-setup completion stamp (epoch millis) — null = never run → the global wizard auto-fires on first start. */
	setupWizardCompletedAt: number | null;
	/** §5.BA per-project guided-setup completion stamp (epoch millis) — null = never run → the project wizard auto-fires on first load. */
	projectSetupWizardCompletedAt: number | null;
	/** §5.AC "knows today" temporal-context injection — OFF BY DEFAULT; opt-in date grounding, still relevance-gated. */
	knowsTodayEnabled: boolean;
	/** §5.AR curated sandbox-hosted MCP servers — ON BY DEFAULT; offered to fitting models, global/per-project opt-out. */
	sandboxMcpServersEnabled: boolean;
	/** §5.AR/§5.BB basic-memory MCP (write-capable authored memory) — OFF BY DEFAULT; `NKLEIN_BASIC_MEMORY` still force-enables. */
	basicMemoryEnabled: boolean;
	/** §5.AA/§5.BB chat adaptive truncation ladder — ON BY DEFAULT; `NKLEIN_CHAT_ADAPTIVE_TRUNCATION` is a two-way env escape hatch. */
	chatAdaptiveTruncationEnabled: boolean;
	/** §5.AN/§5.BB reasoning output-budget sizing on chat turns — OFF BY DEFAULT; `NKLEIN_REASONING_BUDGET` still force-enables. */
	reasoningBudgetEnabled: boolean;
	/** §5.AW/§5.BB review-panel lenses (still gated on second-opinion review) — OFF BY DEFAULT; `NKLEIN_REVIEW_LENSES` still force-enables. */
	reviewLensesEnabled: boolean;
	capabilityBrokerEnabled: boolean;
	modelStatsTrackingLevel: ModelStatsTrackingLevel;
	/** §5.AC egress-gated online retrieval (web_search + browse_url) — OFF BY DEFAULT; false must keep every retrieval path dormant. */
	retrievalEgressEnabled: boolean;
	/** §5.AC SearXNG-compatible search endpoint base URL — trimmed; empty → null (null = no search backend configured). */
	retrievalSearchBackendUrl: string | null;
	/** §5.AB user-controlled llmfit GitHub catalog update mode. */
	llmfitCatalogUpdateMode: RuntimeLlmfitCatalogUpdateMode;
	/** §5.AW opportunistic speculative best-of-N — ON BY DEFAULT (user 2026-07-02); only a literal `false` disables (opposite polarity of the retrieval fail-closed gate: the user opted in by default, disabling is the explicit act). */
	speculativeBestOfNEnabled: boolean;
	/** §5.AW ceiling on concurrently running speculative candidates — positive integer, clamped to 4. */
	speculativeMaxConcurrentSpecs: number;
	/** §5.AW ceiling on speculative candidates per run — positive integer, clamped to 20; no "0 = off" (disabling is the boolean). */
	speculativeMaxSpecsPerRun: number;
	agentAutonomousModeEnabled: boolean;
	agentTimeoutMode: RuntimeAgentTimeoutMode;
	agentTimeoutProfile: RuntimeAgentTimeoutProfile;
	requestTimeoutMs: number | null;
	streamTimeoutMs: number | null;
	toolTimeoutMs: number | null;
	agentTimeoutMs: number | null;
	conversationTimeoutMs: number | null;
	maxAgentWritableFileLines: number;
	maxConcurrentTasks: number;
	maxConcurrentTasksOverride: number | null;
	effectiveMaxConcurrentTasks: number;
	selectedAgentIdOverride: RuntimeAgentId | null;
	effectiveSelectedAgentId: RuntimeAgentId;
	sandboxMaxContainers: number;
	sandboxAgentsPerContainer: number;
	sandboxMemoryPerContainerMb: number;
	sandboxCpusPerContainer: number;
	sandboxMaxConcurrentExec: number;
	sandboxIdleTimeoutMinutes: number;
	sandboxIsolationProfileDefault: RuntimeSandboxIsolationProfile;
	sandboxIsolationProfileOverride: RuntimeSandboxIsolationProfile | null;
	effectiveSandboxIsolationProfile: RuntimeSandboxIsolationProfile;
	lostHeartbeatPolicy: RuntimeLostHeartbeatPolicy;
	decompositionAutoApplyEnabled: boolean;
	hardTaskRoutingMode: "wait_for_best" | "attempt_with_available";
	testDrivenModeEnabled: boolean;
	secondOpinionReviewEnabled: boolean;
	reviewMaxRounds: number;
	readyForReviewNotificationsEnabled: boolean;
	codeEmbeddingDefaults: RuntimeCodeEmbeddingSettings;
	codeEmbeddingOverride: RuntimeCodeEmbeddingSettings | null;
	effectiveCodeEmbeddingSettings: RuntimeCodeEmbeddingSettings;
	/** §5.AL: global model-capability gate policy + per-project override + resolved effective policy. */
	modelSuitabilityPolicyDefaults: RuntimeModelSuitabilityPolicy;
	modelSuitabilityPolicyOverride: RuntimeModelSuitabilityPolicy | null;
	effectiveModelSuitabilityPolicy: RuntimeModelSuitabilityPolicy;
	/** §5.AE: global skill-dynamics level + per-project override + resolved effective level. */
	skillDynamicsLevelDefault: RuntimeSkillDynamicsLevel;
	skillDynamicsLevelOverride: RuntimeSkillDynamicsLevel | null;
	effectiveSkillDynamicsLevel: RuntimeSkillDynamicsLevel;
	/** §5.AK: file-overlap parallelism — global value + per-project override + resolved effective ("serialize" by default). */
	fileOverlapParallelism: RuntimeFileOverlapParallelism;
	fileOverlapParallelismOverride: RuntimeFileOverlapParallelism | null;
	effectiveFileOverlapParallelism: RuntimeFileOverlapParallelism;
	/** §5.W: global per-provider/per-model concurrency caps + the per-project override (effective resolved per session). */
	concurrencyDefaults: ConcurrencyConfig;
	concurrencyOverride: ConcurrencyOverride | null;
	modelRoles: RuntimeModelRoles;
	modelRolesOverride: RuntimeModelRoles | null;
	effectiveModelRoles: RuntimeModelRoles;
	agentRulesets?: AgentRulesetsConfigPayload;
	agentRulesetsOverride: AgentRulesetsConfigPayload | null;
	effectiveAgentRulesets?: AgentRulesetsConfigPayload;
	swarmGuardrails: RuntimeSwarmGuardrails;
	shortcuts: RuntimeProjectShortcut[];
	commitPromptTemplate: string;
	openPrPromptTemplate: string;
	commitPromptTemplateDefault: string;
	openPrPromptTemplateDefault: string;
	/** §5.W: user-configured base directory under which !Klein creates workspaces; null → home default. */
	workspaceBaseDir: string | null;
	/**
	 * §5.AB machine-aware loader: per-device RAM budget as `"name:GB,name:GB"` (e.g. `"m5max:128,m4mini:24"`);
	 * null/empty → the autonomous fitting-device loader stays disabled. Env `NKLEIN_DEVICE_RAM_GB` overrides this.
	 */
	deviceRamGb: string | null;
	/**
	 * §5.L egress proxy (§6 I3): persisted equivalent of the `NKLEIN_SANDBOX_EGRESS_PROXY` env flag. OFF by default.
	 * Env-when-set overrides the config (real environment wins); off ⇒ the `allowlist` tier stays `--network none`.
	 */
	sandboxEgressProxyEnabled: boolean;
	/**
	 * §5.L egress proxy (§6 I3): comma/newline-separated host allowlist gating which hosts allowlist-tier agents may
	 * reach; null/empty → default-deny (fail-closed). v1 applies ONE global allowlist to every role (per-role lists later).
	 */
	sandboxEgressAllowlist: string | null;
}

export interface RuntimeConfigUpdateInput {
	selectedAgentId?: RuntimeAgentId;
	selectedShortcutLabel?: string | null;
	developerModeEnabled?: boolean;
	replayCardsEnabled?: boolean;
	setupWizardCompletedAt?: number | null;
	projectSetupWizardCompletedAt?: number | null;
	knowsTodayEnabled?: boolean;
	sandboxMcpServersEnabled?: boolean;
	basicMemoryEnabled?: boolean;
	chatAdaptiveTruncationEnabled?: boolean;
	reasoningBudgetEnabled?: boolean;
	reviewLensesEnabled?: boolean;
	capabilityBrokerEnabled?: boolean;
	modelStatsTrackingLevel?: ModelStatsTrackingLevel;
	retrievalEgressEnabled?: boolean;
	retrievalSearchBackendUrl?: string | null;
	llmfitCatalogUpdateMode?: RuntimeLlmfitCatalogUpdateMode;
	speculativeBestOfNEnabled?: boolean;
	speculativeMaxConcurrentSpecs?: number;
	speculativeMaxSpecsPerRun?: number;
	agentAutonomousModeEnabled?: boolean;
	agentTimeoutMode?: RuntimeAgentTimeoutMode;
	agentTimeoutProfile?: RuntimeAgentTimeoutProfile;
	requestTimeoutMs?: number | null;
	streamTimeoutMs?: number | null;
	toolTimeoutMs?: number | null;
	agentTimeoutMs?: number | null;
	conversationTimeoutMs?: number | null;
	maxAgentWritableFileLines?: number;
	maxConcurrentTasks?: number;
	sandboxMaxContainers?: number;
	sandboxAgentsPerContainer?: number;
	sandboxMemoryPerContainerMb?: number;
	sandboxCpusPerContainer?: number;
	sandboxMaxConcurrentExec?: number;
	sandboxIdleTimeoutMinutes?: number;
	sandboxIsolationProfileDefault?: RuntimeSandboxIsolationProfile;
	sandboxIsolationProfileOverride?: RuntimeSandboxIsolationProfile | null;
	lostHeartbeatPolicy?: RuntimeLostHeartbeatPolicy;
	decompositionAutoApplyEnabled?: boolean;
	hardTaskRoutingMode?: "wait_for_best" | "attempt_with_available";
	testDrivenModeEnabled?: boolean;
	secondOpinionReviewEnabled?: boolean;
	reviewMaxRounds?: number;
	readyForReviewNotificationsEnabled?: boolean;
	codeEmbeddingDefaults?: RuntimeCodeEmbeddingSettings;
	codeEmbeddingOverride?: RuntimeCodeEmbeddingSettings | null;
	modelSuitabilityPolicyDefaults?: RuntimeModelSuitabilityPolicy;
	modelSuitabilityPolicyOverride?: RuntimeModelSuitabilityPolicy | null;
	skillDynamicsLevelDefault?: RuntimeSkillDynamicsLevel;
	skillDynamicsLevelOverride?: RuntimeSkillDynamicsLevel | null;
	fileOverlapParallelism?: RuntimeFileOverlapParallelism;
	fileOverlapParallelismOverride?: RuntimeFileOverlapParallelism | null;
	concurrencyDefaults?: ConcurrencyConfig;
	concurrencyOverride?: ConcurrencyOverride | null;
	maxConcurrentTasksOverride?: number | null;
	selectedAgentIdOverride?: RuntimeAgentId | null;
	agentRulesetsOverride?: AgentRulesetsConfigPayload | null;
	modelRoles?: RuntimeModelRoles;
	modelRolesOverride?: RuntimeModelRoles | null;
	agentRulesets?: AgentRulesetsConfigPayload;
	swarmGuardrails?: RuntimeSwarmGuardrails;
	shortcuts?: RuntimeProjectShortcut[];
	commitPromptTemplate?: string;
	openPrPromptTemplate?: string;
	workspaceBaseDir?: string | null;
	deviceRamGb?: string | null;
	sandboxEgressProxyEnabled?: boolean;
	sandboxEgressAllowlist?: string | null;
}

/** On-disk shape of the global config file (every field optional — the loader normalizes + fills defaults). */
export interface RuntimeGlobalConfigFileShape {
	selectedAgentId?: RuntimeAgentId;
	selectedShortcutLabel?: string;
	developerModeEnabled?: boolean;
	replayCardsEnabled?: boolean;
	setupWizardCompletedAt?: number | null;
	knowsTodayEnabled?: boolean;
	sandboxMcpServersEnabled?: boolean;
	basicMemoryEnabled?: boolean;
	chatAdaptiveTruncationEnabled?: boolean;
	reasoningBudgetEnabled?: boolean;
	reviewLensesEnabled?: boolean;
	capabilityBrokerEnabled?: boolean;
	modelStatsTrackingLevel?: ModelStatsTrackingLevel;
	retrievalEgressEnabled?: boolean;
	retrievalSearchBackendUrl?: string | null;
	llmfitCatalogUpdateMode?: RuntimeLlmfitCatalogUpdateMode;
	speculativeBestOfNEnabled?: boolean;
	speculativeMaxConcurrentSpecs?: number;
	speculativeMaxSpecsPerRun?: number;
	agentAutonomousModeEnabled?: boolean;
	agentTimeoutMode?: RuntimeAgentTimeoutMode;
	agentTimeoutProfile?: RuntimeAgentTimeoutProfile;
	requestTimeoutMs?: number | null;
	streamTimeoutMs?: number | null;
	toolTimeoutMs?: number | null;
	agentTimeoutMs?: number | null;
	conversationTimeoutMs?: number | null;
	maxAgentWritableFileLines?: number;
	maxConcurrentTasks?: number;
	sandboxMaxContainers?: number;
	sandboxAgentsPerContainer?: number;
	sandboxMemoryPerContainerMb?: number;
	sandboxCpusPerContainer?: number;
	sandboxMaxConcurrentExec?: number;
	sandboxIdleTimeoutMinutes?: number;
	sandboxIsolationProfileDefault?: RuntimeSandboxIsolationProfile;
	lostHeartbeatPolicy?: RuntimeLostHeartbeatPolicy;
	decompositionAutoApplyEnabled?: boolean;
	hardTaskRoutingMode?: "wait_for_best" | "attempt_with_available";
	testDrivenModeEnabled?: boolean;
	secondOpinionReviewEnabled?: boolean;
	reviewMaxRounds?: number;
	readyForReviewNotificationsEnabled?: boolean;
	codeEmbeddingDefaults?: RuntimeCodeEmbeddingSettings;
	modelSuitabilityPolicyDefaults?: RuntimeModelSuitabilityPolicy;
	skillDynamicsLevelDefault?: RuntimeSkillDynamicsLevel;
	fileOverlapParallelism?: RuntimeFileOverlapParallelism;
	concurrencyDefaults?: ConcurrencyConfig;
	modelRoles?: RuntimeModelRoles;
	agentRulesets?: AgentRulesetsConfigPayload;
	swarmGuardrails?: Partial<RuntimeSwarmGuardrails>;
	commitPromptTemplate?: string;
	openPrPromptTemplate?: string;
	workspaceBaseDir?: string | null;
	deviceRamGb?: string | null;
	sandboxEgressProxyEnabled?: boolean;
	sandboxEgressAllowlist?: string | null;
}

/** On-disk shape of a project's config file — only the project-scoped settings + per-project overrides. */
export interface RuntimeProjectConfigFileShape {
	shortcuts?: RuntimeProjectShortcut[];
	projectSetupWizardCompletedAt?: number | null;
	codeEmbeddingOverride?: RuntimeCodeEmbeddingSettings | null;
	modelSuitabilityPolicyOverride?: RuntimeModelSuitabilityPolicy | null;
	skillDynamicsLevelOverride?: RuntimeSkillDynamicsLevel | null;
	fileOverlapParallelismOverride?: RuntimeFileOverlapParallelism | null;
	concurrencyOverride?: ConcurrencyOverride | null;
	maxConcurrentTasksOverride?: number | null;
	selectedAgentIdOverride?: RuntimeAgentId | null;
	agentRulesetsOverride?: AgentRulesetsConfigPayload | null;
	modelRolesOverride?: RuntimeModelRoles | null;
	sandboxIsolationProfileOverride?: RuntimeSandboxIsolationProfile | null;
}
