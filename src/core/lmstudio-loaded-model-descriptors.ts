/**
 * Rich descriptors for the currently-LOADED LM Studio models, read from the NATIVE `/api/v1/models` endpoint when
 * available, with a minimal `/api/v0/models` fallback for LM Studio builds that do not expose the rich endpoint. Crucially this
 * separates the two identifiers LM Studio carries:
 *
 *   - `loaded_instances[].id` — the **runtime id you INVOKE**, i.e. the user's per-instance ALIAS (e.g.
 *     `qwen3.5-9b-mtp-q4-k-xl-laptop`, a name the user gave the instance to mark which machine it's on);
 *   - `key` — the **real publisher model key** (e.g. `qwen3.5-9b-mtp`), the right string to match against the §5.AL
 *     catalog / llmfit DB. (User, 2026-07-01: "get the real model names from the API, then use those.")
 *
 * It also surfaces the per-model card facts the runtime can use as EMPIRICAL capability ground truth (the §5.AB vision —
 * "based on empirical information it collects by itself on runtime"): `type` (`llm` vs `embedding` — an authoritative
 * embedding filter, not a name guess), `capabilities.trained_for_tool_use`, a declared `reasoning` capability, and the
 * `architecture` family. Read-only GET — never triggers a load (the no-load directive, see `lmstudio-loaded-models.ts`).
 *
 * Pure parser + injectable fetch, so it is unit-testable without a live endpoint.
 */

import type { LmsPsModel } from "./lms-ps-json";
import { lmStudioApiV0ModelsUrl } from "./lmstudio-loaded-models";

export interface LoadedModelDescriptor {
	/** The runtime identifier to INVOKE — LM Studio's per-instance alias (`loaded_instances[].id`). Candidate identity. */
	runtimeId: string;
	/** The real publisher model key (`key`) for capability/catalog/llmfit lookups; falls back to `runtimeId` if absent. */
	modelKey: string;
	/** `true` for an embedding model (`type === "embedding"`) — authoritative, replaces name-pattern guessing. */
	isEmbedding: boolean;
	/** LM Studio's `capabilities.trained_for_tool_use`, when reported (undefined ⇒ the card didn't say). */
	toolUse?: boolean;
	/** F2.7b: LM Studio's `capabilities.vision`, when reported — the chat image gate's catalog-side signal. */
	vision?: boolean;
	/** `true` when the card declares a `reasoning` capability (a reasoner); undefined when not declared. */
	reasoning?: boolean;
	/** The architecture family string (e.g. `qwen3_5`, `phi3`, `mistral3`) — a coarse lineage hint. */
	architecture?: string;
	/** The model's advertised max context length, when present. */
	maxContextLength?: number;
}

