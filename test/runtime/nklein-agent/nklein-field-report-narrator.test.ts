import { describe, expect, it } from "vitest";
import { buildNarratorPrompt, parseNarratorClaims } from "../../../src/nklein-agent/nklein-field-report-narrator";

/**
 * P16.6b — the effectful half's pure parts: the prompt and the claim parser.
 *
 * The parser is the piece that must fail SAFELY. Its output feeds grounding, and a half-salvaged claim would
 * carry citations the model never really asserted — grounding would then resolve them and publish a claim nobody
 * made. So malformed input yields NO claims, which the orchestrator already handles as a degradation to Layer A
 * with a stated reason.
 */
describe("parseNarratorClaims", () => {
	it("parses well-formed claims with their citations", () => {
		const claims = parseNarratorClaims(
			JSON.stringify({ claims: [{ text: "The run bounced twice.", citedEvidenceIds: ["ev-1", "ev-2"] }] }),
		);
		expect(claims).toEqual([{ text: "The run bounced twice.", citedEvidenceIds: ["ev-1", "ev-2"] }]);
	});

	it("returns NO claims on malformed JSON rather than throwing into the report path", () => {
		for (const bad of ["", "not json", "{", "null", "[]"]) {
			expect(parseNarratorClaims(bad), `input: ${bad}`).toEqual([]);
		}
	});

	it("drops entries with no usable text instead of salvaging fragments", () => {
		// A claim with citations but no text would reach grounding, resolve its evidence, and publish an empty
		// assertion carrying real provenance — worse than dropping it.
		const claims = parseNarratorClaims(
			JSON.stringify({
				claims: [
					{ text: "", citedEvidenceIds: ["ev-1"] },
					{ text: "   ", citedEvidenceIds: ["ev-1"] },
					{ citedEvidenceIds: ["ev-1"] },
					{ text: "real", citedEvidenceIds: ["ev-1"] },
				],
			}),
		);
		expect(claims.map((claim) => claim.text)).toEqual(["real"]);
	});

	it("keeps a claim with NO citations so grounding can reject it explicitly", () => {
		// Dropping it here would hide it; grounding's `no_citations` reason is what makes an uncited claim visible
		// as a model behaviour rather than a parser artefact.
		const claims = parseNarratorClaims(JSON.stringify({ claims: [{ text: "uncited", citedEvidenceIds: [] }] }));
		expect(claims).toEqual([{ text: "uncited", citedEvidenceIds: [] }]);
	});

	it("ignores non-string citation entries without discarding the claim", () => {
		const claims = parseNarratorClaims(
			JSON.stringify({ claims: [{ text: "mixed", citedEvidenceIds: ["ev-1", 42, null] }] }),
		);
		expect(claims).toEqual([{ text: "mixed", citedEvidenceIds: ["ev-1"] }]);
	});
});

describe("buildNarratorPrompt", () => {
	it("offers evidence ids and states that an uncitable claim must not be made", () => {
		const prompt = buildNarratorPrompt([{ id: "ev-1", kind: "telemetry", summary: "two review bounces" }]);
		expect(prompt).toContain("ev-1");
		expect(prompt).toContain("two review bounces");
		expect(prompt).toContain("MUST cite at least one evidence id");
		expect(prompt).toContain("must not make");
	});

	it("tells the model not to restate counts — those are Layer A's job", () => {
		// P16.6's load-bearing property: a model asked to summarise counts will paraphrase them, and a paraphrased
		// count is a claim that can be wrong about something that was never in doubt.
		expect(buildNarratorPrompt([])).toContain("Do not restate counts");
	});
});
