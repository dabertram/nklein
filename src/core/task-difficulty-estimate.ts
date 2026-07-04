/**
 * §5.AB task-difficulty estimate (pure) — score how hard a card is, so automatic role→model selection can match it to
 * a fitting model (easy cards take the fast/small model; hard cards take the most-capable free model that fits the
 * ≥32k budget). One of the five §5.AB inputs, alongside `explainModelSelection` ({@link ./model-selection-reason}).
 *
 * The signals (from the card + its attempt history, all cheap to compute): the objective TEXT (a longer, denser spec
 * is harder), the expected FILE/CONTEXT footprint (a multi-file change is harder than a one-file tweak), the ACCEPTANCE
 * shape (a test-backed card is more rigorous), and — the strongest escalation signal — the BOUNCE history (a card that
 * already failed review needs a more capable model, not a retry on the same tier). When the decomposition authored an
 * explicit complexity (0-100), that is used as the intrinsic prior; else it's derived from the text/file/acceptance
 * signals. Bounces then escalate on top. Pure + total + deterministic.
 */

export interface TaskDifficultyInput {
	/** The card's objective / prompt text. */
	objectiveText: string;
	/** How many files the card is expected to touch (e.g. `filesLikelyTouched.length`). */
	expectedFileCount: number;
	/** Whether the card carries a non-trivial acceptance shape (a test command and/or an acceptance-test prompt). */
	hasAcceptanceTests: boolean;
	/** How many times this card has already BOUNCED (failed review / been re-driven). Negative treated as 0. */
	bounceCount: number;
	/** Optional authored complexity (0-100) from the decomposition — the intrinsic prior when present. */
	authoredComplexity?: number | null;
}

export type TaskDifficultyTier = "easy" | "medium" | "hard";

export interface TaskDifficultyEstimate {
	/** Normalized difficulty in [0, 1]. */
	score: number;
	/** Coarse tier for routing: easy → fast/small model; hard → most-capable free model that fits the budget. */
	tier: TaskDifficultyTier;
	/** Human-readable factors that drove the score (feeds §5.AB inspectable selection reasoning). */
	reasons: string[];
}

/** Clamp a number into [0, 1]; non-finite → 0 (fail-safe toward "easy" rather than a garbage escalation). */
function clamp01(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.min(1, Math.max(0, value));
}

/** Estimate a card's difficulty from its cheap signals (pure). */
export function estimateTaskDifficulty(input: TaskDifficultyInput): TaskDifficultyEstimate {
	const reasons: string[] = [];

	const wordCount = input.objectiveText.trim().split(/\s+/u).filter(Boolean).length;
	const textFactor = Math.min(1, wordCount / 180); // ~180 words ⇒ a meaty spec
	const expectedFiles = Math.max(0, input.expectedFileCount);
	const fileFactor = Math.min(1, expectedFiles / 6); // touching ~6 files ⇒ a broad change
	const acceptanceFactor = input.hasAcceptanceTests ? 1 : 0;

	// The decomposition's authored complexity (0-100), when present, is the strongest single intrinsic prior.
	const authored = typeof input.authoredComplexity === "number" ? clamp01(input.authoredComplexity / 100) : null;
	const intrinsic = authored ?? clamp01(0.5 * textFactor + 0.35 * fileFactor + 0.15 * acceptanceFactor);
	if (authored !== null) {
		reasons.push(`authored complexity ${Math.round(authored * 100)}/100`);
	} else {
		reasons.push(
			`${wordCount}-word objective, ~${expectedFiles} file(s)${input.hasAcceptanceTests ? ", test-backed" : ""}`,
		);
	}

	// Each bounce is a HARD escalation signal — a card that failed review must move up a tier, not retry the same one.
	const bounces = Math.max(0, input.bounceCount);
	const bounceEscalation = Math.min(0.45, bounces * 0.22);
	if (bounces > 0) {
		reasons.push(`bounced ${bounces}×  → escalate (${Math.round(bounceEscalation * 100)} pts)`);
	}

	const score = clamp01(intrinsic + bounceEscalation);
	const tier: TaskDifficultyTier = score >= 0.66 ? "hard" : score >= 0.33 ? "medium" : "easy";
	return { score, tier, reasons };
}
