import type { RuntimeBoardCard, RuntimeBoardData, RuntimeBoardDependency } from "../core/api-contract";
import { addTaskDependency, addTaskToColumn } from "../core/task-board-mutations";
import type { ClinePlanTask, ClinePlanTaskGraph } from "./cline-plan-artifacts";

export interface ApplyClinePlanTaskGraphInput {
	board: RuntimeBoardData;
	taskGraph: ClinePlanTaskGraph;
	baseRef: string;
	randomUuid: () => string;
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

export function applyClinePlanTaskGraphToBoard(input: ApplyClinePlanTaskGraphInput): ApplyClinePlanTaskGraphResult {
	let board = input.board;
	const createdTasks: RuntimeBoardCard[] = [];
	const createdDependencies: RuntimeBoardDependency[] = [];
	const taskIdByPlanTaskId: Record<string, string> = {};
	const now = input.now ?? Date.now();

	for (const task of input.taskGraph.tasks) {
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
