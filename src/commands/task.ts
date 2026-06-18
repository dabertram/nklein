import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import type { Command } from "commander";

import { runClineAcceptanceGate } from "../cline-sdk/cline-acceptance-gate";
import { buildClineAcceptanceRepairPlan, type ClineAcceptanceRepairAction } from "../cline-sdk/cline-acceptance-repair";
import { applyClinePlanTaskGraphToBoard } from "../cline-sdk/cline-decomposition-tool";
import { getDefaultClineModelRegistry } from "../cline-sdk/cline-model-registry";
import { appendClinePlanRevision, readClinePlanArtifacts } from "../cline-sdk/cline-plan-artifacts";
import { createClineProviderService } from "../cline-sdk/cline-provider-service";
import type { ClineTaskRoutingCandidate } from "../cline-sdk/cline-task-router";
import { buildClineStartGuardCandidate } from "../cline-sdk/cline-task-start-guard";
import { loadRuntimeConfig, type RuntimeConfigState } from "../config/runtime-config";
import type {
	RuntimeAgentId,
	RuntimeBoardCard,
	RuntimeBoardColumnId,
	RuntimeBoardDependency,
	RuntimeClineReasoningEffort,
	RuntimeTaskClineSettings,
	RuntimeWorkspaceStateResponse,
} from "../core/api-contract";
import {
	clampRuntimeSwarmCardStartBatchSize,
	runtimeAgentIdSchema,
	runtimeClineReasoningEffortSchema,
} from "../core/api-contract";
import { type PlanGapKind, planGapKindSchema, recordPlanGap } from "../core/plan-gap";
import { buildKanbanRuntimeUrl, getKanbanRuntimeOrigin, getRuntimeFetch } from "../core/runtime-endpoint";
import { clearSwarmStop, requestSwarmStop } from "../core/swarm-guardrails";
import {
	addTaskDependency,
	addTaskToColumn,
	completeTaskAndGetReadyLinkedTaskIds,
	deleteTasksFromBoard,
	getTaskColumnId,
	moveTaskToColumn,
	type RuntimeAddTaskDependencyResult,
	removeTaskDependency,
	trashTaskAndGetReadyLinkedTaskIds,
	updateTask,
} from "../core/task-board-mutations";
import { findActiveTaskLikelyTouchedFileOverlap } from "../core/task-file-overlap";
import { resolveProjectInputPath } from "../projects/project-path";
import { loadWorkspaceContext, loadWorkspaceState, mutateWorkspaceState } from "../state/workspace-state";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import type { RuntimeAppRouter } from "../trpc/app-router";
import { resolveTaskCwd } from "../workspace/task-worktree";
import {
	mergeTaskWorktreesInDependencyOrder,
	type TaskWorktreeAutoMergeColumn,
	type TaskWorktreeAutoMergeConflict,
	type TaskWorktreeAutoMergeStep,
} from "../workspace/task-worktree-auto-merge";

const LIST_TASK_COLUMNS = ["backlog", "planning", "in_progress", "review", "completed", "trash"] as const;
const DEFAULT_NEEDS_DECOMPOSITION_REASON = "This task needs to be decomposed before it can start.";
type ListTaskColumn = (typeof LIST_TASK_COLUMNS)[number];
type TaskCommandTarget = { taskId?: string; column?: ListTaskColumn };

type ResolvedTaskCommandTarget =
	| {
			kind: "task";
			taskId: string;
	  }
	| {
			kind: "column";
			column: ListTaskColumn;
	  };

interface RuntimeWorkspaceMutationResult<T> {
	board: RuntimeWorkspaceStateResponse["board"];
	value: T;
}

type JsonRecord = Record<string, unknown>;
type RecordSelfObservation = typeof recordSelfObservation;

function slugifyPlanTaskId(input: string): string {
	const slug = input
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || "task";
}

function parseAutoMergeColumn(value: string | undefined): TaskWorktreeAutoMergeColumn {
	if (value === undefined || value === "review") {
		return "review";
	}
	if (value === "completed" || value === "done") {
		return "completed";
	}
	throw new Error('Invalid merge column. Expected "review" or "completed".');
}

function parsePlanGapKind(value: string): PlanGapKind {
	return planGapKindSchema.parse(value);
}

interface DecompositionRejectionInput {
	workspacePath: string;
	slug: string;
	title?: string;
	specPath?: string;
	planPath?: string;
	questionsPath?: string;
	decisionsPath?: string;
	revisionsPath?: string;
	summaryPath?: string;
	taskGraphPath?: string;
	error: unknown;
	recordObservation?: RecordSelfObservation;
}

interface VerifyTaskAcceptanceDependencies {
	resolveWorkspaceRepoPath?: typeof resolveWorkspaceRepoPath;
	loadWorkspaceState?: typeof loadWorkspaceState;
	resolveTaskCwd?: typeof resolveTaskCwd;
	runAcceptanceGate?: typeof runClineAcceptanceGate;
	loadRuntimeConfig?: typeof loadRuntimeConfig;
	recordPlanGap?: typeof recordPlanGap;
}

function toErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim().length > 0) {
		return error.message;
	}
	return String(error);
}

function shouldRecordAcceptancePlanGap(input: {
	acceptancePresent: boolean;
	repairAction: ClineAcceptanceRepairAction | null;
}): boolean {
	return (
		input.acceptancePresent === false || input.repairAction === "escalate" || input.repairAction === "human_review"
	);
}

function buildAcceptanceFailureEvidence(input: { command: string | null; output: string; taskPrompt: string }): string {
	return [
		input.command ? `Command: ${input.command}` : null,
		input.output.trim() ? `Output: ${input.output}` : null,
		!input.command && !input.output.trim() ? input.taskPrompt : null,
	]
		.filter((part): part is string => part !== null)
		.join("\n")
		.slice(0, 2_000);
}

const ACCEPTANCE_PLAN_GAP_CLASSIFIERS: readonly {
	kind: PlanGapKind;
	description: string;
	patterns: readonly RegExp[];
}[] = [
	{
		kind: "missing_decision",
		description:
			"Acceptance failed after repair attempts with output that points to an unresolved decision or ambiguity in the plan.",
		patterns: [
			/\b(ambiguous|unclear|needs clarification|need clarification|cannot determine|unable to determine)\b/,
			/\b(choose between|decide whether|requires a decision|requires user decision|confirm which|which .+ should)\b/,
			/\b(no default specified|missing product decision|missing design decision|unknown requirement)\b/,
		],
	},
	{
		kind: "contradictory_requirement",
		description:
			"Acceptance failed after repair attempts with output that points to contradictory or incompatible plan requirements.",
		patterns: [
			/\b(contradict|contradiction|conflicting requirement|mutually exclusive|incompatible requirement)\b/,
			/\b(conflicts with|cannot both|exclusive with|violates required invariant)\b/,
		],
	},
	{
		kind: "missing_dependency",
		description:
			"Acceptance failed after repair attempts with output that points to a missing dependency, config, schema, or file the plan did not provide.",
		patterns: [
			/\b(enoent|err_module_not_found|module not found|cannot find module|cannot find package)\b/,
			/\b(could not resolve|cannot resolve|failed to resolve|could not locate|no such file or directory)\b/,
			/\b(command not found|executable file not found|spawn .+ enoent|missing binary)\b/,
			/\b(missing required (environment variable|env var|config|configuration)|environment variable .+ is not set)\b/,
			/\b(api key|token|credential|secret) (is )?(missing|required|not set|undefined)\b/,
			/\b(relation .+ does not exist|table .+ does not exist|no such table|column .+ does not exist|missing migration)\b/,
		],
	},
	{
		kind: "scope_too_large",
		description:
			"Acceptance failed after repair attempts with output that suggests the task scope is too large for a single card.",
		patterns: [
			/\b(scope too large|too broad|timed out|timeout|out of memory|heap out of memory)\b/,
			/\b(context length exceeded|token limit|exceeded .+ limit|resource exhausted|too many files)\b/,
			/\b(complexity \d+\/\d+|split .+ before continuing|decompose .+ before continuing)\b/,
		],
	},
];

function classifyAcceptanceFailurePlanGap(input: {
	acceptancePresent: boolean;
	repairAction: ClineAcceptanceRepairAction | null;
	command: string | null;
	output: string;
	taskPrompt: string;
}): { kind: PlanGapKind; description: string; evidence: string } | null {
	if (
		!shouldRecordAcceptancePlanGap({
			acceptancePresent: input.acceptancePresent,
			repairAction: input.repairAction,
		})
	) {
		return null;
	}
	if (!input.acceptancePresent) {
		return {
			kind: "other",
			description:
				"Task is missing the required Acceptance check line, so the plan lacks a machine-checkable completion contract.",
			evidence: input.taskPrompt.slice(0, 2_000),
		};
	}

	const evidence = buildAcceptanceFailureEvidence(input);
	const normalizedOutput = input.output.toLowerCase();
	for (const classifier of ACCEPTANCE_PLAN_GAP_CLASSIFIERS) {
		if (classifier.patterns.some((pattern) => pattern.test(normalizedOutput))) {
			return {
				kind: classifier.kind,
				description: classifier.description,
				evidence,
			};
		}
	}
	return {
		kind: "other",
		description:
			"Acceptance repair attempts are exhausted; the task needs plan-level review before more implementation work.",
		evidence,
	};
}

