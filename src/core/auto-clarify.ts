/**
 * Auto-clarify loop core (todo.md §5.S) — the pure decision logic for resolving a card's open clarifying
 * questions automatically. The architect proposes an answer, the reviewer (reuse §5.K) adds an opinion, and the
 * architect refines — a bounded ping-pong that continues *while it is progressing* and stops on a multi-layered
 * no-progress detector (semantic similarity of consecutive proposals AND the agent's own self-check), a generous
 * safety cap, and an operator hard limit. When the loop stops without a confident answer it falls back to a
 * working assumption so planning never blocks (the §5.B open-question default behaviour, but reached through a
 * real review loop instead of immediately).
 *
 * This module is pure and dependency-injected (the embedding-backed similarity is passed in), so it is fully
 * unit-testable; the wiring (§5.S "wire into the flow") drives the architect/reviewer turns and the real
 * embedder, and persists the resolved/remaining state onto the card/plan question (`applyAutoClarifyDecision`).
 */
import type { NKleinPlanQuestion } from "../nklein-sdk/nklein-plan-artifacts";

export interface AutoClarifyRound {
	/** The architect's proposed answer (or refined assumption) this round. */
	proposal: string;
	/** The reviewer's opinion text, if a reviewer weighed in this round; null when none. */
	reviewerOpinion: string | null;
	/** Architect self-check: did this round meaningfully advance toward a confident answer? */
	selfReportedProgress: boolean;
	/** True when the architect declared this proposal a final, confident answer (ends the loop with `answer`). */
	resolved: boolean;
}

export interface AutoClarifyConfig {
	/** Generous built-in safety cap on ping-pong rounds. */
	safetyCap: number;
	/** Operator hard limit (global/project). <= 0 means "no extra limit beyond the safety cap". */
	userHardLimit: number;
	/** Two consecutive proposals at/above this similarity (0..1) count as "no progress". */
	noProgressSimilarityThreshold: number;
	/** Don't run the stall check until at least this many rounds have happened. */
	minRoundsBeforeStallCheck: number;
}

export const DEFAULT_AUTO_CLARIFY_CONFIG: AutoClarifyConfig = {
	safetyCap: 30,
	userHardLimit: 0,
	noProgressSimilarityThreshold: 0.92,
	minRoundsBeforeStallCheck: 3,
};

export type AutoClarifyDecision =
	| { action: "answer"; answer: string; reason: string }
	| { action: "keep_asking"; reason: string }
	| { action: "give_up_with_assumption"; assumption: string; reason: string };

/** Cosine-style text similarity in [0,1]; injected so the core stays pure (the wiring supplies the embedder). */
export type TextSimilarity = (a: string, b: string) => number;

/** Effective round budget: the safety cap, tightened by a positive operator hard limit. */
export function resolveAutoClarifyRoundBudget(config: AutoClarifyConfig): number {
	const safety = Number.isFinite(config.safetyCap) && config.safetyCap > 0 ? Math.trunc(config.safetyCap) : 1;
	if (Number.isFinite(config.userHardLimit) && config.userHardLimit > 0) {
		return Math.min(safety, Math.trunc(config.userHardLimit));
	}
	return safety;
}

/**
 * Decide the next step of the auto-clarify loop from the round history so far. Pure: same inputs → same output.
 * Order of precedence: a confident architect answer wins immediately; otherwise the round-budget cap and the
 * no-progress stall detector force a give-up-with-assumption; otherwise keep asking.
 */
export function decideAutoClarifyStep(
	rounds: readonly AutoClarifyRound[],
	config: AutoClarifyConfig,
	similarity: TextSimilarity,
): AutoClarifyDecision {
	if (rounds.length === 0) {
		return { action: "keep_asking", reason: "No clarify rounds yet — propose an answer." };
	}
	const latest = rounds[rounds.length - 1];
	if (latest.resolved && latest.proposal.trim().length > 0) {
		return { action: "answer", answer: latest.proposal.trim(), reason: "Architect reached a confident answer." };
	}
	const budget = resolveAutoClarifyRoundBudget(config);
	const fallbackAssumption = latest.proposal.trim();
	if (rounds.length >= budget) {
		return {
			action: "give_up_with_assumption",
			assumption: fallbackAssumption,
			reason: `Reached the ${budget}-round clarify budget; proceeding on the best assumption.`,
		};
	}
	// No-progress detector: consecutive proposals have converged AND the agent self-reports no progress.
	if (rounds.length >= Math.max(2, config.minRoundsBeforeStallCheck)) {
		const previous = rounds[rounds.length - 2];
		const proposalSimilarity = similarity(latest.proposal, previous.proposal);
		if (proposalSimilarity >= config.noProgressSimilarityThreshold && !latest.selfReportedProgress) {
			return {
				action: "give_up_with_assumption",
				assumption: fallbackAssumption,
				reason: `No progress: the last two proposals converged (similarity ${proposalSimilarity.toFixed(2)}) and the agent self-reported no progress.`,
			};
		}
	}
	return { action: "keep_asking", reason: "Still progressing — continue the architect/reviewer exchange." };
}

