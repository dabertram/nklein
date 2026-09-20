/**
 * The DETAILED STEP PLAN — the per-card artifact of the step-planning stage (David 2026-09-20: "steps planned in
 * every detail before getting executed .. a review round .. properly replanned .. so that even 9B models can excel
 * because perfect instructions"). PURE: schema, structural validation, capability tagging, rendering.
 *
 * ── WHY A SEPARATE ARTIFACT ──
 * The decomposition critique (W4.3) judges CARD CONTRACTS; the F12.62 architect brief is one prose blob nobody
 * reviews; the F3.T3 ActionPlan is a ≤6-tool-call graph the runtime executes itself; the refinement pass is the
 * worker deciding for itself. None of them hands a small model ONE step with the exact files, the concrete change,
 * the commands, the acceptance and the must-nots spelled out. This artifact does, and it is the unit the plan
 * reviewer approves, the replanner rewrites (keeping history) and the execution controller walks one step at a time.
 *
 * ── DESIGN CHOICES ──
 * - Zod is the source of truth for the wire shape (the planner submits it through `submit_step_plan`), tolerant of
 *   the junk-args shapes small models emit: unknown keys are stripped, list-ish fields coerce a bare string to a
 *   one-element list, and every optional list defaults to `[]`.
 * - `validateStepPlan` is PURE and collects EVERY violation in one pass, so the planner fixes them in one revision
 *   (the same discipline as `validateActionPlan`).
 * - Difficulty rides the F3.41 scale: a step's `difficulty` label + file count map to a capability floor through
 *   the SAME `requiredCapabilityForCard`, so "which steps can the 9B do" reads off the fleet tiers already in code.
 * - Rendering is deterministic text so the worker instruction is unit-testable byte-for-byte.
 */

import { z } from "zod";
import { type ModelSizeTier, requiredCapabilityForCard, smallestTierClearing } from "./model-size-tier-capability";

export const STEP_PLAN_SCHEMA_VERSION = 1;
/** A plan longer than this is a decomposition problem, not an instruction problem — split the card instead. */
export const MAX_STEP_PLAN_STEPS = 12;

export const STEP_DIFFICULTIES = ["trivial", "easy", "medium", "hard"] as const;
export type StepDifficulty = (typeof STEP_DIFFICULTIES)[number];

/** Complexity (F3.41 0-100 scale) each step difficulty label stands for — the same scale the decomposer sizes cards on. */
export const STEP_DIFFICULTY_COMPLEXITY: Readonly<Record<StepDifficulty, number>> = {
	trivial: 15,
	easy: 30,
	medium: 50,
	hard: 70,
};

export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";

/** Coerce a bare string (or null/undefined) into a string list; small models routinely emit `"x"` for `["x"]`. */
const stringList = z.preprocess(
	(value) => (typeof value === "string" ? [value] : value === null || value === undefined ? [] : value),
	z.array(z.string().trim().min(1)),
);

const optionalText = z.preprocess(
	(value) => (typeof value === "string" ? (value.trim() ? value.trim() : null) : null),
	z.string().nullable(),
);

export const stepFileChangeSchema = z.object({
	/** Workspace-relative path (never absolute, never a host path). */
	path: z.string().trim().min(1),
	/** The function/class/section to touch, when the change is narrower than the file. */
	symbol: optionalText.default(null),
	/** The concrete change, stated so no judgment call is left: "add a `--json` flag that prints …". */
	change: z.string().trim().min(1),
});
export type StepFileChange = z.infer<typeof stepFileChangeSchema>;

export const stepAcceptanceSchema = z.object({
	/** A shell command the harness runs in the worker's sandbox after the step; exit 0 = accepted. */
	command: optionalText.default(null),
	/** What must be true afterwards, in one sentence a reviewer can check. */
	check: z.string().trim().min(1),
});
export type StepAcceptance = z.infer<typeof stepAcceptanceSchema>;

export const stepVerifySchema = z.object({
	/** The fact this step relies on ("`fetch` in Node 22 supports `signal`", "pydantic v2 renamed `.dict()`"). */
	claim: z.string().trim().min(1),
	/** The `lookup` query that settles it. */
	query: z.string().trim().min(1),
});
export type StepVerify = z.infer<typeof stepVerifySchema>;

