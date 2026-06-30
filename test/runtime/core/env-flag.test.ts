import { describe, expect, it } from "vitest";

import { isTruthyEnv } from "../../../src/core/env-flag";

describe("isTruthyEnv", () => {
	it("is false for undefined / empty", () => {
		expect(isTruthyEnv(undefined)).toBe(false);
		expect(isTruthyEnv("")).toBe(false);
	});

	it("accepts the canonical truthy tokens (case-insensitive, trimmed)", () => {
		for (const v of ["1", "true", "TRUE", "yes", "Yes", "on", "ON", "  true  ", " 1 "]) {
			expect(isTruthyEnv(v)).toBe(true);
		}
	});

	it("is false for anything else", () => {
		for (const v of ["0", "false", "no", "off", "2", "truthy", "enable", "y"]) {
			expect(isTruthyEnv(v)).toBe(false);
		}
	});
});
