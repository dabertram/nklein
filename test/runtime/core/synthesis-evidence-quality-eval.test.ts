import { describe, expect, it } from "vitest";
import { buildSynthesisPrompt } from "../../../src/core/retrieval-synthesis-adapter";
import {
	buildSynthesisEvidenceQualityCases,
	runSynthesisEvidenceQualityEval,
	scoreSynthesisEvidenceAnswer,
} from "../../../src/core/synthesis-evidence-quality-eval";

describe("scoreSynthesisEvidenceAnswer", () => {
	it("requires both expected facts and stable evidence ids", () => {
		const case_ = { expectedNeedles: ["seven attempts"], expectedCitationIds: ["e1"] };
		expect(scoreSynthesisEvidenceAnswer('[{"claim":"Use seven attempts.","cite":["e1"]}]', case_).passed).toBe(true);
		expect(scoreSynthesisEvidenceAnswer('[{"claim":"Use seven attempts.","cite":[]}]', case_).passed).toBe(false);
		expect(scoreSynthesisEvidenceAnswer('[{"claim":"Use five attempts.","cite":["e1"]}]', case_).passed).toBe(false);
	});
});

describe("runSynthesisEvidenceQualityEval", () => {
	it("compares the full control with the production-trimmed prompt and reports saving", async () => {
		const report = await runSynthesisEvidenceQualityEval(
			buildSynthesisEvidenceQualityCases(),
			async ({ caseId, prompt }) => {
				expect(prompt).toContain("ONLY the EVIDENCE");
				if (caseId === "late-release-fact") return '[{"claim":"Use seven attempts.","cite":["e1"]}]';
				if (caseId === "two-source-configuration") {
					return '[{"claim":"Use port 8443.","cite":["e1"]},{"claim":"The timeout is 47 seconds.","cite":["e2"]}]';
				}
				return '[{"claim":"The cache is 384 MiB.","cite":["e1"]}]';
			},
		);

		expect(report.passed).toBe(true);
		expect(report.regressions).toBe(0);
		expect(report.scorablePairs).toBe(3);
		expect(report.tokenSavingFraction).toBeGreaterThan(0.5);
	});

	it("keeps every answer-key fact in the production-trimmed fixture prompts", () => {
		for (const case_ of buildSynthesisEvidenceQualityCases()) {
			const prompt = buildSynthesisPrompt(case_.task, case_.evidence).toLowerCase();
			for (const needle of case_.expectedNeedles) expect(prompt).toContain(needle);
		}
	});

	it("fails when trimming loses an answer the full control retained", async () => {
		const [case_] = buildSynthesisEvidenceQualityCases();
		const report = await runSynthesisEvidenceQualityEval([case_], async ({ variant }) =>
			variant === "full"
				? '[{"claim":"Use seven attempts.","cite":["e1"]}]'
				: '[{"claim":"The evidence is insufficient.","cite":[]}]',
		);

		expect(report.passed).toBe(false);
		expect(report.regressions).toBe(1);
	});
});
