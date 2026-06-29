import { describe, expect, it } from "vitest";
import { type ExtractionOptions, type ExtractionSpan, extractRelevantSpans } from "../../../src/core/extraction-span";

// ---------------------------------------------------------------------------
// Helper: assert the invariants that must hold for every valid result.
// ---------------------------------------------------------------------------
function assertInvariants(spans: ExtractionSpan[], text: string): void {
	// Sorted by start ascending.
	for (let i = 1; i < spans.length; i++) {
		expect(spans[i].start).toBeGreaterThan(spans[i - 1].start);
	}

	for (const span of spans) {
		// start < end
		expect(span.start).toBeLessThan(span.end);
		// bounds
		expect(span.start).toBeGreaterThanOrEqual(0);
		expect(span.end).toBeLessThanOrEqual(text.length);
		// text === slice
		expect(span.text).toBe(text.slice(span.start, span.end));
	}

	// Non-overlapping and non-touching after merge.
	for (let i = 1; i < spans.length; i++) {
		expect(spans[i].start).toBeGreaterThan(spans[i - 1].end);
	}
}

// ---------------------------------------------------------------------------
// Matrix of cases
// ---------------------------------------------------------------------------

describe("extractRelevantSpans", () => {
	// 1. Single match → one window with correct text.
	it("single match returns one span whose text matches the slice", () => {
		const text = "The quick brown fox jumps over the lazy dog";
		const spans = extractRelevantSpans(text, ["fox"], { windowChars: 10 });
		expect(spans).toHaveLength(1);
		expect(spans[0].text).toBe(text.slice(spans[0].start, spans[0].end));
		// fox is at index 16 — window half=5 → start=max(0,11)=11, end=min(43,16+3+5)=24
		expect(spans[0].start).toBe(11);
		expect(spans[0].end).toBe(24);
		assertInvariants(spans, text);
	});

	// 2. Two distant matches → two distinct spans.
	it("two distant matches produce two separate spans", () => {
		// Ensure the two matches are far apart so windows cannot overlap.
		const prefix = "alpha".padEnd(300, " ");
		const text = `${prefix}beta${" ".repeat(300)}gamma`;
		const spans = extractRelevantSpans(text, ["alpha", "gamma"], { windowChars: 20 });
		expect(spans).toHaveLength(2);
		assertInvariants(spans, text);
	});

	// 3. Overlapping raw windows merge into one span.
	it("overlapping raw windows are merged into a single span", () => {
		// "hello" at 0, "world" at 6 — with windowChars=20 both windows overlap.
		const text = "hello world how are you doing today";
		const spans = extractRelevantSpans(text, ["hello", "world"], { windowChars: 20 });
		expect(spans).toHaveLength(1);
		assertInvariants(spans, text);
	});

	// 4. Touching windows (next.start === current.end) merge into one.
	it("touching windows (next.start === current.end) merge into one span", () => {
		// Build a text where two windows touch exactly.
		// windowChars=10, half=5
		// Put termA at position 5 (length 1) → window [0, 11)
		// Put termB at position 11 (length 1) → window [6, 17) — overlaps, not just touching.
		// For exact touching: termA window end must equal termB window start.
		// termA at 0 (len 1): start=max(0,-5)=0, end=min(text.length, 0+1+5)=6
		// termB at 6 (len 1): start=max(0,1)=1 — not touching.
		// We need a case where end_A === start_B exactly.
		// termA at 5, len=1: end = min(len, 5+1+5)=11
		// termB at 16, len=1: start = max(0, 16-5)=11 → touching!
		const text = `aaaaaX0123456789Yzzzzzz`;
		// X at 5, Y at 16.  windowChars=10, half=5.  text.length=23.
		// X window: start=max(0,0)=0, end=min(23,11)=11
		// Y window: start=max(0,11)=11, end=min(23,22)=22  → touching: 11===11
		const spans = extractRelevantSpans(text, ["X", "Y"], { windowChars: 10 });
		expect(spans).toHaveLength(1);
		expect(spans[0].start).toBe(0);
		expect(spans[0].end).toBe(22);
		assertInvariants(spans, text);
	});

	// 5. Window clamps at text start (match near index 0 → start = 0).
	it("window start clamps to 0 when match is near the beginning", () => {
		const text = "match is right here at the beginning of the text";
		const spans = extractRelevantSpans(text, ["match"], { windowChars: 200 });
		expect(spans).toHaveLength(1);
		expect(spans[0].start).toBe(0);
		assertInvariants(spans, text);
	});

	// 6. Window clamps at text end.
	it("window end clamps to text.length when match is near the end", () => {
		const text = "some long preamble that pushes the interesting word to the end: target";
		const spans = extractRelevantSpans(text, ["target"], { windowChars: 200 });
		expect(spans).toHaveLength(1);
		expect(spans[0].end).toBe(text.length);
		assertInvariants(spans, text);
	});

	// 7. No match → [].
	it("returns [] when no term is found in the text", () => {
		const text = "nothing relevant here";
		const spans = extractRelevantSpans(text, ["zxqvbnm"], { windowChars: 20 });
		expect(spans).toEqual([]);
	});

	// 8. Empty queryTerms → [].
	it("returns [] when queryTerms is empty", () => {
		const spans = extractRelevantSpans("some text", []);
		expect(spans).toEqual([]);
	});

	// 9. All-whitespace terms → [].
	it("returns [] when all query terms are whitespace-only", () => {
		const spans = extractRelevantSpans("some text", ["   ", "\t", " \n "]);
		expect(spans).toEqual([]);
	});

	// 10. maxSpans cap keeps the EARLIEST spans.
	it("maxSpans cap returns the earliest spans, discarding the rest", () => {
		// Build a text with five well-separated terms; cap at 2.
		const gap = " ".repeat(300);
		const text = `alpha${gap}beta${gap}gamma${gap}delta${gap}epsilon`;
		const spans = extractRelevantSpans(text, ["alpha", "beta", "gamma", "delta", "epsilon"], {
			windowChars: 10,
			maxSpans: 2,
		});
		expect(spans).toHaveLength(2);
		// Should be alpha and beta (earliest two).
		expect(spans[0].text).toContain("alpha");
		expect(spans[1].text).toContain("beta");
		assertInvariants(spans, text);
	});

	// 11. Case-insensitive matching finds an upper-case occurrence.
	it("matches regardless of case (upper-case term matches lower-case text and vice versa)", () => {
		const text = "The word RELEVANT appears here in upper case";
		const spans = extractRelevantSpans(text, ["relevant"], { windowChars: 10 });
		expect(spans).toHaveLength(1);
		// The slice of the ORIGINAL text is preserved (mixed case).
		expect(spans[0].text).toContain("RELEVANT");
		assertInvariants(spans, text);
	});

	// 12. Property test: invariants hold over a broader set of inputs.
	it("invariants hold over a matrix of text+term combinations", () => {
		const cases: Array<{ text: string; terms: string[]; opts?: ExtractionOptions }> = [
			{ text: "", terms: ["foo"] },
			{ text: "foo bar baz", terms: ["foo", "bar", "baz"], opts: { windowChars: 4 } },
			{ text: "repeat repeat repeat", terms: ["repeat"], opts: { windowChars: 6, maxSpans: 2 } },
			{
				text: `A${" ".repeat(50)}B${" ".repeat(50)}C`,
				terms: ["A", "B", "C"],
				opts: { windowChars: 8, maxSpans: 10 },
			},
			{
				text: `start${" ".repeat(200)}end`,
				terms: ["start", "end"],
				opts: { windowChars: 30 },
			},
		];

		for (const { text, terms, opts } of cases) {
			const spans = extractRelevantSpans(text, terms, opts);
			assertInvariants(spans, text);
		}
	});
});
