import { resolveKleinCorePyConfig } from "../config/klein-core-config";
import { defaultEmbeddingIdleUnloadScheduler, type EmbeddingIdleUnloadScheduler } from "./nklein-embedding-idle-unload";
import {
	DEFAULT_EMBEDDING_MODEL_MANIFEST,
	type EmbeddingModelManagerOptions,
	type EmbeddingModelManifest,
	type EnsureEmbeddingModelResult,
	ensureEmbeddingModel,
} from "./nklein-embedding-model-manager";

export type NKleinCodeEmbeddingProviderKind = "local_lexical" | "openai_compatible" | "local_gguf";
export interface NKleinCodeEmbeddingSettings {
	provider: NKleinCodeEmbeddingProviderKind;
	model: string | null;
	baseUrl: string | null;
}

export type NKleinCodeEmbeddingVector = Map<string, number>;

export interface NKleinCodeEmbeddingProvider {
	kind: NKleinCodeEmbeddingProviderKind;
	model: string;
	cacheKey: string;
	embed(text: string): Promise<NKleinCodeEmbeddingVector>;
}

interface OpenAiEmbeddingResponse {
	data: Array<{
		embedding: number[];
	}>;
}

export const LOCAL_LEXICAL_CODE_EMBEDDING_MODEL = "kanban-local-lexical-vector-v1";

function tokenize(text: string): string[] {
	return text
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.toLowerCase()
		.split(/[^a-z0-9_$.-]+/g)
		.map((token) => token.trim())
		.filter((token) => token.length >= 2);
}

function vectorizeSparseTokens(text: string): NKleinCodeEmbeddingVector {
	const vector: NKleinCodeEmbeddingVector = new Map();
	for (const token of tokenize(text)) {
		vector.set(token, (vector.get(token) ?? 0) + 1);
	}
	return vector;
}

function vectorizeDenseEmbedding(embedding: readonly number[]): NKleinCodeEmbeddingVector {
	const vector: NKleinCodeEmbeddingVector = new Map();
	for (const [index, value] of embedding.entries()) {
		if (Number.isFinite(value) && value !== 0) {
			vector.set(`dim:${index}`, value);
		}
	}
	return vector;
}

function readOpenAiEmbeddingResponse(value: unknown): OpenAiEmbeddingResponse | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	const data = (value as Record<string, unknown>).data;
	if (!Array.isArray(data)) {
		return null;
	}
	const first = data[0];
	if (!first || typeof first !== "object") {
		return null;
	}
	const embedding = (first as Record<string, unknown>).embedding;
	if (!Array.isArray(embedding) || !embedding.every((entry) => typeof entry === "number")) {
		return null;
	}
	return {
		data: [{ embedding }],
	};
}

function createLocalLexicalEmbeddingProvider(): NKleinCodeEmbeddingProvider {
	return {
		kind: "local_lexical",
		model: LOCAL_LEXICAL_CODE_EMBEDDING_MODEL,
		cacheKey: LOCAL_LEXICAL_CODE_EMBEDDING_MODEL,
		async embed(text) {
			return vectorizeSparseTokens(text);
		},
	};
}

function createOpenAiCompatibleEmbeddingProvider(input: {
	baseUrl: string | null | undefined;
	model: string | null | undefined;
	apiKey?: string | null | undefined;
}): NKleinCodeEmbeddingProvider | null {
	const endpoint = input.baseUrl?.trim();
	const model = input.model?.trim();
	if (!endpoint || !model) {
		return null;
	}
	const apiKey = input.apiKey?.trim();
	return {
		kind: "openai_compatible",
		model,
		cacheKey: `openai-compatible:${endpoint}:${model}`,
		async embed(text) {
			const response = await fetch(endpoint, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
				},
				body: JSON.stringify({
					model,
					input: text,
				}),
			});
			if (!response.ok) {
				throw new Error(`Embedding provider failed with HTTP ${response.status}.`);
			}
			const parsed = readOpenAiEmbeddingResponse(await response.json());
			if (!parsed) {
				throw new Error("Embedding provider returned an invalid embedding response.");
			}
			return vectorizeDenseEmbedding(parsed.data[0]?.embedding ?? []);
		},
	};
}

function readKleinCoreEmbedResponse(value: unknown): number[] | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	const embeddings = (value as Record<string, unknown>).embeddings;
	if (!Array.isArray(embeddings)) {
		return null;
	}
	const first = embeddings[0];
	if (!Array.isArray(first) || !first.every((entry) => typeof entry === "number")) {
		return null;
	}
	return first;
}

/**
 * Built-in zero-config code embedding: an in-process quantized GGUF model served by the Python core
 * (`/v1/embed` with a host-downloaded `gguf_path`). The model is auto-downloaded on first use (one sanctioned
 * fetch, lazily, once) and the dense vector is sparsified for the index. Any failure — sidecar unreachable,
 * download/integrity failure, bad response — degrades to the lexical embedding for that call so indexing never
 * hard-fails. Only constructed when the Python core is enabled; otherwise the lexical provider is used directly
 * so the index's vectors and cache key stay consistently lexical.
 */