/**
 * Project an auto-clarify decision back onto a plan-artifact question (§5.S "persist resolved/remaining state").
 * `answer` → status `answered`; `give_up_with_assumption` → status `assumed-default` with the assumption recorded
 * (the question stays inspectable so a user can still override it later, mirroring the §5.B default behaviour);
 * `keep_asking` leaves the question `open` unchanged.
 */
export function applyAutoClarifyDecision(
	question: NKleinPlanQuestion,
	decision: AutoClarifyDecision,
): NKleinPlanQuestion {
	switch (decision.action) {
		case "answer":
			return { ...question, status: "answered", answer: decision.answer, assumption: null };
		case "give_up_with_assumption":
			return { ...question, status: "assumed-default", assumption: decision.assumption };
		case "keep_asking":
			return { ...question, status: "open" };
	}
}

/** The architect's proposal for a clarify round. `resolved` ends the loop with a confident answer. */
export interface AutoClarifyProposal {
	proposal: string;
	resolved: boolean;
	selfReportedProgress: boolean;
}

/**
 * I/O for one auto-clarify loop (§5.S "wire into the flow"): the architect proposes/refines (a real model turn in
 * production, a stub in tests), the reviewer (§5.K) opines on a non-final proposal, and `similarity` is the
 * embedder-backed text similarity used by the no-progress detector. Injecting these keeps the loop pure-ish and
 * fully unit-testable while the wiring supplies the real reviewer model + embedder.
 */
export interface AutoClarifyTurnDeps {
	propose: (question: NKleinPlanQuestion, rounds: readonly AutoClarifyRound[]) => Promise<AutoClarifyProposal>;
	review: (question: NKleinPlanQuestion, proposal: string) => Promise<string | null>;
	similarity: TextSimilarity;
}

export interface AutoClarifyLoopResult {
	/** The question with the resolved/assumed state applied (open only if it somehow never terminated). */
	question: NKleinPlanQuestion;
	rounds: AutoClarifyRound[];
	decision: AutoClarifyDecision;
}

/**
 * Drive the architect→reviewer→architect exchange for one open question until `decideAutoClarifyStep` answers or
 * gives up with an assumption (so planning never blocks). A confident architect proposal skips the reviewer and
 * resolves immediately; otherwise the reviewer opines and the loop continues while progressing. A hard outer bound
 * (the round budget + 1) guarantees termination even if a dep misbehaves.
 */
export async function runAutoClarifyLoop(
	question: NKleinPlanQuestion,
	deps: AutoClarifyTurnDeps,
	config: AutoClarifyConfig = DEFAULT_AUTO_CLARIFY_CONFIG,
): Promise<AutoClarifyLoopResult> {
	const rounds: AutoClarifyRound[] = [];
	const hardBound = resolveAutoClarifyRoundBudget(config) + 1;
	for (let iteration = 0; iteration < hardBound; iteration++) {
		const proposal = await deps.propose(question, rounds);
		const reviewerOpinion = proposal.resolved ? null : await deps.review(question, proposal.proposal);
		rounds.push({
			proposal: proposal.proposal,
			reviewerOpinion,
			selfReportedProgress: proposal.selfReportedProgress,
			resolved: proposal.resolved,
		});
		const decision = decideAutoClarifyStep(rounds, config, deps.similarity);
		if (decision.action !== "keep_asking") {
			return { question: applyAutoClarifyDecision(question, decision), rounds, decision };
		}
	}
	const fallback: AutoClarifyDecision = {
		action: "give_up_with_assumption",
		assumption: rounds[rounds.length - 1]?.proposal.trim() ?? "",
		reason: "Auto-clarify hit its hard iteration bound; proceeding on the latest assumption.",
	};
	return { question: applyAutoClarifyDecision(question, fallback), rounds, decision: fallback };
}
