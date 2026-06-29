/**
 * Per-provider JSON-schema profiles for tool definitions and structured output.
 *
 * Different local LLM runtimes (lmstudio, llama.cpp, openai-compatible) accept different
 * subsets of JSON-schema features. This module defines conservative but reasonable capability
 * profiles per provider and provides a selector function.
 *
 * See todo.md §5.O: Per-provider schema profiles / JSON-repair fallback.
 */

export type SchemaProvider = "lmstudio" | "llamacpp" | "openai-compatible";

export interface ProviderSchemaProfile {
	provider: SchemaProvider;
	supportsNestedObjects: boolean;
	supportsEnum: boolean;
	supportsAdditionalProperties: boolean;
	maxDepth: number;
	needsJsonRepairFallback: boolean;
}

/**
 * Conservative defaults to be tuned empirically per deployment.
 */
export const PROVIDER_SCHEMA_PROFILES: Record<SchemaProvider, ProviderSchemaProfile> = {
	lmstudio: {
		provider: "lmstudio",
		supportsNestedObjects: true,
		supportsEnum: true,
		supportsAdditionalProperties: false,
		maxDepth: 4,
		needsJsonRepairFallback: true,
	},
	llamacpp: {
		provider: "llamacpp",
		supportsNestedObjects: true,
		supportsEnum: true,
		supportsAdditionalProperties: false,
		maxDepth: 3,
		needsJsonRepairFallback: true,
	},
	"openai-compatible": {
		provider: "openai-compatible",
		supportsNestedObjects: true,
		supportsEnum: true,
		supportsAdditionalProperties: true,
		maxDepth: 5,
		needsJsonRepairFallback: false,
	},
};

export function selectProviderSchemaProfile(provider: SchemaProvider): ProviderSchemaProfile {
	return PROVIDER_SCHEMA_PROFILES[provider];
}
