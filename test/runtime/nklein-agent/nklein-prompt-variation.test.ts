import { describe, expect, it } from "vitest";
import {
	buildPromptVariant,
	PROMPT_VARIANT_LADDER,
	type PromptVariantFamily,
} from "../../../src/nklein-agent/nklein-prompt-variation";

const INSTRUCTION = "Create a card titled Buy milk";

describe("buildPromptVariant", () => {
	it("preserves the instruction verbatim in EVERY family (framing changes, intent does not)", () => {
		for (const family of PROMPT_VARIANT_LADDER) {
			expect(buildPromptVariant(family, { instruction: INSTRUCTION })).toContain(INSTRUCTION);
		}
	});

	it("imperative leads with a direct command and names the tool when known", () => {
		expect(buildPromptVariant("imperative", { instruction: INSTRUCTION, toolName: "create_card" })).toBe(
			`Do this now — call the create_card tool:\n${INSTRUCTION}`,
		);
		expect(buildPromptVariant("imperative", { instruction: INSTRUCTION })).toBe(`Do this now:\n${INSTRUCTION}`);
	});

	it("explicit_format demands a single tool call and nothing else", () => {
		const out = buildPromptVariant("explicit_format", { instruction: INSTRUCTION, toolName: "create_card" });
		expect(out).toContain("single create_card tool call and nothing else");
	});

	it("example_led includes a worked, parseable example call mirroring the tool + args", () => {
		const out = buildPromptVariant("example_led", {
			instruction: INSTRUCTION,
			toolName: "create_card",
			exampleArguments: { title: "Example" },
		});
		const exampleLine = out.split("\n")[1];
		expect(JSON.parse(exampleLine)).toEqual({ tool: "create_card", arguments: { title: "Example" } });
	});

	it("example_led falls back to placeholder tool + empty args when none supplied", () => {
		const out = buildPromptVariant("example_led", { instruction: INSTRUCTION });
		expect(JSON.parse(out.split("\n")[1])).toEqual({ tool: "the_tool", arguments: {} });
	});

	it("reason_then_act prompts reason-first-then-call (the phase (a) prompt)", () => {
		const out = buildPromptVariant("reason_then_act", { instruction: INSTRUCTION });
		expect(out).toMatch(/think step by step/i);
		expect(out).toMatch(/then make that single tool call/i);
	});

	it("trims surrounding whitespace from the instruction", () => {
		expect(buildPromptVariant("imperative", { instruction: "  spaced  " })).toBe("Do this now:\nspaced");
	});

	it("the ladder is ordered cheapest-first and ends with reason_then_act", () => {
		const ladder: readonly PromptVariantFamily[] = PROMPT_VARIANT_LADDER;
		expect(ladder[0]).toBe("imperative");
		expect(ladder.at(-1)).toBe("reason_then_act");
		expect(new Set(ladder).size).toBe(ladder.length);
	});
});
