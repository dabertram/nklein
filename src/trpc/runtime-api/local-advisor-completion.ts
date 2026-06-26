import type { ResolvedNKleinLaunchConfig } from "../../nklein-agent/nklein-provider-service";

/**
 * Local advisor chat-completion for `createRuntimeApi`, extracted from the oversized `runtime-api.ts` (todo §5.U).
 * Runs a single non-streaming completion against the user's *local* provider (Ollama's `/api/chat` or the OpenAI-
 * compatible `/chat/completions`, e.g. LM Studio) to power lightweight advisor prompts, with a 120s abort, base-URL
 * normalization, and tolerant response parsing. `runLocalAdvisorCompletion` is the single entry point; the rest are
 * private helpers. No SDK host — just `fetch`.
 */

interface AdvisorChatCompletionInput {
	launchConfig: ResolvedNKleinLaunchConfig;
	prompt: string;
}

function joinUrlPath(baseUrl: string, path: string): string {
	return `${baseUrl.replace(/\/+$/u, "")}/${path.replace(/^\/+/u, "")}`;
}

function resolveAdvisorOpenAiBaseUrl(launchConfig: ResolvedNKleinLaunchConfig): string {
	const configured = launchConfig.baseUrl?.trim();
	if (configured) {
		const trimmed = configured.replace(/\/+$/u, "");
		try {
			const url = new URL(trimmed);
			if (!url.pathname.endsWith("/v1")) {
				url.pathname = `${url.pathname.replace(/\/+$/u, "")}/v1`;
			}
			return url.toString().replace(/\/+$/u, "");
		} catch {
			return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
		}
	}
	if (launchConfig.providerId === "lmstudio" || launchConfig.providerId === "lm-studio") {
		return "http://localhost:1234/v1";
	}
	return "http://localhost:11434/v1";
}

function resolveAdvisorOllamaBaseUrl(launchConfig: ResolvedNKleinLaunchConfig): string {
	return launchConfig.baseUrl?.trim().replace(/\/+$/u, "") || "http://localhost:11434";
}

function readAdvisorTextResponse(value: unknown): string {
	if (!value || typeof value !== "object") {
		return "";
	}
	const record = value as Record<string, unknown>;
	const message = record.message;
	if (message && typeof message === "object") {
		const content = (message as Record<string, unknown>).content;
		if (typeof content === "string") {
			return content;
		}
	}
	const response = record.response;
	if (typeof response === "string") {
		return response;
	}
	const choices = record.choices;
	if (Array.isArray(choices)) {
		const firstChoice = choices[0];
		if (firstChoice && typeof firstChoice === "object") {
			const choiceRecord = firstChoice as Record<string, unknown>;
			const choiceMessage = choiceRecord.message;
			if (choiceMessage && typeof choiceMessage === "object") {
				const content = (choiceMessage as Record<string, unknown>).content;
				if (typeof content === "string") {
					return content;
				}
			}
			const text = choiceRecord.text;
			if (typeof text === "string") {
				return text;
			}
		}
	}
	return "";
}

async function fetchAdvisorJson(url: string, init: RequestInit): Promise<unknown> {
	const response = await fetch(url, init);
	const text = await response.text();
	if (!response.ok) {
		throw new Error(text.trim() || `Advisor model request failed with HTTP ${response.status}.`);
	}
	try {
		return JSON.parse(text) as unknown;
	} catch {
		throw new Error("Advisor model returned a non-JSON response.");
	}
}

export async function runLocalAdvisorCompletion(input: AdvisorChatCompletionInput): Promise<string> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 120_000);
	try {
		const providerId = input.launchConfig.providerId.trim().toLowerCase();
		if (providerId === "ollama") {
			const value = await fetchAdvisorJson(
				joinUrlPath(resolveAdvisorOllamaBaseUrl(input.launchConfig), "/api/chat"),
				{
					method: "POST",
					headers: {
						"content-type": "application/json",
						...(input.launchConfig.apiKey ? { authorization: `Bearer ${input.launchConfig.apiKey}` } : {}),
					},
					body: JSON.stringify({
						model: input.launchConfig.modelId,
						stream: false,
						messages: [{ role: "user", content: input.prompt }],
					}),
					signal: controller.signal,
				},
			);
			const output = readAdvisorTextResponse(value).trim();
			if (!output) {
				throw new Error("Advisor model returned an empty response.");
			}
			return output;
		}

		const value = await fetchAdvisorJson(
			joinUrlPath(resolveAdvisorOpenAiBaseUrl(input.launchConfig), "/chat/completions"),
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					...(input.launchConfig.apiKey ? { authorization: `Bearer ${input.launchConfig.apiKey}` } : {}),
				},
				body: JSON.stringify({
					model: input.launchConfig.modelId,
					messages: [{ role: "user", content: input.prompt }],
					temperature: 0.2,
					stream: false,
				}),
				signal: controller.signal,
			},
		);
		const output = readAdvisorTextResponse(value).trim();
		if (!output) {
			throw new Error("Advisor model returned an empty response.");
		}
		return output;
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			throw new Error("Advisor model request timed out after 120 seconds.");
		}
		throw error;
	} finally {
		clearTimeout(timeout);
	}
}
