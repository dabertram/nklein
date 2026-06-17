import type { AgentTool } from "@clinebot/shared";
import type {
	RuntimeBoardCard,
	RuntimeBoardData,
	RuntimeBoardDependency,
	RuntimeTaskClineSettings,
} from "../core/api-contract";
import { addTaskDependency, addTaskToColumn } from "../core/task-board-mutations";
import {
	type ClinePlanTask,
	type ClinePlanTaskGraph,
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

const decomposeProjectToolInputSchema = clinePlanTaskGraphSchema
	.pick({
		title: true,
		tasks: true,
	})
	.partial()
	.extend({
		slug: clinePlanTaskGraphSchema.shape.slug,
		spec: clinePlanTaskSchema.shape.prompt.describe("Concise requirements markdown."),
		plan: clinePlanTaskSchema.shape.prompt.describe("Implementation plan markdown."),
		taskGraph: clinePlanTaskGraphSchema.optional(),
		defaultAcceptanceCommand: clinePlanTaskSchema.shape.acceptanceCommand.optional(),
	});
type DecomposeProjectToolInput = {
	slug: string;
	spec: string;
	plan: string;
	title?: string;
	tasks?: ClinePlanTask[];
	taskGraph: ClinePlanTaskGraph;
	defaultAcceptanceCommand?: string | null;
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

function validateTaskRoutingFeasibility(
	task: ClinePlanTask,
	taskPrompt: string,
	routingCandidates: readonly ClineTaskRoutingCandidate[] | undefined,
): void {
	if (!routingCandidates || routingCandidates.length === 0) {
		return;
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
}

export function validateClinePlanTaskGraph(input: {
	taskGraph: ClinePlanTaskGraph;
	routingCandidates?: readonly ClineTaskRoutingCandidate[];
}): ValidateClinePlanTaskGraphResult {
	const taskGraph = clinePlanTaskGraphSchema.parse(input.taskGraph);
	for (const task of taskGraph.tasks) {
		validateTaskSizingContract(task);
		validateTaskRoutingFeasibility(task, buildTaskPrompt(task), input.routingCandidates);
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
	if (!parsed.taskGraph && (!parsed.tasks || parsed.tasks.length === 0)) {
		throw new Error("decompose_project requires either a taskGraph or a non-empty tasks list.");
	}
	const taskGraph = parsed.taskGraph
		? parsed.taskGraph
		: {
				schemaVersion: 1 as const,
				slug: parsed.slug,
				title: parsed.title?.trim() || parsed.slug,
				tasks: (parsed.tasks ?? []).map((task) => ({
					...task,
					acceptanceCommand: task.acceptanceCommand?.trim() || defaultAcceptanceCommand,
				})),
			};
	return {
		slug: parsed.slug,
		spec: parsed.spec,
		plan: parsed.plan,
		title: parsed.title,
		tasks: parsed.tasks,
		taskGraph,
		defaultAcceptanceCommand,
	};
}

function resolveTaskRoleSettings(
	task: ClinePlanTask,
	modelRoleSettings: Record<string, RuntimeTaskClineSettings> | undefined,
): RuntimeTaskClineSettings | undefined {
	const role = task.suggestedRole?.trim();
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

export function applyClinePlanTaskGraphToBoard(input: ApplyClinePlanTaskGraphInput): ApplyClinePlanTaskGraphResult {
	let board = input.board;
	const taskGraph = validateClinePlanTaskGraph({
		taskGraph: input.taskGraph,
		routingCandidates: input.routingCandidates,
	}).taskGraph;
	const createdTasks: RuntimeBoardCard[] = [];
	const createdDependencies: RuntimeBoardDependency[] = [];
	const taskIdByPlanTaskId: Record<string, string> = {};
	const usedBoardTaskIds = new Set<string>();
	const now = input.now ?? Date.now();

	for (const task of taskGraph.tasks) {
		const taskPrompt = buildTaskPrompt(task);
		const baseTaskId = `${slugifyTaskId(taskGraph.slug)}-${slugifyTaskId(task.id)}`;
		let taskId = baseTaskId;
		for (let suffix = 2; usedBoardTaskIds.has(taskId); suffix += 1) {
			taskId = `${baseTaskId}-${suffix}`;
		}
		usedBoardTaskIds.add(taskId);
		const created = addTaskToColumn(
			board,
			"backlog",
			{
				taskId,
				title: task.title,
				prompt: taskPrompt,
				startInPlanMode: false,
				autoReviewEnabled: true,
				autoReviewMode: "commit",
				agentId: "cline",
				baseRef: input.baseRef,
				clineSettings: resolveTaskRoleSettings(task, input.modelRoleSettings),
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
				title: { type: "string", description: "Project/task graph title. Required when using tasks." },
				tasks: {
					type: "array",
					description:
						"Preferred simple input: task leaves. Kanban adds schemaVersion, slug, title, validates dependencies, and writes artifacts.",
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
				taskGraph: {
					type: "object",
					description: "Compatibility input for callers that already have a full schemaVersion/title/tasks graph.",
				},
			},
			required: ["slug", "spec", "plan"],
			additionalProperties: false,
		},
		async execute(input) {
			const { slug, spec, plan, taskGraph } = normalizeDecomposeProjectToolInput(input);
			const validation = validateClinePlanTaskGraph({ taskGraph });
			const artifacts = await writeClinePlanArtifacts({
				workspacePath,
				slug,
				spec,
				plan,
				taskGraph: validation.taskGraph,
			});
			return {
				ok: true,
				slug: artifacts.taskGraph.slug,
				taskCount: validation.taskCount,
				dependencyCount: validation.dependencyCount,
				specPath: artifacts.specPath,
				planPath: artifacts.planPath,
				taskGraphPath: artifacts.taskGraphPath,
				instruction: `Artifacts passed schema and sizing validation. Apply them through Kanban, not by editing task files: kanban task decompose --slug ${artifacts.taskGraph.slug} --project-path ${workspacePath}; connected-model fit is checked during apply.`,
			};
		},
	};
}

function createExpandTaskTool(): AgentTool {
	return {
		name: "expand_task",
		description:
			"Validate a recursively split replacement task graph for an oversized task. Use this when a task fails the decomposition sizing or model-fit guard.",
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
					"Replacement graph passes the Kanban sizing contract. Connected-model fit is checked when the graph is applied. Call decompose_project with the full graph instead of editing plan artifacts directly.",
			};
		},
	};
}

export function createClineDecompositionTools(options: { workspacePath: string }): AgentTool[] {
	return [createDecomposeProjectTool(options.workspacePath), createExpandTaskTool()];
}
