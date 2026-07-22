/**
 * F4.21 — gated community-skill discovery.
 *
 * Discovery is deliberately a USER-REVIEW data plane, not an agent tool. It searches only curated trusted origins by
 * default. Community indexes are added only by the explicit `includeUntrusted` input, and anything found through one
 * remains untrusted even if the index points at an otherwise trusted repository. Search snippets are discarded at this
 * boundary so untrusted result prose cannot drift into an execution prompt. F4.22 may render these display-only records
 * in its browse/select flow, but must fetch and review the full source separately before import.
 */

import {
	classifySkillSourceTrust,
	type SkillSourceTrust,
	TRUSTED_SKILL_GITHUB_REPOS,
	TRUSTED_SKILL_HOSTS,
} from "./skill-source-trust";
import type { WebSearchError, WebSearchResponse, WebSearchResult } from "./web-search-contract";

export type SkillDiscoveryOriginTrust = "trusted" | "untrusted";

export interface SkillDiscoveryOrigin {
	id: string;
	label: string;
	trust: SkillDiscoveryOriginTrust;
	/** Search-engine `site:` scope. It also becomes the strict result URL boundary. */
	searchScope: string;
	baseUrl: string;
}

export const TRUSTED_SKILL_DISCOVERY_ORIGINS: readonly SkillDiscoveryOrigin[] = [
	...TRUSTED_SKILL_GITHUB_REPOS.map(([owner, repo]) => ({
		id: `github-${owner}-${repo}`,
		label: `${owner}/${repo}`,
		trust: "trusted" as const,
		searchScope: `github.com/${owner}/${repo}`,
		baseUrl: `https://github.com/${owner}/${repo}`,
	})),
	...TRUSTED_SKILL_HOSTS.map((host) => ({
		id: host.replace(/[^a-z0-9]+/gi, "-"),
		label: host,
		trust: "trusted" as const,
		searchScope: host,
		baseUrl: `https://${host}`,
	})),
];

/** Discovery-only origins. Inclusion never upgrades their content trust. */
export const UNTRUSTED_SKILL_DISCOVERY_ORIGINS: readonly SkillDiscoveryOrigin[] = [
	{
		id: "skillsmp",
		label: "SkillsMP",
		trust: "untrusted",
		searchScope: "skillsmp.com",
		baseUrl: "https://skillsmp.com",
	},
	{
		id: "skills-sh",
		label: "skills.sh",
		trust: "untrusted",
		searchScope: "skills.sh",
		baseUrl: "https://skills.sh",
	},
	{
		id: "lobehub",
		label: "LobeHub",
		trust: "untrusted",
		searchScope: "lobehub.com",
		baseUrl: "https://lobehub.com",
	},
	{
		id: "wshobson-agents",
		label: "wshobson/agents",
		trust: "untrusted",
		searchScope: "github.com/wshobson/agents",
		baseUrl: "https://github.com/wshobson/agents",
	},
];

export interface SkillDiscoveryRequest {
	query: string;
	/** Explicit opt-in. Missing/false searches trusted origins only. */
	includeUntrusted?: boolean;
	maxResults?: number;
}

export interface SkillDiscoveryQuery {
	origin: SkillDiscoveryOrigin;
	query: string;
}

/**
 * The only discovery record exposed to downstream code. `displayOnly` and `promptEligible` are literal invariants;
 * notably there is no snippet/body/description field.
 */
export interface SkillDiscoveryResult {
	title: string;
	sourceUrl: string;
	sourceTrust: SkillSourceTrust;
	discoveryTrust: SkillDiscoveryOriginTrust;
	discoveredVia: Pick<SkillDiscoveryOrigin, "id" | "label" | "baseUrl">;
	displayOnly: true;
	promptEligible: false;
}

export interface SkillDiscoveryFailure {
	originId: string;
	code: WebSearchError["code"] | "search_failed";
}

export interface SkillDiscoveryResponse {
	query: string;
	includedUntrusted: boolean;
	channel: "user-review-only";
	results: SkillDiscoveryResult[];
	failures: SkillDiscoveryFailure[];
}

export interface BrokeredSkillDiscoverySearch {
	/** Must be the configured egress-gated search client, never a direct origin fetch. */
	search(query: string): Promise<WebSearchResponse | WebSearchError>;
}

const DEFAULT_MAX_RESULTS = 24;
const MAX_MAX_RESULTS = 100;
const MAX_QUERY_CHARS = 256;

function replaceControlCharacters(value: string): string {
	return [...value]
		.map((character) => {
			const code = character.charCodeAt(0);
			return code < 32 || code === 127 ? " " : character;
		})
		.join("");
}

