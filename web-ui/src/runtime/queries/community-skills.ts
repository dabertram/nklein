import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeCommunitySkillDiscoveryRequest,
	RuntimeCommunitySkillDiscoveryResponse,
	RuntimeCommunitySkillExecutionApproveRequest,
	RuntimeCommunitySkillExecutionApproveResponse,
	RuntimeCommunitySkillExecutionReviewRequest,
	RuntimeCommunitySkillExecutionReviewResponse,
	RuntimeCommunitySkillImportApproveRequest,
	RuntimeCommunitySkillImportApproveResponse,
	RuntimeCommunitySkillImportListResponse,
	RuntimeCommunitySkillImportReviewRequest,
	RuntimeCommunitySkillImportReviewResponse,
	RuntimeCommunitySkillSuggestionRequest,
	RuntimeCommunitySkillSuggestionResponse,
} from "@/runtime/types";

export async function discoverCommunitySkills(
	workspaceId: string | null,
	input: RuntimeCommunitySkillDiscoveryRequest,
): Promise<RuntimeCommunitySkillDiscoveryResponse> {
	return await getRuntimeTrpcClient(workspaceId).runtime.discoverCommunitySkills.query(input);
}

export async function listCommunitySkillImports(
	workspaceId: string | null,
): Promise<RuntimeCommunitySkillImportListResponse> {
	return await getRuntimeTrpcClient(workspaceId).runtime.listCommunitySkillImports.query();
}

export async function reviewCommunitySkillImport(
	workspaceId: string | null,
	input: RuntimeCommunitySkillImportReviewRequest,
): Promise<RuntimeCommunitySkillImportReviewResponse> {
	return await getRuntimeTrpcClient(workspaceId).runtime.reviewCommunitySkillImport.query(input);
}

export async function approveCommunitySkillImport(
	workspaceId: string | null,
	input: RuntimeCommunitySkillImportApproveRequest,
): Promise<RuntimeCommunitySkillImportApproveResponse> {
	return await getRuntimeTrpcClient(workspaceId).runtime.approveCommunitySkillImport.mutate(input);
}

export async function suggestCommunitySkills(
	workspaceId: string | null,
	input: RuntimeCommunitySkillSuggestionRequest,
): Promise<RuntimeCommunitySkillSuggestionResponse> {
	return await getRuntimeTrpcClient(workspaceId).runtime.suggestCommunitySkills.query(input);
}

export async function reviewCommunitySkillExecution(
	workspaceId: string | null,
	input: RuntimeCommunitySkillExecutionReviewRequest,
): Promise<RuntimeCommunitySkillExecutionReviewResponse> {
	return await getRuntimeTrpcClient(workspaceId).runtime.reviewCommunitySkillExecution.query(input);
}

export async function approveCommunitySkillExecution(
	workspaceId: string | null,
	input: RuntimeCommunitySkillExecutionApproveRequest,
): Promise<RuntimeCommunitySkillExecutionApproveResponse> {
	return await getRuntimeTrpcClient(workspaceId).runtime.approveCommunitySkillExecution.mutate(input);
}
