import type { BasicMemoryRecallSource } from "../core/basic-memory-note-reader.js";
import type { MemoryRecord } from "../core/memory-layers.js";
import { type RankedBasicMemoryNote, rankBasicMemoryNotesForRecall } from "./basic-memory-recall.js";
import {
	type FocusChainStepInput,
	type MemoryBandOptions,
	projectUnifiedMemory,
	selectMemoryBand,
	type UnifiedMemoryRecord,
} from "./chat-memory-projection.js";
import { type MemoryNamespaceRef, resolveMemoryNamespaceDecision } from "./chat-memory-retrieval-policy.js";
import { type ChatMemory, type ChatMemoryRecall, recallChatMemories } from "./chat-memory-store.js";

export interface UnifiedMemoryRecallResult {
	recalledSessionMemories: ChatMemoryRecall[];
	rankedBasicMemoryNotes: RankedBasicMemoryNote[];
	candidates: UnifiedMemoryRecord[];
	band: UnifiedMemoryRecord[];
}

/**
 * The one production composition for F2.9/F2.10: retrieve from the chat-memory store, rank scoped Basic Memory notes,
 * project every source into the provenance-carrying read model, then apply the bounded multi-source band. The live
 * benchmark calls this exact function, preventing a surrogate ranker from certifying a path production never uses.
 */
export async function recallUnifiedMemoryBand(
	input: {
		query: string;
		sessionId: string;
		chatMemories: readonly ChatMemory[];
		layerRecords?: readonly MemoryRecord[];
		basicMemorySources?: readonly BasicMemoryRecallSource[];
		focusChainSteps?: readonly FocusChainStepInput[];
		allProjects?: boolean;
		defaultNamespaceId?: string | null;
		namespaceHints?: readonly MemoryNamespaceRef[];
		chatMemoryLimit?: number;
		basicMemoryLimit?: number;
		bandOptions?: MemoryBandOptions;
	},
	deps: {
		embed?: (text: string) => Promise<number[] | null>;
		embeddingModelId?: string;
		requireEmbedding?: boolean;
	} = {},
): Promise<UnifiedMemoryRecallResult> {
	const namespaces = [
		...input.chatMemories.flatMap((memory) =>
			memory.namespaceId && memory.namespaceLabel ? [{ id: memory.namespaceId, label: memory.namespaceLabel }] : [],
		),
		...(input.basicMemorySources ?? []).flatMap((source) =>
			source.namespaceId && source.namespaceLabel ? [{ id: source.namespaceId, label: source.namespaceLabel }] : [],
		),
		// Runtime registry hints are authoritative for a workspace id; place them last so a renamed/generic chat title
		// cannot override the registered display name used to resolve an explicitly addressed project.
		...(input.namespaceHints ?? []),
	];
	const namespaceDecision = resolveMemoryNamespaceDecision({
		query: input.query,
		namespaces: [...new Map(namespaces.map((entry) => [entry.id, entry])).values()],
		defaultNamespaceId: input.defaultNamespaceId,
	});
	const retrievalQuery = input.allProjects ? namespaceDecision.retrievalQuery : input.query;
	const queryEmbedding = deps.requireEmbedding ? (deps.embed ? await deps.embed(retrievalQuery) : null) : undefined;
	// The retained broadening verdict is for this exact embedding-backed composition. If that mode is unavailable,
	// withhold the whole widened band — including lexical Basic Memory/layer candidates — instead of mixing in an
	// unbenchmarked fallback while claiming the retained profile still applies.
	if (deps.requireEmbedding && !queryEmbedding) {
		return {
			recalledSessionMemories: [],
			rankedBasicMemoryNotes: [],
			candidates: [],
			band: [],
		};
	}
	const recalledSessionMemories = await recallChatMemories(
		{
			query: input.query,
			sessionId: input.sessionId,
			memories: input.chatMemories,
			limit: input.chatMemoryLimit ?? 12,
			...(input.allProjects ? { allProjects: true } : {}),
			...(input.defaultNamespaceId ? { defaultNamespaceId: input.defaultNamespaceId } : {}),
			namespaceHints: namespaces,
			namespaceDecision,
		},
		{
			...deps,
			...(deps.requireEmbedding ? { queryEmbedding: queryEmbedding ?? null } : {}),
		},
	);
	const allowedNamespaces = new Set(namespaceDecision.allowedNamespaceIds);
	const eligibleBasicMemorySources = input.allProjects
		? (input.basicMemorySources ?? []).filter(
				(source) => source.shared || Boolean(source.namespaceId && allowedNamespaces.has(source.namespaceId)),
			)
		: (input.basicMemorySources ?? []);
	const rankedBasicMemoryNotes = rankBasicMemoryNotesForRecall(
		eligibleBasicMemorySources,
		retrievalQuery,
		input.basicMemoryLimit ?? 6,
	);
	const eligibleLayerRecords = input.allProjects
		? (input.layerRecords ?? []).filter((record) => !record.namespaceId || allowedNamespaces.has(record.namespaceId))
		: input.layerRecords;
	const candidates = projectUnifiedMemory({
		sessionMemories: recalledSessionMemories.map((entry) => ({
			id: entry.id,
			text: entry.text,
			score: entry.score,
			shared: entry.shared,
		})),
		...(eligibleLayerRecords ? { layerRecords: eligibleLayerRecords } : {}),
		basicMemoryNotes: rankedBasicMemoryNotes,
		...(input.focusChainSteps ? { focusChainSteps: input.focusChainSteps } : {}),
	});
	return {
		recalledSessionMemories,
		rankedBasicMemoryNotes,
		candidates,
		band: selectMemoryBand(candidates, input.bandOptions),
	};
}
