import type {
	RuntimeBoardCard,
	RuntimeBoardData,
	RuntimeBoardDependency,
	RuntimeTaskClineSettings,
} from "../core/api-contract";
import { addTaskDependency, addTaskToColumn } from "../core/task-board-mutations";
import type { ClinePlanTask, ClinePlanTaskGraph } from "./cline-plan-artifacts";

const MAX_DECOMPOSED_TASK_COMPLEXITY = 75;
const MAX_DECOMPOSED_TASK_LIKELY_FILES = 3;

export interface ApplyClinePlanTaskGraphInput {
	board: RuntimeBoardData;
	taskGraph: ClinePlanTaskGraph;
	baseRef: string;
	randomUuid: () => string;
	modelRoleSettings?: Record<string, RuntimeTaskClineSettings>;
	now?: number;
}

export interface ApplyClinePlanTaskGraphResult {
	board: RuntimeBoardData;
	createdTasks: RuntimeBoardCard[];
	createdDependencies: RuntimeBoardDependency[];
	taskIdByPlanTaskId: Record<string, string>;
}

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
	const createdTasks: RuntimeBoardCard[] = [];
	const createdDependencies: RuntimeBoardDependency[] = [];
	const taskIdByPlanTaskId: Record<string, string> = {};
	const now = input.now ?? Date.now();

	for (const task of input.taskGraph.tasks) {
		validateTaskSizingContract(task);
		const taskId = `${slugifyTaskId(input.taskGraph.slug)}-${slugifyTaskId(task.id)}`;
		const created = addTaskToColumn(
			board,
			"backlog",
			{
				taskId,
				title: task.title,
				prompt: buildTaskPrompt(task),
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

	for (const task of input.taskGraph.tasks) {
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
