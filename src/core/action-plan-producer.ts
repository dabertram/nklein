/** F3.T3b — shared bounded ActionPlan producer contract used by the live runtime and its fleet evaluation. */

import {
	type ActionPlan,
	actionPlanSchema,
	MAX_ACTION_PLAN_DEPENDENCIES,
	MAX_ACTION_PLAN_STEPS,
	validateActionPlan,
} from "./action-plan-ir.js";

export interface ActionPlanToolDefinition {
	readonly name: string;
	readonly description: string;
	readonly inputSchema: Record<string, unknown>;
}

export function buildActionPlanResponseSchema(allowedTools: readonly string[]): Record<string, unknown> {
	return {
		type: "object",
		additionalProperties: false,
		required: ["steps"],
		properties: {
			steps: {
				type: "array",
				minItems: 1,
				maxItems: MAX_ACTION_PLAN_STEPS,
				items: {
					type: "object",
					additionalProperties: false,
					required: ["id", "tool", "args", "dependsOn"],
					properties: {
						id: { type: "string", minLength: 1, maxLength: 48 },
						tool: { type: "string", enum: [...allowedTools] },
						args: { type: "object" },
						dependsOn: {
							type: "array",
							maxItems: MAX_ACTION_PLAN_DEPENDENCIES,
							items: { type: "string", minLength: 1, maxLength: 48 },
						},
					},
				},
			},
		},
	};
}

export interface ParsedActionPlanCandidate {
	readonly plan: ActionPlan | null;
	readonly errors: readonly string[];
}

export function parseActionPlanCandidate(value: unknown, allowedTools: readonly string[]): ParsedActionPlanCandidate {
	const parsed = actionPlanSchema.safeParse(value);
	if (!parsed.success) {
		return {
			plan: null,
			errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "plan"}: ${issue.message}`),
		};
	}
	const validation = validateActionPlan(parsed.data);
	const allowed = new Set(allowedTools);
	const unknownTools = parsed.data.steps
		.map((step) => step.tool)
		.filter((tool, index, tools) => !allowed.has(tool) && tools.indexOf(tool) === index)
		.map((tool) => `tool is not in the offered manifest: ${tool}`);
	const errors = [...validation.errors, ...unknownTools];
	return errors.length > 0 ? { plan: null, errors } : { plan: parsed.data, errors: [] };
}

export function parseActionPlanJson(content: string, allowedTools: readonly string[]): ParsedActionPlanCandidate {
	try {
		return parseActionPlanCandidate(JSON.parse(content) as unknown, allowedTools);
	} catch (error) {
		return {
			plan: null,
			errors: [`response was not JSON: ${error instanceof Error ? error.message : String(error)}`],
		};
	}
}

export function buildActionPlanRuntimePrompt(tools: readonly ActionPlanToolDefinition[]): string {
	const catalog = tools.map((tool) => {
		const schema = JSON.stringify(tool.inputSchema);
		return `- ${tool.name}: ${tool.description}\n  args schema: ${schema}`;
	});
	return [
		"Return the NEXT bounded ActionPlan needed to finish the card.",
		`Use 1-${MAX_ACTION_PLAN_STEPS} steps and only the tools listed below.`,
		"Every step needs a unique short id, the exact tool name, a complete args object, and explicit dependsOn ids.",
		"Encode the real order in dependsOn. If an earlier ActionPlan partially succeeded, never repeat completed effects; plan only the failed or remaining work.",
		"Do not emit prose outside the constrained JSON object.",
		"Available manifested tools:",
		...catalog,
	].join("\n");
}
