// F1.3d — the operator answer path for an open plan question: persist the resolution through
// `resolvePlanQuestion` (questions.md rewrite + `clarification_resolved` revision), then resume EXACTLY the card
// that was parked on the question — gated on a cleanly re-promptable session (awaiting_review with a
// returnable reviewReason), mirroring the decomposition-stall nudger's safety gate. A resume that cannot run is
// reported, never silently swallowed: the answer is durable either way, so the operator can redrive manually.
import type {
	RuntimeAnswerPlanQuestionRequest,
	RuntimeAnswerPlanQuestionResponse,
	RuntimeListPlanQuestionsRequest,
	RuntimeListPlanQuestionsResponse,
} from "../../core/plan-artifacts-api-contract";
import { readNKleinPlanArtifacts } from "../../nklein-agent/nklein-plan-artifacts";
import { buildClarificationResumePrompt, resolvePlanQuestion } from "../../nklein-agent/nklein-plan-clarification";
import { canReturnToRunning } from "../../nklein-agent/nklein-session-state";
import type { NKleinTaskSessionService } from "../../nklein-agent/nklein-task-session-service";
import type { RuntimeTrpcWorkspaceScope } from "../app-router";

export interface AnswerPlanQuestionDeps {
	getScopedNKleinTaskSessionService: (scope: RuntimeTrpcWorkspaceScope) => Promise<NKleinTaskSessionService>;
}

export async function handleAnswerPlanQuestion(
	workspaceScope: RuntimeTrpcWorkspaceScope | null,
	input: RuntimeAnswerPlanQuestionRequest,
	deps: AnswerPlanQuestionDeps,
): Promise<RuntimeAnswerPlanQuestionResponse> {
	if (!workspaceScope) {
		return { ok: false, questionStatus: null, resumedTaskId: null, error: "No workspace is selected." };
	}
	const resolved = await resolvePlanQuestion({
		workspacePath: workspaceScope.workspacePath,
		slug: input.planSlug,
		questionId: input.questionId,
		resolution: {
			source: "operator",
			answer: { selectedOptionIds: input.selectedOptionIds ?? [], freeText: input.freeText ?? null },
		},
	});
	if (!resolved.ok) {
		return { ok: false, questionStatus: null, resumedTaskId: null, error: resolved.error };
	}
	if (!resolved.changed || !resolved.blockedTaskId) {
		return { ok: true, questionStatus: resolved.question.status, resumedTaskId: null };
	}
	const service = await deps.getScopedNKleinTaskSessionService(workspaceScope);
	const summary = service.getSummary(resolved.blockedTaskId);
	if (summary?.state !== "awaiting_review" || !canReturnToRunning(summary.reviewReason)) {
		return {
			ok: true,
			questionStatus: resolved.question.status,
			resumedTaskId: null,
			error: `The answer was recorded, but task ${resolved.blockedTaskId} is not in a cleanly re-promptable state (${summary?.state ?? "no session"}) — redrive it manually.`,
		};
	}
	const resumed = await service.sendTaskSessionInput(
		resolved.blockedTaskId,
		buildClarificationResumePrompt(resolved.question),
	);
	return {
		ok: true,
		questionStatus: resolved.question.status,
		resumedTaskId: resumed ? resolved.blockedTaskId : null,
		...(resumed
			? {}
			: { error: `The answer was recorded, but resuming task ${resolved.blockedTaskId} did not start a turn.` }),
	};
}

/** F1.4 data layer — list a plan's questions (default: open only) for the clarification dialog. */
export async function handleListPlanQuestions(
	workspaceScope: RuntimeTrpcWorkspaceScope | null,
	input: RuntimeListPlanQuestionsRequest,
): Promise<RuntimeListPlanQuestionsResponse> {
	if (!workspaceScope) {
		return { ok: false, questions: [], error: "No workspace is selected." };
	}
	try {
		const artifacts = await readNKleinPlanArtifacts(workspaceScope.workspacePath, input.planSlug);
		const openOnly = input.openOnly ?? true;
		const questions = artifacts.questions.filter((question) => !openOnly || question.status === "open");
		return { ok: true, questions };
	} catch (error) {
		return { ok: false, questions: [], error: `Could not read plan "${input.planSlug}": ${String(error)}` };
	}
}