function printJson(payload: unknown): void {
	process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

async function buildDecompositionRoutingCandidates(
	runtimeConfig: RuntimeConfigState,
): Promise<ClineTaskRoutingCandidate[]> {
	const clineProviderService = createClineProviderService();
	const modelRegistry = await getDefaultClineModelRegistry()
		.getSnapshot()
		.catch(() => ({
			schemaVersion: 1 as const,
			updatedAt: 0,
			models: {},
		}));
	const candidates = new Map<string, ClineTaskRoutingCandidate>();
	try {
		const launchConfig = await clineProviderService.resolveLaunchConfig({});
		const candidate = buildClineStartGuardCandidate({
			launchConfig,
			role: null,
			modelRegistry,
		});
		candidates.set(candidate.entry.key, {
			entry: candidate.entry,
			role: candidate.role,
		});
	} catch {
		// A workspace without a runnable default Cline provider can still decompose from explicit role models.
	}

	for (const [role, settings] of Object.entries(runtimeConfig.modelRoles)) {
		if (!settings.providerId && !settings.modelId) {
			continue;
		}
		try {
			const launchConfig = await clineProviderService.resolveLaunchConfig({
				providerIdOverride: settings.providerId ?? undefined,
				modelIdOverride: settings.modelId ?? undefined,
				reasoningEffortOverride: settings.reasoningEffort ?? null,
			});
			const candidate = buildClineStartGuardCandidate({
				launchConfig,
				role,
				modelRegistry,
			});
			candidates.set(candidate.entry.key, {
				entry: candidate.entry,
				role: candidate.role,
			});
		} catch {
			// Ignore roles that are configured but not currently runnable.
		}
	}

	return [...candidates.values()];
}

export function recordDecompositionRejection(input: DecompositionRejectionInput): void {
	const message = toErrorMessage(input.error);
	(input.recordObservation ?? recordSelfObservation)({
		signal: "decomposition_rejected",
		severity: "warning",
		message: `Task decomposition rejected for plan "${input.slug}": ${message}`,
		workspacePath: input.workspacePath,
		metadata: {
			slug: input.slug,
			title: input.title ?? null,
			specPath: input.specPath ?? null,
			planPath: input.planPath ?? null,
			questionsPath: input.questionsPath ?? null,
			decisionsPath: input.decisionsPath ?? null,
			revisionsPath: input.revisionsPath ?? null,
			summaryPath: input.summaryPath ?? null,
			taskGraphPath: input.taskGraphPath ?? null,
			error: message,
		},
	});
}

export function markTaskNeedsDecompositionOnBoard(
	board: RuntimeWorkspaceStateResponse["board"],
	taskId: string,
	reason: string | null | undefined,
): RuntimeWorkspaceStateResponse["board"] {
	let updated = false;
	const blockedReason = reason?.trim() || DEFAULT_NEEDS_DECOMPOSITION_REASON;
	const columns = board.columns.map((column) => {
		let columnUpdated = false;
		const cards = column.cards.map((card) => {
			if (card.id !== taskId) {
				return card;
			}
			updated = true;
			columnUpdated = true;
			return {
				...card,
				blockedKind: "needs_decomposition" as const,
				blockedReason,
				updatedAt: Date.now(),
			};
		});
		return columnUpdated ? { ...column, cards } : column;
	});
	return updated ? { ...board, columns } : board;
}

function parseListColumn(value: string | undefined): ListTaskColumn | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (value === "done") {
		return "completed";
	}
	if (
		value === "backlog" ||
		value === "planning" ||
		value === "in_progress" ||
		value === "review" ||
		value === "completed" ||
		value === "trash"
	) {
		return value;
	}
	throw new Error(`Invalid column "${value}". Expected one of: ${LIST_TASK_COLUMNS.join(", ")}, done.`);
}

function parseAutoReviewMode(value: string | undefined): "commit" | "pr" | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (value === "commit" || value === "pr") {
		return value;
	}
	throw new Error(`Invalid auto review mode "${value}". Expected: commit, pr.`);
}

const VALID_AGENT_IDS = runtimeAgentIdSchema.options;

function parseAgentId(value: string | undefined): RuntimeAgentId | null | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (value === "default") {
		return null;
	}
	const result = runtimeAgentIdSchema.safeParse(value);
	if (result.success) {
		return result.data;
	}
	throw new Error(`Invalid agent ID "${value}". Expected one of: ${VALID_AGENT_IDS.join(", ")}, default.`);
}

function parseOptionalStringOrDefault(value: string | undefined): string | null | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (value === "default") {
		return null;
	}
	return value;
}

type ParsedTaskClineReasoningEffort = RuntimeClineReasoningEffort | "default" | null | undefined;

function parseTaskClineReasoningEffort(value: string | undefined): ParsedTaskClineReasoningEffort {
	if (value === undefined) {
		return undefined;
	}
	if (value === "inherit") {
		return null;
	}
	if (value === "default") {
		return "default";
	}
	const result = runtimeClineReasoningEffortSchema.safeParse(value);
	if (result.success) {
		return result.data;
	}
	throw new Error("Invalid Cline reasoning effort. Expected one of: default, low, medium, high, xhigh, inherit.");
}

