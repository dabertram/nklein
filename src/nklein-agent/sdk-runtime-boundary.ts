// Centralize direct SDK runtime imports here.
// All native NKlein session-host creation and persisted artifact reads should
// flow through this boundary so the rest of !Klein stays decoupled from the
// SDK package layout.

import {
	type AgentEvent,
	type BasicLogger,
	buildWorkspaceMetadata,
	ClineCore,
	type ClineCoreStartInput,
	type CoreSessionEvent,
	createUserInstructionConfigService,
	formatRulesForSystemPrompt,
	getClineDefaultSystemPrompt,
	isRuleEnabled,
	type MessageWithMetadata,
	type RuleConfig,
	resolveClineDataDir,
	resolveSkillsConfigSearchPaths,
	resolveWorkflowsConfigSearchPaths,
	type SessionHistoryRecord,
	type TeamEvent,
	type ToolApprovalRequest,
	type ToolApprovalResult,
	type UserInstructionConfigService,
} from "@cline/sdk";
import {
	type RestructuredPromptShell,
	restructureSystemPromptForPrefixStability,
} from "../core/prompt-shell-restructure";
import { NKLEIN_BUILTIN_SLASH_COMMANDS } from "./nklein-slash-commands";
import { getCliTelemetryService } from "./nklein-telemetry-service";

export { TelemetryLoggerSink, TelemetryService } from "@cline/sdk";

export type NKleinSdkSessionHost = ClineCore;
export type NKleinSdkBasicLogger = BasicLogger;
export type NKleinSdkAgentEvent = AgentEvent;
export type NKleinSdkTeamEvent = TeamEvent;

export type NKleinSdkSessionEvent = CoreSessionEvent;

export type NKleinSdkStartSessionInput = ClineCoreStartInput;
export type NKleinSdkSessionRecord = SessionHistoryRecord;
export type NKleinSdkPersistedMessage = MessageWithMetadata;
export type NKleinSdkUserInstructionService = UserInstructionConfigService;
export interface NKleinSdkSlashCommand {
	name: string;
	instructions: string;
	description?: string;
}
export type NKleinSdkToolApprovalRequest = ToolApprovalRequest;
export type NKleinSdkToolApprovalResult = ToolApprovalResult;

export async function createNKleinSdkSessionHost(): Promise<NKleinSdkSessionHost> {
	// !Klein is a single, local-only desktop app, so the SDK session host runs in-process
	// ("local") rather than via the shared "hub" backend. "auto" selects the shared hub
	// daemon, whose cron/automation entrypoint is broken in the pinned SDK build
	// (its bundled daemon entry throws on load), so it crash-loops in the background.
	// We do not use the hub's scheduled-agent features, so force the local backend.
	return await ClineCore.create({
		backendMode: "local",
		telemetry: getCliTelemetryService(),
	});
}

export function resolveNKleinSdkDataDir(): string {
	return resolveClineDataDir();
}
export async function buildNKleinSdkWorkspaceMetadata(cwd: string): Promise<string> {
	return await buildWorkspaceMetadata(cwd);
}

export function createNKleinSdkUserInstructionService(workspacePath: string): NKleinSdkUserInstructionService {
	return createUserInstructionConfigService({
		skills: { workspacePath },
		rules: { workspacePath },
		workflows: { workspacePath },
	});
}

export function resolveNKleinSdkWorkflowSearchPaths(workspacePath: string): string[] {
	return resolveWorkflowsConfigSearchPaths(workspacePath);
}

export function resolveNKleinSdkSkillSearchPaths(workspacePath: string): string[] {
	return resolveSkillsConfigSearchPaths(workspacePath);
}

export function listNKleinSdkWorkflowSlashCommands(service?: NKleinSdkUserInstructionService): NKleinSdkSlashCommand[] {
	const builtIns: NKleinSdkSlashCommand[] = NKLEIN_BUILTIN_SLASH_COMMANDS.map((command) => ({
		name: command.name,
		instructions: "",
		description: command.description,
	}));
	if (!service) {
		return builtIns;
	}
	const byName = new Map<string, NKleinSdkSlashCommand>();
	for (const command of builtIns) {
		byName.set(command.name, command);
	}
	for (const command of service.listRuntimeCommands()) {
		if (byName.has(command.name)) {
			continue;
		}
		byName.set(command.name, {
			name: command.name,
			instructions: command.instructions,
			description: command.kind === "workflow" ? "Workflow command" : "Skill command",
		});
	}
	return [...byName.values()];
}

export function resolveNKleinSdkWorkflowSlashCommand(prompt: string, service: NKleinSdkUserInstructionService): string {
	return service.resolveRuntimeSlashCommand(prompt);
}

export function loadNKleinSdkRulesForSystemPrompt(service: NKleinSdkUserInstructionService): string {
	const rules = service
		.listRecords<RuleConfig>("rule")
		.map((record) => record.item)
		.filter(isRuleEnabled)
		.sort((left, right) => left.name.localeCompare(right.name));
	return formatRulesForSystemPrompt(rules);
}

/** The SDK base prompt split for cache-stable assembly — see {@link resolveNKleinSdkSystemPromptParts}. */
export type NKleinSdkSystemPromptParts = RestructuredPromptShell;

/**
 * §5.AQ(e): build the SDK default system prompt, then RESTRUCTURE it for prefix stability — the vendor template
 * embeds the task-volatile cwd + daily-volatile date in an `<env>` block ~1700 bytes in (with ~2k static bytes
 * after it), which capped byte-prefix reuse between same-model session starts at ~8%. The restructure moves those
 * two lines into a trailing `<session>` block, so `staticText` is byte-stable per model+workspace and the volatile
 * `sessionEnvText` can be appended LAST by the fragment assembler. The fallback date mirrors the vendor builder's
 * own substitution expression (`toLocaleDateString()`); the restructure prefers the exact values it extracts from
 * the built prompt, so the fallback only covers a template without an `<env>` block.
 */
export async function resolveNKleinSdkSystemPromptParts(input: {
	cwd: string;
	providerId: string;
	rules?: string;
}): Promise<NKleinSdkSystemPromptParts> {
	// The NKlein SDK can run against non-NKlein providers too, but only the
	// "nklein" provider expects the extra workspace metadata block that powers
	// its repo-aware behavior in the same way the official CLI does.
	const shouldAppendWorkspaceMetadata = input.providerId === "nklein";
	const workspaceMetadata = shouldAppendWorkspaceMetadata ? await buildWorkspaceMetadata(input.cwd) : "";
	const basePrompt = getClineDefaultSystemPrompt({
		ide: "!Klein",
		rootPath: input.cwd,
		providerId: input.providerId,
		metadata: workspaceMetadata,
		rules: input.rules ?? "",
	});
	return restructureSystemPromptForPrefixStability(basePrompt, {
		cwd: input.cwd,
		date: new Date().toLocaleDateString(),
	});
}

/** The composed (static shell + `<session>` trailer) system prompt, for callers without a fragment assembler. */
export async function resolveNKleinSdkSystemPrompt(input: {
	cwd: string;
	providerId: string;
	rules?: string;
}): Promise<string> {
	return (await resolveNKleinSdkSystemPromptParts(input)).text;
}
