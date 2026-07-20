/**
 * F3.8a — compare the CHAT path's live-tuned inline retry ladder against the shared retry-policy engine. PURE core.
 *
 * F3.8 says "replace inline ladders with the shared bounded controller". Read literally that is a one-line rewire.
 * Read carefully it is a behaviour change on the one path a user watches in real time, and `retry-policy.ts` says so
 * itself: the adoption gap "needs representative cross-model validation".
 *
 * ── WHY THIS IS A COMPARISON AND NOT THE REWIRE ──
 * Reading both ladders side by side turns up something the item text does not mention: **the chat ladder knows
 * things the engine does not.** Each of its rungs carries a live observation in the source —
 *  - a truncation retry fires FIRST on a no-tool-call turn, because "a reasoning model can burn its whole token
 *    budget on reasoning_content ... BEFORE emitting the tool call" (qwen3-8b, 200 tokens on a trivial reply);
 *  - it disables thinking via the model's own soft-switch when one exists, which removes the ROOT cause rather than
 *    paying for it (qwen3 reasoning 965 → 2 chars, tool call still landed);
 *  - only THEN does it narrow the tool set (phi-4: clean call with 1 tool, fails with 6).
 *
 * The engine's `no_tool_call` ladder starts at `reduced_tool_set` and **has no token-budget rung at all** — that rung
 * lives only under `aborted`. So a literal adoption would, for exactly the failure mode chat sees most, drop the
 * cheapest live-validated recovery and reach for a more expensive one. It would also silently discard the
 * thinking-disable rung, which the engine cannot express in any ladder.
 *
 * **That makes "adopt the engine" a REGRESSION until the engine learns what chat already knows.** So this module
 * reports divergence and classifies it by direction, and the F3.8 wire is gated on the report being clean. Observe
 * before enforce — the same discipline the rest of this project applies to guards, applied to a refactor.
 *
 * Honesty stance: a rung present in the live path and absent from the engine is a **BLOCKER**, not a note. Ranking
 * it as advisory would let a green-looking adoption delete field-earned behaviour, and the deletion would surface
 * later as "the local models got worse" with no obvious cause.
 */

import type { ModelOutcomeKind } from "./model-behavior-profile";
import { type RetryStrategy, retryLadderForOutcome } from "./retry-policy";

/**
 * Rungs the chat path actually performs. This is a SUPERSET of `RetryStrategy` because chat does one thing the
 * engine has no vocabulary for — see `thinking_disable`.
 */
export type ChatRung = RetryStrategy | "thinking_disable";

export interface LadderComparison {
	readonly outcome: ModelOutcomeKind;
	/** What chat actually does for this outcome, in the order it does it. */
	readonly chatSequence: readonly ChatRung[];
}

export type DivergenceKind =
	/** Chat performs a rung the engine's ladder for this outcome does not contain. Adopting would LOSE it. */
	| "missing_in_engine"
	/** The engine has no vocabulary for this rung at all — it cannot be expressed, not merely unlisted. */
	| "inexpressible_in_engine"
	/** Both have the rung, but the engine would reach it later than chat does. */
	| "reordered"
	/** The engine offers a rung chat never tries. Informational: adopting would ADD behaviour, not remove it. */
	| "engine_only";

export interface Divergence {
	readonly kind: DivergenceKind;
	readonly rung: ChatRung;
	readonly detail: string;
}

export interface DivergenceReport {
	readonly outcome: ModelOutcomeKind;
	readonly divergences: readonly Divergence[];
	/** True when nothing would be lost or reordered by adopting the engine for this outcome. */
	readonly safeToAdopt: boolean;
	readonly summary: string;
}

/** Rungs the engine has no representation for anywhere in its strategy union. */
function isInexpressible(rung: ChatRung): boolean {
	return !(retryLadderForOutcome("aborted") as readonly string[]).includes(rung) && rung === "thinking_disable";
}

/**
 * Compare one outcome's ladders.
 *
 * `safeToAdopt` is false for ANY loss or reorder. Reordering counts because the chat rungs are ordered by measured
 * cost — the truncation retry is described as "the CHEAPEST first recovery" — so a reorder is not cosmetic, it
 * spends more of a local model's time to reach the same place.
 */
