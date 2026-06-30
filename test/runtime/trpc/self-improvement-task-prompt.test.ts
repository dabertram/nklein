import { describe, expect, it } from "vitest";

import { buildSelfImprovementTaskPrompt } from "../../../src/trpc/self-improvement-task-prompt";

describe("buildSelfImprovementTaskPrompt", () => {
	it("always includes the source checkout, the standing driver, and acceptance criteria", () => {
		const prompt = buildSelfImprovementTaskPrompt({ workspacePath: "/dev/klein" });
		expect(prompt.startsWith("/nklein-ts")).toBe(true);
		expect(prompt).toContain("Current dev checkout: /dev/klein");
		expect(prompt).toContain("Main driver:");
		expect(prompt).toContain("Acceptance:");
	});

	it("omits Evidence and User notes sections when neither is given", () => {
		const prompt = buildSelfImprovementTaskPrompt({ workspacePath: "/dev/klein" });
		expect(prompt).not.toContain("Evidence:");
		expect(prompt).not.toContain("User notes:");
	});

	it("appends an Evidence section for a non-blank evidence bundle path", () => {
		const prompt = buildSelfImprovementTaskPrompt({ workspacePath: "/w", evidenceBundlePath: "  /ev/bundle  " });
		expect(prompt).toContain("Evidence:");
		expect(prompt).toContain("- Bundle: /ev/bundle"); // trimmed
	});

	it("appends a User notes section for non-blank notes (trimmed)", () => {
		const prompt = buildSelfImprovementTaskPrompt({ workspacePath: "/w", notes: "  focus on retries  " });
		expect(prompt).toContain("User notes:");
		expect(prompt).toContain("focus on retries");
	});

	it("treats blank/whitespace-only evidence and notes as absent", () => {
		const prompt = buildSelfImprovementTaskPrompt({ workspacePath: "/w", evidenceBundlePath: "   ", notes: "  " });
		expect(prompt).not.toContain("Evidence:");
		expect(prompt).not.toContain("User notes:");
	});
});
