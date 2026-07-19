/**
 * F12.18 — retrieval-gate the tool catalog to a small, relevant set per turn. PURE core.
 *
 * Selection accuracy craters once a model is shown more than roughly 10–15 tools ("choice paralysis"), and the
 * damage compounds: 95% per-call accuracy is only ~66% over 8 steps. Retrieval-gating the catalog tripled
 * selection accuracy in RAG-MCP (13.6% → 43.1%) while HALVING prompt tokens, and a 2026 harness study found that
 * cutting an offered set from 40+ tools down to **7** fixed 62% of observed tool-use failures. So the target here
 * is ~7, not the ~10 that "under the paralysis threshold" would suggest.
 *
 * RELATIONSHIP TO {@link ./two-phase-tool-pick.ts} (F3.T1): that module asks the MODEL which single tool to use.
 * This one runs FIRST and costs nothing — a deterministic lexical/affinity gate that shrinks the catalog before
 * any model sees it. They compose: gate 40 → 7, then optionally two-phase-pick 7 → 1. Gating is cheap and always
 * safe to run; the model call is not.
 *
 * ── THE SAFETY PROPERTY THAT MATTERS MOST ──
 * A relevance gate that drops the tool the agent needs to FINISH does not degrade the turn, it DEADLOCKS it: the
 * model cannot submit a review it was never offered `submit_review` for, and it cannot end a turn whose
 * completion tool is missing. So `alwaysKeep` tools bypass scoring entirely and are never dropped — not even when
 * the cap is smaller than the always-keep set, in which case the cap yields rather than the safety set.
 *
 * Honesty stance: when scoring cannot discriminate (every candidate scores zero — an empty task text, or a
 * catalog whose descriptions share no vocabulary with the task), the gate does NOT invent a ranking. It keeps the
 * first N in declaration order and SAYS the selection was arbitrary, so a caller can decide whether to gate at
 * all rather than acting on a confident-looking but meaningless order.
 */

import type { SwarmRole } from "./role-model-class";

/** Evidence-backed default: 40+ → 7 fixed 62% of tool-use failures. */
export const DEFAULT_TOOL_CAP = 7;

export interface GateableTool {
	readonly name: string;
	/** Purpose / description text — the model-visible vocabulary the gate matches against. */
	readonly description?: string | null;
	/** When-to-use hint, when the catalog carries one. */
	readonly useWhen?: string | null;
}

export interface ToolGateInput {
	readonly tools: readonly GateableTool[];
	/** The card text / current step the tools must serve. Empty ⇒ scoring cannot discriminate. */
	readonly taskText: string;
	readonly role?: SwarmRole | null;
	/**
	 * Tools that must NEVER be gated out (turn-completion, review submission, whatever ends the loop). These
	 * bypass scoring and are not counted against relevance — see the safety note in the module docblock.
	 */
	readonly alwaysKeep?: readonly string[];
	/** Max tools to offer, default {@link DEFAULT_TOOL_CAP}. The always-keep set may push the result above it. */
	readonly cap?: number;
}

export interface ToolGateResult {
	/** The tools to offer this turn, always-keep first then by descending relevance. */
	readonly selected: readonly GateableTool[];
	/** Names dropped by the gate — surfaced so a caller can log what the model never saw. */
	readonly dropped: readonly string[];
	/** True when no candidate scored above zero and the order is therefore declaration order, not relevance. */
	readonly arbitrary: boolean;
	readonly reason: string;
}

/** Role vocabulary: words whose presence in a tool's text makes it more plausible for that role. */
const ROLE_AFFINITY: Readonly<Record<SwarmRole, readonly string[]>> = {
	architect: ["plan", "decompose", "search", "read", "list", "map", "inspect"],
	worker: ["edit", "write", "apply", "patch", "run", "test", "build", "read"],
	reviewer: ["review", "diff", "submit", "read", "test", "verify", "compare"],
};

/** Split into lowercase word stems, dropping short stopwords that would match everything. */
function tokenize(text: string): Set<string> {
	const words = text
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((word) => word.length >= 3);
	return new Set(words);
}

function scoreTool(tool: GateableTool, taskTokens: ReadonlySet<string>, roleWords: readonly string[]): number {
	const toolText = `${tool.name} ${tool.description ?? ""} ${tool.useWhen ?? ""}`.toLowerCase();
	const toolTokens = tokenize(toolText);
	let score = 0;
	for (const token of toolTokens) {
		if (taskTokens.has(token)) {
			score += 2;
		}
	}
	// A tool name appearing verbatim in the task text is the strongest possible signal.
	if (tool.name.length >= 3 && taskTokens.has(tool.name.toLowerCase())) {
		score += 5;
	}
	for (const word of roleWords) {
		if (toolTokens.has(word)) {
			score += 1;
		}
	}
	return score;
}

/**
 * Gate a tool catalog down to the most plausible set for this turn. Pure and deterministic — the same inputs
 * always yield the same offered set, which is what keeps the prompt prefix cacheable (P19.2: a tool list that
 * varies run-to-run invalidates the entire tools→system→messages cache hierarchy).
 *
 * Ties break by declaration order, so the result is stable rather than dependent on sort implementation.
 */
export function gateToolCatalog(input: ToolGateInput): ToolGateResult {
	const cap = Math.max(1, input.cap ?? DEFAULT_TOOL_CAP);
	const alwaysKeep = new Set(input.alwaysKeep ?? []);
	const keepers = input.tools.filter((tool) => alwaysKeep.has(tool.name));
	const candidates = input.tools.filter((tool) => !alwaysKeep.has(tool.name));

	// Nothing to gate: offering everything is strictly better than a pointless cut.
	if (input.tools.length <= cap) {
		return {
			selected: input.tools,
			dropped: [],
			arbitrary: false,
			reason: `${input.tools.length} tool(s) is already at or under the ${cap}-tool cap — no gating needed`,
		};
	}

	const taskTokens = tokenize(input.taskText ?? "");
	const roleWords = input.role ? ROLE_AFFINITY[input.role] : [];
	const scored = candidates.map((tool, index) => ({
		tool,
		index,
		score: scoreTool(tool, taskTokens, roleWords),
	}));
	const anyDiscriminated = scored.some((entry) => entry.score > 0);

	const ordered = anyDiscriminated
		? [...scored].sort((left, right) => right.score - left.score || left.index - right.index)
		: scored;

	// The always-keep set is never counted against relevance and never dropped — even if it alone exceeds the
	// cap, in which case the cap yields. Dropping a completion tool deadlocks the turn; an oversized offer does not.
	const room = Math.max(0, cap - keepers.length);
	const picked = ordered.slice(0, room).map((entry) => entry.tool);
	const dropped = ordered.slice(room).map((entry) => entry.tool.name);

	return {
		selected: [...keepers, ...picked],
		dropped,
		arbitrary: !anyDiscriminated,
		reason: anyDiscriminated
			? `gated ${input.tools.length} → ${keepers.length + picked.length} by relevance to the task${input.role ? ` and the ${input.role} role` : ""}${keepers.length > 0 ? ` (${keepers.length} always-keep)` : ""}`
			: `no tool matched the task vocabulary — kept the first ${picked.length} in DECLARATION ORDER, which is arbitrary, not relevance-ranked`,
	};
}
