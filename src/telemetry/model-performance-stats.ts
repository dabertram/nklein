import { createHash } from "node:crypto";
import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import packageJson from "../../package.json" with { type: "json" };
import type { RuntimeConfigState } from "../config/runtime-config";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import type {
	RuntimeBoardCard,
	RuntimeModelPerformanceAggregate,
	RuntimeModelPerformanceObservation,
	RuntimeModelPerformanceOutcome,
	RuntimeModelPerformanceRole,
	RuntimeModelPerformanceStatsResponse,
	RuntimeTaskNKleinSettings,
	RuntimeTaskSessionSummary,
} from "../core/api-contract";
import { runtimeModelPerformanceObservationSchema } from "../core/api-contract";
import { normalizeEndpoint, normalizeModelId, normalizeProviderId } from "../core/model-identity";

const DEFAULT_MODEL_PERFORMANCE_ROOT = join(resolveNkleinRuntimeHomePath(homedir()), "model-performance");
const DEFAULT_OBSERVATION_LIMIT = 500;
const APP_VERSION = typeof packageJson.version === "string" ? packageJson.version : "0.1.0";
const TERMINAL_SESSION_STATES = new Set<RuntimeTaskSessionSummary["state"]>([
	"awaiting_review",
	"failed",
	"interrupted",
	"idle",
]);

export interface RecordModelPerformanceObservationInput {
	workspaceId: string | null;
	workspacePath: string | null;
	card: RuntimeBoardCard | null;
	runtimeConfig: RuntimeConfigState | null;
	summary: RuntimeTaskSessionSummary;
	now?: number;
	rootDir?: string;
}

export interface ReadModelPerformanceStatsOptions {
	rootDir?: string;
	workspacePath?: string | null;
	limit?: number;
	now?: number;
}

