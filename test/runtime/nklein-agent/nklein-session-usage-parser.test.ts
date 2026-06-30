import { describe, expect, it } from "vitest";

import { readSessionUsage } from "../../../src/nklein-agent/nklein-session-usage-parser";

describe("readSessionUsage", () => {
	it("reads the canonical inputTokens/outputTokens spelling and defaults cache counts to 0", () => {
		expect(readSessionUsage({ inputTokens: 100, outputTokens: 40 })).toEqual({
			inputTokens: 100,
			outputTokens: 40,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		});
	});

	it("falls back to promptTokens / completionTokens / generatedTokens spellings", () => {
		expect(readSessionUsage({ promptTokens: 100, completionTokens: 40 })).toMatchObject({
			inputTokens: 100,
			outputTokens: 40,
		});
		expect(readSessionUsage({ inputTokens: 5, generatedTokens: 7 })).toMatchObject({
			inputTokens: 5,
			outputTokens: 7,
		});
	});

	it("carries explicit cache read/write counts", () => {
		expect(readSessionUsage({ inputTokens: 1, outputTokens: 2, cacheReadTokens: 9, cacheWriteTokens: 3 })).toEqual({
			inputTokens: 1,
			outputTokens: 2,
			cacheReadTokens: 9,
			cacheWriteTokens: 3,
		});
	});

	it("returns null when either input or output token count is missing", () => {
		expect(readSessionUsage({ inputTokens: 100 })).toBeNull();
		expect(readSessionUsage({ outputTokens: 40 })).toBeNull();
		expect(readSessionUsage({})).toBeNull();
	});

	it("returns null for a non-record value", () => {
		expect(readSessionUsage(null)).toBeNull();
		expect(readSessionUsage("usage")).toBeNull();
		expect(readSessionUsage(42)).toBeNull();
	});

	it("rejects a negative token count (treated as missing → null)", () => {
		expect(readSessionUsage({ inputTokens: -1, outputTokens: 40 })).toBeNull();
	});
});
