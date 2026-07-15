import { type ActionPlan, type ActionPlanStep, validateActionPlan } from "./action-plan-ir.js";

/**
 * F3.T3 — execute an {@link ActionPlan} end to end. Validates the plan first (structural integrity), runs the steps in
 * DEPENDENCY order (a step runs only after every `dependsOn` step succeeded), CHECKPOINTS after each completed step, and
 * on a step failure STOPS — marking the failed step and SKIPPING every step that (transitively) depended on it, so the
 * caller can replan just that one step and resume rather than re-running the whole plan. Every effect (the actual tool
 * dispatch) is INJECTED, so the whole executor is unit-testable with a mock dispatcher; it decides order + failure
 * propagation purely.
 */

export interface ActionPlanStepResult {
	stepId: string;
	ok: boolean;
	output?: unknown;
	error?: string;
}

export interface ActionPlanExecutionResult {
	status: "completed" | "failed" | "invalid";
	/** Steps that ran and succeeded, in execution order. */
	completed: ActionPlanStepResult[];
	/** The first step that failed, or null when the plan completed / was invalid. */
	failed: ActionPlanStepResult | null;
	/** Ids of steps not run because a (transitive) dependency failed. */
	skipped: string[];
	/** Validation errors when `status` is `invalid`. */
	errors: string[];
}

export interface ActionPlanExecutorDeps {
	/** Dispatch one step's tool call; receives prior steps' outputs keyed by step id. */
	dispatch: (
		step: ActionPlanStep,
		priorOutputs: ReadonlyMap<string, unknown>,
	) => Promise<{ ok: boolean; output?: unknown; error?: string }>;
	/** Optional observability hook fired after each completed step (for durable checkpointing). */
	onCheckpoint?: (completed: readonly ActionPlanStepResult[]) => void;
}

/** Kahn topological order over `dependsOn`; the plan is already validated acyclic, so this always drains. */
function topologicalOrder(plan: ActionPlan): ActionPlanStep[] {
	const byId = new Map(plan.steps.map((step) => [step.id, step]));
	const indegree = new Map<string, number>(plan.steps.map((step) => [step.id, step.dependsOn.length]));
	const ready = plan.steps.filter((step) => step.dependsOn.length === 0).map((step) => step.id);
	const dependents = new Map<string, string[]>();
	for (const step of plan.steps) {
		for (const dep of step.dependsOn) {
			dependents.set(dep, [...(dependents.get(dep) ?? []), step.id]);
		}
	}
	const ordered: ActionPlanStep[] = [];
	while (ready.length > 0) {
		const id = ready.shift();
		if (id === undefined) {
			break;
		}
		const step = byId.get(id);
		if (step) {
			ordered.push(step);
		}
		for (const dependent of dependents.get(id) ?? []) {
			const next = (indegree.get(dependent) ?? 0) - 1;
			indegree.set(dependent, next);
			if (next === 0) {
				ready.push(dependent);
			}
		}
	}
	return ordered;
}

export async function executeActionPlan(
	plan: ActionPlan,
	deps: ActionPlanExecutorDeps,
): Promise<ActionPlanExecutionResult> {
	const validation = validateActionPlan(plan);
	if (!validation.ok) {
		return { status: "invalid", completed: [], failed: null, skipped: [], errors: validation.errors };
	}

	const ordered = topologicalOrder(plan);
	const outputs = new Map<string, unknown>();
	const completed: ActionPlanStepResult[] = [];
	const failedDeps = new Set<string>();

	for (const step of ordered) {
		// Skip a step whose any dependency failed / was skipped (transitive via failedDeps membership).
		if (step.dependsOn.some((dep) => failedDeps.has(dep))) {
			failedDeps.add(step.id);
			continue;
		}
		const result = await deps.dispatch(step, outputs);
		if (result.ok) {
			outputs.set(step.id, result.output);
			const stepResult: ActionPlanStepResult = { stepId: step.id, ok: true, output: result.output };
			completed.push(stepResult);
			deps.onCheckpoint?.(completed);
		} else {
			failedDeps.add(step.id);
			const failed: ActionPlanStepResult = {
				stepId: step.id,
				ok: false,
				...(result.error ? { error: result.error } : {}),
			};
			// Continue the loop only to collect transitively-skipped dependents; nothing else executes.
			const skipped: string[] = [];
			for (const later of ordered) {
				if (later.id === step.id) {
					continue;
				}
				if (later.dependsOn.some((dep) => failedDeps.has(dep))) {
					failedDeps.add(later.id);
					skipped.push(later.id);
				}
			}
			return { status: "failed", completed, failed, skipped, errors: [] };
		}
	}
	return { status: "completed", completed, failed: null, skipped: [], errors: [] };
}
