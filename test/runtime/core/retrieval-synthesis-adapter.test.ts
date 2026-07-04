import { describe, expect, it } from "vitest";
import type { RetrievalEvidence } from "../../../src/core/retrieval-loop-driver";
import {
	buildSynthesisPrompt,
	citedSynthesisAdapter,
	parseSynthesisClaims,
} from "../../../src/core/retrieval-synthesis-adapter";

const evidence: RetrievalEvidence[] = [
	{ id: "e1", url: "https://a", text: "Vite 6 ships a new config API." },
	{ id: "e2", url: "https://b", text: "Vite 6 requires Node 20." },
];

describe("buildSynthesisPrompt (§5.AC)", () => {
	it("embeds the question, each id-tagged evidence excerpt, and the JSON-claims instruction", () => {
		const prompt = buildSynthesisPrompt("what's new in vite 6?", evidence);
		expect(prompt).toContain("QUESTION: what's new in vite 6?");
		expect(prompt).toContain("[e1] (https://a)");
		expect(prompt).toContain("Vite 6 ships a new config API.");
		expect(prompt).toContain("[e2] (https://b)");
		expect(prompt).toContain("JSON array");
		expect(prompt).toContain("ONLY the EVIDENCE");
	});

	it("truncates a long excerpt to keep the prompt bounded", () => {
		const prompt = buildSynthesisPrompt("q", [{ id: "e1", text: "x".repeat(2000) }]);
		expect(prompt).toContain("…");
		expect(prompt).not.toContain("x".repeat(1300)); // capped at 1200 chars
	});
});

describe("parseSynthesisClaims (§5.AC, fail-soft)", () => {
	const known = new Set(["e1", "e2"]);

	it("parses a clean JSON array of claims", () => {
		expect(parseSynthesisClaims('[{"claim":"A","cite":["e1"]}]', known)).toEqual([
			{ text: "A", citedEvidenceIds: ["e1"] },
		]);
	});

	it("extracts the JSON array even when the model wraps it in prose / a code fence", () => {
		const raw = 'Here you go:\n```json\n[{"claim":"B","cite":["e2"]}]\n```\nDone.';
		expect(parseSynthesisClaims(raw, known)).toEqual([{ text: "B", citedEvidenceIds: ["e2"] }]);
	});

	it("drops cited ids that are not in the known evidence set", () => {
		expect(parseSynthesisClaims('[{"claim":"C","cite":["e1","ghost"]}]', known)).toEqual([
			{ text: "C", citedEvidenceIds: ["e1"] },
		]);
	});

	it("skips malformed entries (missing/empty claim, non-array cite) but keeps the good ones", () => {
		const raw = '[{"cite":["e1"]},{"claim":"  ","cite":[]},{"claim":"D","cite":"e1"},{"claim":"E","cite":["e2"]}]';
		expect(parseSynthesisClaims(raw, known)).toEqual([
			{ text: "D", citedEvidenceIds: [] }, // cite not an array → dropped to []
			{ text: "E", citedEvidenceIds: ["e2"] },
		]);
	});

	it("returns [] on unparseable / non-array / bracketless input", () => {
		expect(parseSynthesisClaims("no json here at all", known)).toEqual([]);
		expect(parseSynthesisClaims("[not valid json", known)).toEqual([]);
		expect(parseSynthesisClaims('{"claim":"x"}', known)).toEqual([]); // an object, not an array
	});
});

describe("citedSynthesisAdapter (§5.AC)", () => {
	it("renders a cited answer with [n] markers + a marker-ordered sources list", async () => {
		const synth = citedSynthesisAdapter(
			async () => '[{"claim":"Alpha","cite":["e1"]},{"claim":"Beta","cite":["e2","e1"]}]',
		);
		const answer = await synth({ task: "q", evidence });
		// e1 is cited first ⇒ marker 1; e2 next ⇒ marker 2; Beta cites e2 then e1 ⇒ "[2][1]".
		expect(answer).toBe("Alpha [1]\nBeta [2][1]\n\nSources:\n[1] https://a\n[2] https://b");
	});

	it("fail-soft: a thrown completion yields an empty answer (the loop keeps its evidence)", async () => {
		const synth = citedSynthesisAdapter(async () => {
			throw new Error("model down");
		});
		expect(await synth({ task: "q", evidence })).toBe("");
	});

	it("fail-soft: model output with no parseable claims falls back to the raw text", async () => {
		const synth = citedSynthesisAdapter(async () => "  Just a prose answer, no JSON.  ");
		expect(await synth({ task: "q", evidence })).toBe("Just a prose answer, no JSON.");
	});

	it("a claim whose citations don't resolve renders ungrounded (no markers, no sources block)", async () => {
		const synth = citedSynthesisAdapter(async () => '[{"claim":"Floating","cite":["ghost"]}]');
		expect(await synth({ task: "q", evidence })).toBe("Floating");
	});

	it("returns an empty answer when there is no evidence to synthesize (never calls the model)", async () => {
		let called = false;
		const synth = citedSynthesisAdapter(async () => {
			called = true;
			return "x";
		});
		expect(await synth({ task: "q", evidence: [] })).toBe("");
		expect(called).toBe(false);
	});
});
