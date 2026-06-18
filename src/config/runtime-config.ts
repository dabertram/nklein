// Persists Kanban-owned runtime preferences on disk.
// This module should store Kanban settings such as selected agents,
// shortcuts, and prompt templates, not SDK-owned Cline secrets or OAuth data.
import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { getRuntimeAgentCatalogEntry, isRuntimeAgentLaunchSupported } from "../core/agent-catalog";
import { DEFAULT_MAX_AGENT_WRITABLE_FILE_LINES, normalizeMaxAgentWritableFileLines } from "../core/agent-write-guard";
import type {
	RuntimeAgentId,
	RuntimeAgentTimeoutMode,
	RuntimeAgentTimeoutProfile,
	RuntimeCodeEmbeddingSettings,
	RuntimeLostHeartbeatPolicy,
	RuntimeModelRoles,
	RuntimeProjectShortcut,
} from "../core/api-contract";
import { runtimeCodeEmbeddingSettingsSchema, runtimeTaskClineSettingsSchema } from "../core/api-contract";
import { type LockRequest, lockedFileSystem } from "../fs/locked-file-system";
import { detectInstalledCommands } from "../terminal/agent-registry";
import { CLINE_HOME_DIR_NAME, NKLEIN_PROJECT_CONFIG_DIR_NAME, NKLEIN_RUNTIME_DIR_NAME } from "./runtime-paths";
import { areRuntimeProjectShortcutsEqual } from "./shortcut-utils";

interface RuntimeGlobalConfigFileShape {
	selectedAgentId?: RuntimeAgentId;
	selectedShortcutLabel?: string;
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
	lostHeartbeatPolicy?: RuntimeLostHeartbeatPolicy;
	decompositionAutoApplyEnabled?: boolean;
	readyForReviewNotificationsEnabled?: boolean;
	codeEmbeddingDefaults?: RuntimeCodeEmbeddingSettings;
	modelRoles?: RuntimeModelRoles;
	commitPromptTemplate?: string;
	openPrPromptTemplate?: string;
}

interface RuntimeProjectConfigFileShape {
	shortcuts?: RuntimeProjectShortcut[];
	codeEmbeddingOverride?: RuntimeCodeEmbeddingSettings | null;
}

export interface RuntimeConfigState {
	globalConfigPath: string;
	projectConfigPath: string | null;
	selectedAgentId: RuntimeAgentId;
	selectedShortcutLabel: string | null;
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
	lostHeartbeatPolicy: RuntimeLostHeartbeatPolicy;
	decompositionAutoApplyEnabled: boolean;
	readyForReviewNotificationsEnabled: boolean;
	codeEmbeddingDefaults: RuntimeCodeEmbeddingSettings;
	codeEmbeddingOverride: RuntimeCodeEmbeddingSettings | null;
	effectiveCodeEmbeddingSettings: RuntimeCodeEmbeddingSettings;
	modelRoles: RuntimeModelRoles;
	shortcuts: RuntimeProjectShortcut[];
	commitPromptTemplate: string;
	openPrPromptTemplate: string;
	commitPromptTemplateDefault: string;
	openPrPromptTemplateDefault: string;
}

export interface RuntimeConfigUpdateInput {
	selectedAgentId?: RuntimeAgentId;
	selectedShortcutLabel?: string | null;
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
	lostHeartbeatPolicy?: RuntimeLostHeartbeatPolicy;
	decompositionAutoApplyEnabled?: boolean;
	readyForReviewNotificationsEnabled?: boolean;
	codeEmbeddingDefaults?: RuntimeCodeEmbeddingSettings;
	codeEmbeddingOverride?: RuntimeCodeEmbeddingSettings | null;
	modelRoles?: RuntimeModelRoles;
	shortcuts?: RuntimeProjectShortcut[];
	commitPromptTemplate?: string;
	openPrPromptTemplate?: string;
}

const RUNTIME_HOME_PARENT_DIR = CLINE_HOME_DIR_NAME;
const RUNTIME_HOME_DIR = NKLEIN_RUNTIME_DIR_NAME;
const CONFIG_FILENAME = "config.json";
const PROJECT_CONFIG_PARENT_DIR = CLINE_HOME_DIR_NAME;
const PROJECT_CONFIG_DIR = NKLEIN_PROJECT_CONFIG_DIR_NAME;
const PROJECT_CONFIG_FILENAME = "config.json";
const DEFAULT_AGENT_ID: RuntimeAgentId = "cline";
const AUTO_SELECT_AGENT_PRIORITY: readonly RuntimeAgentId[] = ["claude", "codex", "droid", "kiro"];
const DEFAULT_AGENT_AUTONOMOUS_MODE_ENABLED = true;
const DEFAULT_AGENT_TIMEOUT_MODE: RuntimeAgentTimeoutMode = "normal";
const DEFAULT_AGENT_TIMEOUT_PROFILE: RuntimeAgentTimeoutProfile = "local";
const DEFAULT_READY_FOR_REVIEW_NOTIFICATIONS_ENABLED = true;
const DEFAULT_LOST_HEARTBEAT_POLICY: RuntimeLostHeartbeatPolicy = "park";
const DEFAULT_DECOMPOSITION_AUTO_APPLY_ENABLED = true;
export const DEFAULT_CODE_EMBEDDING_SETTINGS: RuntimeCodeEmbeddingSettings = {
	provider: "local_lexical",
	model: "kanban-local-lexical-vector-v1",
	baseUrl: null,
};
const DEFAULT_MAX_CONCURRENT_TASKS = 3;
const DEFAULT_LOCAL_REQUEST_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_LOCAL_STREAM_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LOCAL_TOOL_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LOCAL_AGENT_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LOCAL_CONVERSATION_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_COMMIT_PROMPT_TEMPLATE = `You are in a worktree on a detached HEAD. When you are finished with the task, commit the working changes onto {{base_ref}}.

- Do not run destructive commands: git reset --hard, git clean -fdx, git worktree remove, rm/mv on repository paths.
- Do not edit files outside git workflows unless required for conflict resolution.
- Preserve any pre-existing user uncommitted changes in the base worktree.

Steps:
1. In the current task worktree, stage and create a commit for the pending task changes.
2. Find where {{base_ref}} is checked out:
   - Run: git worktree list --porcelain
   - If branch {{base_ref}} is checked out in path P, use that P.
   - If not checked out anywhere, use current worktree as P by checking out {{base_ref}} there.
3. In P, verify current branch is {{base_ref}}.
4. If P has uncommitted changes, stash them: git -C P stash push -u -m "kanban-pre-cherry-pick"
5. Cherry-pick the task commit into P. If this fails because .git/index.lock exists, wait briefly for any active git process to finish. If the lock remains and no git process is active, treat the lock as stale, remove it, and retry.
6. If cherry-pick conflicts, resolve carefully, preserving both the intended task changes and existing user edits.
7. If step 4 created a new stash entry, restore that stash with: git -C P stash pop <stash-ref>
8. If stash pop conflicts, resolve them while preserving pre-existing user edits.
9. Before reporting success, run git -C P status --short and verify there are no unmerged paths or unresolved conflict markers.
10. If a conflict cannot be resolved with high confidence, stop. Keep the repository recoverable, list every conflicted file, state whether a cherry-pick or stash operation remains active, and tell the user that manual merge attention is required. Never report a successful integration while conflicts remain.
11. Report:
   - Final commit hash
   - Final commit message
   - Whether stash was used
   - Whether conflicts were resolved
   - Any remaining manual follow-up needed`;
const DEFAULT_OPEN_PR_PROMPT_TEMPLATE = `You are in a worktree on a detached HEAD. When you are finished with the task, open a pull request against {{base_ref}}.

- Do not run destructive commands: git reset --hard, git clean -fdx, git worktree remove, rm/mv on repository paths.
- Do not modify the base worktree.
- Keep all PR preparation in the current task worktree.

Steps:
1. Ensure all intended changes are committed in the current task worktree.
2. If currently on detached HEAD, create a branch at the current commit in this worktree.
3. Push the branch to origin and set upstream.
4. Create a pull request with base {{base_ref}} and head as the pushed branch (use gh CLI if available).
5. If a pull request already exists for the same head and base, return that existing PR URL instead of creating a duplicate.
6. If PR creation is blocked, explain exactly why and provide the exact commands to complete it manually.
7. Report:
   - PR title: PR URL
   - Base branch
   - Head branch
   - Any follow-up needed`;

