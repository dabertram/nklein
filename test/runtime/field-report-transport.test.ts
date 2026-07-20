import { describe, expect, it } from "vitest";
import {
	detectHiddenCharacters,
	projectReviewState,
	type ReviewItem,
	renderIssueDraft,
} from "../../src/core/field-report-transport";

function item(key: string, bytes: string, included = true, layer: ReviewItem["layer"] = "A"): ReviewItem {
	return { key, layer, bytes, reveals: `what ${key} shows`, included };
}

describe("projectReviewState", () => {
	it("tracks CURRENT exposure so a toggle immediately changes what the user sees", () => {
		const state = projectReviewState([item("a", "aaa"), item("b", "bb", false)]);
		expect(state.includedCount).toBe(1);
		expect(state.totalBytes).toBe(3);
		expect(state.revealsNow).toEqual(["what a shows"]);
	});

	it("reports zero exposure when nothing is included", () => {
		const state = projectReviewState([item("a", "aaa", false)]);
		expect(state.includedCount).toBe(0);
		expect(state.revealsNow).toEqual([]);
	});
});

describe("detectHiddenCharacters", () => {
	it("finds a zero-width space and names its code point", () => {
		const findings = detectHiddenCharacters([item("sneaky", "hello\u200Bworld")]);
		expect(findings).toHaveLength(1);
		expect(findings[0]?.codePoints).toContain("U+200B");
	});

	it("finds Unicode TAG-block characters — the arXiv 2607.05744 payload class", () => {
		const findings = detectHiddenCharacters([item("tagged", "ok\u{E0041}")]);
		expect(findings).toHaveLength(1);
	});

	it("finds bidi overrides", () => {
		expect(detectHiddenCharacters([item("bidi", "a\u202Eb")])).toHaveLength(1);
	});

	it("ignores EXCLUDED items — only what is being sent matters", () => {
		expect(detectHiddenCharacters([item("off", "x\u200By", false)])).toHaveLength(0);
	});

	it("passes clean text, including normal newlines and tabs", () => {
		expect(detectHiddenCharacters([item("clean", "line one\nline two\tindented")])).toHaveLength(0);
	});
});

describe("renderIssueDraft", () => {
	it("REFUSES to render when hidden characters are unacknowledged", () => {
		const state = projectReviewState([item("sneaky", "payload\u200Bhere")]);
		const result = renderIssueDraft(state, { title: "T", disclosure: "D" });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain("would travel unseen");
			expect(result.hiddenCharacters[0]?.codePoints).toContain("U+200B");
		}
	});

	it("renders once the user has acknowledged them", () => {
		const state = projectReviewState([item("sneaky", "payload\u200Bhere")]);
		const result = renderIssueDraft(state, {
			title: "T",
			disclosure: "D",
			acknowledgedHiddenCharacters: true,
		});
		expect(result.ok).toBe(true);
	});

	it("states plainly that a person sent it, not !Klein", () => {
		const result = renderIssueDraft(projectReviewState([item("a", "x")]), { title: "T", disclosure: "D" });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.markdown).toContain("!Klein did not send this");
		}
	});

	it("includes only the toggled-on items, byte-for-byte", () => {
		const state = projectReviewState([item("in", "KEEP"), item("out", "DROP", false)]);
		const result = renderIssueDraft(state, { title: "T", disclosure: "D" });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.markdown).toContain("KEEP");
			expect(result.markdown).not.toContain("DROP");
		}
	});

	it("always carries the disclosure, even with nothing included", () => {
		const result = renderIssueDraft(projectReviewState([item("a", "x", false)]), {
			title: "T",
			disclosure: "2 fields were WITHHELD",
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.markdown).toContain("2 fields were WITHHELD");
			expect(result.markdown).toContain("No items were included");
		}
	});
});
