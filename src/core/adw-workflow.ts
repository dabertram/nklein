/**
 * F12.107 first-class ADW definitions — the PURE half. An AI Developer Workflow is HUMAN-authored process
 * structure the factory executes repeatedly: an ordered list of steps, each either DETERMINISTIC (a host-side
 * shell command whose captured output is evidence) or AGENT (a board card seeded and awaited through the normal
 * lifecycle), with per-step verify gates and a final verdict. Distinct from §5.AE skills (single-prompt
 * packages) and from decompose (model-planned): the deterministic glue is code, the nondeterministic middle is
 * cards — "deterministic code around nondeterministic agent steps".
 *
 * This module owns the definition schema (`.nklein/workflows/<name>.json`), token substitution, per-step verify
 * evaluation, the final-verdict fold, and the ORCHESTRATOR over injected step executors. The CLI wires the real
 * executors (execFile / createTask + board polling); tests inject fakes.
 */

import { z } from "zod";

export const ADW_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const ADW_STEP_OUTPUT_TAIL_CHARS = 2_000;

const adwStepIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/, "step ids are lowercase kebab, max 48 chars");

export const adwDeterministicStepSchema = z.object({
	id: adwStepIdSchema,
	kind: z.literal("deterministic"),
	title: z.string().min(1).optional(),
	/** Host-side `sh -c` command. Tokens: {input}, {workflow}, {timestamp}, {steps.<id>.outputTail}. */
	command: z.string().min(1),
	timeoutMs: z
		.number()
		.int()
		.positive()
		.max(30 * 60_000)
		.default(10 * 60_000),
	verify: z
		.object({
			mustExitZero: z.boolean().default(true),
			outputContains: z.string().min(1).optional(),
		})
		.default({ mustExitZero: true }),
});
export type AdwDeterministicStep = z.infer<typeof adwDeterministicStepSchema>;

export const adwAgentStepSchema = z.object({
	id: adwStepIdSchema,
	kind: z.literal("agent"),
	title: z.string().min(1).optional(),
	/** The card seeded onto the board; same substitution tokens as deterministic commands. */
	card: z.object({
		title: z.string().min(1),
		prompt: z.string().min(1),
	}),
	/** Bound on awaiting the card's terminal lane — a workflow must end, even when a card wedges. */
	awaitTimeoutMs: z
		.number()
		.int()
		.positive()
		.max(4 * 60 * 60_000)
		.default(45 * 60_000),
	verify: z
		.object({
			/** The card must reach Completed; Trash/park/timeout fail the step. */
			mustComplete: z.boolean().default(true),
		})
		.default({ mustComplete: true }),
});
export type AdwAgentStep = z.infer<typeof adwAgentStepSchema>;

export const adwStepSchema = z.discriminatedUnion("kind", [adwDeterministicStepSchema, adwAgentStepSchema]);
export type AdwStep = z.infer<typeof adwStepSchema>;

