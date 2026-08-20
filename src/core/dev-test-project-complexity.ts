/**
 * PROJECT-level complexity for a dev-test project — the axis that makes two runs comparable.
 *
 * `task-complexity.ts` bands a CARD for sysprompt level and `task-difficulty-estimate.ts` scores a CARD for
 * model routing. Neither answers the question a campaign asks: *was this project harder than that one?*
 * Without it, "3/4 delivered" on the bed's four-file scenarios and "0/1" on a 25,000-word master challenge
 * read as comparable numbers when they are not remotely the same test.
 *
 * Every input is STATIC — derived from the project's own assets before any model runs — so the score cannot
 * drift with a run's luck, and two runs of the same project always normalise against the identical number.
 *
 * Deliberately NOT a quality judgement and NOT a prediction of success: it is a size-of-the-ask measure.
 * A project can be small and still unsolvable, or large and mechanical.
 */

import { buildSpecSectionIndex } from "./spec-section-index";

export interface DevTestProjectComplexityInput {
	/** The project's specification markdown (the file the agent is told to read). */
	readonly specification: string;
	/** The seed prompt the card carries. */
	readonly prompt: string;
	/**
	 * Distinct modules the held-out oracle prescribes, if the project has probes. This is the strongest
	 * available signal of BREADTH, because it is what the project must actually expose to be judged.
	 */
	readonly prescribedModuleCount?: number;
	/** Held-out probe files — each is an independent invariant family the work must satisfy. */
	readonly probeCount?: number;
	/** Whether the project starts in plan mode (decomposition is itself a capability under test). */
	readonly startsInPlanMode?: boolean;
}

/** Coarse bands, so a report says something a human can act on rather than a bare number. */
export type DevTestProjectComplexityBand = "small" | "moderate" | "large" | "master";

export interface DevTestProjectComplexity {
	readonly band: DevTestProjectComplexityBand;
	/** 0-100. Monotone in every input; no input can lower it. */
	readonly score: number;
	readonly specWords: number;
	readonly specSections: number;
	readonly prescribedModuleCount: number;
	readonly probeCount: number;
	/**
	 * Words the agent must traverse per unit of gradeable surface. A very high value means the project is
	 * mostly READING — a retrieval test more than a construction one, which is exactly the shape that
	 * distinguishes the master challenge from a four-file scenario.
	 */
	readonly wordsPerPrescribedModule: number | null;
	readonly reasons: readonly string[];
}

/** Word counts where a spec stops fitting comfortably in a local model's working context. */
const SPEC_WORD_BANDS = [500, 2_000, 8_000, 20_000] as const;

export function assessDevTestProjectComplexity(input: DevTestProjectComplexityInput): DevTestProjectComplexity {
	const index = buildSpecSectionIndex(input.specification);
	// `buildSpecSectionIndex` counts words UNDER HEADINGS, so a spec written as prose with no `#` at all
	// reports zero — which would score a real ask as trivially small (measured: the bed's cli-parser spec,
	// a full paragraph of requirements, came back 0 words / 0 sections). Fall back to a raw count so the
	// size signal degrades gracefully instead of silently vanishing.
	const countWords = (text: string): number => (text.trim() === "" ? 0 : text.trim().split(/\s+/u).length);
	// The ask is wherever the REQUIREMENTS actually live. Scaffold-bed scenarios carry them in the PROMPT and
	// leave `specification` a one-line summary; the master challenge does the opposite. Counting only the spec
	// scored a fully-specified bed scenario at 32 words, so the size signal is prompt + spec.
	const specBodyWords = index.totalWords > 0 ? index.totalWords : countWords(input.specification);
	const specWords = specBodyWords + countWords(input.prompt);
	const specSections = index.sections.length;
	const prescribedModuleCount = Math.max(0, input.prescribedModuleCount ?? 0);
	const probeCount = Math.max(0, input.probeCount ?? 0);
	const reasons: string[] = [];

	// Size of the reading task. The steps are context-shaped, not linear: the jump that matters is when a
	// spec stops fitting in one comfortable read, because that changes the CAPABILITY under test.
	let score = 0;
	const wordStep = SPEC_WORD_BANDS.filter((threshold) => specWords >= threshold).length;
	score += wordStep * 15;
	if (wordStep >= 3) {
		reasons.push(`${specWords.toLocaleString()} spec words — retrieval, not a single read`);
	} else if (specWords > 0) {
		reasons.push(`${specWords.toLocaleString()} spec words`);
	}

	// Breadth of the ask.
	if (specSections >= 20) {
		score += 15;
		reasons.push(`${specSections} spec sections`);
	} else if (specSections >= 8) {
		score += 8;
		reasons.push(`${specSections} spec sections`);
	}

	if (prescribedModuleCount >= 6) {
		score += 15;
		reasons.push(`${prescribedModuleCount} prescribed modules`);
	} else if (prescribedModuleCount >= 2) {
		score += 8;
		reasons.push(`${prescribedModuleCount} prescribed modules`);
	}

	if (probeCount >= 3) {
		score += 10;
		reasons.push(`${probeCount} independent invariant families`);
	} else if (probeCount >= 1) {
		score += 5;
		reasons.push(`${probeCount} invariant family`);
	}

	if (input.startsInPlanMode) {
		score += 10;
		reasons.push("starts in plan mode (decomposition is under test)");
	}

	// A prompt that DELEGATES to the spec ("read specification.md") is harder than one that restates the task,
	// because the agent must go and get the requirements rather than being handed them. Found the hard way:
	// every bed scenario is self-contained, which is why they never exercised the spec-reading path at all.
	if (/read .{0,20}specification\.md/i.test(input.prompt)) {
		score += 5;
		reasons.push("prompt delegates to the specification file");
	}

	const bounded = Math.max(0, Math.min(100, score));
	const band: DevTestProjectComplexityBand =
		bounded >= 70 ? "master" : bounded >= 45 ? "large" : bounded >= 20 ? "moderate" : "small";
	return {
		band,
		score: bounded,
		specWords,
		specSections,
		prescribedModuleCount,
		probeCount,
		wordsPerPrescribedModule: prescribedModuleCount > 0 ? Math.round(specWords / prescribedModuleCount) : null,
		reasons,
	};
}
