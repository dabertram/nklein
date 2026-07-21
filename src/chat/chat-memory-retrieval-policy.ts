/** Namespace and supersession policy shared by solo chat recall and the unified production composer. */

export interface MemoryNamespaceRef {
	id: string;
	label: string;
	aliases?: readonly string[];
}

export interface NamespaceTaggedMemory {
	id: string;
	sessionId: string;
	text: string;
	shared: boolean;
	createdAt: number;
	namespaceId?: string | null;
	namespaceLabel?: string | null;
	namespaceAliases?: readonly string[];
	supersedesMemoryIds?: readonly string[];
}

export interface MemoryNamespaceDecision {
	retrievalQuery: string;
	allowedNamespaceIds: readonly string[];
	explicitMatch: boolean;
}

const NAMESPACE_WORDS = new Set(["project", "workspace", "repository", "repo"]);
const OVERLAP_STOP_WORDS = new Set([
	...NAMESPACE_WORDS,
	"a",
	"an",
	"and",
	"are",
	"for",
	"from",
	"is",
	"of",
	"the",
	"to",
	"use",
	"uses",
	"using",
]);
const UPDATE_CUE = /\b(?:changed|decision update|migrated|no longer|now|replaced|switched|updated)\b/iu;

function tokens(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);
}

function normalizedPhrase(text: string): string {
	return tokens(text).join(" ");
}

function namespacePhrases(ref: MemoryNamespaceRef): string[] {
	return [ref.label, ...(ref.aliases ?? []), ref.id]
		.map(normalizedPhrase)
		.filter((phrase) => phrase.length >= 2)
		.sort((left, right) => right.length - left.length);
}

/**
 * Resolve an explicitly named project/workspace from known runtime namespaces. If none is named, stay on the active
 * namespace; with neither an explicit nor active namespace, private cross-project recall has no eligible namespace.
 */
export function resolveMemoryNamespaceDecision(input: {
	query: string;
	namespaces: readonly MemoryNamespaceRef[];
	defaultNamespaceId?: string | null;
}): MemoryNamespaceDecision {
	const normalizedQuery = ` ${normalizedPhrase(input.query)} `;
	const matched = new Set<string>();
	const matchedTokens = new Set<string>();
	for (const namespace of input.namespaces) {
		for (const phrase of namespacePhrases(namespace)) {
			if (!normalizedQuery.includes(` ${phrase} `)) continue;
			matched.add(namespace.id);
			for (const token of phrase.split(" ")) matchedTokens.add(token);
			break;
		}
	}
	const explicitMatch = matched.size > 0;
	const allowedNamespaceIds = explicitMatch
		? [...matched]
		: input.defaultNamespaceId
			? [input.defaultNamespaceId]
			: [];
	const retrievalTokens = tokens(input.query).filter(
		(token) => !NAMESPACE_WORDS.has(token) && !(explicitMatch && matchedTokens.has(token)),
	);
	return {
		retrievalQuery: retrievalTokens.join(" "),
		allowedNamespaceIds,
		explicitMatch,
	};
}

function meaningfulTokens(text: string, namespaceLabel?: string | null): Set<string> {
	const namespaceTokens = new Set(tokens(namespaceLabel ?? ""));
	return new Set(tokens(text).filter((token) => !OVERLAP_STOP_WORDS.has(token) && !namespaceTokens.has(token)));
}

function intersectionSize(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
	let count = 0;
	for (const token of left) if (right.has(token)) count += 1;
	return count;
}

function sameNamespace(left: NamespaceTaggedMemory, right: NamespaceTaggedMemory): boolean {
	if (left.namespaceId || right.namespaceId) {
		return Boolean(left.namespaceId && right.namespaceId && left.namespaceId === right.namespaceId);
	}
	return left.sessionId === right.sessionId;
}

/**
 * Infer only high-signal supersession: a newer same-namespace memory explicitly says it changed/migrated/replaced a
 * prior fact and repeats at least two meaningful old-fact tokens. Explicit stored supersession links always win.
 */
export function inferSupersededMemoryIds(memories: readonly NamespaceTaggedMemory[]): Set<string> {
	const superseded = new Set<string>();
	const byId = new Map(memories.map((memory) => [memory.id, memory]));
	for (const newer of memories) {
		for (const id of newer.supersedesMemoryIds ?? []) {
			const older = byId.get(id);
			if (older && older.createdAt < newer.createdAt && sameNamespace(newer, older)) superseded.add(id);
		}
		if (!UPDATE_CUE.test(newer.text)) continue;
		const newerTokens = meaningfulTokens(newer.text, newer.namespaceLabel);
		for (const older of memories) {
			if (older.id === newer.id || older.createdAt >= newer.createdAt || !sameNamespace(newer, older)) continue;
			const olderTokens = meaningfulTokens(older.text, older.namespaceLabel);
			const overlap = intersectionSize(newerTokens, olderTokens);
			const union = newerTokens.size + olderTokens.size - overlap;
			if (overlap >= 2 && union > 0 && overlap / union >= 0.2) superseded.add(older.id);
		}
	}
	return superseded;
}

/** Apply the namespace decision plus reversible supersession metadata before similarity ranking. */
export function filterChatMemoriesForRecall<T extends NamespaceTaggedMemory>(input: {
	memories: readonly T[];
	sessionId: string;
	allProjects: boolean;
	decision: MemoryNamespaceDecision;
}): T[] {
	const allowed = new Set(input.decision.allowedNamespaceIds);
	const namespaceScoped = input.allProjects
		? input.memories.filter(
				(memory) =>
					memory.sessionId === input.sessionId ||
					memory.shared ||
					Boolean(memory.namespaceId && allowed.has(memory.namespaceId)),
			)
		: input.memories.filter((memory) => memory.sessionId === input.sessionId || memory.shared);
	const superseded = inferSupersededMemoryIds(namespaceScoped);
	return namespaceScoped.filter((memory) => !superseded.has(memory.id));
}
