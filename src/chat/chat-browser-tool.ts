import { lookup as dnsLookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { chromium } from "playwright";
import type { LocalLlmToolDefinition } from "../nklein-agent/nklein-local-llm-client";
import type { ChatToolSet } from "./chat-board-tools";
import type { ChatTool } from "./chat-tool-executor";

/**
 * The `browse_url` tool for the chat agent (todo §5.M G6 — headless-browser capability). Navigates a URL with a
 * headless Playwright browser, extracts the rendered page's title and main text, and returns a compact, token-capped
 * summary the agent can reason about. This is a `host_command` action under the §5.M invariant: reaching the
 * internet is a host-level action, so the execution-mode gate **denies** it in the default `isolated_readonly` mode
 * and requires a **logged, explicit confirmation** in the host-capable modes — it is never run silently.
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
	]);
	return BLOCKED_IPV6_RANGES.has(range);
}

/**
 * Resolves a URL's hostname to an IP address and checks whether it is private/reserved.
 * If the hostname is already a literal IP, it is checked directly without a DNS round-trip.
 * Returns an error string when the host resolves to a blocked range, or null when the host is allowed.
 */
async function checkHostForSsrf(rawUrl: string): Promise<string | null> {
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

	// Resolve hostname → IP.
	let resolvedIp: string;
	try {
		const result = await dnsLookup(host, { family: 0 });
		resolvedIp = result.address;
	} catch {
		// DNS resolution failed — the URL is unreachable, but we cannot confirm it's internal. Let the navigation
		// attempt fail naturally; refusing here would false-positive on valid but currently unreachable hosts.
		return null;
	}

	if (isPrivateOrReservedIp(resolvedIp)) {
		return `Browsing internal/private addresses is not allowed in remote mode (host: ${hostname}, resolved: ${resolvedIp}).`;
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

/** Build a default `BrowserDeps` that drives Playwright/Chromium headless. */
function buildDefaultBrowserDeps(timeoutMs: number): BrowserDeps {
	return {
		fetchPage: async (url) => {
			const browser = await chromium.launch({ headless: true });
			try {
				const page = await browser.newPage();
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
	const deps = options.browser ?? buildDefaultBrowserDeps(timeoutMs);

	const tools: ChatTool[] = [
		{
			name: "browse_url",
			actionKind: "host_command",
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
				"Open a URL in a headless browser and return the page's title and readable text content. Use this to read documentation, look up information, or verify that a web page works as expected. Only http:// and https:// URLs are supported. This is a host action and requires confirmation.",
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
