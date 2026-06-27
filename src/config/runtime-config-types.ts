// Public config type surface for the runtime-config facade (§5.AK decomposition, first slice). Pure type
// declarations only — the load / save / normalize / change-detection implementation stays in runtime-config.ts,
// which imports these back and re-exports them from its original module path for import-compatibility.
import type {
	AgentRulesetsConfigPayload,
	RuntimeAgentId,
	RuntimeAgentTimeoutMode,
	RuntimeAgentTimeoutProfile,
	RuntimeCodeEmbeddingSettings,
	RuntimeLostHeartbeatPolicy,
	RuntimeModelRoles,
	RuntimeProjectShortcut,
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