function resolveRootDir(rootDir?: string): string {
	return rootDir ?? DEFAULT_MODEL_PERFORMANCE_ROOT;
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

function hashValue(value: string | null): string | null {
	return value ? createHash("sha256").update(value).digest("hex") : null;
}

function buildObservationId(input: {
	workspacePathHash: string | null;
	taskId: string;
	startedAt: number | null;
	providerId: string | null;
	modelId: string | null;
}): string {
	return createHash("sha256")
		.update(
			[
				input.workspacePathHash ?? "global",
				input.taskId,
				String(input.startedAt ?? 0),
				input.providerId ?? "unknown_provider",
				input.modelId ?? "unknown_model",
			].join("\0"),
		)
		.digest("hex");
}

function matchesSettings(summary: RuntimeTaskSessionSummary, settings: RuntimeTaskNKleinSettings | undefined): boolean {
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
}): Pick<RuntimeModelPerformanceObservation, "role" | "roleSource"> {
	const cardSettings = input.card?.nkleinSettings;
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

function resolveOutcome(summary: RuntimeTaskSessionSummary): RuntimeModelPerformanceOutcome {
	if (summary.state === "awaiting_review") {
		if (summary.reviewReason === "exit" || summary.reviewReason === "hook") {
			return "completed";
		}
		return "awaiting_review";
	}
	if (summary.state === "interrupted") {
		return "interrupted";
	}
	if (summary.state === "failed") {
		return "failed";
	}
	if (
		summary.state === "idle" &&
		(summary.latestHookActivity?.hookEventName === "decomposition_applied" || summary.exitCode === 0)
	) {
		return "completed";
	}
	if (summary.state === "running" || summary.state === "queued" || summary.state === "idle") {
		return summary.state;
	}
	if (summary.exitCode !== null && summary.exitCode !== 0) {
		return "failed";
	}
	return "unknown";
}

function elapsedFrom(startedAt: number | null, endedAt: number | null | undefined): number | null {
	if (typeof startedAt !== "number" || typeof endedAt !== "number" || endedAt < startedAt) {
		return null;
	}
	return endedAt - startedAt;
}

export function buildModelPerformanceObservation(
	input: RecordModelPerformanceObservationInput,
): RuntimeModelPerformanceObservation | null {
	const providerId = normalizeOptionalString(input.summary.providerId);
	const modelId = normalizeOptionalString(input.summary.modelId);
	if (!providerId && !modelId) {
		return null;
	}
	if (!TERMINAL_SESSION_STATES.has(input.summary.state)) {
		return null;
	}
	const recordedAt = input.now ?? Date.now();
	const workspacePath = normalizeOptionalString(input.workspacePath ?? input.summary.workspacePath);
	const workspacePathHash = hashValue(workspacePath);
	const outcome = resolveOutcome(input.summary);
	const role = resolveObservationRole(input);
	const contextBudgetBreakdown = input.summary.contextBudgetBreakdown ?? null;
	const contextPressure =
		contextBudgetBreakdown && contextBudgetBreakdown.effectiveContextWindow > 0
			? contextBudgetBreakdown.usedWorkingTokens / contextBudgetBreakdown.effectiveContextWindow
			: null;
	const observation: RuntimeModelPerformanceObservation = {
		schemaVersion: 1,
		id: buildObservationId({
			workspacePathHash,
			taskId: input.summary.taskId,
			startedAt: input.summary.startedAt,
			providerId,
			modelId,
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
		providerId,
		modelId,
		endpoint: normalizeOptionalString(input.summary.endpoint),
		sharedEndpointId: normalizeOptionalString(input.summary.sharedEndpointId),
		outcome,
		sessionState: input.summary.state,
		reviewReason: input.summary.reviewReason,
		exitCode: input.summary.exitCode,
		warningMessage: normalizeOptionalString(input.summary.warningMessage),
		startedAt: input.summary.startedAt,
		updatedAt: input.summary.updatedAt,
		lastOutputAt: input.summary.lastOutputAt,
		lastTokenAt: input.summary.lastTokenAt ?? null,
		lastHeartbeatAt: input.summary.lastHeartbeatAt ?? null,
		heartbeatStatus: input.summary.heartbeatStatus ?? null,
		wallTimeMs: elapsedFrom(input.summary.startedAt, input.summary.updatedAt),
		timeToFirstTokenMs: elapsedFrom(input.summary.startedAt, input.summary.lastTokenAt),
		timeToLastOutputMs: elapsedFrom(input.summary.startedAt, input.summary.lastOutputAt),
		usage: input.summary.latestUsage ?? null,
		contextBudgetBreakdown,
		contextPressure,
		latestHookEvent: normalizeOptionalString(input.summary.latestHookActivity?.hookEventName),
		latestHookToolName: normalizeOptionalString(input.summary.latestHookActivity?.toolName),
	};
	return observation;
}

function parseObservationRecord(line: string): RuntimeModelPerformanceObservation | null {
	try {
		const parsed = runtimeModelPerformanceObservationSchema.safeParse(JSON.parse(line));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

async function readAllObservations(rootDir: string): Promise<RuntimeModelPerformanceObservation[]> {
	const fileNames = await readdir(rootDir).catch(() => []);
	const logFiles = fileNames
		.filter((fileName) => fileName.endsWith(".jsonl"))
		.sort()
		.reverse();
	const records: RuntimeModelPerformanceObservation[] = [];
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

function deduplicateObservations(records: RuntimeModelPerformanceObservation[]): RuntimeModelPerformanceObservation[] {
	const byId = new Map<string, RuntimeModelPerformanceObservation>();
	for (const record of records) {
		const existing = byId.get(record.id);
		if (!existing || record.recordedAt > existing.recordedAt) {
			byId.set(record.id, record);
		}
	}
	return [...byId.values()];
}

function average(values: Array<number | null | undefined>): number | null {
	const finiteValues = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
	if (finiteValues.length === 0) {
		return null;
	}
	return finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length;
}

function isFailedOutcome(outcome: RuntimeModelPerformanceOutcome): boolean {
	return outcome === "failed" || outcome === "unknown";
}

function aggregateRecords(input: {
	key: string;
	scope: RuntimeModelPerformanceAggregate["scope"];
	appVersion: string | null;
	workspacePathHash: string | null;
	projectName: string | null;
	role: RuntimeModelPerformanceRole;
	providerId: string | null;
	modelId: string | null;
	endpoint: string | null;
	records: RuntimeModelPerformanceObservation[];
}): RuntimeModelPerformanceAggregate {
	const completedRuns = input.records.filter((record) => record.outcome === "completed").length;
	const failedRuns = input.records.filter((record) => isFailedOutcome(record.outcome)).length;
	const interruptedRuns = input.records.filter((record) => record.outcome === "interrupted").length;
	const awaitingReviewRuns = input.records.filter((record) => record.outcome === "awaiting_review").length;
	return {
		key: input.key,
		scope: input.scope,
		appVersion: input.appVersion,
		workspacePathHash: input.workspacePathHash,
		projectName: input.projectName,
		role: input.role,
		providerId: input.providerId,
		modelId: input.modelId,
		endpoint: input.endpoint,
		runs: input.records.length,
		completedRuns,
		failedRuns,
		interruptedRuns,
		awaitingReviewRuns,
		successRate: input.records.length > 0 ? completedRuns / input.records.length : 0,
		averageWallTimeMs: average(input.records.map((record) => record.wallTimeMs)),
		averageTimeToFirstTokenMs: average(input.records.map((record) => record.timeToFirstTokenMs)),
		averageInputTokens: average(input.records.map((record) => record.usage?.inputTokens)),
		averageOutputTokens: average(input.records.map((record) => record.usage?.outputTokens)),
		averageContextPressure: average(input.records.map((record) => record.contextPressure)),
		lastObservedAt: Math.max(...input.records.map((record) => record.recordedAt)),
	};
}

function groupByAggregate(records: RuntimeModelPerformanceObservation[]): RuntimeModelPerformanceAggregate[] {
	const groups = new Map<
		string,
		{
			scope: RuntimeModelPerformanceAggregate["scope"];
			appVersion: string | null;
			workspacePathHash: string | null;
			projectName: string | null;
			role: RuntimeModelPerformanceRole;
			providerId: string | null;
			modelId: string | null;
			endpoint: string | null;
			records: RuntimeModelPerformanceObservation[];
		}
	>();
	const add = (
		scope: RuntimeModelPerformanceAggregate["scope"],
		record: RuntimeModelPerformanceObservation,
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
		].join("\0");
		const existing = groups.get(key) ?? {
			scope,
			appVersion,
			workspacePathHash,
			projectName,
			role: record.role,
			providerId: record.providerId,
			modelId: record.modelId,
			endpoint: null,
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
		.concat(groupByModel(records))
		.sort((left, right) => right.runs - left.runs || right.lastObservedAt - left.lastObservedAt);
}

/**
 * The precise per-model rollup (todo §5.Q): one row per canonical model identity — provider + normalized
 * model id + canonical endpoint — recomputed straight from the raw observations (not by re-summing the
 * role/project/version aggregates), so success rate **and** the timing averages are exact and loopback
 * endpoint spellings dedup the same way the model registry keys them. `role` is `"unknown"` because this
 * scope intentionally collapses across roles; the per-role split stays in the other scopes' breakdowns.
 */
function groupByModel(records: RuntimeModelPerformanceObservation[]): RuntimeModelPerformanceAggregate[] {
	const groups = new Map<
		string,
		{
			providerId: string | null;
			modelId: string | null;
			endpoint: string | null;
			records: RuntimeModelPerformanceObservation[];
		}
	>();
	for (const record of records) {
		const providerId = record.providerId ? normalizeProviderId(record.providerId) : null;
		const modelId = record.modelId ? normalizeModelId(record.modelId) : null;
		const endpoint = normalizeEndpoint(record.endpoint);
		const key = [providerId ?? "unknown_provider", modelId ?? "unknown_model", endpoint ?? "default"].join("\0");
		const existing = groups.get(key) ?? { providerId, modelId, endpoint, records: [] };
		existing.records.push(record);
		groups.set(key, existing);
	}
	return [...groups.entries()].map(([key, group]) =>
		aggregateRecords({
			key: `model\0${key}`,
			scope: "model",
			appVersion: null,
			workspacePathHash: null,
			projectName: null,
			role: "unknown",
			providerId: group.providerId,
			modelId: group.modelId,
			endpoint: group.endpoint,
			records: group.records,
		}),
	);
}

export async function recordModelPerformanceObservation(
	input: RecordModelPerformanceObservationInput,
): Promise<RuntimeModelPerformanceObservation | null> {
	const observation = buildModelPerformanceObservation(input);
	if (!observation) {
		return null;
	}
	const rootDir = resolveRootDir(input.rootDir);
	await mkdir(rootDir, { recursive: true });
	await appendFile(resolveLogPath(rootDir, observation.recordedAt), `${JSON.stringify(observation)}\n`, "utf8");
	return observation;
}

export async function readModelPerformanceStats(
	options: ReadModelPerformanceStatsOptions = {},
): Promise<RuntimeModelPerformanceStatsResponse> {
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
