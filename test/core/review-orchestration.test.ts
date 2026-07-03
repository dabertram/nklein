import { describe, expect, it } from "vitest";
import { REVIEW_LENSES } from "../../src/core/review-lenses";
import type { ReviewRoundRecord } from "../../src/core/review-loop";
import {
	buildReviewBouncePrompt,
	buildReviewSeedPrompt,
	buildReviewSignOff,
	fingerprintReviewArtifact,
	resolveReviewTransition,
	shouldReviewCard,
} from "../../src/core/review-orchestration";

describe("fingerprintReviewArtifact", () => {
	it("is stable for the same trimmed content and null for empty", () => {
		expect(fingerprintReviewArtifact("  diff body  ")).toBe(fingerprintReviewArtifact("diff body"));
		expect(fingerprintReviewArtifact("")).toBeNull();
		expect(fingerprintReviewArtifact("   ")).toBeNull();
		expect(fingerprintReviewArtifact(null)).toBeNull();
		expect(fingerprintReviewArtifact(undefined)).toBeNull();
	});

	it("differs for different content", () => {
		expect(fingerprintReviewArtifact("a")).not.toBe(fingerprintReviewArtifact("b"));
	});
});

describe("shouldReviewCard", () => {
	const base = {
		enabled: true,
		columnId: "review",
		isReviewerCard: false,
		isPlanningCard: false,
	};

	it("reviews a worker card in review (including a no-change result)", () => {
		expect(shouldReviewCard(base)).toBe(true);
	});

	it("skips when disabled, not in review, a reviewer card, or a planning card", () => {
		expect(shouldReviewCard({ ...base, enabled: false })).toBe(false);
		expect(shouldReviewCard({ ...base, columnId: "in_progress" })).toBe(false);
		expect(shouldReviewCard({ ...base, isReviewerCard: true })).toBe(false);
		expect(shouldReviewCard({ ...base, isPlanningCard: true })).toBe(false);
	});
});

