import { describe, expect, it } from "vitest";
import { buildCrossModelBouncePrompt, parseCrossModelBounceReply } from "../../../src/core/cross-model-bounce";

describe("cross-model bounce (§5.AD cross_model_carry prompt substrate)", () => {
	it("builds a repair-the-deliverable prompt carrying task, draft, and the drafting model's identity", () => {
		const prompt = buildCrossModelBouncePrompt({
			task: "Implement the parser",
			draft: "function parse() { return null; }",
			draftModelId: "qwen3-8b",
		});
		expect(prompt.system).toContain("corrected deliverable IN FULL");
		expect(prompt.user).toContain("TASK:\nImplement the parser");
		expect(prompt.user).toContain("DRAFT (drafted by qwen3-8b):");
		expect(prompt.user).toContain("REPAIRED:");
	});

	it("parses findings + repaired deliverable; a missing REPAIRED section keeps the original (repaired: null)", () => {
		const parsed = parseCrossModelBounceReply(
			"FINDINGS:\n1. Returns null unconditionally.\n\nREPAIRED:\nfunction parse(s) { return JSON.parse(s); }",
		);
		expect(parsed.findings).toContain("Returns null");
		expect(parsed.repaired).toBe("function parse(s) { return JSON.parse(s); }");

		const noRepair = parseCrossModelBounceReply("Some prose without the sections.");
		expect(noRepair.repaired).toBeNull();
	});
});
