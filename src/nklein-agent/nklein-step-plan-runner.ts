/**
 * Step-plan runner — the bounded PLANNER (`<task>::step-plan`) and PLAN-REVIEWER (`<task>::step-plan-review`)
 * sessions of the step-planning stage, and the round loop between them (§5.U sibling of the architect and
 * plan-critique runners; same harness, same one-tool-call hand-back, same "every degraded path resolves to null so
 * the worker still starts" contract).
 *
 * Model selection (per-role, David: "per-role model selection for the planner and plan-reviewer"):
 *   planner        NKLEIN_STEP_PLANNER_MODEL → modelRoles.planner → the card's routed model.
 *   plan reviewer  NKLEIN_STEP_PLAN_REVIEWER_MODEL → modelRoles.plan_reviewer → the lineage-diverse escalation pick
 *                  → the card's model (self-review; surfaced as a waiver in telemetry, never silent).
 *
 * The review round loop is the pure `decideStepPlanReviewRound`: approve ⇒ done; revise ⇒ the planner gets the
 * findings and resubmits; rounds exhausted / no verdict past round 1 ⇒ `fallback` (the caller runs the card
 * unplanned and records why). The plan is never handed to execution unapproved unless NO reviewer model exists at
 * all — and that waiver is recorded.
 */

import { isHomeAgentSessionId } from "../core/home-agent-session";
import type { StepPlanSubmission } from "../core/step-plan";
import {
	DEFAULT_STEP_PLAN_MAX_REVIEW_ROUNDS,
	decideStepPlanReviewRound,
	type StepPlanReviewResult,
} from "../core/step-plan-review";
import { isDerivedTaskSessionId } from "../core/synthetic-task-id";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import { type AgentSandboxManager, createAgentSandboxToolExecutors } from "./nklein-agent-sandbox";
import { createAgentSandboxExtraTools } from "./nklein-agent-sandbox-extra-tools";
import type { NKleinTaskRestartLaunchConfig } from "./nklein-launch-config";
import type { NKleinPauseController } from "./nklein-pause-controller";
import type {
	RuntimeTaskSessionStartResult,
	StartRuntimeTaskSessionFromLaunchConfigInput,
} from "./nklein-runtime-session-input";
import type { SecondarySessionHarness } from "./nklein-secondary-session-harness";
import { createSessionId } from "./nklein-session-state";
import { buildStepPlanReviewSeedPrompt } from "./nklein-step-plan-review-tool";
import { buildStepPlanRevisionPrompt, buildStepPlanSeedPrompt } from "./nklein-step-plan-tool";
import type { AgentTool } from "./sdk-agent-types";

export const STEP_PLANNER_MODEL_ENV = "NKLEIN_STEP_PLANNER_MODEL";
export const STEP_PLAN_REVIEWER_MODEL_ENV = "NKLEIN_STEP_PLAN_REVIEWER_MODEL";
export const STEP_PLAN_MAX_REVIEW_ROUNDS_ENV = "NKLEIN_STEP_PLAN_MAX_REVIEW_ROUNDS";
export const STEP_PLAN_ROLE_PLANNER = "planner";
export const STEP_PLAN_ROLE_REVIEWER = "plan_reviewer";

const PLANNER_NUDGE_PROMPT =
	"Submit the plan now by calling the submit_step_plan tool with the full plan. Do not reply in prose.";
const REVIEWER_NUDGE_PROMPT =
	"Submit your review now by calling submit_step_plan_review with `approve` or `revise` + findings. Do not reply in prose.";

export type StepPlanRole = typeof STEP_PLAN_ROLE_PLANNER | typeof STEP_PLAN_ROLE_REVIEWER;

export interface StepPlanRunnerDeps {
	getAgentSandboxManager(): AgentSandboxManager | null;
	getLaunchConfig(taskId: string): NKleinTaskRestartLaunchConfig | null;
	getPauseController(): NKleinPauseController;
	getHarness(): SecondarySessionHarness;
	startRuntimeSession(input: StartRuntimeTaskSessionFromLaunchConfigInput): Promise<RuntimeTaskSessionStartResult>;
	sendTaskSessionInput(taskId: string, prompt: string, admissionParentTaskId?: string | null): Promise<unknown>;
	/** The lineage-diverse escalation pick (the reviewer's default when no role model is configured). */
	pickEscalationModel(taskId: string): Promise<{ providerId: string; modelId: string } | null>;
	/** `modelRoles.planner` / `modelRoles.plan_reviewer` from the runtime config, when the operator set them. */
	resolveRoleModel?(role: StepPlanRole): { providerId?: string | null; modelId?: string | null } | null;
	/** The `lookup` tool for a synthetic planning session (null ⇒ not attached). */
	buildLookupTool?(syntheticTaskId: string, cardId: string): AgentTool | null;
	defaultTimeoutMs: number;
	maxNudges: number;
	env?: NodeJS.ProcessEnv;
}

