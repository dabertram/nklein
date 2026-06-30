import { describe, expect, it } from "vitest";
import type { LlmfitFitLevel, LlmfitModel } from "../../../src/core/llmfit-adapter";
import { selectLlmfitRoster } from "../../../src/core/llmfit-roster";

function model(name: string, fitLevel: LlmfitFitLevel | null, toolUse: boolean): LlmfitModel {
	return {
		name,
		bestQuant: null,
		fitLevel,
		memoryRequiredGb: null,
		memoryAvailableGb: null,
		estimatedTps: null,
		isMoe: false,
		moeOffloadedGb: null,
		installed: false,
		contextLength: null,
		effectiveContextLength: null,
		capabilityIds: toolUse ? ["tool_use"] : ["vision"],
		score: null,
		category: null,
		license: null,
	};
}

const REC = (models: LlmfitModel[]) => ({ models, system: null });

describe("selectLlmfitRoster", () => {
	it("keeps fit-and-tool-capable models in llmfit's order; drops non-tool and too-tight ones", () => {
		const roster = selectLlmfitRoster(
			REC([
				model("perfect-tool", "Perfect", true),
				model("good-vision", "Good", false), // no tool use → dropped
				model("good-tool", "Good", true),
				model("marginal-tool", "Marginal", true), // below default minFit "Good" → dropped
			]),
		);
		expect(roster.map((m) => m.name)).toEqual(["perfect-tool", "good-tool"]);
	});

	it("requireToolUse:false keeps non-tool models too", () => {
		const roster = selectLlmfitRoster(REC([model("good-vision", "Good", false)]), { requireToolUse: false });
		expect(roster.map((m) => m.name)).toEqual(["good-vision"]);
	});

	it("minFit widens to include Marginal", () => {
		const roster = selectLlmfitRoster(REC([model("marginal-tool", "Marginal", true)]), { minFit: "Marginal" });
		expect(roster.map((m) => m.name)).toEqual(["marginal-tool"]);
	});

	it("caps to maxModels (preserving rank order)", () => {
		const roster = selectLlmfitRoster(
			REC([model("a", "Perfect", true), model("b", "Perfect", true), model("c", "Good", true)]),
			{ maxModels: 2 },
		);
		expect(roster.map((m) => m.name)).toEqual(["a", "b"]);
	});

	it("returns [] when nothing qualifies (unknown fit / no tool use)", () => {
		expect(selectLlmfitRoster(REC([model("x", null, true), model("y", "Good", false)]))).toEqual([]);
	});
});
