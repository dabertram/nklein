/**
 * Step-plan controller — the per-card lifecycle of the step-planning stage: plan + review before the worker starts,
 * ONE step at a time during execution (`complete_step`), replan-with-history on every trigger, and the receipts
 * that make a `verify` step honest. The session service owns the wiring (start seam, tool attach, bounce hook); the
 * decisions are the pure cores (`step-plan*.ts`), so this module is thin state + orchestration.
 *
 * Every degraded path resolves to "run the card unplanned, say why" — a planning failure never costs a card.
 */

import { type LookupReceipt, normalizeLookupUrl } from "../core/lookup-receipt";
import {
	nextPendingStep,
	renderStepInstruction,
	STEP_PLAN_SCHEMA_VERSION,
	type StepPlan,
	type StepPlanStep,
	type StepPlanSubmission,
	stepPlanProgress,
	stepStatus,
} from "../core/step-plan";
import {
	boundAcceptanceOutput,
	DEFAULT_STEP_MAX_ATTEMPTS,
	decideStepCompletion,
	STEP_PLAN_DELIVER_INSTRUCTION,
} from "../core/step-plan-execution";
import {
	buildReplanBrief,
	buildReplanHistoryEntry,
	DEFAULT_STEP_PLAN_MAX_REPLANS,
	decideReplan,
	type ReplanEvidence,
} from "../core/step-plan-replan";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import { hashWorkspacePathForLedger } from "./nklein-ledger-attempt";
import type { StepPlanRunner } from "./nklein-step-plan-runner";
import type { AgentTool } from "./sdk-agent-types";
import type { StepPlanStore } from "./step-plan-store";

export const COMPLETE_STEP_TOOL_NAME = "complete_step";
export const STEP_PLAN_MAX_REPLANS_ENV = "NKLEIN_STEP_PLAN_MAX_REPLANS";
export const STEP_MAX_ATTEMPTS_ENV = "NKLEIN_STEP_PLAN_MAX_STEP_ATTEMPTS";

export interface StepPlanCardInput {
	taskId: string;
	projectRepoPath: string;
	taskTitle: string | null;
	taskPrompt: string;
	filesLikelyTouched?: readonly string[] | null;
	writeScope?: readonly string[] | null;
}

export interface StepPlanControllerDeps {
	runner: StepPlanRunner;
	/** Lazy: the store's root may only be known after the owning service finished constructing. */
	getStore(): StepPlanStore;
	/** Run a step's acceptance command in the WORKER's own sandbox; exit 0 = accepted. Throws ⇒ treated as failure. */
	runStepAcceptance(taskId: string, command: string): Promise<{ exitCode: number | null; output: string }>;
	getBaseRef(taskId: string): string | null;
	lookupAvailable(taskId: string): boolean;
	now?: () => number;
	env?: NodeJS.ProcessEnv;
}

interface CardState {
	plan: StepPlan;
	input: StepPlanCardInput;
	/** Failed attempts per step in the current revision. */
	attempts: Map<string, number>;
	receiptUrls: Set<string>;
}

export interface StepPlanController {
	/**
	 * Plan + review BEFORE the worker starts. Resolves to the worker's start prompt (step 1's instruction) when a plan
	 * was approved, or null ⇒ start the card unplanned exactly as today (the reason is recorded).
	 */
	prepareStart(input: StepPlanCardInput): Promise<string | null>;
	/** The `complete_step` control-plane tool for a planned card, or null when the card has no plan. */
	buildCompleteStepTool(taskId: string): AgentTool | null;
	/** A `lookup` receipt for the card — feeds the citation set a verify step must hit. */
	noteReceipt(taskId: string, receipt: LookupReceipt): void;
	currentStepId(taskId: string): string | null;
	hasPlan(taskId: string): boolean;
	/** The delivery review bounced: replan (through review) with the feedback; the worker's re-drive prompt, or null. */
	onReviewBounce(taskId: string, feedback: string): Promise<string | null>;
	/** The operator steered mid-execution: replan with the instruction; the prompt to send, or null. */
	onUserSteer(taskId: string, instruction: string): Promise<string | null>;
	forget(taskId: string): void;
}

function readInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
	const parsed = Number.parseInt(env[key] ?? "", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function createStepPlanController(deps: StepPlanControllerDeps): StepPlanController {
	const now = deps.now ?? (() => Date.now());
	const env = deps.env ?? process.env;
	const maxReplans = readInt(env, STEP_PLAN_MAX_REPLANS_ENV, DEFAULT_STEP_PLAN_MAX_REPLANS);
	const maxStepAttempts = readInt(env, STEP_MAX_ATTEMPTS_ENV, DEFAULT_STEP_MAX_ATTEMPTS);
	const states = new Map<string, CardState>();

	function observe(taskId: string, severity: "info" | "warning", message: string, metadata: Record<string, unknown>) {
		recordSelfObservation({
			signal: "custom",
			severity,
			message,
			taskId,
			metadata: { category: "step_plan", ...metadata },
		});
	}

	function toPlan(
		submission: StepPlanSubmission,
		base: {
			cardId: string;
			revision: number;
			baseRef: string | null;
			history: StepPlan["history"];
			createdAt: number;
		},
	): StepPlan {
		return {
			...submission,
			schemaVersion: STEP_PLAN_SCHEMA_VERSION,
			cardId: base.cardId,
			revision: base.revision,
			baseRef: base.baseRef,
			status: "executing",
			outcomes: [],
			history: base.history,
			createdAt: base.createdAt,
			updatedAt: now(),
		};
	}

	async function persist(state: CardState): Promise<void> {
		state.plan = { ...state.plan, updatedAt: now() };
		await deps
			.getStore()
			.write(hashWorkspacePathForLedger(state.input.projectRepoPath), state.plan)
			.catch(() => undefined);
	}

	function stepPrompt(
		state: CardState,
		step: StepPlanStep,
		options: { retryNote?: string | null; attempt?: number } = {},
	): string {
		return renderStepInstruction(state.plan, step, {
			lookupAvailable: deps.lookupAvailable(state.input.taskId),
			retryNote: options.retryNote ?? null,
			attempt: options.attempt ? { current: options.attempt, max: maxStepAttempts } : null,
		});
	}

	async function prepareStart(input: StepPlanCardInput): Promise<string | null> {
		const baseRef = deps.getBaseRef(input.taskId);
		const outcome = await deps.runner.planAndReview({
			taskId: input.taskId,
			projectRepoPath: input.projectRepoPath,
			baseRef: baseRef ?? "HEAD",
			taskTitle: input.taskTitle,
			taskPrompt: input.taskPrompt,
			filesLikelyTouched: input.filesLikelyTouched,
			writeScope: input.writeScope,
			lookupAvailable: deps.lookupAvailable(input.taskId),
		});
		if (outcome.status === "fallback") {
			observe(
				input.taskId,
				"warning",
				`Step planning fell back to the unplanned worker path for ${input.taskId}: ${outcome.reason}.`,
				{
					phase: "prepare",
					outcome: "fallback",
					rounds: outcome.rounds,
				},
			);
			return null;
		}
		const state: CardState = {
			plan: toPlan(outcome.plan, { cardId: input.taskId, revision: 0, baseRef, history: [], createdAt: now() }),
			input,
			attempts: new Map(),
			receiptUrls: new Set(),
		};
		states.set(input.taskId, state);
		await persist(state);
		const first = nextPendingStep(state.plan);
		observe(
			input.taskId,
			"info",
			`Step plan approved for ${input.taskId}: ${state.plan.steps.length} step(s), ${outcome.rounds} review round(s)${outcome.reviewed ? "" : " (UNREVIEWED — no plan reviewer available)"}.`,
			{
				phase: "prepare",
				outcome: "approved",
				steps: state.plan.steps.length,
				rounds: outcome.rounds,
				reviewed: outcome.reviewed,
				reviewer: outcome.reviewer,
				verifySteps: state.plan.steps.filter((step) => step.verify).length,
			},
		);
		return first ? stepPrompt(state, first) : null;
	}

	/**
	 * Replan through the runner (planner + reviewer again) with the retained history. Returns the next step's
	 * instruction, or null when the replan budget is spent / planning failed (the caller falls back).
	 */
	async function replan(
		state: CardState,
		evidence: ReplanEvidence,
		admissionParentTaskId: string | null,
	): Promise<string | null> {
		const decision = decideReplan({ trigger: evidence.trigger, replanCount: state.plan.revision, maxReplans });
		if (decision.action === "exhausted") {
			observe(state.input.taskId, "warning", `Replan refused for ${state.input.taskId}: ${decision.reason}.`, {
				phase: "replan",
				outcome: "exhausted",
				trigger: evidence.trigger,
			});
			state.plan = { ...state.plan, status: "abandoned" };
			await persist(state);
			states.delete(state.input.taskId);
			return null;
		}
		const historyEntry = buildReplanHistoryEntry(state.plan, evidence);
		const brief = buildReplanBrief(state.plan, evidence);
		const outcome = await deps.runner.planAndReview({
			taskId: state.input.taskId,
			projectRepoPath: state.input.projectRepoPath,
			baseRef: deps.getBaseRef(state.input.taskId) ?? state.plan.baseRef ?? "HEAD",
			admissionParentTaskId,
			taskTitle: state.input.taskTitle,
			taskPrompt: state.input.taskPrompt,
			filesLikelyTouched: state.input.filesLikelyTouched,
			writeScope: state.input.writeScope,
			lookupAvailable: deps.lookupAvailable(state.input.taskId),
			revisionContext: brief,
		});
		if (outcome.status === "fallback") {
			observe(
				state.input.taskId,
				"warning",
				`Replan for ${state.input.taskId} produced no approved plan: ${outcome.reason}.`,
				{ phase: "replan", outcome: "fallback", trigger: evidence.trigger },
			);
			state.plan = { ...state.plan, status: "abandoned", history: [...state.plan.history, historyEntry] };
			await persist(state);
			states.delete(state.input.taskId);
			return null;
		}
		// Done steps carry forward as outcomes when the new plan keeps their ids; everything else starts pending.
		const doneIds = new Set(historyEntry.completedStepIds);
		const carried = state.plan.outcomes.filter(
			(outcome_) => outcome_.status === "done" && doneIds.has(outcome_.stepId),
		);
		state.plan = {
			...toPlan(outcome.plan, {
				cardId: state.input.taskId,
				revision: state.plan.revision + 1,
				baseRef: deps.getBaseRef(state.input.taskId) ?? state.plan.baseRef,
				history: [...state.plan.history, historyEntry],
				createdAt: state.plan.createdAt,
			}),
			outcomes: carried.filter((outcome_) => outcome.plan.steps.some((step) => step.id === outcome_.stepId)),
		};
		state.attempts.clear();
		await persist(state);
		observe(
			state.input.taskId,
			"info",
			`Replanned ${state.input.taskId} (revision ${state.plan.revision}, trigger ${evidence.trigger}): ${state.plan.steps.length} step(s), ${outcome.rounds} review round(s).`,
			{
				phase: "replan",
				outcome: "approved",
				trigger: evidence.trigger,
				revision: state.plan.revision,
				reviewed: outcome.reviewed,
			},
		);
		const next = nextPendingStep(state.plan);
		return next ? stepPrompt(state, next) : STEP_PLAN_DELIVER_INSTRUCTION;
	}

	function buildCompleteStepTool(taskId: string): AgentTool | null {
		if (!states.has(taskId)) {
			return null;
		}
		return {
			name: COMPLETE_STEP_TOOL_NAME,
			description:
				"Report the current plan step as done (or blocked). !Klein runs the step's acceptance in your sandbox and answers with the NEXT step's full instruction, a retry request, or the delivery instruction. Pass `stepId`, a short `note`, `citations` (lookup URLs) for a verify step, or `blocked` with the reason you cannot do the step as written.",
			inputSchema: {
				type: "object",
				properties: {
					stepId: { type: "string" },
					note: { type: "string" },
					citations: { type: "array", items: { type: "string" } },
					blocked: { type: ["string", "null"] },
				},
				additionalProperties: true,
			},
			async execute(input) {
				const state = states.get(taskId);
				if (!state) {
					return {
						ok: false,
						instruction: "This card has no active step plan; finish the card per its objective.",
					};
				}
				const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
				const request = {
					stepId:
						typeof record.stepId === "string" ? record.stepId.trim() : (nextPendingStep(state.plan)?.id ?? ""),
					note: typeof record.note === "string" ? record.note.trim().slice(0, 2_000) : "",
					citations: (Array.isArray(record.citations)
						? record.citations
						: typeof record.citations === "string"
							? [record.citations]
							: []
					)
						.filter((value): value is string => typeof value === "string")
						.map((value) => normalizeLookupUrl(value)),
					blocked: typeof record.blocked === "string" && record.blocked.trim() ? record.blocked.trim() : null,
				};
				const step = state.plan.steps.find((candidate) => candidate.id === request.stepId) ?? null;
				let acceptance: { exitCode: number | null; output: string } | null = null;
				if (step && !request.blocked && step.acceptance.command && stepStatus(state.plan, step.id) !== "done") {
					try {
						const run = await deps.runStepAcceptance(taskId, step.acceptance.command);
						acceptance = { exitCode: run.exitCode, output: boundAcceptanceOutput(run.output) };
					} catch (error) {
						acceptance = {
							exitCode: 1,
							output: boundAcceptanceOutput(error instanceof Error ? error.message : String(error)),
						};
					}
				}
				const decision = decideStepCompletion({
					plan: state.plan,
					request,
					acceptance,
					attemptsSoFar: state.attempts.get(request.stepId) ?? 0,
					maxAttempts: maxStepAttempts,
					knownReceiptUrls: state.receiptUrls,
				});
				const at = now();
				switch (decision.action) {
					case "reject":
						return { ok: false, instruction: `Rejected: ${decision.reason}.` };
					case "retry": {
						state.attempts.set(decision.step.id, decision.attempt);
						state.plan = {
							...state.plan,
							outcomes: [
								...state.plan.outcomes,
								{
									stepId: decision.step.id,
									status: "failed",
									note: decision.reason,
									citations: request.citations,
									at,
								},
							],
						};
						await persist(state);
						return {
							ok: false,
							step: decision.step.id,
							instruction: `Step "${decision.step.id}" not accepted (attempt ${decision.attempt}/${maxStepAttempts}): ${decision.reason}\n\n${stepPrompt(state, decision.step, { retryNote: decision.reason, attempt: decision.attempt + 1 })}`,
						};
					}
					case "advance":
					case "deliver": {
						state.plan = {
							...state.plan,
							outcomes: [
								...state.plan.outcomes,
								{
									stepId: decision.step.id,
									status: "done",
									note: request.note,
									citations: request.citations,
									at,
								},
							],
						};
						if (decision.action === "deliver") {
							state.plan = { ...state.plan, status: "completed" };
						}
						await persist(state);
						observe(
							taskId,
							"info",
							`Step ${decision.step.id} accepted for ${taskId} (${stepPlanProgress(state.plan).done}/${state.plan.steps.length}).`,
							{ phase: "execute", step: decision.step.id, action: decision.action },
						);
						return decision.action === "advance"
							? {
									ok: true,
									accepted: decision.step.id,
									next: decision.next.id,
									instruction: stepPrompt(state, decision.next),
								}
							: { ok: true, accepted: decision.step.id, next: null, instruction: STEP_PLAN_DELIVER_INSTRUCTION };
					}
					case "replan": {
						state.plan = {
							...state.plan,
							outcomes: [
								...state.plan.outcomes,
								{
									stepId: decision.step.id,
									status: "failed",
									note: decision.reason,
									citations: request.citations,
									at,
								},
							],
						};
						await persist(state);
						const prompt = await replan(
							state,
							{ trigger: decision.trigger, stepId: decision.step.id, detail: decision.reason, at },
							taskId,
						);
						return prompt
							? {
									ok: true,
									replanned: true,
									instruction: `The plan was revised (${decision.trigger}). Continue with the step below.\n\n${prompt}`,
								}
							: {
									ok: true,
									replanned: false,
									instruction: `The plan could not be revised again (${decision.trigger}). Finish the card by its objective as best you can: ${state.input.taskPrompt.slice(0, 1_200)}`,
								};
					}
				}
			},
		};
	}

	function noteReceipt(taskId: string, receipt: LookupReceipt): void {
		const state = states.get(taskId);
		if (!state) {
			return;
		}
		state.receiptUrls.add(normalizeLookupUrl(receipt.url));
		state.receiptUrls.add(normalizeLookupUrl(receipt.finalUrl));
	}

	function currentStepId(taskId: string): string | null {
		const state = states.get(taskId);
		return state ? (nextPendingStep(state.plan)?.id ?? null) : null;
	}

	async function onReviewBounce(taskId: string, feedback: string): Promise<string | null> {
		const state = states.get(taskId);
		if (!state) {
			return null;
		}
		const baseRef = deps.getBaseRef(taskId);
		const baseChanged = baseRef !== null && state.plan.baseRef !== null && baseRef !== state.plan.baseRef;
		// The bounce means every "done" step produced the wrong thing: reopen them all for the replan.
		state.plan = { ...state.plan, outcomes: [] };
		return replan(
			state,
			baseChanged
				? {
						trigger: "base_changed",
						detail: `base moved ${state.plan.baseRef} -> ${baseRef}; reviewer feedback: ${feedback}`,
						at: now(),
					}
				: { trigger: "review_bounce", detail: feedback, at: now() },
			null,
		);
	}

	async function onUserSteer(taskId: string, instruction: string): Promise<string | null> {
		const state = states.get(taskId);
		if (!state) {
			return null;
		}
		return replan(state, { trigger: "user_steer", detail: instruction, at: now() }, null);
	}

	return {
		prepareStart,
		buildCompleteStepTool,
		noteReceipt,
		currentStepId,
		hasPlan: (taskId) => states.has(taskId),
		onReviewBounce,
		onUserSteer,
		forget: (taskId) => {
			states.delete(taskId);
		},
	};
}
