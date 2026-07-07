import { describe, expect, it } from "vitest";
import type { ReviewSubmissionInput } from "../../../src/core/review-orchestration";
import { type PanelJudge, runReviewPanel } from "../../../src/nklein-agent/nklein-review-panel-runner";

const judge = (modelKey: string): PanelJudge => ({
	judgeModelKey: modelKey,
	reviewer: { providerId: "lmstudio", modelId: modelKey },
});

const sub = (over: Partial<ReviewSubmissionInput>): ReviewSubmissionInput => ({
	verdict: "approve",
	summary: "s",
	feedback: null,
	insight: null,
	...over,
});

// A fake per-judge session runner driven by a modelKey→submission map.
const runner =
	(byKey: Record<string, ReviewSubmissionInput | null>) =>
	async (j: PanelJudge): Promise<ReviewSubmissionInput | null> =>
		byKey[j.judgeModelKey] ?? null;

describe("runReviewPanel", () => {
	it("merges to an APPROVE submission on a passing majority (2/3 approve)", async () => {
		const result = await runReviewPanel({
			judges: [judge("qwen"), judge("mistral"), judge("gemma")],
			runJudgeSession: runner({
				qwen: sub({ verdict: "approve" }),
				mistral: sub({ verdict: "approve" }),
				gemma: sub({ verdict: "request_changes", feedback: "rename x" }),
			}),
		});
		expect(result?.submission.verdict).toBe("approve");
		expect(result?.decision.decision).toBe("merge");
		expect(result?.submission.summary).toMatch(/2\/3 judges approved/);
	});

	it("blocks to a REQUEST_CHANGES submission carrying the dissenters' attributed feedback (no majority)", async () => {
		const result = await runReviewPanel({
			judges: [judge("qwen"), judge("mistral"), judge("gemma")],
			runJudgeSession: runner({
				qwen: sub({ verdict: "approve" }),
				mistral: sub({ verdict: "request_changes", feedback: "missing test" }),
				gemma: sub({ verdict: "request_changes", feedback: "bad naming" }),
			}),
		});
		expect(result?.submission.verdict).toBe("request_changes");
		expect(result?.submission.feedback).toContain("[mistral] missing test");
		expect(result?.submission.feedback).toContain("[gemma] bad naming");
		expect(result?.submission.feedback).not.toContain("qwen"); // approving judge's (empty) note not included
	});

	it("a single BLOCKING judge vetoes an approving majority (submission.blocking set)", async () => {
		const result = await runReviewPanel({
			judges: [judge("qwen"), judge("mistral"), judge("gemma")],
			runJudgeSession: runner({
				qwen: sub({ verdict: "approve" }),
				mistral: sub({ verdict: "approve" }),
				gemma: sub({ verdict: "request_changes", blocking: true, feedback: "SQL injection in query builder" }),
			}),
		});
		expect(result?.submission.verdict).toBe("request_changes");
		expect(result?.decision.vetoedBy).toBe("gemma");
		expect(result?.submission.blocking).toBe(true);
		expect(result?.submission.summary).toMatch(/vetoed by gemma/);
	});

	it("drops a judge that yields no verdict but still decides on the rest", async () => {
		const result = await runReviewPanel({
			judges: [judge("qwen"), judge("dead"), judge("mistral")],
			runJudgeSession: runner({
				qwen: sub({ verdict: "approve" }),
				dead: null,
				mistral: sub({ verdict: "approve" }),
			}),
		});
		expect(result?.decision.total).toBe(2); // dead judge dropped
		expect(result?.submission.verdict).toBe("approve"); // 2/2 approve
	});

	it("returns null when NO judge produced a verdict (caller falls back to single reviewer)", async () => {
		const result = await runReviewPanel({
			judges: [judge("a"), judge("b")],
			runJudgeSession: runner({ a: null, b: null }),
		});
		expect(result).toBeNull();
	});

	it("carries the A/B preferred pick of the first approving judge", async () => {
		const result = await runReviewPanel({
			judges: [judge("qwen"), judge("mistral")],
			runJudgeSession: runner({
				qwen: sub({ verdict: "approve", preferred: "speculative" }),
				mistral: sub({ verdict: "approve", preferred: "primary" }),
			}),
		});
		expect(result?.submission.preferred).toBe("speculative");
	});
});
