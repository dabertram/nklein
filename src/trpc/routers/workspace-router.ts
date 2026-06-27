// The `workspace` tRPC sub-router (§5.AK app-router decomposition) — git summary/sync/log/diff + workspace
// state/changes/search. Extracted verbatim from app-router.ts. Built from the shared `t` + `workspaceProcedure`
// (passed in, typed via type-only imports — no runtime cycle), so the router type composes identically.
import { z } from "zod";
import {
	runtimeGitCheckoutRequestSchema,
	runtimeGitCheckoutResponseSchema,
	runtimeGitCommitDiffRequestSchema,
	runtimeGitCommitDiffResponseSchema,
	runtimeGitDiscardResponseSchema,
	runtimeGitLogRequestSchema,
	runtimeGitLogResponseSchema,
	runtimeGitRefsResponseSchema,
	runtimeGitSummaryResponseSchema,
	runtimeGitSyncActionSchema,
	runtimeGitSyncResponseSchema,
	runtimeTaskWorkspaceInfoRequestSchema,
	runtimeWorkspaceChangesRequestSchema,
	runtimeWorkspaceChangesResponseSchema,
	runtimeWorkspaceFileSearchRequestSchema,
	runtimeWorkspaceFileSearchResponseSchema,
	runtimeWorkspaceStateNotifyResponseSchema,
	runtimeWorkspaceStateResponseSchema,
	runtimeWorkspaceStateSaveRequestSchema,
	runtimeWorktreeDeleteRequestSchema,
	runtimeWorktreeDeleteResponseSchema,
} from "../../core/api-contract";
import type { RuntimeTrpcBuilder, RuntimeWorkspaceProcedure } from "../app-router";

const optionalTaskWorkspaceInfoRequestSchema = runtimeTaskWorkspaceInfoRequestSchema.nullable().optional();
const gitSyncActionInputSchema = z.object({
	action: runtimeGitSyncActionSchema,
});

export function buildWorkspaceRouter(t: RuntimeTrpcBuilder, workspaceProcedure: RuntimeWorkspaceProcedure) {
	return t.router({
		getGitSummary: workspaceProcedure
			.input(optionalTaskWorkspaceInfoRequestSchema)
			.output(runtimeGitSummaryResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.workspaceApi.loadGitSummary(ctx.workspaceScope, input ?? null);
			}),
		runGitSyncAction: workspaceProcedure
			.input(gitSyncActionInputSchema)
			.output(runtimeGitSyncResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.runGitSyncAction(ctx.workspaceScope, input);
			}),
		checkoutGitBranch: workspaceProcedure
			.input(runtimeGitCheckoutRequestSchema)
			.output(runtimeGitCheckoutResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.checkoutGitBranch(ctx.workspaceScope, input);
			}),
		discardGitChanges: workspaceProcedure
			.input(optionalTaskWorkspaceInfoRequestSchema)
			.output(runtimeGitDiscardResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.discardGitChanges(ctx.workspaceScope, input ?? null);
			}),
		getChanges: workspaceProcedure
			.input(runtimeWorkspaceChangesRequestSchema)
			.output(runtimeWorkspaceChangesResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.workspaceApi.loadChanges(ctx.workspaceScope, input);
			}),
		deleteWorktree: workspaceProcedure
			.input(runtimeWorktreeDeleteRequestSchema)
			.output(runtimeWorktreeDeleteResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.deleteWorktree(ctx.workspaceScope, input);
			}),
		searchFiles: workspaceProcedure
			.input(runtimeWorkspaceFileSearchRequestSchema)
			.output(runtimeWorkspaceFileSearchResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.workspaceApi.searchFiles(ctx.workspaceScope, input);
			}),
		getState: workspaceProcedure.output(runtimeWorkspaceStateResponseSchema).query(async ({ ctx }) => {
			return await ctx.workspaceApi.loadState(ctx.workspaceScope);
		}),
		notifyStateUpdated: workspaceProcedure
			.output(runtimeWorkspaceStateNotifyResponseSchema)
			.mutation(async ({ ctx }) => {
				return await ctx.workspaceApi.notifyStateUpdated(ctx.workspaceScope);
			}),
		saveState: workspaceProcedure
			.input(runtimeWorkspaceStateSaveRequestSchema)
			.output(runtimeWorkspaceStateResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.saveState(ctx.workspaceScope, input);
			}),
		getWorkspaceChanges: workspaceProcedure.output(runtimeWorkspaceChangesResponseSchema).query(async ({ ctx }) => {
			return await ctx.workspaceApi.loadWorkspaceChanges(ctx.workspaceScope);
		}),
		getGitLog: workspaceProcedure
			.input(runtimeGitLogRequestSchema)
			.output(runtimeGitLogResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.workspaceApi.loadGitLog(ctx.workspaceScope, input);
			}),
		getGitRefs: workspaceProcedure
			.input(optionalTaskWorkspaceInfoRequestSchema)
			.output(runtimeGitRefsResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.workspaceApi.loadGitRefs(ctx.workspaceScope, input ?? null);
			}),
		getCommitDiff: workspaceProcedure
			.input(runtimeGitCommitDiffRequestSchema)
			.output(runtimeGitCommitDiffResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.workspaceApi.loadCommitDiff(ctx.workspaceScope, input);
			}),
	});
}