export const stepPlanStepSchema = z.object({
	id: z.string().trim().min(1).max(48),
	title: z.string().trim().min(1),
	/** Why this step exists, in one or two sentences — the worker's "what am I doing and why". */
	intent: z.string().trim().min(1),
	files: z.array(stepFileChangeSchema).default([]),
	/** Commands the worker runs during the step (install, generate, run a focused test), in order. */
	commands: stringList.default([]),
	expectedOutcome: z.string().trim().min(1),
	acceptance: stepAcceptanceSchema,
	/** Facts/values/paths the step needs that come from earlier steps or the card. */
	inputs: stringList.default([]),
	/** What the step must NOT do (touch other files, refactor, change tests, guess a value…). */
	mustNot: stringList.default([]),
	difficulty: z.enum(STEP_DIFFICULTIES).default("medium"),
	/** Present when the step's correctness rests on a fact the model may only know from memory. */
	verify: stepVerifySchema.nullable().default(null),
});
export type StepPlanStep = z.infer<typeof stepPlanStepSchema>;

export const stepOutcomeSchema = z.object({
	stepId: z.string().min(1),
	status: z.enum(["done", "failed", "skipped"]),
	/** The worker's completion note or the acceptance failure output (bounded by the caller). */
	note: z.string().default(""),
	/** Lookup receipt ids cited for a `verify` step. */
	citations: z.array(z.string()).default([]),
	at: z.number(),
});
export type StepOutcome = z.infer<typeof stepOutcomeSchema>;

export const REPLAN_TRIGGERS = [
	"step_failed",
	"worker_blocked",
	"review_bounce",
	"base_changed",
	"user_steer",
] as const;
export type ReplanTrigger = (typeof REPLAN_TRIGGERS)[number];

export const stepPlanHistoryEntrySchema = z.object({
	revision: z.number().int().nonnegative(),
	trigger: z.enum(REPLAN_TRIGGERS).nullable(),
	/** What was tried and why it failed — the memory the next planner MUST read. */
	summary: z.string(),
	/** Step ids that were DONE at the time of the replan; a replan must never repeat them. */
	completedStepIds: z.array(z.string()).default([]),
	at: z.number(),
});
export type StepPlanHistoryEntry = z.infer<typeof stepPlanHistoryEntrySchema>;

/** The shape the planner SUBMITS (no runtime bookkeeping). */
export const stepPlanSubmissionSchema = z.object({
	objective: z.string().trim().min(1),
	steps: z.array(stepPlanStepSchema),
	/** The planner's own assumptions, stated so the reviewer can challenge them. */
	assumptions: stringList.default([]),
});
export type StepPlanSubmission = z.infer<typeof stepPlanSubmissionSchema>;

/** The persisted artifact: the submission plus runtime bookkeeping. */
export const stepPlanSchema = stepPlanSubmissionSchema.extend({
	schemaVersion: z.literal(STEP_PLAN_SCHEMA_VERSION),
	cardId: z.string().min(1),
	/** 0 for the first accepted plan; +1 per replan. */
	revision: z.number().int().nonnegative(),
	/** The base the plan was written against; a moved base is a replan trigger. */
	baseRef: z.string().nullable(),
	status: z.enum(["draft", "in_review", "approved", "executing", "completed", "abandoned"]),
	outcomes: z.array(stepOutcomeSchema).default([]),
	history: z.array(stepPlanHistoryEntrySchema).default([]),
	createdAt: z.number(),
	updatedAt: z.number(),
});
export type StepPlan = z.infer<typeof stepPlanSchema>;

// ---------------------------------------------------------------------------
// Structural validation
// ---------------------------------------------------------------------------

export interface StepPlanValidation {
	ok: boolean;
	errors: string[];
}

function looksLikeHostPath(path: string): boolean {
	return (
		path.startsWith("/") ||
		path.startsWith("~") ||
		/^[A-Za-z]:[\\/]/.test(path) ||
		path.includes("/workspaces/") ||
		path.includes("/private/var/") ||
		path.includes("/Users/") ||
		path.includes("/home/")
	);
}

/**
 * Validate a submitted plan before it is stored or reviewed. Collects every violation; never short-circuits. These are
 * the checks a machine can make — the semantic checks (is the change right? is a fact asserted from memory?) are the
 * plan reviewer's job (`step-plan-review.ts`).
 */
