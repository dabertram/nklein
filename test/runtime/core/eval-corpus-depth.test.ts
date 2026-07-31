import { describe, expect, it } from "vitest";
import { estimateTextTokens } from "../../../src/core/eval-context-footprint";
import { buildReviewInput, EVAL_PROMPT_CORPUS } from "../../../src/core/eval-prompt-corpus";
import { classifyContextDepth } from "../../../src/core/model-fitness-freshness";

/**
 * P22.2 — the DEPTH of the evidence every fitness number is built from.
 *
 * ⚠️ **THIS FILE'S FIRST VERSION WAS WRONG, and the way it was wrong is worth keeping.** It measured
 * `estimateTextTokens(JSON.stringify(prompt))` and concluded the corpus was ENTIRELY shallow. But a
 * `context_probe` prompt is a compact SPEC — `{contextTokens, needle, needleDepth}` — whose haystack is generated
 * at run time, so its stored size says nothing about the context the model actually sees. Measuring the spec of a
 * 24k probe as ~200 tokens is measuring the recipe instead of the meal.
 *
 * The corrected measurement is below, and the real finding survives in a sharper form: **depth is covered ONLY
 * for needle retrieval.** Every family that represents actual agent work — decompose, implement, review, tool_use
 * — is measured exclusively at shallow depth. Phase 22's own research is that retrieval at depth and agent work at
 * depth are different capabilities, so a 24k needle probe does not license any claim about decomposing at 24k.
 */

/** Runtime context a prompt actually puts in front of the model — the generated haystack, not the stored spec. */
function runtimeContextTokens(prompt: (typeof EVAL_PROMPT_CORPUS)[number]): number {
	if (prompt.family === "context_probe") {
		return prompt.contextTokens;
	}
	// A depth-padded review expands at run time too — same spec-vs-runtime trap, different family.
	if (prompt.family === "review") {
		return estimateTextTokens(buildReviewInput(prompt));
	}
	return estimateTextTokens(JSON.stringify(prompt));
}

describe("eval corpus context depth", () => {
	const rows = EVAL_PROMPT_CORPUS.map((prompt) => ({
		id: prompt.id,
		family: prompt.family,
		depth: classifyContextDepth(runtimeContextTokens(prompt)),
	}));

	it("measures the RUNTIME context, not the stored spec", () => {
		// The bug this pins: a context_probe's spec is tiny while its haystack is huge. Measuring the spec made a
		// 24k probe look like a ~200-token prompt and produced a confidently wrong "entirely shallow" verdict.
		const deepProbe = EVAL_PROMPT_CORPUS.find((prompt) => prompt.id === "context-probe-24k");
		expect(deepProbe, "the 24k probe is the case that exposes spec-vs-runtime").toBeDefined();
		expect(runtimeContextTokens(deepProbe as never)).toBe(24_000);
		expect(estimateTextTokens(JSON.stringify(deepProbe)), "its stored spec is tiny").toBeLessThan(1_000);
	});

	it("REVIEW now has a depth-padded prompt — the first agent-work family above shallow", () => {
		// The matched pair is what makes it useful: the deep row seeds the SAME defects as its shallow twin, so a
		// score difference isolates depth from difficulty rather than confounding them.
		const deep = rows.find((row) => row.id === "review-null-and-unhandled-rejection-deep");
		expect(deep?.depth).toBe("deep");
		const shallowTwin = EVAL_PROMPT_CORPUS.find((p) => p.id === "review-null-and-unhandled-rejection");
		const deepPrompt = EVAL_PROMPT_CORPUS.find((p) => p.id === "review-null-and-unhandled-rejection-deep");
		expect(
			deepPrompt?.family === "review" ? deepPrompt.seededDefects : null,
			"the pair must seed identical defects or the comparison measures difficulty, not depth",
		).toEqual(shallowTwin?.family === "review" ? shallowTwin.seededDefects : undefined);
	});

	it("has graduated depth coverage for RETRIEVAL", () => {
		const probeDepths = rows.filter((row) => row.family === "context_probe").map((row) => row.depth);
		expect(new Set(probeDepths)).toEqual(new Set(["shallow", "medium", "deep"]));
	});

	it("⚠️ every AGENT-WORK family is measured at SHALLOW depth ONLY — P22.2's real gap", () => {
		// This is the finding that survived the correction. Phase 22's research is that capability at depth is not
		// predicted by capability at depth 0 — and decompose/review/implement/tool_use, the families that decide
		// routing for real cards, have no evidence above the shallow band at all. A needle probe at 24k measures
		// retrieval, which is a different capability from decomposing a spec at 24k.
		// `review` was REMOVED from this list on 2026-07-31 when the first depth-padded agent-work prompt landed
		// (`review-null-and-unhandled-rejection-deep`, ~16.6k tokens). The remaining three are the live gap.
		const agentWorkFamilies = ["decompose", "implement", "tool_use"] as const;
		for (const family of agentWorkFamilies) {
			const depths = new Set(rows.filter((row) => row.family === family).map((row) => row.depth));
			expect(
				depths,
				`${family} gained non-shallow coverage — update this deliberately and make sure the fitness store records it (todo P22.2)`,
			).toEqual(new Set(["shallow"]));
		}
	});

	it("pins the overall distribution so a change is deliberate", () => {
		const distribution = { shallow: 0, medium: 0, deep: 0 };
		for (const row of rows) {
			distribution[row.depth] += 1;
		}
		expect(distribution, "corpus depth changed — see todo P22.2").toEqual({ shallow: 13, medium: 1, deep: 2 });
	});
});
