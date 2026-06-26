/**
 * Progressively REDUCE the difficulty of what !Klein asks a model to do, on a retry after it failed to act (todo §5.AA).
 *
 * Grounded in the §5.Z cross-model sweep: phi-4-mini emits a clean structured `tool_call` when given a SIMPLE 1-tool
 * prompt, but fails the 6-tool agent harness — it drowns in task complexity, it is not incapable. So the robust move
 * is to *shrink the ask* (fewer tools, then the single needed tool), not to re-prompt or give up. This is the tool-set
 * rung of the adaptive attempt ladder; prompt-simplification + endpoint-iteration rungs layer on top.
 *
 * Pure + generic (any `{ name }`-shaped tool) so the chat loop and the swarm session runtime share one seam, and so it
 * is trivially testable. The anchor is the instruction text: at higher levels keep only the tools the task actually
 * references by name (in mention order), so a weak model sees just what it needs.
 */

export interface NamedTool {
	name: string;
}

export interface ToolSelectionResult<T extends NamedTool> {
	/** The tools to offer on this attempt (possibly a subset). */
	tools: T[];
	/** True when the set was narrowed below the original count. */
	reduced: boolean;
	/** Names kept, in instruction-mention order (empty when not reduced). */
	matchedNames: string[];
}

/**
 * Narrow the offered tool set for attempt `level`:
 * - `level <= 0` (or ≤1 tool): the full set, unchanged.
 * - `level >= 1`: only the tools whose name is referenced in `instruction` (case-insensitive), in mention order. If
 *   the instruction names none of them, the set is left intact — there is nothing to anchor a safe reduction on, and
 *   other ladder rungs (prompt simplification, endpoint iteration, constrained decoding) handle that case.
 * - `level >= 2`: cap to the single first-referenced tool — the most aggressive narrowing before dropping tools entirely.
 */
export function selectToolsForAttempt<T extends NamedTool>(
	tools: readonly T[],
	instruction: string,
	level: number,
): ToolSelectionResult<T> {
	if (level <= 0 || tools.length <= 1) {
		return { tools: [...tools], reduced: false, matchedNames: [] };
	}
	const haystack = instruction.toLowerCase();
	const mentioned = tools
		.map((tool) => ({ tool, at: toolReferencePosition(tool.name, haystack) }))
		.filter((entry) => entry.at >= 0)
		.sort((a, b) => a.at - b.at);
	if (mentioned.length === 0) {
		return { tools: [...tools], reduced: false, matchedNames: [] };
	}
	const cap = level >= 2 ? 1 : mentioned.length;
	const selected = mentioned.slice(0, cap).map((entry) => entry.tool);
	return {
		tools: selected,
		reduced: selected.length < tools.length,
		matchedNames: selected.map((tool) => tool.name),
	};
}

/**
 * Earliest position at which an instruction references a tool, or -1. Robust to natural language: matches the exact
 * `snake_case` name, the spaced form (`create_card` → "create card"), and the distinctive last word (`card`,
 * `command`, `file`, `board`, `chain`) so "make a card" anchors `create_card`. The last word must be ≥4 chars to
 * avoid ambiguous short matches (e.g. `dir`); substring matching is intentional (a slightly-too-eager anchor just
 * offers a relevant tool, which is harmless).
 */
function toolReferencePosition(toolName: string, haystack: string): number {
	const name = toolName.toLowerCase();
	const lastWord = name.split("_").at(-1) ?? name;
	const candidates = [name, name.replace(/_/g, " "), ...(lastWord.length >= 4 ? [lastWord] : [])];
	let best = -1;
	for (const candidate of candidates) {
		const at = haystack.indexOf(candidate);
		if (at >= 0 && (best < 0 || at < best)) {
			best = at;
		}
	}
	return best;
}

/** The number of escalating simplification levels the ladder offers (0 = full, then narrower). */
export const MAX_ATTEMPT_SIMPLIFICATION_LEVEL = 2;
