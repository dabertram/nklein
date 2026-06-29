/**
 * End-of-context task re-anchor for long runs (todo §5.AD / §5.N — context management).
 *
 * Research background (§5.AD): LLMs degrade on long contexts via two distinct failure modes:
 *   1. **Lost-in-the-middle** (Liu et al. 2023) — attention is U-shaped; mid-context content is attended to worst.
 *   2. **Goal dilution** — after many tool calls, retrieval results, and partial progress updates the model can lose
 *      the top-level task and start optimising for the wrong sub-goal. This is distinct from the positional problem
 *      and is especially acute for weak/small models running long agentic chains (see §5.N "task drift").
 *
 * This module provides the **pure policy layer** for a `beforeModel` hook that re-injects a compact re-anchor block
 * near the END of the assembled context (the strong end-zone, see `context-smart-zone.ts`), periodically, so the
 * model is reminded of the original task right before it generates its next action.
 *
 * Two responsibilities, cleanly separated:
 *  1. **When** to re-anchor — {@link shouldReanchor} is a pure cadence gate driven by turn counters.
 *  2. **What** to inject — {@link buildContextReanchor} formats the compact re-anchor block from structured input.
 *
 * Pure + stateless (no I/O, no side-effects), so both functions are unit-testable in isolation.
 */

/** Input for building a re-anchor block. All optional fields are silently skipped when absent or blank. */
export interface ContextReanchorInput {
	/** The top-level task / goal the agent was given. Required; if blank the block is still emitted as a reminder. */
	goal: string;
	/** The current step or sub-task the agent is working on, if known. */
	currentStep?: string | null;
	/** The Kanban card title, if the context is card-scoped. */
	cardTitle?: string | null;
	/**
	 * The most-recent N tool names the agent has called (ordered oldest→newest). Included when given to help the
	 * model situate itself in the action stream and avoid repeating work.
	 */
	recentToolNames?: readonly string[];
}

/**
 * Build a compact, clearly-delimited re-anchor block for injection near the end of a long context.
 *
 * Design constraints:
 *  - Kept intentionally short — it's appended/prepended to a request that may already be large.
 *  - XML-tag delimited so the model recognises it as a distinct framing block (Anthropic guidance for multi-section
 *    prompts; consistent with `renderSmartZoneContext({tagParts: true})`).
 *  - Empty or whitespace-only optional fields are silently omitted so callers can pass nullable values freely.
 */
export function buildContextReanchor(input: ContextReanchorInput): string {
	const lines: string[] = [];

	const goal = input.goal.trim();
	lines.push(`GOAL: ${goal}`);

	const cardTitle = input.cardTitle?.trim();
	if (cardTitle) {
		lines.push(`CARD: ${cardTitle}`);
	}

	const currentStep = input.currentStep?.trim();
	if (currentStep) {
		lines.push(`CURRENT STEP: ${currentStep}`);
	}

	const recentTools = input.recentToolNames?.filter((t) => t.trim().length > 0);
	if (recentTools && recentTools.length > 0) {
		lines.push(`RECENT TOOLS: ${recentTools.join(", ")}`);
	}

	const body = lines.join("\n");
	return `<reanchor>\n${body}\n</reanchor>`;
}

/** Input for the cadence gate. */
export interface ShouldReanchorInput {
	/** Current turn index (0-based). Re-anchoring never fires on turn 0. */
	turnCount: number;
	/**
	 * The turn at which the last re-anchor was injected, or `null` / `undefined` when no re-anchor has been injected
	 * yet. `null` is treated as −Infinity so the first eligible turn fires at `everyNTurns - 1` (turn index
	 * `everyNTurns - 1`, i.e. after `everyNTurns` turns have elapsed since the start).
	 */
	lastReanchorTurn: number | null;
	/**
	 * How many turns must elapse between re-anchors. Must be ≥ 1; values below 1 are clamped to 1 to prevent
	 * re-anchoring on every turn or causing infinite loops.
	 */
	everyNTurns: number;
}

/**
 * Pure cadence gate: returns `true` when it is time to inject a re-anchor block.
 *
 * Rules:
 *  - Never fires on turn 0 (the first turn has the full original prompt; no dilution yet).
 *  - Fires when `turnCount − lastReanchorTurn ≥ everyNTurns` (where a `null` lastReanchorTurn is treated as
 *    −Infinity, i.e. "never re-anchored", so the gap from the very start is used).
 *  - `everyNTurns` is clamped to ≥ 1 so a misconfigured value of 0 does not cause every-turn injection.
 */
export function shouldReanchor(input: ShouldReanchorInput): boolean {
	if (input.turnCount <= 0) {
		return false;
	}
	const clampedEvery = Math.max(1, input.everyNTurns);
	const lastTurn = input.lastReanchorTurn ?? -Infinity;
	return input.turnCount - lastTurn >= clampedEvery;
}
