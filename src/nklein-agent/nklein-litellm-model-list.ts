import { z } from "zod";
import type { RuntimeNKleinProviderModel } from "../core/api-contract";
import { resolveVisibleApiKey } from "./nklein-provider-credential-helpers";
import type { SdkProviderSettings } from "./sdk-provider-boundary";

/**
 * §5.U — the PURE LiteLLM `/models` protocol helpers extracted from `nklein-provider-service`: the response schema, the
 * candidate pathnames, and the small header/item-id/roster-merge functions the LiteLLM (and, for headers, LM Studio)
 * model-list fetchers lean on. No I/O — the fetchers stay in the service and import these back. Independently testable.
 */

/** The (permissive) shape of a LiteLLM `/models` or `/model/info` response — only the id fields we read are typed. */
export const LITELLM_MODELS_RESPONSE_SCHEMA = z.object({
	data: z.array(z.object({ id: z.string().optional(), model_name: z.string().optional() }).passthrough()).optional(),
});

/** The candidate model-list routes, tried in order — `/models` first, then LiteLLM's admin `/model/info`. */
export const LITELLM_MODEL_LIST_PATHNAMES = ["/models", "/model/info"] as const;

export type LiteLlmModelListPathname = (typeof LITELLM_MODEL_LIST_PATHNAMES)[number];
export type LiteLlmModelListItem = NonNullable<z.infer<typeof LITELLM_MODELS_RESPONSE_SCHEMA>["data"]>[number];

/** True when the header set already carries an `Authorization` header (case-insensitive) — so we don't clobber it. */
export function hasAuthorizationHeader(headers: Record<string, string>): boolean {
	return Object.keys(headers).some((key) => key.toLowerCase() === "authorization");
}

/** The request headers for a model-list call — the caller's headers, plus a `Bearer` auth header if a key is visible. */
export function resolveLiteLlmModelListHeaders(settings: SdkProviderSettings): Record<string, string> {
	const headers = { ...(settings.headers ?? {}) };
	const apiKey = resolveVisibleApiKey(settings);
	if (apiKey && !hasAuthorizationHeader(headers)) {
		headers.Authorization = `Bearer ${apiKey}`;
	}
	return headers;
}

/** The model id for a response item — `/model/info` reports it as `model_name` (falling back to `id`); trimmed. */
export function resolveLiteLlmModelListItemId(item: LiteLlmModelListItem, pathname: LiteLlmModelListPathname): string {
	const modelId = pathname === "/model/info" ? (item.model_name ?? item.id) : item.id;
	return modelId?.trim() ?? "";
}

/** Append any fallback models whose id isn't already present — used to backfill the merged roster without duplicates. */
export function appendMissingModels(
	models: RuntimeNKleinProviderModel[],
	fallbackModels: RuntimeNKleinProviderModel[],
): RuntimeNKleinProviderModel[] {
	const existingModelIds = new Set(models.map((model) => model.id));
	return [...models, ...fallbackModels.filter((model) => !existingModelIds.has(model.id))];
}
