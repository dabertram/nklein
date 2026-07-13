import {
	applyDagOp,
	type DagConstruction,
	type DagOpResult,
	emptyDagConstruction,
} from "../../core/incremental-dag-construction";
import { type NKleinPlanTask, nkleinPlanTaskSchema } from "../nklein-plan-artifacts";
import { repairJsonStringValue } from "../nklein-tool-argument-repair";
import type { AgentTool } from "../sdk-agent-types";

/**
 * F1.7 (§5.AV) — the LIVE wiring of incremental valid-DAG construction: `add_task` / `add_dependency` tools whose
 * handlers run the pure {@link applyDagOp} state machine, so the planning agent can build the decomposition graph
 * one validated operation at a time and an invalid graph is impossible to ACCUMULATE (always acyclic, every edge
 * between declared tasks). A rejected op leaves the construction untouched and returns the core's precise reason so
 * the model corrects the single bad operation instead of redoing the whole graph.
 *
 * The protocol composes with the existing flow instead of replacing it: the model finishes by calling
 * `decompose_project` WITHOUT `tasks`, and the accumulated construction is assembled into the task list (dependsOn
 * derived from the accepted edges — the construction is the single source of dependency truth). One-shot mode
 * (passing `tasks` directly) stays fully supported — it is the default path and the evaluator's comparison baseline;
 * an explicit `tasks` array simply bypasses (and afterwards clears) the construction.
 *
 * State is PER PLANNING SESSION (one mutable holder shared by the tool closures), never persisted: a decomposition
 * that ends the session abandons its partial construction by design.
 */

export interface IncrementalDagSessionState {
	construction: DagConstruction;
	/** The full task payloads by id (the construction holds only ids/labels/edges). */
	tasksById: Map<string, NKleinPlanTask>;
	/** Total rejected operations this session (a weak-model quality signal for telemetry). */
	rejectedOpCount: number;
}

export function createIncrementalDagSessionState(): IncrementalDagSessionState {
	return { construction: emptyDagConstruction(), tasksById: new Map(), rejectedOpCount: 0 };
}

/** Reset after a successful decompose_project apply (the construction was consumed or superseded). */
export function resetIncrementalDagSessionState(state: IncrementalDagSessionState): void {
	state.construction = emptyDagConstruction();
	state.tasksById.clear();
	state.rejectedOpCount = 0;
}

/**
 * Assemble the accumulated construction into decompose_project-shaped task leaves, or null when nothing was built.
 * `dependsOn` is DERIVED from the accepted edges (edge `from → to` = `to` depends on `from`), so a dependency the
 * model listed on add_task but that was rejected there can never sneak back in.
 */
export function assembleIncrementalTasks(state: IncrementalDagSessionState): NKleinPlanTask[] | null {
	if (state.construction.nodes.length === 0) {
		return null;
	}
	const dependsOnById = new Map<string, string[]>();
	for (const edge of state.construction.edges) {
		const list = dependsOnById.get(edge.to);
		if (list) {
			list.push(edge.from);
		} else {
			dependsOnById.set(edge.to, [edge.from]);
		}
	}
	const tasks: NKleinPlanTask[] = [];
	for (const node of state.construction.nodes) {
		const task = state.tasksById.get(node.id);
		if (!task) {
			continue;
		}
		tasks.push({ ...task, dependsOn: dependsOnById.get(node.id) ?? [] });
	}
	return tasks;
}

/**
 * If a decompose_project call omitted `tasks` but the session accumulated an incremental construction, inject the
 * assembled tasks (the completion route of the incremental protocol). An explicit usable `tasks` value wins — that
 * is one-shot mode, unchanged.
 */
export function injectIncrementalTasksIntoDecomposeInput(input: unknown, state: IncrementalDagSessionState): unknown {
	if (typeof input !== "object" || input === null) {
		return input;
	}
	const record = input as Record<string, unknown>;
	if (Array.isArray(record.tasks) || (typeof record.tasks === "string" && record.tasks.trim().length > 0)) {
		return input;
	}
	const assembled = assembleIncrementalTasks(state);
	if (!assembled) {
		return input;
	}
	return { ...record, tasks: assembled };
}

function progressLine(state: IncrementalDagSessionState): string {
	return `Graph so far: ${state.construction.nodes.length} task(s), ${state.construction.edges.length} dependency(ies). When the graph is complete, call decompose_project WITHOUT tasks (just slug, spec, plan) to submit it.`;
}

/**
 * Translate the core's reject message into add_dependency's vocabulary: the edge runs `dependsOn → taskId`, so the
 * core's from/to naming would point the model at the wrong argument.
 */
function describeDependencyRejection(result: Extract<DagOpResult, { ok: false }>): string {
	switch (result.reason) {
		case "unknown_from":
			return "the dependsOn task is not declared yet — add_task it first, then add this dependency";
		case "unknown_to":
			return "the taskId task is not declared yet — add_task it first, then add this dependency";
		default:
			return result.message;
	}
}

