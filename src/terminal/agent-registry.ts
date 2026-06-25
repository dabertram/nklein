import { isDebugOverrideEnvEnabled } from "../config/debug-override";
import type { RuntimeConfigState } from "../config/runtime-config";
import { getRuntimeLaunchSupportedAgentCatalog, RUNTIME_AGENT_CATALOG } from "../core/agent-catalog";
import type {
	RuntimeAgentDefinition,
	RuntimeAgentId,
	RuntimeAgentSandboxStatus,
	RuntimeConfigResponse,
	RuntimeNKleinProviderSettings,
} from "../core/api-contract";
import { DEFAULT_AGENT_SANDBOX_IMAGE } from "../nklein-sdk/nklein-agent-sandbox";
import { CLOUD_ENABLED } from "../nklein-sdk/nklein-local-only-policy";
import { isBinaryAvailableOnPath } from "./command-discovery";

export interface ResolvedAgentCommand {
	agentId: RuntimeAgentId;
	label: string;
	command: string;
	binary: string;
	args: string[];
}

function getDefaultArgs(agentId: RuntimeAgentId): string[] {
	const entry = RUNTIME_AGENT_CATALOG.find((candidate) => candidate.id === agentId);
	if (!entry) {
		return [];
	}
	return [...entry.baseArgs];
}

function quoteForDisplay(part: string): string {
	if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(part)) {
		return part;
	}
	return JSON.stringify(part);
}

function joinCommand(binary: string, args: string[]): string {
	if (args.length === 0) {
		return binary;
	}
	return [binary, ...args.map(quoteForDisplay)].join(" ");
}

export function isRuntimeDebugModeEnabled(): boolean {
	return isDebugOverrideEnvEnabled();
}

function resolveSelectedAgentIdForLocalOnly(selectedAgentId: RuntimeAgentId): RuntimeAgentId {
	if (!CLOUD_ENABLED && selectedAgentId !== "nklein") {
		return "nklein";
	}
	return selectedAgentId;
}

export function detectInstalledCommands(): string[] {
	const candidates = [...RUNTIME_AGENT_CATALOG.map((entry) => entry.binary), "npx"];
	const detected: string[] = [];

	for (const candidate of candidates) {
		if (isBinaryAvailableOnPath(candidate)) {
			detected.push(candidate);
		}
	}

	return detected;
}

function getCuratedDefinitions(runtimeConfig: RuntimeConfigState, detected: string[]): RuntimeAgentDefinition[] {
	const detectedSet = new Set(detected);
	const selectedAgentId = resolveSelectedAgentIdForLocalOnly(runtimeConfig.selectedAgentId);
	const supportedAgents = CLOUD_ENABLED
		? getRuntimeLaunchSupportedAgentCatalog()
		: getRuntimeLaunchSupportedAgentCatalog().filter((entry) => entry.id === "nklein");
	return supportedAgents.map((entry) => {
		const defaultArgs = getDefaultArgs(entry.id);
		const command = joinCommand(entry.binary, defaultArgs);
		const isInstalled = entry.id === "nklein" ? true : detectedSet.has(entry.binary);
		return {
			id: entry.id,
			label: entry.label,
			binary: entry.binary,
			command,
			defaultArgs,
			installed: isInstalled,
			configured: selectedAgentId === entry.id,
		};
	});
}

export function resolveAgentCommand(runtimeConfig: RuntimeConfigState): ResolvedAgentCommand | null {
	const selectedAgentId = resolveSelectedAgentIdForLocalOnly(runtimeConfig.selectedAgentId);
	const selected = getRuntimeLaunchSupportedAgentCatalog().find((entry) => entry.id === selectedAgentId);
	if (!selected) {
		return null;
	}
	const defaultArgs = getDefaultArgs(selected.id);
	const command = joinCommand(selected.binary, defaultArgs);
	if (isBinaryAvailableOnPath(selected.binary)) {
		return {
			agentId: selected.id,
			label: selected.label,
			command,
			binary: selected.binary,
			args: defaultArgs,
		};
	}
	return null;
}

