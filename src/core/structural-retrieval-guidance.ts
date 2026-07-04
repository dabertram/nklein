/**
 * §5.AR/§5.B — the "prefer the code-graph over grep" nudge. When a codebase-memory-style MCP server (structural
 * code-graph queries: search_graph / trace_path / get_code_snippet / get_architecture) is ACTUALLY offered to a model,
 * a small system-prompt block tells the model to reach for those precise structural queries FIRST — locate a symbol,
 * find its callers, read one symbol's source — instead of grepping or reading whole files.
 *
 * That is the entire point of the integration: it returns exact structural answers and cuts retrieval context by ~an
 * order of magnitude, which directly serves the small/slow local-LLM + >=32k context-floor mission. Without this nudge
 * the tool sits unused even when present — the gap the MCP-guidance audit flagged (a tool with no behavior change is a
 * tool nobody uses). Pure + total: the block is emitted ONLY when such a server is in the offered set, so it can never
 * reference a tool the model doesn't actually have.
 */

/** MCP server ids that expose structural code-graph queries worth preferring over grep / full-file reads. */
export const STRUCTURAL_CODE_GRAPH_SERVER_IDS: readonly string[] = ["codebase-memory"];

/** True when `serverId` is a known structural code-graph server (one whose queries should be preferred over grep). */
export function isStructuralCodeGraphServer(serverId: string): boolean {
	return STRUCTURAL_CODE_GRAPH_SERVER_IDS.includes(serverId);
}

/**
 * Build the structural-retrieval guidance block for a model whose offered MCP servers include a structural code-graph
 * server. Returns "" when none is offered, so the caller adds nothing and the nudge never names an absent tool.
 */
export function buildStructuralRetrievalGuidance(offeredServerIds: readonly string[]): string {
	if (!offeredServerIds.some(isStructuralCodeGraphServer)) {
		return "";
	}
	return [
		"## Code retrieval: prefer the code-graph over grep",
		"You have a `codebase-memory` MCP server that answers STRUCTURAL questions about this codebase precisely:",
		"- `search_graph` — find a symbol / definition by name or pattern (functions, classes, types).",
		"- `trace_path` — follow call chains: who calls X, what X calls, data flow across the graph.",
		"- `get_code_snippet` — read the EXACT source of one qualified symbol (no surrounding noise).",
		"- `get_architecture` — the high-level module / structure map.",
		"",
		"When you need to locate a symbol, find its callers/callees, or read one function's source, use these FIRST.",
		"They return exact results and cost a fraction of the context that grepping or reading whole files does.",
		"Fall back to text search / full-file reads only for non-code text, or when the graph has no answer.",
	].join("\n");
}
