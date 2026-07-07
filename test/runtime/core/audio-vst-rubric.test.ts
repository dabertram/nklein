import { describe, expect, it } from "vitest";
import {
	type AudioVstRubricAnalysis,
	PHASE_ALIGNMENT_TOLERANCE_SAMPLES,
	scoreAudioVstRubric,
	scorePhaseAlignment,
} from "../../../src/core/audio-vst-rubric";

/** A perfect candidate: every invariant holds, controls fully specced, docs complete. */
function perfect(): AudioVstRubricAnalysis {
	return {
		allBuffersBounded: true,
		renderingDeterministic: true,
		kickOnsetIsPeak: true,
		kickDecaysToSilence: true,
		phaseAlignmentOffsetSamples: 0,
		sequenceTimingCorrect: true,
		effectGuardrailSweep: { total: 8, heldPeak: 8 },
		exposedControlCount: 6,
		controlsWithFullSpec: 6,
		docsDistinguishPrototype: true,
		docsCoverControls: true,
	};
}

describe("scorePhaseAlignment", () => {
	it("is 1 in phase, 0 at/over tolerance, linear between, 0 when unmeasured", () => {
		expect(scorePhaseAlignment(0)).toBe(1);
		expect(scorePhaseAlignment(PHASE_ALIGNMENT_TOLERANCE_SAMPLES)).toBe(0);
		expect(scorePhaseAlignment(PHASE_ALIGNMENT_TOLERANCE_SAMPLES * 2)).toBe(0);
		expect(scorePhaseAlignment(PHASE_ALIGNMENT_TOLERANCE_SAMPLES / 2)).toBeCloseTo(0.5);
		expect(scorePhaseAlignment(-(PHASE_ALIGNMENT_TOLERANCE_SAMPLES / 4))).toBeCloseTo(0.75); // magnitude
		expect(scorePhaseAlignment(null)).toBe(0);
	});
});

describe("scoreAudioVstRubric", () => {
	it("scores a perfect candidate 1.0 across every axis with no reasons", () => {
		const score = scoreAudioVstRubric(perfect());
		expect(score.axes).toEqual({ dspCorrectness: 1, grooveGuardrails: 1, uiCoverage: 1, docs: 1 });
		expect(score.overall).toBe(1);
		expect(score.reasons).toEqual([]);
	});

	it("penalizes a clipping (unbounded) buffer on the DSP axis + records the reason", () => {
		const score = scoreAudioVstRubric({ ...perfect(), allBuffersBounded: false });
		expect(score.axes.dspCorrectness).toBeCloseTo(0.8); // 4/5 invariants hold
		expect(score.overall).toBeLessThan(1);
		expect(score.reasons[0]).toContain("clip");
	});

	it("degrades the DSP axis by the phase-alignment offset", () => {
		const score = scoreAudioVstRubric({
			...perfect(),
			phaseAlignmentOffsetSamples: PHASE_ALIGNMENT_TOLERANCE_SAMPLES,
		});
		// phase contributes 0/5 ⇒ dsp = 4/5.
		expect(score.axes.dspCorrectness).toBeCloseTo(0.8);
		expect(score.reasons.some((r) => r.includes("out of phase"))).toBe(true);
	});

	it("scores the effect-guardrail sweep as the held-peak fraction", () => {
		const score = scoreAudioVstRubric({ ...perfect(), effectGuardrailSweep: { total: 8, heldPeak: 4 } });
		// groove = (timingOk 1 + guardrail 0.5) / 2 = 0.75.
		expect(score.axes.grooveGuardrails).toBeCloseTo(0.75);
		expect(score.reasons.some((r) => r.includes("guardrail broke on 4/8"))).toBe(true);
	});

	it("scores UI coverage as the fully-specced-control fraction", () => {
		const score = scoreAudioVstRubric({ ...perfect(), exposedControlCount: 6, controlsWithFullSpec: 3 });
		expect(score.axes.uiCoverage).toBeCloseTo(0.5);
		expect(score.reasons.some((r) => r.includes("3/6 exposed controls lack"))).toBe(true);
	});

	it("scores docs as the mean of the two doc flags", () => {
		expect(scoreAudioVstRubric({ ...perfect(), docsCoverControls: false }).axes.docs).toBeCloseTo(0.5);
		expect(
			scoreAudioVstRubric({ ...perfect(), docsDistinguishPrototype: false, docsCoverControls: false }).axes.docs,
		).toBe(0);
	});

	it("weights the axes so the audio-quality core dominates the overall score", () => {
		// A candidate that nails DSP + groove but has zero UI/docs still scores 0.7 (0.4 + 0.3).
		const score = scoreAudioVstRubric({
			...perfect(),
			exposedControlCount: 4,
			controlsWithFullSpec: 0,
			docsDistinguishPrototype: false,
			docsCoverControls: false,
		});
		expect(score.axes.dspCorrectness).toBe(1);
		expect(score.axes.grooveGuardrails).toBe(1);
		expect(score.overall).toBeCloseTo(0.7);
	});

	it("handles an empty candidate (no controls, nothing measured) without dividing by zero", () => {
		const score = scoreAudioVstRubric({
			allBuffersBounded: false,
			renderingDeterministic: false,
			kickOnsetIsPeak: false,
			kickDecaysToSilence: false,
			phaseAlignmentOffsetSamples: null,
			sequenceTimingCorrect: false,
			effectGuardrailSweep: { total: 0, heldPeak: 0 },
			exposedControlCount: 0,
			controlsWithFullSpec: 0,
			docsDistinguishPrototype: false,
			docsCoverControls: false,
		});
		expect(score.overall).toBe(0);
		expect(Number.isFinite(score.axes.grooveGuardrails)).toBe(true);
		expect(Number.isFinite(score.axes.uiCoverage)).toBe(true);
	});
});
