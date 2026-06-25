import { z } from "zod";
import { nkleinPlanQuestionSchema, nkleinPlanTaskGraphSchema, nkleinPlanTaskSchema } from "../nklein-plan-artifacts";
import { repairJsonStringValue } from "../nklein-tool-argument-repair";

// Sizing constants — single owner; import from here everywhere they are needed.
export const MAX_DECOMPOSED_TASK_COMPLEXITY = 75;
export const MAX_DECOMPOSED_TASK_LIKELY_FILES = 3;
export const MAX_DECOMPOSED_TASK_EXPANSION_DEPTH = 4;
export const MAX_SHARED_PLAN_SPEC_PROMPT_CHARS = 2_400;
export const MAX_SHARED_PLAN_DECISIONS_PROMPT_CHARS = 1_600;

export const decomposeProjectTaskJsonSchema = {
	type: "object",
	properties: {
		id: { type: "string" },
		title: { type: "string" },
		prompt: { type: "string" },
		dependsOn: { type: "array", items: { type: "string" } },
		complexity: { type: "number" },
		suggestedRole: { type: ["string", "null"] },
		filesLikelyTouched: { type: "array", items: { type: "string" } },
		acceptanceCommand: { type: ["string", "null"] },
		testFirst: { type: "boolean" },
		acceptanceTestPrompt: { type: ["string", "null"] },
		knowledgeDebt: {
			type: ["string", "null"],
			description:
				"What this card still does not know about its domain and what a later card should verify. Use for domain-heavy work (e.g. DSP/audio, crypto, hardware) where assumptions are risky.",
		},
	},
	required: ["id", "title", "prompt"],
	additionalProperties: false,
} as const;

export const decomposeProjectTaskArrayJsonSchema = {
	type: "array",
	items: decomposeProjectTaskJsonSchema,
} as const;

export const decomposeProjectStringifiedTaskArrayJsonSchema = {
	type: "string",
	description: "JSON-stringified array of task leaves; accepted for small models that stringify nested arrays.",
} as const;

export const decomposeProjectExpansionsJsonSchema = {
	type: "object",
	additionalProperties: decomposeProjectTaskArrayJsonSchema,
} as const;

export const decomposeProjectStringifiedExpansionsJsonSchema = {
	type: "string",
	description:
		"JSON-stringified recursive replacement map; accepted for small models that stringify nested expansion objects.",
} as const;

export function relaxJsonSchemaNode(node: unknown): unknown {
	if (Array.isArray(node)) {
		return node.map(relaxJsonSchemaNode);
	}
	if (node === null || typeof node !== "object") {
		return node;
	}
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
		if (key === "required") {
			continue;
		}
		if (key === "additionalProperties") {
			// Drop the closed-object boolean form; relax a schema-valued additionalProperties (e.g. the
			// expansions map's task-array value schema) in place rather than dropping it.
			if (typeof value !== "boolean") {
				result[key] = relaxJsonSchemaNode(value);
			}
			continue;
		}
		result[key] = relaxJsonSchemaNode(value);
	}
	if (result.type === "object" && result.additionalProperties === undefined) {
		result.additionalProperties = true;
	}
	return result;
}

/**
 * Deep-relax a JSON Schema for the SDK tool boundary so the SDK never pre-rejects a model's call before our
 * handler runs. The SDK validates the WHOLE inputSchema tree up front and answers ANY violation — a typo'd or
 * missing key at any depth (e.g. `acceptenceCommand` on a task, or an omitted `title`) — with a multi-KB raw
 * Zod dump that small local models cannot recover from (they spiral into empty `{}` retries) and that bypasses
 * our in-handler JSON repair + compact errors. We keep the strict literals above as documentation of intent but
 * strip every `required` and open `additionalProperties` on every object node before handing the schema to the
 * SDK; the in-handler zod schemas (`decomposeProjectToolInputSchema` / `nkleinPlanTaskSchema`) are the real
 * validators (they require id/title/prompt with compact errors and strip unknown keys, so a typo'd
 * `acceptanceCommand` simply falls back to `defaultAcceptanceCommand`). The `properties` descriptions are
 * preserved, so the model still gets schema guidance.
 */
export function toPermissiveAgentInputSchema(schema: Record<string, unknown>): Record<string, unknown> {
	return relaxJsonSchemaNode(schema) as Record<string, unknown>;
}

export const decomposeProjectToolInputSchema = nkleinPlanTaskGraphSchema
	.pick({
		title: true,
	})
	.extend({
		slug: nkleinPlanTaskGraphSchema.shape.slug,
		spec: nkleinPlanTaskSchema.shape.prompt.describe("Concise requirements markdown."),
		plan: nkleinPlanTaskSchema.shape.prompt.describe("Implementation plan markdown."),
		summary: nkleinPlanTaskSchema.shape.prompt
			.nullable()
			.optional()
			.describe("Plain-language plan summary markdown."),
		questions: z.array(nkleinPlanQuestionSchema).optional(),
		tasks: z.preprocess(repairJsonStringValue, z.array(nkleinPlanTaskSchema)),
		defaultAcceptanceCommand: nkleinPlanTaskSchema.shape.acceptanceCommand.optional(),
		minimumTaskCount: z.number().int().min(1).max(100).optional(),
		expansions: z.preprocess(repairJsonStringValue, z.record(z.string(), z.array(nkleinPlanTaskSchema))).optional(),
	});
