/** F3.T3b — compatibility gate for model-produced bounded ActionPlan IR. */

import { type ActionPlan, actionPlanSchema, validateActionPlan } from "./action-plan-ir";

export { buildActionPlanResponseSchema } from "./action-plan-producer.js";

export interface ActionPlanProducerCase {
	readonly id: string;
	readonly goal: string;
	readonly allowedTools: readonly string[];
	readonly requiredTools: readonly string[];
	/** Each pair means the first tool must precede the second through a dependency path. */
	readonly precedence: readonly (readonly [string, string])[];
}

export const ACTION_PLAN_PRODUCER_CASES: readonly ActionPlanProducerCase[] = [
	{
		id: "inspect-edit-test",
		goal: "Inspect src/config.ts, update its timeout safely, then run the focused config test.",
		allowedTools: ["read_files", "edit_file", "run_command"],
		requiredTools: ["read_files", "edit_file", "run_command"],
		precedence: [
			["read_files", "edit_file"],
			["edit_file", "run_command"],
		],
	},
	{
		id: "search-read-edit",
		goal: "Find the timeout policy symbol, inspect its file, and update the implementation.",
		allowedTools: ["search_code", "read_files", "edit_file", "run_command"],
		requiredTools: ["search_code", "read_files", "edit_file"],
		precedence: [
			["search_code", "read_files"],
			["read_files", "edit_file"],
		],
	},
	{
		id: "inspect-two-write-test",
		goal: "Read two related source files, write the coordinated replacements, then typecheck.",
		allowedTools: ["read_files", "write_files", "run_command"],
		requiredTools: ["read_files", "write_files", "run_command"],
		precedence: [
			["read_files", "write_files"],
			["write_files", "run_command"],
		],
	},
	{
		id: "search-test-only",
		goal: "Locate the existing retry tests and run only that focused test file; do not edit anything.",
		allowedTools: ["search_code", "read_files", "run_command", "edit_file"],
		requiredTools: ["search_code", "run_command"],
		precedence: [["search_code", "run_command"]],
	},
	{
		id: "read-large-summarize",
		goal: "Read a large generated report through the large-file workflow and store a compact result handle.",
		allowedTools: ["read_large_file", "store_result"],
		requiredTools: ["read_large_file", "store_result"],
		precedence: [["read_large_file", "store_result"]],
	},
	{
		id: "discover-inspect-verify",
		goal: "Discover candidate files, inspect the relevant ones, then run the repository's verification command.",
		allowedTools: ["list_files", "read_files", "run_command"],
		requiredTools: ["list_files", "read_files", "run_command"],
		precedence: [
			["list_files", "read_files"],
			["read_files", "run_command"],
		],
	},
	{
		id: "inspect-patch-lint",
		goal: "Inspect the CLI registration, apply a narrow patch, and lint the changed file.",
		allowedTools: ["read_files", "apply_patch", "run_command"],
		requiredTools: ["read_files", "apply_patch", "run_command"],
		precedence: [
			["read_files", "apply_patch"],
			["apply_patch", "run_command"],
		],
	},
	{
		id: "query-read-no-write",
		goal: "Answer which module owns model admission by searching and reading only; make no changes.",
		allowedTools: ["search_code", "read_files", "edit_file"],
		requiredTools: ["search_code", "read_files"],
		precedence: [["search_code", "read_files"]],
	},
];

function hasPath(plan: ActionPlan, fromTool: string, toTool: string): boolean {
	const fromIds = new Set(plan.steps.filter((step) => step.tool === fromTool).map((step) => step.id));
	const targets = plan.steps.filter((step) => step.tool === toTool);
	const byId = new Map(plan.steps.map((step) => [step.id, step]));
	for (const target of targets) {
		const pending = [...target.dependsOn];
		const seen = new Set<string>();
		while (pending.length > 0) {
			const id = pending.pop();
			if (!id || seen.has(id)) continue;
			if (fromIds.has(id)) return true;
			seen.add(id);
			pending.push(...(byId.get(id)?.dependsOn ?? []));
		}
	}
	return false;
}

export interface ActionPlanCandidateScore {
	readonly score: 0 | 1;
	readonly plan: ActionPlan | null;
	readonly defects: readonly string[];
}

export function scoreActionPlanCandidate(case_: ActionPlanProducerCase, value: unknown): ActionPlanCandidateScore {
	const parsed = actionPlanSchema.safeParse(value);
	if (!parsed.success) return { score: 0, plan: null, defects: ["wire_schema_invalid"] };
	const plan = parsed.data;
	const defects: string[] = [];
	const validation = validateActionPlan(plan);
	if (!validation.ok) defects.push(...validation.errors);
	if (plan.steps.length > 6) defects.push("step_bound_exceeded");
	for (const step of plan.steps) {
		if (!case_.allowedTools.includes(step.tool)) defects.push(`tool_not_allowed:${step.tool}`);
	}
	for (const tool of case_.requiredTools) {
		if (!plan.steps.some((step) => step.tool === tool)) defects.push(`required_tool_missing:${tool}`);
	}
	for (const [before, after] of case_.precedence) {
		if (!hasPath(plan, before, after)) defects.push(`precedence_missing:${before}->${after}`);
	}
	return { score: defects.length === 0 ? 1 : 0, plan, defects };
}

export function buildActionPlanProducerPrompt(case_: ActionPlanProducerCase): string {
	return [
		"Create a bounded tool ActionPlan for the goal below.",
		`Goal: ${case_.goal}`,
		`Allowed tools: ${case_.allowedTools.join(", ")}`,
		"Use only allowed tools. Give every step a unique short id, an args object, and explicit dependsOn ids.",
		"Dependencies must encode the real execution order. Do not add prose outside the JSON object.",
	].join("\n");
}
