import { describe, expect, it } from "vitest";
import { classifyExploreFailure } from "../../src/nklein-agent/nklein-explorer-runner";

/**
 * P21.7 follow-up — the explore helper query returns null on failure (nothing to salvage from a read-only
 * query), but a TIMEOUT must be told apart from a generic error so "explore keeps timing out" is visible. This
 * pins the classification the observation carries.
 */

describe("classifyExploreFailure", () => {
	it("classifies timeout-shaped messages as timeout", () => {
		for (const m of ["Explorer session timeout after 60s", "request timed out", "AbortError: aborted"]) {
			expect(classifyExploreFailure(m)).toBe("timeout");
		}
	});

	it("classifies everything else as error", () => {
		for (const m of ["ECONNREFUSED", "model returned malformed output", ""]) {
			expect(classifyExploreFailure(m)).toBe("error");
		}
	});
});
