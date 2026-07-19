import { describe, expect, it } from "vitest";
import { parsePromptIntentMode } from "../../../src/core/prompt-intent-mode";
import { buildSessionSystemPrompt } from "../../../src/nklein-agent/nklein-session-system-prompt";

/**
 * F4.39 threading net: the session assembly honors an intent mode with a byte-identical default, base fragments
 * are un-droppable (essential by omission), and only tier-tagged skill fragments can be shed by minimize/balance.
 */
describe("session prompt intent-mode threading (F4.39)", () => {
	const input = {
		basePrompt: "You are the worker.",
		baseIsStaticShell: true,
		efficiencyRules: "Be brief.",
		temporalBlock: "",
		skillFragments: [
			{ key: "structural-retrieval", volatility: "config", text: "Use search_graph first.", tier: "standard" },
			{
				key: "procedural-skill:s1",
				volatility: "config",
				text: "Learned procedure — pin versions.",
				tier: "enriching",
			},
		],
	} as const;

	it("defaults to max_task_info and is byte-identical to the explicit mode", () => {
		const byDefault = buildSessionSystemPrompt(input);
		const explicit = buildSessionSystemPrompt({ ...input, intentMode: "max_task_info" });
		expect(byDefault.text).toBe(explicit.text);
		expect(byDefault.text).toContain("Use search_graph first.");
		expect(byDefault.text).toContain("pin versions");
	});

	it("balance keeps standard-tier fragments and sheds enriching ones", () => {
		const text = buildSessionSystemPrompt({ ...input, intentMode: "balance" }).text;
		expect(text).toContain("Use search_graph first.");
		expect(text).not.toContain("pin versions");
	});

	it("minimize sheds every tier-tagged fragment but never the un-tiered base", () => {
		const text = buildSessionSystemPrompt({ ...input, intentMode: "minimize" }).text;
		expect(text).toContain("You are the worker.");
		expect(text).toContain("Be brief.");
		expect(text).not.toContain("Use search_graph first.");
		expect(text).not.toContain("pin versions");
	});

	it("parses the configured mode with a byte-identical-safe default", () => {
		expect(parsePromptIntentMode("minimize")).toBe("minimize");
		expect(parsePromptIntentMode("balance")).toBe("balance");
		expect(parsePromptIntentMode("max_task_info")).toBe("max_task_info");
		expect(parsePromptIntentMode(undefined)).toBe("max_task_info");
		expect(parsePromptIntentMode("bogus")).toBe("max_task_info");
	});
});

// F12.9 pre-flight advisory — flag-gated, byte-identical off, capped advisory lines on.
import { buildNKleinStartPromptParts } from "../../../src/nklein-agent/nklein-task-prompt-builders";

describe("spec-lint pre-flight advisory (F12.9)", () => {
	const gapIdea = "Decompose this idea into dependent implementation cards: make the app fast and modern.";

	it("is byte-identical with the flag off", () => {
		const before = process.env.NKLEIN_SPEC_LINT;
		delete process.env.NKLEIN_SPEC_LINT;
		try {
			const prompt = buildNKleinStartPromptParts(gapIdea, true).systemPrompt ?? "";
			expect(prompt).not.toContain("Spec gaps detected");
		} finally {
			if (before !== undefined) {
				process.env.NKLEIN_SPEC_LINT = before;
			}
		}
	});

	it("appends capped advisory findings with ready-to-ask questions when enabled", () => {
		const before = process.env.NKLEIN_SPEC_LINT;
		process.env.NKLEIN_SPEC_LINT = "1";
		try {
			const prompt = buildNKleinStartPromptParts(gapIdea, true).systemPrompt ?? "";
			expect(prompt).toContain("Spec gaps detected by pre-flight lint");
			expect(prompt).toContain("Consider asking:");
			const advisoryLines = prompt
				.split("\n")
				.filter((line) => line.startsWith("- ") && line.includes("Consider asking:"));
			expect(advisoryLines.length).toBeGreaterThan(0);
			expect(advisoryLines.length).toBeLessThanOrEqual(3);
		} finally {
			if (before === undefined) {
				delete process.env.NKLEIN_SPEC_LINT;
			} else {
				process.env.NKLEIN_SPEC_LINT = before;
			}
		}
	});
});