export function compareLadders(comparison: LadderComparison): DivergenceReport {
	const engineLadder = retryLadderForOutcome(comparison.outcome);
	const engineSet = new Set<string>(engineLadder);
	const divergences: Divergence[] = [];

	comparison.chatSequence.forEach((rung, chatIndex) => {
		if (isInexpressible(rung)) {
			divergences.push({
				kind: "inexpressible_in_engine",
				rung,
				detail: `chat performs "${rung}" but the engine's RetryStrategy union cannot express it — adoption would delete this rung with no place to put it back`,
			});
			return;
		}
		if (!engineSet.has(rung)) {
			divergences.push({
				kind: "missing_in_engine",
				rung,
				detail: `chat tries "${rung}" for a "${comparison.outcome}" outcome; the engine's ladder for that outcome does not include it — adopting would LOSE a live-validated recovery`,
			});
			return;
		}
		const engineIndex = engineLadder.indexOf(rung as RetryStrategy);
		if (engineIndex > chatIndex) {
			divergences.push({
				kind: "reordered",
				rung,
				detail: `chat reaches "${rung}" at position ${chatIndex + 1}, the engine at ${engineIndex + 1} — the chat order is cost-ranked, so this spends more before the same recovery`,
			});
		}
	});

	const chatSet = new Set<string>(comparison.chatSequence);
	for (const rung of engineLadder) {
		if (!chatSet.has(rung)) {
			divergences.push({
				kind: "engine_only",
				rung,
				detail: `the engine offers "${rung}" where chat does not — adoption would ADD this, which is a gain to validate rather than a loss to block on`,
			});
		}
	}

	const blocking = divergences.filter((d) => d.kind !== "engine_only");
	const safeToAdopt = blocking.length === 0;

	return {
		outcome: comparison.outcome,
		divergences,
		safeToAdopt,
		summary: safeToAdopt
			? `"${comparison.outcome}": engine ladder covers everything chat does, in at least as cheap an order — adoption loses nothing.`
			: `"${comparison.outcome}": ${blocking.length} blocking divergence(s) — adopting the engine here would REGRESS the chat path. ${blocking.map((d) => `${d.rung} (${d.kind})`).join(", ")}`,
	};
}

/**
 * The chat path's ladders as they actually run today, transcribed from `chat-local-llm-adapter.ts`.
 *
 * Transcribed rather than imported deliberately: the adapter's ladder is expressed as imperative control flow, not
 * as data, so there is nothing to import. That means this table can DRIFT from the code it describes — which is
 * itself part of what F3.8 should fix, and is recorded here rather than left as a silent assumption.
 */
export const OBSERVED_CHAT_LADDERS: readonly LadderComparison[] = [
	{
		// A no-tool-call turn: truncation retry (with thinking-disable when the model has a soft-switch), escalate
		// the budget while it keeps truncating, then narrow the tool set.
		outcome: "no_tool_call",
		chatSequence: ["raise_token_budget", "thinking_disable", "reduced_tool_set"],
	},
	{
		outcome: "aborted",
		chatSequence: ["raise_token_budget", "same_model_retry"],
	},
];

/** Compare every observed chat ladder. `safeToAdopt` on the whole set is the F3.8 wire's precondition. */
export function auditChatLadderAdoption(ladders: readonly LadderComparison[] = OBSERVED_CHAT_LADDERS): {
	readonly reports: readonly DivergenceReport[];
	readonly safeToAdopt: boolean;
	readonly summary: string;
} {
	const reports = ladders.map(compareLadders);
	const blocked = reports.filter((report) => !report.safeToAdopt);
	return {
		reports,
		safeToAdopt: blocked.length === 0,
		summary:
			blocked.length === 0
				? `All ${reports.length} observed chat ladder(s) are covered by the engine — F3.8 can proceed as a wire.`
				: `${blocked.length}/${reports.length} chat ladder(s) would REGRESS under the engine. F3.8 is not a wire yet: the engine must learn these rungs first. ${blocked.map((report) => report.summary).join(" | ")}`,
	};
}
