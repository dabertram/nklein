import { readdir } from "node:fs/promises";
import { join } from "node:path";

import type { Command } from "commander";
import { loadRuntimeConfig } from "../config/runtime-config";
import type {
	RuntimeAgentId,
	RuntimeBoardColumnId,
	RuntimeTaskAcceptanceVerifyRequest,
	RuntimeTaskAcceptanceVerifyResponse,
	RuntimeTaskNKleinSettings,
	RuntimeWorkspaceStateResponse,
} from "../core/api-contract";
import { clampRuntimeSwarmCardStartBatchSize } from "../core/api-contract";
import { type PlanGapKind, recordPlanGap } from "../core/plan-gap";
import { getKanbanRuntimeOrigin } from "../core/runtime-endpoint";
import {
	addTaskToColumn,
	completeTaskAndGetReadyLinkedTaskIds,
	deleteTasksFromBoard,
	getTaskColumnId,
	moveTaskToColumn,
	trashTaskAndGetReadyLinkedTaskIds,
	updateTask,
} from "../core/task-board-mutations";
import { findActiveTaskLikelyTouchedFileOverlap } from "../core/task-file-overlap";
import { buildNKleinAcceptanceRepairPlan } from "../nklein-agent/nklein-acceptance-repair";
import {
	applyNKleinPlanTaskGraphToBoard,
	applyNKleinPlanTaskReplacementArtifacts,
} from "../nklein-agent/nklein-decomposition-tool";
import {
	appendNKleinPlanRevision,
	type NKleinPlanTask,
	nkleinPlanTaskSchema,
	readNKleinPlanArtifacts,
	updateNKleinPlanArtifactApplicationStatus,
} from "../nklein-agent/nklein-plan-artifacts";
import { loadWorkspaceState, mutateWorkspaceState } from "../state/workspace-state";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import {
	mergeTaskWorktreesInDependencyOrder,
	type TaskWorktreeAutoMergeColumn,
	type TaskWorktreeAutoMergeConflict,
	type TaskWorktreeAutoMergeStep,
} from "../workspace/task-worktree-auto-merge";
import { classifyAcceptanceFailurePlanGap, parsePlanGapKind } from "./task/task-acceptance-plan-gap.js";
import { printJson, toErrorMessage } from "./task/task-command-output.js";
import {
	parseAgentId,
	parseAutoMergeColumn,
	parseAutoReviewMode,
	parseOptionalStringOrDefault,
	slugifyPlanTaskId,
} from "./task/task-command-parsers.js";
import type { ListTaskColumn } from "./task/task-command-types.js";
import { buildDecompositionRoutingCandidates } from "./task/task-decomposition-routing.js";
import { linkTasks, unlinkTasks } from "./task/task-dependency-commands.js";
import {
	buildTaskNKleinSettingsForCreate,
	buildTaskNKleinSettingsForUpdate,
	formatTaskNKleinSettings,
	type ParsedTaskNKleinReasoningEffort,
	parseTaskNKleinReasoningEffort,
} from "./task/task-nklein-settings.js";
import {
	addPlanGapDecisionCardToBoard,
	addPlanGapIntegrationCardToBoard,
	addPlanGapScopeCardToBoard,
	markTaskNeedsDecompositionOnBoard,
} from "./task/task-plan-gap-cards.js";
import {
	buildIntegrationCardPrompt,
	buildPlanGapAdaptationRevision,
	buildPlanGapIntegrationRevision,
} from "./task/task-plan-gap-prompts.js";
import { listTasks, reportBoardHealth } from "./task/task-read-commands.js";
import {
	findTaskRecord,
	findTasksInColumn,
	formatDependencyRecord,
	formatTaskRecord,
	parseListColumn,
	resolveTaskCommandTarget,
} from "./task/task-record-format.js";
import { deleteTaskWorkspace, stopTaskRuntimeSession } from "./task/task-runtime-actions.js";
import {
	createRuntimeTrpcClient,
	ensureRuntimeWorkspace,
	notifyRuntimeWorkspaceStateUpdated,
	resolveTaskBaseRef,
	resolveWorkspaceRepoPath,
	updateRuntimeWorkspaceState,
} from "./task/task-runtime-workspace.js";
import { clearTaskSwarmStopCommand, requestTaskSwarmStopCommand } from "./task/task-swarm-commands.js";

type JsonRecord = Record<string, unknown>;
type RecordSelfObservation = typeof recordSelfObservation;

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

interface RuntimeTaskAcceptanceVerifyMutationClient {
	runtime: {
		verifyTaskAcceptance: {
			mutate: (input: RuntimeTaskAcceptanceVerifyRequest) => Promise<RuntimeTaskAcceptanceVerifyResponse>;
		};
	};
}

