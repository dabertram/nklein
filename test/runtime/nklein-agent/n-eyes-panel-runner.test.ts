import { describe, expect, it } from "vitest";
import type { NEyesEye } from "../../../src/core/n-eyes-review-schedule";
import type { ReviewSubmissionInput } from "../../../src/core/review-orchestration";
import {
	buildConferPrompt,
	EYE_FINDINGS_FORMAT_INSTRUCTION,
	parseConferResponses,
	parseEyeFindings,
	runNEyesReviewPanel,
} from "../../../src/nklein-agent/nklein-review-panel-runner";

const approve = (feedback: string | null = null): ReviewSubmissionInput => ({
	verdict: "approve",
	summary: "LGTM",
	feedback,
	insight: null,
});
const block = (feedback: string): ReviewSubmissionInput => ({
	verdict: "request_changes",
	summary: "Issues",
	feedback,
	insight: null,
});

describe("parseEyeFindings (F1.37b)", () => {
	it("parses formatted FINDING lines and normalizes severity/category case", () => {
		const findings = parseEyeFindings(
			block("Prose first.\nFINDING: [Security|HIGH] Token logged in plain text\nFINDING: [style|low] Odd naming"),
			"correctness",
		);
		expect(findings).toEqual([
			{ category: "security", severity: "high", summary: "Token logged in plain text" },
			{ category: "style", severity: "low", summary: "Odd naming" },
		]);
	});

	it("falls back to ONE finding from the first feedback line for an unformatted blocking submission", () => {
		const findings = parseEyeFindings(block("The auth check is missing entirely.\nMore prose."), "auth-lens");
		expect(findings).toEqual([
			{ category: "auth-lens", severity: "medium", summary: "The auth check is missing entirely." },
		]);
	});

	it("an approving, findings-less eye yields none", () => {
		expect(parseEyeFindings(approve("Looks clean."), "x")).toEqual([]);
	});
});

describe("confer prompt/response round-trip", () => {
	it("numbers findings and parses confirm/dispute lines back by key", () => {
		const numbered = [
			{ index: 1, finding: { key: "k1", category: "security", severity: "high" as const, summary: "Leak" } },
			{ index: 2, finding: { key: "k2", category: "style", severity: "low" as const, summary: "Nit" } },
		];
		const prompt = buildConferPrompt(numbered);
		expect(prompt).toContain("1. (high/security) Leak");
		const responses = parseConferResponses("eye-1", "CONFER: 1 confirm\nnoise\nCONFER: 2 dispute", numbered);
		expect(responses).toEqual([
			{ eyeId: "eye-1", findingKey: "k1", stance: "confirm" },
			{ eyeId: "eye-1", findingKey: "k2", stance: "dispute" },
		]);
		expect(parseConferResponses("eye-1", null, numbered)).toEqual([]);
	});
});

describe("runNEyesReviewPanel", () => {
	const judges = [
		{ judgeModelKey: "lmstudio:alpha", reviewer: { providerId: "lmstudio", modelId: "alpha" } },
		{ judgeModelKey: "lmstudio:beta", reviewer: { providerId: "lmstudio", modelId: "beta" } },
	];

	it("runs distinct (judge, lens) eyes, stops early when marginal value is exhausted, and combines the verdict", async () => {
		const suffixes: string[] = [];
		const result = await runNEyesReviewPanel({
			judges,
			reviewerTier: "mid",
			maxEyes: 4,
			runEyeSession: async (_eye, _judge, promptSuffix) => {
				suffixes.push(promptSuffix);
				return approve("Nothing new.");
			},
		});
		expect(result).not.toBeNull();
		// Two consecutive findings-less eyes exhaust marginal value — the 4-eye schedule stops at 2.
		expect(result?.eyesRun.length).toBe(2);
		expect(result?.decision.decision).toBe("merge");
		expect(result?.submission.verdict).toBe("approve");
		// Every eye carried a lens stance + the findings format instruction.
		for (const suffix of suffixes) {
			expect(suffix).toContain(EYE_FINDINGS_FORMAT_INSTRUCTION.trim().slice(0, 20));
		}
		// Distinct (judge, lens) pairs.
		const pairs = new Set(result?.eyesRun.map((eye) => `${eye.judgeModelKey}::${eye.lens.id}`));
		expect(pairs.size).toBe(result?.eyesRun.length);
	});

	it("confer round: an out-voted finding drops; a veto-class finding survives disputes into the feedback block", async () => {
		const conferredEyes: string[] = [];
		const result = await runNEyesReviewPanel({
			judges,
			reviewerTier: "mid",
			maxEyes: 2,
			runEyeSession: async (eye) =>
				eye.eyeId === "eye-1"
					? block("FINDING: [security|critical] Secret committed\nFINDING: [style|low] Bad name")
					: approve(),
			runConferSession: async (eye, _judge, conferPrompt) => {
				conferredEyes.push(eye.eyeId);
				// The approving eye disputes BOTH of eye-1's findings.
				const lines = [...conferPrompt.matchAll(/^(\d+)\./gm)].map((match) => `CONFER: ${match[1]} dispute`);
				return lines.join("\n");
			},
		});
		expect(result).not.toBeNull();
		expect(conferredEyes).toEqual(["eye-2"]);
		const byCategory = new Map(result?.conferred.map((finding) => [finding.category, finding]));
		// style/low: 1 confirm (raiser) vs 1 dispute — not out-voted, surfaces as disputed.
		expect(byCategory.get("style")?.status).toBe("disputed");
		// security/critical: veto class — never dropped regardless of votes.
		expect(byCategory.get("security")?.status).toBe("disputed");
		expect(result?.submission.feedback).toContain("Panel findings after confer:");
		expect(result?.submission.feedback).toContain("Secret committed");
	});

	it("returns null when no eye produces a verdict (caller falls back to the plain panel)", async () => {
		const result = await runNEyesReviewPanel({
			judges,
			reviewerTier: "mid",
			maxEyes: 3,
			runEyeSession: async () => null,
		});
		expect(result).toBeNull();
	});
});
