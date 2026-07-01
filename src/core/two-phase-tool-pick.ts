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

import { renderToolCardList, type ToolCard } from "./tool-card";

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

/**
 * The CANONICAL phase-1 answers the menu instructs the model to use for "no tool" / "needs several tools". They are
 * exported so the prompt side ({@link buildPhaseOneToolMenu}) and the parse side ({@link interpretPhaseOnePick}) share
 * one vocabulary — a test pins that the parser accepts exactly these, so the two sides can never drift apart. The parser
 * additionally tolerates the synonyms below (models phrase things loosely), but the prompt only ever teaches these two.
 */
export const PHASE_ONE_NONE_ANSWER = "none";
export const PHASE_ONE_PLAN_ANSWER = "plan";

/** Trimmed, lower-cased strings that map unambiguously to `{ kind: "none" }`. */
const NONE_TOKENS = new Set([PHASE_ONE_NONE_ANSWER, "no tool", ""]);

/**
 * Trimmed, lower-cased strings that map to `{ kind: "plan_needed" }` explicitly (before the unknown-tool fallback
 * also reaches the same result).
 */
const PLAN_TOKENS = new Set([PHASE_ONE_PLAN_ANSWER, "plan_needed", "multiple", "several"]);

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

/** A model's raw phase-1 response, with the OpenAI-compat `finish_reason` so truncation can be told from a real answer. */
export interface PhaseOneRawResponse {
	/** The message `content` (may be empty — e.g. a reasoning model that never reached its answer). */
	content: string;
	/** OpenAI-compat finish reason; `"length"` means the output was cut off (ran out of the token budget). */
	finishReason?: string | null;
}

/**
 * Interpret a phase-1 response that carries its `finishReason`, guarding the one case bare {@link interpretPhaseOnePick}
 * can't see: a TRUNCATED empty answer is NOT a clean "none". Empirically (qwen3.5-9b, 2026-07-01) a small reasoning model
 * spends ~400 tokens reasoning *before* emitting the pick, so a too-small budget yields empty `content` + `finish_reason:
 * "length"` — the model never actually answered. Treating that as "none" would silently proceed with no tool; instead we
 * escalate (`plan_needed`) so the caller retries with a larger budget rather than acting on a false decline. A genuinely
 * blank answer that finished normally still means "none".
 */
export function interpretPhaseOneResponse(response: PhaseOneRawResponse, cards: readonly ToolCard[]): PhaseOneDecision {
	if (response.content.trim() === "" && response.finishReason === "length") {
		return { kind: "plan_needed" };
	}
	return interpretPhaseOnePick(response.content, cards);
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

// ---------------------------------------------------------------------------
// Phase-1 prompt (the menu side of the same protocol interpretPhaseOnePick parses)
// ---------------------------------------------------------------------------

/**
 * Build the phase-1 PROMPT the small model sees: a terse instruction plus the {@link ToolCard} menu, teaching the model
 * to answer with a single line — a tool name, {@link PHASE_ONE_NONE_ANSWER}, or {@link PHASE_ONE_PLAN_ANSWER}. This is
 * the deliberate counterpart to {@link interpretPhaseOnePick} (which parses that answer): keeping both here, over the same
 * exported vocabulary, lets a unit test round-trip the two so the prompt can never instruct an answer the parser rejects.
 *
 * Pure + token-frugal (the whole point of §5.O two-phase: show short cards here, reveal the selected tool's full schema
 * only after the pick). With no cards it still emits a coherent menu whose only valid answers are none / plan.
 */
export function buildPhaseOneToolMenu(cards: readonly ToolCard[]): string {
	const header =
		"Choose the ONE tool for the next step. Reply with a single line containing only:\n" +
		"  - the exact tool name, or\n" +
		`  - "${PHASE_ONE_NONE_ANSWER}" if no tool is needed, or\n` +
		`  - "${PHASE_ONE_PLAN_ANSWER}" if the step needs several tools.`;
	const menu = renderToolCardList(cards);
	return menu.length === 0 ? `${header}\n\n(no tools available)` : `${header}\n\nTools:\n${menu}`;
}

// ---------------------------------------------------------------------------
// Phase-2 reveal (from a phase-1 decision, reveal ONLY the picked tool's schema)
// ---------------------------------------------------------------------------

/**
 * Phase-2 of the two-phase protocol: given the phase-1 {@link PhaseOneDecision} and a map of tool name → full schema,
 * reveal ONLY the selected tool's schema — the whole point of §5.O two-phase, so the small model sees exactly one verbose
 * schema instead of all of them at once.
 *
 * - `one_tool` → that tool's schema (or `null` if the name isn't in the map — the caller should escalate, not invent).
 * - `none` / `plan_needed` → `null` (no single schema to reveal; the caller proceeds with no tool, or escalates to a
 *   full planning step, respectively).
 *
 * Generic over the schema representation `T` so it stays pure + decoupled from any specific tool-schema shape (the caller
 * supplies whatever schema objects it holds). Pairs with {@link isActionableSingleTool}.
 */
export function selectRevealedToolSchema<T>(
	decision: PhaseOneDecision,
	schemasByName: ReadonlyMap<string, T>,
): T | null {
	if (!isActionableSingleTool(decision)) {
		return null;
	}
	return schemasByName.get(decision.tool) ?? null;
}
