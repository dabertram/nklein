import { describe, expect, it } from "vitest";
import type { LlmfitModel } from "../../../src/core/llmfit-adapter";
import { crossReferenceLlmfitWithCatalog, llmfitRoutingPrior } from "../../../src/core/llmfit-fitness-bridge";
import type { ToolUseVerdict } from "../../../src/core/model-capability-catalog";

function model(overrides: Partial<LlmfitModel> = {}): LlmfitModel {
	return {
		name: "some/model",
		bestQuant: "Q4_K_M",
		fitLevel: "Good",
		memoryRequiredGb: 8,
		memoryAvailableGb: 32,
		estimatedTps: 30,
		isMoe: false,
		moeOffloadedGb: null,
		installed: false,
		contextLength: 32000,
		effectiveContextLength: 32000,
		capabilityIds: [],
		score: 72,
		...overrides,
	} as LlmfitModel;
}

describe("llmfitRoutingPrior", () => {
	it("carries score → capabilityPrior and buckets tok/s into speed tiers", () => {
		expect(llmfitRoutingPrior(model({ score: 72, estimatedTps: 55 }))).toEqual({
			capabilityPrior: 72,
			speedTier: "fast",
			estimatedTps: 55,
		});
		expect(llmfitRoutingPrior(model({ estimatedTps: 20 })).speedTier).toBe("medium");
		expect(llmfitRoutingPrior(model({ estimatedTps: 5 })).speedTier).toBe("slow");
	});

	it("clamps an out-of-range score and nulls missing/zero numbers", () => {
		expect(llmfitRoutingPrior(model({ score: 140 })).capabilityPrior).toBe(100);
		expect(llmfitRoutingPrior(model({ score: -10 })).capabilityPrior).toBe(0);
		expect(llmfitRoutingPrior(model({ score: null })).capabilityPrior).toBeNull();
		expect(llmfitRoutingPrior(model({ estimatedTps: null })).speedTier).toBeNull();
		expect(llmfitRoutingPrior(model({ estimatedTps: 0 })).speedTier).toBeNull();
	});
});

describe("crossReferenceLlmfitWithCatalog", () => {
	const asEntry = (toolUse: ToolUseVerdict) => () => ({ toolUse });

	it("agree — both llmfit and the catalog say capable", () => {
		const xref = crossReferenceLlmfitWithCatalog(model({ capabilityIds: ["tool_use"] }), asEntry("TOOL_NATIVE"));
		expect(xref.toolUseAgreement).toBe("agree");
		expect(xref.empiricalToolUse).toBe("TOOL_NATIVE");
		expect(xref.authoritativeToolUse).toBe("TOOL_NATIVE");
	});

	it("conflict — llmfit claims tool_use but the catalog empirically found it unsuitable (catalog wins)", () => {
		const xref = crossReferenceLlmfitWithCatalog(
			model({ name: "some/chatty-reasoner", capabilityIds: ["tool_use"] }),
			asEntry("TOOL_UNSUITABLE"),
		);
		expect(xref.toolUseAgreement).toBe("conflict");
		// The authoritative signal is the measured verdict, NOT llmfit's optimistic tag.
		expect(xref.authoritativeToolUse).toBe("TOOL_UNSUITABLE");
		expect(xref.llmfitClaimsToolUse).toBe(true);
	});

	it("conflict also fires when the empirical verdict is merely TOOL_WEAK", () => {
		const xref = crossReferenceLlmfitWithCatalog(model({ capabilityIds: ["tool_use"] }), asEntry("TOOL_WEAK"));
		expect(xref.toolUseAgreement).toBe("conflict");
	});

	it("catalog-only — we know it's capable but llmfit didn't tag tool_use", () => {
		const xref = crossReferenceLlmfitWithCatalog(model({ capabilityIds: [] }), asEntry("TOOL_CAPABLE"));
		expect(xref.toolUseAgreement).toBe("catalog-only");
		expect(xref.authoritativeToolUse).toBe("TOOL_CAPABLE");
	});

	it("agree — neither source says capable", () => {
		const xref = crossReferenceLlmfitWithCatalog(model({ capabilityIds: [] }), asEntry("TOOL_UNSUITABLE"));
		expect(xref.toolUseAgreement).toBe("agree");
	});

	it("llmfit-only — llmfit claims tool_use and the catalog has no entry (unverified prior)", () => {
		const xref = crossReferenceLlmfitWithCatalog(model({ capabilityIds: ["tool_use"] }), () => null);
		expect(xref.toolUseAgreement).toBe("llmfit-only");
		expect(xref.empiricalToolUse).toBe("UNKNOWN");
		expect(xref.authoritativeToolUse).toBe("UNKNOWN");
	});

	it("no-data — neither llmfit nor the catalog has a tool-use signal", () => {
		const xref = crossReferenceLlmfitWithCatalog(model({ capabilityIds: [] }), () => null);
		expect(xref.toolUseAgreement).toBe("no-data");
		expect(xref.empiricalToolUse).toBe("UNKNOWN");
	});

	it("carries the fit level and routing prior through", () => {
		const xref = crossReferenceLlmfitWithCatalog(
			model({ fitLevel: "Marginal", score: 40, estimatedTps: 12 }),
			() => null,
		);
		expect(xref.fitLevel).toBe("Marginal");
		expect(xref.routingPrior).toEqual({ capabilityPrior: 40, speedTier: "slow", estimatedTps: 12 });
	});

	it("uses the real catalog by default (no injected lookup) without throwing", () => {
		// Smoke: the default path resolves the global catalog; an unknown name → UNKNOWN.
		const xref = crossReferenceLlmfitWithCatalog(model({ name: "totally/unknown-model-xyz", capabilityIds: [] }));
		expect(xref.empiricalToolUse).toBe("UNKNOWN");
		expect(["no-data", "llmfit-only"]).toContain(xref.toolUseAgreement);
	});
});
