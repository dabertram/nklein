import { createHash } from "node:crypto";
import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import packageJson from "../../package.json" with { type: "json" };
import type { RuntimeConfigState } from "../config/runtime-config";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import type {
	RuntimeBoardCard,
	RuntimeKnowledgeToolCategory,
	RuntimeKnowledgeToolOutcome,
	RuntimeKnowledgeToolUsageAggregate,
	RuntimeKnowledgeToolUsageObservation,
	RuntimeKnowledgeToolUsageStatsResponse,
	RuntimeModelPerformanceRole,
	RuntimeTaskClineSettings,
	RuntimeTaskSessionSummary,
} from "../core/api-contract";
import { runtimeKnowledgeToolUsageObservationSchema } from "../core/api-contract";

const DEFAULT_KNOWLEDGE_TOOL_USAGE_ROOT = join(resolveNkleinRuntimeHomePath(homedir()), "knowledge-tool-usage");
const DEFAULT_OBSERVATION_LIMIT = 1_000;
const APP_VERSION = typeof packageJson.version === "string" ? packageJson.version : "0.1.0";
const RECORDABLE_HOOK_EVENTS = new Set(["tool_call", "tool_result", "decomposition_applied"]);

export interface RecordKnowledgeToolUsageObservationInput {
	workspaceId: string | null;
	workspacePath: string | null;
	card: RuntimeBoardCard | null;
	runtimeConfig: RuntimeConfigState | null;
	summary: RuntimeTaskSessionSummary;
	now?: number;
	rootDir?: string;
}

export interface ReadKnowledgeToolUsageStatsOptions {
	rootDir?: string;
	workspacePath?: string | null;
	limit?: number;
	now?: number;
}

function resolveRootDir(rootDir?: string): string {
	return rootDir ?? DEFAULT_KNOWLEDGE_TOOL_USAGE_ROOT;
}

function formatLogDate(timestamp: number): string {
	return new Date(timestamp).toISOString().slice(0, 10);
}

function resolveLogPath(rootDir: string, timestamp: number): string {
	return join(rootDir, `${formatLogDate(timestamp)}.jsonl`);
}

function normalizeOptionalString(value: string | null | undefined): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function normalizeRequiredString(value: string | null | undefined): string | null {
	return normalizeOptionalString(value);
}

function hashValue(value: string | null): string | null {
	return value ? createHash("sha256").update(value).digest("hex") : null;
}

function buildObservationId(input: {
	workspacePathHash: string | null;
	taskId: string;
	hookEventName: string;
	toolName: string;
	toolInputSummary: string | null;
	lastHookAt: number | null;
	activityText: string | null;
}): string {
	return createHash("sha256")
		.update(
			[
				input.workspacePathHash ?? "global",
				input.taskId,
				input.hookEventName,
				input.toolName,
				input.toolInputSummary ?? "",
				String(input.lastHookAt ?? 0),
				input.activityText ?? "",
			].join("\0"),
		)
		.digest("hex");
}

function matchesSettings(summary: RuntimeTaskSessionSummary, settings: RuntimeTaskClineSettings | undefined): boolean {
	if (!settings) {
		return false;
	}
	const providerId = normalizeOptionalString(settings.providerId);
	const modelId = normalizeOptionalString(settings.modelId);
	if (!providerId && !modelId) {
		return false;
	}
	const summaryProviderId = normalizeOptionalString(summary.providerId);
	const summaryModelId = normalizeOptionalString(summary.modelId);
	return (!providerId || providerId === summaryProviderId) && (!modelId || modelId === summaryModelId);
}

function normalizeRole(value: string | null | undefined): RuntimeModelPerformanceRole | null {
	const normalized = normalizeOptionalString(value)?.toLowerCase();
	if (normalized === "architect" || normalized === "worker" || normalized === "reviewer") {
		return normalized;
	}
	return null;
}

function resolveObservationRole(input: {
	card: RuntimeBoardCard | null;
	runtimeConfig: RuntimeConfigState | null;
	summary: RuntimeTaskSessionSummary;
}): Pick<RuntimeKnowledgeToolUsageObservation, "role" | "roleSource"> {
	const cardSettings = input.card?.clineSettings;
	const cardRole = normalizeRole(input.card?.generatedFromPlan?.artifactKind === "decomposition" ? "architect" : null);
	if (cardRole && matchesSettings(input.summary, cardSettings)) {
		return { role: cardRole, roleSource: "card" };
	}
	for (const [roleId, settings] of Object.entries(input.runtimeConfig?.modelRoles ?? {})) {
		const role = normalizeRole(roleId);
		if (role && matchesSettings(input.summary, settings)) {
			return { role, roleSource: "model_roles" };
		}
	}
	if (input.summary.providerId || input.summary.modelId) {
		return { role: "worker", roleSource: "default" };
	}
	return { role: "unknown", roleSource: "unknown" };
}

