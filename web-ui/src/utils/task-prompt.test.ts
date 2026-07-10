import { describe, expect, it } from "vitest";

import {
	clampTextWithInlineSuffix,
	getTaskPromptDescription,
	normalizePromptForDisplay,
	stripSkillRoutingPreamble,
	truncateTaskPromptLabel,
} from "@/utils/task-prompt";

describe("truncateTaskPromptLabel", () => {
	it("normalizes whitespace and truncates when needed", () => {
		expect(truncateTaskPromptLabel("hello\nworld", 20)).toBe("hello world");
		expect(truncateTaskPromptLabel("abcdefghijklmnopqrstuvwxyz", 5)).toBe("abcde…");
	});
});

describe("normalizePromptForDisplay", () => {
	it("collapses whitespace and trims", () => {
		expect(normalizePromptForDisplay("  hello\n\tworld  ")).toBe("hello world");
	});
});

describe("getTaskPromptDescription", () => {
	it("returns the suffix after a leading title", () => {
		expect(getTaskPromptDescription("Fix bugs: update tests", "Fix bugs")).toBe("update tests");
	});

	it("returns empty when prompt equals title", () => {
		expect(getTaskPromptDescription("Fix bugs", "Fix bugs")).toBe("");
	});

	it("strips XML wrapper tags from the prompt before comparing with the title", () => {
		expect(getTaskPromptDescription('<user_input mode="act">Fix the bug</user_input>', "Fix the bug")).toBe("");
	});
});

describe("clampTextWithInlineSuffix", () => {
	it("returns the full text when it fits within the available lines", () => {
		const measured = clampTextWithInlineSuffix("short description", {
			maxWidthPx: 20,
			maxLines: 3,
			suffix: "… See more",
			measureText: (value) => value.length,
		});
		expect(measured).toEqual({
			text: "short description",
			isTruncated: false,
		});
	});

	it("truncates text to leave room for the inline suffix", () => {
		const measured = clampTextWithInlineSuffix(
			"alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron",
			{
				maxWidthPx: 18,
				maxLines: 3,
				suffix: "… See more",
				measureText: (value) => value.length,
			},
		);
		expect(measured).toEqual({
			text: "alpha beta gamma delta epsilon zeta",
			isTruncated: true,
		});
	});
});

describe("stripSkillRoutingPreamble", () => {
	it("strips the /skill + Guidance-topic preamble !Klein prepends to decomposed prompts", () => {
		expect(
			getTaskPromptDescription(
				"/nklein-ts\n\nGuidance topic: ts\n\nCreate src/adapters/fhir-import.ts: a deterministic adapter.",
				"FHIR-shaped import adapter",
			),
		).toBe("Create src/adapters/fhir-import.ts: a deterministic adapter.");
	});

	it("leaves prompts that merely START with a slash-path untouched (no Guidance marker)", () => {
		expect(stripSkillRoutingPreamble("/src/main.ts needs a rewrite")).toBe("/src/main.ts needs a rewrite");
	});

	it("strips stacked skill blocks", () => {
		expect(
			stripSkillRoutingPreamble("/nklein-ts Guidance topic: ts /nklein-ui Guidance topic: ui Build the panel."),
		).toBe("Build the panel.");
	});
});
