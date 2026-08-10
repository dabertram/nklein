import {
	applyDagOp,
	type DagConstruction,
	type DagOpResult,
	emptyDagConstruction,
} from "../../core/incremental-dag-construction";
import { toSlug } from "../../core/slugify";
import { type NKleinPlanTask, nkleinPlanTaskSchema } from "../nklein-plan-artifacts";
import { repairJsonStringValue } from "../nklein-tool-argument-repair";
import type { AgentTool } from "../sdk-agent-types";
import { DECOMPOSE_DEPENDENCY_GUIDANCE, toPermissiveAgentInputSchema } from "./plan-task-schemas";

/**
 * F1.7 (§5.AV) — the LIVE wiring of incremental valid-DAG construction: `add_task` / `add_dependency` tools whose
 * handlers run the pure {@link applyDagOp} state machine, so the planning agent can build the decomposition graph
 * one validated operation at a time and an invalid graph is impossible to ACCUMULATE (always acyclic, every edge
 * between declared tasks). A rejected op leaves the construction untouched and returns the core's precise reason so
 * the model corrects the single bad operation instead of redoing the whole graph.
 *
 * The protocol composes with the existing flow instead of replacing it: the model finishes by calling
 * `decompose_project` WITHOUT `tasks`, and the accumulated construction is assembled into the task list (dependsOn
 * derived from the accepted edges — the construction is the single source of dependency truth). Once construction
 * has begun, it remains authoritative even if the model redundantly passes `tasks` to `decompose_project`. One-shot
 * mode (passing `tasks` directly) stays fully supported when no incremental nodes were accepted.
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
	/** A rejected assembled submission may be replaced by an explicit corrected tasks array on the next call. */
	allowTaskArrayRevision: boolean;
}

export function createIncrementalDagSessionState(): IncrementalDagSessionState {
	return {
		construction: emptyDagConstruction(),
		tasksById: new Map(),
		rejectedOpCount: 0,
		allowTaskArrayRevision: false,
	};
}

