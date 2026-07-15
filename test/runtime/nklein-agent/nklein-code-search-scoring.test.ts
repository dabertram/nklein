import { describe, expect, it } from "vitest";
import { scoreLine, tokenizeQuery } from "../../../src/nklein-agent/nklein-code-search";

describe("tokenizeQuery", () => {
	it("splits on non-identifier chars, drops <2-char tokens, and dedupes", () => {
		expect(tokenizeQuery("foo bar foo")).toEqual(["foo", "bar"]);
		expect(tokenizeQuery("a b cc")).toEqual(["cc"]); // single-char tokens dropped
		expect(tokenizeQuery("getUser(id):User")).toEqual(["getUser", "id", "User"]);
	});
});

describe("scoreLine", () => {
	it("scores zero when neither the query nor any token appears", () => {
		expect(scoreLine("totally unrelated line", "fooBar", ["fooBar"])).toBe(0);
	});

	it("ranks a full-query line above a token-only line", () => {
		const full = scoreLine("const fooBar = compute()", "fooBar", ["fooBar"]);
		const tokenOnly = scoreLine("call foo somewhere", "foo bar", ["foo", "bar"]);
		expect(full).toBeGreaterThan(0);
		expect(tokenOnly).toBeGreaterThan(0);
		expect(full).toBeGreaterThan(tokenOnly);
	});

	it("gives a declaration line a bonus over a plain line matching the same token", () => {
		const tokens = ["handler"];
		const declaration = scoreLine("export function handler(req) {", "handler", tokens);
		const plain = scoreLine("      handler.call(req)", "handler", tokens);
		expect(declaration).toBeGreaterThan(plain);
	});

	it("adds a word-boundary bonus (whole-word match beats a substring-only match)", () => {
		const tokens = ["cat"];
		const wholeWord = scoreLine("the cat sat", "cat", tokens);
		const substring = scoreLine("concatenate values", "cat", tokens);
		expect(wholeWord).toBeGreaterThan(substring);
	});
});
