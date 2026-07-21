import { fetchLoadedModelDescriptors } from "../core/lmstudio-loaded-model-descriptors.js";
import { modelDiscoveryCacheTtlMs } from "../core/model-discovery-throttle.js";

/** A resident local embedding model bound to the chat-memory vector format. */
export interface ChatMemoryEmbedder {
	modelId: string;
	embed(text: string): Promise<number[] | null>;
}

interface OpenAiEmbeddingResponse {
	data?: Array<{ embedding?: unknown }>;
}

function embeddingsEndpoint(baseUrl: string): string {
	const normalized = baseUrl
		.trim()
		.replace(/\/+$/u, "")
		.replace(/\/embeddings$/u, "");
	return `${normalized.endsWith("/v1") ? normalized : `${normalized}/v1`}/embeddings`;
}

function parseEmbeddingResponse(value: unknown): number[] | null {
	if (!value || typeof value !== "object") return null;
	const first = (value as OpenAiEmbeddingResponse).data?.[0]?.embedding;
	if (
		!Array.isArray(first) ||
		first.length === 0 ||
		!first.every((entry) => typeof entry === "number" && Number.isFinite(entry))
	)
		return null;
	return first;
}

export function createOpenAiCompatibleChatMemoryEmbedder(input: {
	baseUrl: string;
	modelId: string;
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
	/** Narrow production recall may degrade to lexical; evidence-bound broad recall still withholds the whole band. */
	failSoft?: boolean;
}): ChatMemoryEmbedder {
	const fetchImpl = input.fetchImpl ?? fetch;
	const endpoint = embeddingsEndpoint(input.baseUrl);
	const failSoft = input.failSoft ?? true;
	return {
		modelId: input.modelId,
		async embed(text) {
			try {
				const response = await fetchImpl(endpoint, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ model: input.modelId, input: text }),
					signal: AbortSignal.timeout(input.timeoutMs ?? 30_000),
				});
				if (!response.ok) throw new Error(`embedding request failed with HTTP ${response.status}`);
				const embedding = parseEmbeddingResponse(await response.json());
				if (!embedding) throw new Error("embedding response contained no finite vector");
				return embedding;
			} catch (error) {
				if (failSoft) return null;
				throw error;
			}
		},
	};
}

const residentEmbeddingCache = new Map<string, { modelId: string | null; recordedAt: number }>();

/**
 * Resolve an ALREADY-RESIDENT embedding model from the same local endpoint as chat. Discovery is read-only and never
 * loads or downloads a model. An explicit preferred id that is not resident returns null (fail closed).
 */
export async function resolveLoadedChatMemoryEmbedder(input: {
	baseUrl: string;
	preferredModelId?: string | null;
	fetchImpl?: typeof fetch;
	failSoft?: boolean;
}): Promise<ChatMemoryEmbedder | null> {
	const fetchImpl = input.fetchImpl ?? fetch;
	const preferred = input.preferredModelId?.trim();
	const cacheKey = `${input.baseUrl.trim().replace(/\/+$/u, "")}:${preferred ?? "<first>"}`;
	const ttlMs = modelDiscoveryCacheTtlMs();
	const now = Date.now();
	const cached = ttlMs > 0 ? residentEmbeddingCache.get(cacheKey) : undefined;
	let modelId = cached && now - cached.recordedAt < ttlMs ? cached.modelId : undefined;
	if (modelId === undefined) {
		const descriptors = await fetchLoadedModelDescriptors(input.baseUrl, fetchImpl);
		const resident = descriptors.filter((descriptor) => descriptor.isEmbedding);
		const selected = preferred ? resident.find((descriptor) => descriptor.runtimeId === preferred) : resident[0];
		modelId = selected?.runtimeId ?? null;
		if (ttlMs > 0) residentEmbeddingCache.set(cacheKey, { modelId, recordedAt: now });
	}
	if (!modelId) return null;
	return createOpenAiCompatibleChatMemoryEmbedder({
		baseUrl: input.baseUrl,
		modelId,
		fetchImpl,
		...(input.failSoft !== undefined ? { failSoft: input.failSoft } : {}),
	});
}