interface VerifyTaskAcceptanceDependencies {
	resolveWorkspaceRepoPath?: typeof resolveWorkspaceRepoPath;
	loadWorkspaceState?: typeof loadWorkspaceState;
	ensureRuntimeWorkspace?: typeof ensureRuntimeWorkspace;
	createRuntimeTrpcClient?: (workspaceId: string | null) => RuntimeTaskAcceptanceVerifyMutationClient;
	loadRuntimeConfig?: typeof loadRuntimeConfig;
	recordPlanGap?: typeof recordPlanGap;
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
	nkleinSettings?: RuntimeTaskNKleinSettings;
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
				nkleinSettings: input.nkleinSettings,
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
			...formatTaskNKleinSettings(created.nkleinSettings),
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
	nkleinProviderId?: string | null;
	nkleinModelId?: string | null;
	nkleinReasoningEffort?: ParsedTaskNKleinReasoningEffort;
}): Promise<JsonRecord> {
	if (
		input.title === undefined &&
		input.prompt === undefined &&
		input.baseRef === undefined &&
		input.startInPlanMode === undefined &&
		input.autoReviewEnabled === undefined &&
		input.autoReviewMode === undefined &&
		input.agentId === undefined &&
		input.nkleinProviderId === undefined &&
		input.nkleinModelId === undefined &&
		input.nkleinReasoningEffort === undefined
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
		const nextTaskNKleinSettings = buildTaskNKleinSettingsForUpdate(taskRecord.task.nkleinSettings, {
			providerId: input.nkleinProviderId,
			modelId: input.nkleinModelId,
			reasoningEffort: input.nkleinReasoningEffort,
		});

		const updatedTask = updateTask(runtimeState.board, input.taskId, {
			title: input.title ?? taskRecord.task.title,
			prompt: input.prompt ?? taskRecord.task.prompt,
			baseRef: input.baseRef ?? taskRecord.task.baseRef,
			startInPlanMode: input.startInPlanMode ?? taskRecord.task.startInPlanMode,
			autoReviewEnabled: input.autoReviewEnabled ?? taskRecord.task.autoReviewEnabled === true,
			autoReviewMode: input.autoReviewMode ?? taskRecord.task.autoReviewMode ?? "commit",
			agentId: input.agentId,
			nkleinSettings: nextTaskNKleinSettings,
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

async function decomposeTaskGraph(input: {
	cwd: string;
	slug: string;
	projectPath?: string;
	baseRef?: string;
}): Promise<JsonRecord> {
	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	const workspaceId = await ensureRuntimeWorkspace(workspaceRepoPath);
	const runtimeClient = createRuntimeTrpcClient(workspaceId);
	const artifacts = await readNKleinPlanArtifacts(workspaceRepoPath, input.slug);
	const runtimeConfig = await loadRuntimeConfig(workspaceRepoPath);
	const routingCandidates = await buildDecompositionRoutingCandidates(runtimeConfig);
	let applied: {
		createdTasks: JsonRecord[];
		createdDependencies: JsonRecord[];
		taskIdByPlanTaskId: Record<string, string>;
		preview: JsonRecord;
	};
	try {
		applied = await updateRuntimeWorkspaceState(runtimeClient, workspaceRepoPath, (runtimeState) => {
			const resolvedBaseRef = (input.baseRef ?? "").trim() || resolveTaskBaseRef(runtimeState);
			if (!resolvedBaseRef) {
				throw new Error("Could not determine task base branch for this workspace.");
			}
			const result = applyNKleinPlanTaskGraphToBoard({
				board: runtimeState.board,
				taskGraph: artifacts.taskGraph,
				baseRef: resolvedBaseRef,
				randomUuid: () => globalThis.crypto.randomUUID(),
				modelRoleSettings: runtimeConfig.effectiveModelRoles,
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
					preview: result.preview as unknown as JsonRecord,
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
	await updateNKleinPlanArtifactApplicationStatus({
		workspacePath: workspaceRepoPath,
		slug: artifacts.taskGraph.slug,
		applicationStatus: "applied",
	});

	return {
		ok: true,
		workspacePath: workspaceRepoPath,
		plan: {
			artifactId: artifacts.artifactId,
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
		preview: applied.preview,
		count: applied.createdTasks.length,
	};
}

function parseReplacementTasksJson(value: string): NKleinPlanTask[] {
	const parsed: unknown = JSON.parse(value);
	return nkleinPlanTaskSchema.array().parse(parsed);
}

export async function expandSavedPlanTaskCommand(input: {
	cwd: string;
	projectPath?: string;
	planSlug: string;
	taskId: string;
	replacementsJson: string;
	description?: string;
	evidence?: string;
}): Promise<JsonRecord> {
	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd, {
		autoCreateIfMissing: false,
	});
	const replacements = parseReplacementTasksJson(input.replacementsJson);
	const result = await applyNKleinPlanTaskReplacementArtifacts({
		workspacePath: workspaceRepoPath,
		slug: input.planSlug,
		taskId: input.taskId,
		replacements,
		description: input.description,
		evidence: input.evidence,
	});
	return {
		ok: true,
		workspacePath: workspaceRepoPath,
		planSlug: input.planSlug,
		taskId: input.taskId,
		taskGraphPath: result.taskGraphPath,
		revisionsPath: result.revisionsPath,
		replacementTaskIds: result.replacementTaskIds,
		entryTaskIds: result.entryTaskIds,
		terminalTaskIds: result.terminalTaskIds,
		taskCount: result.taskGraph.tasks.length,
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

	// Acceptance always runs in the task's Docker sandbox via the runtime (the worktree-backed host gate is
	// retired, §5.A); `--workspace-root` referred to a host checkout that no longer exists.
	if (input.workspaceRoot) {
		throw new Error("--workspace-root is not available for sandboxed task verification.");
	}
	const workspaceId = await (deps.ensureRuntimeWorkspace ?? ensureRuntimeWorkspace)(workspaceRepoPath);
	const runtimeClient = (deps.createRuntimeTrpcClient ?? createRuntimeTrpcClient)(workspaceId);
	const response = await runtimeClient.runtime.verifyTaskAcceptance.mutate({
		taskId: input.taskId,
		...(input.ensureWorktree === true ? { ensureWorktree: true } : {}),
		...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
	});
	const taskWorkspacePath: string | null = response.taskWorkspacePath;
	const result = response.acceptance;

	const ok = result.present === true && result.passed === true;
	const repair = ok
		? null
		: buildNKleinAcceptanceRepairPlan({
				taskId: input.taskId,
				taskTitle: taskRecord.task.title,
				taskPrompt: taskRecord.task.prompt,
				acceptance: result,
				attempt: input.repairAttempt ?? 1,
				maxAttempts: input.maxRepairAttempts,
				modelRoles: (await (deps.loadRuntimeConfig ?? loadRuntimeConfig)(workspaceRepoPath)).effectiveModelRoles,
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
		taskWorkspacePath: taskWorkspacePath ?? (input.workspaceRoot ? workspaceRepoPath : null),
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
	if (fromColumnId !== "backlog" && fromColumnId !== "planning" && fromColumnId !== activeColumnId) {
		throw new Error(
			`Task "${input.taskId}" is in "${fromColumnId}" and can only be started from backlog, planning, or ${activeColumnId}.`,
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
		// Native NKlein tasks start in their Docker sandbox — no host workspace to prepare (worktrees retired, §5.A).
		const started = await runtimeClient.runtime.startTaskSession.mutate({
			taskId: task.id,
			prompt: task.prompt,
			taskTitle: task.title,
			startInPlanMode: task.startInPlanMode,
			baseRef: task.baseRef,
			agentId: task.agentId,
			nkleinSettings: task.nkleinSettings,
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
				? `Task result merged: ${step.taskId}`
				: step.type === "skipped"
					? `Task result merge skipped: ${step.taskId}`
					: step.type === "conflict"
						? `Task result merge conflict: ${step.taskId}`
						: `Task result merge blocked: ${step.reason}`;
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
		: { removed: false, error: "Task workspace kept because auto-merge did not complete." };

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

export async function inferNKleinPlanSlugForTask(input: {
	workspacePath: string;
	taskId: string;
}): Promise<string | null> {
	const plansRoot = join(input.workspacePath, ".nklein", "nklein", "plans");
	const entries = await readdir(plansRoot, { withFileTypes: true }).catch(() => []);
	const matches: { slug: string; exact: boolean }[] = [];
	for (const entry of entries
		.filter((candidate) => candidate.isDirectory())
		.sort((left, right) => left.name.localeCompare(right.name))) {
		const artifacts = await readNKleinPlanArtifacts(input.workspacePath, entry.name).catch(() => null);
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
				agentId: "nklein",
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
		(await inferNKleinPlanSlugForTask({
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
		? await appendNKleinPlanRevision({
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
			revisionsPath = await appendNKleinPlanRevision({
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
		const adaptationTaskId = typeof adaptationTask.id === "string" ? adaptationTask.id : null;
		if (adaptationTaskId && planSlug && adaptationCreated) {
			const revision = buildPlanGapAdaptationRevision({
				taskId: input.taskId,
				adaptationTaskId,
				kind: input.kind,
				description: input.description,
				evidence: input.evidence,
			});
			revisionsPath = await appendNKleinPlanRevision({
				workspacePath: workspaceRepoPath,
				slug: planSlug,
				taskId: input.taskId,
				kind: revision.kind,
				description: revision.description,
				evidence: revision.evidence ?? undefined,
			});
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
			...(await deleteTaskWorkspace(runtimeClient, taskId, { preserveChanges: false })),
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
	const task = program.command("task").alias("tasks").description("Manage !Klein board tasks from the CLI.");

	task
		.command("list")
		.description("List !Klein tasks for a workspace.")
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
		.command("health")
		.description("Show the operator board-health rollup (healthy/stuck/risky/done) and the risk/approval inbox.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.action(async (options: { projectPath?: string }) => {
			await runTaskCommand(
				async () => await reportBoardHealth({ cwd: process.cwd(), projectPath: options.projectPath }),
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
		.option("--agent-id <id>", "Agent override: nklein | claude | codex | droid | gemini | opencode | default.")
		.option(
			"--nklein-provider <id>",
			'!Klein provider override (e.g. ollama, lmstudio, openai-compatible with a local endpoint). Use "default" for workspace default.',
		)
		.option(
			"--nklein-model <id>",
			'!Klein model override (e.g. qwen3.5:9b, llama3.1:8b). Use "default" for workspace default.',
		)
		.option(
			"--nklein-reasoning-effort <level>",
			"!Klein reasoning effort override: default | low | medium | high | xhigh.",
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
				nkleinProvider?: string;
				nkleinModel?: string;
				nkleinReasoningEffort?: string;
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
							nkleinSettings: buildTaskNKleinSettingsForCreate({
								providerId: parseOptionalStringOrDefault(options.nkleinProvider) ?? undefined,
								modelId: parseOptionalStringOrDefault(options.nkleinModel) ?? undefined,
								reasoningEffort: parseTaskNKleinReasoningEffort(options.nkleinReasoningEffort),
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
			'Agent override: nklein | claude | codex | droid | gemini | opencode. Use "default" to clear.',
		)
		.option(
			"--nklein-provider <id>",
			'!Klein provider override (e.g. ollama, lmstudio, openai-compatible with a local endpoint). Use "default" to clear.',
		)
		.option("--nklein-model <id>", '!Klein model override (e.g. qwen3.5:9b, llama3.1:8b). Use "default" to clear.')
		.option(
			"--nklein-reasoning-effort <level>",
			'!Klein reasoning effort override: default | low | medium | high | xhigh. Use "inherit" to clear.',
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
				nkleinProvider?: string;
				nkleinModel?: string;
				nkleinReasoningEffort?: string;
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
							nkleinProviderId: parseOptionalStringOrDefault(options.nkleinProvider),
							nkleinModelId: parseOptionalStringOrDefault(options.nkleinModel),
							nkleinReasoningEffort: parseTaskNKleinReasoningEffort(options.nkleinReasoningEffort),
						}),
				);
			},
		);

	task
		.command("merge")
		.description("Merge reviewed task results into the base workspace in dependency order.")
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
		.command("expand-plan-task")
		.description("Apply approved replacement tasks to a saved plan DAG and re-link dependencies.")
		.requiredOption("--plan-slug <slug>", "Saved plan slug under .nklein/nklein/plans/<slug>.")
		.requiredOption("--task-id <id>", "Plan task ID to replace.")
		.requiredOption(
			"--replacements-json <json>",
			"JSON array of replacement plan tasks, usually copied from a validated expand_task result.",
		)
		.option("--description <text>", "Revision description. Defaults to a generated replacement summary.")
		.option("--evidence <text>", "Revision evidence. Defaults to entry/terminal replacement IDs.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.action(
			async (options: {
				planSlug: string;
				taskId: string;
				replacementsJson: string;
				description?: string;
				evidence?: string;
				projectPath?: string;
			}) => {
				await runTaskCommand(
					async () =>
						await expandSavedPlanTaskCommand({
							cwd: process.cwd(),
							projectPath: options.projectPath,
							planSlug: options.planSlug,
							taskId: options.taskId,
							replacementsJson: options.replacementsJson,
							description: options.description,
							evidence: options.evidence,
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
				"  If both linked tasks are in backlog, !Klein preserves the order you pass:",
				"  --task-id waits on --linked-task-id, and on the board the arrow points into",
				"  --linked-task-id.",
				"  Once only one linked task remains in backlog, !Klein reorients the saved link",
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
		.description("Create backlog tasks and dependency links from a saved !Klein plan task graph.")
		.requiredOption("--slug <slug>", "Plan slug under .nklein/nklein/plans/<slug>.")
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
		.description("Run the task's embedded Acceptance check in its task workspace.")
		.requiredOption("--task-id <id>", "Task ID.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.option("--workspace-root", "Run the acceptance check in the workspace root instead of the task workspace.")
		.option("--ensure-worktree", "Prepare the task workspace first if it is missing.")
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
