import type { NKleinPlanTask } from "../nklein-plan-artifacts";
import { MAX_DECOMPOSED_TASK_EXPANSION_DEPTH } from "./plan-task-schemas";
import { normalizeTaskAcceptanceCommand } from "./plan-task-validation";

export function uniqStrings(values: readonly string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

export function formatExpansionRevisionMarkdown(expansions: Record<string, NKleinPlanTask[]>): string | null {
	const expansionEntries = Object.entries(expansions).filter(([, replacements]) => replacements.length > 0);
	if (expansionEntries.length === 0) {
		return null;
	}
	const lines = [
		"# Revisions",
		"",
		`## ${new Date().toISOString()} - recursive_split`,
		"",
		"Recursive task expansion was applied before plan artifacts were written.",
		"",
		"Expanded tasks:",
		...expansionEntries.map(([taskId, replacements]) => {
			const replacementIds = replacements.map((task) => task.id).join(", ");
			return `- ${taskId} -> ${replacementIds}`;
		}),
		"",
		"Dependency rewrites are reflected in tasks.json.",
	];
	return `${lines.join("\n")}\n`;
}

interface ExpandedTaskReplacement {
	entryTaskIds: string[];
	terminalTaskIds: string[];
}

interface ExpandedTaskResult extends ExpandedTaskReplacement {
	tasks: NKleinPlanTask[];
}

export function expandDecomposeProjectTasks(input: {
	tasks: NKleinPlanTask[];
	expansions: Record<string, NKleinPlanTask[]>;
	defaultAcceptanceCommand: string | null;
	maxDepth?: number;
}): NKleinPlanTask[] {
	const maxDepth = input.maxDepth ?? MAX_DECOMPOSED_TASK_EXPANSION_DEPTH;
	const replacementByTaskId = new Map<string, ExpandedTaskReplacement>();
	const usedExpansionTaskIds = new Set<string>();
	const visitingTaskIds = new Set<string>();

	const expandTask = (task: NKleinPlanTask, depth: number): ExpandedTaskResult => {
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
		// Resolve each child's dependsOn through already-expanded nested siblings BEFORE classifying entry/terminal
		// boundaries. A child can depend on a sibling id that was itself expanded (hence replaced by its terminal
		// ids); that stale sibling id is absent from childTaskIds and is only remapped by the final rewrite pass
		// below. Classifying against the raw ids would read a non-entry child as an entry (spuriously inheriting the
		// parent's dependencies) and an internal node as a terminal (spurious downstream edges). Mirror the final
		// pass's remap here. The stored dependsOn stays raw (see tasksWithInheritedDependencies) so the final pass
		// still remaps it.
		const resolveChildDependency = (dependencyTaskId: string): string[] =>
			replacementByTaskId.get(dependencyTaskId)?.terminalTaskIds ?? [dependencyTaskId];
		const childTasksWithResolvedDependencies = childTasks.map((childTask) => ({
			childTask,
			resolvedDependencies: uniqStrings(childTask.dependsOn.flatMap(resolveChildDependency)).filter(
				(dependencyTaskId) => dependencyTaskId !== childTask.id,
			),
		}));
		const dependedOnByChildTaskIds = new Set<string>();
		for (const { resolvedDependencies } of childTasksWithResolvedDependencies) {
			for (const dependencyTaskId of resolvedDependencies) {
				if (childTaskIds.has(dependencyTaskId)) {
					dependedOnByChildTaskIds.add(dependencyTaskId);
				}
			}
		}
		const entryTaskIds = childTasksWithResolvedDependencies
			.filter(
				({ resolvedDependencies }) =>
					!resolvedDependencies.some((dependencyTaskId) => childTaskIds.has(dependencyTaskId)),
			)
			.map(({ childTask }) => childTask.id);
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

export function getReplacementBoundaryTaskIds(replacements: readonly NKleinPlanTask[]): {
	replacementTaskIds: string[];
	entryTaskIds: string[];
	terminalTaskIds: string[];
} {
	const replacementTaskIds = replacements.map((task) => task.id);
	const replacementTaskIdSet = new Set(replacementTaskIds);
	const dependedOnByReplacementTaskIds = new Set<string>();
	for (const task of replacements) {
		for (const dependencyTaskId of task.dependsOn) {
			if (replacementTaskIdSet.has(dependencyTaskId)) {
				dependedOnByReplacementTaskIds.add(dependencyTaskId);
			}
		}
	}
	const entryTaskIds = replacements
		.filter((task) => !task.dependsOn.some((dependencyTaskId) => replacementTaskIdSet.has(dependencyTaskId)))
		.map((task) => task.id);
	const terminalTaskIds = replacements
		.filter((task) => !dependedOnByReplacementTaskIds.has(task.id))
		.map((task) => task.id);
	if (entryTaskIds.length === 0 || terminalTaskIds.length === 0) {
		throw new Error("Replacement graph must be acyclic and include at least one entry and terminal task.");
	}
	return {
		replacementTaskIds,
		entryTaskIds,
		terminalTaskIds,
	};
}
