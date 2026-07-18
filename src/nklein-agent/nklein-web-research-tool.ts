import { buildCurrencyEvidenceFromSource } from "../core/evidence-currency-capture";
import { summarizeEvidenceCurrency } from "../core/evidence-currency-status";
import { parseUntrustedWebContent, renderParsedWebContent } from "../core/structured-ingestion-parse";
import { withTransientRetry } from "../core/transient-error";
import { appendCurrencyEvidence } from "../state/currency-evidence-store";
import { appendEgressReceipt } from "../state/egress-receipt-store";
import type { AgentTool } from "./sdk-agent-types";

const DEFAULT_ALLOWED_DOMAINS = [
	"docs.nklein.bot",
	"nklein.bot",
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
	/** F4.3: a sanitized one-line currency annotation (date/trust/status only — never body text) for the model to cite. */
	currency: string;
}

export interface CreateWebResearchToolOptions {
	enabled?: boolean;
	allowedDomains?: readonly string[];
	fetch?: typeof globalThis.fetch;
	timeoutMs?: number;
	maxChars?: number;
	/** F4.2: one advisory sentence from the research-freshness gate, appended to the tool description. */
	freshnessAdvisory?: string;
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
	// Bounded retry on transient network/server hiccups (§5.AF): a fresh abort+timeout per attempt; the body is read
	// INSIDE so a body-timeout retries too. A 5xx becomes a retryable throw (classifier matches); a 4xx is non-transient.
	const fetchOnce = async (): Promise<{ raw: string; contentType: string }> => {
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
				throw new Error(`web_research request returned HTTP ${response.status}.`);
			}
			return { raw: await response.text(), contentType: response.headers.get("content-type") ?? "" };
		} finally {
			clearTimeout(timeout);
		}
	};
	const { raw, contentType } = await withTransientRetry(fetchOnce, { maxRetries: 2 });
	const text = contentType.includes("text/html") ? stripHtml(raw) : raw.replace(/\s+/g, " ").trim();
	const maxChars = input.maxChars ?? DEFAULT_MAX_CHARS;
	// F4.3: derive the source's sanitized currency facts (parsed publication date + URL-derived trust — never the body).
	// Persist for `dev evidence-currency` AND surface a one-line annotation ON the result so the model sees each source's
	// freshness/trust inline and can cite it. Best-effort; never breaks the fetch.
	const currencyEvidence = buildCurrencyEvidenceFromSource({ id: url.toString(), ref: url.toString(), html: raw });
	void appendCurrencyEvidence([currencyEvidence]).catch(() => {});
	// F12.99: append a hash-chained egress receipt for this outbound request (the trust-center's auditable record —
	// destination + what was sent, per the egress inventory's "web_research" class). Best-effort; never breaks the fetch.
	void appendEgressReceipt({
		destination: url.toString(),
		method: "GET",
		requestSummary: url.toString(),
		category: "web_research",
		taintLabels: [],
	}).catch(() => {});
	const title = contentType.includes("text/html") ? extractTitle(raw) : null;
	// F12.10 structured ingestion channel (opt-in, NKLEIN_STRUCTURED_INGESTION=1): parse the untrusted text into the
	// strict typed shape and return ONLY its rendered form — individually-screened facts/urls, everything else
	// dropped (injection payloads included). Default off = byte-identical raw path (S4 screen + S2 fence still apply
	// downstream either way).
	const structured = /^(1|true|on)$/i.test(process.env.NKLEIN_STRUCTURED_INGESTION ?? "");
	const parsed = structured ? parseUntrustedWebContent({ title, content: text.slice(0, maxChars) }) : null;
	const deliveredText = parsed ? renderParsedWebContent(parsed) : text.slice(0, maxChars);
	return {
		url: url.toString(),
		title,
		content: deliveredText,
		// Review-found: under structured ingestion the RAW-length check alone lied — a page whose units were
		// dropped by the screen/caps reported truncated:false. The flag now reflects what the caller received.
		truncated: text.length > maxChars || (parsed !== null && parsed.droppedUnits > 0),
		sourceDomain: url.hostname,
		currency: summarizeEvidenceCurrency([currencyEvidence], Date.now()).annotation,
	};
}

export function createWebResearchTool(options: CreateWebResearchToolOptions = {}): AgentTool[] {
	if (options.enabled !== true) {
		return [];
	}
	const allowedDomains = (options.allowedDomains ?? DEFAULT_ALLOWED_DOMAINS).map(normalizeAllowedDomain);
	// F4.2: the freshness gate's advisory rides the tool DESCRIPTION — the model sees WHY online retrieval is
	// (or isn't) worth it for this task's topic volatility, at zero prompt-budget cost beyond the tool card.
	const freshnessSuffix = options.freshnessAdvisory?.trim()
		? ` Freshness gate: ${options.freshnessAdvisory.trim()}`
		: "";
	return [
		{
			name: "web_research",
			description:
				"Fetch a current HTTPS source from !Klein's allow-list for grounding docs, changelogs, model leaderboards, or MCP registry research. Use sparingly and cite the URL in your answer." +
				freshnessSuffix,
			inputSchema: {
				type: "object",
				properties: {
					url: {
						type: "string",
						description: "HTTPS URL to fetch. The host must be on !Klein's allow-list.",
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
