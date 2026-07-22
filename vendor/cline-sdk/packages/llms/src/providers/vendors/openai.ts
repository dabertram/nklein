import { createOpenAI } from "@ai-sdk/openai";
import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@cline/shared";
import { resolveApiKey } from "../http";
import type { ProviderFactoryResult } from "./types";

export async function createOpenAIProviderModule(
	config: GatewayResolvedProviderConfig,
	context: GatewayProviderContext,
): Promise<ProviderFactoryResult> {
	const resolvedApiKey = await resolveApiKey(config);
	const apiKey =
		resolvedApiKey ??
		(config.options?.useOpenAIResponses === true && config.baseUrl?.trim()
			? "nklein-local-responses"
			: undefined);
	const provider = createOpenAI({
		apiKey,
		baseURL: config.baseUrl,
		headers: config.headers,
		fetch: config.fetch,
		name: context.provider.id,
	});
	return {
		model: (modelId) => provider.responses(modelId),
	};
}
