import { randomUUID } from "node:crypto";
import type { AgentTool } from "@clinebot/shared";
import { z } from "zod";
import { loadRuntimeConfig } from "../config/runtime-config";
import type {
	RuntimeBoardCard,
	RuntimeBoardData,
	RuntimeBoardDependency,
	RuntimeTaskClineSettings,
} from "../core/api-contract";
import { addTaskDependency, addTaskToColumn } from "../core/task-board-mutations";
import { mutateWorkspaceState } from "../state/workspace-state";
import {
	type ClinePlanQuestion,
	type ClinePlanTask,
	type ClinePlanTaskGraph,
	clinePlanQuestionSchema,
	clinePlanTaskGraphSchema,
	clinePlanTaskSchema,
	writeClinePlanArtifacts,
} from "./cline-plan-artifacts";
import { type ClineTaskRoutingCandidate, routeClineTask } from "./cline-task-router";
import {
	estimateClineStartDifficulty,
	estimateClineStartFitBudgetTokens,
	estimateClineStartPromptTokens,
	formatClineTaskRoutingBlockMessage,
} from "./cline-task-start-guard";

const MAX_DECOMPOSED_TASK_COMPLEXITY = 75;
const MAX_DECOMPOSED_TASK_LIKELY_FILES = 3;
const MAX_DECOMPOSED_TASK_EXPANSION_DEPTH = 4;

export interface ApplyClinePlanTaskGraphInput {
	board: RuntimeBoardData;
	taskGraph: ClinePlanTaskGraph;
	baseRef: string;
	randomUuid: () => string;
	modelRoleSettings?: Record<string, RuntimeTaskClineSettings>;
	routingCandidates?: readonly ClineTaskRoutingCandidate[];
	now?: number;
}

export interface ApplyClinePlanTaskGraphResult {
	board: RuntimeBoardData;
	createdTasks: RuntimeBoardCard[];
	createdDependencies: RuntimeBoardDependency[];
	taskIdByPlanTaskId: Record<string, string>;
}

export interface ValidateClinePlanTaskGraphResult {
	taskGraph: ClinePlanTaskGraph;
	taskCount: number;
	dependencyCount: number;
}

export interface ApplyDecomposeProjectArtifactsResult {
	applied: boolean;
	createdTaskCount: number;
	createdDependencyCount: number;
	taskIdByPlanTaskId: Record<string, string>;
	baseRef: string | null;
	message: string;
}

