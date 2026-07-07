import { describe, expect, it } from "vitest";
import {
	combinePanelVerdicts,
	mapReviewSubmissionToPanelVerdict,
	type PanelJudgeVerdict,
} from "../../../src/core/review-panel-verdict";

const pass = (judgeModelKey: string): PanelJudgeVerdict => ({ judgeModelKey, pass: true });
const fail = (judgeModelKey: string): PanelJudgeVerdict => ({ judgeModelKey, pass: false });

describe("mapReviewSubmissionToPanelVerdict", () => {
	it("approve → a passing verdict with no findings", () => {
		expect(mapReviewSubmissionToPanelVerdict("qwen", { verdict: "approve" })).toEqual({
			judgeModelKey: "qwen",
			pass: true,
		});
	});

	it("advisory request_changes → fail + a MEDIUM finding (counts against majority, does NOT veto)", () => {
		const verdict = mapReviewSubmissionToPanelVerdict("mistral", { verdict: "request_changes" });
		expect(verdict.pass).toBe(false);
		expect(verdict.findings).toEqual([{ severity: "medium", category: "correctness" }]);
		// A medium finding never vetoes: a 2/3 approving majority still merges alongside it.
		expect(combinePanelVerdicts([pass("a"), pass("b"), verdict]).decision).toBe("merge");
	});

	it("blocking request_changes → fail + a HIGH finding that VETOES even a passing majority", () => {
		const verdict = mapReviewSubmissionToPanelVerdict("gemma", { verdict: "request_changes", blocking: true });
		expect(verdict.findings).toEqual([{ severity: "high", category: "correctness" }]);
		expect(combinePanelVerdicts([pass("a"), pass("b"), verdict]).decision).toBe("block");
		expect(combinePanelVerdicts([pass("a"), pass("b"), verdict]).vetoedBy).toBe("gemma");
	});
});

describe("combinePanelVerdicts", () => {
	it("merges on a passing majority with no vetoing finding (3 judges, 2 pass)", () => {
		const result = combinePanelVerdicts([pass("qwen"), pass("mistral"), fail("gemma")]);
		expect(result.decision).toBe("merge");
		expect(result).toMatchObject({ passes: 2, total: 3, vetoedBy: null });
	});

	it("blocks without a majority (3 judges, 1 pass)", () => {
		expect(combinePanelVerdicts([pass("qwen"), fail("mistral"), fail("gemma")]).decision).toBe("block");
	});

	it("SECURITY VETO: one judge's high security finding blocks even a unanimous pass", () => {
		const result = combinePanelVerdicts([
			pass("qwen"),
			{ judgeModelKey: "mistral", pass: true, findings: [{ severity: "high", category: "security" }] },
			pass("gemma"),
		]);
		expect(result.decision).toBe("block");
		expect(result.vetoedBy).toBe("mistral");
		expect(result.reason).toMatch(/vetoes the merge/);
	});

	it("a high finding in a NON-veto category (e.g. style) does NOT veto — majority still decides", () => {
		const result = combinePanelVerdicts([
			pass("qwen"),
			{ judgeModelKey: "mistral", pass: true, findings: [{ severity: "high", category: "style" }] },
			fail("gemma"),
		]);
		expect(result.decision).toBe("merge"); // 2/3 majority, style finding doesn't veto
		expect(result.vetoedBy).toBeNull();
	});

	it("an UNCATEGORIZED critical finding vetoes (conservative)", () => {
		const result = combinePanelVerdicts([
			pass("a"),
			pass("b"),
			{ judgeModelKey: "c", pass: true, findings: [{ severity: "critical" }] },
		]);
		expect(result.decision).toBe("block");
		expect(result.vetoedBy).toBe("c");
	});

	it("securityVeto:false ignores findings — pure majority", () => {
		const result = combinePanelVerdicts(
			[
				pass("a"),
				pass("b"),
				{ judgeModelKey: "c", pass: true, findings: [{ severity: "critical", category: "security" }] },
			],
			{ securityVeto: false },
		);
		expect(result.decision).toBe("merge");
	});

	it("respects custom vetoCategories", () => {
		const verdicts: PanelJudgeVerdict[] = [
			pass("a"),
			pass("b"),
			{ judgeModelKey: "c", pass: true, findings: [{ severity: "high", category: "perf" }] },
		];
		expect(combinePanelVerdicts(verdicts).decision).toBe("merge"); // perf not a default veto category
		expect(combinePanelVerdicts(verdicts, { vetoCategories: ["perf"] }).decision).toBe("block");
	});

	it("blocks an empty panel (no judgment never auto-approves)", () => {
		expect(combinePanelVerdicts([]).decision).toBe("block");
	});

	it("an even-panel tie is not a majority → block (2 judges, 1 pass)", () => {
		expect(combinePanelVerdicts([pass("a"), fail("b")]).decision).toBe("block");
	});

	it("low/medium findings never veto — only high/critical", () => {
		const result = combinePanelVerdicts([
			pass("a"),
			pass("b"),
			{ judgeModelKey: "c", pass: false, findings: [{ severity: "medium", category: "security" }] },
		]);
		expect(result.decision).toBe("merge"); // 2/3 pass, medium security finding doesn't veto
	});
});
