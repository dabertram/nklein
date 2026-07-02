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
	RuntimeLostHeartbeatPolicy,
	RuntimeModelRoles,
	RuntimeModelSuitabilityPolicy,
	RuntimeProjectShortcut,
	RuntimeSkillDynamicsLevel,
	RuntimeSwarmGuardrails,
} from "../core/api-contract";
import type { ConcurrencyConfig, ConcurrencyOverride } from "../core/concurrency-config";

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
	/** §5.AC egress-gated online retrieval (web_search + browse_url) — OFF BY DEFAULT; false must keep every retrieval path dormant. */
	retrievalEgressEnabled: boolean;
	/** §5.AC SearXNG-compatible search endpoint base URL — trimmed; empty → null (null = no search backend configured). */
	retrievalSearchBackendUrl: string | null;
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
	sandboxIdleTimeoutMinutes: number;
	lostHeartbeatPolicy: RuntimeLostHeartbeatPolicy;
	decompositionAutoApplyEnabled: boolean;
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
	retrievalEgressEnabled?: boolean;
	retrievalSearchBackendUrl?: string | null;
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
	sandboxIdleTimeoutMinutes?: number;
	lostHeartbeatPolicy?: RuntimeLostHeartbeatPolicy;
	decompositionAutoApplyEnabled?: boolean;
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
	retrievalEgressEnabled?: boolean;
	retrievalSearchBackendUrl?: string | null;
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
	sandboxIdleTimeoutMinutes?: number;
	lostHeartbeatPolicy?: RuntimeLostHeartbeatPolicy;
	decompositionAutoApplyEnabled?: boolean;
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
}
