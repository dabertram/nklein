import { describe, expect, it } from "vitest";
import { parseRemovedProjectPathFromStreamError, shouldRequestProjectNavigation } from "@/hooks/use-project-navigation";

describe("parseRemovedProjectPathFromStreamError", () => {
	it("extracts removed project paths", () => {
		expect(
			parseRemovedProjectPathFromStreamError("Project no longer exists on disk and was removed: /tmp/project"),
		).toBe("/tmp/project");
	});

	it("returns null when prefix is not present", () => {
		expect(parseRemovedProjectPathFromStreamError("Something else happened")).toBeNull();
	});
});

describe("shouldRequestProjectNavigation", () => {
	it("ignores an empty or already-selected target", () => {
		expect(shouldRequestProjectNavigation("", "project-a", null)).toBe(false);
		expect(shouldRequestProjectNavigation("project-a", "project-a", null)).toBe(false);
	});

	it("compares against the pending navigation target so a rapid reversal is not dropped", () => {
		// A is still the streamed project while B is pending. Clicking B again is a no-op, but clicking A must request
		// a reversal; comparing only against currentProjectId would incorrectly discard it.
		expect(shouldRequestProjectNavigation("project-b", "project-a", "project-b")).toBe(false);
		expect(shouldRequestProjectNavigation("project-a", "project-a", "project-b")).toBe(true);
	});

	it("accepts a different target after the previous request has settled", () => {
		expect(shouldRequestProjectNavigation("project-c", "project-b", "project-b")).toBe(true);
	});
});
