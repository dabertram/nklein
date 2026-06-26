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

/** Discover a currently-loaded, non-embedding model id from the live local endpoint; null when none/unreachable. */
export async function discoverLoadedModelId(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
	try {
		const res = await fetchImpl(`${baseUrl.replace(/\/+$/u, "")}/models`);
		if (!res.ok) {
			return null;
		}
		const payload = (await res.json()) as { data?: Array<{ id?: string }> };
		const models = payload.data ?? [];
		const chatModel = models.find((entry) => entry.id && !entry.id.includes("embed")) ?? models[0];
		return chatModel?.id ?? null;
	} catch {
		return null;
	}
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