interface RawV1Capabilities {
	trained_for_tool_use?: unknown;
	reasoning?: unknown;
	vision?: unknown;
}
interface RawV1Instance {
	id?: unknown;
}
interface RawV1Model {
	id?: unknown;
	state?: unknown;
	type?: unknown;
	key?: unknown;
	architecture?: unknown;
	max_context_length?: unknown;
	capabilities?: unknown;
	loaded_instances?: unknown;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Parse an `/api/v1/models` payload into one {@link LoadedModelDescriptor} per LOADED instance (a model with a
 * non-empty `loaded_instances`). Tolerant of shape: a missing `key` falls back to the runtime id; an unknown `type`
 * is treated as a non-embedding LLM. Models with no loaded instances (residency-only entries) are skipped.
 */
export function parseLoadedModelDescriptors(payload: unknown): LoadedModelDescriptor[] {
	// The NATIVE `/api/v1/models` wraps the list in `models`; the enhanced `/api/v0/models` uses `data`. Accept either
	// (and a bare array) so the parser tracks reality, not one assumed envelope.
	const container = payload && typeof payload === "object" ? (payload as { models?: unknown; data?: unknown }) : null;
	const data = Array.isArray(payload)
		? payload
		: Array.isArray(container?.models)
			? container.models
			: Array.isArray(container?.data)
				? container.data
				: [];
	const descriptors: LoadedModelDescriptor[] = [];
	for (const entry of data) {
		if (!entry || typeof entry !== "object") {
			continue;
		}
		const model = entry as RawV1Model;
		const instances = Array.isArray(model.loaded_instances) ? model.loaded_instances : [];
		if (instances.length === 0) {
			const runtimeId = asString(model.id);
			if (model.state === "loaded" && runtimeId) {
				const caps = (model.capabilities ?? undefined) as RawV1Capabilities | undefined;
				const toolUse = typeof caps?.trained_for_tool_use === "boolean" ? caps.trained_for_tool_use : undefined;
				const vision = typeof caps?.vision === "boolean" ? caps.vision : undefined;
				const reasoning = caps && caps.reasoning != null ? true : undefined;
				const architecture = asString(model.architecture);
				const maxContextLength =
					typeof model.max_context_length === "number" && Number.isFinite(model.max_context_length)
						? model.max_context_length
						: undefined;
				descriptors.push({
					runtimeId,
					modelKey: asString(model.key) ?? runtimeId,
					isEmbedding: model.type === "embedding",
					...(toolUse !== undefined ? { toolUse } : {}),
					...(vision !== undefined ? { vision } : {}),
					...(reasoning !== undefined ? { reasoning } : {}),
					...(architecture !== undefined ? { architecture } : {}),
					...(maxContextLength !== undefined ? { maxContextLength } : {}),
				});
			}
			continue; // not loaded — skip (residency-only entry)
		}
		const modelKey = asString(model.key);
		const isEmbedding = model.type === "embedding";
		const caps = (model.capabilities ?? undefined) as RawV1Capabilities | undefined;
		const toolUse = typeof caps?.trained_for_tool_use === "boolean" ? caps.trained_for_tool_use : undefined;
		const vision = typeof caps?.vision === "boolean" ? caps.vision : undefined;
		const reasoning = caps && caps.reasoning != null ? true : undefined;
		const architecture = asString(model.architecture);
		const maxContextLength =
			typeof model.max_context_length === "number" && Number.isFinite(model.max_context_length)
				? model.max_context_length
				: undefined;
		for (const rawInstance of instances) {
			const runtimeId = asString((rawInstance as RawV1Instance)?.id);
			if (!runtimeId) {
				continue;
			}
			descriptors.push({
				runtimeId,
				modelKey: modelKey ?? runtimeId,
				isEmbedding,
				...(toolUse !== undefined ? { toolUse } : {}),
				...(vision !== undefined ? { vision } : {}),
				...(reasoning !== undefined ? { reasoning } : {}),
				...(architecture !== undefined ? { architecture } : {}),
				...(maxContextLength !== undefined ? { maxContextLength } : {}),
			});
		}
	}
	return descriptors;
}

export function loadedModelDescriptorFromLmsPsModel(model: LmsPsModel): LoadedModelDescriptor {
	return {
		runtimeId: model.identifier,
		modelKey: model.modelKey || model.identifier,
		isEmbedding: model.isEmbedding,
		...(model.trainedForToolUse !== null ? { toolUse: model.trainedForToolUse } : {}),
		...(model.contextLength !== null ? { maxContextLength: model.contextLength } : {}),
	};
}

export function mergeLoadedModelDescriptors(
	descriptors: readonly LoadedModelDescriptor[],
	lmsPsModels: readonly LmsPsModel[],
): LoadedModelDescriptor[] {
	const byRuntimeId = new Map<string, LoadedModelDescriptor>();
	for (const descriptor of descriptors) {
		byRuntimeId.set(descriptor.runtimeId, descriptor);
	}
	for (const model of lmsPsModels) {
		const runtimeId = model.identifier.trim();
		if (!runtimeId || byRuntimeId.has(runtimeId)) {
			continue;
		}
		byRuntimeId.set(runtimeId, loadedModelDescriptorFromLmsPsModel(model));
	}
	return [...byRuntimeId.values()];
}

/** Map an OpenAI-style base URL (`http://host:port/v1`) to LM Studio's native `/api/v1/models` URL. */
export function lmStudioApiV1ModelsUrl(baseUrl: string): string {
	const root = baseUrl.trim().replace(/\/+$/u, "").replace(/\/v1$/u, "");
	return `${root}/api/v1/models`;
}

/**
 * Fetch {@link LoadedModelDescriptor}s for the currently-loaded models. Returns `[]` on any failure (the caller falls
 * back to id-only candidates). Bounded so it can never hang a hot path on an unreachable endpoint; read-only GET.
 */
export async function fetchLoadedModelDescriptors(
	baseUrl: string,
	fetchImpl: typeof fetch = fetch,
): Promise<LoadedModelDescriptor[]> {
	try {
		const res = await fetchImpl(lmStudioApiV1ModelsUrl(baseUrl), {
			signal: AbortSignal.timeout(3_000),
		});
		if (res.ok) {
			const descriptors = parseLoadedModelDescriptors(await res.json());
			if (descriptors.length > 0) {
				return descriptors;
			}
		}
		const fallback = await fetchImpl(lmStudioApiV0ModelsUrl(baseUrl), {
			signal: AbortSignal.timeout(3_000),
		});
		if (!fallback.ok) {
			return [];
		}
		return parseLoadedModelDescriptors(await fallback.json());
	} catch {
		return [];
	}
}

/**
 * Pick the best loaded model for the restart-durability REVIEW fallback (live 2026-07-18: `find(first
 * non-embedding)` handed the deciding review seat to a 7GB vision model while three stronger text reviewers sat
 * loaded — every round ended no-submission → false park). Preference order, stable within ties so the caller's
 * order still breaks them: non-vision over vision (a vision model in a text-review seat is a mis-route), then
 * tool-trained over not (`submit_review` IS a tool call — `trained_for_tool_use` is the closest catalog signal
 * for "will actually emit the verdict call"). Embeddings are excluded outright. Pure; null when nothing remains.
 */
export function pickReviewFallbackDescriptor(loaded: readonly LoadedModelDescriptor[]): LoadedModelDescriptor | null {
	const candidates = loaded.filter((descriptor) => !descriptor.isEmbedding);
	if (candidates.length === 0) {
		return null;
	}
	const score = (descriptor: LoadedModelDescriptor): number =>
		(descriptor.vision === true ? 0 : 2) + (descriptor.toolUse === true ? 1 : 0);
	return candidates.reduce((best, next) => (score(next) > score(best) ? next : best));
}
