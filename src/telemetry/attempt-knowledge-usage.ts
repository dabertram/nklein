// F1.1 — distill one attempt's extracted tool calls into the compact knowledge-usage summary stored on the Agent
// Attempt Ledger `attempt` event. Pure; classification is shared with the knowledge-tool usage log so both stores
// agree on what "consulting knowledge" means (retrieval = codebase_retrieval/code_index/architecture_knowledge;
// localization = file_discovery/file_read).
import type { AttemptKnowledgeUsage, AttemptToolCall } from "../core/agent-attempt-ledger";
import { classifyKnowledgeTool } from "./knowledge-tool-usage-stats";

const RETRIEVAL_CATEGORIES = new Set(["codebase_retrieval", "code_index", "architecture_knowledge"]);
const LOCALIZATION_CATEGORIES = new Set(["file_discovery", "file_read"]);

export function summarizeAttemptKnowledgeUsage(
	toolCalls: readonly AttemptToolCall[],
	options: { knowledgeDebtPresent?: boolean | null } = {},
): AttemptKnowledgeUsage {
	let retrievalCallCount = 0;
	let localizationCallCount = 0;
	let knowledgeErrorCount = 0;
	const categoriesUsed = new Set<string>();
	for (const call of toolCalls) {
		const category = classifyKnowledgeTool(call.name);
		const retrieval = RETRIEVAL_CATEGORIES.has(category);
		const localization = LOCALIZATION_CATEGORIES.has(category);
		if (!retrieval && !localization) {
			continue;
		}
		categoriesUsed.add(category);
		if (retrieval) {
			retrievalCallCount += 1;
		} else {
			localizationCallCount += 1;
		}
		if (call.outcome === "error") {
			knowledgeErrorCount += 1;
		}
	}
	return {
		retrievalCallCount,
		localizationCallCount,
		knowledgeErrorCount,
		categoriesUsed: [...categoriesUsed].sort(),
		knowledgeDebtPresent: options.knowledgeDebtPresent ?? null,
	};
}
