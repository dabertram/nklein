import { describe, expect, it } from "vitest";
import {
	buildConferAssignments,
	type ConferResponse,
	dedupeEyeFindings,
	normalizeFindingKey,
	planNEyesSchedule,
	resolveConferredFindings,
	shouldScheduleAnotherEye,
} from "../../../src/core/n-eyes-review-schedule";
import { assignReviewLenses } from "../../../src/core/review-lenses";

/**
 * F1.37 — the orthogonal N-eyes protocol layer: distinct (judge, lens) schedule pairs, finding dedup with the
 * per-eye marginal-value trace, and blind-then-confer resolution with the fail-closed veto rule.
 */

const JUDGES = [{ judgeModelKey: "qwen3-8b" }, { judgeModelKey: "gemma-27b" }, { judgeModelKey: "phi-4-mini" }];

describe("planNEyesSchedule", () => {
	it("every eye is a DISTINCT (judge, lens) pair; lenses advance first (orthogonality), judges rotate", () => {
		const eyes = planNEyesSchedule({ judges: JUDGES, reviewerTier: "strong", maxEyes: 21 });
		const lensCount = assignReviewLenses({ eyes: Number.MAX_SAFE_INTEGER, reviewerTier: "strong" }).length;
		expect(eyes.length).toBe(Math.min(21, lensCount * JUDGES.length));
		const pairs = new Set(eyes.map((eye) => `${eye.judgeModelKey}|${eye.lens.id}`));
		expect(pairs.size).toBe(eyes.length); // no duplicate pair ever
		// The first eyes walk the lens order (failure-mass first) with rotating judges.
		expect(eyes[0].lens.id).toBe("spec_fit");
		expect(eyes[1].lens.id).not.toBe(eyes[0].lens.id);
		expect(eyes[1].judgeModelKey).not.toBe(eyes[0].judgeModelKey);
	});

	it("bounds by maxEyes and returns empty for no judges / zero eyes", () => {
		expect(planNEyesSchedule({ judges: JUDGES, reviewerTier: "strong", maxEyes: 4 })).toHaveLength(4);
		expect(planNEyesSchedule({ judges: [], reviewerTier: "strong", maxEyes: 4 })).toEqual([]);
		expect(planNEyesSchedule({ judges: JUDGES, reviewerTier: "strong", maxEyes: 0 })).toEqual([]);
	});
});

describe("dedupeEyeFindings + the marginal-value stop", () => {
	const reports = [
		{
			eyeId: "eye-1",
			findings: [
				{ category: "correctness", severity: "medium" as const, summary: "Off-by-one in the pager loop." },
				{ category: "security", severity: "high" as const, summary: "Token logged in plain text!" },
			],
		},
		{
			eyeId: "eye-2",
			findings: [
				// Same finding, different punctuation/case — must dedupe and corroborate, and the higher severity wins.
				{ category: "Correctness", severity: "high" as const, summary: "off-by-one in the pager loop" },
			],
		},
		{ eyeId: "eye-3", findings: [] },
	];

	it("dedupes case/punctuation-insensitively, corroborates, and keeps the highest severity", () => {
		const dedup = dedupeEyeFindings(reports);
		expect(dedup.unique).toHaveLength(2);
		const pager = dedup.unique.find((finding) => finding.key.includes("pager"));
		expect(pager?.corroboratedBy).toEqual(["eye-1", "eye-2"]);
		expect(pager?.severity).toBe("high"); // eye-2 escalated it
		expect(dedup.newFindingsPerEye).toEqual([2, 0, 0]);
	});

	it("the stop rule fires exactly when the last eye added nothing new", () => {
		expect(shouldScheduleAnotherEye(dedupeEyeFindings(reports.slice(0, 1)))).toBe(true); // eye-1 added 2
		expect(shouldScheduleAnotherEye(dedupeEyeFindings(reports.slice(0, 2)))).toBe(false); // eye-2 added 0
	});

	it("normalizeFindingKey treats wording variants as one finding", () => {
		expect(normalizeFindingKey("Security", "Token logged, in plain text!")).toBe(
			normalizeFindingKey("security", "token logged in plain   text"),
		);
	});
});

describe("blind-then-confer", () => {
	const dedup = dedupeEyeFindings([
		{
			eyeId: "eye-1",
			findings: [
				{ category: "security", severity: "high" as const, summary: "Token logged in plain text." },
				{ category: "simplicity", severity: "low" as const, summary: "Helper could be inlined." },
			],
		},
		{ eyeId: "eye-2", findings: [] },
		{ eyeId: "eye-3", findings: [] },
	]);
	const [securityKey, styleKey] = dedup.unique.map((finding) => finding.key);

	it("confer assignments exclude an eye's own findings (blind first, no self-confirmation)", () => {
		const assignments = buildConferAssignments(dedup, [{ eyeId: "eye-1" }, { eyeId: "eye-2" }, { eyeId: "eye-3" }]);
		expect(assignments.find((assignment) => assignment.eyeId === "eye-1")?.findingKeys).toEqual([]);
		expect(assignments.find((assignment) => assignment.eyeId === "eye-2")?.findingKeys).toHaveLength(2);
	});

	it("majority dispute drops a non-veto finding but only DISPUTES a veto-class one (fail-closed)", () => {
		const responses: ConferResponse[] = [
			{ eyeId: "eye-2", findingKey: securityKey, stance: "dispute" },
			{ eyeId: "eye-3", findingKey: securityKey, stance: "dispute" },
			{ eyeId: "eye-2", findingKey: styleKey, stance: "dispute" },
			{ eyeId: "eye-3", findingKey: styleKey, stance: "dispute" },
		];
		const resolved = resolveConferredFindings(dedup, responses);
		const security = resolved.find((finding) => finding.key === securityKey);
		const style = resolved.find((finding) => finding.key === styleKey);
		expect(security?.status).toBe("disputed"); // high-severity security is NEVER silently dropped
		expect(style?.status).toBe("dropped"); // out-voted low-severity style finding goes away
	});

	it("a confirm keeps a finding confirmed; a minority dispute surfaces as disputed", () => {
		const resolved = resolveConferredFindings(dedup, [
			{ eyeId: "eye-2", findingKey: securityKey, stance: "confirm" },
			{ eyeId: "eye-3", findingKey: securityKey, stance: "dispute" },
		]);
		const security = resolved.find((finding) => finding.key === securityKey);
		expect(security?.status).toBe("disputed"); // 2 confirms (raiser + eye-2) vs 1 dispute — surfaced, not dropped
		expect(security?.confirms).toBe(2);
		expect(security?.disputes).toBe(1);
		const untouched = resolveConferredFindings(dedup, []);
		expect(untouched.every((finding) => finding.status === "confirmed")).toBe(true);
	});
});
