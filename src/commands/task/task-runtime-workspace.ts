import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import type { RuntimeWorkspaceStateResponse } from "../../core/api-contract";
import { buildKanbanRuntimeUrl, getRuntimeFetch } from "../../core/runtime-endpoint";
import { buildWorkspaceScopeHeaders } from "../../core/workspace-scope";
import { resolveProjectInputPath } from "../../projects/project-path";
import { loadWorkspaceContext, mutateWorkspaceState } from "../../state/workspace-state";
import type { RuntimeAppRouter } from "../../trpc/app-router";

/**
 * Runtime-workspace + tRPC-client infrastructure shared by every `nklein task` subcommand, extracted from the oversized
 * `task.ts` (todo §5.U). Owns the single seam between the CLI and the running runtime: the proxy tRPC client factory,
 * resolving a project path → workspace repo path (auto-registering the project when needed), and the
 * load-mutate-notify board-state transaction. Kept separate so `task.ts` stays a thin command registrar.
 */

export interface RuntimeWorkspaceMutationResult<T> {
	board: RuntimeWorkspaceStateResponse["board"];
	value: T;
}

export function createRuntimeTrpcClient(workspaceId: string | null) {
	return createTRPCProxyClient<RuntimeAppRouter>({
		links: [
			httpBatchLink({
				url: buildKanbanRuntimeUrl("/api/trpc"),
				headers: () => buildWorkspaceScopeHeaders(workspaceId),
				fetch: async (url, options) => {
					const runtimeFetch = await getRuntimeFetch();
					return runtimeFetch(url, options);
				},
			}),
		],
	});
}

export async function resolveRuntimeWorkspace(
	projectPath: string | undefined,
	cwd: string,
	options: { autoCreateIfMissing?: boolean } = {},
) {
	const normalizedProjectPath = (projectPath ?? "").trim();
	const resolvedPath = normalizedProjectPath ? resolveProjectInputPath(normalizedProjectPath, cwd) : cwd;
	return await loadWorkspaceContext(resolvedPath, {
		autoCreateIfMissing: options.autoCreateIfMissing ?? true,
		resolutionSource: normalizedProjectPath ? "explicit_path" : undefined,
		resolutionMetadata: normalizedProjectPath ? { providedProjectPath: normalizedProjectPath } : undefined,
	});
}

export async function resolveWorkspaceRepoPath(
	projectPath: string | undefined,
	cwd: string,
	options: { autoCreateIfMissing?: boolean } = {},
): Promise<string> {
	const workspace = await resolveRuntimeWorkspace(projectPath, cwd, options);
	return workspace.repoPath;
}

export async function ensureRuntimeWorkspace(workspaceRepoPath: string): Promise<string> {
	const runtimeClient = createRuntimeTrpcClient(null);
	const projects = await runtimeClient.projects.list.query().catch(() => null);
	const existingProject = projects?.projects.find((project) => project.path === workspaceRepoPath);
	if (existingProject) {
		return existingProject.id;
	}
	const added = await runtimeClient.projects.add.mutate({
		path: workspaceRepoPath,
	});
	if (!added.ok || !added.project) {
		throw new Error(added.error ?? `Could not register project ${workspaceRepoPath} in !Klein runtime.`);
	}
	return added.project.id;
}

export async function notifyRuntimeWorkspaceStateUpdated(
	runtimeClient: ReturnType<typeof createRuntimeTrpcClient>,
): Promise<void> {
	await runtimeClient.workspace.notifyStateUpdated.mutate().catch(() => null);
}

export async function updateRuntimeWorkspaceState<T>(
	runtimeClient: ReturnType<typeof createRuntimeTrpcClient>,
	workspaceRepoPath: string,
	mutate: (state: RuntimeWorkspaceStateResponse) => RuntimeWorkspaceMutationResult<T>,
): Promise<T> {
	const mutationResponse = await mutateWorkspaceState(workspaceRepoPath, (state) => {
		const mutation = mutate(state);
		return {
			board: mutation.board,
			value: mutation.value,
		};
	});

	if (mutationResponse.saved) {
		await notifyRuntimeWorkspaceStateUpdated(runtimeClient);
	}

	return mutationResponse.value;
}

export function resolveTaskBaseRef(state: RuntimeWorkspaceStateResponse): string {
	return state.git.currentBranch ?? state.git.defaultBranch ?? state.git.branches[0] ?? "";
}
