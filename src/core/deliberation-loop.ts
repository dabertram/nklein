/**
 * §5.AW deliberation core (audit 2026-07-02 W4.1) — a bounded, decision-agnostic PROPOSE → CRITIQUE → RESOLVE loop
 * for reaching deeper decisions on HARD/AMBIGUOUS choices, generalized from the proven auto-clarify shape (§5.S —
 * the same bounded ping-pong + stall detector, decision-agnostic and with a deliberation-sized round budget).
 *
 * The value comes from an UNCORRELATED critic: the wiring assigns the critique to a different model LINEAGE than
 * the proposer (§5.AB reasoning-diversity; `applyDiversityPreference`), and research (docs/dev/research-2026-07-02.md)
 * fixes the aggregation rules: the RESOLVER picks/decides — never consensus/majority, never "do you agree?" prompts —
 * and participants get assigned STANCES rather than N copies of the same question. When no diverse critic is loaded,
 * callers degrade to single-agent + a surfaced waiver via {@link shouldDeliberate} instead of faking a debate.
 *
 * Pure + dependency-injected (model turns and the similarity embedder come from the wiring), mirroring auto-clarify.
 * Every run yields a {@link DeliberationRecord} for the ledger, so §5.AB can learn which model×lineage×decisionKind
 * combinations actually decide well.
 */

export interface DeliberationRound {
	/** The proposer's (possibly refined) position this round. */
	proposal: string;
	/** The diverse critic's critique of a non-final proposal; null when the proposal resolved immediately. */
	critique: string | null;
	/** Proposer self-check: did this round meaningfully advance the decision? */
	selfReportedProgress: boolean;
	/** True when the proposer declared a final, confident resolution (ends the loop). */
	resolved: boolean;
}

export interface DeliberationConfig {
	/** Hard round cap — deliberations are SHORT by design (default 3; contrast auto-clarify's generous 30). */
	maxRounds: number;
	/** Two consecutive proposals at/above this similarity (0..1) count as "no progress". */
	noProgressSimilarityThreshold: number;
	/** Don't run the stall check until at least this many rounds have happened. */
	minRoundsBeforeStallCheck: number;
}

export const DEFAULT_DELIBERATION_CONFIG: DeliberationConfig = {
	maxRounds: 3,
	noProgressSimilarityThreshold: 0.92,
	minRoundsBeforeStallCheck: 2,
};

export type DeliberationOutcome =
	| { action: "resolved"; resolution: string; reason: string }
	/**
	 * The loop ended without a confident resolution. The CALLER maps this by reversibility (DECIDED 2026-07-02):
	 * park-for-human when the decision is IRREVERSIBLE; proceed on `bestProposal` + surface the flag when reversible.
	 */
	| { action: "unresolved"; bestProposal: string; reason: string };

/** Cosine-style text similarity in [0,1]; injected so the core stays pure. */
export type DeliberationSimilarity = (a: string, b: string) => number;

export interface DeliberationParticipant {
	role: "proposer" | "critic" | "resolver";
	modelId: string;
	lineage: string;
}

/** The persisted evidence of one deliberation (→ the §5.AF ledger + a compact board badge). */
export interface DeliberationRecord {
	/** What KIND of decision this was (decompose_plan | review_conflict | architecture_fork | …). */
	decisionKind: string;
	shape: "propose_critique";
	participants: readonly DeliberationParticipant[];
	/** Was the critic actually lineage-diverse from the proposer? (Waivers are surfaced, never silent.) */
	diversityAchieved: boolean;
	diversityWaivedReason: string | null;
	rounds: number;
	resolution: string | null;
	rationale: string;
}

export interface DeliberationDeps {
	/** Propose (round 0) or refine (later rounds, seeing the critique history) the position. A real model turn. */
	propose: (
		subject: string,
		rounds: readonly DeliberationRound[],
	) => Promise<{
		proposal: string;
		resolved: boolean;
		selfReportedProgress: boolean;
	}>;
	/** The DIVERSE-lineage critique of a non-final proposal (assigned stance, e.g. risk-first). Null = no critique. */
	critique: (subject: string, proposal: string) => Promise<string | null>;
	similarity: DeliberationSimilarity;
}

export interface DeliberationResult {
	outcome: DeliberationOutcome;
	rounds: DeliberationRound[];
}

/**
 * Drive one bounded propose→critique→refine deliberation. A confident proposal resolves immediately (skipping the
 * critic); otherwise the critic weighs in and the loop continues while progressing. The round budget and the
 * converged-and-not-progressing stall detector force an `unresolved` outcome (never an exception, never unbounded).
 */
export async function runDeliberationLoop(
	subject: string,
	deps: DeliberationDeps,
	config: DeliberationConfig = DEFAULT_DELIBERATION_CONFIG,
): Promise<DeliberationResult> {
	const maxRounds = Math.max(1, Math.trunc(config.maxRounds));
	const rounds: DeliberationRound[] = [];
	for (let iteration = 0; iteration < maxRounds; iteration++) {
		const proposal = await deps.propose(subject, rounds);
		const critique = proposal.resolved ? null : await deps.critique(subject, proposal.proposal);
		rounds.push({
			proposal: proposal.proposal,
			critique,
			selfReportedProgress: proposal.selfReportedProgress,
			resolved: proposal.resolved,
		});
		if (proposal.resolved && proposal.proposal.trim().length > 0) {
			return {
				outcome: {
					action: "resolved",
					resolution: proposal.proposal.trim(),
					reason: "Proposer reached a confident resolution.",
				},
				rounds,
			};
		}
		if (rounds.length >= Math.max(2, config.minRoundsBeforeStallCheck)) {
			const previous = rounds[rounds.length - 2];
			const converged = deps.similarity(rounds[rounds.length - 1].proposal, previous.proposal);
			if (converged >= config.noProgressSimilarityThreshold && !proposal.selfReportedProgress) {
				return {
					outcome: {
						action: "unresolved",
						bestProposal: proposal.proposal.trim(),
						reason: `No progress: consecutive proposals converged (similarity ${converged.toFixed(2)}) without self-reported progress.`,
					},
					rounds,
				};
			}
		}
	}
	return {
		outcome: {
			action: "unresolved",
			bestProposal: rounds[rounds.length - 1]?.proposal.trim() ?? "",
			reason: `Reached the ${maxRounds}-round deliberation budget without a confident resolution.`,
		},
		rounds,
	};
}

/** Build the ledger-facing record for a finished deliberation. Pure. */
export function buildDeliberationRecord(input: {
	decisionKind: string;
	participants: readonly DeliberationParticipant[];
	diversityAchieved: boolean;
	diversityWaivedReason?: string | null;
	result: DeliberationResult;
}): DeliberationRecord {
	return {
		decisionKind: input.decisionKind,
		shape: "propose_critique",
		participants: input.participants,
		diversityAchieved: input.diversityAchieved,
		diversityWaivedReason: input.diversityWaivedReason ?? null,
		rounds: input.result.rounds.length,
		resolution: input.result.outcome.action === "resolved" ? input.result.outcome.resolution : null,
		rationale: input.result.outcome.reason,
	};
}
