import type { LookupAddress } from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { chromium } from "playwright";
import { labelsForSourceContent } from "../core/taint-content-scan";
import type { LocalLlmToolDefinition } from "../nklein-agent/nklein-local-llm-client";
import type { ChatToolSet } from "./chat-board-tools";
import type { ChatTool } from "./chat-tool-executor";

/**
 * The `browse_url` tool for the chat agent (todo §5.M G6 — headless-browser capability). Navigates a URL with a
 * headless Playwright browser, extracts the rendered page's title and main text, and returns a compact, token-capped
 * summary the agent can reason about. This is an `egress_read` action under the §5.L invariant: reaching the
 * internet is external egress, so the execution-mode gate **denies** it in the default `isolated_readonly` mode and
 * requires a **logged, explicit confirmation** in the host-capable modes — it is never run silently.
 *
 * The browser implementation is injected via `BrowserDeps` so the tool is unit-testable without launching a real
 * browser. The default `BrowserDeps` drives `playwright/chromium` in headless mode.
 *
 * §5.Y #5 — SSRF protection: in remote (`--host`) mode, navigation to internal/private/loopback/link-local addresses
 * is blocked. The hostname is resolved via DNS before the request, and the final URL's host is re-checked after any
 * redirects. Literal IP addresses are checked directly without DNS. Local mode leaves internal addresses allowed so
 * legitimate "agent verifies the local dev server it just started" use cases continue to work.
 */

export interface BrowserFetchResult {
	/** Final URL after any redirects. */
	url: string;
	/** `document.title` of the rendered page. */
	title: string;
	/** `document.body.innerText` of the rendered page. */
	text: string;
}

export interface BrowserDeps {
	fetchPage: (url: string) => Promise<BrowserFetchResult>;
}

export interface BrowserToolOptions {
	browser?: BrowserDeps;
	/** Max characters of page text surfaced to the agent (default 8 000). */
	maxChars?: number;
	/** Per-navigation wall-clock limit in ms (default 30 000). */
	timeoutMs?: number;
	/**
	 * When true (remote / `--host` mode), navigation to private, loopback, link-local, or other reserved IP ranges
	 * is refused. When false or omitted (local mode) internal addresses are allowed — e.g. to verify a local dev
	 * server. Defaults to false so existing test helpers that omit this continue to work.
	 */
	isRemoteMode?: boolean;
}

const DEFAULT_MAX_CHARS = 8_000;
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Returns true when the given IP string belongs to a private, loopback, link-local, CGNAT, or other reserved range
 * that should be blocked in remote mode to prevent SSRF. Uses ipaddr.js `range()` so we inherit its maintained range
 * table rather than hand-rolling comparisons.
 *
 * IPv6-mapped IPv4 addresses (::ffff:x.y.z.w) are unwrapped to their IPv4 form so they cannot bypass the check via
 * the mapped representation.
 */
