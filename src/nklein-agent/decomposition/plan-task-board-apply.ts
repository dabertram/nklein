import { z } from "zod";
import type { RuntimeBoardCard, RuntimeBoardData, RuntimeBoardDependency } from "../../core/api-contract";
import { withAutonomousNKleinTimeoutSettings } from "../../core/autonomous-timeout-defaults";
import { addTaskDependency, addTaskToColumn, moveTaskToColumn } from "../../core/task-board-mutations";
import type {
	ApplyNKleinPlanTaskGraphInput,
	ApplyNKleinPlanTaskGraphResult,
	ReplaceNKleinPlanTaskInGraphResult,
} from "../nklein-decomposition-tool";
import type { NKleinPlanTask, NKleinPlanTaskGraph } from "../nklein-plan-artifacts";
import { nkleinPlanTaskGraphSchema, nkleinPlanTaskSchema } from "../nklein-plan-artifacts";
import type { NKleinTaskRoutingCandidate } from "../nklein-task-router";
import { expandDecomposeProjectTasks, getReplacementBoundaryTaskIds } from "./plan-task-expansion";
import { slugifyTaskId } from "./plan-task-input-parse";
import { buildTaskPrompt } from "./plan-task-prompt";
import {
	formatTaskModelFitEvidence,
	previewNKleinPlanTaskGraph,
	resolveTaskRoleSettings,
	selectTaskRoutingCandidate,
} from "./plan-task-routing";
import { validateNKleinPlanTaskGraph } from "./plan-task-validation";

export function collectBoardTaskIds(board: RuntimeBoardData): Set<string> {
	return new Set(board.columns.flatMap((column) => column.cards.map((card) => card.id)));
}

export function findGeneratedPlanTaskCard(input: {
	board: RuntimeBoardData;
	planSlug: string;
	planTaskId: string;
}): RuntimeBoardCard | null {
	for (const column of input.board.columns) {
		for (const card of column.cards) {
			if (
				card.generatedFromPlan?.planSlug === input.planSlug &&
				card.generatedFromPlan.planTaskId === input.planTaskId
			) {
				return card;
			}
		}
	}
	return null;
}

export function replaceNKleinPlanTaskInGraph(input: {
	taskGraph: NKleinPlanTaskGraph;
	taskId: string;
	replacements: readonly NKleinPlanTask[];
	defaultAcceptanceCommand?: string | null;
	routingCandidates?: readonly NKleinTaskRoutingCandidate[];
}): ReplaceNKleinPlanTaskInGraphResult {
	const taskGraph = nkleinPlanTaskGraphSchema.parse(input.taskGraph);
	const taskId = input.taskId.trim();
	if (!taskId) {
		throw new Error("Replacement target task id is required.");
	}
	if (!taskGraph.tasks.some((task) => task.id === taskId)) {
		throw new Error(`Task graph does not contain task ${taskId}.`);
	}
	const replacements = z.array(nkleinPlanTaskSchema).parse(input.replacements);
	if (replacements.length === 0) {
		throw new Error(`Replacement for task ${taskId} must include at least one task.`);
	}
	const replacementBoundary = getReplacementBoundaryTaskIds(replacements);
	const nextTaskGraph: NKleinPlanTaskGraph = {
		...taskGraph,
		tasks: expandDecomposeProjectTasks({
			tasks: taskGraph.tasks,
			expansions: {
				[taskId]: replacements,
			},
			defaultAcceptanceCommand: input.defaultAcceptanceCommand?.trim() || null,
		}),
	};
	validateNKleinPlanTaskGraph({
		taskGraph: nextTaskGraph,
		routingCandidates: input.routingCandidates,
	});
	return {
		taskGraph: nextTaskGraph,
		...replacementBoundary,
	};
}

export function applyNKleinPlanTaskGraphToBoard(input: ApplyNKleinPlanTaskGraphInput): ApplyNKleinPlanTaskGraphResult {
	let board = input.board;
	const taskGraph = validateNKleinPlanTaskGraph({
		taskGraph: input.taskGraph,
		routingCandidates: input.routingCandidates,
	}).taskGraph;
	const createdTasks: RuntimeBoardCard[] = [];
	const createdDependencies: RuntimeBoardDependency[] = [];
	const taskIdByPlanTaskId: Record<string, string> = {};
	const usedBoardTaskIds = collectBoardTaskIds(board);
	const now = input.now ?? Date.now();
	const preview = previewNKleinPlanTaskGraph({
		taskGraph,
		routingCandidates: input.routingCandidates,
		sharedContext: input.sharedContext,
	});

	for (const task of taskGraph.tasks) {
		const existingGeneratedCard = findGeneratedPlanTaskCard({
			board,
			planSlug: taskGraph.slug,
			planTaskId: task.id,
		});
		if (existingGeneratedCard) {
			usedBoardTaskIds.add(existingGeneratedCard.id);
			taskIdByPlanTaskId[task.id] = existingGeneratedCard.id;
			continue;
		}
		const taskPromptForRouting = buildTaskPrompt(task, input.sharedContext);
		const selectedRoutingCandidate = selectTaskRoutingCandidate(task, taskPromptForRouting, input.routingCandidates);
		const taskPrompt = buildTaskPrompt(
			task,
			input.sharedContext,
			formatTaskModelFitEvidence(selectedRoutingCandidate),
		);
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
				agentId: "nklein",
				baseRef: input.baseRef,
				nkleinSettings: withAutonomousNKleinTimeoutSettings(
					resolveTaskRoleSettings(task, input.modelRoleSettings, selectedRole),
				),
				filesLikelyTouched: task.filesLikelyTouched,
				generatedFromPlan: {
					artifactKind: "decomposition",
					planSlug: taskGraph.slug,
					planTaskId: task.id,
					sourceTaskId: input.sourceTaskId ?? null,
				},
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
				if (linked.reason === "duplicate") {
					continue;
				}
				throw new Error(`Could not link ${task.id} to ${dependencyPlanTaskId}: ${linked.reason ?? "unknown"}.`);
			}
			board = linked.board;
			createdDependencies.push(linked.dependency);
		}
	}

	const sourceTaskId = input.sourceTaskId?.trim() || null;
	if (sourceTaskId && !Object.values(taskIdByPlanTaskId).includes(sourceTaskId)) {
		board = moveTaskToColumn(board, sourceTaskId, "completed", now).board;
	}

	const rootTaskIds = taskGraph.tasks
		.filter((task) => task.dependsOn.length === 0)
		.map((task) => taskIdByPlanTaskId[task.id])
		.filter((taskId): taskId is string => Boolean(taskId));

	return {
		board,
		createdTasks,
		createdDependencies,
		taskIdByPlanTaskId,
		rootTaskIds,
		preview,
	};
}
