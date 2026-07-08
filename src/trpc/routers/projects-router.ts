// The `projects` tRPC sub-router (§5.AK app-router decomposition — first slice). Extracted verbatim from
// app-router.ts so project-endpoint changes get their own lane instead of competing in the 1200-line monolith. Built
// from the shared `t` (passed in, typed via `RuntimeTrpcBuilder`) so the router type composes identically; the
// `RuntimeTrpcBuilder` import is type-only (erased), so there is no runtime cycle with app-router.
import {
	runtimeDevTestCleanupResponseSchema,
	runtimeDevTestProjectRegistryResponseSchema,
	runtimeDevTestProjectRequestSchema,
	runtimeDevTestProjectResponseSchema,
	runtimeDirectoryListRequestSchema,
	runtimeDirectoryListResponseSchema,
	runtimeProjectAddRequestSchema,
	runtimeProjectAddResponseSchema,
	runtimeProjectArtifactMigrationRequestSchema,
	runtimeProjectArtifactMigrationResponseSchema,
	runtimeProjectAutoResumeRequestSchema,
	runtimeProjectAutoResumeResponseSchema,
	runtimeProjectDirectoryPickerResponseSchema,
	runtimeProjectRemoveRequestSchema,
	runtimeProjectRemoveResponseSchema,
	runtimeProjectsResponseSchema,
	runtimeSelfImprovementProjectRequestSchema,
	runtimeSelfImprovementProjectResponseSchema,
} from "../../core/api-contract";
import type { RuntimeTrpcBuilder } from "../app-router";

export function buildProjectsRouter(t: RuntimeTrpcBuilder) {
	return t.router({
		list: t.procedure.output(runtimeProjectsResponseSchema).query(async ({ ctx }) => {
			return await ctx.projectsApi.listProjects(ctx.requestedWorkspaceId);
		}),
		add: t.procedure
			.input(runtimeProjectAddRequestSchema)
			.output(runtimeProjectAddResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.projectsApi.addProject(ctx.requestedWorkspaceId, input);
			}),
		listDevTestProjects: t.procedure.output(runtimeDevTestProjectRegistryResponseSchema).query(async ({ ctx }) => {
			return await ctx.projectsApi.listDevTestProjects();
		}),
		createDevTestProject: t.procedure
			.input(runtimeDevTestProjectRequestSchema)
			.output(runtimeDevTestProjectResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.projectsApi.createDevTestProject(ctx.requestedWorkspaceId, input);
			}),
		createSelfImprovementProject: t.procedure
			.input(runtimeSelfImprovementProjectRequestSchema)
			.output(runtimeSelfImprovementProjectResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.projectsApi.createSelfImprovementProject(ctx.requestedWorkspaceId, input);
			}),
		cleanupDevTestProjects: t.procedure.output(runtimeDevTestCleanupResponseSchema).mutation(async ({ ctx }) => {
			return await ctx.projectsApi.cleanupDevTestProjects(ctx.requestedWorkspaceId);
		}),
		remove: t.procedure
			.input(runtimeProjectRemoveRequestSchema)
			.output(runtimeProjectRemoveResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.projectsApi.removeProject(ctx.requestedWorkspaceId, input);
			}),
		setAutoResume: t.procedure
			.input(runtimeProjectAutoResumeRequestSchema)
			.output(runtimeProjectAutoResumeResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.projectsApi.setAutoResume(ctx.requestedWorkspaceId, input);
			}),
		migrateAccidentalProjectArtifacts: t.procedure
			.input(runtimeProjectArtifactMigrationRequestSchema)
			.output(runtimeProjectArtifactMigrationResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.projectsApi.migrateAccidentalProjectArtifacts(ctx.requestedWorkspaceId, input);
			}),
		pickDirectory: t.procedure.output(runtimeProjectDirectoryPickerResponseSchema).mutation(async ({ ctx }) => {
			return await ctx.projectsApi.pickProjectDirectory(ctx.requestedWorkspaceId);
		}),
		listDirectoryContents: t.procedure
			.input(runtimeDirectoryListRequestSchema)
			.output(runtimeDirectoryListResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.projectsApi.listDirectoryContents(ctx.requestedWorkspaceId, input);
			}),
	});
}
