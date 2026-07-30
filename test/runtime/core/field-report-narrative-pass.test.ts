import { describe, expect, it, vi } from "vitest";
import type { DraftClaim, EvidenceRecord } from "../../../src/core/field-report-grounding";
import { runFieldReportNarrativePass } from "../../../src/core/field-report-narrative-pass";

/**
 * P16.6b — the narrative pass, end to end, with no model loaded.
 *
 * The safety property under test is structural: **there is no path out of this orchestrator that publishes model
 * prose without grounding it.** P16.6 forbids degrading to a hallucinated narrative, and the model call is the
 * exciting half — the half that gets wired first by accident — so the test suite has to make skipping the filter
 * impossible to do quietly.
 */

const EVIDENCE: EvidenceRecord[] = [
	{ id: "ev-1", kind: "telemetry" },
	{ id: "ev-2", kind: "ledger" },
];

const parseOne = (claims: DraftClaim[]) => () => claims;

describe("runFieldReportNarrativePass", () => {
	it("does not call the model at all when the ladder declines", () => {
		// A model measured below the grounding bar is not asked. The call must not happen — not merely be discarded.
		const callModel = vi.fn(async () => ({ content: "prose" }));
		return runFieldReportNarrativePass({
			plan: { modelAvailable: true, recentGroundedRate: 0.1, reportsObserved: 5 },
			evidence: EVIDENCE,
			callModel,
			parseClaims: parseOne([{ text: "x", citedEvidenceIds: ["ev-1"] }]),
		}).then((result) => {
			expect(result.outcome).toBe("not_attempted");
			expect(callModel).not.toHaveBeenCalled();
			expect(result.observedDropRate, "a model never asked has not demonstrated a rate").toBeNull();
		});
	});

	it("publishes ONLY claims that survived grounding", async () => {
		const result = await runFieldReportNarrativePass({
			plan: { modelAvailable: true },
			evidence: EVIDENCE,
			callModel: async () => ({ content: "narrative prose" }),
			parseClaims: parseOne([
				{ text: "real claim", citedEvidenceIds: ["ev-1"] },
				{ text: "invented claim", citedEvidenceIds: ["ev-DOES-NOT-EXIST"] },
			]),
		});
		expect(result.outcome).toBe("narrative_grounded");
		expect(result.grounded.map((claim) => claim.text)).toEqual(["real claim"]);
		// The decisive assertion: the fabricated claim is absent from the published set entirely.
		expect(JSON.stringify(result.grounded)).not.toContain("invented claim");
	});

	it("degrades to Layer A when a reasoning model answers with thinking only", async () => {
		const result = await runFieldReportNarrativePass({
			plan: { modelAvailable: true },
			evidence: EVIDENCE,
			callModel: async () => ({ content: "", reasoningContent: "let me think about the structure..." }),
			parseClaims: parseOne([{ text: "never reached", citedEvidenceIds: ["ev-1"] }]),
		});
		expect(result.outcome).toBe("empty_completion");
		expect(result.grounded).toEqual([]);
		expect(result.reason).toContain("REASONING channel only");
	});

	it("reports ALL-UNGROUNDED as a real measurement, distinct from never being asked", async () => {
		// This is the one outcome that is evidence ABOUT the model: it answered, and every citation was invented.
		// The ladder should act on it, which it can only do if the rate is a number rather than a null.
		const result = await runFieldReportNarrativePass({
			plan: { modelAvailable: true },
			evidence: EVIDENCE,
			callModel: async () => ({ content: "confident prose" }),
			parseClaims: parseOne([
				{ text: "a", citedEvidenceIds: ["nope"] },
				{ text: "b", citedEvidenceIds: [] },
			]),
		});
		expect(result.outcome).toBe("all_claims_ungrounded");
		expect(result.grounded).toEqual([]);
		expect(result.observedDropRate).toBe(1);
		expect(result.reason).toContain("invented its citations");
	});

	it("does NOT report a fabricated 0% drop rate when nothing was generated", async () => {
		// Feeding a 0 back into the ladder would promote an unproven model on the strength of a call it never made.
		const result = await runFieldReportNarrativePass({
			plan: { modelAvailable: true },
			evidence: EVIDENCE,
			callModel: async () => ({ content: "prose with no parseable claims" }),
			parseClaims: parseOne([]),
		});
		expect(result.outcome).toBe("empty_completion");
		expect(result.observedDropRate).toBeNull();
	});

	it("degrades when no model is available, without inventing a reason", async () => {
		const result = await runFieldReportNarrativePass({
			plan: { modelAvailable: false },
			evidence: EVIDENCE,
			callModel: async () => ({ content: "unreachable" }),
			parseClaims: parseOne([]),
		});
		expect(result.outcome).toBe("not_attempted");
		expect(result.reason.length).toBeGreaterThan(0);
	});

	it("EVERY non-grounded outcome publishes zero claims — the structural guarantee", async () => {
		// Stated as one assertion over all the degradation paths, so a future outcome added without a grounding
		// step cannot slip through by only being covered in its own happy-path test.
		const cases = [
			{ plan: { modelAvailable: false }, claims: [] as DraftClaim[], completion: { content: "x" } },
			{ plan: { modelAvailable: true }, claims: [], completion: { content: "" } },
			{
				plan: { modelAvailable: true },
				claims: [{ text: "a", citedEvidenceIds: ["missing"] }],
				completion: { content: "prose" },
			},
		];
		for (const testCase of cases) {
			const result = await runFieldReportNarrativePass({
				plan: testCase.plan,
				evidence: EVIDENCE,
				callModel: async () => testCase.completion,
				parseClaims: parseOne(testCase.claims),
			});
			if (result.outcome !== "narrative_grounded") {
				expect(result.grounded, `${result.outcome} published claims`).toEqual([]);
			}
		}
	});
});
