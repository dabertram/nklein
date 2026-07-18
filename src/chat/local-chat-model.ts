import { fetchLoadedModelIds, shouldBlockUnloadedModel } from "../core/lmstudio-loaded-models";
import { DEFAULT_LOCAL_MODEL_BASE_URL } from "../core/local-model-endpoint";
import { parseModelAttributes } from "../core/model-attributes";
import { assessModelSuitability, resolveActiveModelSuitabilityPolicy } from "../core/model-capability-catalog";
import { modelDiscoveryCacheTtlMs } from "../core/model-discovery-throttle";
import { LocalLlmClient } from "../nklein-agent/nklein-local-llm-client";
import { type ChatModelDeps, createChatModelDeps } from "./chat-local-llm-adapter";

/**
 * Shared resolution of a local chat model (todo §5.M) — used by both the `nklein chat` CLI and the runtime API's
 * chat send-turn endpoint, so there is one source of truth for "discover a loaded local model and build its
 * fail-closed client". LM Studio / Ollama expose an OpenAI-compatible `/models`; we pick the first loaded
 * non-embedding model. `LocalLlmClient` itself fails closed against cloud (invariant #1) in its constructor.
 */

/** @deprecated prefer {@link DEFAULT_LOCAL_MODEL_BASE_URL}; kept as a chat-context alias to the shared default. */
export const DEFAULT_LOCAL_CHAT_BASE_URL = DEFAULT_LOCAL_MODEL_BASE_URL;
export const DEFAULT_LOCAL_CHAT_PROVIDER_ID = "lmstudio";

/**
 * TTL cache so the chat model-resolver (invoked per chat agent operation) doesn't hammer the live `/models` catalog —
 * the same 30 s throttle + `NKLEIN_MODEL_DISCOVERY_CACHE_TTL_MS` knob as the roster path (`nklein-provider-service.ts`);
 * disabled under the test runner so per-test fetch mocks aren't shadowed.
 */
const loadedModelIdCache = new Map<string, { at: number; modelId: string | null }>();

/** Clear the loaded-model-id TTL cache (tests + explicit refresh). */
export function clearLoadedModelIdCache(): void {
	loadedModelIdCache.clear();
}

/** Discover a currently-loaded, non-embedding model id from the live local endpoint; null when none/unreachable. */
export async function discoverLoadedModelId(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
	const key = baseUrl.replace(/\/+$/u, "");
	const ttlMs = modelDiscoveryCacheTtlMs();
	const now = Date.now();
	if (ttlMs > 0) {
		const cached = loadedModelIdCache.get(key);
		if (cached && now - cached.at < ttlMs) {
			return cached.modelId;
		}
	}
	// Pick a LOADED, non-embedding model from LM Studio's `/api/v0/models` (load state) — NEVER an available-but-unloaded
	// one (selecting that would auto-LOAD it, which is the user's call, not ours — directive 2026-06-28).
	const loaded = await fetchLoadedModelIds(key, fetchImpl);
	const modelId = loaded.find((id) => !id.includes("embed")) ?? loaded[0] ?? null;
	if (ttlMs > 0) {
		loadedModelIdCache.set(key, { at: now, modelId });
	}
	return modelId;
}

/**
 * Residency-guard an EXPLICIT (pinned / `--model`) chat model. Auto-discovery is already loaded-only, but a pinned id
 * BYPASSES that — and inferring against a non-resident model makes LM Studio auto-LOAD it, which is the user's call, not
 * ours (directive 2026-06-28). Lenient, exactly like the runtime task-start guard (`shouldBlockUnloadedModel`): block
 * ONLY when we positively know the loaded set and it lacks the model, so an unreachable / non-LM-Studio endpoint (loaded
 * set unknown) never wedges chat. Throws a clear, actionable error naming the loaded set.
 */
/** The decision the §5.AL capability gate makes for a chat model: proceed quietly, warn, or refuse to start. */
export interface ChatModelGateDecision {
	action: "ok" | "warn" | "reject";
	/** A user-facing line to print (warn) or throw (reject); empty when `action === "ok"`. */
	message: string;
}

