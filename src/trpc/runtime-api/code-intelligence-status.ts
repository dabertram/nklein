import { stat } from "node:fs/promises";
import { TRPCError } from "@trpc/server";
import { resolveKleinCorePyConfig } from "../../config/klein-core-config";
import type { RuntimeConfigState } from "../../config/runtime-config";
import type { RuntimeNKleinCodeIntelligenceStatusResponse } from "../../core/api-contract";
import { createNKleinCodeEmbeddingProviderFromSettings } from "../../nklein-agent/nklein-code-embeddings";
import { getNKleinCodeIndexStatus } from "../../nklein-agent/nklein-code-index";
import {
	DEFAULT_EMBEDDING_MODEL_MANIFEST,
	getEmbeddingModelPath,
	isEmbeddingModelInstalled,
} from "../../nklein-agent/nklein-embedding-model-manager";
import { buildNKleinRepoMap } from "../../nklein-agent/nklein-repo-map";
import type { RuntimeTrpcWorkspaceScope } from "../app-router";

/**
 * Handler for the code-intelligence status procedure, extracted from the oversized `runtime-api.ts`
 * (§5.X / architecture recommendation #3). Read-only: it builds the repo-map summary, the code-index status,
 * and the embedding-model file state for a workspace. It depends only on `loadScopedRuntimeConfig` (one deps
 * slice) plus module-level SDK/config helpers, keeping the same behavior and wire contract as before.
 */
export interface CodeIntelligenceStatusDeps {
	loadScopedRuntimeConfig: (scope: RuntimeTrpcWorkspaceScope) => Promise<RuntimeConfigState>;
}

export async function handleGetNKleinCodeIntelligenceStatus(
	workspaceScope: RuntimeTrpcWorkspaceScope | null,
	deps: CodeIntelligenceStatusDeps,
): Promise<RuntimeNKleinCodeIntelligenceStatusResponse> {
	if (!workspaceScope) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "A workspace is required to inspect code intelligence status.",
		});
	}
	const runtimeConfig = await deps.loadScopedRuntimeConfig(workspaceScope);
	const embeddingProvider = createNKleinCodeEmbeddingProviderFromSettings(
		runtimeConfig.effectiveCodeEmbeddingSettings,
	);
	const [repoMapResult, codeIndexResult] = await Promise.allSettled([
		buildNKleinRepoMap({ workspacePath: workspaceScope.workspacePath }),
		getNKleinCodeIndexStatus({
			workspacePath: workspaceScope.workspacePath,
			embeddingProvider,
		}),
	]);
	const repoMap =
		repoMapResult.status === "fulfilled"
			? {
					filesScanned: repoMapResult.value.filesScanned,
					symbols: repoMapResult.value.symbols.length,
					tokenCount: repoMapResult.value.tokenCount,
					truncated: repoMapResult.value.truncated,
					available: repoMapResult.value.symbols.length > 0,
					error: null,
				}
			: {
					filesScanned: 0,
					symbols: 0,
					tokenCount: 0,
					truncated: false,
					available: false,
					error:
						repoMapResult.reason instanceof Error ? repoMapResult.reason.message : String(repoMapResult.reason),
				};
	const codeIndex =
		codeIndexResult.status === "fulfilled"
			? {
					...codeIndexResult.value,
					error: null,
				}
			: {
					cachePath: null,
					cacheExists: false,
					embeddingProvider: null,
					embeddingModel: null,
					updatedAt: null,
					totalFiles: 0,
					totalChunks: 0,
					indexedFiles: 0,
					indexedChunks: 0,
					staleFiles: 0,
					missingFiles: 0,
					searchAvailable: false,
					progress: {
						phase: "error" as const,
						startedAt: null,
						updatedAt: Date.now(),
						filesTotal: 0,
						filesProcessed: 0,
						chunksTotal: 0,
						chunksProcessed: 0,
						cacheHitCount: 0,
						cacheMissCount: 0,
						message:
							codeIndexResult.reason instanceof Error
								? codeIndexResult.reason.message
								: String(codeIndexResult.reason),
					},
					error:
						codeIndexResult.reason instanceof Error
							? codeIndexResult.reason.message
							: String(codeIndexResult.reason),
				};
	let embeddingModelFile: {
		modelId: string;
		label: string;
		installed: boolean;
		sizeBytes: number | null;
		coreEnabled: boolean;
	} | null = null;
	if (runtimeConfig.effectiveCodeEmbeddingSettings.provider === "local_gguf") {
		const manifest = DEFAULT_EMBEDDING_MODEL_MANIFEST;
		const installed = await isEmbeddingModelInstalled(manifest);
		const sizeBytes = installed
			? await stat(getEmbeddingModelPath(manifest))
					.then((info) => info.size)
					.catch(() => null)
			: null;
		embeddingModelFile = {
			modelId: manifest.id,
			label: manifest.label,
			installed,
			sizeBytes,
			coreEnabled: resolveKleinCorePyConfig().enabled,
		};
	}
	return {
		codeEmbeddingSettings: {
			globalDefaults: runtimeConfig.codeEmbeddingDefaults,
			projectOverride: runtimeConfig.codeEmbeddingOverride,
			effective: runtimeConfig.effectiveCodeEmbeddingSettings,
			source: runtimeConfig.codeEmbeddingOverride ? ("project" as const) : ("global" as const),
		},
		embeddingModelFile,
		repoMap,
		codeIndex,
	};
}
