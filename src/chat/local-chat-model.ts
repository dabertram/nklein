import { LocalLlmClient } from "../nklein-agent/nklein-local-llm-client";
import { type ChatModelDeps, createChatModelDeps } from "./chat-local-llm-adapter";

/**
 * Shared resolution of a local chat model (todo §5.M) — used by both the `nklein chat` CLI and the runtime API's
 * chat send-turn endpoint, so there is one source of truth for "discover a loaded local model and build its
 * fail-closed client". LM Studio / Ollama expose an OpenAI-compatible `/models`; we pick the first loaded
 * non-embedding model. `LocalLlmClient` itself fails closed against cloud (invariant #1) in its constructor.
 */

export const DEFAULT_LOCAL_CHAT_BASE_URL = "http://127.0.0.1:1234/v1";
export const DEFAULT_LOCAL_CHAT_PROVIDER_ID = "lmstudio";

/**
 * TTL cache so the chat model-resolver (invoked per chat agent operation) doesn't hammer the live `/models` catalog —
 * the same 30 s throttle + `NKLEIN_MODEL_DISCOVERY_CACHE_TTL_MS` knob as the roster path (`nklein-provider-service.ts`);
 * disabled under the test runner so per-test fetch mocks aren't shadowed.
 */
const loadedModelIdCache = new Map<string, { at: number; modelId: string | null }>();

function loadedModelCacheTtlMs(): number {
	const raw = Number(process.env.NKLEIN_MODEL_DISCOVERY_CACHE_TTL_MS);
	if (Number.isFinite(raw) && raw >= 0) {
		return Math.trunc(raw);
	}
	if (process.env.VITEST || process.env.NODE_ENV === "test") {
		return 0;
	}
	return 30_000;
}

/** Clear the loaded-model-id TTL cache (tests + explicit refresh). */
export function clearLoadedModelIdCache(): void {
	loadedModelIdCache.clear();
}

/** Discover a currently-loaded, non-embedding model id from the live local endpoint; null when none/unreachable. */
export async function discoverLoadedModelId(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
	const key = baseUrl.replace(/\/+$/u, "");
	const ttlMs = loadedModelCacheTtlMs();
	const now = Date.now();
	if (ttlMs > 0) {
		const cached = loadedModelIdCache.get(key);
		if (cached && now - cached.at < ttlMs) {
			return cached.modelId;
		}
	}
	let modelId: string | null = null;
	try {
		const res = await fetchImpl(`${key}/models`);
		if (res.ok) {
			const payload = (await res.json()) as { data?: Array<{ id?: string }> };
			const models = payload.data ?? [];
			const chatModel = models.find((entry) => entry.id && !entry.id.includes("embed")) ?? models[0];
			modelId = chatModel?.id ?? null;
		}
	} catch {
		modelId = null;
	}
	if (ttlMs > 0) {
		loadedModelIdCache.set(key, { at: now, modelId });
	}
	return modelId;
}

export interface ResolveLocalChatModelOptions {
	baseUrl?: string;
	providerId?: string;
	modelId?: string;
	fetchImpl?: typeof fetch;
}

/**
 * Build the chat model deps (`complete` / `summarize`) for a loaded local model, discovering the model id from the
 * endpoint when one isn't supplied. Throws a clear, actionable error when no model is loaded so the caller (CLI or
 * tRPC endpoint) can surface "load a model" rather than failing opaquely.
 */
export async function resolveLocalChatModelDeps(options: ResolveLocalChatModelOptions = {}): Promise<ChatModelDeps> {
	const baseUrl = options.baseUrl?.trim() || DEFAULT_LOCAL_CHAT_BASE_URL;
	const providerId = options.providerId?.trim() || DEFAULT_LOCAL_CHAT_PROVIDER_ID;
	const modelId = options.modelId?.trim() || (await discoverLoadedModelId(baseUrl, options.fetchImpl ?? fetch));
	if (!modelId) {
		throw new Error(`No loaded local model found at ${baseUrl}. Load a model (e.g. in LM Studio) and try again.`);
	}
	const client = new LocalLlmClient({ providerId, modelId, baseUrl });
	return createChatModelDeps(client);
}
