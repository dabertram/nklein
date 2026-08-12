/**
 * Review-driven re-decompose rung — PURE core (David 2026-08-12).
 *
 * WHAT: when the review loop PARKS a worker card (the whole remedy ladder failed), decide whether to spawn ONE
 * follow-up decompose card that splits the objective into smaller children, and build that card's prompt so the
 * architect decomposes IN FULL SITUATION — the plan's original objective, the surrounding cards and their lanes,
 * every distinct reviewer concern, the attempt evidence, and the acceptance bar — never the card text in a vacuum.
 * Decomposing blind to the situation is exactly how children drift from the initial main target.
 *
 * WHY a decision core: the previous rung fired only when a card had SPENT its one diverse-worker escalation —
 * on a single-model rig there is no escalation candidate, cards park directly, and the rung silently never fired
 * (live-observed on the resume-02 board 2026-08-12: seven review-lane cards parked with the rung dark). The rule
 * belongs in a pure, tested function: spawn when the ladder is exhausted — escalation spent OR never available —
 * bounded by a generation cap so a stubborn objective fragments at most twice and then genuinely parks for a human.
 *
 * The parent card is NOT abandoned: the decompose apply converts it into an integration card gated on the children
 * (see `applyNKleinPlanTaskGraphToBoard`), so its downstream dependents stay correctly dammed until the children
 * actually deliver, then flow again. {@link buildIntegrationParentPrompt} writes that converted card's objective.
 *
 * PURE / TOTAL / DETERMINISTIC: no I/O, no clock, no board types — plain values in, verdict/prompt out.
 */

import type { ReviewRoundRecord } from "./review-loop.js";
import type { PriorReviewConcern, ReviewBoardContext } from "./review-orchestration.js";

/**
 * Maximum review-driven decompose GENERATIONS above a card before the rung stops spawning (2 = an original card
 * may split, and one of its children may split once more). A card that still parks after two decompose generations
 * has refuted "too big" as its failure mode — thinner slices are not the remedy, a human is.
 */
export const REVIEW_REDECOMPOSE_GENERATION_CAP = 2;

export type ReviewParkKind = "review_stuck" | "no_verdict";

export interface ReviewRedecomposeDecisionInput {
	/**
	 * Which park fired. Only a `review_stuck` park (the worker could not satisfy review) is evidence the card is
	 * too big; a `no_verdict` park is the REVIEWER failing to judge — decomposing the work would remedy the wrong
	 * agent.
	 */
	parkKind: ReviewParkKind;
	/** The card's one diverse-worker escalation already fired (persisted flag or this park's own review state). */
	escalationSpent: boolean;
	/** A diverse/stronger escalation worker existed for this card at park time. */
	escalationAvailable: boolean;
	/** Review-driven decompose generations already above this card (`card.decomposeGeneration`, 0 when absent). */
	parentGeneration: number;
}

export interface ReviewRedecomposeDecision {
	spawn: boolean;
	reason: string;
}

/**
 * Spawn the re-decompose card iff the remedy ladder is exhausted: the escalation rung was SPENT (historical rule),
 * or it was never available at all (single-model rig — bounce→park is the whole ladder there), always bounded by
 * the generation cap. A park with an UNSPENT but available escalation never reaches here in practice (the loop
 * escalates instead of parking), but if it does, parking stands — the ladder was not exhausted.
 */
export function decideReviewRedecompose(input: ReviewRedecomposeDecisionInput): ReviewRedecomposeDecision {
	if (input.parkKind !== "review_stuck") {
		return {
			spawn: false,
			reason:
				"The park is a reviewer no-verdict failure, not worker-stuck evidence — decomposing the work would remedy the wrong agent.",
		};
	}
	if (input.parentGeneration >= REVIEW_REDECOMPOSE_GENERATION_CAP) {
		return {
			spawn: false,
			reason: `Generation cap reached (${input.parentGeneration}/${REVIEW_REDECOMPOSE_GENERATION_CAP} review-driven decompose generations) — thinner slices are refuted as the remedy; the park stands for a human.`,
		};
	}
	if (input.escalationSpent) {
		return {
			spawn: true,
			reason:
				"The full ladder failed (bounce → diverse escalation → park) — proven can't-handle-as-one-unit; splitting the objective.",
		};
	}
	if (!input.escalationAvailable) {
		return {
			spawn: true,
			reason:
				"The ladder is exhausted without an escalation rung (no diverse/stronger worker exists on this rig) — decompose is the only machine remedy left before a human.",
		};
	}
	return {
		spawn: false,
		reason:
			"An untried escalation worker still exists — the ladder is not exhausted, so the park stands (the loop normally escalates before parking; reaching here is unusual).",
	};
}