export const adwWorkflowSchema = z
	.object({
		description: z.string().optional(),
		steps: z.array(adwStepSchema).min(1),
	})
	.superRefine((workflow, context) => {
		const seen = new Set<string>();
		for (const step of workflow.steps) {
			if (seen.has(step.id)) {
				context.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate step id "${step.id}".` });
			}
			seen.add(step.id);
		}
	});
export type AdwWorkflow = z.infer<typeof adwWorkflowSchema>;

export function isSafeAdwName(name: string): boolean {
	return ADW_NAME_PATTERN.test(name);
}

/** Substitute {input}, {workflow}, {timestamp}, and {steps.<id>.outputTail}; unknown tokens stay visible. */
export function renderAdwText(
	text: string,
	context: {
		workflowName: string;
		input: string;
		now: number;
		outputTailByStepId: ReadonlyMap<string, string>;
	},
): string {
	const tokens = new Map<string, string>([
		["input", context.input],
		["workflow", context.workflowName],
		["timestamp", new Date(context.now).toISOString()],
	]);
	for (const [stepId, tail] of context.outputTailByStepId) {
		tokens.set(`steps.${stepId}.outputTail`, tail);
	}
	return text.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (whole, token: string) => tokens.get(token) ?? whole);
}

export interface AdwStepResult {
	id: string;
	kind: AdwStep["kind"];
	ok: boolean;
	/** Human-readable pass/fail reason — the evidence line the run report prints. */
	detail: string;
	/** Bounded output evidence for deterministic steps (full output goes to the evidence file). */
	outputTail?: string;
	/** The seeded card for agent steps. */
	cardId?: string;
	skipped?: boolean;
}

export function evaluateDeterministicVerify(
	step: AdwDeterministicStep,
	run: { exitCode: number | null; output: string; timedOut: boolean },
): { ok: boolean; detail: string } {
	if (run.timedOut) {
		return { ok: false, detail: `timed out after ${step.timeoutMs}ms` };
	}
	if (step.verify.mustExitZero && run.exitCode !== 0) {
		return { ok: false, detail: `exit ${run.exitCode ?? "?"} (expected 0)` };
	}
	if (step.verify.outputContains && !run.output.includes(step.verify.outputContains)) {
		return { ok: false, detail: `output missing required text "${step.verify.outputContains}"` };
	}
	return { ok: true, detail: `exit ${run.exitCode ?? "?"}` };
}

export function evaluateAgentVerify(
	step: AdwAgentStep,
	outcome: { lane: string | null; timedOut: boolean },
): { ok: boolean; detail: string } {
	if (outcome.timedOut) {
		return { ok: false, detail: `card did not reach a terminal lane within ${step.awaitTimeoutMs}ms` };
	}
	if (!step.verify.mustComplete) {
		return { ok: true, detail: `card settled in ${outcome.lane ?? "(unknown)"}` };
	}
	return outcome.lane === "completed"
		? { ok: true, detail: "card completed" }
		: { ok: false, detail: `card ended in ${outcome.lane ?? "(unknown)"} (expected completed)` };
}

export interface AdwRunReport {
	workflowName: string;
	verdict: "pass" | "fail";
	steps: AdwStepResult[];
	failedStepId: string | null;
}

export interface AdwStepExecutors {
	/** Run a deterministic host-side command; must capture merged output and honor the timeout. */
	runCommand(
		step: AdwDeterministicStep,
		renderedCommand: string,
	): Promise<{
		exitCode: number | null;
		output: string;
		timedOut: boolean;
	}>;
	/** Seed the agent card and await its terminal lane (or time out). */
	runAgentCard(
		step: AdwAgentStep,
		card: { title: string; prompt: string },
	): Promise<{ cardId: string; lane: string | null; timedOut: boolean }>;
	/** Evidence sink (full deterministic output); best-effort. */
	writeEvidence(stepId: string, content: string): Promise<void>;
	onStepStart?(step: AdwStep): void;
	now(): number;
}

/**
 * Execute the workflow in order. The line HALTS on the first failed verify — remaining steps are reported as
 * skipped, never silently dropped — and the verdict is the fold of what ran.
 */
export async function runAdwWorkflow(
	workflow: AdwWorkflow,
	input: { workflowName: string; input: string },
	executors: AdwStepExecutors,
): Promise<AdwRunReport> {
	const results: AdwStepResult[] = [];
	const outputTailByStepId = new Map<string, string>();
	let failedStepId: string | null = null;
	for (const step of workflow.steps) {
		if (failedStepId !== null) {
			results.push({
				id: step.id,
				kind: step.kind,
				ok: false,
				detail: "skipped (earlier step failed)",
				skipped: true,
			});
			continue;
		}
		executors.onStepStart?.(step);
		const renderContext = {
			workflowName: input.workflowName,
			input: input.input,
			now: executors.now(),
			outputTailByStepId,
		};
		if (step.kind === "deterministic") {
			const run = await executors.runCommand(step, renderAdwText(step.command, renderContext));
			await executors.writeEvidence(step.id, run.output).catch(() => undefined);
			const verdict = evaluateDeterministicVerify(step, run);
			const outputTail = run.output.slice(-ADW_STEP_OUTPUT_TAIL_CHARS);
			outputTailByStepId.set(step.id, outputTail);
			results.push({ id: step.id, kind: step.kind, ok: verdict.ok, detail: verdict.detail, outputTail });
			if (!verdict.ok) {
				failedStepId = step.id;
			}
		} else {
			const card = {
				title: renderAdwText(step.card.title, renderContext),
				prompt: renderAdwText(step.card.prompt, renderContext),
			};
			const outcome = await executors.runAgentCard(step, card);
			const verdict = evaluateAgentVerify(step, outcome);
			results.push({ id: step.id, kind: step.kind, ok: verdict.ok, detail: verdict.detail, cardId: outcome.cardId });
			if (!verdict.ok) {
				failedStepId = step.id;
			}
		}
	}
	return {
		workflowName: input.workflowName,
		verdict: failedStepId === null ? "pass" : "fail",
		steps: results,
		failedStepId,
	};
}