function normalizeToolName(toolName: string): string {
	return toolName
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
}

export function classifyKnowledgeTool(toolName: string): RuntimeKnowledgeToolCategory {
	const normalized = normalizeToolName(toolName);
	if (
		normalized.includes("architecture_knowledge") ||
		normalized.includes("knowledge_search") ||
		normalized.includes("knowledge_base")
	) {
		return "architecture_knowledge";
	}
	if (normalized.includes("fetch") || normalized.includes("web") || normalized.includes("browser")) {
		return "external_fetch";
	}
	if (
		normalized === "search_code" ||
		normalized === "search_codebase" ||
		normalized === "repo_map" ||
		normalized === "get_repo_map"
	) {
		return "code_index";
	}
	if (normalized.includes("search")) {
		return "codebase_retrieval";
	}
	if (normalized === "list_files" || normalized === "find_files" || normalized === "get_file_size") {
		return "file_discovery";
	}
	if (normalized === "read_files" || normalized === "read_file" || normalized === "read_large_file") {
		return "file_read";
	}
	if (normalized === "decompose_project" || normalized === "expand_task" || normalized.includes("plan")) {
		return "planning_control";
	}
	return "other";
}

function resolveOutcome(hookEventName: string, activityText: string | null): RuntimeKnowledgeToolOutcome {
	if (hookEventName === "tool_call") {
		return "started";
	}
	if (activityText?.trim().toLowerCase().startsWith("failed")) {
		return "failed";
	}
	return "succeeded";
}

export function buildKnowledgeToolUsageObservation(
	input: RecordKnowledgeToolUsageObservationInput,
): RuntimeKnowledgeToolUsageObservation | null {
	const activity = input.summary.latestHookActivity;
	const hookEventName = normalizeRequiredString(activity?.hookEventName);
	const toolName = normalizeRequiredString(activity?.toolName);
	if (!hookEventName || !toolName || !RECORDABLE_HOOK_EVENTS.has(hookEventName)) {
		return null;
	}
	const recordedAt = input.now ?? Date.now();
	const workspacePath = normalizeOptionalString(input.workspacePath ?? input.summary.workspacePath);
	const workspacePathHash = hashValue(workspacePath);
	const role = resolveObservationRole(input);
	const activityText = normalizeOptionalString(activity?.activityText);
	const toolInputSummary = normalizeOptionalString(activity?.toolInputSummary);
	return {
		schemaVersion: 1,
		id: buildObservationId({
			workspacePathHash,
			taskId: input.summary.taskId,
			hookEventName,
			toolName,
			toolInputSummary,
			lastHookAt: input.summary.lastHookAt,
			activityText,
		}),
		recordedAt,
		appVersion: APP_VERSION,
		workspaceId: normalizeOptionalString(input.workspaceId),
		workspacePathHash,
		workspacePath,
		projectName: workspacePath ? basename(workspacePath) : null,
		taskId: input.summary.taskId,
		taskTitle: normalizeOptionalString(input.card?.title),
		role: role.role,
		roleSource: role.roleSource,
		providerId: normalizeOptionalString(input.summary.providerId),
		modelId: normalizeOptionalString(input.summary.modelId),
		toolName,
		toolCategory: classifyKnowledgeTool(toolName),
		outcome: resolveOutcome(hookEventName, activityText),
		hookEventName,
		toolInputSummary,
		activityText,
		lastHookAt: input.summary.lastHookAt,
	};
}