/** Reset after a successful decompose_project apply (the construction was consumed or superseded). */
export function resetIncrementalDagSessionState(state: IncrementalDagSessionState): void {
	state.construction = emptyDagConstruction();
	state.tasksById.clear();
	state.rejectedOpCount = 0;
	state.allowTaskArrayRevision = false;
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
 * If the session accumulated an incremental construction, inject its assembled tasks into decompose_project. Once the
 * model starts incremental mode, that validated state is authoritative even if a weak model redundantly embeds a full
 * tasks array in the final call (live run 20260721-140808). Once validation rejects the assembled graph, however, an
 * explicit tasks array is a repair payload and must be honored: otherwise the stale incremental payload replaces the
 * correction and returns the same error forever (live run 20260721-145742). One-shot mode remains unchanged when no
 * incremental node exists.
 */
export function injectIncrementalTasksIntoDecomposeInput(input: unknown, state: IncrementalDagSessionState): unknown {
	if (typeof input !== "object" || input === null) {
		return input;
	}
	const record = input as Record<string, unknown>;
	if (state.allowTaskArrayRevision && record.tasks !== undefined) {
		return input;
	}
	const assembled = assembleIncrementalTasks(state);
	if (!assembled) {
		return input;
	}
	return { ...record, tasks: assembled };
}

/**
 * Synthesize the plan document from the accumulated construction itself. The construction is already the single
 * source of dependency truth (see assembleIncrementalTasks), so a plan derived from it cannot drift from the
 * graph — unlike a model re-transcription, which is exactly what the live 20260810-101125 run showed failing:
 * the model built a perfect 15-card graph through add_task, then died three times trying to re-emit the plan as
 * inline finalize prose (two empty calls, one cut mid-payload by the turn token budget). 15 validated cards were
 * discarded for want of re-typed documents the session already contained.
 */
export function synthesizePlanFromConstruction(state: IncrementalDagSessionState): string {
	const dependsOnById = new Map<string, string[]>();
	for (const edge of state.construction.edges) {
		const list = dependsOnById.get(edge.to);
		if (list) {
			list.push(edge.from);
		} else {
			dependsOnById.set(edge.to, [edge.from]);
		}
	}
	const sections = state.construction.nodes.map((node) => {
		const task = state.tasksById.get(node.id);
		const title = task?.title?.trim() || node.label || node.id;
		const prompt = task?.prompt?.trim() || "";
		const dependsOn = dependsOnById.get(node.id) ?? [];
		const dependsLine = dependsOn.length > 0 ? `\nDepends on: ${dependsOn.join(", ")}` : "";
		return `## ${node.id} — ${title}\n${prompt}${dependsLine}`;
	});
	return [
		`# Implementation plan — ${state.construction.nodes.length} task(s), ${state.construction.edges.length} dependency edge(s)`,
		"",
		"(Synthesized from the accumulated add_task/add_dependency graph — the single source of dependency truth.)",
		"",
		sections.join("\n\n"),
	].join("\n");
}

/**
 * Recover missing finalize METADATA from the accumulated construction, mirroring how the tasks array is already
 * injected: once the model has done the real work through the validated incremental protocol, the closing call
 * must never be rejected — and the graph never discarded — for want of re-stated prose. `slug` derives from the
 * first declared task; `plan` is synthesized from the graph. `spec` is NOT handled here (it needs workspace IO —
 * see the decompose_project execute path, which reads specification.md). Fields the model did pass are kept
 * verbatim; one-shot mode (empty construction) is untouched, so its strict validation still guides.
 */
export function recoverIncrementalDecomposeMeta(input: unknown, state: IncrementalDagSessionState): unknown {
	if (state.construction.nodes.length === 0) {
		return input;
	}
	const record = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
	const next: Record<string, unknown> = { ...record };
	let changed = typeof input !== "object" || input === null;
	const slugPresent = typeof next.slug === "string" && next.slug.trim().length > 0;
	if (!slugPresent) {
		const first = state.construction.nodes[0];
		next.slug = toSlug(first?.label ?? "") || toSlug(first?.id ?? "") || "plan";
		changed = true;
	}
	const planPresent = typeof next.plan === "string" && next.plan.trim().length > 0;
	if (!planPresent) {
		next.plan = synthesizePlanFromConstruction(state);
		changed = true;
	}
	return changed ? next : input;
}

function progressLine(state: IncrementalDagSessionState): string {
	return `Graph so far: ${state.construction.nodes.length} task(s), ${state.construction.edges.length} dependency(ies). When the graph is complete, call decompose_project with NO arguments to submit it — slug, spec, and plan fill in automatically (pass them only to override).`;
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
		// Live 20260810-195244: ten add_task calls (truncated {} emissions) were SDK-pre-rejected against this
		// schema's required/type keywords, each answered with a multi-KB Zod dump the execute path would have
		// answered compactly ("add_task needs id, title, and prompt... resend"). Same permissive-boundary rule
		// as decompose_project: the handler validates, the boundary never pre-rejects.
		inputSchema: toPermissiveAgentInputSchema({
			type: "object",
			properties: {
				id: { type: "string", description: "Stable short task id, e.g. setup-db." },
				title: {
					type: "string",
					description:
						"Action-oriented task identity. Test/verify/acceptance/coverage/golden titles identify verifier cards.",
				},
				prompt: { type: "string", description: "What the task's worker should do." },
				dependsOn: {
					type: "array",
					items: { type: "string" },
					description: `${DECOMPOSE_DEPENDENCY_GUIDANCE} Dependencies must already be declared; you can also use add_dependency later.`,
				},
			},
			required: ["id", "title", "prompt"],
			additionalProperties: true,
		}),
		async execute(input) {
			const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
			const parsed = nkleinPlanTaskSchema.safeParse(repairJsonStringValue(record));
			if (!parsed.success) {
				// Live 20260811-000253: after four perfect 1-2KB add_task calls the model degenerated to EMPTY
				// calls — it planned "S05" in its reasoning, then emitted `<function=add_task></function>` three
				// times and the mistake streak stopped a healthy session. For the empty case, anchor the coaching
				// to the model's OWN recent success (it demonstrably knows the format) instead of restating the
				// schema it just used correctly.
				if (Object.keys(record).length === 0 && state.construction.nodes.length > 0) {
					const lastId = state.construction.nodes[state.construction.nodes.length - 1]?.id ?? "the last task";
					throw new Error(
						`add_task arrived with NO arguments — you planned the task in your reasoning but emitted an empty call. ` +
							`Re-send it with the fields written INSIDE the tool call, exactly like your successful add_task for "${lastId}": ` +
							`id, title, and prompt (plus optional card fields).`,
					);
				}
				const issue = parsed.error.issues[0];
				throw new Error(
					`add_task needs id, title, and prompt (non-empty strings)${issue ? ` — ${issue.path.join(".") || "(root)"}: ${issue.message}` : ""}. Fix the call and resend it.`,
				);
			}
			const task = parsed.data;
			const existing = state.tasksById.get(task.id);
			if (existing) {
				// Idempotent replay: a session restarted with its conversation intact (or a model re-sending its
				// list) re-declares tasks it already declared. An IDENTICAL payload is a no-op success, same as
				// add_dependency's duplicate-edge handling — never a rejection spiral.
				if (JSON.stringify(existing) === JSON.stringify(task)) {
					return {
						ok: true,
						taskId: task.id,
						alreadyPresent: true,
						acceptedDependencyCount: 0,
						rejectedDependencies: [],
						instruction: `Task "${task.id}" was already declared with this exact content. No change was needed. ${progressLine(state)}`,
					};
				}
				// Post-bounce repair (live 20260810-103422): after the assembled graph was REJECTED by validation
				// ("S01 touches 5 likely files"), the model's instinct — re-declare the task smaller under the
				// same id — bounced as duplicate_node, leaving NO small-call repair path: the stale construction
				// resubmitted the same oversized task forever. After a bounce, same-id add_task REPLACES the
				// earlier declaration (edges kept; inline dependsOn processed with duplicates tolerated).
				if (state.allowTaskArrayRevision) {
					state.tasksById.set(task.id, task);
					let acceptedDependencyCount = 0;
					const rejectedDependencies: Array<{ dependsOn: string; reason: string; message: string }> = [];
					for (const dependency of task.dependsOn) {
						const edgeOutcome = applyDagOp(state.construction, {
							op: "add_edge",
							from: dependency,
							to: task.id,
						});
						if (edgeOutcome.result.ok) {
							state.construction = edgeOutcome.state;
							acceptedDependencyCount += 1;
						} else if (edgeOutcome.result.reason !== "duplicate_edge") {
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
									.join("; ")}.`
							: "";
					return {
						ok: true,
						taskId: task.id,
						replaced: true,
						acceptedDependencyCount,
						rejectedDependencies,
						instruction: `Task "${task.id}" REPLACED the earlier declaration (existing edges were kept).${rejectionNote} ${progressLine(state)}`,
					};
				}
			}
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
			const acceptedEdgeNote =
				acceptedDependencyCount > 0
					? ` ${acceptedDependencyCount} inline dependency edge(s) were accepted; do NOT repeat them with add_dependency.`
					: "";
			return {
				ok: true,
				taskId: task.id,
				acceptedDependencyCount,
				rejectedDependencies,
				instruction: `Task "${task.id}" added.${acceptedEdgeNote}${rejectionNote} ${progressLine(state)}`,
			};
		},
	};

	const addDependency: AgentTool = {
		name: "add_dependency",
		description:
			"Declare that one already-added task depends on another (validated immediately — rejects unknown tasks, duplicates, self-loops, and anything that would create a cycle).",
		inputSchema: toPermissiveAgentInputSchema({
			type: "object",
			properties: {
				taskId: { type: "string", description: "The task that DEPENDS ON the other (must exist via add_task)." },
				dependsOn: { type: "string", description: "The prerequisite task id (must exist via add_task)." },
			},
			required: ["taskId", "dependsOn"],
			additionalProperties: true,
		}),
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
				if (outcome.result.reason === "duplicate_edge") {
					return {
						ok: true,
						taskId,
						dependsOn,
						alreadyPresent: true,
						instruction: `Dependency already recorded: "${taskId}" depends on "${dependsOn}". No change was needed. ${progressLine(state)}`,
					};
				}
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
