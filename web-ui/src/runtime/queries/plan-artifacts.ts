// Browser-side query helpers: NKlein plan artifacts (list/apply/reject/gap/expand) + the advisor / dogfood / smoke eval.
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeAnswerPlanQuestionRequest,
	RuntimeAnswerPlanQuestionResponse,
	RuntimeExpandNKleinPlanTaskRequest,
	RuntimeExpandNKleinPlanTaskResponse,
	RuntimeListPlanQuestionsResponse,
	RuntimeNKleinAdvisorBuildRequest,
	RuntimeNKleinAdvisorRequest,
	RuntimeNKleinAdvisorSendResponse,
	RuntimeNKleinDogfoodBacklogResponse,
	RuntimeNKleinPlanArtifactApplyResponse,
	RuntimeNKleinPlanArtifactRejectResponse,
	RuntimeNKleinPlanArtifactsResponse,
	RuntimeNKleinSmokeEvalResponse,
	RuntimeRecordNKleinPlanGapRequest,
	RuntimeRecordNKleinPlanGapResponse,
} from "@/runtime/types";

export async function buildNKleinAdvisorRequest(
	workspaceId: string | null,
	input: RuntimeNKleinAdvisorBuildRequest,
): Promise<RuntimeNKleinAdvisorRequest> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.buildNKleinAdvisor.query(input);
}

export async function sendNKleinAdvisorRequest(
	workspaceId: string | null,
	input: { prompt: string; providerId: string; modelId: string },
): Promise<RuntimeNKleinAdvisorSendResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.sendNKleinAdvisor.mutate(input);
}

export async function writeNKleinDogfoodBacklog(
	workspaceId: string | null,
	input: { suggestion?: string; slug?: string },
): Promise<RuntimeNKleinDogfoodBacklogResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.writeNKleinDogfoodBacklog.mutate(input);
}

export async function runNKleinSmokeEval(workspaceId: string | null): Promise<RuntimeNKleinSmokeEvalResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.runNKleinSmokeEval.mutate();
}

export async function fetchNKleinPlanArtifacts(
	workspaceId: string | null,
	taskId: string,
): Promise<RuntimeNKleinPlanArtifactsResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.listNKleinPlanArtifacts.query({ taskId });
}

export async function applyNKleinPlanArtifact(
	workspaceId: string | null,
	artifactId: string,
): Promise<RuntimeNKleinPlanArtifactApplyResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.applyNKleinPlanArtifact.mutate({ artifactId });
}

export async function rejectNKleinPlanArtifact(
	workspaceId: string | null,
	artifactId: string,
): Promise<RuntimeNKleinPlanArtifactRejectResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.rejectNKleinPlanArtifact.mutate({ artifactId });
}

export async function recordNKleinPlanGap(
	workspaceId: string | null,
	input: RuntimeRecordNKleinPlanGapRequest,
): Promise<RuntimeRecordNKleinPlanGapResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.recordNKleinPlanGap.mutate(input);
}

export async function expandNKleinPlanTask(
	workspaceId: string | null,
	input: RuntimeExpandNKleinPlanTaskRequest,
): Promise<RuntimeExpandNKleinPlanTaskResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.expandNKleinPlanTask.mutate(input);
}

/** F1.4 — list a plan's questions (open-only by default) for the clarification dialog. */
export async function listNKleinPlanQuestions(
	workspaceId: string | null,
	input: { planSlug: string; openOnly?: boolean },
): Promise<RuntimeListPlanQuestionsResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.listNKleinPlanQuestions.query(input);
}

/** F1.4 — persist an operator's answer to a plan question; resumes the blocked card when one is parked on it. */
export async function answerNKleinPlanQuestion(
	workspaceId: string | null,
	input: RuntimeAnswerPlanQuestionRequest,
): Promise<RuntimeAnswerPlanQuestionResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.answerNKleinPlanQuestion.mutate(input);
}
