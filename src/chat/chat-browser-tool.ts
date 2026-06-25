import { chromium } from "playwright";
import type { LocalLlmToolDefinition } from "../nklein-sdk/nklein-local-llm-client";
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
}

const DEFAULT_MAX_CHARS = 8_000;
const DEFAULT_TIMEOUT_MS = 30_000;

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
 */
export function createBrowserTools(options: BrowserToolOptions = {}): ChatToolSet {
	const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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
				try {
					const result = await deps.fetchPage(url);
					return formatPage(result, maxChars);
				} catch {
					// Never surface stack traces or host paths to the agent.
					return "Could not load the page. The URL may be unreachable, or navigation timed out.";
				}
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
