import { homedir } from "node:os";
import type {
	RuntimeLlmfitCatalogUpdateCheckResponse,
	RuntimeLlmfitCatalogUpdateMode,
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
	mode: RuntimeLlmfitCatalogUpdateMode;
	homePath: string;
}) => Promise<LlmfitCatalogUpdateCheck>;

export type RuntimeLlmfitCatalogUpdatePuller = (input: {
	mode: RuntimeLlmfitCatalogUpdateMode;
	homePath: string;
}) => Promise<LlmfitCatalogPullResult>;

export interface ModelCatalogUpdateDeps {
	mode?: RuntimeLlmfitCatalogUpdateMode;
	checkCatalogUpdate?: RuntimeLlmfitCatalogUpdateChecker | null;
	pullCatalogUpdate?: RuntimeLlmfitCatalogUpdatePuller | null;
	homePath?: string;
	now?: () => number;
}

export async function handleCheckLlmfitCatalogUpdate(
	deps: ModelCatalogUpdateDeps = {},
): Promise<RuntimeLlmfitCatalogUpdateCheckResponse> {
	const mode = deps.mode ?? "notify";
	const checkedAt = deps.now?.() ?? Date.now();
	if (mode === "off") {
		return {
			mode,
			action: "noop",
			reason: "Catalog update checks are off.",
			sourceUrl: DEFAULT_LLMFIT_CATALOG_METADATA_URL,
			downloadUrl: null,
			localRevision: null,
			remoteRevision: null,
			remoteModelCount: null,
			remoteSizeBytes: null,
			checkedAt,
		};
	}
	if (!deps.checkCatalogUpdate) {
		return {
			mode,
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
	const check = await deps.checkCatalogUpdate({
		mode,
		homePath: deps.homePath ?? homedir(),
	});
	if (mode !== "auto" || check.action !== "pull_update") {
		return check;
	}
	if (!deps.pullCatalogUpdate) {
		return {
			...check,
			action: "noop",
			reason: "llmfit catalog auto-pull is unavailable in this runtime.",
			error: "llmfit catalog auto-pull is unavailable in this runtime.",
		};
	}
	return await deps.pullCatalogUpdate({
		mode,
		homePath: deps.homePath ?? homedir(),
	});
}

export async function handlePullLlmfitCatalogUpdate(
	deps: ModelCatalogUpdateDeps = {},
): Promise<RuntimeLlmfitCatalogUpdatePullResponse> {
	const mode = deps.mode ?? "notify";
	const checkedAt = deps.now?.() ?? Date.now();
	if (mode === "off") {
		return {
			mode,
			action: "noop",
			reason: "Catalog update checks are off.",
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
	if (!deps.pullCatalogUpdate) {
		return {
			mode,
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
		mode,
		homePath: deps.homePath ?? homedir(),
	});
}

export const defaultLlmfitCatalogUpdateChecker: RuntimeLlmfitCatalogUpdateChecker | null = process.env.VITEST
	? null
	: checkLlmfitCatalogUpdate;

export const defaultLlmfitCatalogUpdatePuller: RuntimeLlmfitCatalogUpdatePuller | null = process.env.VITEST
	? null
	: pullLlmfitCatalogCache;
