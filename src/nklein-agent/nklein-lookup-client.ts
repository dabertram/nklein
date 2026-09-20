/**
 * The `lookup` HTTP client — the ONLY code that performs a fact-check request, and it performs it THROUGH the sandbox
 * egress proxy: every request carries the task's own proxy credential (`http://<task>:<token>@127.0.0.1:<port>`),
 * so the proxy's allowlist, per-task grants, DNS vetting and audit apply exactly as they do to a sandbox request.
 * There is deliberately NO direct-fetch fallback: no proxy route ⇒ no lookup.
 *
 * Safety floor beneath the proxy (belt and braces, same as `browse_url`): the SSRF guard refuses private/loopback/
 * link-local targets BEFORE the request, the response body is capped, redirects are followed by the proxy path with
 * the final URL re-checked, and the returned bytes are untrusted content the tool prescreens.
 */

import { ProxyAgent, fetch as undiciFetch } from "undici";
import { checkHostForSsrf } from "../chat/chat-browser-tool";

export const DEFAULT_LOOKUP_MAX_BODY_BYTES = 2 * 1024 * 1024;
export const DEFAULT_LOOKUP_TIMEOUT_MS = 20_000;
const LOOKUP_USER_AGENT = "nklein-lookup/1 (+local fact-check; no tracking)";

export interface LookupHttpResponse {
	status: number;
	finalUrl: string;
	contentType: string | null;
	body: Uint8Array;
	truncated: boolean;
}

export type LookupHttpFetch = (url: string, options: { signal: AbortSignal }) => Promise<LookupHttpResponse>;

export interface LookupClientOptions {
	/** The credentialed proxy URL for THIS task (from the sandbox manager); required — no proxy, no client. */
	proxyUrl: string;
	/** Register a host grant for a result-page fetch before the request; false ⇒ the fetch is refused. */
	grantHost: (host: string) => Promise<boolean>;
	maxBodyBytes?: number;
	timeoutMs?: number;
	/** Test seam: replaces the undici fetch-through-proxy. */
	fetchImpl?: LookupHttpFetch;
	/** Test seam: replaces the DNS-resolving SSRF guard (production always uses `checkHostForSsrf`). */
	checkHost?: (url: string) => Promise<string | null>;
}

export type LookupFailureCode = "invalid_url" | "blocked_ssrf" | "grant_refused" | "fetch_error" | "http_error";

export interface LookupClient {
	/** GET one URL through the proxy; `grant` says whether a per-task host grant is needed first (result pages). */
	get(
		url: string,
		options: { grant: boolean },
	): Promise<{ ok: true; response: LookupHttpResponse } | { ok: false; code: LookupFailureCode; detail: string }>;
}

function validateHttpUrl(raw: string): URL | null {
	try {
		const parsed = new URL(raw);
		return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
	} catch {
		return null;
	}
}

async function readCapped(response: Response, maxBytes: number): Promise<{ body: Uint8Array; truncated: boolean }> {
	const reader = response.body?.getReader();
	if (!reader) {
		return { body: new Uint8Array(0), truncated: false };
	}
	const chunks: Uint8Array[] = [];
	let total = 0;
	let truncated = false;
	while (true) {
		const { done, value } = await reader.read();
		if (done || !value) {
			break;
		}
		if (total + value.byteLength > maxBytes) {
			chunks.push(value.subarray(0, Math.max(0, maxBytes - total)));
			total = maxBytes;
			truncated = true;
			await reader.cancel().catch(() => undefined);
			break;
		}
		chunks.push(value);
		total += value.byteLength;
	}
	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return { body, truncated };
}

function buildProxiedFetch(proxyUrl: string, maxBodyBytes: number): LookupHttpFetch {
	const dispatcher = new ProxyAgent(proxyUrl);
	return async (url, options) => {
		const response = await undiciFetch(url, {
			dispatcher,
			signal: options.signal,
			redirect: "follow",
			headers: {
				"user-agent": LOOKUP_USER_AGENT,
				accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
			},
		});
		const { body, truncated } = await readCapped(response as unknown as Response, maxBodyBytes);
		return {
			status: response.status,
			finalUrl: response.url || url,
			contentType: response.headers.get("content-type"),
			body,
			truncated,
		};
	};
}

export function createLookupClient(options: LookupClientOptions): LookupClient {
	const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_LOOKUP_MAX_BODY_BYTES;
	const timeoutMs = options.timeoutMs ?? DEFAULT_LOOKUP_TIMEOUT_MS;
	const fetchImpl = options.fetchImpl ?? buildProxiedFetch(options.proxyUrl, maxBodyBytes);
	const checkHost = options.checkHost ?? checkHostForSsrf;
	return {
		async get(url, getOptions) {
			const parsed = validateHttpUrl(url);
			if (!parsed) {
				return { ok: false, code: "invalid_url", detail: "only http:// and https:// URLs can be looked up" };
			}
			const ssrf = await checkHost(parsed.toString());
			if (ssrf !== null) {
				return { ok: false, code: "blocked_ssrf", detail: ssrf };
			}
			if (getOptions.grant) {
				const granted = await options.grantHost(parsed.hostname).catch(() => false);
				if (!granted) {
					return { ok: false, code: "grant_refused", detail: `the egress proxy did not grant ${parsed.hostname}` };
				}
			}
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeoutMs);
			try {
				const response = await fetchImpl(parsed.toString(), { signal: controller.signal });
				if (response.finalUrl && response.finalUrl !== parsed.toString()) {
					const redirectSsrf = await checkHost(response.finalUrl);
					if (redirectSsrf !== null) {
						return { ok: false, code: "blocked_ssrf", detail: redirectSsrf };
					}
				}
				if (response.status >= 400) {
					return { ok: false, code: "http_error", detail: `HTTP ${response.status}` };
				}
				return { ok: true, response };
			} catch (error) {
				return { ok: false, code: "fetch_error", detail: error instanceof Error ? error.message : String(error) };
			} finally {
				clearTimeout(timer);
			}
		},
	};
}
