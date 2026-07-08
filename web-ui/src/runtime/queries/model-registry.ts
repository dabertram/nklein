// Browser-side query helpers: the NKlein model registry (per-model context-window / concurrency overrides + prune).
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeLlmfitCatalogUpdateCheckResponse,
	RuntimeNKleinModelContextWindowOverrideResponse,
	RuntimeNKleinModelMaxConcurrentRequestsResponse,
	RuntimeNKleinModelRegistryPruneResponse,
	RuntimeNKleinModelRegistryRemoveResponse,
	RuntimeNKleinModelRegistryResponse,
} from "@/runtime/types";

export async function fetchNKleinModelRegistry(
	workspaceId: string | null,
): Promise<RuntimeNKleinModelRegistryResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getNKleinModelRegistry.query();
}

export async function checkLlmfitCatalogUpdate(
	workspaceId: string | null,
): Promise<RuntimeLlmfitCatalogUpdateCheckResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.checkLlmfitCatalogUpdate.mutate();
}

export async function saveNKleinModelContextWindowOverride(
	workspaceId: string | null,
	input: {
		providerId: string;
		modelId: string;
		endpoint?: string | null;
		contextWindow: number | null;
	},
): Promise<RuntimeNKleinModelContextWindowOverrideResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.saveNKleinModelContextWindowOverride.mutate(input);
}

export async function saveNKleinModelMaxConcurrentRequests(
	workspaceId: string | null,
	input: {
		providerId: string;
		modelId: string;
		endpoint?: string | null;
		maxConcurrentRequests: number | null;
	},
): Promise<RuntimeNKleinModelMaxConcurrentRequestsResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.saveNKleinModelMaxConcurrentRequests.mutate(input);
}

export async function removeNKleinModelRegistryEntry(
	workspaceId: string | null,
	input: { key: string },
): Promise<RuntimeNKleinModelRegistryRemoveResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.removeNKleinModelRegistryEntry.mutate(input);
}

export async function pruneNKleinModelRegistry(
	workspaceId: string | null,
): Promise<RuntimeNKleinModelRegistryPruneResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.pruneNKleinModelRegistry.mutate();
}
