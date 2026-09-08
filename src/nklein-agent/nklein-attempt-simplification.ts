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
 *
 * ── The anchor reads the TASK, never !Klein's own scaffolding ──
 * Live 2026-09-08, HITL rig, card a00 of `42_analysis_unchecked_error_audit`: a card with nothing left to do
 * oscillated for 16 turns and never finished. Every turn the model ended cleanly with no tool call — the correct
 * move for a card that is already satisfied — and every turn this ladder fired, narrowed to exactly one tool, and
 * forced another read. The anchor was `read_files`, and it was "mentioned" only because !Klein's OWN injected focus
 * brief contains the line `read_files coverage ledger:`. Nothing in the task ever asked for a file.
 *
 * That makes the old note below ("a slightly-too-eager anchor just offers a relevant tool, which is harmless")
 * false in the case that matters: a tool set narrowed to a pure READER cannot advance or end a card, so an eager
 * anchor is not a wasted call, it is a livelock. The haystack is therefore stripped of !Klein-authored blocks
 * first. When the task itself names no tool there is simply no anchor, the set is left intact, and a clean stop is
 * allowed to be a clean stop.
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
 *
 * `options.alwaysKeep` names tools that survive EVERY narrowing. Live 2026-09-08 (P1.RESPONDERLEADS lead (a)): the
 * ladder narrowed card a00 to `read_files` alone while its completion gate demanded that `npm test` had been RUN.
 * A turn offered only a reader cannot produce the evidence its own gate requires, so the card could not finish at
 * any level of model effort — it was unsatisfiable by construction, and it spun until the cap. Narrowing the ask is
 * a good idea; narrowing away the exit is not, and no amount of re-prompting can recover from it. So the caller
 * names the tool the gate needs and this keeps it, at the cost of one extra tool in the offered set.
 */
export function selectToolsForAttempt<T extends NamedTool>(
	tools: readonly T[],
	instruction: string,
	level: number,
	options: { readonly alwaysKeep?: readonly string[] } = {},
): ToolSelectionResult<T> {
	if (level <= 0 || tools.length <= 1) {
		return { tools: [...tools], reduced: false, matchedNames: [] };
	}
	const haystack = stripNKleinScaffolding(instruction).toLowerCase();
	const mentioned = tools
		.map((tool) => ({ tool, at: toolReferencePosition(tool.name, haystack) }))
		.filter((entry) => entry.at >= 0)
		.sort((a, b) => a.at - b.at);
	if (mentioned.length === 0) {
		return { tools: [...tools], reduced: false, matchedNames: [] };
	}
	const cap = level >= 2 ? 1 : mentioned.length;
	const selected = mentioned.slice(0, cap).map((entry) => entry.tool);
	// Whatever the anchor decides, a tool the TURN CANNOT END WITHOUT stays on the table. See `alwaysKeep` below.
	const keep = new Set(options.alwaysKeep ?? []);
	const selectedNames = new Set(selected.map((tool) => tool.name));
	const rescued = tools.filter((tool) => keep.has(tool.name) && !selectedNames.has(tool.name));
	const finalTools = [...selected, ...rescued];
	return {
		tools: finalTools,
		reduced: finalTools.length < tools.length,
		matchedNames: selected.map((tool) => tool.name),
	};
}

/**
 * !Klein injects blocks of its own prose into the last user message — the context focus brief (which names
 * `read_files` in its coverage ledger), the repo map, the focus chain, the stitching-areas note, and the retry
 * ladder's "already attempted" list (which quotes the tool the model failed to call). None of that is the task
 * asking for a tool, and treating it as such is how a finished card gets forced to read files forever.
 *
 * A block opens on one of these lines and ends at its `[/!Klein …]` closer when it has one (the focus brief does),
 * otherwise at the first blank line — which is how the unclosed blocks are actually delimited on the wire.
 */
const NKLEIN_SCAFFOLDING_OPENERS: readonly RegExp[] = [
	/^\[!Klein\b/u,
	/^\[\/!Klein\b/u,
	/^Already attempted this task\b/u,
];

export function stripNKleinScaffolding(instruction: string): string {
	const lines = instruction.split(/\r?\n/u);
	const kept: string[] = [];
	let inBlock = false;
	for (const line of lines) {
		const trimmed = line.trim();
		if (!inBlock && NKLEIN_SCAFFOLDING_OPENERS.some((opener) => opener.test(trimmed))) {
			// A closer on its own is the tail of a block we already dropped; skip the line and carry on.
			inBlock = !/^\[\/!Klein\b/u.test(trimmed);
			continue;
		}
		if (inBlock) {
			if (/^\[\/!Klein\b/u.test(trimmed) || trimmed.length === 0) {
				inBlock = false;
			}
			continue;
		}
		kept.push(line);
	}
	return kept.join("\n");
}

/**
 * Earliest position at which an instruction references a tool, or -1. Robust to natural language: matches the exact
 * `snake_case` name, the spaced form (`create_card` → "create card"), and the distinctive last word (`card`,
 * `command`, `file`, `board`, `chain`) so "make a card" anchors `create_card`. The last word must be ≥4 chars to
 * avoid ambiguous short matches (e.g. `dir`); substring matching is intentional. It is eager on purpose, which is
 * safe ONLY because the haystack no longer contains !Klein's own prose — see the module note.
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