describe("buildReviewSeedPrompt", () => {
	it("includes the objective, diff, and a single submit_review instruction", () => {
		const prompt = buildReviewSeedPrompt({
			taskTitle: "Add login",
			taskObjective: "Implement email/password login.",
			diff: "diff --git a/login.ts b/login.ts",
			round: 1,
		});
		expect(prompt).toContain('card "Add login"');
		expect(prompt).toContain("review round 1");
		expect(prompt).toContain("Implement email/password login.");
		expect(prompt).toContain("diff --git a/login.ts");
		expect(prompt).toContain("submit_review");
	});

	it("§5.AW: renders an A/B arbitration seed when a speculative diff is present", () => {
		const prompt = buildReviewSeedPrompt({
			taskTitle: "Add login",
			taskObjective: "Implement email/password login.",
			diff: "diff --git a/login.ts b/login.ts",
			speculativeDiff: "diff --git a/login-alt.ts b/login-alt.ts",
			round: 1,
		});
		expect(prompt).toContain("Candidate A — primary");
		expect(prompt).toContain("Candidate B — speculative");
		expect(prompt).toContain("diff --git a/login.ts");
		expect(prompt).toContain("diff --git a/login-alt.ts");
		expect(prompt).toContain("`preferred`");
		expect(prompt).not.toContain("## Diff under review");
	});

	it("§5.AW: an empty/whitespace speculative diff falls back to the ordinary single-diff seed", () => {
		const prompt = buildReviewSeedPrompt({
			taskTitle: "Add login",
			taskObjective: "Implement email/password login.",
			diff: "diff --git a/login.ts b/login.ts",
			speculativeDiff: "   ",
			round: 1,
		});
		expect(prompt).toContain("## Diff under review");
		expect(prompt).not.toContain("Candidate B");
	});

	it("§5.AW: both A/B candidates share the single-diff budget (each clamped to half)", () => {
		const bigA = `A${"a".repeat(30_000)}`;
		const bigB = `B${"b".repeat(30_000)}`;
		const prompt = buildReviewSeedPrompt({
			taskTitle: "T",
			taskObjective: "O",
			diff: bigA,
			speculativeDiff: bigB,
			round: 1,
		});
		expect(prompt).toContain("… diff truncated");
		// Each candidate is clamped to 12k, so neither full 30k body may appear.
		expect(prompt).not.toContain(bigA);
		expect(prompt).not.toContain(bigB);
	});

	it("includes the acceptance summary and prior feedback when provided", () => {
		const prompt = buildReviewSeedPrompt({
			taskTitle: "T",
			taskObjective: "obj",
			diff: "d",
			round: 2,
			acceptanceSummary: "Acceptance check passed: npm test.",
			priorFeedback: "Handle the empty-password case.",
		});
		expect(prompt).toContain("Acceptance check passed: npm test.");
		expect(prompt).toContain("Handle the empty-password case.");
		expect(prompt).toContain("previous change request");
	});

	it("truncates an oversized diff with a marker", () => {
		const huge = "x".repeat(40_000);
		const prompt = buildReviewSeedPrompt({ taskTitle: "T", taskObjective: "o", diff: huge, round: 1 });
		expect(prompt).toContain("diff truncated");
		expect(prompt.length).toBeLessThan(huge.length);
	});

	it("surfaces the worker's reasoning and the board/plan context", () => {
		const prompt = buildReviewSeedPrompt({
			taskTitle: "Parse goals",
			taskObjective: "Parse --goal flags.",
			diff: "diff --git a/x b/x",
			round: 1,
			workerReasoning: "I added a parser and chose to ignore empty flags because the spec implies it.",
			boardContext: {
				planObjective: "Build the habit insights CLI.",
				dependsOn: [{ title: "Define domain model", column: "completed" }],
				dependedOnBy: [{ title: "Integrate goals into insights", column: "in_progress" }],
				siblings: [{ title: "Classify trends", column: "review" }],
			},
		});
		expect(prompt).toContain("Worker's reasoning");
		expect(prompt).toContain("ignore empty flags");
		expect(prompt).toContain("Plan objective");
		expect(prompt).toContain("Build the habit insights CLI.");
		expect(prompt).toContain("Depends on");
		expect(prompt).toContain("Define domain model [completed]");
		expect(prompt).toContain("Depended on by");
		expect(prompt).toContain("Sibling cards");
		expect(prompt).toContain("Classify trends [review]");
	});

	it("includes the worker's focus chain so the reviewer can judge whether the plan was followed", () => {
		const prompt = buildReviewSeedPrompt({
			taskTitle: "T",
			taskObjective: "obj",
			diff: "d",
			round: 1,
			focusChain: "Focus chain (1/2 done):\n- [x] Write the parser\n- [ ] Add tests",
		});
		expect(prompt).toContain("Worker's focus chain");
		expect(prompt).toContain("followed and completed its own plan");
		expect(prompt).toContain("Write the parser");
	});

	it("§5.AW: renders a lens section listing each assigned lens stance when lenses are provided", () => {
		const lenses = [REVIEW_LENSES[0], REVIEW_LENSES[4]];
		const prompt = buildReviewSeedPrompt({
			taskTitle: "Add login",
			taskObjective: "Implement email/password login.",
			diff: "diff --git a/login.ts b/login.ts",
			round: 1,
			lenses,
		});
		expect(prompt).toContain("Review specifically through these lenses");
		// Both assigned lens stance strings appear verbatim (spec_fit + security).
		expect(prompt).toContain(REVIEW_LENSES[0].stance);
		expect(prompt).toContain(REVIEW_LENSES[4].stance);
	});

	it("§5.AW: omits the lens section (byte-identical) when lenses are absent or empty", () => {
		const base = {
			taskTitle: "Add login",
			taskObjective: "Implement email/password login.",
			diff: "diff --git a/login.ts b/login.ts",
			round: 1,
		} as const;
		const noLenses = buildReviewSeedPrompt(base);
		const emptyLenses = buildReviewSeedPrompt({ ...base, lenses: [] });
		// The default (no lenses) and an explicit empty panel both produce the un-lensed prompt, unchanged.
		expect(noLenses).not.toContain("Review specifically through these lenses");
		expect(emptyLenses).toBe(noLenses);
	});
});

