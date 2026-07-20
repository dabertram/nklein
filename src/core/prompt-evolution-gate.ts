/**
 * F12.28 — per-(model×role) prompt evolution, and the ADOPTION GATE that keeps it honest. PURE core.
 *
 * GEPA-style reflective optimization evolves prompt INSTRUCTIONS by reflecting on execution traces, reporting
 * large gains from instruction refinement alone (67%→93% on MATH, +13% over MIPROv2 at 35× fewer rollouts). The
 * attempt ledger already records what such an optimizer needs: per-(model×role) outcomes, tool sequences, and
 * failure shapes.
 *
 * ── THE DANGEROUS PART IS NOT THE OPTIMIZER, IT IS ADOPTION ──
 * A prompt optimizer that adopts a candidate because it "won" a small comparison does not improve the system, it
 * RANDOM-WALKS it — confidently, and with a plausible rationale attached to every step. And it degrades silently:
 * nothing errors, the prompts just drift toward whatever noise the last comparison happened to contain.
 *
 * So the gate encodes what the 2026 evaluation literature says about small comparisons:
 *  - Compare PAIRED, on the identical task set (roughly a 5× sample-size saving over unpaired, and free).
 *  - Require BOTH a minimum effect size AND statistical separation — either alone is a coin flip with a p-value.
 *  - **Report UNRESOLVED as a first-class verdict** when the comparison is underpowered. On the task counts a
 *    local fleet can actually run, "unresolved" is the honest and COMMON answer, and treating it as "reject"
 *    would be nearly as wrong as treating it as "adopt": it hides that we learned nothing.
 *  - **Ties count against the challenger.** The incumbent is in production; a challenger must EARN the swap.
 *
 * This is P20.6 ("pre-register the MDE, report unresolved when you do not clear it") applied to the one
 * subsystem that would otherwise quietly rewrite the harness's own instructions.
 */

import { decideDefaultFlip } from "./ab-significance-gate";
import type { AgentLedgerEvent } from "./agent-attempt-ledger";
import type { ModelOutcomeKind } from "./model-behavior-profile";
import type { SwarmRole } from "./role-model-class";

export interface FailurePattern {
	/**
	 * What went wrong, using the LEDGER'S OWN outcome vocabulary (`no_tool_call`, `narrated`, `loop`, `timeout`,
	 * `malformed`, `aborted`, `other_failure`) rather than a parallel classification invented here. Re-deriving
	 * failure classes would let this module's taxonomy drift from the one the rest of the system reasons about,
	 * and a reflection prompt describing failures in private vocabulary is harder to act on, not easier.
	 */
	readonly kind: Exclude<ModelOutcomeKind, "success">;
	readonly count: number;
	/** Representative tool names involved, capped — enough to situate the pattern, not a data dump. */
	readonly tools: readonly string[];
}

export interface ReflectionInput {
	readonly modelId: string;
	readonly role: SwarmRole;
	readonly attempts: number;
	readonly successes: number;
	readonly patterns: readonly FailurePattern[];
}

const MAX_PATTERN_TOOLS = 5;

/**
 * Mine the ledger for one model×role's failure shape. Returns counts and classes only — never card text, which
 * keeps this usable as reflection input without dragging project content into a prompt-optimization loop.
 */
export function summarizeFailurePatterns(
	events: readonly AgentLedgerEvent[],
	modelId: string,
	role: SwarmRole,
): ReflectionInput {
	let attempts = 0;
	let successes = 0;
	const byKind = new Map<FailurePattern["kind"], { count: number; tools: Set<string> }>();

	for (const event of events) {
		if (event.kind !== "attempt" || event.modelId !== modelId || event.role !== role) {
			continue;
		}
		attempts += 1;
		if (event.outcome === "success") {
			successes += 1;
			continue;
		}
		// The ledger already classified this failure; trust it rather than re-deriving a second opinion.
		const kind = event.outcome as Exclude<ModelOutcomeKind, "success">;
		const bucket = byKind.get(kind) ?? { count: 0, tools: new Set<string>() };
		bucket.count += 1;
		for (const call of event.toolCalls) {
			if (bucket.tools.size < MAX_PATTERN_TOOLS) {
				bucket.tools.add(call.name);
			}
		}
		byKind.set(kind, bucket);
	}

	const patterns = [...byKind.entries()]
		.map(([kind, bucket]) => ({ kind, count: bucket.count, tools: [...bucket.tools] }))
		.sort((left, right) => right.count - left.count || left.kind.localeCompare(right.kind));

	return { modelId, role, attempts, successes, patterns };
}

/**
 * Build the reflection prompt. Asks for a bounded INSTRUCTION DELTA rather than a rewritten prompt: a full
 * rewrite is unreviewable and loses the accumulated reasons behind the incumbent's wording, which is exactly the
 * institutional knowledge a prompt accretes.
 */
