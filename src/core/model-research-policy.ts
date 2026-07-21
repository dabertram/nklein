import type {
	RuntimeNKleinModelResearchArea,
	RuntimeNKleinModelResearchFinding,
	RuntimeNKleinModelResearchProposal,
} from "./nklein-ops-api-contract";

/** Pure policy for F3.34. Network/model effects remain in `nklein-agent/nklein-model-research.ts`. */
export interface PrimaryModelSourcePolicy {
	label: string;
	searchDomains: readonly string[];
	accept(url: URL): boolean;
}

interface OwnerSourcePolicy {
	label: string;
	domains: readonly string[];
	githubOwners?: readonly string[];
	huggingFaceOwners?: readonly string[];
}

const OWNER_POLICIES: readonly (OwnerSourcePolicy & { matches: RegExp })[] = [
	{
		matches: /(?:^|[/_-])qwen(?:\d|[-_/]|$)/iu,
		label: "Qwen",
		domains: ["qwenlm.github.io"],
		githubOwners: ["QwenLM"],
		huggingFaceOwners: ["Qwen"],
	},
	{
		matches: /(?:^|[/_-])gemma(?:\d|[-_/]|$)/iu,
		label: "Google Gemma",
		domains: ["ai.google.dev", "developers.googleblog.com"],
		githubOwners: ["google-deepmind"],
		huggingFaceOwners: ["google"],
	},
	{
		matches: /(?:^|[/_-])mistral|mixtral|magistral/iu,
		label: "Mistral AI",
		domains: ["docs.mistral.ai", "mistral.ai"],
		githubOwners: ["mistralai"],
		huggingFaceOwners: ["mistralai"],
	},
	{
		matches: /(?:^|[/_-])(?:llama|codellama)(?:\d|[-_/]|$)/iu,
		label: "Meta Llama",
		domains: ["llama.com", "ai.meta.com"],
		githubOwners: ["meta-llama"],
		huggingFaceOwners: ["meta-llama"],
	},
	{
		matches: /deepseek/iu,
		label: "DeepSeek",
		domains: ["api-docs.deepseek.com"],
		githubOwners: ["deepseek-ai"],
		huggingFaceOwners: ["deepseek-ai"],
	},
	{
		matches: /(?:^|[/_-])phi(?:\d|[-_/]|$)/iu,
		label: "Microsoft Phi",
		domains: ["learn.microsoft.com", "azure.microsoft.com", "www.microsoft.com"],
		githubOwners: ["microsoft"],
		huggingFaceOwners: ["microsoft"],
	},
	{
		matches: /(?:glm|zai-org|thudm)/iu,
		label: "Z.ai / GLM",
		domains: ["docs.bigmodel.cn", "docs.z.ai"],
		githubOwners: ["THUDM", "zai-org"],
		huggingFaceOwners: ["THUDM", "zai-org"],
	},
	{
		matches: /(?:nvidia|nemotron)/iu,
		label: "NVIDIA",
		domains: ["docs.nvidia.com", "developer.nvidia.com", "build.nvidia.com"],
		githubOwners: ["NVIDIA"],
		huggingFaceOwners: ["nvidia"],
	},
];

function normalizedHost(host: string): string {
	return host
		.trim()
		.toLowerCase()
		.replace(/^www\./u, "");
}

function hostMatches(host: string, domain: string): boolean {
	const normalized = normalizedHost(host);
	const expected = normalizedHost(domain);
	return normalized === expected || normalized.endsWith(`.${expected}`);
}

function pathOwner(url: URL): string | null {
	return url.pathname.split("/").filter(Boolean)[0]?.toLowerCase() ?? null;
}

function ownerPolicy(input: OwnerSourcePolicy): PrimaryModelSourcePolicy {
	const githubOwners = new Set((input.githubOwners ?? []).map((owner) => owner.toLowerCase()));
	const huggingFaceOwners = new Set((input.huggingFaceOwners ?? []).map((owner) => owner.toLowerCase()));
	const searchDomains = [
		...input.domains,
		...(githubOwners.size > 0 ? ["github.com"] : []),
		...(huggingFaceOwners.size > 0 ? ["huggingface.co"] : []),
	];
	return {
		label: input.label,
		searchDomains,
		accept(url) {
			if (input.domains.some((domain) => hostMatches(url.hostname, domain))) return true;
			const owner = pathOwner(url);
			if (hostMatches(url.hostname, "github.com")) return owner !== null && githubOwners.has(owner);
			if (hostMatches(url.hostname, "huggingface.co")) return owner !== null && huggingFaceOwners.has(owner);
			return false;
		},
	};
}