/**
 * Compact evidence line about what the attempts actually produced, from the persisted round records — the
 * architect should know whether the workers delivered wrong things or NOTHING (the two call for different splits:
 * mis-scoped children vs smaller first bites).
 */
export function summarizeReviewAttemptEvidence(history: readonly ReviewRoundRecord[]): string | null {
	const changeRequests = history.filter((record) => record.verdict === "request_changes");
	if (changeRequests.length === 0) {
		return null;
	}
	let stalledRounds = 0;
	for (let index = 1; index < history.length; index += 1) {
		const previous = history[index - 1];
		const current = history[index];
		if (
			previous?.workFingerprint != null &&
			current?.workFingerprint != null &&
			previous.workFingerprint === current.workFingerprint
		) {
			stalledRounds += 1;
		}
	}
	const parts = [`${changeRequests.length} review round(s) requested changes`];
	if (stalledRounds > 0) {
		parts.push(`${stalledRounds} round(s) re-reviewed IDENTICAL work (the worker produced no new edits)`);
	}
	return `${parts.join("; ")}.`;
}

const REDECOMPOSE_OBJECTIVE_BUDGET = 3_000;
const REDECOMPOSE_PLAN_OBJECTIVE_BUDGET = 1_500;
const REDECOMPOSE_CONCERN_LIMIT = 6;

function clamp(text: string, budget: number): string {
	const trimmed = text.trim();
	return trimmed.length <= budget ? trimmed : `${trimmed.slice(0, budget)}…`;
}

function formatSituationCards(label: string, cards: { title: string; column: string }[] | undefined): string[] {
	if (!cards || cards.length === 0) {
		return [];
	}
	return [label, ...cards.map((card) => `- ${card.title} [${card.column}]`)];
}

export interface RedecomposeCardPromptInput {
	/** The parked card's title + objective — the thing being split. */
	taskTitle: string;
	taskObjective: string;
	/**
	 * The card's place in the wider board: the plan objective (the INITIAL MAIN TARGET the children must keep
	 * serving), prerequisites, dependents, and siblings with their lanes — the "full surrounding tasks, spec,
	 * status" the decomposition must take into account.
	 */
	boardContext?: ReviewBoardContext | null;
	/** Every distinct reviewer concern across the rounds (from `collectPriorReviewConcerns` + the final round). */
	reviewerConcerns?: readonly PriorReviewConcern[];
	/** Compact attempt evidence (from {@link summarizeReviewAttemptEvidence}). */
	attemptEvidence?: string | null;
	/** The acceptance bar the parent must ultimately pass (the children inherit its spirit). */
	acceptanceSummary?: string | null;
	/** The generation the CHILDREN will carry (parent's + 1), stated so the architect knows the budget. */
	generation: number;
}

/**
 * The re-decompose card's seed prompt: split a proven-too-big card into smaller children WITHOUT drifting from
 * the initial main target. Every contextual fact the architect needs is IN the prompt — plan objective, siblings
 * and their lanes, dependency neighbors, reviewer concerns, attempt evidence, acceptance bar — because a planning
 * session has no other window into the situation, and a context-free split is how drift happens.
 */