function parseObservationRecord(line: string): RuntimeKnowledgeToolUsageObservation | null {
	try {
		const parsed = runtimeKnowledgeToolUsageObservationSchema.safeParse(JSON.parse(line));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

function deduplicateObservations(
	records: RuntimeKnowledgeToolUsageObservation[],
): RuntimeKnowledgeToolUsageObservation[] {
	const byId = new Map<string, RuntimeKnowledgeToolUsageObservation>();
	for (const record of records) {
		const existing = byId.get(record.id);
		if (!existing || record.recordedAt > existing.recordedAt) {
			byId.set(record.id, record);
		}
	}
	return [...byId.values()];
}

async function readAllObservations(rootDir: string): Promise<RuntimeKnowledgeToolUsageObservation[]> {
	const fileNames = await readdir(rootDir).catch(() => []);
	const logFiles = fileNames
		.filter((fileName) => fileName.endsWith(".jsonl"))
		.sort()
		.reverse();
	const records: RuntimeKnowledgeToolUsageObservation[] = [];
	for (const fileName of logFiles) {
		const text = await readFile(join(rootDir, fileName), "utf8").catch(() => "");
		for (const line of text.split("\n")) {
			if (!line) {
				continue;
			}
			const record = parseObservationRecord(line);
			if (record) {
				records.push(record);
			}
		}
	}
	return deduplicateObservations(records).sort((left, right) => right.recordedAt - left.recordedAt);
}

function aggregateRecords(input: {
	key: string;
	scope: RuntimeKnowledgeToolUsageAggregate["scope"];
	appVersion: string | null;
	workspacePathHash: string | null;
	projectName: string | null;
	role: RuntimeModelPerformanceRole;
	providerId: string | null;
	modelId: string | null;
	toolName: string;
	toolCategory: RuntimeKnowledgeToolCategory;
	records: RuntimeKnowledgeToolUsageObservation[];
}): RuntimeKnowledgeToolUsageAggregate {
	const startedCalls = input.records.filter((record) => record.outcome === "started").length;
	const succeededCalls = input.records.filter((record) => record.outcome === "succeeded").length;
	const failedCalls = input.records.filter((record) => record.outcome === "failed").length;
	const completedCalls = succeededCalls + failedCalls;
	return {
		key: input.key,
		scope: input.scope,
		appVersion: input.appVersion,
		workspacePathHash: input.workspacePathHash,
		projectName: input.projectName,
		role: input.role,
		providerId: input.providerId,
		modelId: input.modelId,
		toolName: input.toolName,
		toolCategory: input.toolCategory,
		calls: input.records.length,
		startedCalls,
		succeededCalls,
		failedCalls,
		successRate: completedCalls > 0 ? succeededCalls / completedCalls : 0,
		lastObservedAt: Math.max(...input.records.map((record) => record.recordedAt)),
	};
}

function groupByAggregate(records: RuntimeKnowledgeToolUsageObservation[]): RuntimeKnowledgeToolUsageAggregate[] {
	const groups = new Map<
		string,
		{
			scope: RuntimeKnowledgeToolUsageAggregate["scope"];
			appVersion: string | null;
			workspacePathHash: string | null;
			projectName: string | null;
			role: RuntimeModelPerformanceRole;
			providerId: string | null;
			modelId: string | null;
			toolName: string;
			toolCategory: RuntimeKnowledgeToolCategory;
			records: RuntimeKnowledgeToolUsageObservation[];
		}
	>();
	const add = (
		scope: RuntimeKnowledgeToolUsageAggregate["scope"],
		record: RuntimeKnowledgeToolUsageObservation,
		workspacePathHash: string | null,
		projectName: string | null,
		appVersion: string | null,
	): void => {
		const key = [
			scope,
			appVersion ?? "all_versions",
			workspacePathHash ?? "all_projects",
			record.role,
			record.providerId ?? "unknown_provider",
			record.modelId ?? "unknown_model",
			record.toolCategory,
			record.toolName,
		].join("\0");
		const existing = groups.get(key) ?? {
			scope,
			appVersion,
			workspacePathHash,
			projectName,
			role: record.role,
			providerId: record.providerId,
			modelId: record.modelId,
			toolName: record.toolName,
			toolCategory: record.toolCategory,
			records: [],
		};
		existing.records.push(record);
		groups.set(key, existing);
	};
	for (const record of records) {
		add("overall", record, null, null, null);
		add("version", record, null, null, record.appVersion);
		add("project", record, record.workspacePathHash, record.projectName, record.appVersion);
	}
	return [...groups.entries()]
		.map(([key, group]) => aggregateRecords({ key, ...group }))
		.sort((left, right) => right.calls - left.calls || right.lastObservedAt - left.lastObservedAt);
}

export async function recordKnowledgeToolUsageObservation(
	input: RecordKnowledgeToolUsageObservationInput,
): Promise<RuntimeKnowledgeToolUsageObservation | null> {
	const observation = buildKnowledgeToolUsageObservation(input);
	if (!observation) {
		return null;
	}
	const rootDir = resolveRootDir(input.rootDir);
	await mkdir(rootDir, { recursive: true });
	await appendFile(resolveLogPath(rootDir, observation.recordedAt), `${JSON.stringify(observation)}\n`, "utf8");
	return observation;
}

export async function readKnowledgeToolUsageStats(
	options: ReadKnowledgeToolUsageStatsOptions = {},
): Promise<RuntimeKnowledgeToolUsageStatsResponse> {
	const rootDir = resolveRootDir(options.rootDir);
	const workspacePathHash = hashValue(normalizeOptionalString(options.workspacePath));
	const observations = (await readAllObservations(rootDir)).filter(
		(record) => !workspacePathHash || record.workspacePathHash === workspacePathHash,
	);
	const limit = options.limit ?? DEFAULT_OBSERVATION_LIMIT;
	return {
		generatedAt: options.now ?? Date.now(),
		observations: observations.slice(0, limit),
		aggregates: groupByAggregate(observations),
	};
}
