/**
 * F12.54 risk-aware review routing — PURE core.
 *
 * AI-authored changes carry ~1.7× more defects, and past ~400 added lines a review degrades into rubber-stamping.
 * This classifier turns the diff itself into a review DIRECTIVE: high-risk surface (auth/security, API contracts,
 * migrations, CI/build config) → deep review with an explicit "state a failure mode before approving" demand;
 * docs/tests-only → fast-track (spend the attention where it pays); oversized → a fatigue warning with a split hint.
 * Pure + deterministic over the unified diff text; the reviewer prompt seam consumes the directive verbatim.
 */

export type ReviewRiskTier = "deep_review" | "standard" | "fast_track";

export interface DiffReviewRisk {
	readonly tier: ReviewRiskTier;
	readonly addedLines: number;
	readonly files: readonly string[];
	/** Which high-risk categories matched, with the file that triggered each (dedup by category). */
	readonly riskSignals: readonly { category: string; file: string }[];
	/** Past the fatigue threshold — reviews of this size degrade into rubber-stamping. */
	readonly oversized: boolean;
	/** The prompt-ready directive block ("" when nothing to say beyond the standard review). */
	readonly directive: string;
}

/** Added-line count past which review quality measurably degrades (atomicrobot ai-review-fatigue). */
export const REVIEW_FATIGUE_ADDED_LINES = 400;

const HIGH_RISK_PATH_PATTERNS: readonly { category: string; pattern: RegExp }[] = [
	{
		// Short/ambiguous tokens are segment-anchored (review-found: bare `auth` matched "authors", `acl` matched
		// "oracle" — deep-review on ordinary files is exactly the cry-wolf this classifier exists to prevent).
		category: "auth/security",
		pattern:
			/(?:^|[/_.-])auth(?:[/_.-]|$)|authent|authoriz|security|crypt|token|password|secret|credential|session|permission|(?:^|[/_.-])acl(?:[/_.-]|$)|sandbox|egress/i,
	},
	{ category: "API contract", pattern: /api-contract|contract|schema|router|openapi|proto\b/i },
	{ category: "data migration", pattern: /migration|migrate/i },
	{
		category: "build/CI config",
		pattern: /dockerfile|docker-compose|\.github\/|ci\.|pipeline|\.ya?ml$|package\.json$|tsconfig/i,
	},
];

const FAST_TRACK_PATH = /(^|\/)(docs?|documentation)\/|\.mdx?$|(^|\/)tests?\/|\.test\.|\.spec\.|__tests__|fixtures?\//i;

/** File paths a unified diff touches (from `+++ b/…` headers; `/dev/null` deletions excluded). */
export function diffTouchedFiles(diff: string): string[] {
	const files: string[] = [];
	for (const line of diff.split("\n")) {
		const match = line.match(/^\+\+\+ (?:b\/)?(.+)$/);
		if (match?.[1] && match[1] !== "/dev/null") {
			files.push(match[1].trim());
		}
	}
	return files;
}

/** Classify a worker diff for review routing. Empty diff → standard (the no-op review flow owns that case). */
export function classifyDiffReviewRisk(diff: string): DiffReviewRisk {
	const files = diffTouchedFiles(diff);
	const addedLines = diff.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
	const riskSignals: { category: string; file: string }[] = [];
	for (const { category, pattern } of HIGH_RISK_PATH_PATTERNS) {
		const hit = files.find((file) => pattern.test(file));
		if (hit) {
			riskSignals.push({ category, file: hit });
		}
	}
	const allFastTrack = files.length > 0 && files.every((file) => FAST_TRACK_PATH.test(file));
	const tier: ReviewRiskTier = riskSignals.length > 0 ? "deep_review" : allFastTrack ? "fast_track" : "standard";
	const oversized = addedLines > REVIEW_FATIGUE_ADDED_LINES;

	const directiveLines: string[] = [];
	if (tier === "deep_review") {
		directiveLines.push(
			`This diff touches HIGH-RISK surface: ${riskSignals.map((signal) => `${signal.category} (${signal.file})`).join("; ")}.`,
			"Review DEEPLY, not a once-over. Before you may `approve`, explicitly state the most plausible failure mode of this change and why it does not apply — an approval without a stated failure mode is not acceptable for this diff.",
		);
	} else if (tier === "fast_track") {
		directiveLines.push(
			"This diff touches only docs/tests. Fast-track it: verify the claims match reality (a doc that lies is a defect; a test that can't fail is a defect) — skip the deep architectural pass.",
		);
	}
	if (oversized) {
		directiveLines.push(
			`FATIGUE WARNING: ${addedLines} added lines (past the ~${REVIEW_FATIGUE_ADDED_LINES}-line threshold where review degrades into rubber-stamping). Do NOT skim-approve: either review it in passes (by file group), or if it bundles separable concerns, \`request_changes\` asking the worker to split the delivery.`,
		);
	}
	return {
		tier,
		addedLines,
		files,
		riskSignals,
		oversized,
		directive: directiveLines.join("\n"),
	};
}