describe("buildReviewBouncePrompt / buildReviewSignOff", () => {
	it("carries the feedback into the worker prompt", () => {
		const prompt = buildReviewBouncePrompt({ round: 1, summary: "Looks close", feedback: "Add a test." });
		expect(prompt).toContain("review round 1");
		expect(prompt).toContain("Looks close");
		expect(prompt).toContain("Add a test.");
	});

	it("appends an insight to the sign-off only when present", () => {
		expect(buildReviewSignOff({ summary: "LGTM", insight: null })).toBe("LGTM");
		expect(buildReviewSignOff({ summary: "LGTM", insight: "Nice use of types" })).toContain(
			"Insight: Nice use of types",
		);
	});
});

describe("resolveReviewTransition", () => {
	it("delivers on approve with a sign-off and an approval record", () => {
		const transition = resolveReviewTransition({
			submission: { verdict: "approve", summary: "Solid work", feedback: null, insight: "Clean tests" },
			round: 1,
			workFingerprint: "work-1",
			history: [],
		});
		expect(transition.action).toBe("deliver");
		if (transition.action === "deliver") {
			expect(transition.signOff).toContain("Solid work");
			expect(transition.signOff).toContain("Clean tests");
			expect(transition.record).toEqual({
				round: 1,
				verdict: "approve",
				feedbackFingerprint: null,
				workFingerprint: "work-1",
			});
		}
	});

	it("bounces on request_changes within budget, carrying the feedback", () => {
		const transition = resolveReviewTransition({
			submission: { verdict: "request_changes", summary: "Almost", feedback: "Validate input", insight: null },
			round: 1,
			workFingerprint: "work-1",
			history: [],
		});
		expect(transition.action).toBe("bounce_to_worker");
		if (transition.action === "bounce_to_worker") {
			expect(transition.workerPrompt).toContain("Validate input");
			expect(transition.record.feedbackFingerprint).toBe(fingerprintReviewArtifact("Validate input"));
			expect(transition.record.workFingerprint).toBe("work-1");
		}
	});

	it("parks on a stall (unchanged work since the previous round)", () => {
		const history: ReviewRoundRecord[] = [
			{ round: 1, verdict: "request_changes", feedbackFingerprint: "f1", workFingerprint: "work-1" },
		];
		const transition = resolveReviewTransition({
			submission: { verdict: "request_changes", summary: "Still", feedback: "Different ask", insight: null },
			round: 2,
			workFingerprint: "work-1",
			history,
		});
		expect(transition.action).toBe("park");
	});

	it("parks on an identical loop (same feedback on same unchanged work)", () => {
		const fp = fingerprintReviewArtifact("Validate input");
		const history: ReviewRoundRecord[] = [
			{ round: 1, verdict: "request_changes", feedbackFingerprint: fp, workFingerprint: "work-9" },
		];
		const transition = resolveReviewTransition({
			submission: { verdict: "request_changes", summary: "Same", feedback: "Validate input", insight: null },
			round: 2,
			workFingerprint: "work-9",
			history,
		});
		expect(transition.action).toBe("park");
	});

	it("parks at the round limit", () => {
		const transition = resolveReviewTransition({
			submission: { verdict: "request_changes", summary: "More", feedback: "Keep going", insight: null },
			round: 3,
			workFingerprint: "work-new",
			history: [
				{ round: 1, verdict: "request_changes", feedbackFingerprint: "a", workFingerprint: "w1" },
				{ round: 2, verdict: "request_changes", feedbackFingerprint: "b", workFingerprint: "w2" },
			],
			maxRounds: 3,
		});
		expect(transition.action).toBe("park");
	});
});
