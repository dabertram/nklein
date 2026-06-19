import type { RuntimeClineProviderCatalogItem } from "@/runtime/types";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

function normalizeProviderId(value: string | null | undefined): string {
	return value?.trim().toLowerCase() ?? "";
}

function normalizeHostname(hostname: string): string {
	return hostname
		.trim()
		.toLowerCase()
		.replace(/^\[(.*)\]$/u, "$1");
}

function isPrivateIpv4(hostname: string): boolean {
	const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u);
	if (!match) {
		return false;
	}
	const octets = match.slice(1).map((part) => Number(part));
	if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
		return false;
	}
	const [first, second] = octets;
	if (first === undefined || second === undefined) {
		return false;
	}
	return (
		first === 10 ||
		(first === 100 && second >= 64 && second <= 127) ||
		(first === 169 && second === 254) ||
		(first === 172 && second >= 16 && second <= 31) ||
		(first === 192 && second === 168)
	);
}

export function isLocalEmbeddingEndpointUrl(value: string | null | undefined): boolean {
	const baseUrl = value?.trim();
	if (!baseUrl) {
		return false;
	}
	try {
		const hostname = normalizeHostname(new URL(baseUrl).hostname);
		return LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith(".local") || isPrivateIpv4(hostname);
	} catch {
		return false;
	}
}

export function deriveEmbeddingsEndpointUrl(baseUrl: string | null | undefined): string | null {
	const trimmedBaseUrl = baseUrl?.trim();
	if (!trimmedBaseUrl) {
		return null;
	}
	try {
		const parsedUrl = new URL(trimmedBaseUrl);
		const pathname = parsedUrl.pathname.replace(/\/+$/u, "");
		parsedUrl.pathname = pathname.endsWith("/embeddings") ? pathname : `${pathname || ""}/embeddings`;
		parsedUrl.search = "";
		parsedUrl.hash = "";
		return parsedUrl.toString().replace(/\/$/u, "");
	} catch {
		const normalized = trimmedBaseUrl.replace(/\/+$/u, "");
		if (!normalized) {
			return null;
		}
		return normalized.match(/\/embeddings$/iu) ? normalized : `${normalized}/embeddings`;
	}
}

export function buildSuggestedCodeEmbeddingBaseUrl(input: {
	providerId: string | null | undefined;
	baseUrl: string | null | undefined;
	providerCatalog: RuntimeClineProviderCatalogItem[];
}): string | null {
	const providerId = normalizeProviderId(input.providerId);
	if (providerId !== "lmstudio" && providerId !== "lm-studio") {
		return null;
	}
	const catalogProvider =
		input.providerCatalog.find((provider) => normalizeProviderId(provider.id) === providerId) ?? null;
	const chatBaseUrl = input.baseUrl?.trim() || catalogProvider?.baseUrl?.trim() || null;
	if (!chatBaseUrl || !isLocalEmbeddingEndpointUrl(chatBaseUrl)) {
		return null;
	}
	return deriveEmbeddingsEndpointUrl(chatBaseUrl);
}
