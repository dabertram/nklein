// Browser-side query helpers for the frontier radar (status icon + panel).
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { FrontierReport, FrontierRunResponse, FrontierStatusResponse } from "@/runtime/types";

export async function fetchFrontierStatus(workspaceId: string | null): Promise<FrontierStatusResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.frontierStatus.query();
}

export async function fetchFrontierLatest(workspaceId: string | null): Promise<FrontierReport | null> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.frontierLatest.query();
}

export async function runFrontierResearch(workspaceId: string | null): Promise<FrontierRunResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.frontierRun.mutate();
}
