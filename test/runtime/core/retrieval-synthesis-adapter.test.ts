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

	it("truncates a long excerpt with no query-term match to keep the prompt bounded", () => {
		const prompt = buildSynthesisPrompt("q", [{ id: "e1", text: "x".repeat(2000) }]);
		expect(prompt).toContain("…");
		expect(prompt).not.toContain("x".repeat(1300)); // no term match → head truncation, capped at 1200 chars
	});

	it("narrows a long excerpt to the query-relevant span instead of an arbitrary head slice", () => {
		const head = "PADDING ".repeat(300); // ~2400 chars of irrelevant lead-in (no query term)
		const text = `${head}The Environment API is the headline change. ${"tail ".repeat(300)}`;
		const prompt = buildSynthesisPrompt("what is the Environment API?", [{ id: "e1", text }]);
		// The window around the matched terms is kept; the long padding head is dropped (extraction, not head-truncation).
		expect(prompt).toContain("Environment API is the headline change");
		expect(prompt).not.toContain("PADDING ".repeat(50));
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

	it("a claim whose citations don't resolve renders ungrounded — flagged unverified, no markers/sources", async () => {
		// Contract updated 2026-07-08 (citation-verification wiring): an ungrounded claim still renders (fail-soft)
		// but is now explicitly FLAGGED instead of silently passing as an equal-weight answer line.
		const synth = citedSynthesisAdapter(async () => '[{"claim":"Floating","cite":["ghost"]}]');
		const answer = await synth({ task: "q", evidence });
		expect(answer).toContain("Floating");
		expect(answer).toContain("Unverified (no supporting source): Floating");
		expect(answer).not.toContain("Sources:");
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

	it("marks claims with NO supporting evidence as unverified in the rendered answer (§5.AC citation verification)", async () => {
		const raw = JSON.stringify([
			{ claim: "A is true", cite: ["a"] },
			{ claim: "B is a hallucination", cite: [] },
		]);
		const synthesize = citedSynthesisAdapter(async () => raw);
		const answer = await synthesize({
			task: "what about A and B?",
			evidence: [{ id: "a", text: "A is documented", url: "https://e.example/a" }],
		});
		expect(answer).toContain("A is true [1]");
		// The unsupported claim still renders (fail-soft) but the answer flags it — never silently equal-weighted.
		expect(answer).toContain("Unverified (no supporting source): B is a hallucination");
	});

	it("accepts SHORT alias citations (e1/e2) and maps them back to the real evidence ids (weak-model URLs fix)", async () => {
		const synth = citedSynthesisAdapter(async (prompt) => {
			// The prompt must tag excerpts with the short aliases, not the raw URL ids.
			expect(prompt).toContain("[e1]");
			expect(prompt).toContain("[e2]");
			return '[{"claim":"A is documented","cite":["e1"]}]';
		});
		const answer = await synth({
			task: "what about A?",
			evidence: [
				{ id: "https://long.example/path/to/a", text: "A is documented", url: "https://long.example/path/to/a" },
				{ id: "https://long.example/b", text: "B stuff", url: "https://long.example/b" },
			],
		});
		expect(answer).toContain("A is documented [1]");
		expect(answer).toContain("[1] https://long.example/path/to/a");
		expect(answer).not.toContain("Unverified");
	});
});