export function buildRedecomposeCardPrompt(input: RedecomposeCardPromptInput): string {
	const lines: string[] = [
		`The card "${input.taskTitle}" proved too hard as ONE unit — the review ladder (worker rounds${input.attemptEvidence ? ", " : ""}${input.attemptEvidence ? "see evidence below" : "and any escalation"}) failed to complete it. Split its objective into SMALLER, independently-verifiable cards using the decompose_project tool. Do NOT implement anything yourself.`,
		"",
		"## The objective to split (verbatim — the union of your child cards must cover ALL of it)",
		clamp(input.taskObjective, REDECOMPOSE_OBJECTIVE_BUDGET),
	];
	const planObjective = input.boardContext?.planObjective?.trim();
	if (planObjective) {
		lines.push(
			"",
			"## The plan's original objective (the initial main target — every child must still serve THIS)",
			clamp(planObjective, REDECOMPOSE_PLAN_OBJECTIVE_BUDGET),
		);
	}
	const situation = [
		...formatSituationCards(
			"Prerequisites this card builds on (already-scoped upstream work — do not re-plan it):",
			input.boardContext?.dependsOn,
		),
		...formatSituationCards(
			"Downstream cards that will build on this result (your children must produce what these need):",
			input.boardContext?.dependedOnBy,
		),
		...formatSituationCards(
			"Sibling cards in the same plan (do NOT duplicate their scope — stay inside this card's share):",
			input.boardContext?.siblings,
		),
	];
	if (situation.length > 0) {
		lines.push("", "## The surrounding board (the situation your split must fit into)", ...situation);
	}
	const concerns = (input.reviewerConcerns ?? []).slice(-REDECOMPOSE_CONCERN_LIMIT);
	if (concerns.length > 0) {
		lines.push(
			"",
			"## What reviewers rejected across the attempts (your child cards must explicitly cover/resolve these)",
			...concerns.map(
				(concern) =>
					`- (round ${concern.round}${concern.timesRaised > 1 ? `, raised ${concern.timesRaised}×` : ""}) ${concern.feedback}`,
			),
		);
	}
	if (input.attemptEvidence?.trim()) {
		lines.push("", "## Attempt evidence", input.attemptEvidence.trim());
	}
	if (input.acceptanceSummary?.trim()) {
		lines.push(
			"",
			"## The acceptance bar the parent card must ultimately pass",
			input.acceptanceSummary.trim(),
			"The parent becomes an integration card gated on your children — after they all complete, it verifies the union against this bar. Children should carry their OWN narrower acceptance checks that build toward it.",
		);
	}
	lines.push(
		"",
		"## Requirements for the split",
		"- 2–5 child cards, each a SINGLE concern a weak model can finish in one focused session (prefer one file / one seam per card).",
		"- Each card's description must name WHICH PART of the objective above it delivers — a card whose contribution you cannot name is drift; cut it.",
		"- The union of the children must cover the WHOLE objective — dropping scope to make cards easy is failure, not decomposition.",
		"- Declare tight file scopes (filesLikelyTouched / writeScope) and add dependency edges wherever one card's output feeds another (missing edges cause parallel cards to fight or build on nothing).",
		"- Give every card an objective, machine-runnable acceptance check.",
		`- This is decompose generation ${input.generation} of ${REVIEW_REDECOMPOSE_GENERATION_CAP} — there is ${input.generation >= REVIEW_REDECOMPOSE_GENERATION_CAP ? "NO further split after this one" : "at most one further split after this one"}; size the cards so they genuinely land.`,
	);
	return lines.join("\n");
}

export interface IntegrationParentPromptInput {
	/** The parent card's ORIGINAL objective (preserved verbatim inside the converted prompt). */
	originalObjective: string;
	/** Titles of the child cards that now carry the implementation. */
	childTitles: readonly string[];
}

/** First line of a converted parent's prompt — the plan-apply idempotency check keys on it (never re-wrap). */
export const INTEGRATION_PARENT_PROMPT_MARKER = "INTEGRATION CARD";

/**
 * The converted PARENT card's objective after a re-decompose: it no longer implements — it integrates. It waits
 * (via dependency edges) for every child, then verifies the union against the ORIGINAL objective and acceptance
 * check, closing small gaps directly. Keeping the parent alive this way is what keeps its downstream dependents
 * correctly gated until the split work actually delivers.
 */
export function buildIntegrationParentPrompt(input: IntegrationParentPromptInput): string {
	return [
		`${INTEGRATION_PARENT_PROMPT_MARKER} (converted after a review-driven decomposition — the implementation was split into the cards listed below; this card completes when their union genuinely satisfies the original objective).`,
		"",
		"## Your job",
		"1. Verify each child card's work landed and fits together (read the code, run the checks — do not take completion claims on faith).",
		"2. Run this card's acceptance check against the COMBINED result.",
		"3. Close small integration gaps directly (wiring, imports, naming drift between children). If a whole child's scope is missing or wrong, request changes via your final message instead of silently re-implementing it.",
		"",
		"## The implementation cards this depends on",
		...input.childTitles.map((title) => `- ${title}`),
		"",
		"## The ORIGINAL objective (unchanged — the union must satisfy this)",
		input.originalObjective.trim(),
	].join("\n");
}