/**
 * Pure §5.AL chat-model capability gate. The tool-using chat agent needs a tool-capable model, so when tools are in
 * play a catalog-`reject` model (e.g. a reasoning-only variant) is REFUSED up front rather than left to thrash a whole
 * session — unless `allowOverride`. The plain-completion path (`toolUsing=false`) never rejects (a reasoning/chat model
 * is fine without tools); a `warn`/`unknown` verdict always just surfaces the caveat. Effect-free so it's unit-tested
 * directly; the CLI wires `assessModelSuitability` (default policy) + the `--workspace` flag + the override env.
 *
 * `policyBase` (§5.AL) is the project's effective runtime-config policy (global default ← per-project override) — when
 * supplied (the chat-API path has the active workspace), the env knobs layer ON TOP of it, so chat honors a per-project
 * policy the same way task-start does. Omitted (the CLI path, no project scope) ⇒ env + shipped default.
 */
export function decideChatModelGate(
	modelId: string,
	options: { toolUsing: boolean; allowOverride: boolean; policyBase?: { onUnsuitable: string; onUnknown: string } },
): ChatModelGateDecision {
	const suitability = assessModelSuitability(
		modelId,
		resolveActiveModelSuitabilityPolicy(process.env, options.policyBase),
	);
	if (suitability.severity === "ok") {
		return { action: "ok", message: "" };
	}
	if (suitability.severity === "reject" && options.toolUsing && !options.allowOverride) {
		return {
			action: "reject",
			message:
				`Model "${modelId}" is not suitable for the tool-using chat agent — ${suitability.reason}\n` +
				"Pick a tool-capable model, or set NKLEIN_ALLOW_UNSUITABLE_MODEL=1 to override.",
		};
	}
	return { action: "warn", message: `Model capability ${suitability.severity}: ${suitability.reason}` };
}

export async function assertPinnedChatModelLoaded(
	baseUrl: string,
	modelId: string,
	fetchImpl: typeof fetch = fetch,
): Promise<void> {
	const loaded = await fetchLoadedModelIds(baseUrl, fetchImpl);
	if (shouldBlockUnloadedModel(modelId, loaded)) {
		throw new Error(
			`Pinned chat model "${modelId}" is not loaded in LM Studio (loaded: ${loaded.join(", ") || "none"}). ` +
				"!Klein does not load models — load it in LM Studio first, or clear the pin/--model to use a loaded model.",
		);
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
	const fetchImpl = options.fetchImpl ?? fetch;
	const pinnedModelId = options.modelId?.trim();
	// A pinned chat model must ALSO be resident — discovery is loaded-only, but a pin bypasses it (directive 2026-06-28).
	if (pinnedModelId) {
		await assertPinnedChatModelLoaded(baseUrl, pinnedModelId, fetchImpl);
	}
	const modelId = pinnedModelId || (await discoverLoadedModelId(baseUrl, fetchImpl));
	if (!modelId) {
		throw new Error(`No loaded local model found at ${baseUrl}. Load a model (e.g. in LM Studio) and try again.`);
	}
	const client = new LocalLlmClient({ providerId, modelId, baseUrl });
	const deps = createChatModelDeps(client, { modelId });
	// F3.13 cross-model carry: rank loaded peers by UNAMBIGUOUS parameter count (parseModelAttributes.paramB) —
	// deterministic and dependency-light at the chat layer. No strictly-larger loaded peer, or any failure, is
	// null — the enforced-reasoning loop then keeps the draft (the pre-existing degrade path).
	deps.resolveStrongerPeer = async (draftModelId) => {
		try {
			const loaded = await fetchLoadedModelIds(baseUrl, fetchImpl);
			const draftParamB = parseModelAttributes(draftModelId).paramB ?? 0;
			const peer = loaded
				.filter((id) => id !== draftModelId && !/embed/i.test(id))
				.map((id) => ({ id, paramB: parseModelAttributes(id).paramB ?? 0 }))
				.filter((candidate) => candidate.paramB > draftParamB)
				.sort((left, right) => right.paramB - left.paramB)[0];
			if (!peer) {
				return null;
			}
			const peerDeps = createChatModelDeps(new LocalLlmClient({ providerId, modelId: peer.id, baseUrl }), {
				modelId: peer.id,
			});
			return {
				modelId: peer.id,
				complete: ({ system, user }) =>
					peerDeps.complete([
						...(system ? [{ role: "system" as const, content: system }] : []),
						{ role: "user" as const, content: user },
					]),
			};
		} catch {
			return null;
		}
	};
	return deps;
}
