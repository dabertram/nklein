/**
 * OpenAI-compat base-URL normalization — shared by every seam that hands a local provider base URL to an
 * OpenAI-compatible client (the session SDK's providerConfig and the local LLM client).
 *
 * Live-found 2026-07-18: a provider baseUrl saved WITHOUT the `/v1` path (e.g. `http://127.0.0.1:1234`) made the
 * session SDK POST to `/chat/completions` at the server ROOT — and LM Studio answers unknown routes with an
 * instant HTTP 200 and an EMPTY body, so every session "completed" with `Model returned empty response` in
 * ~1-2ms: workers errored, reviewers never verdicted, and nothing pointed at the URL. The local LLM client
 * already normalized (`nklein-local-llm-client`); the session path passed the raw string through. One shared
 * normalizer closes the class.
 */

/** Local OpenAI-compat provider families whose base URL must end in a `/vN` API root. */
export const OPENAI_COMPAT_LOCAL_PROVIDER_IDS: ReadonlySet<string> = new Set([
	"lmstudio",
	"llamacpp",
	"openai-compatible",
]);

/**
 * Normalize an OpenAI-compat base URL: trim, drop trailing slashes, and append `/v1` unless the path already ends
 * in a versioned API root (`/v1`, `/v2`, …). Idempotent; an empty/whitespace input returns itself trimmed so the
 * caller's own absent-handling stays in charge.
 */
export function normalizeOpenAiCompatBaseUrl(baseUrl: string): string {
	const trimmed = baseUrl.trim().replace(/\/+$/u, "");
	if (trimmed.length === 0) {
		return trimmed;
	}
	return /\/v\d+$/u.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

/** Normalize only when the provider is a local OpenAI-compat family; other providers pass through untouched. */
export function normalizeProviderBaseUrl(providerId: string, baseUrl: string): string {
	return OPENAI_COMPAT_LOCAL_PROVIDER_IDS.has(providerId) ? normalizeOpenAiCompatBaseUrl(baseUrl) : baseUrl.trim();
}