export function buildPromptReflectionPrompt(input: {
	readonly incumbentPrompt: string;
	readonly reflection: ReflectionInput;
}): string {
	const { reflection } = input;
	const rate = reflection.attempts > 0 ? ((reflection.successes / reflection.attempts) * 100).toFixed(0) : "n/a";
	return [
		`You are improving the SYSTEM PROMPT for a ${reflection.role} agent running on ${reflection.modelId}.`,
		"",
		`Observed: ${reflection.successes}/${reflection.attempts} attempts succeeded (${rate}%).`,
		"Failure patterns:",
		...(reflection.patterns.length > 0
			? reflection.patterns.map(
					(p) => `- ${p.kind} ×${p.count}${p.tools.length > 0 ? ` (tools: ${p.tools.join(", ")})` : ""}`,
				)
			: ["- (none recorded)"]),
		"",
		"## Current prompt",
		"```",
		input.incumbentPrompt.trim(),
		"```",
		"",
		"## What to return",
		"Propose AT MOST 3 changes as a bounded delta. For each: the exact line or sentence to add, remove or",
		"replace, and one sentence on which failure pattern it addresses.",
		"",
		"Do NOT rewrite the whole prompt. Its current wording encodes reasons you cannot see, and a rewrite would",
		"discard them silently. If the failure patterns do not suggest a prompt change — for example if they look",
		"like capability or environment limits rather than instruction problems — say NO CHANGE and explain why.",
		"A prompt edit that does not address an observed failure is noise, and noise is what this loop must avoid.",
	].join("\n");
}

export interface PairedTaskResult {
	readonly taskId: string;
	readonly incumbentPassed: boolean;
	readonly candidatePassed: boolean;
}

export type AdoptionVerdict = "adopt" | "reject" | "unresolved";

export interface AdoptionDecision {
	readonly verdict: AdoptionVerdict;
	readonly candidateWins: number;
	readonly incumbentWins: number;
	readonly ties: number;
	/** Observed difference in pass rate (candidate − incumbent), in percentage points. */
	readonly effectPoints: number;
	readonly reason: string;
}

/** Discordant pairs needed before a paired comparison can separate anything at all. */
const MIN_DISCORDANT = 8;
/** Default pre-registered minimum detectable effect, in percentage points. */
export const DEFAULT_MIN_EFFECT_POINTS = 10;

/**
 * Decide whether an evolved prompt replaces the incumbent.
 *
 * Uses only the DISCORDANT pairs (tasks where the two prompts disagreed) — the concordant ones carry no
 * information about which is better, which is the whole reason paired comparison is cheaper than unpaired.
 *
 * Returns `unresolved` when the comparison cannot support a conclusion. That is not a failure of the gate; on a
 * task set a local fleet can realistically run it is the expected answer, and reporting it honestly is what stops
 * this loop from random-walking the system's own instructions.
 */
export function decidePromptAdoption(input: {
	readonly results: readonly PairedTaskResult[];
	readonly minEffectPoints?: number;
	readonly minDiscordant?: number;
}): AdoptionDecision {
	const minEffect = input.minEffectPoints ?? DEFAULT_MIN_EFFECT_POINTS;
	const minDiscordant = input.minDiscordant ?? MIN_DISCORDANT;

	let candidateWins = 0;
	let incumbentWins = 0;
	let ties = 0;
	for (const result of input.results) {
		if (result.candidatePassed && !result.incumbentPassed) {
			candidateWins += 1;
		} else if (result.incumbentPassed && !result.candidatePassed) {
			incumbentWins += 1;
		} else {
			ties += 1;
		}
	}
	const total = input.results.length;
	const effectPoints = total === 0 ? 0 : ((candidateWins - incumbentWins) / total) * 100;
	const discordant = candidateWins + incumbentWins;

	const base = { candidateWins, incumbentWins, ties, effectPoints };

	if (total === 0) {
		return { ...base, verdict: "unresolved", reason: "no paired results — nothing was compared" };
	}
	if (discordant < minDiscordant) {
		return {
			...base,
			verdict: "unresolved",
			reason: `only ${discordant} discordant pair(s) of ${total} task(s); ${minDiscordant} are needed before a paired comparison can separate the prompts. UNRESOLVED means we learned nothing — it is NOT a rejection, and adopting here would be a coin flip.`,
		};
	}
	// DELEGATE the statistics to F12.41's gate rather than reimplementing them. That module runs McNemar's EXACT
	// test (exact binomial on the discordant pairs — correct at any n, unlike the chi-square approximation that
	// fails in exactly the small-eval regime a local fleet lives in). An earlier version of this function used a
	// bare effect-size threshold: weaker, AND a second implementation of a decision this project had already
	// made once. One implementation per lever.
	const flip = decideDefaultFlip({
		pairs: input.results.map((result) => ({ a: result.incumbentPassed, b: result.candidatePassed })),
		minEffect: minEffect / 100,
	});
	if (flip.flip) {
		return {
			...base,
			verdict: "adopt",
			reason: `${flip.reason} (${candidateWins} candidate win(s) vs ${incumbentWins} over ${discordant} discordant pair(s))`,
		};
	}
	// Not a flip. Distinguish "the candidate is actually WORSE" from "we could not tell" — collapsing those two
	// is the exact failure this gate exists to prevent.
	if (effectPoints < 0 && flip.mcnemar.significant) {
		return {
			...base,
			verdict: "reject",
			reason: `candidate is significantly WORSE by ${Math.abs(effectPoints).toFixed(1)}pp — ${flip.reason}`,
		};
	}
	return {
		...base,
		verdict: "unresolved",
		reason: `${flip.reason} — UNRESOLVED means we learned nothing. This is NOT a rejection, and it is the EXPECTED answer at the task counts a local fleet can realistically run.`,
	};
}
