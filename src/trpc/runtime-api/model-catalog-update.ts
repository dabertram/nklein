import { homedir } from "node:os";
import type {
	RuntimeLlmfitCatalogUpdateCheckResponse,
	RuntimeLlmfitCatalogUpdatePullResponse,
} from "../../core/api-contract";
import {
	checkLlmfitCatalogUpdate,
	DEFAULT_LLMFIT_CATALOG_METADATA_URL,
	type LlmfitCatalogPullResult,
	type LlmfitCatalogUpdateCheck,
	pullLlmfitCatalogCache,
} from "../../core/llmfit-catalog-update";

export type RuntimeLlmfitCatalogUpdateChecker = (input: {
	mode: "notify";
	homePath: string;
}) => Promise<LlmfitCatalogUpdateCheck>;

export type RuntimeLlmfitCatalogUpdatePuller = (input: {
	mode: "notify";
	homePath: string;
}) => Promise<LlmfitCatalogPullResult>;

export interface ModelCatalogUpdateDeps {
	checkCatalogUpdate?: RuntimeLlmfitCatalogUpdateChecker | null;
	pullCatalogUpdate?: RuntimeLlmfitCatalogUpdatePuller | null;
	homePath?: string;
	now?: () => number;
}

export async function handleCheckLlmfitCatalogUpdate(
	deps: ModelCatalogUpdateDeps = {},
): Promise<RuntimeLlmfitCatalogUpdateCheckResponse> {
	const checkedAt = deps.now?.() ?? Date.now();
	if (!deps.checkCatalogUpdate) {
		return {
			mode: "notify",
			action: "noop",
			reason: "llmfit catalog update checks are unavailable in this runtime.",
			sourceUrl: DEFAULT_LLMFIT_CATALOG_METADATA_URL,
			downloadUrl: null,
			localRevision: null,
			remoteRevision: null,
			remoteModelCount: null,
			remoteSizeBytes: null,
			checkedAt,
		};
	}
	return await deps.checkCatalogUpdate({
		mode: "notify",
		homePath: deps.homePath ?? homedir(),
	});
}

export async function handlePullLlmfitCatalogUpdate(
	deps: ModelCatalogUpdateDeps = {},
): Promise<RuntimeLlmfitCatalogUpdatePullResponse> {
	const checkedAt = deps.now?.() ?? Date.now();
	if (!deps.pullCatalogUpdate) {
		return {
			mode: "notify",
			action: "noop",
			reason: "llmfit catalog pulls are unavailable in this runtime.",
			sourceUrl: DEFAULT_LLMFIT_CATALOG_METADATA_URL,
			downloadUrl: null,
			localRevision: null,
			remoteRevision: null,
			remoteModelCount: null,
			remoteSizeBytes: null,
			checkedAt,
			cachePath: null,
			written: false,
		};
	}
	return await deps.pullCatalogUpdate({
		mode: "notify",
		homePath: deps.homePath ?? homedir(),
	});
}

export const defaultLlmfitCatalogUpdateChecker: RuntimeLlmfitCatalogUpdateChecker | null = process.env.VITEST
	? null
	: checkLlmfitCatalogUpdate;

export const defaultLlmfitCatalogUpdatePuller: RuntimeLlmfitCatalogUpdatePuller | null = process.env.VITEST
	? null
	: pullLlmfitCatalogCache;
