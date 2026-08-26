// Browser-side query helpers for the frontier radar (status icon + panel).
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	FrontierReport,
	FrontierRunResponse,
	FrontierStatusResponse,
	ModelAcquisitionPreview,
	ModelAcquisitionPreviewRequest,
} from "@/runtime/types";

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

/**
 * P25.3 phase-3 web view: fetch the read-only setup acquisition preview for a model — format safety + the fit
 * verdict against THIS host's real memory budget (an upgrade over the radar's LLM-estimated localFit). The
 * download itself stays the consent-gated CLI handoff; this only previews.
 */
export async function fetchModelAcquisitionPreview(
	workspaceId: string | null,
	request: ModelAcquisitionPreviewRequest,
): Promise<ModelAcquisitionPreview> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.previewModelAcquisition.query(request);
}
