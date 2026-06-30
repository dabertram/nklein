import { describe, expect, it } from "vitest";

import { toSlug } from "../../../src/core/slugify";

describe("toSlug", () => {
	it("lowercases, collapses non-alphanumerics to single dashes, and trims edge dashes", () => {
		expect(toSlug("Hello World")).toBe("hello-world");
		expect(toSlug("  Plan: Task #42!!  ")).toBe("plan-task-42");
		expect(toSlug("a___b---c   d")).toBe("a-b-c-d");
		expect(toSlug("--Lead/Trail__")).toBe("lead-trail");
		expect(toSlug("Keep123Digits")).toBe("keep123digits");
	});

	it("returns the empty string when nothing survives (callers apply their own fallback)", () => {
		expect(toSlug("")).toBe("");
		expect(toSlug("   ")).toBe("");
		expect(toSlug("!!!___---")).toBe("");
	});
});
