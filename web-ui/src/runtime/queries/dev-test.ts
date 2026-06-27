// Browser-side query helpers: dev-test + self-improvement projects and accidental-artifact migration.
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeDevTestCleanupResponse,
	RuntimeDevTestProjectPreset,
	RuntimeDevTestProjectRegistryResponse,
	RuntimeDevTestProjectResponse,
	RuntimeProjectArtifactMigrationResponse,
	RuntimeSelfImprovementProjectResponse,
} from "@/runtime/types";

export async function listDevTestProjects(workspaceId: string | null): Promise<RuntimeDevTestProjectRegistryResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.projects.listDevTestProjects.query();
}

export async function createDevTestProject(
	workspaceId: string | null,
	input?: { preset?: RuntimeDevTestProjectPreset; registryId?: string },
): Promise<RuntimeDevTestProjectResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.projects.createDevTestProject.mutate(input);
}

export async function createSelfImprovementProject(
	workspaceId: string | null,
	input: { notes?: string; evidenceBundlePath?: string; confirmSelfProject: true },
): Promise<RuntimeSelfImprovementProjectResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.projects.createSelfImprovementProject.mutate(input);
}

export async function cleanupDevTestProjects(workspaceId: string | null): Promise<RuntimeDevTestCleanupResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.projects.cleanupDevTestProjects.mutate();
}

export async function migrateAccidentalProjectArtifacts(
	workspaceId: string | null,
	projectId: string,
): Promise<RuntimeProjectArtifactMigrationResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.projects.migrateAccidentalProjectArtifacts.mutate({ projectId });
}
