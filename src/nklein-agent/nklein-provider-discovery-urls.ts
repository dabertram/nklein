/**
 * Pure URL helpers for local-model discovery, extracted from nklein-provider-service.
 *
 * Local OpenAI-compatible hosts (LM Studio, LiteLLM, llama.cpp, …) expose their model list at
 * inconsistent paths relative to the chat base URL — `/models`, `/v1/models`, `/api/v0/models`,
 * `/api/v1/models` — and users paste base URLs with assorted trailing slashes, an `/embeddings`
 * suffix, query/hash junk, or a `/v1` already on the end. These functions normalize that mess into
 * the candidate model-list URLs the discovery fetch should try. Pure (URL + string only), so the
 * fiddly path edge-cases are unit-tested in isolation.
 */

/** Strips trailing slashes, an `/embeddings` suffix, and query/hash from a discovery base URL. */
export function normalizeDiscoveryBaseUrl(baseUrl: string): string {
	const trimmedBaseUrl = baseUrl.trim().replace(/\/+$/u, "");
	try {
		const parsedUrl = new URL(trimmedBaseUrl);
		if (parsedUrl.pathname.endsWith("/embeddings")) {
			parsedUrl.pathname = parsedUrl.pathname.slice(0, -"/embeddings".length) || "/";
		}
		parsedUrl.search = "";
		parsedUrl.hash = "";
		return parsedUrl.toString().replace(/\/+$/u, "");
	} catch {
		return trimmedBaseUrl.replace(/\/embeddings$/iu, "");
	}
}

/**
 * The ordered, de-duplicated set of model-list URLs to probe for a base URL: an explicit
 * `modelsSourceUrl` first (if given), the normalized base URL if it already points at a models
 * endpoint, otherwise the base URL joined with each known model-list path (`/models`,
 * `/api/v1/models`, `/api/v0/models`, with any `/v1` suffix trimmed first).
 */
export function buildDiscoveredModelSourceUrls(input: { baseUrl: string; modelsSourceUrl?: string | null }): string[] {
	const candidates = new Set<string>();
	const addCandidate = (value: string | null | undefined) => {
		const trimmed = value?.trim();
		if (trimmed) {
			candidates.add(trimmed.replace(/\/+$/u, ""));
		}
	};
	addCandidate(input.modelsSourceUrl);
	const normalizedBaseUrl = normalizeDiscoveryBaseUrl(input.baseUrl);
	addCandidate(normalizedBaseUrl);
	try {
		const parsedUrl = new URL(normalizedBaseUrl);
		const pathname = parsedUrl.pathname.replace(/\/+$/u, "");
		if (pathname.endsWith("/models") || pathname.endsWith("/api/v0/models") || pathname.endsWith("/api/v1/models")) {
			addCandidate(parsedUrl.toString());
		} else {
			const joinPath = (nextPathname: string) => {
				const nextUrl = new URL(parsedUrl.toString());
				nextUrl.pathname = nextPathname;
				nextUrl.search = "";
				nextUrl.hash = "";
				addCandidate(nextUrl.toString());
			};
			joinPath(`${pathname || ""}/models`);
			const trimmedV1Path = pathname.endsWith("/v1") ? pathname.slice(0, -"/v1".length) : pathname;
			joinPath(`${trimmedV1Path || ""}/api/v1/models`);
			joinPath(`${trimmedV1Path || ""}/api/v0/models`);
		}
	} catch {
		addCandidate(`${normalizedBaseUrl}/models`);
		const trimmedV1BaseUrl = normalizedBaseUrl.replace(/\/v1$/iu, "");
		addCandidate(`${trimmedV1BaseUrl}/api/v1/models`);
		addCandidate(`${trimmedV1BaseUrl}/api/v0/models`);
	}
	return [...candidates];
}

/** Strips a trailing `/v1` (plus slashes/query/hash) — LM Studio's REST model list lives at the host root, not `/v1`. */
export function normalizeLmStudioModelListBaseUrl(baseUrl: string): string {
	const trimmedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
	try {
		const parsedUrl = new URL(trimmedBaseUrl);
		if (parsedUrl.pathname.endsWith("/v1")) {
			parsedUrl.pathname = parsedUrl.pathname.slice(0, -"/v1".length) || "/";
		}
		parsedUrl.search = "";
		parsedUrl.hash = "";
		return parsedUrl.toString().replace(/\/+$/, "");
	} catch {
		return trimmedBaseUrl.replace(/\/v1$/i, "");
	}
}
