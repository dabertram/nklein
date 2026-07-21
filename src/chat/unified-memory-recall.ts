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
	const queryEmbedding = deps.requireEmbedding ? (deps.embed ? await deps.embed(input.query) : null) : undefined;
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
		},
		{
			...deps,
			...(deps.requireEmbedding ? { queryEmbedding: queryEmbedding ?? null } : {}),
		},
	);
	const rankedBasicMemoryNotes = rankBasicMemoryNotesForRecall(
		input.basicMemorySources ?? [],
		input.query,
		input.basicMemoryLimit ?? 6,
	);
	const candidates = projectUnifiedMemory({
		sessionMemories: recalledSessionMemories.map((entry) => ({
			id: entry.id,
			text: entry.text,
			score: entry.score,
			shared: entry.shared,
		})),
		...(input.layerRecords ? { layerRecords: input.layerRecords } : {}),
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