export interface PlanSessionInput {
	taskId: string;
	projectRepoPath: string;
	baseRef: string;
	/** Set when the planning runs INSIDE the worker's turn (a replan from `complete_step`): cap-1 handoff. */
	admissionParentTaskId?: string | null;
	taskTitle: string | null;
	taskPrompt: string;
	filesLikelyTouched?: readonly string[] | null;
	writeScope?: readonly string[] | null;
	lookupAvailable: boolean;
	/** Replan brief or other context the planner must address in its first submission. */
	revisionContext?: string | null;
}

export type PlanAndReviewOutcome =
	| { status: "approved"; plan: StepPlanSubmission; rounds: number; reviewed: boolean; reviewer: string | null }
	| { status: "fallback"; reason: string; rounds: number };

export interface StepPlanRunner {
	runPlannerSession(input: PlanSessionInput & { seedPrompt: string }): Promise<StepPlanSubmission | null>;
	runPlanReviewSession(
		input: PlanSessionInput & { seedPrompt: string },
	): Promise<{ result: StepPlanReviewResult | null; reviewer: { providerId: string; modelId: string } | null }>;
	/** The whole stage for one card: plan → review → (revise → review)* → approved | fallback. */
	planAndReview(input: PlanSessionInput): Promise<PlanAndReviewOutcome>;
	resolveModel(
		taskId: string,
		role: StepPlanRole,
	): Promise<{ providerId: string; modelId: string; source: string } | null>;
}