export function pickBestInstalledAgentIdFromDetected(detectedCommands: readonly string[]): RuntimeAgentId | null {
	const detected = new Set(detectedCommands);
	for (const agentId of AUTO_SELECT_AGENT_PRIORITY) {
		const catalogEntry = getRuntimeAgentCatalogEntry(agentId);
		const binary = catalogEntry?.binary ?? agentId;
		if (detected.has(binary) || detected.has(agentId)) {
			return agentId;
		}
	}
	return null;
}

function getRuntimeHomePath(): string {
	return join(homedir(), RUNTIME_HOME_PARENT_DIR, RUNTIME_HOME_DIR);
}

function normalizeAgentId(agentId: RuntimeAgentId | string | null | undefined): RuntimeAgentId {
	if (
		(agentId === "claude" ||
			agentId === "codex" ||
			agentId === "gemini" ||
			agentId === "opencode" ||
			agentId === "droid" ||
			agentId === "kiro" ||
			agentId === "cline") &&
		isRuntimeAgentLaunchSupported(agentId)
	) {
		return agentId;
	}
	return DEFAULT_AGENT_ID;
}

function normalizeAgentTimeoutMode(value: unknown): RuntimeAgentTimeoutMode {
	if (value === "normal" || value === "long" || value === "extended" || value === "unlimited") {
		return value;
	}
	if (value === "very_long") {
		return "extended";
	}
	return DEFAULT_AGENT_TIMEOUT_MODE;
}

function normalizeAgentTimeoutProfile(value: unknown): RuntimeAgentTimeoutProfile {
	if (value === "cloud" || value === "local" || value === "custom") {
		return value;
	}
	return DEFAULT_AGENT_TIMEOUT_PROFILE;
}

function normalizeTimeoutMsValue(value: unknown): number | null {
	if (value === null) {
		return null;
	}
	if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
		return Math.trunc(value);
	}
	return null;
}