function pluralizeCount(count: number, singular: string, plural = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

const decomposeProjectToolInputSchema = clinePlanTaskGraphSchema
	.pick({
		title: true,
		tasks: true,
	})
	.extend({
		slug: clinePlanTaskGraphSchema.shape.slug,
		spec: clinePlanTaskSchema.shape.prompt.describe("Concise requirements markdown."),
		plan: clinePlanTaskSchema.shape.prompt.describe("Implementation plan markdown."),
		summary: clinePlanTaskSchema.shape.prompt.optional().describe("Plain-language plan summary markdown."),
		questions: z.array(clinePlanQuestionSchema).optional(),
		defaultAcceptanceCommand: clinePlanTaskSchema.shape.acceptanceCommand.optional(),
		expansions: z.record(z.string(), z.array(clinePlanTaskSchema)).optional(),
	});
type DecomposeProjectToolInput = {
	slug: string;
	spec: string;
	plan: string;
	summary: string | null;
	questions: ClinePlanQuestion[];
	title: string;
	tasks: ClinePlanTask[];
	taskGraph: ClinePlanTaskGraph;
	defaultAcceptanceCommand?: string | null;
	expansions: Record<string, ClinePlanTask[]>;
};

function slugifyTaskId(input: string): string {
	const slug = input
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || "task";
}

function buildTaskPrompt(task: ClinePlanTask): string {
	const sections = [task.prompt.trim()];
	if (task.filesLikelyTouched.length > 0) {
		sections.push(["Likely files:", ...task.filesLikelyTouched.map((path) => `- ${path}`)].join("\n"));
	}
	if (task.acceptanceCommand) {
		sections.push(`Acceptance check: ${task.acceptanceCommand}`);
	}
	if (task.testFirst) {
		const testInstructions = ["Test-first: write or update the acceptance test before implementation."];
		if (task.acceptanceTestPrompt?.trim()) {
			testInstructions.push(task.acceptanceTestPrompt.trim());
		}
		sections.push(testInstructions.join("\n"));
	}
	sections.push(`Complexity: ${Math.round(task.complexity)}/100`);
	if (task.suggestedRole) {
		sections.push(`Suggested role: ${task.suggestedRole}`);
	}
	return sections.join("\n\n");
}

function uniqStrings(values: readonly string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function normalizeTaskAcceptanceCommand(task: ClinePlanTask, defaultAcceptanceCommand: string | null): ClinePlanTask {
	return {
		...task,
		acceptanceCommand: task.acceptanceCommand?.trim() || defaultAcceptanceCommand,
		dependsOn: uniqStrings(task.dependsOn),
	};
}

interface ExpandedTaskReplacement {
	entryTaskIds: string[];
	terminalTaskIds: string[];
}

interface ExpandedTaskResult extends ExpandedTaskReplacement {
	tasks: ClinePlanTask[];
}

function expandDecomposeProjectTasks(input: {
	tasks: ClinePlanTask[];
	expansions: Record<string, ClinePlanTask[]>;
	defaultAcceptanceCommand: string | null;
	maxDepth?: number;
}): ClinePlanTask[] {
	const maxDepth = input.maxDepth ?? MAX_DECOMPOSED_TASK_EXPANSION_DEPTH;
	const replacementByTaskId = new Map<string, ExpandedTaskReplacement>();
	const usedExpansionTaskIds = new Set<string>();
	const visitingTaskIds = new Set<string>();

	const expandTask = (task: ClinePlanTask, depth: number): ExpandedTaskResult => {
		const normalizedTask = normalizeTaskAcceptanceCommand(task, input.defaultAcceptanceCommand);
		const replacementTasks = input.expansions[normalizedTask.id];
		if (!replacementTasks) {
			return {
				tasks: [normalizedTask],
				entryTaskIds: [normalizedTask.id],
				terminalTaskIds: [normalizedTask.id],
			};
		}
		if (replacementTasks.length === 0) {
			throw new Error(`Expansion for task ${normalizedTask.id} must include at least one replacement task.`);
		}
		if (depth >= maxDepth) {
			throw new Error(
				`Task ${normalizedTask.id} exceeds the recursive expansion depth limit of ${maxDepth}; escalate instead of splitting indefinitely.`,
			);
		}
		if (visitingTaskIds.has(normalizedTask.id)) {
			throw new Error(`Recursive expansion cycle detected at task ${normalizedTask.id}.`);
		}
		usedExpansionTaskIds.add(normalizedTask.id);
		visitingTaskIds.add(normalizedTask.id);
		const childResults = replacementTasks.map((replacementTask) => expandTask(replacementTask, depth + 1));
		visitingTaskIds.delete(normalizedTask.id);

		const childTasks = childResults.flatMap((result) => result.tasks);
		const childTaskIds = new Set(childTasks.map((childTask) => childTask.id));
		const dependedOnByChildTaskIds = new Set<string>();
		for (const childTask of childTasks) {
			for (const dependencyTaskId of childTask.dependsOn) {
				if (childTaskIds.has(dependencyTaskId)) {
					dependedOnByChildTaskIds.add(dependencyTaskId);
				}
			}
		}
		const entryTaskIds = childTasks
			.filter((childTask) => !childTask.dependsOn.some((dependencyTaskId) => childTaskIds.has(dependencyTaskId)))
			.map((childTask) => childTask.id);
		const terminalTaskIds = childTasks
			.filter((childTask) => !dependedOnByChildTaskIds.has(childTask.id))
			.map((childTask) => childTask.id);
		if (entryTaskIds.length === 0 || terminalTaskIds.length === 0) {
			throw new Error(`Expansion for task ${normalizedTask.id} must be an acyclic replacement graph.`);
		}
		const entryTaskIdSet = new Set(entryTaskIds);
		const tasksWithInheritedDependencies = childTasks.map((childTask) =>
			entryTaskIdSet.has(childTask.id)
				? {
						...childTask,
						dependsOn: uniqStrings([...normalizedTask.dependsOn, ...childTask.dependsOn]),
					}
				: childTask,
		);
		replacementByTaskId.set(normalizedTask.id, {
			entryTaskIds,
			terminalTaskIds,
		});
		return {
			tasks: tasksWithInheritedDependencies,
			entryTaskIds,
			terminalTaskIds,
		};
	};

	const expandedTasks = input.tasks.flatMap((task) => expandTask(task, 0).tasks);
	const unknownExpansionTaskIds = Object.keys(input.expansions).filter((taskId) => !usedExpansionTaskIds.has(taskId));
	if (unknownExpansionTaskIds.length > 0) {
		throw new Error(`Expansion references unknown task id ${unknownExpansionTaskIds[0]}.`);
	}
	return expandedTasks.map((task) => ({
		...task,
		dependsOn: uniqStrings(
			task.dependsOn.flatMap(
				(dependencyTaskId) => replacementByTaskId.get(dependencyTaskId)?.terminalTaskIds ?? [dependencyTaskId],
			),
		).filter((dependencyTaskId) => dependencyTaskId !== task.id),
	}));
}

function validateTaskSizingContract(task: ClinePlanTask): void {
	if (!task.acceptanceCommand?.trim()) {
		throw new Error(`Task ${task.id} is missing an acceptanceCommand; split or specify an objective check.`);
	}
	if (task.testFirst && !task.acceptanceTestPrompt?.trim()) {
		throw new Error(`Task ${task.id} is test-first but missing an acceptanceTestPrompt.`);
	}
	if (task.complexity > MAX_DECOMPOSED_TASK_COMPLEXITY) {
		throw new Error(
			`Task ${task.id} has complexity ${Math.round(task.complexity)}/100; split it below ${MAX_DECOMPOSED_TASK_COMPLEXITY}/100 before decomposing.`,
		);
	}
	if (task.filesLikelyTouched.length > MAX_DECOMPOSED_TASK_LIKELY_FILES) {
		throw new Error(
			`Task ${task.id} touches ${task.filesLikelyTouched.length} likely files; split it to ${MAX_DECOMPOSED_TASK_LIKELY_FILES} files or fewer before decomposing.`,
		);
	}
}

function validatePlanQuestions(questions: readonly ClinePlanQuestion[]): void {
	for (const question of questions) {
		if (question.status === "open") {
			throw new Error(
				`Clarifying question ${question.id} is still open; answer it or record an assumed-default before writing plan artifacts.`,
			);
		}
		if (question.status === "answered" && !question.answer?.trim()) {
			throw new Error(`Clarifying question ${question.id} is marked answered but missing an answer.`);
		}
		if (question.status === "assumed-default" && !question.assumption?.trim()) {
			throw new Error(`Clarifying question ${question.id} is marked assumed-default but missing an assumption.`);
		}
	}
}

function validateTaskGraphReferences(taskGraph: ClinePlanTaskGraph): number {
	const taskIds = new Set<string>();
	let dependencyCount = 0;
	for (const task of taskGraph.tasks) {
		if (taskIds.has(task.id)) {
			throw new Error(`Task graph contains duplicate task id ${task.id}.`);
		}
		taskIds.add(task.id);
	}
	for (const task of taskGraph.tasks) {
		for (const dependencyPlanTaskId of task.dependsOn) {
			dependencyCount += 1;
			if (!taskIds.has(dependencyPlanTaskId)) {
				throw new Error(`Task ${task.id} depends on unknown task ${dependencyPlanTaskId}.`);
			}
		}
	}
	return dependencyCount;
}

function selectTaskRoutingCandidate(
	task: ClinePlanTask,
	taskPrompt: string,
	routingCandidates: readonly ClineTaskRoutingCandidate[] | undefined,
): ClineTaskRoutingCandidate | null | undefined {
	if (!routingCandidates || routingCandidates.length === 0) {
		return undefined;
	}
	const promptTokens = estimateClineStartPromptTokens({
		prompt: taskPrompt,
		taskTitle: task.title,
	});
	const largestContextWindow =
		routingCandidates
			.map((candidate) => candidate.entry.contextWindow.effective ?? 0)
			.filter((contextWindow) => contextWindow > 0)
			.sort((left, right) => right - left)[0] ?? null;
	const preferredModelKey = task.suggestedRole
		? (routingCandidates.find((candidate) => candidate.role === task.suggestedRole)?.entry.key ?? null)
		: null;
	const routingDecision = routeClineTask({
		difficulty: Math.max(task.complexity, estimateClineStartDifficulty(promptTokens)),
		fitBudgetTokens: estimateClineStartFitBudgetTokens(promptTokens, largestContextWindow),
		promptTokens,
		outputTokens: 1_000,
		preferredModelKey,
		candidates: routingCandidates,
	});
	if (routingDecision.type === "decompose" || routingDecision.type === "escalate") {
		throw new Error(
			`Task ${task.id} failed the model feasibility guard: ${formatClineTaskRoutingBlockMessage(routingDecision)}`,
		);
	}
	return routingCandidates.find((candidate) => candidate.entry.key === routingDecision.modelKey) ?? null;
}

export function validateClinePlanTaskGraph(input: {
	taskGraph: ClinePlanTaskGraph;
	routingCandidates?: readonly ClineTaskRoutingCandidate[];
}): ValidateClinePlanTaskGraphResult {
	const taskGraph = clinePlanTaskGraphSchema.parse(input.taskGraph);
	for (const task of taskGraph.tasks) {
		validateTaskSizingContract(task);
		selectTaskRoutingCandidate(task, buildTaskPrompt(task), input.routingCandidates);
	}
	return {
		taskGraph,
		taskCount: taskGraph.tasks.length,
		dependencyCount: validateTaskGraphReferences(taskGraph),
	};
}

function normalizeDecomposeProjectToolInput(input: unknown): DecomposeProjectToolInput {
	const parsed = decomposeProjectToolInputSchema.parse(input);
	const defaultAcceptanceCommand = parsed.defaultAcceptanceCommand?.trim() || null;
	if (parsed.tasks.length === 0) {
		throw new Error("decompose_project requires at least one task.");
	}
	const questions = parsed.questions ?? [];
	validatePlanQuestions(questions);
	const expansions = parsed.expansions ?? {};
	const tasks = expandDecomposeProjectTasks({
		tasks: parsed.tasks,
		expansions,
		defaultAcceptanceCommand,
	});
	const taskGraph = {
		schemaVersion: 1 as const,
		slug: parsed.slug,
		title: parsed.title.trim() || parsed.slug,
		tasks,
	};
	return {
		slug: parsed.slug,
		spec: parsed.spec,
		plan: parsed.plan,
		summary: parsed.summary?.trim() || null,
		questions,
		title: parsed.title,
		tasks,
		taskGraph,
		defaultAcceptanceCommand,
		expansions,
	};
}

function resolveTaskRoleSettings(
	task: ClinePlanTask,
	modelRoleSettings: Record<string, RuntimeTaskClineSettings> | undefined,
	selectedRole: string | null | undefined,
): RuntimeTaskClineSettings | undefined {
	const role = (selectedRole === undefined ? task.suggestedRole : selectedRole)?.trim();
	if (!role || !modelRoleSettings) {
		return undefined;
	}
	const settings = modelRoleSettings[role];
	if (!settings) {
		return undefined;
	}
	return {
		...(settings.providerId ? { providerId: settings.providerId } : {}),
		...(settings.modelId ? { modelId: settings.modelId } : {}),
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

function collectBoardTaskIds(board: RuntimeBoardData): Set<string> {
	return new Set(board.columns.flatMap((column) => column.cards.map((card) => card.id)));
}

export function applyClinePlanTaskGraphToBoard(input: ApplyClinePlanTaskGraphInput): ApplyClinePlanTaskGraphResult {
	let board = input.board;
	const taskGraph = validateClinePlanTaskGraph({
		taskGraph: input.taskGraph,
		routingCandidates: input.routingCandidates,
	}).taskGraph;
	const createdTasks: RuntimeBoardCard[] = [];
	const createdDependencies: RuntimeBoardDependency[] = [];
	const taskIdByPlanTaskId: Record<string, string> = {};
	const usedBoardTaskIds = collectBoardTaskIds(board);
	const now = input.now ?? Date.now();

	for (const task of taskGraph.tasks) {
		const taskPrompt = buildTaskPrompt(task);
		const selectedRoutingCandidate = selectTaskRoutingCandidate(task, taskPrompt, input.routingCandidates);
		const selectedRole =
			selectedRoutingCandidate === undefined ? undefined : (selectedRoutingCandidate?.role ?? null);
		const baseTaskId = `${slugifyTaskId(taskGraph.slug)}-${slugifyTaskId(task.id)}`;
		let taskId = baseTaskId;
		for (let suffix = 2; usedBoardTaskIds.has(taskId); suffix += 1) {
			taskId = `${baseTaskId}-${suffix}`;
		}
		usedBoardTaskIds.add(taskId);
		const created = addTaskToColumn(
			board,
			"planning",
			{
				taskId,
				title: task.title,
				prompt: taskPrompt,
				startInPlanMode: false,
				autoReviewEnabled: true,
				autoReviewMode: "commit",
				agentId: "cline",
				baseRef: input.baseRef,
				clineSettings: resolveTaskRoleSettings(task, input.modelRoleSettings, selectedRole),
			},
			input.randomUuid,
			now,
		);
		board = created.board;
		createdTasks.push(created.task);
		taskIdByPlanTaskId[task.id] = created.task.id;
	}

	for (const task of taskGraph.tasks) {
		const waitingTaskId = taskIdByPlanTaskId[task.id];
		if (!waitingTaskId) {
			continue;
		}
		for (const dependencyPlanTaskId of task.dependsOn) {
			const prerequisiteTaskId = taskIdByPlanTaskId[dependencyPlanTaskId];
			if (!prerequisiteTaskId) {
				throw new Error(`Task ${task.id} depends on unknown task ${dependencyPlanTaskId}.`);
			}
			const linked = addTaskDependency(board, waitingTaskId, prerequisiteTaskId);
			if (!linked.added || !linked.dependency) {
				throw new Error(`Could not link ${task.id} to ${dependencyPlanTaskId}: ${linked.reason ?? "unknown"}.`);
			}
			board = linked.board;
			createdDependencies.push(linked.dependency);
		}
	}

	return {
		board,
		createdTasks,
		createdDependencies,
		taskIdByPlanTaskId,
	};
}

async function applyDecomposeProjectArtifactsToWorkspace(input: {
	workspacePath: string;
	taskGraph: ClinePlanTaskGraph;
}): Promise<ApplyDecomposeProjectArtifactsResult> {
	const runtimeConfig = await loadRuntimeConfig(input.workspacePath).catch(() => null);
	try {
		const result = await mutateWorkspaceState<ApplyDecomposeProjectArtifactsResult>(input.workspacePath, (state) => {
			const baseRef = state.git.currentBranch ?? state.git.defaultBranch;
			if (!baseRef) {
				return {
					board: state.board,
					save: false,
					value: {
						applied: false,
						createdTaskCount: 0,
						createdDependencyCount: 0,
						taskIdByPlanTaskId: {},
						baseRef: null,
						message: "Could not determine a base branch, so the task graph was persisted but not applied.",
					},
				};
			}
			const applied = applyClinePlanTaskGraphToBoard({
				board: state.board,
				taskGraph: input.taskGraph,
				baseRef,
				randomUuid: randomUUID,
				modelRoleSettings: runtimeConfig?.modelRoles,
			});
			return {
				board: applied.board,
				value: {
					applied: true,
					createdTaskCount: applied.createdTasks.length,
					createdDependencyCount: applied.createdDependencies.length,
					taskIdByPlanTaskId: applied.taskIdByPlanTaskId,
					baseRef,
					message: `Applied task graph to Kanban: created ${pluralizeCount(applied.createdTasks.length, "Planning card")} and ${pluralizeCount(applied.createdDependencies.length, "dependency", "dependencies")}.`,
				},
			};
		});
		return result.value;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			applied: false,
			createdTaskCount: 0,
			createdDependencyCount: 0,
			taskIdByPlanTaskId: {},
			baseRef: null,
			message: `Could not apply the task graph automatically: ${message}`,
		};
	}
}

function createDecomposeProjectTool(workspacePath: string): AgentTool {
	return {
		name: "decompose_project",
		description:
			"Validate and persist Kanban decomposition artifacts for a project-scale idea. Use this instead of editing .cline/kanban plan files or tasks.json directly.",
		inputSchema: {
			type: "object",
			properties: {
				slug: { type: "string", description: "Short stable plan slug, for example habit-insights." },
				spec: { type: "string", description: "Approved concise specification markdown, not a file path." },
				plan: { type: "string", description: "Implementation plan markdown." },
				summary: {
					type: "string",
					description:
						"Short plain-language summary for non-technical review: what will be built, the step count, and any assumptions.",
				},
				questions: {
					type: "array",
					description:
						"Clarifying questions considered before writing the plan. Open questions are rejected; record answered items or explicit assumed defaults.",
					items: {
						type: "object",
						properties: {
							id: { type: "string" },
							question: { type: "string" },
							status: { type: "string", enum: ["open", "answered", "assumed-default"] },
							options: {
								type: "array",
								items: {
									type: "object",
									properties: {
										id: { type: "string" },
										label: { type: "string" },
										description: { type: "string" },
										recommended: { type: "boolean" },
									},
									required: ["id", "label"],
									additionalProperties: false,
								},
							},
							answer: { type: "string" },
							assumption: { type: "string" },
						},
						required: ["id", "question", "status"],
						additionalProperties: false,
					},
				},
				title: { type: "string", description: "Project/task graph title." },
				tasks: {
					type: "array",
					description:
						"Task leaves. Kanban adds schemaVersion, slug, title, validates dependencies, and writes artifacts.",
					items: {
						type: "object",
						properties: {
							id: { type: "string" },
							title: { type: "string" },
							prompt: { type: "string" },
							dependsOn: { type: "array", items: { type: "string" } },
							complexity: { type: "number" },
							suggestedRole: { type: "string" },
							filesLikelyTouched: { type: "array", items: { type: "string" } },
							acceptanceCommand: { type: "string" },
							testFirst: { type: "boolean" },
							acceptanceTestPrompt: { type: "string" },
						},
						required: ["id", "title", "prompt"],
						additionalProperties: false,
					},
				},
				defaultAcceptanceCommand: {
					type: "string",
					description: "Optional acceptance command applied to tasks that omit acceptanceCommand.",
				},
				expansions: {
					type: "object",
					description:
						"Optional recursive replacement map. Keys are oversized task ids from tasks or another expansion; values are smaller replacement tasks. Kanban expands these before validation and rewrites dependencies to terminal replacement leaves.",
					additionalProperties: {
						type: "array",
						items: {
							type: "object",
							properties: {
								id: { type: "string" },
								title: { type: "string" },
								prompt: { type: "string" },
								dependsOn: { type: "array", items: { type: "string" } },
								complexity: { type: "number" },
								suggestedRole: { type: "string" },
								filesLikelyTouched: { type: "array", items: { type: "string" } },
								acceptanceCommand: { type: "string" },
								testFirst: { type: "boolean" },
								acceptanceTestPrompt: { type: "string" },
							},
							required: ["id", "title", "prompt"],
							additionalProperties: false,
						},
					},
				},
			},
			required: ["slug", "spec", "plan", "title", "tasks"],
			additionalProperties: false,
		},
		async execute(input) {
			const { slug, spec, plan, summary, questions, taskGraph } = normalizeDecomposeProjectToolInput(input);
			const validation = validateClinePlanTaskGraph({ taskGraph });
			const artifacts = await writeClinePlanArtifacts({
				workspacePath,
				slug,
				spec,
				plan,
				summary,
				questions,
				taskGraph: validation.taskGraph,
			});
			const applied = await applyDecomposeProjectArtifactsToWorkspace({
				workspacePath,
				taskGraph: validation.taskGraph,
			});
			return {
				ok: true,
				slug: artifacts.taskGraph.slug,
				taskCount: validation.taskCount,
				dependencyCount: validation.dependencyCount,
				applied: applied.applied,
				createdTaskCount: applied.createdTaskCount,
				createdDependencyCount: applied.createdDependencyCount,
				taskIdByPlanTaskId: applied.taskIdByPlanTaskId,
				modelFitValidated: false,
				specPath: artifacts.specPath,
				planPath: artifacts.planPath,
				questionsPath: artifacts.questionsPath,
				summaryPath: artifacts.summaryPath,
				taskGraphPath: artifacts.taskGraphPath,
				instruction: applied.applied
					? `${applied.message} Schema and sizing validation passed; connected local model fit will be enforced when each card starts. Continue by starting the newly created Kanban cards; do not implement this planning card directly.`
					: `Artifacts passed schema and sizing validation, but connected local model fit was not validated in this tool call. ${applied.message} Apply them through Kanban, not by editing task files: kanban task decompose --slug ${artifacts.taskGraph.slug} --project-path ${workspacePath}; connected-model fit is checked during apply/start.`,
			};
		},
	};
}

function createExpandTaskTool(): AgentTool {
	return {
		name: "expand_task",
		description:
			"Validate a recursively split replacement task graph for an oversized task. Prefer decompose_project.expansions for the final submission; use this only to check a replacement graph before submitting it.",
		inputSchema: {
			type: "object",
			properties: {
				taskGraph: { type: "object", description: "Replacement task graph with small executable leaves." },
			},
			required: ["taskGraph"],
			additionalProperties: false,
		},
		async execute(input) {
			const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
			const taskGraph = clinePlanTaskGraphSchema.parse(record.taskGraph);
			const validation = validateClinePlanTaskGraph({ taskGraph });
			return {
				ok: true,
				taskGraph: validation.taskGraph,
				taskCount: validation.taskCount,
				dependencyCount: validation.dependencyCount,
				instruction:
					"Replacement graph passes the Kanban sizing contract. Connected-model fit is checked when the graph is applied. Put these replacement task leaves in decompose_project.expansions for the oversized task instead of editing plan artifacts directly.",
			};
		},
	};
}

export function createClineDecompositionTools(options: { workspacePath: string }): AgentTool[] {
	return [createDecomposeProjectTool(options.workspacePath), createExpandTaskTool()];
}
