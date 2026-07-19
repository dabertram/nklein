import { describe, expect, it } from "vitest";
import {
	buildFleetCapabilitySummary,
	buildFleetDecompositionGuidance,
	type FleetModelClassInput,
	parseFleetDecompositionMode,
	selectDepthTargetClass,
} from "../../src/core/fleet-aware-decomposition";
import { buildNKleinStartPromptParts } from "../../src/nklein-agent/nklein-task-prompt-builders";

const gemma: FleetModelClassInput = {
	modelKey: "google/gemma-4-31b-qat",
	paramB: 31,
	workerCapability: 90,
	effectiveContextTokens: 65_000,
};
const ministral: FleetModelClassInput = {
	modelKey: "mistralai/ministral-3-14b-reasoning",
	paramB: 14,
	workerCapability: 70,
	effectiveContextTokens: 32_000,
};
const unmeasured7b: FleetModelClassInput = {
	modelKey: "tiny-7b",
	paramB: 7,
	workerCapability: null,
	effectiveContextTokens: null,
};

describe("fleet-aware decomposition (F12.110)", () => {
	it("parses modes with the auto default", () => {
		expect(parseFleetDecompositionMode("smallest")).toBe("smallest");
		expect(parseFleetDecompositionMode("fixed_target")).toBe("fixed_target");
		expect(parseFleetDecompositionMode(undefined)).toBe("auto");
		expect(parseFleetDecompositionMode("bogus")).toBe("auto");
	});

	it("summarizes, dedupes, and ranks measured above same-size unmeasured", () => {
		const summary = buildFleetCapabilitySummary([ministral, gemma, unmeasured7b, gemma]);
		expect(summary.classes.map((entry) => entry.modelKey)).toEqual([
			"google/gemma-4-31b-qat",
			"mistralai/ministral-3-14b-reasoning",
			"tiny-7b",
		]);
		expect(summary.strongest?.modelKey).toBe("google/gemma-4-31b-qat");
		expect(summary.weakest?.modelKey).toBe("tiny-7b");
	});

	it("selects the depth-target class per mode (weakest drives clearable-fleet-wide depth)", () => {
		const summary = buildFleetCapabilitySummary([gemma, ministral]);
		expect(selectDepthTargetClass(summary, "auto")?.modelKey).toBe(ministral.modelKey);
		expect(selectDepthTargetClass(summary, "smallest")?.modelKey).toBe(ministral.modelKey);
		expect(selectDepthTargetClass(summary, "fixed_target", gemma.modelKey)?.modelKey).toBe(gemma.modelKey);
		expect(selectDepthTargetClass(summary, "off")).toBeNull();
		expect(selectDepthTargetClass(buildFleetCapabilitySummary([]), "auto")).toBeNull();
	});

	it("renders the mixed-mode guidance naming strongest and weakest, capped and deterministic", () => {
		const summary = buildFleetCapabilitySummary([gemma, ministral, unmeasured7b]);
		const lines = buildFleetDecompositionGuidance(summary, "auto");
		expect(lines).toHaveLength(2);
		expect(lines[0]).toContain("Available model fleet (LOADED, 3 class(es))");
		expect(lines[1]).toContain("google/gemma-4-31b-qat");
		expect(lines[1]).toContain("tiny-7b");
		expect(buildFleetDecompositionGuidance(summary, "auto")).toEqual(lines);
	});

	it("renders smallest-mode guidance targeting the weakest class only", () => {
		const summary = buildFleetCapabilitySummary([gemma, ministral]);
		const lines = buildFleetDecompositionGuidance(summary, "smallest");
		expect(lines[1]).toContain("SMALLEST mode");
		expect(lines[1]).toContain(ministral.modelKey);
	});

	it("is byte-silent for off mode and empty snapshots", () => {
		expect(buildFleetDecompositionGuidance(buildFleetCapabilitySummary([gemma]), "off")).toEqual([]);
		expect(buildFleetDecompositionGuidance(buildFleetCapabilitySummary([]), "auto")).toEqual([]);
	});
});

// F12.110 wire — the fleet lines land in the PLANNING prompt only, byte-identical when absent.
describe("fleet guidance threading (F12.110 wire)", () => {
	const idea = "Decompose this idea into dependent implementation cards: build a chess PWA.";

	it("is byte-identical without guidance and appends the fleet block with it", () => {
		const plain = buildNKleinStartPromptParts(idea, true).systemPrompt ?? "";
		const withEmpty = buildNKleinStartPromptParts(idea, true, false, null, undefined, []).systemPrompt ?? "";
		expect(withEmpty).toBe(plain);
		const summary = buildFleetCapabilitySummary([
			{ modelKey: "big-31b", paramB: 31, workerCapability: 90, effectiveContextTokens: null },
			{ modelKey: "small-7b", paramB: 7, workerCapability: 40, effectiveContextTokens: null },
		]);
		const lines = buildFleetDecompositionGuidance(summary, "auto");
		const withFleet = buildNKleinStartPromptParts(idea, true, false, null, undefined, lines).systemPrompt ?? "";
		expect(withFleet).toContain("Available model fleet (LOADED, 2 class(es))");
		expect(withFleet).toContain("big-31b");
		expect(withFleet).not.toBe(plain);
	});
});
