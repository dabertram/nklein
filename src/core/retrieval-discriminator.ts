/** A bounded retrieval candidate presented to a local-model relevance discriminator. */
export interface RetrievalDiscriminatorCandidate {
	readonly id: string;
	readonly text: string;
}

export interface RetrievalDiscriminatorDecision {
	/** Every candidate ID, most relevant first. */
	readonly rankedIds: readonly string[];
	/** Candidate IDs judged useful enough to expose to the coding model. */
	readonly keepIds: readonly string[];
}

export interface AppliedRetrievalDiscriminator<T extends RetrievalDiscriminatorCandidate> {
	readonly kept: readonly T[];
	readonly pruned: readonly T[];
	readonly applied: boolean;
}

/**
 * Models that independently retained the target in 28/28 F11.2e cases, had zero valid-case regressions, zero schema
 * failures, and stayed below 4 seconds mean latency. Unknown models remain on the lexical path until the fleet harness
 * measures them; parameter count is deliberately not used as a capability proxy.
 */
export const MEASURED_RETRIEVAL_DISCRIMINATOR_MODELS: ReadonlySet<string> = new Set([
	"qwen/qwen2.5-coder-14b",
	"qwen/qwen3.6-35b-a3b",
]);

export function isMeasuredRetrievalDiscriminatorModel(modelId: string): boolean {
	return MEASURED_RETRIEVAL_DISCRIMINATOR_MODELS.has(modelId.trim().toLowerCase());
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function stringArray(value: unknown): string[] | null {
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
		return null;
	}
	return value.map((entry) => entry.trim()).filter(Boolean);
}

/** Parse the strict flat discriminator response while remaining tolerant of a fenced JSON transport wrapper. */
export function parseRetrievalDiscriminatorDecision(text: string): RetrievalDiscriminatorDecision | null {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
	const candidate = fenced ?? text.trim();
	let value: unknown;
	try {
		value = JSON.parse(candidate);
	} catch {
		return null;
	}
	const record = asRecord(value);
	const rankedIds = stringArray(record?.ranked_ids);
	const keepIds = stringArray(record?.keep_ids);
	return rankedIds && keepIds ? { rankedIds, keepIds } : null;
}

function uniqueKnownIds(ids: readonly string[], knownIds: ReadonlySet<string>): string[] {
	const seen = new Set<string>();
	return ids.filter((id) => {
		if (!knownIds.has(id) || seen.has(id)) {
			return false;
		}
		seen.add(id);
		return true;
	});
}

/**
 * Apply a model decision without permitting malformed output to erase retrieval. Invalid/empty decisions fail open to
 * the original candidate list; valid decisions keep a bounded floor and preserve the model's rank order.
 */
export function applyRetrievalDiscriminator<T extends RetrievalDiscriminatorCandidate>(
	candidates: readonly T[],
	decision: RetrievalDiscriminatorDecision | null,
	options: { readonly minKeep?: number; readonly maxKeep?: number } = {},
): AppliedRetrievalDiscriminator<T> {
	if (candidates.length === 0 || !decision) {
		return { kept: [...candidates], pruned: [], applied: false };
	}
	const byId = new Map(candidates.map((candidate) => [candidate.id, candidate] as const));
	if (byId.size !== candidates.length) {
		return { kept: [...candidates], pruned: [], applied: false };
	}
	const knownIds = new Set(byId.keys());
	const explicitlyRankedIds = uniqueKnownIds(decision.rankedIds, knownIds);
	if (explicitlyRankedIds.length === 0) {
		return { kept: [...candidates], pruned: [], applied: false };
	}
	// A JSON Schema can constrain the array SHAPE but cannot require every runtime candidate ID. Models commonly omit
	// candidates they judge wholly irrelevant. Treat those omissions as an ordered tail, never as silent deletion.
	const explicitlyRanked = new Set(explicitlyRankedIds);
	const rankedIds = [
		...explicitlyRankedIds,
		...candidates.map((candidate) => candidate.id).filter((id) => !explicitlyRanked.has(id)),
	];
	const minKeep = Math.min(candidates.length, Math.max(1, Math.trunc(options.minKeep ?? 2)));
	const maxKeep = Math.min(candidates.length, Math.max(minKeep, Math.trunc(options.maxKeep ?? 4)));
	const requestedKeep = new Set(uniqueKnownIds(decision.keepIds, knownIds));
	const keptIds = rankedIds.filter((id, index) => index < minKeep || requestedKeep.has(id)).slice(0, maxKeep);
	const keptSet = new Set(keptIds);
	return {
		kept: keptIds.map((id) => byId.get(id) as T),
		pruned: rankedIds.filter((id) => !keptSet.has(id)).map((id) => byId.get(id) as T),
		applied: true,
	};
}

export function buildRetrievalDiscriminatorPrompt(input: {
	readonly query: string;
	readonly candidates: readonly RetrievalDiscriminatorCandidate[];
}): string {
	const query = input.query.trim().slice(0, 2_000);
	const candidates = input.candidates.slice(0, 8);
	return [
		"Rank code-search candidates for the coding task. A candidate is relevant only if its shown code helps locate or implement the requested change; shared generic words are not enough.",
		"Return every candidate ID exactly once in ranked_ids, best first. keep_ids must contain only useful candidates (normally 2-4; never keep a distractor for politeness).",
		`TASK:\n${query}`,
		"CANDIDATES:",
		...candidates.map((candidate) => `\n[${candidate.id}]\n${candidate.text.slice(0, 1_600)}`),
		'\nReturn only {"ranked_ids":["..."],"keep_ids":["..."]}.',
	].join("\n");
}
