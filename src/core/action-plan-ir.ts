/**
 * Action-plan intermediate representation — a typed, validatable plan for multi-step tool workflows (todo §5.O).
 *
 * Small models are unreliable when asked to improvise a multi-tool sequence in free-form prose: they hallucinate tool
 * names, produce malformed argument shapes, and silently violate ordering constraints. This module defines a narrow,
 * typed IR that a model can emit in one shot: an ordered list of steps where each step names the tool to call, carries
 * its arguments, and explicitly declares which prior steps must complete first. The host validates the plan before
 * executing a single tool call, turning a silent runtime explosion into a hard, human-readable rejection at plan time.
 *
 * The key design choices:
 *   - Zod schemas are the source of truth for wire shape + inferred TypeScript types (same pattern as every other
 *     api-contract in this repo).
 *   - `dependsOn` is a step-id list (not indices) so the plan is readable even after reordering.
 *   - `validateActionPlan` is PURE — no I/O, no side effects — and collects ALL violations in one pass so the model or
 *     operator can fix them without a fix-validate-fix cycle.
 *   - The cycle check is DFS-based (same flavour as `buildDurableJobGraph` in `durable-scheduler.ts`) because the id
 *     graph can be sparse and a DFS stack is cheap.
 *
 * Consumers: the §5.O plan executor (validates before running), the §5.O plan renderer (turns a valid plan into a
 * user-facing summary), and any test harness that wants to assert on plan structure without calling real tools.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/**
 * One step in an action plan.
 *
 * - `id`        — a stable, unique identifier for this step within the plan (e.g. "fetch-card", "parse-result").
 * - `tool`      — the tool name the executor should call (e.g. "read_file", "create_card").
 * - `args`      — the argument bag to pass to the tool; values are `unknown` because each tool defines its own shape.
 * - `dependsOn` — ids of steps that must complete (succeed) before this step may run; defaults to `[]` (no deps).
 */
export const actionPlanStepSchema = z.object({
	id: z.string(),
	tool: z.string(),
	args: z.record(z.string(), z.unknown()),
	dependsOn: z.array(z.string()).default([]),
});

export type ActionPlanStep = z.infer<typeof actionPlanStepSchema>;

/**
 * A complete action plan: a non-empty, ordered sequence of steps that together accomplish a goal.
 * The ordering is informational; execution order is determined by `dependsOn` edges.
 */
export const actionPlanSchema = z.object({
	steps: z.array(actionPlanStepSchema),
});

export type ActionPlan = z.infer<typeof actionPlanSchema>;

// ---------------------------------------------------------------------------
// Pure structural validator
// ---------------------------------------------------------------------------

/**
 * Validate the structural integrity of an `ActionPlan` before any tool is called.
 *
 * Checks (all violations collected — never short-circuits):
 *   1. `steps` is non-empty.
 *   2. Step ids are unique within the plan.
 *   3. Every id listed in `dependsOn` refers to a step that actually exists in the plan.
 *   4. The dependency graph is acyclic (DFS cycle detection over the full graph).
 *
 * Returns `{ ok: true, errors: [] }` when the plan is structurally valid, or `{ ok: false, errors: [...] }` with one
 * human-readable message per violation when it is not.
 */
export function validateActionPlan(plan: ActionPlan): { ok: boolean; errors: string[] } {
	const errors: string[] = [];

	// Check 1: non-empty.
	if (plan.steps.length === 0) {
		errors.push("plan must contain at least one step");
		// With no steps there is nothing further to check.
		return { ok: false, errors };
	}

	// Build an id → step index map and detect duplicates.
	const idToIndex = new Map<string, number>();
	for (let i = 0; i < plan.steps.length; i++) {
		const step = plan.steps[i];
		// step is always defined here (index in range), but avoid the ! operator per project rules.
		if (step === undefined) {
			continue;
		}
		if (idToIndex.has(step.id)) {
			errors.push(`duplicate step id: "${step.id}"`);
		} else {
			idToIndex.set(step.id, i);
		}
	}

	// Check 3: every dependsOn id must exist.
	for (const step of plan.steps) {
		for (const depId of step.dependsOn) {
			if (!idToIndex.has(depId)) {
				errors.push(`step "${step.id}" dependsOn unknown id: "${depId}"`);
			}
		}
	}

	// Check 4: cycle detection via iterative DFS over the adjacency list.
	// We run this even when there are duplicate ids so we can surface cycle errors too (we skip edges to unknown ids
	// since those are already reported above; we only follow edges to known steps).
	const adjList = new Map<string, string[]>();
	for (const step of plan.steps) {
		const knownDeps = step.dependsOn.filter((depId) => idToIndex.has(depId));
		adjList.set(step.id, knownDeps);
	}

	// DFS colour states: 0 = unvisited, 1 = in current path (grey), 2 = fully explored (black).
	const colour = new Map<string, 0 | 1 | 2>();
	for (const step of plan.steps) {
		colour.set(step.id, 0);
	}

	// Iterative DFS using an explicit stack that stores [nodeId, neighbourIndex] so we can track the current path.
	for (const step of plan.steps) {
		if (colour.get(step.id) !== 0) {
			continue;
		}

		// Stack entries: [nodeId, nextNeighbourIndex]
		const stack: Array<[string, number]> = [[step.id, 0]];
		colour.set(step.id, 1);

		while (stack.length > 0) {
			const top = stack[stack.length - 1];
			// top is always defined while stack.length > 0.
			if (top === undefined) {
				break;
			}
			const [nodeId, neighbourIdx] = top;
			const neighbours = adjList.get(nodeId) ?? [];

			if (neighbourIdx >= neighbours.length) {
				// All neighbours explored — mark black and pop.
				colour.set(nodeId, 2);
				stack.pop();
				continue;
			}

			// Advance the neighbour pointer.
			top[1] += 1;

			const neighbourId = neighbours[neighbourIdx];
			if (neighbourId === undefined) {
				continue;
			}
			const neighbourColour = colour.get(neighbourId) ?? 0;

			if (neighbourColour === 1) {
				// Back-edge: cycle detected. Report the step that closes the cycle.
				errors.push(`dependency cycle detected: step "${nodeId}" → "${neighbourId}" forms a cycle`);
			} else if (neighbourColour === 0) {
				colour.set(neighbourId, 1);
				stack.push([neighbourId, 0]);
			}
			// neighbourColour === 2: already fully explored, safe.
		}
	}

	return { ok: errors.length === 0, errors };
}
