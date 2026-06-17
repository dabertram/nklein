import type { AgentTool } from "@clinebot/shared";

const DEFAULT_ALLOWED_DOMAINS = [
	"docs.cline.bot",
	"cline.bot",
	"artificialanalysis.ai",
	"llm-stats.com",
	"openrouter.ai",
	"mcp.so",
	"smithery.ai",
	"glama.ai",
	"github.com",
	"github.blog",
	"raw.githubusercontent.com",
];
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_CHARS = 12_000;

export interface WebResearchResult {
	url: string;
	title: string | null;
	content: string;
	truncated: boolean;
	sourceDomain: string;
}

export interface CreateWebResearchToolOptions {
	enabled?: boolean;
	allowedDomains?: readonly string[];
	fetch?: typeof globalThis.fetch;
	timeoutMs?: number;
	maxChars?: number;
}

function normalizeAllowedDomain(domain: string): string {
	return domain
		.trim()
		.toLowerCase()
		.replace(/^https?:\/\//, "")
		.replace(/\/.*$/, "");
}

function isAllowedHost(hostname: string, allowedDomains: readonly string[]): boolean {
	const normalizedHost = hostname.toLowerCase();
	return allowedDomains.some((domain) => normalizedHost === domain || normalizedHost.endsWith(`.${domain}`));
}

function extractTitle(html: string): string | null {
	const match = html.match(/<title[^>]*>(.*?)<\/title>/is);
	const title = match?.[1]?.replace(/\s+/g, " ").trim();
	return title && title.length > 0 ? title : null;
}

function stripHtml(html: string): string {
	return html
		.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gis, " ")
		.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gis, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/\s+/g, " ")
		.trim();
}

function readStringField(input: Record<string, unknown>, key: string): string {
	const value = input[key];
	return typeof value === "string" ? value.trim() : "";
}

export async function runWebResearchFetch(input: {
	url: string;
	allowedDomains?: readonly string[];
	fetch?: typeof globalThis.fetch;
	timeoutMs?: number;
	maxChars?: number;
}): Promise<WebResearchResult> {
	const url = new URL(input.url);
	if (url.protocol !== "https:") {
		throw new Error("web_research only supports HTTPS URLs.");
	}
	const allowedDomains = (input.allowedDomains ?? DEFAULT_ALLOWED_DOMAINS).map(normalizeAllowedDomain);
	if (!isAllowedHost(url.hostname, allowedDomains)) {
		throw new Error(`web_research blocked ${url.hostname}. This source is not in the allow-list.`);
	}
	const abort = new AbortController();
	const timeout = setTimeout(() => abort.abort(), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
	try {
		const response = await (input.fetch ?? globalThis.fetch)(url, {
			headers: {
				accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.1",
				"user-agent": "KanbanWebResearch/1.0",
			},
			signal: abort.signal,
		});
		if (!response.ok) {
			throw new Error(`web_research fetch failed with HTTP ${response.status}.`);
		}
		const raw = await response.text();
		const contentType = response.headers.get("content-type") ?? "";
		const text = contentType.includes("text/html") ? stripHtml(raw) : raw.replace(/\s+/g, " ").trim();
		const maxChars = input.maxChars ?? DEFAULT_MAX_CHARS;
		return {
			url: url.toString(),
			title: contentType.includes("text/html") ? extractTitle(raw) : null,
			content: text.slice(0, maxChars),
			truncated: text.length > maxChars,
			sourceDomain: url.hostname,
		};
	} finally {
		clearTimeout(timeout);
	}
}

export function createWebResearchTool(options: CreateWebResearchToolOptions = {}): AgentTool[] {
	if (options.enabled !== true) {
		return [];
	}
	const allowedDomains = (options.allowedDomains ?? DEFAULT_ALLOWED_DOMAINS).map(normalizeAllowedDomain);
	return [
		{
			name: "web_research",
			description:
				"Fetch a current HTTPS source from Kanban's allow-list for grounding docs, changelogs, model leaderboards, or MCP registry research. Use sparingly and cite the URL in your answer.",
			inputSchema: {
				type: "object",
				properties: {
					url: {
						type: "string",
						description: "HTTPS URL to fetch. The host must be on Kanban's allow-list.",
					},
				},
				required: ["url"],
				additionalProperties: false,
			},
			async execute(input) {
				const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
				return await runWebResearchFetch({
					url: readStringField(record, "url"),
					allowedDomains,
					fetch: options.fetch,
					timeoutMs: options.timeoutMs,
					maxChars: options.maxChars,
				});
			},
		},
	];
}
