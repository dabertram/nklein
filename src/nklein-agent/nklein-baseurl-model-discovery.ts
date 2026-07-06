import { z } from "zod";
import type { RuntimeNKleinProviderModel } from "../core/api-contract";
import { toErrorMessage as formatErrorMessage } from "../core/error-message";
import {
	LITELLM_MODEL_LIST_PATHNAMES,
	LITELLM_MODELS_RESPONSE_SCHEMA,
	resolveLiteLlmModelListHeaders,
	resolveLiteLlmModelListItemId,
} from "./nklein-litellm-model-list";
import { resolveModelListSettings } from "./nklein-model-list-settings";
import { normalizeLmStudioModelListBaseUrl } from "./nklein-provider-discovery-urls";
import { toLmStudioModels } from "./nklein-provider-model-parsing";
import { createKanbanNKleinLogger } from "./nklein-runtime-logger";
import { listSdkProviderCatalog, type SdkProviderSettings } from "./sdk-provider-boundary";

const LMSTUDIO_MODELS_RESPONSE_SCHEMA = z
	.object({
		data: z.array(z.unknown()).optional(),
		models: z.array(z.unknown()).optional(),
	})
	.passthrough();
const LMSTUDIO_MODEL_LIST_PATHNAMES = ["/api/v0/models", "/api/v1/models", "/v1/models"] as const;
const DEFAULT_LITELLM_MODEL_LIST_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_LMSTUDIO_MODEL_LIST_TIMEOUT_MS = 30 * 1000;
// Logs stay attributed to `nklein-provider-service` (this discovery code was lifted from there) so existing log-scraping
// and dashboards keep working unchanged.
const LOGGER = createKanbanNKleinLogger({ component: "nklein-provider-service" });

function toErrorMessage(error: unknown): string {
	return formatErrorMessage(error, "An unexpected error occurred.");
}

function logLiteLlmModelListWarning(message: string, metadata?: Record<string, unknown>): void {
	LOGGER.log(message, {
		severity: "warn",
		providerId: "litellm",
		...(metadata ?? {}),
	});
}

/**
 * §5.U: the base-URL model-discovery fetchers, lifted verbatim out of `nklein-provider-service.ts`. Each resolves the
 * provider's model-list settings, then probes the provider's `/models`-style endpoints (in order) over `globalThis.fetch`
 * and returns the first non-empty roster (or `[]` when the base URL is unset / every probe fails). Kept as two distinct
 * functions — their response schemas, id/model mapping, base-URL normalization, timeouts and warning logs diverge per
 * provider (a future consolidation is owed once these have direct coverage, which this module's test now provides).
 */
export async function fetchLiteLlmBaseUrlModels(
	settings: SdkProviderSettings | null,
): Promise<RuntimeNKleinProviderModel[]> {
	const resolvedSettings = await resolveModelListSettings("litellm", settings, listSdkProviderCatalog);
	const baseUrl = resolvedSettings?.baseUrl?.trim() ?? "";
	if (!resolvedSettings || !baseUrl) {
		return [];
	}

	const headers = resolveLiteLlmModelListHeaders(resolvedSettings);
	const timeoutMs =
		typeof resolvedSettings.timeout === "number" && resolvedSettings.timeout >= 0
			? Math.trunc(resolvedSettings.timeout)
			: DEFAULT_LITELLM_MODEL_LIST_TIMEOUT_MS;
	const signal = timeoutMs === 0 ? undefined : AbortSignal.timeout(timeoutMs);
	const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
	for (const pathname of LITELLM_MODEL_LIST_PATHNAMES) {
		const url = `${normalizedBaseUrl}${pathname}`;
		try {
			const response = await globalThis.fetch(url, {
				method: "GET",
				headers,
				...(signal ? { signal } : {}),
			});
			if (!response.ok) {
				logLiteLlmModelListWarning("LiteLLM model list request returned an unsuccessful response.", {
					url,
					status: response.status,
				});
				continue;
			}

			const parsed = LITELLM_MODELS_RESPONSE_SCHEMA.safeParse((await response.json()) as unknown);
			if (!parsed.success) {
				logLiteLlmModelListWarning("LiteLLM model list request returned an unexpected response.", { url });
				continue;
			}

			const modelIds =
				parsed.data.data
					?.map((item) => resolveLiteLlmModelListItemId(item, pathname))
					.filter((modelId) => modelId.length > 0) ?? [];
			if (modelIds.length > 0) {
				return [...new Set(modelIds)].map((id) => ({ id, name: id }));
			}
		} catch (error) {
			logLiteLlmModelListWarning("LiteLLM model list request failed.", {
				url,
				errorMessage: toErrorMessage(error),
			});
		}
	}
	return [];
}

export async function fetchLmStudioBaseUrlModels(
	settings: SdkProviderSettings | null,
): Promise<RuntimeNKleinProviderModel[]> {
	const resolvedSettings = await resolveModelListSettings("lmstudio", settings, listSdkProviderCatalog);
	const baseUrl = resolvedSettings?.baseUrl?.trim() ?? "";
	if (!resolvedSettings || !baseUrl) {
		return [];
	}

	const headers = resolveLiteLlmModelListHeaders(resolvedSettings);
	const timeoutMs =
		typeof resolvedSettings.timeout === "number" && resolvedSettings.timeout >= 0
			? Math.trunc(resolvedSettings.timeout)
			: DEFAULT_LMSTUDIO_MODEL_LIST_TIMEOUT_MS;
	const signal = timeoutMs === 0 ? undefined : AbortSignal.timeout(timeoutMs);
	const normalizedBaseUrl = normalizeLmStudioModelListBaseUrl(baseUrl);
	for (const pathname of LMSTUDIO_MODEL_LIST_PATHNAMES) {
		const url = `${normalizedBaseUrl}${pathname}`;
		try {
			const response = await globalThis.fetch(url, {
				method: "GET",
				headers,
				...(signal ? { signal } : {}),
			});
			if (!response.ok) {
				LOGGER.log("LM Studio model list request returned an unsuccessful response.", {
					severity: "warn",
					providerId: "lmstudio",
					url,
					status: response.status,
				});
				continue;
			}

			const parsed = LMSTUDIO_MODELS_RESPONSE_SCHEMA.safeParse((await response.json()) as unknown);
			if (!parsed.success) {
				LOGGER.log("LM Studio model list request returned an unexpected response.", {
					severity: "warn",
					providerId: "lmstudio",
					url,
				});
				continue;
			}

			const items = parsed.data.data ?? parsed.data.models ?? [];
			const models = items.flatMap((item) => toLmStudioModels(item, pathname));
			if (models.length > 0) {
				return models;
			}
		} catch (error) {
			LOGGER.log("LM Studio model list request failed.", {
				severity: "warn",
				providerId: "lmstudio",
				url,
				errorMessage: toErrorMessage(error),
			});
		}
	}
	return [];
}
