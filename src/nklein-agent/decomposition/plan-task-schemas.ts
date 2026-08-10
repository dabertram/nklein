import { z } from "zod";
import { nkleinPlanQuestionSchema, nkleinPlanTaskGraphSchema, nkleinPlanTaskSchema } from "../nklein-plan-artifacts";
import { repairJsonStringValue } from "../nklein-tool-argument-repair";

// Sizing constants — single owner; import from here everywhere they are needed.
export const MAX_DECOMPOSED_TASK_COMPLEXITY = 75;
export const MAX_DECOMPOSED_TASK_LIKELY_FILES = 3;
export const MAX_DECOMPOSED_TASK_EXPANSION_DEPTH = 4;
export const MAX_SHARED_PLAN_SPEC_PROMPT_CHARS = 2_400;
export const MAX_SHARED_PLAN_DECISIONS_PROMPT_CHARS = 1_600;

export const DECOMPOSE_DEPENDENCY_GUIDANCE =
	"dependsOn contains DIRECT prerequisite task ids. Hard rule: every test, verification, acceptance, coverage, or golden-output card must directly depend on at least one implementation card it verifies; every documentation card must directly depend on delivered implementation work. Example: tests.dependsOn = ['api-implementation']. Do not reverse the edge. Coverage rule: every specification bullet must be named in at least one card's prompt or acceptance check, and when a bullet states an invariant with words like pure, deterministic, stable, every, all, never, exactly, or idempotent, ECHO that exact word verbatim in the covering card — paraphrases fail the machine-auditable coverage gate on short bullets.";

export const decomposeProjectTaskJsonSchema = {
	type: "object",
	properties: {
		id: { type: "string" },
		title: {
			type: "string",
			description:
				"Action-oriented task identity. Titles containing test, verify, acceptance, coverage, or golden identify verifier cards and activate the direct implementation-dependency rule.",
		},
		prompt: { type: "string" },
		dependsOn: { type: "array", items: { type: "string" }, description: DECOMPOSE_DEPENDENCY_GUIDANCE },
		complexity: { type: "number" },
		suggestedRole: { type: ["string", "null"] },
		filesLikelyTouched: { type: "array", items: { type: "string" } },
		acceptanceCommand: { type: ["string", "null"] },
		testFirst: { type: "boolean" },
		acceptanceTestPrompt: { type: ["string", "null"] },
		testability: {
			type: "string",
			enum: ["testable", "not_testable"],
			description:
				"Upfront testability declaration. Omit or use 'testable' for any work automated tests can cover — testable cards MUST ship with a test change (test-driven delivery is on by default). Declare 'not_testable' ONLY for work tests genuinely cannot cover (pure documentation, static assets, config-only wiring verified by build) and give testabilityReason. A testFirst card is always testable.",
		},
		testabilityReason: {
			type: ["string", "null"],
			description:
				"Why automated tests cannot cover this card. Required reasoning when testability is 'not_testable'.",
		},
		knowledgeDebt: {
			type: ["string", "null"],
			description:
				"What this card still does not know about its domain and what a later card should verify. Use for domain-heavy work (e.g. DSP/audio, crypto, hardware) where assumptions are risky.",
		},
		// §5.AK work-package CONTRACT fields (all optional) — advertised here so the architect model can emit them;
		// they flow through the zod plan-task schema onto the card and into the worker's "## Card contract" brief.
		preconditions: {
			type: "array",
			items: { type: "string" },
			description:
				"What must already be true before this card starts (files/APIs that must exist, prior cards' outputs).",
		},
		inputs: {
			type: "array",
			items: { type: "string" },
			description: "Concrete inputs this card consumes (paths, configs, artifacts).",
		},
		expectedOutputs: {
			type: "array",
			items: { type: "string" },
			description: "Concrete artifacts this card must produce (paths, exported symbols, endpoints).",
		},
		acceptanceChecks: {
			type: "array",
			items: { type: "string" },
			description: "Objective pass/fail checks beyond the acceptance command (behaviors to verify).",
		},
		nonGoals: {
			type: "array",
			items: { type: "string" },
			description: "Explicitly OUT of scope for this card — what the worker must not touch or attempt.",
		},
		dependencyOutputsConsumed: {
			type: "array",
			items: { type: "string" },
			description: "Which upstream cards' outputs this card consumes (by task id or artifact).",
		},
		rollbackOrRepairHints: {
			type: "array",
			items: { type: "string" },
			description: "How to back out or repair if this card's change breaks something downstream.",
		},
		downstreamInvalidationRules: {
			type: "array",
			items: { type: "string" },
			description: "What downstream work becomes invalid if this card's interface/outputs change.",
		},
		// F1.8 work-package bounds — parallel-write safety. writeScope defaults to filesLikelyTouched when omitted.
		writeScope: {
			type: "array",
			items: { type: "string" },
			description: "Path globs this card MAY write. Omit to default to filesLikelyTouched.",
		},
		forbiddenPaths: {
			type: "array",
			items: { type: "string" },
			description: "Path globs this card must NOT touch (protected/hot files owned by other cards).",
		},
		interfaces: {
			type: "array",
			items: { type: "string" },
			description: "Interface contracts the card must keep working (function signatures, endpoints, events).",
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

// The permissive-boundary transform grew from a decompose-only fix into the session-wide tool boundary;
// the single implementation now lives in agent-tool-boundary.ts (N17 one-implementation rule) and is
// re-exported here so the decomposition modules and their tests keep their import paths.
export { relaxJsonSchemaNode, toPermissiveAgentInputSchema } from "../agent-tool-boundary";

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
