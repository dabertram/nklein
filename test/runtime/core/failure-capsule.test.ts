import { describe, expect, it } from "vitest";
import {
	buildFailureCapsule,
	type FailureCapsule,
	summarizeFailureCapsules,
	untriedStrategies,
} from "../../../src/core/failure-capsule";
import { retryLadderForOutcome } from "../../../src/core/retry-policy";

describe("failure-capsule", () => {
	it("builds a capsule, deriving a sensible whyFailed + evidence default from the outcome", () => {
		expect(buildFailureCapsule({ strategy: "reduced_tool_set", outcome: "no_tool_call" })).toEqual({
			strategy: "reduced_tool_set",
			outcome: "no_tool_call",
			evidence: "(no evidence captured)",
			whyFailed: "the model emitted no tool call",
		});
	});

	it("keeps caller-supplied evidence + whyFailed (trimmed)", () => {
		const capsule = buildFailureCapsule({
			strategy: "constrained_schema",
			outcome: "narrated",
			evidence: "  narrated create_card in prose  ",
			whyFailed: "  ignored the schema  ",
		});
		expect(capsule.evidence).toBe("narrated create_card in prose");
		expect(capsule.whyFailed).toBe("ignored the schema");
	});

	it("summarizes capsules into a do-not-repeat note (empty string when none)", () => {
		expect(summarizeFailureCapsules([])).toBe("");
		const capsules: FailureCapsule[] = [
			buildFailureCapsule({ strategy: "reduced_tool_set", outcome: "no_tool_call", evidence: "still no call" }),
			buildFailureCapsule({ strategy: "constrained_schema", outcome: "malformed", evidence: "bad JSON" }),
		];
		const note = summarizeFailureCapsules(capsules);
		expect(note).toContain("do NOT repeat");
		expect(note).toContain("1. tried reduced_tool_set → no_tool_call");
		expect(note).toContain("2. tried constrained_schema → malformed");
		expect(note).toContain("evidence: bad JSON");
	});

	it("untriedStrategies returns the ladder rungs not yet tried, in ladder order (no circles)", () => {
		const ladder = retryLadderForOutcome("no_tool_call"); // reduced_tool_set → constrained_schema → alternate_endpoint → prompt_variant → cross_model_carry
		const capsules: FailureCapsule[] = [
			buildFailureCapsule({ strategy: "reduced_tool_set", outcome: "no_tool_call" }),
			buildFailureCapsule({ strategy: "constrained_schema", outcome: "no_tool_call" }),
		];
		const remaining = untriedStrategies(capsules, ladder);
		expect(remaining).toEqual(["alternate_endpoint", "prompt_variant", "cross_model_carry"]);
		// All tried → empty.
		expect(
			untriedStrategies(
				ladder.map((strategy) => buildFailureCapsule({ strategy, outcome: "no_tool_call" })),
				ladder,
			),
		).toEqual([]);
	});
});