export function isPrivateOrReservedIp(ip: string): boolean {
	let parsed: ipaddr.IPv4 | ipaddr.IPv6;
	try {
		parsed = ipaddr.parse(ip);
	} catch {
		// Not a valid IP at all — treat as non-private (URL validation will catch it separately).
		return false;
	}

	// Unwrap IPv6-mapped IPv4 (::ffff:x.y.z.w) so the IPv4 range table applies.
	if (parsed.kind() === "ipv6") {
		const v6 = parsed as ipaddr.IPv6;
		if (v6.isIPv4MappedAddress()) {
			parsed = v6.toIPv4Address();
		}
	}

	if (parsed.kind() === "ipv4") {
		const range = (parsed as ipaddr.IPv4).range();
		// "unicast" is the default returned by ipaddr for normal public IPs; everything else is restricted.
		// Explicitly enumerate the ranges we block for clarity rather than relying on a catch-all inversion.
		const BLOCKED_IPV4_RANGES: Set<string> = new Set([
			"loopback", // 127.0.0.0/8
			"private", // 10/8, 172.16/12, 192.168/16
			"linkLocal", // 169.254.0.0/16 — incl. 169.254.169.254 cloud metadata
			"carrierGradeNat", // 100.64.0.0/10
			"unspecified", // 0.0.0.0/8
			"broadcast", // 255.255.255.255
			"multicast", // 224.0.0.0/4
			"reserved", // various TEST-NET/IETF/documentation ranges
		]);
		return BLOCKED_IPV4_RANGES.has(range);
	}

	// IPv6
	const range = (parsed as ipaddr.IPv6).range();
	const BLOCKED_IPV6_RANGES: Set<string> = new Set([
		"loopback", // ::1
		"uniqueLocal", // fc00::/7 — private IPv6
		"linkLocal", // fe80::/10
		"multicast", // ff00::/8
		"unspecified", // ::
		"ipv4Mapped", // already unwrapped above, but keep as backstop
		"reserved",
		// IPv4-EMBEDDING transition ranges — each carries/routes to an IPv4 destination in its low bits, so an
		// attacker can reach loopback/LAN/cloud-metadata through the IPv6 literal (e.g. `64:ff9b::a9fe:a9fe` → the
		// 169.254.169.254 metadata endpoint). ipaddr.js names them distinctly and they are NOT covered by the
		// unwrap above (that only handles `::ffff:` mapped). Block the whole ranges (fail-closed): a literal NAT64/
		// 6to4/Teredo URL in a page-fetch is an SSRF attempt, never a legitimate public-page fetch (which resolves
		// via DNS to a normal address). Was a fail-OPEN hole (bug-hunt 2026-07-05).
		"rfc6052", // 64:ff9b::/96 — NAT64 well-known prefix (embeds IPv4 in low 32 bits)
		"rfc6145", // ::ffff:0:0/96 — IPv4-translatable (stateless NAT64)
		"6to4", // 2002::/16 — 6to4 (embeds IPv4 in bits 16-48)
		"teredo", // 2001::/32 — Teredo tunneling (embeds a mapped IPv4)
	]);
	return BLOCKED_IPV6_RANGES.has(range);
}

/**
 * Resolves a URL's hostname to an IP address and checks whether it is private/reserved.
 * If the hostname is already a literal IP, it is checked directly without a DNS round-trip.
 * Returns an error string when the host resolves to a blocked range, or null when the host is allowed.
 *
 * Exported so the §5.AC retrieval `browse_url` wrapper ([nklein-browse-tool.ts](../nklein-agent/nklein-browse-tool.ts))
 * can reuse the SAME SSRF guard (pre-fetch + post-redirect) rather than reimplementing it. There the guard runs
 * UNCONDITIONALLY (a sandboxed agent must never reach the operator's LAN/loopback), whereas the chat tool gates it on
 * remote/`--host` mode.
 */
export async function checkHostForSsrf(rawUrl: string): Promise<string | null> {
	let parsed: URL;
	try {
		parsed = new URL(rawUrl);
	} catch {
		return null; // URL validation runs before this; invalid URL won't reach here.
	}

	const hostname = parsed.hostname;

	// IPv6 literal in URL is bracketed: [::1] — strip the brackets.
	const host = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;

	// If it is already a literal IP, check directly without DNS.
	if (ipaddr.isValid(host)) {
		if (isPrivateOrReservedIp(host)) {
			return `Browsing internal/private addresses is not allowed in remote mode (host: ${hostname}).`;
		}
		return null;
	}

	// Resolve hostname → ALL IPs and reject if ANY is private/reserved. Checking only the first address let a host
	// with mixed public+private records pass the guard while the browser's own resolution/connection-fallback
	// reached the private one; fail-closed on the whole record set instead.
	let resolved: LookupAddress[];
	try {
		resolved = await dnsLookup(host, { all: true, family: 0 });
	} catch {
		// DNS resolution failed — the URL is unreachable, but we cannot confirm it's internal. Let the navigation
		// attempt fail naturally; refusing here would false-positive on valid but currently unreachable hosts.
		return null;
	}

	const blocked = resolved.find((entry) => isPrivateOrReservedIp(entry.address));
	if (blocked) {
		return `Browsing internal/private addresses is not allowed in remote mode (host: ${hostname}, resolved: ${blocked.address}).`;
	}
	return null;
}

/** Truncate text and append a note so the agent knows the page had more content. */
function capText(text: string, maxChars: number): string {
	if (text.length <= maxChars) {
		return text;
	}
	return `${text.slice(0, maxChars)}\n[truncated: ${text.length - maxChars} more characters]`;
}