function normalizeUserQuery(query: string): string {
	return replaceControlCharacters(query).replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_CHARS);
}

function normalizeTitle(title: string): string {
	return replaceControlCharacters(title).replace(/\s+/g, " ").trim().slice(0, 240);
}

function normalizeMaxResults(value: number | undefined): number {
	if (!Number.isFinite(value)) return DEFAULT_MAX_RESULTS;
	return Math.max(1, Math.min(MAX_MAX_RESULTS, Math.floor(value ?? DEFAULT_MAX_RESULTS)));
}

/** Pure, deterministic query plan. The explicit opt-in is literal (`=== true`) and therefore fail-closed. */
export function planSkillDiscoveryQueries(request: SkillDiscoveryRequest): SkillDiscoveryQuery[] {
	const query = normalizeUserQuery(request.query);
	if (!query) return [];
	const origins =
		request.includeUntrusted === true
			? [...TRUSTED_SKILL_DISCOVERY_ORIGINS, ...UNTRUSTED_SKILL_DISCOVERY_ORIGINS]
			: TRUSTED_SKILL_DISCOVERY_ORIGINS;
	return origins.map((origin) => ({ origin, query: `${query} SKILL.md site:${origin.searchScope}` }));
}

function parseWebUrl(raw: string): URL | null {
	try {
		const url = new URL(raw);
		return url.protocol === "https:" ? url : null;
	} catch {
		return null;
	}
}

/** Require search hits to remain beneath the exact origin scope; `site:` is a hint, not a security boundary. */
function resultBelongsToOrigin(result: WebSearchResult, origin: SkillDiscoveryOrigin): boolean {
	const url = parseWebUrl(result.url);
	const scope = parseWebUrl(`https://${origin.searchScope}`);
	if (!url || !scope || url.hostname.toLowerCase() !== scope.hostname.toLowerCase()) return false;
	const scopePath = scope.pathname.replace(/\/+$/, "");
	if (!scopePath) return true;
	const resultPath = url.pathname.replace(/\/+$/, "");
	return resultPath === scopePath || resultPath.startsWith(`${scopePath}/`);
}

function isSearchError(value: WebSearchResponse | WebSearchError): value is WebSearchError {
	return "code" in value;
}

function toDisplayResult(result: WebSearchResult, origin: SkillDiscoveryOrigin): SkillDiscoveryResult | null {
	if (!resultBelongsToOrigin(result, origin)) return null;
	const title = normalizeTitle(result.title);
	const url = parseWebUrl(result.url);
	if (!title || !url) return null;
	const sourceTrust = classifySkillSourceTrust(url.toString()).trust;
	return {
		title,
		sourceUrl: url.toString(),
		sourceTrust,
		discoveryTrust: origin.trust,
		discoveredVia: { id: origin.id, label: origin.label, baseUrl: origin.baseUrl },
		displayOnly: true,
		promptEligible: false,
	};
}

/**
 * Execute the bounded discovery plan exclusively through an injected brokered search capability. Result text is
 * reduced to a capped display label; snippets and bodies are intentionally destroyed here.
 */
export async function discoverCommunitySkills(
	request: SkillDiscoveryRequest,
	broker: BrokeredSkillDiscoverySearch,
): Promise<SkillDiscoveryResponse> {
	const query = normalizeUserQuery(request.query);
	const includedUntrusted = request.includeUntrusted === true;
	const plan = planSkillDiscoveryQueries({ ...request, query });
	const failures: SkillDiscoveryFailure[] = [];
	if (plan.length === 0) {
		return { query, includedUntrusted, channel: "user-review-only", results: [], failures };
	}

	const outcomes = await Promise.all(
		plan.map(async (entry) => {
			try {
				return { entry, response: await broker.search(entry.query) };
			} catch {
				return { entry, response: null };
			}
		}),
	);
	const deduped = new Map<string, SkillDiscoveryResult>();
	for (const { entry, response } of outcomes) {
		if (response === null) {
			failures.push({ originId: entry.origin.id, code: "search_failed" });
			continue;
		}
		if (isSearchError(response)) {
			failures.push({ originId: entry.origin.id, code: response.code });
			continue;
		}
		for (const hit of response.results) {
			const display = toDisplayResult(hit, entry.origin);
			if (!display) continue;
			const key = display.sourceUrl.toLowerCase();
			const prior = deduped.get(key);
			if (!prior || (prior.discoveryTrust === "untrusted" && display.discoveryTrust === "trusted")) {
				deduped.set(key, display);
			}
		}
	}

	return {
		query,
		includedUntrusted,
		channel: "user-review-only",
		results: [...deduped.values()].slice(0, normalizeMaxResults(request.maxResults)),
		failures,
	};
}