export function buildRuntimeConfigResponse(
	runtimeConfig: RuntimeConfigState,
	nkleinProviderSettings: RuntimeNKleinProviderSettings,
	agentSandboxStatus: RuntimeAgentSandboxStatus = {
		state: "checking",
		dockerAvailable: null,
		imageAvailable: null,
		image: DEFAULT_AGENT_SANDBOX_IMAGE,
		message: null,
		checkedAt: null,
	},
): RuntimeConfigResponse {
	const detectedCommands = detectInstalledCommands();
	const agents = getCuratedDefinitions(runtimeConfig, detectedCommands);
	const resolved = resolveAgentCommand(runtimeConfig);
	const effectiveCommand = resolved ? joinCommand(resolved.binary, resolved.args) : null;
	const selectedAgentId = resolveSelectedAgentIdForLocalOnly(runtimeConfig.selectedAgentId);

	return {
		selectedAgentId,
		selectedShortcutLabel: runtimeConfig.selectedShortcutLabel,
		workspaceBaseDir: runtimeConfig.workspaceBaseDir,
		cloudProviderSupportEnabled: CLOUD_ENABLED,
		agentAutonomousModeEnabled: runtimeConfig.agentAutonomousModeEnabled,
		agentTimeoutMode: runtimeConfig.agentTimeoutMode,
		agentTimeoutProfile: runtimeConfig.agentTimeoutProfile,
		requestTimeoutMs: runtimeConfig.requestTimeoutMs,
		streamTimeoutMs: runtimeConfig.streamTimeoutMs,
		toolTimeoutMs: runtimeConfig.toolTimeoutMs,
		agentTimeoutMs: runtimeConfig.agentTimeoutMs,
		conversationTimeoutMs: runtimeConfig.conversationTimeoutMs,
		maxAgentWritableFileLines: runtimeConfig.maxAgentWritableFileLines,
		maxConcurrentTasks: runtimeConfig.maxConcurrentTasks,
		sandboxMaxContainers: runtimeConfig.sandboxMaxContainers,
		sandboxAgentsPerContainer: runtimeConfig.sandboxAgentsPerContainer,
		sandboxMemoryPerContainerMb: runtimeConfig.sandboxMemoryPerContainerMb,
		sandboxCpusPerContainer: runtimeConfig.sandboxCpusPerContainer,
		sandboxIdleTimeoutMinutes: runtimeConfig.sandboxIdleTimeoutMinutes,
		lostHeartbeatPolicy: runtimeConfig.lostHeartbeatPolicy,
		decompositionAutoApplyEnabled: runtimeConfig.decompositionAutoApplyEnabled,
		secondOpinionReviewEnabled: runtimeConfig.secondOpinionReviewEnabled,
		reviewMaxRounds: runtimeConfig.reviewMaxRounds,
		codeEmbeddingDefaults: runtimeConfig.codeEmbeddingDefaults,
		codeEmbeddingOverride: runtimeConfig.codeEmbeddingOverride,
		effectiveCodeEmbeddingSettings: runtimeConfig.effectiveCodeEmbeddingSettings,
		developerModeEnabled: runtimeConfig.developerModeEnabled,
		replayCardsEnabled: runtimeConfig.replayCardsEnabled,
		effectiveCommand,
		globalConfigPath: runtimeConfig.globalConfigPath,
		projectConfigPath: runtimeConfig.projectConfigPath,
		readyForReviewNotificationsEnabled: runtimeConfig.readyForReviewNotificationsEnabled,
		detectedCommands,
		agents,
		agentSandboxStatus,
		shortcuts: runtimeConfig.shortcuts,
		nkleinProviderSettings,
		modelRoles: runtimeConfig.modelRoles,
		agentRulesets: runtimeConfig.agentRulesets,
		swarmGuardrails: runtimeConfig.swarmGuardrails,
		commitPromptTemplate: runtimeConfig.commitPromptTemplate,
		openPrPromptTemplate: runtimeConfig.openPrPromptTemplate,
		commitPromptTemplateDefault: runtimeConfig.commitPromptTemplateDefault,
		openPrPromptTemplateDefault: runtimeConfig.openPrPromptTemplateDefault,
	};
}
