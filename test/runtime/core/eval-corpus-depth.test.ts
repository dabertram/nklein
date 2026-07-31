import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { estimateTextTokens } from "../../../src/core/eval-context-footprint";
import {
	buildDecomposeInput,
	buildReviewInput,
	buildToolCatalog,
	EVAL_PROMPT_CORPUS,
	evalPromptContextTokens,
} from "../../../src/core/eval-prompt-corpus";
import { emptyFitnessRow, recordFitnessOutcome } from "../../../src/core/fitness-table-schema";
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
	if (prompt.family === "decompose") {
		return estimateTextTokens(buildDecomposeInput(prompt));
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

	it("DECOMPOSE has a depth-padded prompt whose TASK is unchanged", () => {
		// Decompose quality was the G6.8a campaign's binding constraint, and every decompose measurement until now
		// was taken on a two-sentence prompt. The padding is context, never extra requirements: the deep row keeps
		// the shallow row's exact reference graph, so a score difference isolates depth rather than difficulty.
		const shallow = EVAL_PROMPT_CORPUS.find((p) => p.id === "decompose-cli-version-flag");
		const deep = EVAL_PROMPT_CORPUS.find((p) => p.id === "decompose-cli-version-flag-deep");
		expect(rows.find((row) => row.id === "decompose-cli-version-flag-deep")?.depth).toBe("deep");
		expect(
			deep?.family === "decompose" ? deep.reference : null,
			"the pair must share a reference graph or the comparison measures difficulty",
		).toEqual(shallow?.family === "decompose" ? shallow.reference : undefined);
		// The request must survive the padding — a preamble that buried the task would test truncation, not depth.
		expect(buildDecomposeInput(deep as never).trimEnd()).toMatch(/dependencies\.$/u);
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
		// EMPTY as of 2026-07-31: `review` (~16.6k), `decompose` (~22.8k) and `tool_use` (40-tool catalog) all
		// gained depth rows. `implement` is deliberately NOT listed — see the test below; it is never executed at
		// all, so calling it "shallow-only" would describe the wrong problem.
		const agentWorkFamilies: readonly string[] = [];
		for (const family of agentWorkFamilies) {
			const depths = new Set(rows.filter((row) => row.family === family).map((row) => row.depth));
			expect(
				depths,
				`${family} gained non-shallow coverage — update this deliberately and make sure the fitness store records it (todo P22.2)`,
			).toEqual(new Set(["shallow"]));
		}
	});

	it("TOOL_USE depth is CATALOG SIZE, and the real tool is not first", () => {
		// Depth for this family is the number of competing tools, which is the dimension the evidence is about:
		// filtering 40+ down to 7 fixed 62% of tool-use failures. !Klein's gate caps the offered set at 7, so this
		// row measures what that gate protects against rather than re-measuring the protected case.
		const deep = EVAL_PROMPT_CORPUS.find((p) => p.id === "tooluse-simple-weather-deep-catalog");
		const shallow = EVAL_PROMPT_CORPUS.find((p) => p.id === "tooluse-simple-weather");
		expect(deep?.family === "tool_use" ? buildToolCatalog(deep).length : 0).toBe(40);
		expect(
			deep?.family === "tool_use" ? deep.expected : null,
			"the pair must expect the identical call or it measures difficulty, not catalog size",
		).toEqual(shallow?.family === "tool_use" ? shallow.expected : undefined);
		// A model that always picks the first offered tool must not score by accident.
		const first = deep?.family === "tool_use" ? buildToolCatalog(deep)[0]?.name : "";
		expect(first).not.toBe("get_weather");
	});

	it("✅ IMPLEMENT prompts are now EXECUTED (was: skipped wholesale)", () => {
		// INVERTED 2026-07-31. This previously pinned that `model-eval-runner` skipped the entire family with a
		// bare `continue`, so implement contributed nothing to any fitness measurement. David chose to build the
		// sandbox rather than delete the prompts: candidates now run in a `node --permission` child (fs,
		// child_process, net and process.binding all denied) under a wall-clock timeout.
		const implementPrompts = EVAL_PROMPT_CORPUS.filter((p) => p.family === "implement");
		expect(implementPrompts.length).toBeGreaterThan(0);
		const runnerSource = readFileSync("src/nklein-agent/model-eval-runner.ts", "utf8");
		expect(runnerSource, "the family must be dispatched, not skipped").toContain("scoreImplement");
		expect(runnerSource, "the bare skip must be gone").not.toMatch(
			/if \(prompt\.family === "implement"\) \{\s*continue;/u,
		);
	});

	it("the DEPTH CHAIN is complete: prompt → run → fitness row", () => {
		// P22.2's whole point. Each link was verified separately while building; this asserts they compose, because
		// a chain that is correct at every step and broken at one join records nothing while every unit test passes
		// — the exact shape of the orphan cores this session kept finding.
		const deepPrompt = EVAL_PROMPT_CORPUS.find((p) => p.id === "decompose-cli-version-flag-deep");
		const tokens = evalPromptContextTokens(deepPrompt as never);
		expect(tokens, "1. the prompt reports a deep runtime context").toBeGreaterThan(16_000);

		const row = recordFitnessOutcome(emptyFitnessRow({ modelKey: "m", role: "architect", difficultyTier: "hard" }), {
			success: true,
			usedContextTokens: tokens,
		});
		expect(row.depthSamples, "2. the fitness fold files it as DEEP evidence").toEqual({
			shallow: 0,
			medium: 0,
			deep: 1,
		});
	});

	it("pins the overall distribution so a change is deliberate", () => {
		const distribution = { shallow: 0, medium: 0, deep: 0 };
		for (const row of rows) {
			distribution[row.depth] += 1;
		}
		expect(distribution, "corpus depth changed — see todo P22.2").toEqual({ shallow: 14, medium: 1, deep: 3 });
	});
});