export function createLocalGgufEmbeddingProvider(input: {
	sidecarUrl: string;
	manifest?: EmbeddingModelManifest;
	nThreads?: number | null;
	fetchImpl?: typeof fetch;
	ensureModel?: (
		manifest: EmbeddingModelManifest,
		options?: EmbeddingModelManagerOptions,
	) => Promise<EnsureEmbeddingModelResult>;
	managerOptions?: EmbeddingModelManagerOptions;
	/** Scheduler that frees the resident model in the core after an idle window. Defaults to the singleton. */
	idleUnloadScheduler?: EmbeddingIdleUnloadScheduler;
	/** Override the idle-unload window (ms); `<= 0` disables idle unloading for this provider. */
	idleUnloadMs?: number;
}): NKleinCodeEmbeddingProvider {
	const manifest = input.manifest ?? DEFAULT_EMBEDDING_MODEL_MANIFEST;
	const sidecarUrl = input.sidecarUrl.replace(/\/+$/u, "");
	const fetchImpl = input.fetchImpl ?? fetch;
	const ensureModel = input.ensureModel ?? ensureEmbeddingModel;
	const idleUnloadScheduler = input.idleUnloadScheduler ?? defaultEmbeddingIdleUnloadScheduler;
	const idleUnloadMs = input.idleUnloadMs;
	const idleUnloadEnabled = idleUnloadMs === undefined || idleUnloadMs > 0;
	let modelPathPromise: Promise<string> | null = null;
	const ensureModelOnce = (): Promise<string> => {
		if (!modelPathPromise) {
			modelPathPromise = ensureModel(manifest, input.managerOptions).then((result) => result.modelPath);
		}
		return modelPathPromise;
	};
	return {
		kind: "local_gguf",
		model: manifest.id,
		cacheKey: `local-gguf:${manifest.id}:${manifest.version}`,
		async embed(text) {
			// Resolve the model path first; if provisioning fails nothing is loaded in the core, so degrade to
			// lexical without arming an unload.
			const ggufPath = await ensureModelOnce().catch(() => null);
			if (ggufPath === null) {
				return vectorizeSparseTokens(text);
			}
			try {
				const response = await fetchImpl(`${sidecarUrl}/v1/embed`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						texts: [text],
						gguf_path: ggufPath,
						...(typeof input.nThreads === "number" ? { n_threads: input.nThreads } : {}),
					}),
				});
				if (!response.ok) {
					throw new Error(`Klein core /v1/embed failed with HTTP ${response.status}.`);
				}
				const embedding = readKleinCoreEmbedResponse(await response.json());
				if (!embedding) {
					throw new Error("Klein core /v1/embed returned an invalid embedding response.");
				}
				return vectorizeDenseEmbedding(embedding);
			} catch {
				// Degrade to lexical so indexing keeps working when the core/model is unavailable.
				return vectorizeSparseTokens(text);
			} finally {
				// The core has now (lazily) loaded the model for this gguf_path; (re)arm its idle unload so it
				// frees the RAM once indexing goes quiet. Re-armed on every embed, so active bursts never unload.
				if (idleUnloadEnabled) {
					idleUnloadScheduler.touch({ sidecarUrl, ggufPath, idleMs: idleUnloadMs });
				}
			}
		},
	};
}

export function createNKleinCodeEmbeddingProvider(env: NodeJS.ProcessEnv = process.env): NKleinCodeEmbeddingProvider {
	if (env.KANBAN_CODE_EMBEDDING_PROVIDER?.trim() === "openai-compatible") {
		return (
			createOpenAiCompatibleEmbeddingProvider({
				baseUrl: env.KANBAN_CODE_EMBEDDING_BASE_URL,
				model: env.KANBAN_CODE_EMBEDDING_MODEL,
				apiKey: env.KANBAN_CODE_EMBEDDING_API_KEY,
			}) ?? createLocalLexicalEmbeddingProvider()
		);
	}
	if (env.KANBAN_CODE_EMBEDDING_PROVIDER?.trim() === "local-gguf") {
		const core = resolveKleinCorePyConfig(env);
		if (core.enabled) {
			return createLocalGgufEmbeddingProvider({ sidecarUrl: core.sidecarUrl });
		}
	}
	return createLocalLexicalEmbeddingProvider();
}

export function createNKleinCodeEmbeddingProviderFromSettings(
	settings: NKleinCodeEmbeddingSettings,
	env: NodeJS.ProcessEnv = process.env,
): NKleinCodeEmbeddingProvider {
	if (settings.provider === "openai_compatible") {
		return (
			createOpenAiCompatibleEmbeddingProvider({
				baseUrl: settings.baseUrl,
				model: settings.model,
				apiKey: env.KANBAN_CODE_EMBEDDING_API_KEY,
			}) ?? createLocalLexicalEmbeddingProvider()
		);
	}
	if (settings.provider === "local_gguf") {
		const core = resolveKleinCorePyConfig(env);
		// The dense GGUF path needs the Python core; without it, stay honestly lexical (consistent vectors/key).
		if (!core.enabled) {
			return createLocalLexicalEmbeddingProvider();
		}
		return createLocalGgufEmbeddingProvider({ sidecarUrl: core.sidecarUrl });
	}
	return createLocalLexicalEmbeddingProvider();
}
