import { describe, expect, it } from "vitest";
import { runtimeBoardCardSchema } from "../../../src/core/board-api-contract";

// The minimal required fields of a board card; each test spreads its case on top.
const baseCard = {
	id: "c1",
	prompt: "Do the thing",
	startInPlanMode: false,
	baseRef: "main",
	createdAt: 1,
	updatedAt: 2,
};

describe("runtimeBoardCardSchema transform — legacy nklein-settings migration", () => {
	it("folds legacy nkleinProviderId/nkleinModelId into nkleinSettings and strips the legacy top-level fields", () => {
		const card = runtimeBoardCardSchema.parse({ ...baseCard, nkleinProviderId: "prov", nkleinModelId: "mod" });
		expect(card.nkleinSettings).toEqual({ providerId: "prov", modelId: "mod" });
		expect(card).not.toHaveProperty("nkleinProviderId");
		expect(card).not.toHaveProperty("nkleinModelId");
	});

	it("keeps a modern nkleinSettings as-is and ignores legacy fields when both are present (modern wins)", () => {
		const card = runtimeBoardCardSchema.parse({
			...baseCard,
			nkleinSettings: { modelId: "modern" },
			nkleinModelId: "legacy",
		});
		expect(card.nkleinSettings).toEqual({ modelId: "modern" });
	});

	it("omits nkleinSettings entirely when neither modern nor legacy settings are present", () => {
		const card = runtimeBoardCardSchema.parse(baseCard);
		expect(card).not.toHaveProperty("nkleinSettings");
	});

	it("trims legacy id whitespace", () => {
		const card = runtimeBoardCardSchema.parse({ ...baseCard, nkleinModelId: "  m  " });
		expect(card.nkleinSettings).toEqual({ modelId: "m" });
	});

	it("drops a 'default' reasoning effort but keeps a non-default one", () => {
		const dropped = runtimeBoardCardSchema.parse({
			...baseCard,
			nkleinModelId: "m",
			nkleinReasoningEffort: "default",
		});
		expect(dropped.nkleinSettings).toEqual({ modelId: "m" }); // "default" dropped

		const kept = runtimeBoardCardSchema.parse({ ...baseCard, nkleinModelId: "m", nkleinReasoningEffort: "high" });
		expect(kept.nkleinSettings).toEqual({ modelId: "m", reasoningEffort: "high" });
	});

	it("never leaves a legacy nkleinReasoningEffort on the parsed card", () => {
		const card = runtimeBoardCardSchema.parse({ ...baseCard, nkleinReasoningEffort: "low", nkleinModelId: "m" });
		expect(card).not.toHaveProperty("nkleinReasoningEffort");
	});
});

describe("runtimeBoardCardSchema transform — title resolution", () => {
	it("keeps an explicit title", () => {
		const card = runtimeBoardCardSchema.parse({ ...baseCard, title: "My Card" });
		expect(card.title).toBe("My Card");
	});

	it("derives a non-empty title from the prompt when none is given", () => {
		const card = runtimeBoardCardSchema.parse({ ...baseCard, title: undefined, prompt: "Fix the login bug" });
		expect(typeof card.title).toBe("string");
		expect((card.title ?? "").length).toBeGreaterThan(0);
	});
});