function cloneTaskClineSettings(settings?: RuntimeTaskClineSettings): RuntimeTaskClineSettings | undefined {
	if (settings === undefined) {
		return undefined;
	}
	const providerId = settings.providerId?.trim();
	const modelId = settings.modelId?.trim();
	return {
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

function formatTaskClineSettings(settings?: RuntimeTaskClineSettings): JsonRecord {
	if (settings === undefined) {
		return {};
	}
	return {
		clineSettings: cloneTaskClineSettings(settings) ?? {},
	};
}

function buildTaskClineSettingsForCreate(input: {
	providerId?: string;
	modelId?: string;
	reasoningEffort?: ParsedTaskClineReasoningEffort;
}): RuntimeTaskClineSettings | undefined {
	const providerId = input.providerId?.trim();
	const modelId = input.modelId?.trim();
	const reasoningEffort = input.reasoningEffort === null ? undefined : input.reasoningEffort;
	if (!providerId && !modelId && reasoningEffort === undefined) {
		return undefined;
	}
	return {
		...(providerId ? { providerId } : {}),
		...(modelId ? { modelId } : {}),
		...(reasoningEffort && reasoningEffort !== "default" ? { reasoningEffort } : {}),
	};
}

function buildTaskClineSettingsForUpdate(
	currentSettings: RuntimeTaskClineSettings | undefined,
	input: {
		providerId?: string | null;
		modelId?: string | null;
		reasoningEffort?: ParsedTaskClineReasoningEffort;
	},
): RuntimeTaskClineSettings | null | undefined {
	if (input.providerId === undefined && input.modelId === undefined && input.reasoningEffort === undefined) {
		return undefined;
	}
	const nextSettings = cloneTaskClineSettings(currentSettings) ?? {};
	let preserveEmptyOverride = currentSettings !== undefined && Object.keys(currentSettings).length === 0;

	if (input.providerId !== undefined) {
		const providerId = input.providerId?.trim();
		if (providerId) {
			nextSettings.providerId = providerId;
		} else {
			delete nextSettings.providerId;
		}
	}

	if (input.modelId !== undefined) {
		const modelId = input.modelId?.trim();
		if (modelId) {
			nextSettings.modelId = modelId;
		} else {
			delete nextSettings.modelId;
		}
	}

	if (input.reasoningEffort !== undefined) {
		if (input.reasoningEffort === "default") {
			delete nextSettings.reasoningEffort;
			preserveEmptyOverride = true;
		} else if (input.reasoningEffort === null) {
			delete nextSettings.reasoningEffort;
			preserveEmptyOverride = false;
		} else {
			nextSettings.reasoningEffort = input.reasoningEffort;
		}
	}

	if (
		nextSettings.providerId === undefined &&
		nextSettings.modelId === undefined &&
		nextSettings.reasoningEffort === undefined &&
		!preserveEmptyOverride
	) {
		return null;
	}

	return nextSettings;
}

function resolveTaskCommandTarget(input: TaskCommandTarget, commandName: string): ResolvedTaskCommandTarget {
	const taskId = input.taskId?.trim();
	const column = input.column;
	if (taskId && column) {
		throw new Error(`${commandName} accepts exactly one of --task-id or --column.`);
	}
	if (taskId) {
		return {
			kind: "task",
			taskId,
		};
	}
	if (column) {
		return {
			kind: "column",
			column,
		};
	}
	throw new Error(`${commandName} requires either --task-id or --column.`);
}

function createRuntimeTrpcClient(workspaceId: string | null) {
	return createTRPCProxyClient<RuntimeAppRouter>({
		links: [
			httpBatchLink({
				url: buildKanbanRuntimeUrl("/api/trpc"),
				headers: () => (workspaceId ? { "x-kanban-workspace-id": workspaceId } : {}),
				fetch: async (url, options) => {
					const runtimeFetch = await getRuntimeFetch();
					return runtimeFetch(url, options);
				},
			}),
		],
	});
}

async function resolveRuntimeWorkspace(
	projectPath: string | undefined,
	cwd: string,
	options: { autoCreateIfMissing?: boolean } = {},
) {
	const normalizedProjectPath = (projectPath ?? "").trim();
	const resolvedPath = normalizedProjectPath ? resolveProjectInputPath(normalizedProjectPath, cwd) : cwd;
	return await loadWorkspaceContext(resolvedPath, {
		autoCreateIfMissing: options.autoCreateIfMissing ?? true,
	});
}

async function resolveWorkspaceRepoPath(
	projectPath: string | undefined,
	cwd: string,
	options: { autoCreateIfMissing?: boolean } = {},
): Promise<string> {
	const workspace = await resolveRuntimeWorkspace(projectPath, cwd, options);
	return workspace.repoPath;
}

async function ensureRuntimeWorkspace(workspaceRepoPath: string): Promise<string> {
	const runtimeClient = createRuntimeTrpcClient(null);
	const added = await runtimeClient.projects.add.mutate({
		path: workspaceRepoPath,
	});
	if (!added.ok || !added.project) {
		throw new Error(added.error ?? `Could not register project ${workspaceRepoPath} in Kanban runtime.`);
	}
	return added.project.id;
}

async function notifyRuntimeWorkspaceStateUpdated(
	runtimeClient: ReturnType<typeof createRuntimeTrpcClient>,
): Promise<void> {
	await runtimeClient.workspace.notifyStateUpdated.mutate().catch(() => null);
}

async function updateRuntimeWorkspaceState<T>(
	runtimeClient: ReturnType<typeof createRuntimeTrpcClient>,
	workspaceRepoPath: string,
	mutate: (state: RuntimeWorkspaceStateResponse) => RuntimeWorkspaceMutationResult<T>,
): Promise<T> {
	const mutationResponse = await mutateWorkspaceState(workspaceRepoPath, (state) => {
		const mutation = mutate(state);
		return {
			board: mutation.board,
			value: mutation.value,
		};
	});

	if (mutationResponse.saved) {
		await notifyRuntimeWorkspaceStateUpdated(runtimeClient);
	}

	return mutationResponse.value;
}

function resolveTaskBaseRef(state: RuntimeWorkspaceStateResponse): string {
	return state.git.currentBranch ?? state.git.defaultBranch ?? state.git.branches[0] ?? "";
}

function findTaskRecord(
	state: RuntimeWorkspaceStateResponse,
	taskId: string,
): { task: RuntimeBoardCard; columnId: RuntimeBoardColumnId } | null {
	for (const column of state.board.columns) {
		const task = column.cards.find((candidate) => candidate.id === taskId);
		if (task) {
			return {
				task,
				columnId: column.id,
			};
		}
	}
	return null;
}

function formatTaskRecord(
	state: RuntimeWorkspaceStateResponse,
	task: RuntimeBoardCard,
	columnId: RuntimeBoardColumnId,
): JsonRecord {
	const session = state.sessions[task.id] ?? null;
	return {
		id: task.id,
		prompt: task.prompt,
		column: columnId,
		baseRef: task.baseRef,
		startInPlanMode: task.startInPlanMode,
		autoReviewEnabled: task.autoReviewEnabled === true,
		autoReviewMode: task.autoReviewMode ?? "commit",
		...(task.agentId ? { agentId: task.agentId } : {}),
		...formatTaskClineSettings(task.clineSettings),
		createdAt: task.createdAt,
		updatedAt: task.updatedAt,
		session: session
			? {
					state: session.state,
					agentId: session.agentId,
					pid: session.pid,
					startedAt: session.startedAt,
					updatedAt: session.updatedAt,
					lastOutputAt: session.lastOutputAt,
					reviewReason: session.reviewReason,
					exitCode: session.exitCode,
				}
			: null,
	};
}

function formatDependencyRecord(
	state: RuntimeWorkspaceStateResponse,
	dependency: RuntimeBoardDependency,
): Record<string, unknown> {
	return {
		id: dependency.id,
		backlogTaskId: dependency.fromTaskId,
		backlogTaskColumn: getTaskColumnId(state.board, dependency.fromTaskId),
		linkedTaskId: dependency.toTaskId,
		linkedTaskColumn: getTaskColumnId(state.board, dependency.toTaskId),
		createdAt: dependency.createdAt,
	};
}

function getLinkFailureMessage(reason: RuntimeAddTaskDependencyResult["reason"]): string {
	if (reason === "same_task") {
		return "A task cannot be linked to itself.";
	}
	if (reason === "duplicate") {
		return "These tasks are already linked.";
	}
	if (reason === "trash_task") {
		return "Links cannot include done tasks.";
	}
	if (reason === "non_backlog") {
		return "Links require at least one backlog task.";
	}
	return "One or both tasks could not be found.";
}

function findTasksInColumn(
	state: RuntimeWorkspaceStateResponse,
	columnId: ListTaskColumn,
): Array<{ task: RuntimeBoardCard; columnId: RuntimeBoardColumnId }> {
	const column = state.board.columns.find((candidate) => candidate.id === columnId);
	if (!column) {
		return [];
	}
	return column.cards.map((task) => ({
		task,
		columnId: column.id,
	}));
}

async function listTasks(input: { cwd: string; projectPath?: string; column?: ListTaskColumn }): Promise<JsonRecord> {
	const workspace = await resolveRuntimeWorkspace(input.projectPath, input.cwd, {
		autoCreateIfMissing: false,
	});
	const runtimeClient = createRuntimeTrpcClient(workspace.workspaceId);
	const state = await runtimeClient.workspace.getState.query();

	const tasks = state.board.columns.flatMap((boardColumn) => {
		if (!input.column && boardColumn.id === "trash") {
			return [];
		}
		if (input.column && boardColumn.id !== input.column) {
			return [];
		}
		return boardColumn.cards.map((task) => formatTaskRecord(state, task, boardColumn.id));
	});

	return {
		ok: true,
		workspacePath: workspace.repoPath,
		column: input.column ?? null,
		tasks,
		dependencies: state.board.dependencies.map((dependency) => formatDependencyRecord(state, dependency)),
		count: tasks.length,
	};
}

async function stopTaskRuntimeSession(
	runtimeClient: ReturnType<typeof createRuntimeTrpcClient>,
	taskId: string,
): Promise<void> {
	await runtimeClient.runtime.stopTaskSession
		.mutate({
			taskId,
		})
		.catch(() => null);
}

async function deleteTaskWorkspace(
	runtimeClient: ReturnType<typeof createRuntimeTrpcClient>,
	taskId: string,
): Promise<{ removed: boolean; error?: string }> {
	try {
		const deleted = await runtimeClient.workspace.deleteWorktree.mutate({
			taskId,
		});
		return {
			removed: deleted.removed,
			error: deleted.ok ? undefined : deleted.error,
		};
	} catch (error) {
		return {
			removed: false,
			error: toErrorMessage(error),
		};
	}
}

async function createTask(input: {
	cwd: string;
	title?: string;
	prompt: string;
	projectPath?: string;
	baseRef?: string;
	startInPlanMode?: boolean;
	autoReviewEnabled?: boolean;
	autoReviewMode?: "commit" | "pr";
	agentId?: RuntimeAgentId;
	clineSettings?: RuntimeTaskClineSettings;
}): Promise<JsonRecord> {
	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	const workspaceId = await ensureRuntimeWorkspace(workspaceRepoPath);
	const runtimeClient = createRuntimeTrpcClient(workspaceId);
	const created = await updateRuntimeWorkspaceState(runtimeClient, workspaceRepoPath, (state) => {
		const resolvedBaseRef = (input.baseRef ?? "").trim() || resolveTaskBaseRef(state);
		if (!resolvedBaseRef) {
			throw new Error("Could not determine task base branch for this workspace.");
		}
		const result = addTaskToColumn(
			state.board,
			"backlog",
			{
				title: input.title,
				prompt: input.prompt,
				startInPlanMode: input.startInPlanMode,
				autoReviewEnabled: input.autoReviewEnabled,
				autoReviewMode: input.autoReviewMode,
				agentId: input.agentId,
				clineSettings: input.clineSettings,
				baseRef: resolvedBaseRef,
			},
			() => globalThis.crypto.randomUUID(),
		);
		return {
			board: result.board,
			value: result.task,
		};
	});

	return {
		ok: true,
		task: {
			id: created.id,
			column: "backlog",
			workspacePath: workspaceRepoPath,
			title: created.title,
			prompt: created.prompt,
			baseRef: created.baseRef,
			startInPlanMode: created.startInPlanMode,
			autoReviewEnabled: created.autoReviewEnabled === true,
			autoReviewMode: created.autoReviewMode ?? "commit",
			...(created.agentId ? { agentId: created.agentId } : {}),
			...formatTaskClineSettings(created.clineSettings),
		},
	};
}

async function updateTaskCommand(input: {
	cwd: string;
	taskId: string;
	title?: string;
	projectPath?: string;
	prompt?: string;
	baseRef?: string;
	startInPlanMode?: boolean;
	autoReviewEnabled?: boolean;
	autoReviewMode?: "commit" | "pr";
	agentId?: RuntimeAgentId | null;
	clineProviderId?: string | null;
	clineModelId?: string | null;
	clineReasoningEffort?: ParsedTaskClineReasoningEffort;
}): Promise<JsonRecord> {
	if (
		input.title === undefined &&
		input.prompt === undefined &&
		input.baseRef === undefined &&
		input.startInPlanMode === undefined &&
		input.autoReviewEnabled === undefined &&
		input.autoReviewMode === undefined &&
		input.agentId === undefined &&
		input.clineProviderId === undefined &&
		input.clineModelId === undefined &&
		input.clineReasoningEffort === undefined
	) {
		throw new Error("task update requires at least one field to change.");
	}

	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	const workspaceId = await ensureRuntimeWorkspace(workspaceRepoPath);
	const runtimeClient = createRuntimeTrpcClient(workspaceId);
	const updated = await updateRuntimeWorkspaceState(runtimeClient, workspaceRepoPath, (runtimeState) => {
		const taskRecord = findTaskRecord(runtimeState, input.taskId);
		if (!taskRecord) {
			throw new Error(`Task "${input.taskId}" was not found in workspace ${workspaceRepoPath}.`);
		}
		const nextTaskClineSettings = buildTaskClineSettingsForUpdate(taskRecord.task.clineSettings, {
			providerId: input.clineProviderId,
			modelId: input.clineModelId,
			reasoningEffort: input.clineReasoningEffort,
		});

		const updatedTask = updateTask(runtimeState.board, input.taskId, {
			title: input.title ?? taskRecord.task.title,
			prompt: input.prompt ?? taskRecord.task.prompt,
			baseRef: input.baseRef ?? taskRecord.task.baseRef,
			startInPlanMode: input.startInPlanMode ?? taskRecord.task.startInPlanMode,
			autoReviewEnabled: input.autoReviewEnabled ?? taskRecord.task.autoReviewEnabled === true,
			autoReviewMode: input.autoReviewMode ?? taskRecord.task.autoReviewMode ?? "commit",
			agentId: input.agentId,
			clineSettings: nextTaskClineSettings,
		});
		if (!updatedTask.updated || !updatedTask.task) {
			throw new Error(`Task "${input.taskId}" could not be updated.`);
		}

		const nextState: RuntimeWorkspaceStateResponse = {
			...runtimeState,
			board: updatedTask.board,
		};

		return {
			board: updatedTask.board,
			value: formatTaskRecord(nextState, updatedTask.task, taskRecord.columnId),
		};
	});

	return {
		ok: true,
		task: updated,
		workspacePath: workspaceRepoPath,
	};
}

async function linkTasks(input: {
	cwd: string;
	taskId: string;
	linkedTaskId: string;
	projectPath?: string;
}): Promise<JsonRecord> {
	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	const workspaceId = await ensureRuntimeWorkspace(workspaceRepoPath);
	const runtimeClient = createRuntimeTrpcClient(workspaceId);
	const dependency = await updateRuntimeWorkspaceState(runtimeClient, workspaceRepoPath, (runtimeState) => {
		const linked = addTaskDependency(runtimeState.board, input.taskId, input.linkedTaskId);
		if (!linked.added || !linked.dependency) {
			throw new Error(getLinkFailureMessage(linked.reason));
		}

		const nextState: RuntimeWorkspaceStateResponse = {
			...runtimeState,
			board: linked.board,
		};
		return {
			board: linked.board,
			value: formatDependencyRecord(nextState, linked.dependency),
		};
	});
	return {
		ok: true,
		workspacePath: workspaceRepoPath,
		dependency,
	};
}

async function decomposeTaskGraph(input: {
	cwd: string;
	slug: string;
	projectPath?: string;
	baseRef?: string;
}): Promise<JsonRecord> {
	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	const workspaceId = await ensureRuntimeWorkspace(workspaceRepoPath);
	const runtimeClient = createRuntimeTrpcClient(workspaceId);
	const artifacts = await readClinePlanArtifacts(workspaceRepoPath, input.slug);
	const runtimeConfig = await loadRuntimeConfig(workspaceRepoPath);
	const routingCandidates = await buildDecompositionRoutingCandidates(runtimeConfig);
	let applied: {
		createdTasks: JsonRecord[];
		createdDependencies: JsonRecord[];
		taskIdByPlanTaskId: Record<string, string>;
	};
	try {
		applied = await updateRuntimeWorkspaceState(runtimeClient, workspaceRepoPath, (runtimeState) => {
			const resolvedBaseRef = (input.baseRef ?? "").trim() || resolveTaskBaseRef(runtimeState);
			if (!resolvedBaseRef) {
				throw new Error("Could not determine task base branch for this workspace.");
			}
			const result = applyClinePlanTaskGraphToBoard({
				board: runtimeState.board,
				taskGraph: artifacts.taskGraph,
				baseRef: resolvedBaseRef,
				randomUuid: () => globalThis.crypto.randomUUID(),
				modelRoleSettings: runtimeConfig.modelRoles,
				routingCandidates,
				sharedContext: {
					spec: artifacts.spec,
					decisionsMarkdown: artifacts.decisionsMarkdown,
				},
			});
			const nextState: RuntimeWorkspaceStateResponse = {
				...runtimeState,
				board: result.board,
			};
			return {
				board: result.board,
				value: {
					createdTasks: result.createdTasks.map((task) => formatTaskRecord(nextState, task, "planning")),
					createdDependencies: result.createdDependencies.map((dependency) =>
						formatDependencyRecord(nextState, dependency),
					),
					taskIdByPlanTaskId: result.taskIdByPlanTaskId,
				},
			};
		});
	} catch (error) {
		recordDecompositionRejection({
			workspacePath: workspaceRepoPath,
			slug: artifacts.taskGraph.slug,
			title: artifacts.taskGraph.title,
			specPath: artifacts.specPath,
			planPath: artifacts.planPath,
			questionsPath: artifacts.questionsPath,
			decisionsPath: artifacts.decisionsPath,
			revisionsPath: artifacts.revisionsPath,
			summaryPath: artifacts.summaryPath,
			taskGraphPath: artifacts.taskGraphPath,
			error,
		});
		throw error;
	}

	return {
		ok: true,
		workspacePath: workspaceRepoPath,
		plan: {
			slug: artifacts.taskGraph.slug,
			title: artifacts.taskGraph.title,
			specPath: artifacts.specPath,
			planPath: artifacts.planPath,
			questionsPath: artifacts.questionsPath,
			decisionsPath: artifacts.decisionsPath,
			revisionsPath: artifacts.revisionsPath,
			summaryPath: artifacts.summaryPath,
			taskGraphPath: artifacts.taskGraphPath,
		},
		tasks: applied.createdTasks,
		dependencies: applied.createdDependencies,
		taskIdByPlanTaskId: applied.taskIdByPlanTaskId,
		count: applied.createdTasks.length,
	};
}

export async function runVerifyTaskAcceptanceCommand(
	input: {
		cwd: string;
		taskId: string;
		projectPath?: string;
		workspaceRoot?: boolean;
		ensureWorktree?: boolean;
		timeoutMs?: number;
		repairAttempt?: number;
		maxRepairAttempts?: number;
	},
	deps: VerifyTaskAcceptanceDependencies = {},
): Promise<JsonRecord> {
	const workspaceRepoPath = await (deps.resolveWorkspaceRepoPath ?? resolveWorkspaceRepoPath)(
		input.projectPath,
		input.cwd,
		{
			autoCreateIfMissing: false,
		},
	);
	const readState = deps.loadWorkspaceState ?? loadWorkspaceState;
	const state = await readState(workspaceRepoPath);
	const taskRecord = findTaskRecord(state, input.taskId);
	if (!taskRecord) {
		throw new Error(`Task "${input.taskId}" was not found in workspace ${workspaceRepoPath}.`);
	}

	const taskWorkspacePath = input.workspaceRoot
		? workspaceRepoPath
		: await (deps.resolveTaskCwd ?? resolveTaskCwd)({
				cwd: workspaceRepoPath,
				taskId: input.taskId,
				baseRef: taskRecord.task.baseRef,
				ensure: input.ensureWorktree === true,
			});
	const result = await (deps.runAcceptanceGate ?? runClineAcceptanceGate)({
		taskId: input.taskId,
		workspacePath: taskWorkspacePath,
		taskPrompt: taskRecord.task.prompt,
		timeoutMs: input.timeoutMs,
	});

	const ok = result.present === true && result.passed === true;
	const repair = ok
		? null
		: buildClineAcceptanceRepairPlan({
				taskId: input.taskId,
				taskTitle: taskRecord.task.title,
				taskPrompt: taskRecord.task.prompt,
				acceptance: result,
				attempt: input.repairAttempt ?? 1,
				maxAttempts: input.maxRepairAttempts,
				modelRoles: (await (deps.loadRuntimeConfig ?? loadRuntimeConfig)(workspaceRepoPath)).modelRoles,
			});
	const acceptancePlanGap = !ok
		? classifyAcceptanceFailurePlanGap({
				acceptancePresent: result.present,
				repairAction: repair?.action ?? null,
				command: result.command,
				output: result.output,
				taskPrompt: taskRecord.task.prompt,
			})
		: null;
	if (acceptancePlanGap) {
		(deps.recordPlanGap ?? recordPlanGap)({
			workspacePath: workspaceRepoPath,
			taskId: input.taskId,
			kind: acceptancePlanGap.kind,
			description: acceptancePlanGap.description,
			evidence: acceptancePlanGap.evidence,
		});
	}
	return {
		ok,
		workspacePath: workspaceRepoPath,
		taskWorkspacePath,
		task: formatTaskRecord(state, taskRecord.task, taskRecord.columnId),
		acceptance: result,
		...(repair ? { repair } : {}),
		...(ok
			? {}
			: {
					error: result.present
						? `Acceptance check failed for task "${input.taskId}".`
						: `Task "${input.taskId}" has no Acceptance check line.`,
				}),
	};
}

async function unlinkTasks(input: { cwd: string; dependencyId: string; projectPath?: string }): Promise<JsonRecord> {
	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	const workspaceId = await ensureRuntimeWorkspace(workspaceRepoPath);
	const runtimeClient = createRuntimeTrpcClient(workspaceId);
	const removedDependency = await updateRuntimeWorkspaceState(runtimeClient, workspaceRepoPath, (runtimeState) => {
		const dependency =
			runtimeState.board.dependencies.find((candidate) => candidate.id === input.dependencyId) ?? null;
		if (!dependency) {
			throw new Error(`Dependency "${input.dependencyId}" was not found in workspace ${workspaceRepoPath}.`);
		}

		const unlinked = removeTaskDependency(runtimeState.board, input.dependencyId);
		if (!unlinked.removed) {
			throw new Error(`Dependency "${input.dependencyId}" could not be removed.`);
		}

		const nextState: RuntimeWorkspaceStateResponse = {
			...runtimeState,
			board: unlinked.board,
		};
		return {
			board: unlinked.board,
			value: formatDependencyRecord(nextState, dependency),
		};
	});
	return {
		ok: true,
		workspacePath: workspaceRepoPath,
		removedDependency,
	};
}

async function startTask(input: {
	cwd: string;
	taskId: string;
	projectPath?: string;
	queueOnEndpointBusy?: boolean;
	allowQueuedStart?: boolean;
}): Promise<JsonRecord> {
	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	const workspaceId = await ensureRuntimeWorkspace(workspaceRepoPath);
	const runtimeClient = createRuntimeTrpcClient(workspaceId);
	const runtimeState = await runtimeClient.workspace.getState.query();
	const fromColumnId = getTaskColumnId(runtimeState.board, input.taskId);
	if (!fromColumnId) {
		throw new Error(`Task "${input.taskId}" was not found in workspace ${workspaceRepoPath}.`);
	}

	const currentRecord = findTaskRecord(runtimeState, input.taskId);
	const task = currentRecord?.task;
	if (!task) {
		throw new Error(`Task "${input.taskId}" could not be resolved.`);
	}
	const activeColumnId: RuntimeBoardColumnId = task.startInPlanMode ? "planning" : "in_progress";
	if (fromColumnId !== "backlog" && fromColumnId !== activeColumnId) {
		throw new Error(
			`Task "${input.taskId}" is in "${fromColumnId}" and can only be started from backlog or ${activeColumnId}.`,
		);
	}

	const existingSession = runtimeState.sessions[task.id] ?? null;
	const shouldStartSession = existingSession?.state !== "running";

	if (shouldStartSession) {
		const overlappingTask = findActiveTaskLikelyTouchedFileOverlap({
			board: runtimeState.board,
			sessions: runtimeState.sessions,
			task,
		});
		if (overlappingTask) {
			throw new Error(
				`Task "${task.id}" likely touches the same files as active task "${overlappingTask.id}". Wait for the active task to finish before starting this one.`,
			);
		}
		const ensured = await runtimeClient.workspace.ensureWorktree.mutate({
			taskId: task.id,
			baseRef: task.baseRef,
		});
		if (!ensured.ok) {
			throw new Error(ensured.error ?? "Could not ensure task worktree.");
		}

		const started = await runtimeClient.runtime.startTaskSession.mutate({
			taskId: task.id,
			prompt: task.prompt,
			taskTitle: task.title,
			startInPlanMode: task.startInPlanMode,
			baseRef: task.baseRef,
			agentId: task.agentId,
			clineSettings: task.clineSettings,
			queueOnEndpointBusy: input.queueOnEndpointBusy,
		});
		if (!started.ok || !started.summary) {
			if (started.errorCode === "endpoint_busy" && started.queued && input.allowQueuedStart) {
				return {
					ok: false,
					queued: true,
					task: {
						id: task.id,
						prompt: task.prompt,
						column: fromColumnId,
						workspacePath: workspaceRepoPath,
					},
					error: started.error ?? "Task session is queued until its local model endpoint is available.",
					retryAfterMs: started.retryAfterMs ?? null,
				};
			}
			if (started.errorCode === "needs_decomposition") {
				await updateRuntimeWorkspaceState(runtimeClient, workspaceRepoPath, (latestState) => ({
					board: markTaskNeedsDecompositionOnBoard(latestState.board, task.id, started.error),
					value: null,
				}));
			}
			throw new Error(started.error ?? "Could not start task session.");
		}
	}

	const moved = await updateRuntimeWorkspaceState(runtimeClient, workspaceRepoPath, (latestState) => {
		const movement = moveTaskToColumn(latestState.board, input.taskId, activeColumnId);
		if (!movement.task) {
			throw new Error(`Task "${input.taskId}" could not be resolved.`);
		}
		if (!movement.moved) {
			return {
				board: latestState.board,
				value: movement,
			};
		}
		return {
			board: movement.board,
			value: movement,
		};
	});

	if (!moved.moved) {
		return {
			ok: true,
			message: `Task "${input.taskId}" is already in progress.`,
			task: {
				id: task.id,
				prompt: task.prompt,
				column: activeColumnId,
				workspacePath: workspaceRepoPath,
			},
		};
	}

	return {
		ok: true,
		task: {
			id: task.id,
			prompt: task.prompt,
			column: activeColumnId,
			workspacePath: workspaceRepoPath,
		},
	};
}

type FinishedTaskColumn = "completed" | "trash";

interface FinishTaskExecutionResult {
	task: JsonRecord;
	taskId: string;
	previousColumnId: ListTaskColumn;
	readyTaskIds: string[];
	autoStartedTasks: JsonRecord[];
	autoMerge: JsonRecord | null;
	worktreeDeleted: boolean;
	worktreeDeleteError?: string;
	alreadyInTargetColumn: boolean;
}

interface FinishTaskMutationValue {
	task: JsonRecord;
	previousColumnId: ListTaskColumn;
	readyTaskIds: string[];
	alreadyInTargetColumn: boolean;
}

function columnCanHaveLiveTaskSession(columnId: ListTaskColumn): boolean {
	return columnId === "planning" || columnId === "in_progress" || columnId === "review";
}

async function autoMergeFinishedTaskWorktree(input: {
	taskId: string;
	workspaceRepoPath: string;
	runtimeClient: ReturnType<typeof createRuntimeTrpcClient>;
}): Promise<JsonRecord> {
	const state = await input.runtimeClient.workspace.getState.query();
	const result = await mergeTaskWorktreesInDependencyOrder({
		repoPath: input.workspaceRepoPath,
		board: state.board,
		columns: ["completed"],
		taskIds: [input.taskId],
	});
	const integrationTask =
		result.conflict && state.git.currentBranch
			? await createIntegrationCardForMergeConflict({
					workspaceRepoPath: input.workspaceRepoPath,
					runtimeClient: input.runtimeClient,
					conflict: result.conflict,
					baseRef: state.git.currentBranch,
				})
			: null;
	recordTaskWorktreeMergeObservations({
		workspacePath: input.workspaceRepoPath,
		steps: result.steps,
		ok: result.ok,
	});
	return {
		ok: result.ok,
		mergedTaskIds: result.mergedTaskIds,
		skippedTaskIds: result.skippedTaskIds,
		steps: result.steps,
		integrationTask,
		conflict: result.conflict ?? null,
		blocked: result.blocked ?? null,
	};
}

function recordTaskWorktreeMergeObservations(input: {
	workspacePath: string;
	steps: readonly TaskWorktreeAutoMergeStep[];
	ok: boolean;
}): void {
	for (const step of input.steps) {
		if (!step.taskId) {
			continue;
		}
		const severity = step.type === "conflict" || step.type === "blocked" ? "warning" : "info";
		const message =
			step.type === "merged"
				? `Task worktree merged: ${step.taskId}`
				: step.type === "skipped"
					? `Task worktree merge skipped: ${step.taskId}`
					: step.type === "conflict"
						? `Task worktree merge conflict: ${step.taskId}`
						: `Task worktree merge blocked: ${step.reason}`;
		recordSelfObservation({
			signal: "custom",
			severity,
			message,
			taskId: step.taskId,
			workspacePath: input.workspacePath,
			metadata: {
				category: "task_worktree_merge",
				ok: input.ok,
				type: step.type,
				reason: "reason" in step ? step.reason : null,
				headCommit: "headCommit" in step ? step.headCommit : null,
				conflictedPaths: "conflictedPaths" in step ? step.conflictedPaths : null,
			},
		});
	}
}

async function finishTaskById(input: {
	cwd: string;
	taskId: string;
	targetColumn: FinishedTaskColumn;
	projectPath?: string;
	workspaceRepoPath: string;
	runtimeClient: ReturnType<typeof createRuntimeTrpcClient>;
}): Promise<FinishTaskExecutionResult> {
	const mutation = await mutateWorkspaceState<FinishTaskMutationValue>(input.workspaceRepoPath, (latestState) => {
		const latestRecord = findTaskRecord(latestState, input.taskId);
		if (!latestRecord) {
			throw new Error(`Task "${input.taskId}" was not found in workspace ${input.workspaceRepoPath}.`);
		}
		if (latestRecord.columnId === input.targetColumn) {
			return {
				board: latestState.board,
				value: {
					task: formatTaskRecord(latestState, latestRecord.task, latestRecord.columnId),
					previousColumnId: latestRecord.columnId,
					readyTaskIds: [] as string[],
					alreadyInTargetColumn: true,
				},
				save: false,
			};
		}

		const finished =
			input.targetColumn === "completed"
				? completeTaskAndGetReadyLinkedTaskIds(latestState.board, input.taskId)
				: trashTaskAndGetReadyLinkedTaskIds(latestState.board, input.taskId);
		if (!finished.moved || !finished.task) {
			throw new Error(`Task "${input.taskId}" could not be moved to ${input.targetColumn}.`);
		}

		const nextState: RuntimeWorkspaceStateResponse = {
			...latestState,
			board: finished.board,
		};
		return {
			board: finished.board,
			value: {
				task: formatTaskRecord(nextState, finished.task, input.targetColumn),
				previousColumnId: latestRecord.columnId,
				readyTaskIds: finished.readyTaskIds,
				alreadyInTargetColumn: false,
			},
		};
	});

	if (mutation.saved) {
		await notifyRuntimeWorkspaceStateUpdated(input.runtimeClient);
	}

	if (mutation.value.alreadyInTargetColumn) {
		return {
			task: mutation.value.task,
			taskId: input.taskId,
			previousColumnId: mutation.value.previousColumnId,
			readyTaskIds: [],
			autoStartedTasks: [],
			autoMerge: null,
			worktreeDeleted: false,
			alreadyInTargetColumn: true,
		};
	}

	if (columnCanHaveLiveTaskSession(mutation.value.previousColumnId)) {
		await stopTaskRuntimeSession(input.runtimeClient, input.taskId);
	}

	const autoMerge =
		input.targetColumn === "completed" && mutation.value.previousColumnId === "review"
			? await autoMergeFinishedTaskWorktree({
					taskId: input.taskId,
					workspaceRepoPath: input.workspaceRepoPath,
					runtimeClient: input.runtimeClient,
				})
			: null;
	const canContinueAfterMerge = autoMerge === null || autoMerge.ok === true;
	const autoStartedTasks: JsonRecord[] = [];
	if (canContinueAfterMerge) {
		for (const readyTaskId of mutation.value.readyTaskIds.slice(
			0,
			clampRuntimeSwarmCardStartBatchSize(mutation.value.readyTaskIds.length),
		)) {
			const started = await startTask({
				cwd: input.cwd,
				taskId: readyTaskId,
				projectPath: input.projectPath,
				queueOnEndpointBusy: true,
				allowQueuedStart: true,
			});
			autoStartedTasks.push(started);
		}
	}

	const deletedWorkspace = canContinueAfterMerge
		? await deleteTaskWorkspace(input.runtimeClient, input.taskId)
		: { removed: false, error: "Task worktree kept because auto-merge did not complete." };

	return {
		task: mutation.value.task,
		taskId: input.taskId,
		previousColumnId: mutation.value.previousColumnId,
		readyTaskIds: mutation.value.readyTaskIds,
		autoStartedTasks,
		autoMerge,
		worktreeDeleted: deletedWorkspace.removed,
		worktreeDeleteError: deletedWorkspace.error,
		alreadyInTargetColumn: false,
	};
}

async function finishTask(input: {
	cwd: string;
	taskId?: string;
	column?: ListTaskColumn;
	targetColumn: FinishedTaskColumn;
	projectPath?: string;
}): Promise<JsonRecord> {
	const commandName = input.targetColumn === "completed" ? "task done" : "task trash";
	const target = resolveTaskCommandTarget(input, commandName);
	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	const workspaceId = await ensureRuntimeWorkspace(workspaceRepoPath);
	const runtimeClient = createRuntimeTrpcClient(workspaceId);

	if (target.kind === "task") {
		const finished = await finishTaskById({
			cwd: input.cwd,
			taskId: target.taskId,
			targetColumn: input.targetColumn,
			projectPath: input.projectPath,
			workspaceRepoPath,
			runtimeClient,
		});
		if (finished.alreadyInTargetColumn) {
			return {
				ok: true,
				message: `Task "${target.taskId}" is already done.`,
				task: finished.task,
				workspacePath: workspaceRepoPath,
				readyTaskIds: [],
				autoStartedTasks: [],
				autoMerge: null,
			};
		}
		return {
			ok: true,
			task: finished.task,
			workspacePath: workspaceRepoPath,
			readyTaskIds: finished.readyTaskIds,
			autoStartedTasks: finished.autoStartedTasks,
			autoMerge: finished.autoMerge,
			worktreeDeleted: finished.worktreeDeleted,
			worktreeDeleteError: finished.worktreeDeleteError,
		};
	}

	const initialState = await runtimeClient.workspace.getState.query();
	const targetTasks = findTasksInColumn(initialState, target.column);
	if (targetTasks.length === 0) {
		return {
			ok: true,
			column: target.column,
			workspacePath: workspaceRepoPath,
			finishedTasks: [],
			alreadyFinishedTasks: [],
			readyTaskIds: [],
			autoStartedTasks: [],
			worktreeCleanup: [],
			count: 0,
		};
	}

	const results: FinishTaskExecutionResult[] = [];
	for (const { task } of targetTasks) {
		results.push(
			await finishTaskById({
				cwd: input.cwd,
				taskId: task.id,
				targetColumn: input.targetColumn,
				projectPath: input.projectPath,
				workspaceRepoPath,
				runtimeClient,
			}),
		);
	}

	const finishedTasks = results.filter((result) => !result.alreadyInTargetColumn);
	const alreadyFinishedTasks = results.filter((result) => result.alreadyInTargetColumn);

	return {
		ok: true,
		column: target.column,
		workspacePath: workspaceRepoPath,
		finishedTasks: finishedTasks.map((result) => result.task),
		alreadyFinishedTasks: alreadyFinishedTasks.map((result) => result.task),
		readyTaskIds: [...new Set(finishedTasks.flatMap((result) => result.readyTaskIds))],
		autoStartedTasks: finishedTasks.flatMap((result) => result.autoStartedTasks),
		autoMerge: finishedTasks.map((result) => ({
			taskId: result.taskId,
			result: result.autoMerge,
		})),
		worktreeCleanup: finishedTasks.map((result) => ({
			taskId: result.taskId,
			removed: result.worktreeDeleted,
			error: result.worktreeDeleteError,
		})),
		count: finishedTasks.length,
	};
}

function buildIntegrationCardPrompt(conflict: TaskWorktreeAutoMergeConflict): string {
	const paths =
		conflict.conflictedPaths.length > 0
			? conflict.conflictedPaths.map((path) => `- ${path}`).join("\n")
			: "- No conflicted paths were reported by Git; inspect the aborted merge output.";
	return [
		`Resolve the merge conflict from task "${conflict.taskId}".`,
		`Task head: ${conflict.headCommit}`,
		"Conflicting paths:",
		paths,
		"Re-run the task worktree merge after resolving the integration changes.",
		`Git message: ${conflict.message}`,
	].join("\n\n");
}

function buildPlanGapIntegrationCardPrompt(input: {
	taskId: string;
	description: string;
	evidence?: string | null;
}): string {
	const lines = [
		`Add the missing integration step reported by task "${input.taskId}".`,
		"",
		input.description.trim() || "An execution task reported that the plan needs an integration step.",
	];
	if (input.evidence?.trim()) {
		lines.push("", `Evidence: ${input.evidence.trim()}`);
	}
	lines.push(
		"",
		"Review the completed and in-progress plan work, implement only the missing integration glue, and keep the acceptance contract explicit.",
	);
	return lines.join("\n");
}

function findBoardTaskByTitle(
	board: RuntimeWorkspaceStateResponse["board"],
	title: string,
): { columnId: RuntimeBoardColumnId; task: RuntimeBoardCard } | null {
	for (const column of board.columns) {
		for (const task of column.cards) {
			if (task.title === title) {
				return { columnId: column.id, task };
			}
		}
	}
	return null;
}

export function addPlanGapIntegrationCardToBoard(input: {
	state: RuntimeWorkspaceStateResponse;
	taskId: string;
	description: string;
	evidence?: string | null;
	baseRef: string;
	createId?: () => string;
}): {
	board: RuntimeWorkspaceStateResponse["board"];
	task: RuntimeBoardCard;
	created: boolean;
} {
	const title = `Integrate plan gap from ${input.taskId}`;
	const existing = findBoardTaskByTitle(input.state.board, title);
	if (existing) {
		return {
			board: input.state.board,
			task: existing.task,
			created: false,
		};
	}
	const created = addTaskToColumn(
		input.state.board,
		"planning",
		{
			title,
			prompt: buildPlanGapIntegrationCardPrompt(input),
			startInPlanMode: true,
			autoReviewEnabled: true,
			autoReviewMode: "commit",
			agentId: "cline",
			baseRef: input.baseRef,
		},
		input.createId ?? (() => globalThis.crypto.randomUUID()),
	);
	return {
		board: created.board,
		task: created.task,
		created: true,
	};
}

function buildPlanGapDecisionCardPrompt(input: {
	taskId: string;
	kind: Extract<PlanGapKind, "missing_decision" | "contradictory_requirement">;
	description: string;
	evidence?: string | null;
}): string {
	const label = input.kind === "contradictory_requirement" ? "contradiction" : "missing decision";
	const lines = [
		`Resolve the ${label} reported by task "${input.taskId}".`,
		"",
		input.description.trim() || "Execution found a plan decision that must be answered before work continues.",
	];
	if (input.evidence?.trim()) {
		lines.push("", `Evidence: ${input.evidence.trim()}`);
	}
	lines.push(
		"",
		"Ask the user for the smallest decision that unblocks the plan, record the answer in the plan decisions/revisions artifacts when available, and update affected cards before implementation continues.",
	);
	return lines.join("\n");
}

function buildPlanGapScopeCardPrompt(input: { taskId: string; description: string; evidence?: string | null }): string {
	const lines = [
		`Split the oversized task reported by "${input.taskId}".`,
		"",
		input.description.trim() || "Execution found this card is too large for one autonomous task.",
	];
	if (input.evidence?.trim()) {
		lines.push("", `Evidence: ${input.evidence.trim()}`);
	}
	lines.push(
		"",
		"Inspect the source card and produce bounded replacement leaves. Prefer the existing decomposition workflow with recursive expansions so dependencies can be re-linked through the saved task graph instead of broadening the source card.",
	);
	return lines.join("\n");
}

export function addPlanGapDecisionCardToBoard(input: {
	state: RuntimeWorkspaceStateResponse;
	taskId: string;
	kind: Extract<PlanGapKind, "missing_decision" | "contradictory_requirement">;
	description: string;
	evidence?: string | null;
	baseRef: string;
	createId?: () => string;
}): {
	board: RuntimeWorkspaceStateResponse["board"];
	task: RuntimeBoardCard;
	created: boolean;
} {
	const title =
		input.kind === "contradictory_requirement"
			? `Resolve plan contradiction from ${input.taskId}`
			: `Resolve plan decision gap from ${input.taskId}`;
	const existing = findBoardTaskByTitle(input.state.board, title);
	if (existing) {
		return {
			board: input.state.board,
			task: existing.task,
			created: false,
		};
	}
	const created = addTaskToColumn(
		input.state.board,
		"planning",
		{
			title,
			prompt: buildPlanGapDecisionCardPrompt(input),
			startInPlanMode: true,
			autoReviewEnabled: false,
			autoReviewMode: "commit",
			agentId: "cline",
			baseRef: input.baseRef,
		},
		input.createId ?? (() => globalThis.crypto.randomUUID()),
	);
	return {
		board: created.board,
		task: created.task,
		created: true,
	};
}

export function addPlanGapScopeCardToBoard(input: {
	state: RuntimeWorkspaceStateResponse;
	taskId: string;
	description: string;
	evidence?: string | null;
	baseRef: string;
	createId?: () => string;
}): {
	board: RuntimeWorkspaceStateResponse["board"];
	task: RuntimeBoardCard;
	created: boolean;
} {
	const blockedBoard = markTaskNeedsDecompositionOnBoard(
		input.state.board,
		input.taskId,
		input.description.trim() || "Plan gap reported this card is too large and needs decomposition.",
	);
	const title = `Split oversized plan gap from ${input.taskId}`;
	const existing = findBoardTaskByTitle(blockedBoard, title);
	if (existing) {
		return {
			board: blockedBoard,
			task: existing.task,
			created: false,
		};
	}
	const created = addTaskToColumn(
		blockedBoard,
		"planning",
		{
			title,
			prompt: buildPlanGapScopeCardPrompt(input),
			startInPlanMode: true,
			autoReviewEnabled: false,
			autoReviewMode: "commit",
			agentId: "cline",
			baseRef: input.baseRef,
		},
		input.createId ?? (() => globalThis.crypto.randomUUID()),
	);
	return {
		board: created.board,
		task: created.task,
		created: true,
	};
}

export function buildPlanGapIntegrationRevision(input: {
	taskId: string;
	integrationTaskId: string;
	description: string;
	evidence?: string | null;
}): {
	kind: string;
	description: string;
	evidence: string | null;
} {
	const evidence = input.evidence?.trim() ? input.evidence.trim() : null;
	return {
		kind: "integration_card_added",
		description: `Added Planning integration card "${input.integrationTaskId}" for plan gap reported by task "${input.taskId}": ${
			input.description.trim() || "missing integration work"
		}`,
		evidence,
	};
}

function matchesPlanBoardTaskId(input: { taskId: string; planSlug: string; planTaskId: string }): {
	matches: boolean;
	exact: boolean;
} {
	const baseTaskId = `${slugifyPlanTaskId(input.planSlug)}-${slugifyPlanTaskId(input.planTaskId)}`;
	if (input.taskId === baseTaskId) {
		return { matches: true, exact: true };
	}
	if (!input.taskId.startsWith(`${baseTaskId}-`)) {
		return { matches: false, exact: false };
	}
	return {
		matches: /^\d+$/.test(input.taskId.slice(baseTaskId.length + 1)),
		exact: false,
	};
}

export async function inferClinePlanSlugForTask(input: {
	workspacePath: string;
	taskId: string;
}): Promise<string | null> {
	const plansRoot = join(input.workspacePath, ".cline", "kanban", "plans");
	const entries = await readdir(plansRoot, { withFileTypes: true }).catch(() => []);
	const matches: { slug: string; exact: boolean }[] = [];
	for (const entry of entries
		.filter((candidate) => candidate.isDirectory())
		.sort((left, right) => left.name.localeCompare(right.name))) {
		const artifacts = await readClinePlanArtifacts(input.workspacePath, entry.name).catch(() => null);
		if (!artifacts) {
			continue;
		}
		for (const task of artifacts.taskGraph.tasks) {
			const match = matchesPlanBoardTaskId({
				taskId: input.taskId,
				planSlug: artifacts.taskGraph.slug,
				planTaskId: task.id,
			});
			if (match.matches) {
				matches.push({ slug: artifacts.taskGraph.slug, exact: match.exact });
			}
		}
	}
	const exactMatches = matches.filter((match) => match.exact);
	if (exactMatches.length === 1) {
		return exactMatches[0].slug;
	}
	if (exactMatches.length > 1) {
		return null;
	}
	return matches.length === 1 ? matches[0].slug : null;
}

async function createIntegrationCardForMergeConflict(input: {
	workspaceRepoPath: string;
	runtimeClient: ReturnType<typeof createRuntimeTrpcClient>;
	conflict: TaskWorktreeAutoMergeConflict;
	baseRef: string;
}): Promise<JsonRecord> {
	const mutation = await mutateWorkspaceState<JsonRecord>(input.workspaceRepoPath, (latestState) => {
		const created = addTaskToColumn(
			latestState.board,
			"planning",
			{
				title: `Resolve merge conflict for ${input.conflict.taskId}`,
				prompt: buildIntegrationCardPrompt(input.conflict),
				startInPlanMode: true,
				autoReviewEnabled: true,
				autoReviewMode: "commit",
				agentId: "cline",
				baseRef: input.baseRef,
				filesLikelyTouched: input.conflict.conflictedPaths,
			},
			() => globalThis.crypto.randomUUID(),
		);
		const nextState: RuntimeWorkspaceStateResponse = {
			...latestState,
			board: created.board,
		};
		return {
			board: created.board,
			value: formatTaskRecord(nextState, created.task, "planning"),
		};
	});
	if (mutation.saved) {
		await notifyRuntimeWorkspaceStateUpdated(input.runtimeClient);
	}
	return mutation.value;
}

async function mergeTaskWorktreesCommand(input: {
	cwd: string;
	projectPath?: string;
	taskId?: string;
	column: TaskWorktreeAutoMergeColumn;
}): Promise<JsonRecord> {
	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	const workspaceId = await ensureRuntimeWorkspace(workspaceRepoPath);
	const runtimeClient = createRuntimeTrpcClient(workspaceId);
	const state = await runtimeClient.workspace.getState.query();
	const result = await mergeTaskWorktreesInDependencyOrder({
		repoPath: workspaceRepoPath,
		board: state.board,
		columns: [input.column],
		taskIds: input.taskId ? [input.taskId] : undefined,
	});
	const integrationTask =
		result.conflict && state.git.currentBranch
			? await createIntegrationCardForMergeConflict({
					workspaceRepoPath,
					runtimeClient,
					conflict: result.conflict,
					baseRef: state.git.currentBranch,
				})
			: null;
	recordTaskWorktreeMergeObservations({
		workspacePath: workspaceRepoPath,
		steps: result.steps,
		ok: result.ok,
	});
	return {
		ok: result.ok,
		workspacePath: workspaceRepoPath,
		column: input.column,
		mergedTaskIds: result.mergedTaskIds,
		skippedTaskIds: result.skippedTaskIds,
		steps: result.steps,
		integrationTask,
		conflict: result.conflict ?? null,
		blocked: result.blocked ?? null,
	};
}

async function requestTaskSwarmStopCommand(input: {
	cwd: string;
	projectPath?: string;
	reason?: string;
}): Promise<JsonRecord> {
	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	const signal = await requestSwarmStop({
		workspacePath: workspaceRepoPath,
		reason: input.reason,
	});
	return {
		ok: true,
		workspacePath: workspaceRepoPath,
		signal,
	};
}

async function clearTaskSwarmStopCommand(input: { cwd: string; projectPath?: string }): Promise<JsonRecord> {
	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	await clearSwarmStop(workspaceRepoPath);
	return {
		ok: true,
		workspacePath: workspaceRepoPath,
	};
}

async function recordTaskPlanGapCommand(input: {
	cwd: string;
	projectPath?: string;
	taskId: string;
	kind: PlanGapKind;
	description: string;
	evidence?: string;
	planSlug?: string;
}): Promise<JsonRecord> {
	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	const planSlug =
		input.planSlug?.trim() ||
		(await inferClinePlanSlugForTask({
			workspacePath: workspaceRepoPath,
			taskId: input.taskId,
		}));
	recordPlanGap({
		workspacePath: workspaceRepoPath,
		taskId: input.taskId,
		kind: input.kind,
		description: input.description,
		evidence: input.evidence,
	});
	let revisionsPath = planSlug
		? await appendClinePlanRevision({
				workspacePath: workspaceRepoPath,
				slug: planSlug,
				taskId: input.taskId,
				kind: input.kind,
				description: input.description,
				evidence: input.evidence,
			})
		: null;
	let integrationTask: JsonRecord | null = null;
	let adaptationTask: JsonRecord | null = null;
	let adaptationCreated = false;
	if (input.kind === "integration_needed") {
		const workspaceId = await ensureRuntimeWorkspace(workspaceRepoPath);
		const runtimeClient = createRuntimeTrpcClient(workspaceId);
		const mutation = await mutateWorkspaceState<{ task: JsonRecord; created: boolean }>(
			workspaceRepoPath,
			(latestState) => {
				const baseRef = latestState.git.currentBranch ?? latestState.git.defaultBranch ?? "main";
				const created = addPlanGapIntegrationCardToBoard({
					state: latestState,
					taskId: input.taskId,
					description: input.description,
					evidence: input.evidence,
					baseRef,
				});
				const nextState: RuntimeWorkspaceStateResponse = {
					...latestState,
					board: created.board,
				};
				return {
					board: created.board,
					value: {
						task: formatTaskRecord(nextState, created.task, "planning"),
						created: created.created,
					},
				};
			},
		);
		integrationTask = mutation.value.task;
		adaptationTask = mutation.value.task;
		adaptationCreated = mutation.value.created;
		if (mutation.saved) {
			await notifyRuntimeWorkspaceStateUpdated(runtimeClient);
		}
		const integrationTaskId = typeof integrationTask.id === "string" ? integrationTask.id : null;
		if (integrationTaskId && planSlug && adaptationCreated) {
			const revision = buildPlanGapIntegrationRevision({
				taskId: input.taskId,
				integrationTaskId,
				description: input.description,
				evidence: input.evidence,
			});
			revisionsPath = await appendClinePlanRevision({
				workspacePath: workspaceRepoPath,
				slug: planSlug,
				taskId: input.taskId,
				kind: revision.kind,
				description: revision.description,
				evidence: revision.evidence ?? undefined,
			});
		}
	}
	if (
		input.kind === "missing_decision" ||
		input.kind === "contradictory_requirement" ||
		input.kind === "scope_too_large"
	) {
		const workspaceId = await ensureRuntimeWorkspace(workspaceRepoPath);
		const runtimeClient = createRuntimeTrpcClient(workspaceId);
		const mutation = await mutateWorkspaceState<{ task: JsonRecord; created: boolean }>(
			workspaceRepoPath,
			(latestState) => {
				const baseRef = latestState.git.currentBranch ?? latestState.git.defaultBranch ?? "main";
				const adapted =
					input.kind === "scope_too_large"
						? addPlanGapScopeCardToBoard({
								state: latestState,
								taskId: input.taskId,
								description: input.description,
								evidence: input.evidence,
								baseRef,
							})
						: addPlanGapDecisionCardToBoard({
								state: latestState,
								taskId: input.taskId,
								kind:
									input.kind === "contradictory_requirement"
										? "contradictory_requirement"
										: "missing_decision",
								description: input.description,
								evidence: input.evidence,
								baseRef,
							});
				const nextState: RuntimeWorkspaceStateResponse = {
					...latestState,
					board: adapted.board,
				};
				return {
					board: adapted.board,
					value: {
						task: formatTaskRecord(nextState, adapted.task, "planning"),
						created: adapted.created,
					},
				};
			},
		);
		adaptationTask = mutation.value.task;
		adaptationCreated = mutation.value.created;
		if (mutation.saved) {
			await notifyRuntimeWorkspaceStateUpdated(runtimeClient);
		}
	}
	return {
		ok: true,
		workspacePath: workspaceRepoPath,
		taskId: input.taskId,
		kind: input.kind,
		description: input.description,
		planSlug,
		revisionsPath,
		integrationTask,
		adaptationTask,
		adaptationCreated,
	};
}

async function deleteTaskCommand(input: {
	cwd: string;
	taskId?: string;
	column?: ListTaskColumn;
	projectPath?: string;
}): Promise<JsonRecord> {
	const target = resolveTaskCommandTarget(input, "task delete");
	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	const workspaceId = await ensureRuntimeWorkspace(workspaceRepoPath);
	const runtimeClient = createRuntimeTrpcClient(workspaceId);
	const mutation = await mutateWorkspaceState(workspaceRepoPath, (latestState) => {
		const latestTargetRecords =
			target.kind === "task"
				? (() => {
						const record = findTaskRecord(latestState, target.taskId);
						if (!record) {
							throw new Error(`Task "${target.taskId}" was not found in workspace ${workspaceRepoPath}.`);
						}
						return [record];
					})()
				: findTasksInColumn(latestState, target.column);

		if (latestTargetRecords.length === 0) {
			return {
				board: latestState.board,
				value: {
					deletedTaskIds: [] as string[],
					taskIdsRequiringStop: [] as string[],
					deletedTasks: [] as JsonRecord[],
				},
				save: false,
			};
		}

		const deleted = deleteTasksFromBoard(
			latestState.board,
			latestTargetRecords.map(({ task }) => task.id),
		);
		if (!deleted.deleted) {
			return {
				board: latestState.board,
				value: {
					deletedTaskIds: [] as string[],
					taskIdsRequiringStop: [] as string[],
					deletedTasks: [] as JsonRecord[],
				},
				save: false,
			};
		}

		const deletedTasks = latestTargetRecords.map(({ task, columnId }) =>
			formatTaskRecord(latestState, task, columnId),
		);
		const taskIdsRequiringStop = latestTargetRecords
			.filter(({ columnId }) => columnCanHaveLiveTaskSession(columnId))
			.map(({ task }) => task.id);
		return {
			board: deleted.board,
			value: {
				deletedTaskIds: deleted.deletedTaskIds,
				taskIdsRequiringStop,
				deletedTasks,
			},
		};
	});

	if (mutation.saved) {
		await notifyRuntimeWorkspaceStateUpdated(runtimeClient);
	}

	if (mutation.value.deletedTaskIds.length === 0) {
		return {
			ok: true,
			workspacePath: workspaceRepoPath,
			column: target.kind === "column" ? target.column : null,
			deletedTasks: [],
			count: 0,
		};
	}

	await Promise.all(
		mutation.value.taskIdsRequiringStop.map(async (taskId) => await stopTaskRuntimeSession(runtimeClient, taskId)),
	);

	const workspaceCleanupResults = await Promise.all(
		mutation.value.deletedTaskIds.map(async (taskId) => ({
			taskId,
			...(await deleteTaskWorkspace(runtimeClient, taskId)),
		})),
	);

	return {
		ok: true,
		workspacePath: workspaceRepoPath,
		column: target.kind === "column" ? target.column : null,
		deletedTasks: mutation.value.deletedTasks,
		count: mutation.value.deletedTaskIds.length,
		worktreeCleanup: workspaceCleanupResults,
	};
}

function parseOptionalBooleanOption(value: unknown, flagName: string): boolean | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (value === true || value === false) {
		return value;
	}
	if (typeof value !== "string") {
		throw new Error(`Invalid boolean value for ${flagName}. Use true or false.`);
	}
	const normalized = value.trim().toLowerCase();
	if (normalized === "true" || normalized === "1" || normalized === "yes") {
		return true;
	}
	if (normalized === "false" || normalized === "0" || normalized === "no") {
		return false;
	}
	throw new Error(`Invalid boolean value for ${flagName}: "${value}". Use true or false.`);
}

async function runTaskCommand(handler: () => Promise<JsonRecord>): Promise<void> {
	try {
		const payload = await handler();
		printJson(payload);
		if (payload.ok === false) {
			process.exitCode = 1;
		}
	} catch (error) {
		printJson({
			ok: false,
			error: `Task command failed at ${getKanbanRuntimeOrigin()}: ${toErrorMessage(error)}`,
		});
		process.exitCode = 1;
	}
}

export function registerTaskCommand(program: Command): void {
	const task = program.command("task").alias("tasks").description("Manage Kanban board tasks from the CLI.");

	task
		.command("list")
		.description("List Kanban tasks for a workspace.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.option(
			"--column <column>",
			"Filter column: backlog | planning | in_progress | review | done. trash is also accepted.",
			parseListColumn,
		)
		.action(async (options: { projectPath?: string; column?: ListTaskColumn }) => {
			await runTaskCommand(
				async () =>
					await listTasks({
						cwd: process.cwd(),
						projectPath: options.projectPath,
						column: options.column,
					}),
			);
		});

	task
		.command("create")
		.description("Create a task in backlog.")
		.option("--title <text>", "Task title.")
		.requiredOption("--prompt <text>", "Task prompt text.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.option("--base-ref <branch>", "Task base branch/ref.")
		.option("--start-in-plan-mode [value]", "Set plan mode (true|false). Flag-only implies true.")
		.option("--auto-review-enabled [value]", "Enable auto-review behavior (true|false). Flag-only implies true.")
		.option("--auto-review-mode <mode>", "Auto-review mode: commit | pr.", parseAutoReviewMode)
		.option("--agent-id <id>", "Agent override: cline | claude | codex | droid | gemini | opencode | default.")
		.option(
			"--cline-provider <id>",
			'Cline provider override (e.g. ollama, lmstudio, openai-compatible with a local endpoint). Use "default" for workspace default.',
		)
		.option(
			"--cline-model <id>",
			'Cline model override (e.g. qwen3.5:9b, llama3.1:8b). Use "default" for workspace default.',
		)
		.option(
			"--cline-reasoning-effort <level>",
			"Cline reasoning effort override: default | low | medium | high | xhigh.",
		)
		.action(
			async (options: {
				title?: string;
				prompt: string;
				projectPath?: string;
				baseRef?: string;
				startInPlanMode?: unknown;
				autoReviewEnabled?: unknown;
				autoReviewMode?: "commit" | "pr";
				agentId?: string;
				clineProvider?: string;
				clineModel?: string;
				clineReasoningEffort?: string;
			}) => {
				await runTaskCommand(
					async () =>
						await createTask({
							cwd: process.cwd(),
							title: options.title,
							prompt: options.prompt,
							projectPath: options.projectPath,
							baseRef: options.baseRef,
							startInPlanMode: parseOptionalBooleanOption(options.startInPlanMode, "--start-in-plan-mode"),
							autoReviewEnabled: parseOptionalBooleanOption(options.autoReviewEnabled, "--auto-review-enabled"),
							autoReviewMode: options.autoReviewMode,
							agentId: parseAgentId(options.agentId) ?? undefined,
							clineSettings: buildTaskClineSettingsForCreate({
								providerId: parseOptionalStringOrDefault(options.clineProvider) ?? undefined,
								modelId: parseOptionalStringOrDefault(options.clineModel) ?? undefined,
								reasoningEffort: parseTaskClineReasoningEffort(options.clineReasoningEffort),
							}),
						}),
				);
			},
		);

	task
		.command("update")
		.description("Update an existing task.")
		.requiredOption("--task-id <id>", "Task ID.")
		.option("--title <text>", "Replacement task title.")
		.option("--prompt <text>", "Replacement task prompt.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.option("--base-ref <branch>", "Replacement base branch/ref.")
		.option("--start-in-plan-mode [value]", "Set plan mode (true|false). Flag-only implies true.")
		.option("--auto-review-enabled [value]", "Enable auto-review behavior (true|false). Flag-only implies true.")
		.option("--auto-review-mode <mode>", "Auto-review mode: commit | pr.", parseAutoReviewMode)
		.option(
			"--agent-id <id>",
			'Agent override: cline | claude | codex | droid | gemini | opencode. Use "default" to clear.',
		)
		.option(
			"--cline-provider <id>",
			'Cline provider override (e.g. ollama, lmstudio, openai-compatible with a local endpoint). Use "default" to clear.',
		)
		.option("--cline-model <id>", 'Cline model override (e.g. qwen3.5:9b, llama3.1:8b). Use "default" to clear.')
		.option(
			"--cline-reasoning-effort <level>",
			'Cline reasoning effort override: default | low | medium | high | xhigh. Use "inherit" to clear.',
		)
		.action(
			async (options: {
				taskId: string;
				title?: string;
				prompt?: string;
				projectPath?: string;
				baseRef?: string;
				startInPlanMode?: unknown;
				autoReviewEnabled?: unknown;
				autoReviewMode?: "commit" | "pr";
				agentId?: string;
				clineProvider?: string;
				clineModel?: string;
				clineReasoningEffort?: string;
			}) => {
				await runTaskCommand(
					async () =>
						await updateTaskCommand({
							cwd: process.cwd(),
							taskId: options.taskId,
							title: options.title,
							projectPath: options.projectPath,
							prompt: options.prompt,
							baseRef: options.baseRef,
							startInPlanMode: parseOptionalBooleanOption(options.startInPlanMode, "--start-in-plan-mode"),
							autoReviewEnabled: parseOptionalBooleanOption(options.autoReviewEnabled, "--auto-review-enabled"),
							autoReviewMode: options.autoReviewMode,
							agentId: parseAgentId(options.agentId),
							clineProviderId: parseOptionalStringOrDefault(options.clineProvider),
							clineModelId: parseOptionalStringOrDefault(options.clineModel),
							clineReasoningEffort: parseTaskClineReasoningEffort(options.clineReasoningEffort),
						}),
				);
			},
		);

	task
		.command("merge")
		.description("Merge reviewed task worktrees into the base worktree in dependency order.")
		.option("--task-id <id>", "Single task ID to merge.")
		.option("--column <column>", "Column to merge: review | completed. Defaults to review.", parseAutoMergeColumn)
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.action(async (options: { taskId?: string; column?: TaskWorktreeAutoMergeColumn; projectPath?: string }) => {
			await runTaskCommand(
				async () =>
					await mergeTaskWorktreesCommand({
						cwd: process.cwd(),
						taskId: options.taskId,
						column: options.column ?? "review",
						projectPath: options.projectPath,
					}),
			);
		});

	task
		.command("swarm-stop")
		.description("Set the workspace swarm stop signal so project task starts are blocked until resumed.")
		.option("--reason <text>", "Reason shown to blocked task starts.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.action(async (options: { reason?: string; projectPath?: string }) => {
			await runTaskCommand(
				async () =>
					await requestTaskSwarmStopCommand({
						cwd: process.cwd(),
						projectPath: options.projectPath,
						reason: options.reason,
					}),
			);
		});

	task
		.command("swarm-resume")
		.description("Clear the workspace swarm stop signal so project task starts can run again.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.action(async (options: { projectPath?: string }) => {
			await runTaskCommand(
				async () =>
					await clearTaskSwarmStopCommand({
						cwd: process.cwd(),
						projectPath: options.projectPath,
					}),
			);
		});

	task
		.command("plan-gap")
		.description("Record a structured plan gap discovered while executing a task.")
		.requiredOption("--task-id <id>", "Task ID that discovered the gap.")
		.requiredOption(
			"--kind <kind>",
			"Gap kind: missing_decision | contradictory_requirement | missing_dependency | scope_too_large | integration_needed | other.",
			parsePlanGapKind,
		)
		.requiredOption("--description <text>", "Plain-language description of the blocking gap.")
		.option("--evidence <text>", "Optional evidence such as error text, missing path, or conflicting requirement.")
		.option(
			"--plan-slug <slug>",
			"Optional saved plan slug whose revisions.md should record this gap; inferred for decomposition-created task IDs when omitted.",
		)
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.action(
			async (options: {
				taskId: string;
				kind: PlanGapKind;
				description: string;
				evidence?: string;
				planSlug?: string;
				projectPath?: string;
			}) => {
				await runTaskCommand(
					async () =>
						await recordTaskPlanGapCommand({
							cwd: process.cwd(),
							projectPath: options.projectPath,
							taskId: options.taskId,
							kind: options.kind,
							description: options.description,
							evidence: options.evidence,
							planSlug: options.planSlug,
						}),
				);
			},
		);

	task
		.command("done")
		.description("Move a task or an entire column to completed and clean up task workspaces.")
		.option("--task-id <id>", "Task ID.")
		.option(
			"--column <column>",
			"Column to move to completed: backlog | planning | in_progress | review | done. trash is also accepted.",
			parseListColumn,
		)
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.action(async (options: { taskId?: string; column?: ListTaskColumn; projectPath?: string }) => {
			await runTaskCommand(
				async () =>
					await finishTask({
						cwd: process.cwd(),
						taskId: options.taskId,
						column: options.column,
						targetColumn: "completed",
						projectPath: options.projectPath,
					}),
			);
		});

	task
		.command("trash")
		.description("Move a task or an entire column to trash and clean up task workspaces.")
		.option("--task-id <id>", "Task ID.")
		.option(
			"--column <column>",
			"Column to move to trash: backlog | planning | in_progress | review | completed | done. trash is also accepted.",
			parseListColumn,
		)
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.action(async (options: { taskId?: string; column?: ListTaskColumn; projectPath?: string }) => {
			await runTaskCommand(
				async () =>
					await finishTask({
						cwd: process.cwd(),
						taskId: options.taskId,
						column: options.column,
						targetColumn: "trash",
						projectPath: options.projectPath,
					}),
			);
		});

	task
		.command("delete")
		.description("Permanently delete a task or every task in a column.")
		.option("--task-id <id>", "Task ID to permanently delete.")
		.option(
			"--column <column>",
			"Column to bulk-delete: backlog | planning | in_progress | review | done. trash is also accepted.",
			parseListColumn,
		)
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.action(async (options: { taskId?: string; column?: ListTaskColumn; projectPath?: string }) => {
			await runTaskCommand(
				async () =>
					await deleteTaskCommand({
						cwd: process.cwd(),
						taskId: options.taskId,
						column: options.column,
						projectPath: options.projectPath,
					}),
			);
		});

	task
		.command("link")
		.description("Link two tasks so one task waits on another.")
		.requiredOption("--task-id <id>", "One of the two task IDs to link.")
		.requiredOption("--linked-task-id <id>", "The other task ID to link.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.addHelpText(
			"after",
			[
				"",
				"Dependency direction:",
				"  If both linked tasks are in backlog, Kanban preserves the order you pass:",
				"  --task-id waits on --linked-task-id, and on the board the arrow points into",
				"  --linked-task-id.",
				"  Once only one linked task remains in backlog, Kanban reorients the saved link",
				"  so the backlog task is the waiting dependent task and the other task is the",
				"  prerequisite.",
				"  When the prerequisite finishes review and moves to done, the waiting backlog",
				"  task becomes ready to start.",
				"",
			].join("\n"),
		)
		.action(async (options: { taskId: string; linkedTaskId: string; projectPath?: string }) => {
			await runTaskCommand(
				async () =>
					await linkTasks({
						cwd: process.cwd(),
						taskId: options.taskId,
						linkedTaskId: options.linkedTaskId,
						projectPath: options.projectPath,
					}),
			);
		});

	task
		.command("decompose")
		.description("Create backlog tasks and dependency links from a saved Cline plan task graph.")
		.requiredOption("--slug <slug>", "Plan slug under .cline/kanban/plans/<slug>.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.option("--base-ref <branch>", "Task base branch/ref. Defaults to the workspace branch.")
		.action(async (options: { slug: string; projectPath?: string; baseRef?: string }) => {
			await runTaskCommand(
				async () =>
					await decomposeTaskGraph({
						cwd: process.cwd(),
						slug: options.slug,
						projectPath: options.projectPath,
						baseRef: options.baseRef,
					}),
			);
		});

	task
		.command("verify")
		.description("Run the task's embedded Acceptance check in its task worktree.")
		.requiredOption("--task-id <id>", "Task ID.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.option("--workspace-root", "Run the acceptance check in the workspace root instead of the task worktree.")
		.option("--ensure-worktree", "Create the task worktree first if it is missing.")
		.option("--timeout-ms <ms>", "Acceptance command timeout in milliseconds.", (value: string) => {
			const timeoutMs = Number(value);
			if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
				throw new Error("Invalid timeout. Expected a positive integer number of milliseconds.");
			}
			return timeoutMs;
		})
		.option("--repair-attempt <n>", "Repair attempt number to include in failure guidance.", (value: string) => {
			const attempt = Number(value);
			if (!Number.isInteger(attempt) || attempt <= 0) {
				throw new Error("Invalid repair attempt. Expected a positive integer.");
			}
			return attempt;
		})
		.option("--max-repair-attempts <n>", "Maximum repair attempts before escalation guidance.", (value: string) => {
			const maxAttempts = Number(value);
			if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
				throw new Error("Invalid max repair attempts. Expected a positive integer.");
			}
			return maxAttempts;
		})
		.action(
			async (options: {
				taskId: string;
				projectPath?: string;
				workspaceRoot?: boolean;
				ensureWorktree?: boolean;
				timeoutMs?: number;
				repairAttempt?: number;
				maxRepairAttempts?: number;
			}) => {
				await runTaskCommand(
					async () =>
						await runVerifyTaskAcceptanceCommand({
							cwd: process.cwd(),
							taskId: options.taskId,
							projectPath: options.projectPath,
							workspaceRoot: options.workspaceRoot === true,
							ensureWorktree: options.ensureWorktree === true,
							timeoutMs: options.timeoutMs,
							repairAttempt: options.repairAttempt,
							maxRepairAttempts: options.maxRepairAttempts,
						}),
				);
			},
		);

	task
		.command("unlink")
		.description("Remove an existing dependency link.")
		.requiredOption("--dependency-id <id>", "Dependency ID.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.action(async (options: { dependencyId: string; projectPath?: string }) => {
			await runTaskCommand(
				async () =>
					await unlinkTasks({
						cwd: process.cwd(),
						dependencyId: options.dependencyId,
						projectPath: options.projectPath,
					}),
			);
		});

	task
		.command("start")
		.description("Start a task session and move task to Planning or In Progress.")
		.requiredOption("--task-id <id>", "Task ID.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.action(async (options: { taskId: string; projectPath?: string }) => {
			await runTaskCommand(
				async () =>
					await startTask({
						cwd: process.cwd(),
						taskId: options.taskId,
						projectPath: options.projectPath,
					}),
			);
		});
}
