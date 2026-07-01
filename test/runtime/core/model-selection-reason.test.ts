import { describe, expect, it } from "vitest";
import {
	effectiveSelectionCapability,
	explainModelSelection,
	renderModelSelectionReason,
} from "../../../src/core/model-selection-reason";

describe("effectiveSelectionCapability", () => {
	it("uses the ledger-blended capability only when ledger evidence backs it", () => {
		expect(
			effectiveSelectionCapability({
				modelKey: "m",
				registryCapability: 80,
				observedCapability: 50,
				ledgerSamples: 5,
				contextWindow: 0,
			}),
		).toBe(50);
		// No samples ⇒ the registry score governs even if an observedCapability is present.
		expect(
			effectiveSelectionCapability({
				modelKey: "m",
				registryCapability: 80,
				observedCapability: 50,
				ledgerSamples: 0,
				contextWindow: 0,
			}),
		).toBe(80);
		// Null observed ⇒ registry score.
		expect(
			effectiveSelectionCapability({
				modelKey: "m",
				registryCapability: 80,
				observedCapability: null,
				ledgerSamples: 9,
				contextWindow: 0,
			}),
		).toBe(80);
	});
});

describe("explainModelSelection", () => {
	const candidates = [
		{ modelKey: "ollama:small:default", registryCapability: 45, contextWindow: 16_000, isFree: true },
		{ modelKey: "lmstudio:big:default", registryCapability: 85, contextWindow: 80_000, isFree: true },
	];

	it("marks feasibility against the difficulty bar and context need, and flags the selected model", () => {
		const reason = explainModelSelection({
			difficulty: 60,
			requiredContextTokens: 20_000,
			decisionKind: "assign",
			selectedModelKey: "lmstudio:big:default",
			candidates,
		});
		// big is feasible + selected → sorts first; small is ruled out on BOTH capability and window.
		expect(reason.candidates[0].modelKey).toBe("lmstudio:big:default");
		expect(reason.candidates[0].selected).toBe(true);
		expect(reason.candidates[0].feasible).toBe(true);
		const small = reason.candidates.find((c) => c.modelKey === "ollama:small:default");
		expect(small?.feasible).toBe(false);
		expect(small?.exclusions).toHaveLength(2);
		expect(small?.exclusions[0]).toMatch(/below task difficulty 60/);
		expect(small?.exclusions[1]).toMatch(/below the 20000 tokens/);
		expect(reason.summary).toContain("selected lmstudio:big:default");
		expect(reason.summary).toContain("registry capability 85");
	});

	it("explains a ledger-blended pick by citing the observed evidence", () => {
		const reason = explainModelSelection({
			difficulty: 40,
			requiredContextTokens: 8_000,
			decisionKind: "assign",
			selectedModelKey: "lmstudio:big:default",
			candidates: [
				{
					modelKey: "lmstudio:big:default",
					registryCapability: 85,
					observedCapability: 55,
					ledgerSamples: 7,
					contextWindow: 80_000,
					isFree: true,
				},
			],
		});
		expect(reason.candidates[0].effectiveCapability).toBe(55);
		expect(reason.summary).toContain("ledger-blended capability 55 (7 run(s))");
	});

	it("summarizes a decompose decision when no single model fits", () => {
		const reason = explainModelSelection({
			difficulty: 90,
			requiredContextTokens: 12_000,
			decisionKind: "decompose",
			selectedModelKey: null,
			decisionReason: "Split into smaller cards.",
			candidates,
		});
		expect(reason.selectedModelKey).toBeNull();
		expect(reason.summary).toContain("decompose the task");
		expect(reason.summary).toContain("Split into smaller cards.");
		expect(reason.summary).toContain("0/2 models feasible");
	});

	it("renders an operator text block with per-candidate markers", () => {
		const reason = explainModelSelection({
			difficulty: 60,
			requiredContextTokens: 20_000,
			decisionKind: "assign",
			selectedModelKey: "lmstudio:big:default",
			candidates,
		});
		const text = renderModelSelectionReason(reason);
		expect(text).toContain("→ lmstudio:big:default");
		expect(text).toContain("✗ ollama:small:default");
		expect(text).toContain("ruled out:");
	});

	it("explains the §5.AB affinity match — why the best-fit model won", () => {
		const reason = explainModelSelection({
			difficulty: 40,
			requiredContextTokens: 8_000,
			decisionKind: "assign",
			selectedModelKey: "lmstudio:coder:default",
			taskAffinityTags: ["code", "agentic"],
			candidates: [
				{
					modelKey: "lmstudio:coder:default",
					registryCapability: 62,
					contextWindow: 40_000,
					isFree: true,
					affinityTags: ["code", "agentic", "instruct"],
				},
				{
					modelKey: "lmstudio:general:default",
					registryCapability: 62,
					contextWindow: 40_000,
					isFree: true,
					affinityTags: ["instruct"],
				},
			],
		});
		const coder = reason.candidates.find((c) => c.modelKey === "lmstudio:coder:default");
		const general = reason.candidates.find((c) => c.modelKey === "lmstudio:general:default");
		expect(new Set(coder?.affinityMatchTags)).toEqual(new Set(["code", "agentic"]));
		expect(general?.affinityMatchTags).toEqual([]); // no overlap with the card's tags
		expect(reason.summary).toContain("best-fit for [code, agentic]");
		expect(renderModelSelectionReason(reason)).toContain("best-fit[");
	});

	it("omits affinity language when the task carries no tags (back-compat)", () => {
		const reason = explainModelSelection({
			difficulty: 40,
			requiredContextTokens: 8_000,
			decisionKind: "assign",
			selectedModelKey: "lmstudio:big:default",
			candidates: [
				{ modelKey: "lmstudio:big:default", registryCapability: 85, contextWindow: 80_000, affinityTags: ["code"] },
			],
		});
		expect(reason.candidates[0].affinityMatchTags).toEqual([]); // no task tags ⇒ no match computed
		expect(reason.summary).not.toContain("best-fit");
	});
});
