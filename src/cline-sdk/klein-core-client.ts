import { type KleinCorePyConfig, resolveKleinCorePyConfig } from "../config/klein-core-config";
import type { LocalLlmChatMessage, LocalLlmSamplingOptions } from "./cline-local-llm-client";

/**
 * TS client for the !Klein Python core sidecar (`core-py`).
 *
 * The sidecar owns the capabilities the Cline SDK can't provide — most importantly grammar / JSON-schema
 * **constrained decoding** for small/quantized models. `KleinCoreClient.generateStructured` is shape-compatible
 * with `LocalLlmClient.generateStructured`, so it is a drop-in for the agent-core decider and decomposition.
 * When the sidecar is disabled or unreachable, it transparently delegates to an injected `fallback` (the
 * existing `LocalLlmClient`), so enabling the flag is always safe.
 */

export interface KleinCoreModelTarget {
	modelId: string;
	/** Proxy backend: the local OpenAI-compatible server. */
	baseUrl?: string | null;
	apiKey?: string | null;
	/** llama.cpp backend: load this GGUF directly (full grammar/sampling control). */
	ggufPath?: string | null;
}

export interface StructuredGenerator {
	generateStructured<T>(input: {
		messages: LocalLlmChatMessage[];
		jsonSchema: { name: string; schema: Record<string, unknown>; strict?: boolean };
		grammar?: string;
		parse: (value: unknown) => T;
		sampling?: LocalLlmSamplingOptions;
		signal?: AbortSignal;
	}): Promise<T>;
}

export interface KleinCoreClientConfig {
	/** Sidecar base URL, e.g. http://127.0.0.1:3585 */
	sidecarUrl: string;
	target: KleinCoreModelTarget;
	role?: string;
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
	/** Used when the sidecar is unreachable / errors (typically a LocalLlmClient). */
	fallback?: StructuredGenerator;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const CONTRACT_VERSION = 1;

function samplingToContract(sampling: LocalLlmSamplingOptions | undefined): Record<string, unknown> | undefined {
	if (!sampling) {
		return undefined;
	}
	const payload: Record<string, unknown> = {};
	if (sampling.temperature !== undefined) payload.temperature = sampling.temperature;
	if (sampling.topP !== undefined) payload.top_p = sampling.topP;
	if (sampling.topK !== undefined) payload.top_k = sampling.topK;
	if (sampling.minP !== undefined) payload.min_p = sampling.minP;
	if (sampling.repetitionPenalty !== undefined) payload.repetition_penalty = sampling.repetitionPenalty;
	if (sampling.maxTokens !== undefined) payload.max_tokens = sampling.maxTokens;
	if (sampling.stop) payload.stop = sampling.stop;
	return payload;
}

export class KleinCoreClient implements StructuredGenerator {
	private readonly config: KleinCoreClientConfig;
	private readonly fetchImpl: typeof fetch;

	constructor(config: KleinCoreClientConfig) {
		this.config = config;
		this.fetchImpl = config.fetchImpl ?? fetch;
	}

	async generateStructured<T>(input: {
		messages: LocalLlmChatMessage[];
		jsonSchema: { name: string; schema: Record<string, unknown>; strict?: boolean };
		grammar?: string;
		parse: (value: unknown) => T;
		sampling?: LocalLlmSamplingOptions;
		signal?: AbortSignal;
	}): Promise<T> {
		try {
			const value = await this.requestStructured(input);
			return input.parse(value);
		} catch (error) {
			if (this.config.fallback) {
				return this.config.fallback.generateStructured(input);
			}
			throw error;
		}
	}

	private async requestStructured(input: {
		messages: LocalLlmChatMessage[];
		jsonSchema: { name: string; schema: Record<string, unknown>; strict?: boolean };
		grammar?: string;
		sampling?: LocalLlmSamplingOptions;
		signal?: AbortSignal;
	}): Promise<unknown> {
		const url = `${this.config.sidecarUrl.replace(/\/+$/u, "")}/v1/generate_structured`;
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
		const body = {
			contract_version: CONTRACT_VERSION,
			target: {
				model_id: this.config.target.modelId,
				base_url: this.config.target.baseUrl ?? null,
				api_key: this.config.target.apiKey ?? null,
				gguf_path: this.config.target.ggufPath ?? null,
			},
			messages: input.messages,
			sampling: samplingToContract(input.sampling),
			role: this.config.role ?? "structured",
			grammar: input.grammar ?? null,
			json_schema: {
				name: input.jsonSchema.name,
				schema: input.jsonSchema.schema,
				strict: input.jsonSchema.strict ?? true,
			},
		};
		try {
			const response = await this.fetchImpl(url, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
				signal: input.signal ?? controller.signal,
			});
			if (!response.ok) {
				const text = await response.text().catch(() => "");
				throw new Error(`klein-core /v1/generate_structured failed (${response.status}): ${text.slice(0, 300)}`);
			}
			const json = (await response.json()) as { value?: unknown };
			return json.value;
		} finally {
			clearTimeout(timeout);
		}
	}
}

/**
 * Routing seam: returns a `KleinCoreClient` (sidecar, with `fallback` as backup) when the Python core is
 * enabled, otherwise returns the `fallback` unchanged. This is how structured-generation callers (the
 * agent-core decider, decomposition) opt into the sidecar without any other change.
 */
export function createStructuredGenerator(input: {
	fallback: StructuredGenerator;
	target: KleinCoreModelTarget;
	role?: string;
	config?: KleinCorePyConfig;
	fetchImpl?: typeof fetch;
}): StructuredGenerator {
	const config = input.config ?? resolveKleinCorePyConfig();
	if (!config.enabled) {
		return input.fallback;
	}
	return new KleinCoreClient({
		sidecarUrl: config.sidecarUrl,
		target: input.target,
		...(input.role ? { role: input.role } : {}),
		...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
		fallback: input.fallback,
	});
}
