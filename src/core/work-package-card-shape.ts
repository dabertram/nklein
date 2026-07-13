import type { WorkPackage } from "./work-package-dispatch.js";

/**
 * F1.8 (§5.AK) — emit WORK-PACKAGE-SHAPED cards BY CONSTRUCTION: the pure derivation that turns a decomposed task
 * list into cards carrying their contract bounds. Two responsibilities:
 *
 *  1. **Write scope** — every card gets a bounded write scope: the architect's explicit `writeScope` globs when
 *     provided, else derived from `filesLikelyTouched` (the field models already emit reliably). A card with
 *     neither stays unbounded (absent scope ⇒ nothing to enforce; F1.9 dispatch treats it as legacy).
 *  2. **Hot-file classification** — a path named by TWO OR MORE cards is a HOT file: classified `yellow` when the
 *     touching cards are totally ordered by the dependency graph (they can never run in parallel, the overlap is a
 *     hand-off), `red` when at least one pair is unordered (parallel writers ⇒ merge conflict by construction).
 *     Green (single owner) paths are not listed — the classification is the exception report.
 *
 * Enforcement (rejecting/parking unauthorized overlap at dispatch and review) is F1.9; this module only SHAPES the
 * cards and reports the hazard so the graph carries its own parallel-write safety map. Pure + total: structural
 * input types (no agent-layer imports), no I/O, malformed fields are treated as absent.
 */

/** The structural slice of a plan task this module reads (matches `NKleinPlanTask` without importing it). */
export interface WorkPackageShapedTaskInput {
	id: string;
	dependsOn?: readonly string[];
	filesLikelyTouched?: readonly string[];
	writeScope?: readonly string[];
	forbiddenPaths?: readonly string[];
}

export type HotFileClassification = "yellow" | "red";

/** One hot file: a path named by ≥2 cards, with the parallel-write safety class of that overlap. */
export interface PlanHotFile {
	path: string;
	/** The ids of every task naming this path, in task order. */
	taskIds: string[];
	classification: HotFileClassification;
}

function cleanPaths(value: readonly string[] | undefined): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const seen = new Set<string>();
	const out: string[] = [];
	for (const item of value) {
		if (typeof item !== "string") {
			continue;
		}
		const trimmed = item.trim();
		if (trimmed.length > 0 && !seen.has(trimmed)) {
			seen.add(trimmed);
			out.push(trimmed);
		}
	}
	return out;
}

/** A card's effective write scope: explicit `writeScope` wins, else derived from `filesLikelyTouched`. */
export function deriveTaskWriteScope(task: WorkPackageShapedTaskInput): string[] {
	const explicit = cleanPaths(task.writeScope);
	return explicit.length > 0 ? explicit : cleanPaths(task.filesLikelyTouched);
}

/** All ids transitively reachable from `start` by following dependsOn edges (i.e. everything `start` depends on). */
function transitiveDependencies(byId: Map<string, WorkPackageShapedTaskInput>, start: string): Set<string> {
	const visited = new Set<string>();
	const stack = [...(byId.get(start)?.dependsOn ?? [])];
	while (stack.length > 0) {
		const id = stack.pop();
		if (id === undefined || visited.has(id)) {
			continue;
		}
		visited.add(id);
		for (const next of byId.get(id)?.dependsOn ?? []) {
			stack.push(next);
		}
	}
	return visited;
}

/**
 * Classify every hot file in the task list. A pair of touching tasks is ORDERED when one transitively depends on
 * the other; a hot file is `yellow` iff every touching pair is ordered (sequential hand-off), else `red`.
 */
export function classifyPlanHotFiles(tasks: readonly WorkPackageShapedTaskInput[]): PlanHotFile[] {
	const byId = new Map(tasks.map((task) => [task.id, task]));
	const touchersByPath = new Map<string, string[]>();
	for (const task of tasks) {
		for (const path of deriveTaskWriteScope(task)) {
			const list = touchersByPath.get(path);
			if (list) {
				if (!list.includes(task.id)) {
					list.push(task.id);
				}
			} else {
				touchersByPath.set(path, [task.id]);
			}
		}
	}
	const dependencyCache = new Map<string, Set<string>>();
	const dependenciesOf = (id: string): Set<string> => {
		let cached = dependencyCache.get(id);
		if (!cached) {
			cached = transitiveDependencies(byId, id);
			dependencyCache.set(id, cached);
		}
		return cached;
	};
	const hotFiles: PlanHotFile[] = [];
	for (const [path, taskIds] of touchersByPath) {
		if (taskIds.length < 2) {
			continue;
		}
		let ordered = true;
		outer: for (let i = 0; i < taskIds.length; i += 1) {
			for (let j = i + 1; j < taskIds.length; j += 1) {
				const a = taskIds[i];
				const b = taskIds[j];
				if (a === undefined || b === undefined) {
					continue;
				}
				if (!dependenciesOf(a).has(b) && !dependenciesOf(b).has(a)) {
					ordered = false;
					break outer;
				}
			}
		}
		hotFiles.push({ path, taskIds: [...taskIds], classification: ordered ? "yellow" : "red" });
	}
	return hotFiles;
}

export interface PopulateWorkPackageShapeResult<TTask extends WorkPackageShapedTaskInput> {
	/** The tasks with `writeScope` populated (derived when absent; tasks with no basis stay unbounded). */
	tasks: TTask[];
	hotFiles: PlanHotFile[];
}

/**
 * Populate the work-package shape across a decomposed task list: fill each card's `writeScope` (derivation above)
 * and compute the graph's hot-file classification. Generic over the concrete task type so the caller's richer task
 * objects pass through structurally unchanged apart from the populated scope.
 */
export function populateWorkPackageShape<TTask extends WorkPackageShapedTaskInput>(
	tasks: readonly TTask[],
): PopulateWorkPackageShapeResult<TTask> {
	const populated = tasks.map((task) => {
		const scope = deriveTaskWriteScope(task);
		return scope.length > 0 ? { ...task, writeScope: scope } : task;
	});
	return { tasks: populated, hotFiles: classifyPlanHotFiles(populated) };
}

/**
 * Project a shaped plan task to the {@link WorkPackage} the §5.AK dispatch classifier consumes — the F1.9 bridge:
 * write scope + forbidden paths + dependencies become the dispatch bounds.
 */
export function planTaskToWorkPackage(task: WorkPackageShapedTaskInput): WorkPackage {
	const forbidden = cleanPaths(task.forbiddenPaths);
	const dependsOn = Array.isArray(task.dependsOn) ? task.dependsOn.filter((id) => typeof id === "string") : [];
	return {
		id: task.id,
		writeScope: deriveTaskWriteScope(task),
		...(forbidden.length > 0 ? { forbiddenScope: forbidden } : {}),
		...(dependsOn.length > 0 ? { dependsOn } : {}),
	};
}

/** Human-readable quality warnings for the RED hot files (surfaced with the decompose result). */
export function formatHotFileWarnings(hotFiles: readonly PlanHotFile[]): string[] {
	return hotFiles
		.filter((hotFile) => hotFile.classification === "red")
		.map(
			(hotFile) =>
				`hot file: "${hotFile.path}" is written by ${hotFile.taskIds.length} tasks with no dependency order (${hotFile.taskIds.join(", ")}) — parallel writers will conflict; order them with dependsOn or split ownership`,
		);
}
