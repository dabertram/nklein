import { homedir } from "node:os";
import type {
	RuntimeLlmfitCatalogUpdateCheckResponse,
	RuntimeLlmfitCatalogUpdateMode,
	RuntimeLlmfitCatalogUpdatePullResponse,
} from "../../core/api-contract";
import { loadLlmfitCatalogSupplement } from "../../core/llmfit-catalog-supplement";
import {
	checkLlmfitCatalogUpdate,
	DEFAULT_LLMFIT_CATALOG_METADATA_URL,
	type LlmfitCatalogPullResult,
	type LlmfitCatalogUpdateCheck,
	pullLlmfitCatalogCache,
} from "../../core/llmfit-catalog-update";
import { registerModelCatalogLlmfitSupplement } from "../../core/model-capability-catalog";

export type RuntimeLlmfitCatalogUpdateChecker = (input: {
	mode: RuntimeLlmfitCatalogUpdateMode;
	homePath: string;
}) => Promise<LlmfitCatalogUpdateCheck>;

export type RuntimeLlmfitCatalogUpdatePuller = (input: {
	mode: RuntimeLlmfitCatalogUpdateMode;
	homePath: string;
}) => Promise<LlmfitCatalogPullResult>;

export type RuntimeLlmfitCatalogSupplementRegistrar = (cachePath: string) => Promise<void>;

export interface ModelCatalogUpdateDeps {
	mode?: RuntimeLlmfitCatalogUpdateMode;
	checkCatalogUpdate?: RuntimeLlmfitCatalogUpdateChecker | null;
	pullCatalogUpdate?: RuntimeLlmfitCatalogUpdatePuller | null;
	registerCatalogSupplement?: RuntimeLlmfitCatalogSupplementRegistrar | null;
	homePath?: string;
	now?: () => number;
}

const liveCatalogNetworkEnabled = !process.env.VITEST;

async function pullAndMaybeRegisterLlmfitCatalog(
	deps: ModelCatalogUpdateDeps,
	mode: RuntimeLlmfitCatalogUpdateMode,
): Promise<LlmfitCatalogPullResult> {
	const result = await deps.pullCatalogUpdate?.({
		mode,
		homePath: deps.homePath ?? homedir(),
	});
	if (!result) {
		const checkedAt = deps.now?.() ?? Date.now();
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
	if (result.written && result.cachePath && deps.registerCatalogSupplement) {
		await deps.registerCatalogSupplement(result.cachePath).catch(() => {});
	}
	return result;
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
	return await pullAndMaybeRegisterLlmfitCatalog(deps, mode);
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
	return await pullAndMaybeRegisterLlmfitCatalog(deps, mode);
}

export const defaultLlmfitCatalogUpdateChecker: RuntimeLlmfitCatalogUpdateChecker | null = liveCatalogNetworkEnabled
	? checkLlmfitCatalogUpdate
	: null;

export const defaultLlmfitCatalogUpdatePuller: RuntimeLlmfitCatalogUpdatePuller | null = liveCatalogNetworkEnabled
	? pullLlmfitCatalogCache
	: null;

export const defaultLlmfitCatalogSupplementRegistrar: RuntimeLlmfitCatalogSupplementRegistrar | null =
	liveCatalogNetworkEnabled
		? async (cachePath: string) => {
				const supplement = await loadLlmfitCatalogSupplement(cachePath);
				registerModelCatalogLlmfitSupplement(supplement.entries);
			}
		: null;