function resolveProfileTimeoutDefaults(profile: RuntimeAgentTimeoutProfile): {
	requestTimeoutMs: number | null;
	streamTimeoutMs: number | null;
	toolTimeoutMs: number | null;
	agentTimeoutMs: number | null;
	conversationTimeoutMs: number | null;
} {
	if (profile === "cloud" || profile === "local") {
		return {
			requestTimeoutMs: DEFAULT_LOCAL_REQUEST_TIMEOUT_MS,
			streamTimeoutMs: DEFAULT_LOCAL_STREAM_TIMEOUT_MS,
			toolTimeoutMs: DEFAULT_LOCAL_TOOL_TIMEOUT_MS,
			agentTimeoutMs: DEFAULT_LOCAL_AGENT_TIMEOUT_MS,
			conversationTimeoutMs: DEFAULT_LOCAL_CONVERSATION_TIMEOUT_MS,
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

function pickBestInstalledAgentId(): RuntimeAgentId | null {
	return pickBestInstalledAgentIdFromDetected(detectInstalledCommands());
}

function normalizeShortcut(shortcut: RuntimeProjectShortcut): RuntimeProjectShortcut | null {
	if (!shortcut || typeof shortcut !== "object") {
		return null;
	}

	const label = typeof shortcut.label === "string" ? shortcut.label.trim() : "";
	const command = typeof shortcut.command === "string" ? shortcut.command.trim() : "";
	const icon = typeof shortcut.icon === "string" ? shortcut.icon.trim() : "";

	if (!label || !command) {
		return null;
	}

	return {
		label,
		command,
		icon: icon || undefined,
	};
}

function normalizeShortcuts(shortcuts: RuntimeProjectShortcut[] | null | undefined): RuntimeProjectShortcut[] {
	if (!Array.isArray(shortcuts)) {
		return [];
	}
	const normalized: RuntimeProjectShortcut[] = [];
	for (const shortcut of shortcuts) {
		const parsed = normalizeShortcut(shortcut);
		if (parsed) {
			normalized.push(parsed);
		}
	}
	return normalized;
}

function normalizeModelRoles(value: unknown): RuntimeModelRoles {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {};
	}
	const normalized: RuntimeModelRoles = {};
	for (const [rawRole, rawSettings] of Object.entries(value as Record<string, unknown>)) {
		const role = rawRole.trim();
		if (!role) {
			continue;
		}
		const parsedSettings = runtimeTaskClineSettingsSchema.safeParse(rawSettings);
		if (!parsedSettings.success) {
			continue;
		}
		const settings = parsedSettings.data;
		const providerId = settings.providerId?.trim();
		const modelId = settings.modelId?.trim();
		normalized[role] = {
			...(providerId ? { providerId } : {}),
			...(modelId ? { modelId } : {}),
			...(settings.reasoningEffort ? { reasoningEffort: settings.reasoningEffort } : {}),
			...(settings.contextScope ? { contextScope: settings.contextScope } : {}),
			...(settings.timeoutMode ? { timeoutMode: settings.timeoutMode } : {}),
			...(settings.requestTimeoutMs !== undefined ? { requestTimeoutMs: settings.requestTimeoutMs } : {}),
			...(settings.streamTimeoutMs !== undefined ? { streamTimeoutMs: settings.streamTimeoutMs } : {}),
			...(settings.toolTimeoutMs !== undefined ? { toolTimeoutMs: settings.toolTimeoutMs } : {}),
			...(settings.agentTimeoutMs !== undefined ? { agentTimeoutMs: settings.agentTimeoutMs } : {}),
			...(settings.conversationTimeoutMs !== undefined
				? { conversationTimeoutMs: settings.conversationTimeoutMs }
				: {}),
		};
	}
	return normalized;
}

function areModelRolesEqual(left: RuntimeModelRoles, right: RuntimeModelRoles): boolean {
	return JSON.stringify(normalizeModelRoles(left)) === JSON.stringify(normalizeModelRoles(right));
}

function normalizePromptTemplate(value: unknown, fallback: string): string {
	if (typeof value !== "string") {
		return fallback;
	}
	const normalized = value.trim();
	return normalized.length > 0 ? value : fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
	if (typeof value === "boolean") {
		return value;
	}
	return fallback;
}

function normalizeMaxConcurrentTasks(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return DEFAULT_MAX_CONCURRENT_TASKS;
	}
	const normalized = Math.trunc(value);
	return normalized > 0 ? normalized : DEFAULT_MAX_CONCURRENT_TASKS;
}

function normalizeLostHeartbeatPolicy(value: unknown): RuntimeLostHeartbeatPolicy {
	return value === "keep_running" ? "keep_running" : DEFAULT_LOST_HEARTBEAT_POLICY;
}

function normalizeCodeEmbeddingSettings(
	value: unknown,
	fallback: RuntimeCodeEmbeddingSettings,
): RuntimeCodeEmbeddingSettings {
	const parsed = runtimeCodeEmbeddingSettingsSchema.safeParse(value);
	if (!parsed.success) {
		return fallback;
	}
	const model = parsed.data.model?.trim() || null;
	const baseUrl = parsed.data.baseUrl?.trim() || null;
	if (parsed.data.provider === "local_lexical") {
		return DEFAULT_CODE_EMBEDDING_SETTINGS;
	}
	return {
		provider: "openai_compatible",
		model,
		baseUrl,
	};
}

function normalizeCodeEmbeddingOverride(value: unknown): RuntimeCodeEmbeddingSettings | null {
	if (value === null || value === undefined) {
		return null;
	}
	return normalizeCodeEmbeddingSettings(value, DEFAULT_CODE_EMBEDDING_SETTINGS);
}

function areCodeEmbeddingSettingsEqual(
	left: RuntimeCodeEmbeddingSettings | null,
	right: RuntimeCodeEmbeddingSettings | null,
): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeShortcutLabel(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
}

function hasOwnKey<T extends object>(value: T | null, key: keyof T): boolean {
	if (!value) {
		return false;
	}
	return Object.hasOwn(value, key);
}

export function getRuntimeGlobalConfigPath(): string {
	return join(getRuntimeHomePath(), CONFIG_FILENAME);
}

export function getRuntimeProjectConfigPath(cwd: string): string {
	return join(resolve(cwd), PROJECT_CONFIG_PARENT_DIR, PROJECT_CONFIG_DIR, PROJECT_CONFIG_FILENAME);
}

interface RuntimeConfigPaths {
	globalConfigPath: string;
	projectConfigPath: string | null;
}

function normalizePathForComparison(path: string): string {
	const normalized = resolve(path).replaceAll("\\", "/");
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function resolveRuntimeConfigPaths(cwd: string | null): RuntimeConfigPaths {
	const globalConfigPath = getRuntimeGlobalConfigPath();
	if (cwd === null) {
		return {
			globalConfigPath,
			projectConfigPath: null,
		};
	}

	const normalizedCwd = normalizePathForComparison(cwd);
	const normalizedHome = normalizePathForComparison(homedir());
	if (normalizedCwd === normalizedHome) {
		return {
			globalConfigPath,
			projectConfigPath: null,
		};
	}

	return {
		globalConfigPath,
		projectConfigPath: getRuntimeProjectConfigPath(cwd),
	};
}

function getRuntimeConfigLockRequests(cwd: string | null): LockRequest[] {
	const paths = resolveRuntimeConfigPaths(cwd);
	const requests: LockRequest[] = [
		{
			path: paths.globalConfigPath,
			type: "file",
		},
	];
	if (paths.projectConfigPath) {
		requests.push({
			path: paths.projectConfigPath,
			type: "file",
		});
	}
	return requests;
}

function toRuntimeConfigState({
	globalConfigPath,
	projectConfigPath,
	globalConfig,
	projectConfig,
}: {
	globalConfigPath: string;
	projectConfigPath: string | null;
	globalConfig: RuntimeGlobalConfigFileShape | null;
	projectConfig: RuntimeProjectConfigFileShape | null;
}): RuntimeConfigState {
	const codeEmbeddingDefaults = normalizeCodeEmbeddingSettings(
		globalConfig?.codeEmbeddingDefaults,
		DEFAULT_CODE_EMBEDDING_SETTINGS,
	);
	const codeEmbeddingOverride = normalizeCodeEmbeddingOverride(projectConfig?.codeEmbeddingOverride);
	return {
		globalConfigPath,
		projectConfigPath,
		selectedAgentId: normalizeAgentId(globalConfig?.selectedAgentId),
		selectedShortcutLabel: normalizeShortcutLabel(globalConfig?.selectedShortcutLabel),
		agentAutonomousModeEnabled: normalizeBoolean(
			globalConfig?.agentAutonomousModeEnabled,
			DEFAULT_AGENT_AUTONOMOUS_MODE_ENABLED,
		),
		agentTimeoutMode: normalizeAgentTimeoutMode(globalConfig?.agentTimeoutMode),
		agentTimeoutProfile: normalizeAgentTimeoutProfile(globalConfig?.agentTimeoutProfile),
		requestTimeoutMs: normalizeTimeoutMsValue(globalConfig?.requestTimeoutMs),
		streamTimeoutMs: normalizeTimeoutMsValue(globalConfig?.streamTimeoutMs),
		toolTimeoutMs: normalizeTimeoutMsValue(globalConfig?.toolTimeoutMs),
		agentTimeoutMs: normalizeTimeoutMsValue(globalConfig?.agentTimeoutMs),
		conversationTimeoutMs: normalizeTimeoutMsValue(globalConfig?.conversationTimeoutMs),
		maxAgentWritableFileLines: normalizeMaxAgentWritableFileLines(globalConfig?.maxAgentWritableFileLines),
		maxConcurrentTasks: normalizeMaxConcurrentTasks(globalConfig?.maxConcurrentTasks),
		lostHeartbeatPolicy: normalizeLostHeartbeatPolicy(globalConfig?.lostHeartbeatPolicy),
		decompositionAutoApplyEnabled: normalizeBoolean(
			globalConfig?.decompositionAutoApplyEnabled,
			DEFAULT_DECOMPOSITION_AUTO_APPLY_ENABLED,
		),
		readyForReviewNotificationsEnabled: normalizeBoolean(
			globalConfig?.readyForReviewNotificationsEnabled,
			DEFAULT_READY_FOR_REVIEW_NOTIFICATIONS_ENABLED,
		),
		codeEmbeddingDefaults,
		codeEmbeddingOverride,
		effectiveCodeEmbeddingSettings: codeEmbeddingOverride ?? codeEmbeddingDefaults,
		modelRoles: normalizeModelRoles(globalConfig?.modelRoles),
		shortcuts: normalizeShortcuts(projectConfig?.shortcuts),
		commitPromptTemplate: normalizePromptTemplate(globalConfig?.commitPromptTemplate, DEFAULT_COMMIT_PROMPT_TEMPLATE),
		openPrPromptTemplate: normalizePromptTemplate(
			globalConfig?.openPrPromptTemplate,
			DEFAULT_OPEN_PR_PROMPT_TEMPLATE,
		),
		commitPromptTemplateDefault: DEFAULT_COMMIT_PROMPT_TEMPLATE,
		openPrPromptTemplateDefault: DEFAULT_OPEN_PR_PROMPT_TEMPLATE,
	};
}

async function readRuntimeConfigFile<T>(configPath: string): Promise<T | null> {
	try {
		const raw = await readFile(configPath, "utf8");
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}

async function writeRuntimeGlobalConfigFile(
	configPath: string,
	config: {
		selectedAgentId?: RuntimeAgentId;
		selectedShortcutLabel?: string | null;
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
		lostHeartbeatPolicy?: RuntimeLostHeartbeatPolicy;
		decompositionAutoApplyEnabled?: boolean;
		readyForReviewNotificationsEnabled?: boolean;
		codeEmbeddingDefaults?: RuntimeCodeEmbeddingSettings;
		modelRoles?: RuntimeModelRoles;
		commitPromptTemplate?: string;
		openPrPromptTemplate?: string;
	},
): Promise<void> {
	const existing = await readRuntimeConfigFile<RuntimeGlobalConfigFileShape>(configPath);
	const selectedAgentId = config.selectedAgentId === undefined ? undefined : normalizeAgentId(config.selectedAgentId);
	const existingSelectedAgentId = hasOwnKey(existing, "selectedAgentId")
		? normalizeAgentId(existing?.selectedAgentId)
		: undefined;
	const selectedShortcutLabel =
		config.selectedShortcutLabel === undefined ? undefined : normalizeShortcutLabel(config.selectedShortcutLabel);
	const existingSelectedShortcutLabel = hasOwnKey(existing, "selectedShortcutLabel")
		? normalizeShortcutLabel(existing?.selectedShortcutLabel)
		: undefined;
	const agentAutonomousModeEnabled =
		config.agentAutonomousModeEnabled === undefined
			? DEFAULT_AGENT_AUTONOMOUS_MODE_ENABLED
			: normalizeBoolean(config.agentAutonomousModeEnabled, DEFAULT_AGENT_AUTONOMOUS_MODE_ENABLED);
	const agentTimeoutMode =
		config.agentTimeoutMode === undefined
			? DEFAULT_AGENT_TIMEOUT_MODE
			: normalizeAgentTimeoutMode(config.agentTimeoutMode);
	const agentTimeoutProfile =
		config.agentTimeoutProfile === undefined
			? DEFAULT_AGENT_TIMEOUT_PROFILE
			: normalizeAgentTimeoutProfile(config.agentTimeoutProfile);
	const defaultTimeouts = resolveProfileTimeoutDefaults(agentTimeoutProfile);
	const requestTimeoutMs =
		config.requestTimeoutMs === undefined
			? defaultTimeouts.requestTimeoutMs
			: normalizeTimeoutMsValue(config.requestTimeoutMs);
	const streamTimeoutMs =
		config.streamTimeoutMs === undefined
			? defaultTimeouts.streamTimeoutMs
			: normalizeTimeoutMsValue(config.streamTimeoutMs);
	const toolTimeoutMs =
		config.toolTimeoutMs === undefined
			? defaultTimeouts.toolTimeoutMs
			: normalizeTimeoutMsValue(config.toolTimeoutMs);
	const agentTimeoutMs =
		config.agentTimeoutMs === undefined
			? defaultTimeouts.agentTimeoutMs
			: normalizeTimeoutMsValue(config.agentTimeoutMs);
	const conversationTimeoutMs =
		config.conversationTimeoutMs === undefined
			? defaultTimeouts.conversationTimeoutMs
			: normalizeTimeoutMsValue(config.conversationTimeoutMs);
	const maxAgentWritableFileLines =
		config.maxAgentWritableFileLines === undefined
			? DEFAULT_MAX_AGENT_WRITABLE_FILE_LINES
			: normalizeMaxAgentWritableFileLines(config.maxAgentWritableFileLines);
	const maxConcurrentTasks =
		config.maxConcurrentTasks === undefined
			? DEFAULT_MAX_CONCURRENT_TASKS
			: normalizeMaxConcurrentTasks(config.maxConcurrentTasks);
	const lostHeartbeatPolicy =
		config.lostHeartbeatPolicy === undefined
			? DEFAULT_LOST_HEARTBEAT_POLICY
			: normalizeLostHeartbeatPolicy(config.lostHeartbeatPolicy);
	const decompositionAutoApplyEnabled =
		config.decompositionAutoApplyEnabled === undefined
			? DEFAULT_DECOMPOSITION_AUTO_APPLY_ENABLED
			: normalizeBoolean(config.decompositionAutoApplyEnabled, DEFAULT_DECOMPOSITION_AUTO_APPLY_ENABLED);
	const readyForReviewNotificationsEnabled =
		config.readyForReviewNotificationsEnabled === undefined
			? DEFAULT_READY_FOR_REVIEW_NOTIFICATIONS_ENABLED
			: normalizeBoolean(config.readyForReviewNotificationsEnabled, DEFAULT_READY_FOR_REVIEW_NOTIFICATIONS_ENABLED);
	const codeEmbeddingDefaults =
		config.codeEmbeddingDefaults === undefined
			? DEFAULT_CODE_EMBEDDING_SETTINGS
			: normalizeCodeEmbeddingSettings(config.codeEmbeddingDefaults, DEFAULT_CODE_EMBEDDING_SETTINGS);
	const modelRoles =
		config.modelRoles === undefined
			? normalizeModelRoles(existing?.modelRoles)
			: normalizeModelRoles(config.modelRoles);
	const commitPromptTemplate =
		config.commitPromptTemplate === undefined
			? DEFAULT_COMMIT_PROMPT_TEMPLATE
			: normalizePromptTemplate(config.commitPromptTemplate, DEFAULT_COMMIT_PROMPT_TEMPLATE);
	const openPrPromptTemplate =
		config.openPrPromptTemplate === undefined
			? DEFAULT_OPEN_PR_PROMPT_TEMPLATE
			: normalizePromptTemplate(config.openPrPromptTemplate, DEFAULT_OPEN_PR_PROMPT_TEMPLATE);

	const payload: RuntimeGlobalConfigFileShape = {};
	if (selectedAgentId !== undefined) {
		if (hasOwnKey(existing, "selectedAgentId") || selectedAgentId !== DEFAULT_AGENT_ID) {
			payload.selectedAgentId = selectedAgentId;
		}
	} else if (existingSelectedAgentId !== undefined) {
		payload.selectedAgentId = existingSelectedAgentId;
	}
	if (selectedShortcutLabel !== undefined) {
		if (selectedShortcutLabel) {
			payload.selectedShortcutLabel = selectedShortcutLabel;
		}
	} else if (existingSelectedShortcutLabel) {
		payload.selectedShortcutLabel = existingSelectedShortcutLabel;
	}
	if (
		hasOwnKey(existing, "agentAutonomousModeEnabled") ||
		agentAutonomousModeEnabled !== DEFAULT_AGENT_AUTONOMOUS_MODE_ENABLED
	) {
		payload.agentAutonomousModeEnabled = agentAutonomousModeEnabled;
	}
	if (hasOwnKey(existing, "agentTimeoutMode") || agentTimeoutMode !== DEFAULT_AGENT_TIMEOUT_MODE) {
		payload.agentTimeoutMode = agentTimeoutMode;
	}
	if (hasOwnKey(existing, "agentTimeoutProfile") || agentTimeoutProfile !== DEFAULT_AGENT_TIMEOUT_PROFILE) {
		payload.agentTimeoutProfile = agentTimeoutProfile;
	}
	if (hasOwnKey(existing, "requestTimeoutMs") || requestTimeoutMs !== defaultTimeouts.requestTimeoutMs) {
		payload.requestTimeoutMs = requestTimeoutMs;
	}
	if (hasOwnKey(existing, "streamTimeoutMs") || streamTimeoutMs !== defaultTimeouts.streamTimeoutMs) {
		payload.streamTimeoutMs = streamTimeoutMs;
	}
	if (hasOwnKey(existing, "toolTimeoutMs") || toolTimeoutMs !== defaultTimeouts.toolTimeoutMs) {
		payload.toolTimeoutMs = toolTimeoutMs;
	}
	if (hasOwnKey(existing, "agentTimeoutMs") || agentTimeoutMs !== defaultTimeouts.agentTimeoutMs) {
		payload.agentTimeoutMs = agentTimeoutMs;
	}
	if (
		hasOwnKey(existing, "conversationTimeoutMs") ||
		conversationTimeoutMs !== defaultTimeouts.conversationTimeoutMs
	) {
		payload.conversationTimeoutMs = conversationTimeoutMs;
	}
	if (
		hasOwnKey(existing, "maxAgentWritableFileLines") ||
		maxAgentWritableFileLines !== DEFAULT_MAX_AGENT_WRITABLE_FILE_LINES
	) {
		payload.maxAgentWritableFileLines = maxAgentWritableFileLines;
	}
	if (hasOwnKey(existing, "maxConcurrentTasks") || maxConcurrentTasks !== DEFAULT_MAX_CONCURRENT_TASKS) {
		payload.maxConcurrentTasks = maxConcurrentTasks;
	}
	if (hasOwnKey(existing, "lostHeartbeatPolicy") || lostHeartbeatPolicy !== DEFAULT_LOST_HEARTBEAT_POLICY) {
		payload.lostHeartbeatPolicy = lostHeartbeatPolicy;
	}
	if (
		hasOwnKey(existing, "decompositionAutoApplyEnabled") ||
		decompositionAutoApplyEnabled !== DEFAULT_DECOMPOSITION_AUTO_APPLY_ENABLED
	) {
		payload.decompositionAutoApplyEnabled = decompositionAutoApplyEnabled;
	}
	if (
		hasOwnKey(existing, "readyForReviewNotificationsEnabled") ||
		readyForReviewNotificationsEnabled !== DEFAULT_READY_FOR_REVIEW_NOTIFICATIONS_ENABLED
	) {
		payload.readyForReviewNotificationsEnabled = readyForReviewNotificationsEnabled;
	}
	if (
		hasOwnKey(existing, "codeEmbeddingDefaults") ||
		!areCodeEmbeddingSettingsEqual(codeEmbeddingDefaults, DEFAULT_CODE_EMBEDDING_SETTINGS)
	) {
		payload.codeEmbeddingDefaults = codeEmbeddingDefaults;
	}
	if (hasOwnKey(existing, "modelRoles") || Object.keys(modelRoles).length > 0) {
		payload.modelRoles = modelRoles;
	}
	if (hasOwnKey(existing, "commitPromptTemplate") || commitPromptTemplate !== DEFAULT_COMMIT_PROMPT_TEMPLATE) {
		payload.commitPromptTemplate = commitPromptTemplate;
	}
	if (hasOwnKey(existing, "openPrPromptTemplate") || openPrPromptTemplate !== DEFAULT_OPEN_PR_PROMPT_TEMPLATE) {
		payload.openPrPromptTemplate = openPrPromptTemplate;
	}

	await lockedFileSystem.writeJsonFileAtomic(configPath, payload, {
		lock: null,
	});
}

async function writeRuntimeProjectConfigFile(
	configPath: string | null,
	config: { shortcuts: RuntimeProjectShortcut[]; codeEmbeddingOverride?: RuntimeCodeEmbeddingSettings | null },
): Promise<void> {
	const normalizedShortcuts = normalizeShortcuts(config.shortcuts);
	const codeEmbeddingOverride = normalizeCodeEmbeddingOverride(config.codeEmbeddingOverride);
	if (!configPath) {
		if (normalizedShortcuts.length > 0) {
			throw new Error("Cannot save project shortcuts without a selected project.");
		}
		if (codeEmbeddingOverride) {
			throw new Error("Cannot save project embedding overrides without a selected project.");
		}
		return;
	}
	if (normalizedShortcuts.length === 0 && codeEmbeddingOverride === null) {
		await rm(configPath, { force: true });
		try {
			await rm(dirname(configPath));
		} catch {
			// Ignore missing or non-empty project config directories.
		}
		return;
	}
	await lockedFileSystem.writeJsonFileAtomic(
		configPath,
		{
			shortcuts: normalizedShortcuts,
			...(codeEmbeddingOverride ? { codeEmbeddingOverride } : {}),
		} satisfies RuntimeProjectConfigFileShape,
		{
			lock: null,
		},
	);
}

interface RuntimeConfigFiles {
	globalConfigPath: string;
	projectConfigPath: string | null;
	globalConfig: RuntimeGlobalConfigFileShape | null;
	projectConfig: RuntimeProjectConfigFileShape | null;
}

async function readRuntimeConfigFiles(cwd: string | null): Promise<RuntimeConfigFiles> {
	const { globalConfigPath, projectConfigPath } = resolveRuntimeConfigPaths(cwd);
	return {
		globalConfigPath,
		projectConfigPath,
		globalConfig: await readRuntimeConfigFile<RuntimeGlobalConfigFileShape>(globalConfigPath),
		projectConfig: projectConfigPath
			? await readRuntimeConfigFile<RuntimeProjectConfigFileShape>(projectConfigPath)
			: null,
	};
}

async function loadRuntimeConfigLocked(cwd: string | null): Promise<RuntimeConfigState> {
	const configFiles = await readRuntimeConfigFiles(cwd);
	if (configFiles.globalConfig === null) {
		const autoSelectedAgentId = pickBestInstalledAgentId();
		if (autoSelectedAgentId) {
			await writeRuntimeGlobalConfigFile(configFiles.globalConfigPath, {
				selectedAgentId: autoSelectedAgentId,
			});
			configFiles.globalConfig = {
				selectedAgentId: autoSelectedAgentId,
			};
		}
	}
	return toRuntimeConfigState(configFiles);
}

function createRuntimeConfigStateFromValues(input: {
	globalConfigPath: string;
	projectConfigPath: string | null;
	selectedAgentId: RuntimeAgentId;
	selectedShortcutLabel: string | null;
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
	lostHeartbeatPolicy: RuntimeLostHeartbeatPolicy;
	decompositionAutoApplyEnabled: boolean;
	readyForReviewNotificationsEnabled: boolean;
	codeEmbeddingDefaults: RuntimeCodeEmbeddingSettings;
	codeEmbeddingOverride: RuntimeCodeEmbeddingSettings | null;
	modelRoles: RuntimeModelRoles;
	shortcuts: RuntimeProjectShortcut[];
	commitPromptTemplate: string;
	openPrPromptTemplate: string;
}): RuntimeConfigState {
	return {
		globalConfigPath: input.globalConfigPath,
		projectConfigPath: input.projectConfigPath,
		selectedAgentId: normalizeAgentId(input.selectedAgentId),
		selectedShortcutLabel: normalizeShortcutLabel(input.selectedShortcutLabel),
		agentAutonomousModeEnabled: normalizeBoolean(
			input.agentAutonomousModeEnabled,
			DEFAULT_AGENT_AUTONOMOUS_MODE_ENABLED,
		),
		agentTimeoutMode: normalizeAgentTimeoutMode(input.agentTimeoutMode),
		agentTimeoutProfile: normalizeAgentTimeoutProfile(input.agentTimeoutProfile),
		requestTimeoutMs: normalizeTimeoutMsValue(input.requestTimeoutMs),
		streamTimeoutMs: normalizeTimeoutMsValue(input.streamTimeoutMs),
		toolTimeoutMs: normalizeTimeoutMsValue(input.toolTimeoutMs),
		agentTimeoutMs: normalizeTimeoutMsValue(input.agentTimeoutMs),
		conversationTimeoutMs: normalizeTimeoutMsValue(input.conversationTimeoutMs),
		maxAgentWritableFileLines: normalizeMaxAgentWritableFileLines(input.maxAgentWritableFileLines),
		maxConcurrentTasks: normalizeMaxConcurrentTasks(input.maxConcurrentTasks),
		lostHeartbeatPolicy: normalizeLostHeartbeatPolicy(input.lostHeartbeatPolicy),
		decompositionAutoApplyEnabled: normalizeBoolean(
			input.decompositionAutoApplyEnabled,
			DEFAULT_DECOMPOSITION_AUTO_APPLY_ENABLED,
		),
		readyForReviewNotificationsEnabled: normalizeBoolean(
			input.readyForReviewNotificationsEnabled,
			DEFAULT_READY_FOR_REVIEW_NOTIFICATIONS_ENABLED,
		),
		codeEmbeddingDefaults: normalizeCodeEmbeddingSettings(
			input.codeEmbeddingDefaults,
			DEFAULT_CODE_EMBEDDING_SETTINGS,
		),
		codeEmbeddingOverride: normalizeCodeEmbeddingOverride(input.codeEmbeddingOverride),
		effectiveCodeEmbeddingSettings:
			normalizeCodeEmbeddingOverride(input.codeEmbeddingOverride) ??
			normalizeCodeEmbeddingSettings(input.codeEmbeddingDefaults, DEFAULT_CODE_EMBEDDING_SETTINGS),
		modelRoles: normalizeModelRoles(input.modelRoles),
		shortcuts: normalizeShortcuts(input.shortcuts),
		commitPromptTemplate: normalizePromptTemplate(input.commitPromptTemplate, DEFAULT_COMMIT_PROMPT_TEMPLATE),
		openPrPromptTemplate: normalizePromptTemplate(input.openPrPromptTemplate, DEFAULT_OPEN_PR_PROMPT_TEMPLATE),
		commitPromptTemplateDefault: DEFAULT_COMMIT_PROMPT_TEMPLATE,
		openPrPromptTemplateDefault: DEFAULT_OPEN_PR_PROMPT_TEMPLATE,
	};
}

export function toGlobalRuntimeConfigState(current: RuntimeConfigState): RuntimeConfigState {
	return createRuntimeConfigStateFromValues({
		globalConfigPath: current.globalConfigPath,
		projectConfigPath: null,
		selectedAgentId: current.selectedAgentId,
		selectedShortcutLabel: current.selectedShortcutLabel,
		agentAutonomousModeEnabled: current.agentAutonomousModeEnabled,
		agentTimeoutMode: current.agentTimeoutMode,
		agentTimeoutProfile: current.agentTimeoutProfile,
		requestTimeoutMs: current.requestTimeoutMs,
		streamTimeoutMs: current.streamTimeoutMs,
		toolTimeoutMs: current.toolTimeoutMs,
		agentTimeoutMs: current.agentTimeoutMs,
		conversationTimeoutMs: current.conversationTimeoutMs,
		maxAgentWritableFileLines: current.maxAgentWritableFileLines,
		maxConcurrentTasks: current.maxConcurrentTasks,
		lostHeartbeatPolicy: current.lostHeartbeatPolicy,
		decompositionAutoApplyEnabled: current.decompositionAutoApplyEnabled,
		readyForReviewNotificationsEnabled: current.readyForReviewNotificationsEnabled,
		codeEmbeddingDefaults: current.codeEmbeddingDefaults,
		codeEmbeddingOverride: null,
		modelRoles: current.modelRoles,
		shortcuts: [],
		commitPromptTemplate: current.commitPromptTemplate,
		openPrPromptTemplate: current.openPrPromptTemplate,
	});
}

export async function loadRuntimeConfig(cwd: string): Promise<RuntimeConfigState> {
	const configFiles = await readRuntimeConfigFiles(cwd);
	if (configFiles.globalConfig !== null) {
		return toRuntimeConfigState(configFiles);
	}
	return await lockedFileSystem.withLocks(
		getRuntimeConfigLockRequests(cwd),
		async () => await loadRuntimeConfigLocked(cwd),
	);
}

export async function loadGlobalRuntimeConfig(): Promise<RuntimeConfigState> {
	const configFiles = await readRuntimeConfigFiles(null);
	if (configFiles.globalConfig !== null) {
		return toRuntimeConfigState(configFiles);
	}
	return await lockedFileSystem.withLocks(
		getRuntimeConfigLockRequests(null),
		async () => await loadRuntimeConfigLocked(null),
	);
}

export async function saveRuntimeConfig(
	cwd: string,
	config: {
		selectedAgentId: RuntimeAgentId;
		selectedShortcutLabel: string | null;
		agentAutonomousModeEnabled: boolean;
		agentTimeoutMode: RuntimeAgentTimeoutMode;
		agentTimeoutProfile: RuntimeAgentTimeoutProfile;
		requestTimeoutMs: number | null;
		streamTimeoutMs: number | null;
		toolTimeoutMs: number | null;
		agentTimeoutMs: number | null;
		conversationTimeoutMs: number | null;
		maxAgentWritableFileLines?: number;
		maxConcurrentTasks?: number;
		lostHeartbeatPolicy?: RuntimeLostHeartbeatPolicy;
		decompositionAutoApplyEnabled?: boolean;
		readyForReviewNotificationsEnabled: boolean;
		codeEmbeddingDefaults?: RuntimeCodeEmbeddingSettings;
		codeEmbeddingOverride?: RuntimeCodeEmbeddingSettings | null;
		modelRoles?: RuntimeModelRoles;
		shortcuts: RuntimeProjectShortcut[];
		commitPromptTemplate: string;
		openPrPromptTemplate: string;
	},
): Promise<RuntimeConfigState> {
	const { globalConfigPath, projectConfigPath } = resolveRuntimeConfigPaths(cwd);
	return await lockedFileSystem.withLocks(getRuntimeConfigLockRequests(cwd), async () => {
		await writeRuntimeGlobalConfigFile(globalConfigPath, {
			selectedAgentId: config.selectedAgentId,
			selectedShortcutLabel: config.selectedShortcutLabel,
			agentAutonomousModeEnabled: config.agentAutonomousModeEnabled,
			agentTimeoutMode: config.agentTimeoutMode,
			agentTimeoutProfile: config.agentTimeoutProfile,
			requestTimeoutMs: config.requestTimeoutMs,
			streamTimeoutMs: config.streamTimeoutMs,
			toolTimeoutMs: config.toolTimeoutMs,
			agentTimeoutMs: config.agentTimeoutMs,
			conversationTimeoutMs: config.conversationTimeoutMs,
			maxAgentWritableFileLines: normalizeMaxAgentWritableFileLines(config.maxAgentWritableFileLines),
			maxConcurrentTasks: normalizeMaxConcurrentTasks(config.maxConcurrentTasks),
			lostHeartbeatPolicy: normalizeLostHeartbeatPolicy(config.lostHeartbeatPolicy),
			decompositionAutoApplyEnabled: normalizeBoolean(
				config.decompositionAutoApplyEnabled,
				DEFAULT_DECOMPOSITION_AUTO_APPLY_ENABLED,
			),
			readyForReviewNotificationsEnabled: config.readyForReviewNotificationsEnabled,
			codeEmbeddingDefaults: config.codeEmbeddingDefaults,
			modelRoles: config.modelRoles,
			commitPromptTemplate: config.commitPromptTemplate,
			openPrPromptTemplate: config.openPrPromptTemplate,
		});
		await writeRuntimeProjectConfigFile(projectConfigPath, {
			shortcuts: config.shortcuts,
			codeEmbeddingOverride: config.codeEmbeddingOverride,
		});
		return createRuntimeConfigStateFromValues({
			globalConfigPath,
			projectConfigPath,
			selectedAgentId: config.selectedAgentId,
			selectedShortcutLabel: config.selectedShortcutLabel,
			agentAutonomousModeEnabled: config.agentAutonomousModeEnabled,
			agentTimeoutMode: config.agentTimeoutMode,
			agentTimeoutProfile: config.agentTimeoutProfile,
			requestTimeoutMs: config.requestTimeoutMs,
			streamTimeoutMs: config.streamTimeoutMs,
			toolTimeoutMs: config.toolTimeoutMs,
			agentTimeoutMs: config.agentTimeoutMs,
			conversationTimeoutMs: config.conversationTimeoutMs,
			maxAgentWritableFileLines: normalizeMaxAgentWritableFileLines(config.maxAgentWritableFileLines),
			maxConcurrentTasks: normalizeMaxConcurrentTasks(config.maxConcurrentTasks),
			lostHeartbeatPolicy: normalizeLostHeartbeatPolicy(config.lostHeartbeatPolicy),
			decompositionAutoApplyEnabled: normalizeBoolean(
				config.decompositionAutoApplyEnabled,
				DEFAULT_DECOMPOSITION_AUTO_APPLY_ENABLED,
			),
			readyForReviewNotificationsEnabled: config.readyForReviewNotificationsEnabled,
			codeEmbeddingDefaults: config.codeEmbeddingDefaults ?? DEFAULT_CODE_EMBEDDING_SETTINGS,
			codeEmbeddingOverride: config.codeEmbeddingOverride ?? null,
			modelRoles: normalizeModelRoles(config.modelRoles),
			shortcuts: config.shortcuts,
			commitPromptTemplate: config.commitPromptTemplate,
			openPrPromptTemplate: config.openPrPromptTemplate,
		});
	});
}

export async function updateRuntimeConfig(cwd: string, updates: RuntimeConfigUpdateInput): Promise<RuntimeConfigState> {
	const { globalConfigPath, projectConfigPath } = resolveRuntimeConfigPaths(cwd);
	return await lockedFileSystem.withLocks(getRuntimeConfigLockRequests(cwd), async () => {
		const current = await loadRuntimeConfigLocked(cwd);
		if (projectConfigPath === null && normalizeShortcuts(updates.shortcuts).length > 0) {
			throw new Error("Cannot save project shortcuts without a selected project.");
		}
		const nextConfig = {
			selectedAgentId: updates.selectedAgentId ?? current.selectedAgentId,
			selectedShortcutLabel:
				updates.selectedShortcutLabel === undefined ? current.selectedShortcutLabel : updates.selectedShortcutLabel,
			agentAutonomousModeEnabled: updates.agentAutonomousModeEnabled ?? current.agentAutonomousModeEnabled,
			agentTimeoutMode: updates.agentTimeoutMode ?? current.agentTimeoutMode,
			agentTimeoutProfile: updates.agentTimeoutProfile ?? current.agentTimeoutProfile,
			requestTimeoutMs: updates.requestTimeoutMs === undefined ? current.requestTimeoutMs : updates.requestTimeoutMs,
			streamTimeoutMs: updates.streamTimeoutMs === undefined ? current.streamTimeoutMs : updates.streamTimeoutMs,
			toolTimeoutMs: updates.toolTimeoutMs === undefined ? current.toolTimeoutMs : updates.toolTimeoutMs,
			agentTimeoutMs: updates.agentTimeoutMs === undefined ? current.agentTimeoutMs : updates.agentTimeoutMs,
			conversationTimeoutMs:
				updates.conversationTimeoutMs === undefined ? current.conversationTimeoutMs : updates.conversationTimeoutMs,
			maxAgentWritableFileLines:
				updates.maxAgentWritableFileLines === undefined
					? current.maxAgentWritableFileLines
					: normalizeMaxAgentWritableFileLines(updates.maxAgentWritableFileLines),
			maxConcurrentTasks:
				updates.maxConcurrentTasks === undefined
					? current.maxConcurrentTasks
					: normalizeMaxConcurrentTasks(updates.maxConcurrentTasks),
			lostHeartbeatPolicy:
				updates.lostHeartbeatPolicy === undefined
					? current.lostHeartbeatPolicy
					: normalizeLostHeartbeatPolicy(updates.lostHeartbeatPolicy),
			decompositionAutoApplyEnabled:
				updates.decompositionAutoApplyEnabled === undefined
					? current.decompositionAutoApplyEnabled
					: normalizeBoolean(updates.decompositionAutoApplyEnabled, DEFAULT_DECOMPOSITION_AUTO_APPLY_ENABLED),
			readyForReviewNotificationsEnabled:
				updates.readyForReviewNotificationsEnabled ?? current.readyForReviewNotificationsEnabled,
			codeEmbeddingDefaults:
				updates.codeEmbeddingDefaults === undefined
					? current.codeEmbeddingDefaults
					: normalizeCodeEmbeddingSettings(updates.codeEmbeddingDefaults, DEFAULT_CODE_EMBEDDING_SETTINGS),
			codeEmbeddingOverride:
				updates.codeEmbeddingOverride === undefined
					? current.codeEmbeddingOverride
					: normalizeCodeEmbeddingOverride(updates.codeEmbeddingOverride),
			modelRoles: updates.modelRoles === undefined ? current.modelRoles : normalizeModelRoles(updates.modelRoles),
			shortcuts: projectConfigPath ? (updates.shortcuts ?? current.shortcuts) : current.shortcuts,
			commitPromptTemplate: updates.commitPromptTemplate ?? current.commitPromptTemplate,
			openPrPromptTemplate: updates.openPrPromptTemplate ?? current.openPrPromptTemplate,
		};

		const hasChanges =
			nextConfig.selectedAgentId !== current.selectedAgentId ||
			nextConfig.selectedShortcutLabel !== current.selectedShortcutLabel ||
			nextConfig.agentAutonomousModeEnabled !== current.agentAutonomousModeEnabled ||
			nextConfig.agentTimeoutMode !== current.agentTimeoutMode ||
			nextConfig.agentTimeoutProfile !== current.agentTimeoutProfile ||
			nextConfig.requestTimeoutMs !== current.requestTimeoutMs ||
			nextConfig.streamTimeoutMs !== current.streamTimeoutMs ||
			nextConfig.toolTimeoutMs !== current.toolTimeoutMs ||
			nextConfig.agentTimeoutMs !== current.agentTimeoutMs ||
			nextConfig.conversationTimeoutMs !== current.conversationTimeoutMs ||
			nextConfig.maxAgentWritableFileLines !== current.maxAgentWritableFileLines ||
			nextConfig.maxConcurrentTasks !== current.maxConcurrentTasks ||
			nextConfig.lostHeartbeatPolicy !== current.lostHeartbeatPolicy ||
			nextConfig.decompositionAutoApplyEnabled !== current.decompositionAutoApplyEnabled ||
			nextConfig.readyForReviewNotificationsEnabled !== current.readyForReviewNotificationsEnabled ||
			!areCodeEmbeddingSettingsEqual(nextConfig.codeEmbeddingDefaults, current.codeEmbeddingDefaults) ||
			!areCodeEmbeddingSettingsEqual(nextConfig.codeEmbeddingOverride, current.codeEmbeddingOverride) ||
			!areModelRolesEqual(nextConfig.modelRoles, current.modelRoles) ||
			nextConfig.commitPromptTemplate !== current.commitPromptTemplate ||
			nextConfig.openPrPromptTemplate !== current.openPrPromptTemplate ||
			!areRuntimeProjectShortcutsEqual(nextConfig.shortcuts, current.shortcuts);

		if (!hasChanges) {
			return current;
		}

		await writeRuntimeGlobalConfigFile(globalConfigPath, {
			selectedAgentId: nextConfig.selectedAgentId,
			selectedShortcutLabel: nextConfig.selectedShortcutLabel,
			agentAutonomousModeEnabled: nextConfig.agentAutonomousModeEnabled,
			agentTimeoutMode: nextConfig.agentTimeoutMode,
			agentTimeoutProfile: nextConfig.agentTimeoutProfile,
			requestTimeoutMs: nextConfig.requestTimeoutMs,
			streamTimeoutMs: nextConfig.streamTimeoutMs,
			toolTimeoutMs: nextConfig.toolTimeoutMs,
			agentTimeoutMs: nextConfig.agentTimeoutMs,
			conversationTimeoutMs: nextConfig.conversationTimeoutMs,
			maxAgentWritableFileLines: nextConfig.maxAgentWritableFileLines,
			maxConcurrentTasks: nextConfig.maxConcurrentTasks,
			lostHeartbeatPolicy: nextConfig.lostHeartbeatPolicy,
			decompositionAutoApplyEnabled: nextConfig.decompositionAutoApplyEnabled,
			readyForReviewNotificationsEnabled: nextConfig.readyForReviewNotificationsEnabled,
			codeEmbeddingDefaults: nextConfig.codeEmbeddingDefaults,
			modelRoles: nextConfig.modelRoles,
			commitPromptTemplate: nextConfig.commitPromptTemplate,
			openPrPromptTemplate: nextConfig.openPrPromptTemplate,
		});
		await writeRuntimeProjectConfigFile(projectConfigPath, {
			shortcuts: nextConfig.shortcuts,
			codeEmbeddingOverride: nextConfig.codeEmbeddingOverride,
		});
		return createRuntimeConfigStateFromValues({
			globalConfigPath,
			projectConfigPath,
			selectedAgentId: nextConfig.selectedAgentId,
			selectedShortcutLabel: nextConfig.selectedShortcutLabel,
			agentAutonomousModeEnabled: nextConfig.agentAutonomousModeEnabled,
			agentTimeoutMode: nextConfig.agentTimeoutMode,
			agentTimeoutProfile: nextConfig.agentTimeoutProfile,
			requestTimeoutMs: nextConfig.requestTimeoutMs,
			streamTimeoutMs: nextConfig.streamTimeoutMs,
			toolTimeoutMs: nextConfig.toolTimeoutMs,
			agentTimeoutMs: nextConfig.agentTimeoutMs,
			conversationTimeoutMs: nextConfig.conversationTimeoutMs,
			maxAgentWritableFileLines: nextConfig.maxAgentWritableFileLines,
			maxConcurrentTasks: nextConfig.maxConcurrentTasks,
			lostHeartbeatPolicy: nextConfig.lostHeartbeatPolicy,
			decompositionAutoApplyEnabled: nextConfig.decompositionAutoApplyEnabled,
			readyForReviewNotificationsEnabled: nextConfig.readyForReviewNotificationsEnabled,
			codeEmbeddingDefaults: nextConfig.codeEmbeddingDefaults,
			codeEmbeddingOverride: nextConfig.codeEmbeddingOverride,
			modelRoles: nextConfig.modelRoles,
			shortcuts: nextConfig.shortcuts,
			commitPromptTemplate: nextConfig.commitPromptTemplate,
			openPrPromptTemplate: nextConfig.openPrPromptTemplate,
		});
	});
}

export async function updateGlobalRuntimeConfig(
	current: RuntimeConfigState,
	updates: RuntimeConfigUpdateInput,
): Promise<RuntimeConfigState> {
	const globalConfigPath = getRuntimeGlobalConfigPath();
	return await lockedFileSystem.withLocks(
		[
			{
				path: globalConfigPath,
				type: "file",
			},
		],
		async () => {
			const nextConfig = {
				selectedAgentId: updates.selectedAgentId ?? current.selectedAgentId,
				selectedShortcutLabel:
					updates.selectedShortcutLabel === undefined
						? current.selectedShortcutLabel
						: updates.selectedShortcutLabel,
				agentAutonomousModeEnabled: updates.agentAutonomousModeEnabled ?? current.agentAutonomousModeEnabled,
				agentTimeoutMode: updates.agentTimeoutMode ?? current.agentTimeoutMode,
				agentTimeoutProfile: updates.agentTimeoutProfile ?? current.agentTimeoutProfile,
				requestTimeoutMs:
					updates.requestTimeoutMs === undefined ? current.requestTimeoutMs : updates.requestTimeoutMs,
				streamTimeoutMs: updates.streamTimeoutMs === undefined ? current.streamTimeoutMs : updates.streamTimeoutMs,
				toolTimeoutMs: updates.toolTimeoutMs === undefined ? current.toolTimeoutMs : updates.toolTimeoutMs,
				agentTimeoutMs: updates.agentTimeoutMs === undefined ? current.agentTimeoutMs : updates.agentTimeoutMs,
				conversationTimeoutMs:
					updates.conversationTimeoutMs === undefined
						? current.conversationTimeoutMs
						: updates.conversationTimeoutMs,
				maxAgentWritableFileLines:
					updates.maxAgentWritableFileLines === undefined
						? current.maxAgentWritableFileLines
						: normalizeMaxAgentWritableFileLines(updates.maxAgentWritableFileLines),
				maxConcurrentTasks:
					updates.maxConcurrentTasks === undefined
						? current.maxConcurrentTasks
						: normalizeMaxConcurrentTasks(updates.maxConcurrentTasks),
				lostHeartbeatPolicy:
					updates.lostHeartbeatPolicy === undefined
						? current.lostHeartbeatPolicy
						: normalizeLostHeartbeatPolicy(updates.lostHeartbeatPolicy),
				decompositionAutoApplyEnabled:
					updates.decompositionAutoApplyEnabled === undefined
						? current.decompositionAutoApplyEnabled
						: normalizeBoolean(updates.decompositionAutoApplyEnabled, DEFAULT_DECOMPOSITION_AUTO_APPLY_ENABLED),
				readyForReviewNotificationsEnabled:
					updates.readyForReviewNotificationsEnabled ?? current.readyForReviewNotificationsEnabled,
				codeEmbeddingDefaults:
					updates.codeEmbeddingDefaults === undefined
						? current.codeEmbeddingDefaults
						: normalizeCodeEmbeddingSettings(updates.codeEmbeddingDefaults, DEFAULT_CODE_EMBEDDING_SETTINGS),
				codeEmbeddingOverride: null,
				modelRoles: updates.modelRoles === undefined ? current.modelRoles : normalizeModelRoles(updates.modelRoles),
				shortcuts: current.shortcuts,
				commitPromptTemplate: updates.commitPromptTemplate ?? current.commitPromptTemplate,
				openPrPromptTemplate: updates.openPrPromptTemplate ?? current.openPrPromptTemplate,
			};

			const hasChanges =
				nextConfig.selectedAgentId !== current.selectedAgentId ||
				nextConfig.selectedShortcutLabel !== current.selectedShortcutLabel ||
				nextConfig.agentAutonomousModeEnabled !== current.agentAutonomousModeEnabled ||
				nextConfig.agentTimeoutMode !== current.agentTimeoutMode ||
				nextConfig.agentTimeoutProfile !== current.agentTimeoutProfile ||
				nextConfig.requestTimeoutMs !== current.requestTimeoutMs ||
				nextConfig.streamTimeoutMs !== current.streamTimeoutMs ||
				nextConfig.toolTimeoutMs !== current.toolTimeoutMs ||
				nextConfig.agentTimeoutMs !== current.agentTimeoutMs ||
				nextConfig.conversationTimeoutMs !== current.conversationTimeoutMs ||
				nextConfig.maxAgentWritableFileLines !== current.maxAgentWritableFileLines ||
				nextConfig.maxConcurrentTasks !== current.maxConcurrentTasks ||
				nextConfig.lostHeartbeatPolicy !== current.lostHeartbeatPolicy ||
				nextConfig.decompositionAutoApplyEnabled !== current.decompositionAutoApplyEnabled ||
				nextConfig.readyForReviewNotificationsEnabled !== current.readyForReviewNotificationsEnabled ||
				!areCodeEmbeddingSettingsEqual(nextConfig.codeEmbeddingDefaults, current.codeEmbeddingDefaults) ||
				!areModelRolesEqual(nextConfig.modelRoles, current.modelRoles) ||
				nextConfig.commitPromptTemplate !== current.commitPromptTemplate ||
				nextConfig.openPrPromptTemplate !== current.openPrPromptTemplate;

			if (!hasChanges) {
				return current;
			}

			await writeRuntimeGlobalConfigFile(globalConfigPath, {
				selectedAgentId: nextConfig.selectedAgentId,
				selectedShortcutLabel: nextConfig.selectedShortcutLabel,
				agentAutonomousModeEnabled: nextConfig.agentAutonomousModeEnabled,
				agentTimeoutMode: nextConfig.agentTimeoutMode,
				agentTimeoutProfile: nextConfig.agentTimeoutProfile,
				requestTimeoutMs: nextConfig.requestTimeoutMs,
				streamTimeoutMs: nextConfig.streamTimeoutMs,
				toolTimeoutMs: nextConfig.toolTimeoutMs,
				agentTimeoutMs: nextConfig.agentTimeoutMs,
				conversationTimeoutMs: nextConfig.conversationTimeoutMs,
				maxAgentWritableFileLines: nextConfig.maxAgentWritableFileLines,
				maxConcurrentTasks: nextConfig.maxConcurrentTasks,
				lostHeartbeatPolicy: nextConfig.lostHeartbeatPolicy,
				decompositionAutoApplyEnabled: nextConfig.decompositionAutoApplyEnabled,
				readyForReviewNotificationsEnabled: nextConfig.readyForReviewNotificationsEnabled,
				codeEmbeddingDefaults: nextConfig.codeEmbeddingDefaults,
				modelRoles: nextConfig.modelRoles,
				commitPromptTemplate: nextConfig.commitPromptTemplate,
				openPrPromptTemplate: nextConfig.openPrPromptTemplate,
			});

			return createRuntimeConfigStateFromValues({
				globalConfigPath,
				projectConfigPath: current.projectConfigPath,
				selectedAgentId: nextConfig.selectedAgentId,
				selectedShortcutLabel: nextConfig.selectedShortcutLabel,
				agentAutonomousModeEnabled: nextConfig.agentAutonomousModeEnabled,
				agentTimeoutMode: nextConfig.agentTimeoutMode,
				agentTimeoutProfile: nextConfig.agentTimeoutProfile,
				requestTimeoutMs: nextConfig.requestTimeoutMs,
				streamTimeoutMs: nextConfig.streamTimeoutMs,
				toolTimeoutMs: nextConfig.toolTimeoutMs,
				agentTimeoutMs: nextConfig.agentTimeoutMs,
				conversationTimeoutMs: nextConfig.conversationTimeoutMs,
				maxAgentWritableFileLines: nextConfig.maxAgentWritableFileLines,
				maxConcurrentTasks: nextConfig.maxConcurrentTasks,
				lostHeartbeatPolicy: nextConfig.lostHeartbeatPolicy,
				decompositionAutoApplyEnabled: nextConfig.decompositionAutoApplyEnabled,
				readyForReviewNotificationsEnabled: nextConfig.readyForReviewNotificationsEnabled,
				codeEmbeddingDefaults: nextConfig.codeEmbeddingDefaults,
				codeEmbeddingOverride: null,
				modelRoles: nextConfig.modelRoles,
				shortcuts: nextConfig.shortcuts,
				commitPromptTemplate: nextConfig.commitPromptTemplate,
				openPrPromptTemplate: nextConfig.openPrPromptTemplate,
			});
		},
	);
}