/** Validate that the URL is http/https only. Returns null when valid, an error string when not. */
function validateUrl(raw: unknown): string | null {
	if (typeof raw !== "string" || raw.trim().length === 0) {
		return "Provide a `url` string to browse.";
	}
	let parsed: URL;
	try {
		parsed = new URL(raw.trim());
	} catch {
		return `Invalid URL: ${raw.trim()}`;
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return `Only http:// and https:// URLs are supported (got: ${parsed.protocol}).`;
	}
	return null;
}

/**
 * Build a default `BrowserDeps` that drives Playwright/Chromium headless.
 *
 * Exported so the §5.AC retrieval `browse_url` wrapper can drive the SAME host-side Playwright fetcher the chat tool
 * uses in production (its SSRF guard runs in the wrapper, not here). `timeoutMs` defaults to the chat tool's own
 * default so callers get identical navigation behavior.
 */
export function buildDefaultBrowserDeps(
	timeoutMs: number = DEFAULT_TIMEOUT_MS,
	// When true, install a per-request SSRF interceptor that re-checks EVERY request (top-level nav, subresources, AND
	// redirect targets) at request time and aborts any that resolve to a private/reserved address. This is defense the
	// pre-navigation `checkHostForSsrf` cannot provide: it (a) covers subresource requests the pre-check never sees
	// (`<img src="http://169.254.169.254/…">`), (b) aborts a redirect-to-internal BEFORE the internal GET fires, and
	// (c) re-resolves closer to Chromium's own connect, shrinking the DNS-rebinding window from seconds to microseconds.
	// Residual: the last micro-TOCTOU between this resolve and Chromium's is not closed (would need IP pinning). MUST
	// stay OFF for local-mode browsing (the operator legitimately browses their own localhost); the guarded contexts
	// (remote chat + the untrusted-URL retrieval loop) turn it ON. (Hardening from the 2026-07-05 bug-hunt sweep.)
	interceptSsrf = false,
): BrowserDeps {
	return {
		fetchPage: async (url) => {
			const browser = await chromium.launch({ headless: true });
			try {
				const page = await browser.newPage();
				if (interceptSsrf) {
					const hostVerdicts = new Map<string, Promise<string | null>>();
					await page.route("**/*", async (route) => {
						const requestUrl = route.request().url();
						let verdict = hostVerdicts.get(requestUrl);
						if (verdict === undefined) {
							verdict = checkHostForSsrf(requestUrl);
							hostVerdicts.set(requestUrl, verdict);
						}
						if ((await verdict) !== null) {
							await route.abort("blockedbyclient");
							return;
						}
						await route.continue();
					});
				}
				try {
					await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
					const title = (await page.evaluate("document.title")) as string;
					const text = (await page.evaluate("document.body.innerText")) as string;
					const finalUrl = page.url();
					return { url: finalUrl, title, text };
				} finally {
					await page.close();
				}
			} finally {
				await browser.close();
			}
		},
	};
}

/**
 * Build an SSRF-guarded page fetcher that enforces the SAME safety floor as {@link createNKleinBrowseTool}: reject
 * non-http(s) URLs, DNS-resolve the host and refuse ANY private/reserved/loopback/link-local address BEFORE navigating,
 * then re-check the FINAL URL after redirects. On any violation it THROWS — so a caller that treats a failed fetch as a
 * skip (the §5.AC retrieval loop) fails CLOSED. Centralized here so the retrieval-egress path and the browse tool cannot
 * drift on the SSRF floor: the retrieval loop previously wired the RAW `buildDefaultBrowserDeps().fetchPage` and so had
 * no guard at all. `fetchPage` is injectable for tests; production uses the real Playwright fetcher.
 */
export function buildSsrfGuardedPageFetcher(
	options: { fetchPage?: (url: string) => Promise<BrowserFetchResult>; timeoutMs?: number } = {},
): (url: string) => Promise<BrowserFetchResult> {
	// The untrusted-URL retrieval loop always runs guarded — use the SSRF-intercepting default fetcher so subresource
	// requests + redirect-to-internal + a rebinding record are refused at request time, not just pre-navigation.
	const fetchPage = options.fetchPage ?? buildDefaultBrowserDeps(options.timeoutMs, true).fetchPage;
	return async (url) => {
		const invalid = validateUrl(url);
		if (invalid !== null) {
			throw new Error(invalid);
		}
		const ssrfError = await checkHostForSsrf(url);
		if (ssrfError !== null) {
			throw new Error(ssrfError);
		}
		const page = await fetchPage(url);
		// Re-check the final URL after any redirects so a redirect-to-internal is also refused.
		if (page.url && page.url !== url) {
			const redirectSsrfError = await checkHostForSsrf(page.url);
			if (redirectSsrfError !== null) {
				throw new Error(redirectSsrfError);
			}
		}
		return page;
	};
}