/** A namespaced unknown model gets only its exact publisher HF namespace, never an entire aggregator host. */
export function resolvePrimaryModelSourcePolicy(modelId: string): PrimaryModelSourcePolicy | null {
	const known = OWNER_POLICIES.find((candidate) => candidate.matches.test(modelId));
	if (known) return ownerPolicy(known);
	const owner = modelId.split("/")[0]?.trim();
	if (!owner || !modelId.includes("/") || owner.toLowerCase().includes("lmstudio")) return null;
	return ownerPolicy({ label: `${owner} model publisher`, domains: [], huggingFaceOwners: [owner] });
}

export function isPrimaryModelSourceUrl(rawUrl: string, policy: PrimaryModelSourcePolicy): boolean {
	try {
		const url = new URL(rawUrl);
		return url.protocol === "https:" && policy.accept(url);
	} catch {
		return false;
	}
}

/** Fail before any search/fetch/model call unless all three authoritative gates are open. */
export function assertModelResearchEgressAllowed(input: {
	egressEnabled: boolean;
	searchBackendUrl: string | null;
	airGapped: boolean;
}): void {
	if (input.airGapped) throw new Error("Model research is unavailable while air-gap mode is enabled.");
	if (input.egressEnabled !== true) {
		throw new Error("Model research egress is disabled — enable retrieval egress in Settings first.");
	}
	if (!input.searchBackendUrl?.trim()) {
		throw new Error("Model research needs a configured SearXNG retrieval backend.");
	}
}

export type ModelResearchCitedValue = { value: string; sourceIds: string[] } | null;

export interface ModelResearchRawProposal {
	toolUse: ModelResearchCitedValue;
	kind: ModelResearchCitedValue;
	chaining: ModelResearchCitedValue;
	structuredOutput: ModelResearchCitedValue;
	findings: { area: string; claim: string; sourceIds: string[] }[];
	unknowns: string[];
	warnings: string[];
}

export function buildExactModelMatch(modelId: string): string {
	return `^${modelId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`;
}

/** Drop every model-generated field/finding that does not cite only known admitted evidence IDs. */
export function validateModelResearchCitations(
	value: ModelResearchRawProposal,
	evidenceById: ReadonlyMap<string, { id: string; url: string }>,
	modelId: string,
): RuntimeNKleinModelResearchProposal {
	const warnings = [...value.warnings];
	const validIds = (ids: readonly string[]): string[] => [...new Set(ids.filter((id) => evidenceById.has(id)))];
	const field = <T extends string>(
		name: string,
		candidate: ModelResearchCitedValue,
	): { value: T; sourceIds: string[] } | null => {
		if (candidate === null) return null;
		const sourceIds = validIds(candidate.sourceIds);
		if (sourceIds.length === 0 || sourceIds.length !== new Set(candidate.sourceIds).size) {
			warnings.push(`${name} was omitted because its citations were missing or unknown.`);
			return null;
		}
		return { value: candidate.value as T, sourceIds };
	};
	const findings: RuntimeNKleinModelResearchFinding[] = [];
	for (const finding of value.findings) {
		const sourceIds = validIds(finding.sourceIds);
		if (sourceIds.length === 0 || sourceIds.length !== new Set(finding.sourceIds).size) {
			warnings.push(`${finding.area} finding was omitted because its citations were missing or unknown.`);
			continue;
		}
		findings.push({ area: finding.area as RuntimeNKleinModelResearchArea, claim: finding.claim, sourceIds });
	}
	const citedIds = new Set<string>();
	for (const candidate of [value.toolUse, value.kind, value.chaining, value.structuredOutput]) {
		if (candidate) for (const id of validIds(candidate.sourceIds)) citedIds.add(id);
	}
	for (const finding of findings) for (const id of finding.sourceIds) citedIds.add(id);
	const sources = [...citedIds].flatMap((id) => {
		const source = evidenceById.get(id);
		return source ? [source.url] : [];
	});
	return {
		family: modelId,
		match: buildExactModelMatch(modelId),
		toolUse: field<
			RuntimeNKleinModelResearchProposal["toolUse"] extends { value: infer T } | null ? T & string : string
		>("toolUse", value.toolUse),
		kind: field<RuntimeNKleinModelResearchProposal["kind"] extends { value: infer T } | null ? T & string : string>(
			"kind",
			value.kind,
		),
		chaining: field<
			RuntimeNKleinModelResearchProposal["chaining"] extends { value: infer T } | null ? T & string : string
		>("chaining", value.chaining),
		structuredOutput: field<
			RuntimeNKleinModelResearchProposal["structuredOutput"] extends { value: infer T } | null ? T & string : string
		>("structuredOutput", value.structuredOutput),
		note:
			findings.length > 0
				? findings.map((finding) => finding.claim).join(" ")
				: "No cited catalog claims extracted.",
		sources,
		basis: "research",
		verified: false,
		findings,
		unknowns: value.unknowns,
		warnings,
	};
}