/**
 * Build the `add_task` + `add_dependency` incremental-construction tools over one shared session state.
 * Each result echoes accepted/rejected per operation with the precise reason, plus the running graph size.
 */
export function createIncrementalDagTools(state: IncrementalDagSessionState): AgentTool[] {
	const addTask: AgentTool = {
		name: "add_task",
		description:
			"Incrementally declare ONE decomposition task (validated immediately). Optional alternative to sending a full tasks array: declare tasks one by one, add dependencies with add_dependency, then call decompose_project WITHOUT tasks to submit the accumulated graph.",
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string", description: "Stable short task id, e.g. setup-db." },
				title: { type: "string", description: "Task title." },
				prompt: { type: "string", description: "What the task's worker should do." },
				dependsOn: {
					type: "array",
					items: { type: "string" },
					description:
						"Ids of already-declared tasks this one depends on (each validated; you can also use add_dependency later).",
				},
			},
			required: ["id", "title", "prompt"],
			additionalProperties: true,
		},
		async execute(input) {
			const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
			const parsed = nkleinPlanTaskSchema.safeParse(repairJsonStringValue(record));
			if (!parsed.success) {
				const issue = parsed.error.issues[0];
				throw new Error(
					`add_task needs id, title, and prompt (non-empty strings)${issue ? ` — ${issue.path.join(".") || "(root)"}: ${issue.message}` : ""}. Fix the call and resend it.`,
				);
			}
			const task = parsed.data;
			const nodeOutcome = applyDagOp(state.construction, { op: "add_node", id: task.id, label: task.title });
			if (!nodeOutcome.result.ok) {
				state.rejectedOpCount += 1;
				throw new Error(`add_task rejected (${nodeOutcome.result.reason}): ${nodeOutcome.result.message}`);
			}
			state.construction = nodeOutcome.state;
			state.tasksById.set(task.id, task);
			// Validate the inline dependencies one edge at a time — a bad one is REPORTED, not silently dropped,
			// and never blocks the already-accepted task declaration.
			const rejectedDependencies: Array<{ dependsOn: string; reason: string; message: string }> = [];
			let acceptedDependencyCount = 0;
			for (const dependency of task.dependsOn) {
				const edgeOutcome = applyDagOp(state.construction, { op: "add_edge", from: dependency, to: task.id });
				if (edgeOutcome.result.ok) {
					state.construction = edgeOutcome.state;
					acceptedDependencyCount += 1;
				} else {
					state.rejectedOpCount += 1;
					rejectedDependencies.push({
						dependsOn: dependency,
						reason: edgeOutcome.result.reason,
						message: describeDependencyRejection(edgeOutcome.result),
					});
				}
			}
			const rejectionNote =
				rejectedDependencies.length > 0
					? ` ${rejectedDependencies.length} dependency(ies) were REJECTED: ${rejectedDependencies
							.map((entry) => `"${entry.dependsOn}" (${entry.message})`)
							.join("; ")}. Fix each with add_dependency once the missing task exists.`
					: "";
			return {
				ok: true,
				taskId: task.id,
				acceptedDependencyCount,
				rejectedDependencies,
				instruction: `Task "${task.id}" added.${rejectionNote} ${progressLine(state)}`,
			};
		},
	};

	const addDependency: AgentTool = {
		name: "add_dependency",
		description:
			"Declare that one already-added task depends on another (validated immediately — rejects unknown tasks, duplicates, self-loops, and anything that would create a cycle).",
		inputSchema: {
			type: "object",
			properties: {
				taskId: { type: "string", description: "The task that DEPENDS ON the other (must exist via add_task)." },
				dependsOn: { type: "string", description: "The prerequisite task id (must exist via add_task)." },
			},
			required: ["taskId", "dependsOn"],
			additionalProperties: true,
		},
		async execute(input) {
			const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
			const taskId = typeof record.taskId === "string" ? record.taskId.trim() : "";
			const dependsOn = typeof record.dependsOn === "string" ? record.dependsOn.trim() : "";
			if (!taskId || !dependsOn) {
				throw new Error(
					"add_dependency needs taskId and dependsOn (non-empty strings). Fix the call and resend it.",
				);
			}
			const outcome = applyDagOp(state.construction, { op: "add_edge", from: dependsOn, to: taskId });
			if (!outcome.result.ok) {
				state.rejectedOpCount += 1;
				throw new Error(
					`add_dependency rejected (${outcome.result.reason}): ${describeDependencyRejection(outcome.result)}`,
				);
			}
			state.construction = outcome.state;
			return {
				ok: true,
				taskId,
				dependsOn,
				instruction: `Dependency recorded: "${taskId}" depends on "${dependsOn}". ${progressLine(state)}`,
			};
		},
	};

	return [addTask, addDependency];
}
