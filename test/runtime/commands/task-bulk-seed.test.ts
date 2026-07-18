import { describe, expect, it } from "vitest";
import {
	BULK_SEED_MAX_INPUTS,
	parseBulkInputs,
	planBulkSeed,
	renderBulkTemplate,
} from "../../../src/commands/task/task-bulk-seed";

describe("task seed-bulk (F12.109)", () => {
	it("substitutes {input}, {i}, and {slug} tokens", () => {
		expect(renderBulkTemplate("Fix {input} (job {i}) → {slug}", "src/Auth Module.ts", 0)).toBe(
			"Fix src/Auth Module.ts (job 1) → src-auth-module-ts",
		);
	});

	it("parses inline and file-style inputs, dedupes, skips comments, and caps honestly", () => {
		expect(parseBulkInputs("a, b\nb\n# comment\nc")).toEqual(["a", "b", "c"]);
		expect(() =>
			parseBulkInputs(Array.from({ length: BULK_SEED_MAX_INPUTS + 1 }, (_, i) => `x${i}`).join(",")),
		).toThrow(/capped/);
	});

	it("plans one card per input with per-input titles and prompts", () => {
		const plan = planBulkSeed({
			promptTemplate: "Migrate {input} to the new logger.",
			titleTemplate: "Migrate {input}",
			inputs: ["a.ts", "b.ts"],
		});
		expect(plan).toEqual([
			{ input: "a.ts", title: "Migrate a.ts", prompt: "Migrate a.ts to the new logger." },
			{ input: "b.ts", title: "Migrate b.ts", prompt: "Migrate b.ts to the new logger." },
		]);
	});
});
