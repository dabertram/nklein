/**
 * Pure interpreter for the phase-1 output of two-phase tool selection (todo §5.O — narrow tool interface for small
 * models; two-phase reveal).
 *
 * **Two-phase protocol overview:**
 *  - Phase 1 — the small model is shown SHORT {@link ToolCard} summaries for all available tools and asked which
 *    single tool (if any) applies to the current step.
 *  - Phase 2 (wired elsewhere) — only the selected tool's full JSON schema is revealed; the model then emits the
 *    actual tool call.
 *
 * This module handles ONLY the phase-1 side: it interprets the model's raw text answer into a typed
 * {@link PhaseOneDecision} so the rest of the system can branch cleanly without further string-parsing.
 *
 * Intentionally pure (no I/O, no model calls, no registries) so every interpretation rule is unit-testable in
 * isolation.
 */

import type { ToolCard } from "./tool-card";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The typed result of interpreting a model's phase-1 pick.
 *
 * - `none`        — the model correctly identified that no tool is needed.
 * - `one_tool`    — the model named exactly one known tool; `tool` is the canonical card name.
 * - `plan_needed` — the task needs multiple tools, OR the model's answer was ambiguous / hallucinated; the caller
 *                   should escalate to a full planning step rather than proceeding with a single tool.
 */
export type PhaseOneDecision = { kind: "none" } | { kind: "one_tool"; tool: string } | { kind: "plan_needed" };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Trimmed, lower-cased strings that map unambiguously to `{ kind: "none" }`. */
const NONE_TOKENS = new Set(["none", "no tool", ""]);

/**
 * Trimmed, lower-cased strings that map to `{ kind: "plan_needed" }` explicitly (before the unknown-tool fallback
 * also reaches the same result).
 */
const PLAN_TOKENS = new Set(["plan", "plan_needed", "multiple", "several"]);

// ---------------------------------------------------------------------------
// Core interpreter
// ---------------------------------------------------------------------------

/**
 * Normalize a model's raw phase-1 text answer into a {@link PhaseOneDecision}.
 *
 * Resolution order:
 * 1. Blank / "none" / "no tool" → `{ kind: "none" }`.
 * 2. "plan" / "plan_needed" / "multiple" / "several" → `{ kind: "plan_needed" }`.
 * 3. Case-insensitive exact match against a card name in `cards` → `{ kind: "one_tool", tool: <canonical name> }`.
 * 4. Anything else (unrecognised or hallucinated tool name) → `{ kind: "plan_needed" }` (safer to escalate).
 *
 * @param rawPick - The model's raw text output from phase 1 (may contain leading/trailing whitespace).
 * @param cards   - The full set of {@link ToolCard}s that were shown to the model in phase 1.
 */
export function interpretPhaseOnePick(rawPick: string, cards: readonly ToolCard[]): PhaseOneDecision {
	const normalized = rawPick.trim().toLowerCase();

	if (NONE_TOKENS.has(normalized)) {
		return { kind: "none" };
	}

	if (PLAN_TOKENS.has(normalized)) {
		return { kind: "plan_needed" };
	}

	// Case-insensitive exact match against a known card name.
	const matched = cards.find((c) => c.name.toLowerCase() === normalized);
	if (matched !== undefined) {
		return { kind: "one_tool", tool: matched.name };
	}

	// Unknown / hallucinated tool — escalate rather than invent.
	return { kind: "plan_needed" };
}

// ---------------------------------------------------------------------------
// Predicate
// ---------------------------------------------------------------------------

/**
 * Typed narrowing predicate: returns `true` (and narrows the type) when `decision` is an actionable single-tool pick.
 *
 * Usage:
 * ```ts
 * if (isActionableSingleTool(decision)) {
 *   revealFullSchema(decision.tool); // decision.tool is string here
 * }
 * ```
 */
export function isActionableSingleTool(decision: PhaseOneDecision): decision is { kind: "one_tool"; tool: string } {
	return decision.kind === "one_tool";
}