export function resolveStepPlanMaxReviewRounds(env: NodeJS.ProcessEnv = process.env): number {
	const parsed = Number.parseInt(env[STEP_PLAN_MAX_REVIEW_ROUNDS_ENV] ?? "", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_STEP_PLAN_MAX_REVIEW_ROUNDS;
}

export function createStepPlanRunner(deps: StepPlanRunnerDeps): StepPlanRunner {
	const env = deps.env ?? process.env;

	async function resolveModel(
		taskId: string,
		role: StepPlanRole,
	): Promise<{ providerId: string; modelId: string; source: string } | null> {
		const launch = deps.getLaunchConfig(taskId);
		if (!launch?.providerId || !launch.modelId) {
			return null;
		}
		const envModel =
			env[role === STEP_PLAN_ROLE_PLANNER ? STEP_PLANNER_MODEL_ENV : STEP_PLAN_REVIEWER_MODEL_ENV]?.trim();
		if (envModel) {
			return { providerId: launch.providerId, modelId: envModel, source: "env" };
		}
		const configured = deps.resolveRoleModel?.(role);
		if (configured?.modelId?.trim()) {
			return {
				providerId: configured.providerId?.trim() || launch.providerId,
				modelId: configured.modelId.trim(),
				source: "modelRoles",
			};
		}
		if (role === STEP_PLAN_ROLE_REVIEWER) {
			const diverse = await deps.pickEscalationModel(taskId).catch(() => null);
			if (diverse) {
				return { ...diverse, source: "diverse_escalation" };
			}
		}
		return { providerId: launch.providerId, modelId: launch.modelId, source: "card_model" };
	}

	async function runSyntheticSession<T>(
		kind: "step-plan" | "step-plan-review",
		input: PlanSessionInput & { seedPrompt: string },
		model: { providerId: string; modelId: string },
		nudgePrompt: string,
		attach: (capture: (value: T) => void) => Partial<StartRuntimeTaskSessionFromLaunchConfigInput>,
	): Promise<T | null> {
		if (isDerivedTaskSessionId(input.taskId) || isHomeAgentSessionId(input.taskId)) {
			return null;
		}
		const sandboxManager = deps.getAgentSandboxManager();
		const launch = deps.getLaunchConfig(input.taskId);
		if (!sandboxManager || !launch) {
			return null;
		}
		const syntheticTaskId = `${input.taskId}::${kind}`;
		const launchConfig: NKleinTaskRestartLaunchConfig = {
			...launch,
			providerId: model.providerId,
			modelId: model.modelId,
			workspaceRoot: input.projectRepoPath,
		};
		return deps
			.getHarness()
			.runBracketed(
				{
					syntheticTaskId,
					projectRepoPath: input.projectRepoPath,
					baseRef: input.baseRef,
					defaultTimeoutMs: deps.defaultTimeoutMs,
					errorLabel: kind === "step-plan" ? "Step-plan planner session" : "Step-plan review session",
				},
				async ({ workspace, deadlineMs, runBoundedTurn }) => {
					let captured: T | null = null;
					const lookupTool = input.lookupAvailable
						? (deps.buildLookupTool?.(syntheticTaskId, input.taskId) ?? null)
						: null;
					const sandboxTools = createAgentSandboxExtraTools(sandboxManager, syntheticTaskId, {
						sessionId: createSessionId(syntheticTaskId),
						contextWindow: launchConfig.contextWindow ?? undefined,
						maxFileLines: launchConfig.maxAgentWritableFileLines ?? null,
					});
					await runBoundedTurn(
						deps.startRuntimeSession({
							taskId: syntheticTaskId,
							...(input.admissionParentTaskId ? { admissionParentTaskId: input.admissionParentTaskId } : {}),
							cwd: workspace.workdir,
							workspaceRoot: input.projectRepoPath,
							prompt: input.seedPrompt,
							launchConfig,
							contextScope: "minimal",
							toolExecutors: createAgentSandboxToolExecutors(sandboxManager, syntheticTaskId, {
								pauseController: deps.getPauseController(),
							}),
							extraTools: lookupTool ? [...sandboxTools, lookupTool] : sandboxTools,
							...attach((value) => {
								captured = value;
							}),
						}),
					);
					for (let nudge = 0; captured === null && nudge < deps.maxNudges && Date.now() < deadlineMs; nudge += 1) {
						await runBoundedTurn(
							deps.sendTaskSessionInput(syntheticTaskId, nudgePrompt, input.admissionParentTaskId ?? null),
						);
					}
					return captured as T | null;
				},
			)
			.catch(() => null);
	}

	async function runPlannerSession(
		input: PlanSessionInput & { seedPrompt: string },
	): Promise<StepPlanSubmission | null> {
		const model = await resolveModel(input.taskId, STEP_PLAN_ROLE_PLANNER);
		if (!model) {
			return null;
		}
		return runSyntheticSession<StepPlanSubmission>("step-plan", input, model, PLANNER_NUDGE_PROMPT, (capture) => ({
			onStepPlanSubmitted: (plan) => {
				capture(plan);
			},
		}));
	}

	async function runPlanReviewSession(input: PlanSessionInput & { seedPrompt: string }) {
		const model = await resolveModel(input.taskId, STEP_PLAN_ROLE_REVIEWER);
		if (!model) {
			return { result: null, reviewer: null };
		}
		const result = await runSyntheticSession<StepPlanReviewResult>(
			"step-plan-review",
			input,
			model,
			REVIEWER_NUDGE_PROMPT,
			(capture) => ({
				onStepPlanReviewSubmitted: (review) => {
					capture(review);
				},
			}),
		);
		return { result, reviewer: { providerId: model.providerId, modelId: model.modelId } };
	}

	async function planAndReview(input: PlanSessionInput): Promise<PlanAndReviewOutcome> {
		const maxRounds = resolveStepPlanMaxReviewRounds(env);
		let revisionContext = input.revisionContext ?? null;
		let plan: StepPlanSubmission | null = null;
		for (let round = 1; round <= maxRounds; round += 1) {
			plan = await runPlannerSession({
				...input,
				revisionContext,
				seedPrompt: buildStepPlanSeedPrompt({
					taskTitle: input.taskTitle,
					taskPrompt: input.taskPrompt,
					filesLikelyTouched: input.filesLikelyTouched,
					writeScope: input.writeScope,
					lookupAvailable: input.lookupAvailable,
					revisionContext,
				}),
			});
			if (!plan) {
				return { status: "fallback", reason: `the planner produced no plan in round ${round}`, rounds: round };
			}
			const review = await runPlanReviewSession({
				...input,
				seedPrompt: buildStepPlanReviewSeedPrompt({
					taskTitle: input.taskTitle,
					taskPrompt: input.taskPrompt,
					plan: { ...plan, history: [], outcomes: [] },
					round,
					lookupAvailable: input.lookupAvailable,
				}),
			});
			const reviewerLabel = review.reviewer ? `${review.reviewer.providerId}/${review.reviewer.modelId}` : null;
			const decision = decideStepPlanReviewRound({
				round,
				maxRounds,
				verdict: review.result?.verdict ?? null,
				allowUnreviewedWhenNoVerdict: review.reviewer === null,
			});
			recordSelfObservation({
				signal: "custom",
				severity: decision.action === "execute" ? "info" : "warning",
				message: `Step-plan review round ${round} for ${input.taskId}: ${decision.reason}.`,
				taskId: input.taskId,
				metadata: {
					category: "step_plan_review_round",
					round,
					action: decision.action,
					verdict: review.result?.verdict ?? null,
					reviewer: reviewerLabel,
					findings: review.result?.findings.length ?? 0,
				},
			});
			if (decision.action === "execute" || decision.action === "execute_unreviewed") {
				return {
					status: "approved",
					plan,
					rounds: round,
					reviewed: decision.action === "execute",
					reviewer: reviewerLabel,
				};
			}
			if (decision.action === "fallback_unplanned") {
				return { status: "fallback", reason: decision.reason, rounds: round };
			}
			// revise
			revisionContext = buildStepPlanRevisionPrompt(
				round,
				review.result?.summary ?? "",
				review.result?.findings ?? [],
			);
		}
		return { status: "fallback", reason: "review rounds exhausted", rounds: maxRounds };
	}

	return { runPlannerSession, runPlanReviewSession, planAndReview, resolveModel };
}