export function validateStepPlan(plan: StepPlanSubmission): StepPlanValidation {
	const errors: string[] = [];
	if (plan.steps.length === 0) {
		errors.push("plan must contain at least one step");
	}
	if (plan.steps.length > MAX_STEP_PLAN_STEPS) {
		errors.push(
			`plan has ${plan.steps.length} steps; the maximum is ${MAX_STEP_PLAN_STEPS} — this card should be split, not planned longer`,
		);
	}
	const seen = new Set<string>();
	for (const step of plan.steps) {
		if (seen.has(step.id)) {
			errors.push(`duplicate step id "${step.id}"`);
		}
		seen.add(step.id);
		if (step.files.length === 0 && step.commands.length === 0) {
			errors.push(`step "${step.id}" touches no files and runs no commands — a step must do something concrete`);
		}
		for (const file of step.files) {
			if (looksLikeHostPath(file.path)) {
				errors.push(`step "${step.id}" names a non-workspace path "${file.path}" — use a workspace-relative path`);
			}
		}
		if (step.verify && step.verify.claim.trim().length < 8) {
			errors.push(`step "${step.id}" has a verify block whose claim is too vague to look up`);
		}
	}
	return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Capability tagging (F3.41)
// ---------------------------------------------------------------------------

export interface StepCapabilityTag {
	difficulty: StepDifficulty;
	/** The F3.41 capability floor (0-100) a model should clear to execute this step alone. */
	requiredCapability: number;
	/** The smallest model-size tier whose best-in-class prior clears the floor (null ⇒ beyond every known tier). */
	smallestTier: ModelSizeTier | null;
}

export function stepCapabilityTag(step: Pick<StepPlanStep, "difficulty" | "files">): StepCapabilityTag {
	const requiredCapability = requiredCapabilityForCard({
		complexity: STEP_DIFFICULTY_COMPLEXITY[step.difficulty],
		likelyFileCount: Math.max(1, step.files.length),
		difficulty: step.difficulty,
	});
	return { difficulty: step.difficulty, requiredCapability, smallestTier: smallestTierClearing(requiredCapability) };
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export function stepStatus(plan: Pick<StepPlan, "outcomes">, stepId: string): StepStatus {
	// The LAST outcome for a step wins (a failed step can be retried after a replan that keeps its id).
	for (let index = plan.outcomes.length - 1; index >= 0; index -= 1) {
		const outcome = plan.outcomes[index];
		if (outcome.stepId === stepId) {
			return outcome.status;
		}
	}
	return "pending";
}

/** The first step that is not done/skipped, or null when the plan is complete. */
export function nextPendingStep(plan: Pick<StepPlan, "steps" | "outcomes">): StepPlanStep | null {
	return (
		plan.steps.find((step) => {
			const status = stepStatus(plan, step.id);
			return status !== "done" && status !== "skipped";
		}) ?? null
	);
}

export function completedStepIds(plan: Pick<StepPlan, "steps" | "outcomes">): string[] {
	return plan.steps.filter((step) => stepStatus(plan, step.id) === "done").map((step) => step.id);
}

export interface StepPlanProgress {
	total: number;
	done: number;
	failed: number;
	nextStepId: string | null;
}

export function stepPlanProgress(plan: Pick<StepPlan, "steps" | "outcomes">): StepPlanProgress {
	let done = 0;
	let failed = 0;
	for (const step of plan.steps) {
		const status = stepStatus(plan, step.id);
		if (status === "done" || status === "skipped") {
			done += 1;
		} else if (status === "failed") {
			failed += 1;
		}
	}
	return { total: plan.steps.length, done, failed, nextStepId: nextPendingStep(plan)?.id ?? null };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderList(label: string, items: readonly string[]): string[] {
	return items.length === 0 ? [] : [`${label}:`, ...items.map((item) => `- ${item}`)];
}

/** One step as a compact block — used by the review rendering and the overview inside a worker instruction. */
export function renderStepSummary(step: StepPlanStep, index: number, status: StepStatus = "pending"): string {
	const tag = stepCapabilityTag(step);
	const marker =
		status === "done" ? "[done] " : status === "failed" ? "[failed] " : status === "skipped" ? "[skipped] " : "";
	return `${index + 1}. ${marker}${step.id} — ${step.title} (difficulty ${step.difficulty}, capability floor ${tag.requiredCapability}${tag.smallestTier ? `, tier ${tag.smallestTier}` : ""}${step.verify ? ", verify" : ""})`;
}

/** The whole plan as the reviewer sees it: every field of every step, nothing summarized away. */
export function renderStepPlanForReview(
	plan: StepPlanSubmission & Partial<Pick<StepPlan, "history" | "outcomes">>,
): string {
	const lines: string[] = [`Objective: ${plan.objective}`];
	if (plan.assumptions.length > 0) {
		lines.push("", ...renderList("Planner assumptions (challenge these)", plan.assumptions));
	}
	plan.steps.forEach((step, index) => {
		lines.push("", `### Step ${index + 1}: ${step.id} — ${step.title}`);
		lines.push(`Difficulty: ${step.difficulty} (capability floor ${stepCapabilityTag(step).requiredCapability})`);
		lines.push(`Intent: ${step.intent}`);
		if (step.files.length > 0) {
			lines.push("Files:");
			for (const file of step.files) {
				lines.push(`- ${file.path}${file.symbol ? ` :: ${file.symbol}` : ""} — ${file.change}`);
			}
		}
		lines.push(...renderList("Commands", step.commands));
		lines.push(...renderList("Inputs", step.inputs));
		lines.push(`Expected outcome: ${step.expectedOutcome}`);
		lines.push(
			`Acceptance: ${step.acceptance.check}${step.acceptance.command ? ` (command: \`${step.acceptance.command}\`)` : " (no command — reviewer: is that acceptable?)"}`,
		);
		lines.push(...renderList("Must NOT", step.mustNot));
		if (step.verify) {
			lines.push(`Verify (fact): ${step.verify.claim} — lookup query: "${step.verify.query}"`);
		}
	});
	const history = plan.history ?? [];
	if (history.length > 0) {
		lines.push("", "### History (earlier revisions of this plan)");
		for (const entry of history) {
			lines.push(`- revision ${entry.revision}${entry.trigger ? ` (${entry.trigger})` : ""}: ${entry.summary}`);
		}
	}
	return lines.join("\n");
}

export interface RenderStepInstructionOptions {
	/** Whether the `lookup` tool is attached to the executing session (adds the never-from-memory mandate). */
	lookupAvailable: boolean;
	/** A short note about the previous attempt at this step (acceptance output), when retrying. */
	retryNote?: string | null;
	/** Attempt counter shown to the model ("attempt 2 of 2"). */
	attempt?: { current: number; max: number } | null;
}

/**
 * ONE step as a self-contained instruction for the executing worker: no exploration needed, no judgment calls left,
 * the acceptance and the must-nots explicit, and the `complete_step` hand-back contract stated. The plan overview is
 * included so the model knows where the step sits — but it is told to do ONLY this step.
 */
export function renderStepInstruction(
	plan: Pick<StepPlan, "objective" | "steps" | "outcomes">,
	step: StepPlanStep,
	options: RenderStepInstructionOptions,
): string {
	const index = plan.steps.findIndex((candidate) => candidate.id === step.id);
	const lines: string[] = [
		`[!Klein step plan — step ${index + 1} of ${plan.steps.length}: ${step.id} — ${step.title}]`,
		`Card objective: ${plan.objective}`,
		"",
		"Plan overview (do ONLY the current step; earlier steps are done, later steps are not yours yet):",
		...plan.steps.map((candidate, candidateIndex) =>
			renderStepSummary(candidate, candidateIndex, stepStatus(plan, candidate.id)),
		),
		"",
		`## Current step: ${step.title}`,
		`Intent: ${step.intent}`,
	];
	if (options.attempt && options.attempt.current > 1) {
		lines.push(`This is attempt ${options.attempt.current} of ${options.attempt.max} for this step.`);
	}
	if (options.retryNote?.trim()) {
		lines.push(
			"",
			"The previous attempt at this step did NOT pass its acceptance. Output:",
			options.retryNote.trim(),
		);
	}
	if (step.files.length > 0) {
		lines.push("", "Files to touch (exactly these):");
		for (const file of step.files) {
			lines.push(`- ${file.path}${file.symbol ? ` (${file.symbol})` : ""}: ${file.change}`);
		}
	}
	if (step.commands.length > 0) {
		lines.push("", "Commands to run, in order:", ...step.commands.map((command) => `- ${command}`));
	}
	if (step.inputs.length > 0) {
		lines.push(
			"",
			"Inputs you need (already established — do not re-derive):",
			...step.inputs.map((item) => `- ${item}`),
		);
	}
	lines.push("", `Expected outcome: ${step.expectedOutcome}`);
	lines.push(
		`Acceptance for this step: ${step.acceptance.check}${step.acceptance.command ? ` — !Klein will run \`${step.acceptance.command}\` when you call complete_step; make it pass first.` : ""}`,
	);
	const mustNot = [
		...step.mustNot,
		"do not start any other step, refactor unrelated code, or change files this step does not name",
	];
	lines.push("", "Must NOT:", ...mustNot.map((item) => `- ${item}`));
	if (step.verify) {
		lines.push(
			"",
			`Verify FIRST (this step rests on a fact): "${step.verify.claim}".`,
			options.lookupAvailable
				? `Call lookup with the query "${step.verify.query}" (then lookup the best result URL), and pass the URL(s) you relied on as \`citations\` to complete_step. A verify step without citations is refused.`
				: "The lookup tool is not available in this session: state in your completion note that the fact was NOT verified online, and do not claim more certainty than you have.",
		);
	}
	if (options.lookupAvailable) {
		lines.push(
			"",
			"Never assert an API signature, version number, library behaviour or real-world value from memory: call lookup and cite the URL. If lookup finds nothing, say so in your completion note.",
		);
	}
	lines.push(
		"",
		"When the step is done, call complete_step with `stepId` and a short `note` of what you changed (and `citations` for a verify step). The result tells you the next step or that the work is delivered. If you cannot complete the step as written, call complete_step with `blocked` explaining why — do not improvise around the plan.",
	);
	return lines.join("\n");
}