/** Format the fetched page as a compact, agent-readable block (title + capped body text). */
function formatPage(result: BrowserFetchResult, maxChars: number): string {
	const title = result.title.trim() || "(no title)";
	const text = result.text.trim();
	const body = text ? capText(text, maxChars) : "(no text content)";
	return `URL: ${result.url}\nTitle: ${title}\n\n${body}`;
}

/**
 * Build the `browse_url` tool set. Plugs into `createGatedChatToolExecutor`; the gate enforces the §5.M host-access
 * policy before `run` is ever called. Pass `options.browser` to inject a fake `BrowserDeps` for unit tests.
 *
 * When `options.isRemoteMode` is true the tool additionally refuses navigation to any private, loopback, link-local,
 * or otherwise reserved IP range (§5.Y #5 SSRF protection). The check runs before navigation AND is re-applied to
 * the final URL returned by `fetchPage` to catch redirect-to-internal scenarios.
 */
export function createBrowserTools(options: BrowserToolOptions = {}): ChatToolSet {
	const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const isRemoteMode = options.isRemoteMode ?? false;
	// In remote mode enable the per-request SSRF interceptor (subresources + redirect targets + rebinding window),
	// complementing the pre-navigation `checkHostForSsrf` below. Local mode stays OFF so the operator can browse localhost.
	const deps = options.browser ?? buildDefaultBrowserDeps(timeoutMs, isRemoteMode);

	const tools: ChatTool[] = [
		{
			name: "browse_url",
			// §5.L decision-6 (2026-07-04): a read-only egress fetch, NOT a host command. Egress-gated (deny in
			// isolated_readonly, confirm otherwise) + full-audited, but NOT a protected taint sink — so a page taint
			// doesn't refuse the NEXT browse (multi-page browsing works). Its exfil control is the egress allowlist +
			// the SSRF guard, not the taint gate.
			actionKind: "egress_read",
			// §5.L: the fetched page is untrusted web content. When the capability broker is on, this taints the turn so a
			// SUBSEQUENT protected-sink action (a host write/command) is refused — the fail-closed prompt-injection defense.
			taint: ["web"],
			taintFromResult: (content) => labelsForSourceContent("web", content),
			run: async (args) => {
				const validationError = validateUrl(args.url);
				if (validationError !== null) {
					return validationError;
				}
				const url = (args.url as string).trim();

				// §5.Y #5: SSRF check — pre-navigation, resolves DNS and checks against blocked IP ranges.
				if (isRemoteMode) {
					const ssrfError = await checkHostForSsrf(url);
					if (ssrfError !== null) {
						return ssrfError;
					}
				}

				let result: BrowserFetchResult;
				try {
					result = await deps.fetchPage(url);
				} catch {
					// Never surface stack traces or host paths to the agent.
					return "Could not load the page. The URL may be unreachable, or navigation timed out.";
				}

				// §5.Y #5: Re-check the final URL after redirects so a redirect-to-internal is also caught.
				if (isRemoteMode && result.url !== url) {
					const ssrfErrorAfterRedirect = await checkHostForSsrf(result.url);
					if (ssrfErrorAfterRedirect !== null) {
						return ssrfErrorAfterRedirect;
					}
				}

				return formatPage(result, maxChars);
			},
		},
	];

	const definitions: LocalLlmToolDefinition[] = [
		{
			name: "browse_url",
			description:
				"Open a URL in a headless browser and return the page's title and readable text content. Use this to read documentation, look up information, or verify that a web page works as expected. Only http:// and https:// URLs are supported. This is an egress action and requires confirmation.",
			parameters: {
				type: "object",
				properties: {
					url: {
						type: "string",
						description: "The full URL to navigate to, e.g. 'https://example.com'.",
					},
				},
				required: ["url"],
			},
		},
	];

	return { tools, definitions };
}
