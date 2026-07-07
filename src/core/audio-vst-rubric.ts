/**
 * §5.B — the SCORING rubric for the audio-VST psytrance dev-test fixture (the preset + harness are shipped; this is the
 * scoring the four axes are counted against). The fixture is a PURE deterministic TypeScript DSP core (no live audio, no
 * deps), so its output is fully analyzable: the harness renders the candidate's buffers + reads its exposed API into an
 * {@link AudioVstRubricAnalysis}, and this pure function scores it against the spec's audio invariants:
 *   1. DSP correctness + measured phase alignment — bounded buffers, deterministic rendering, kick transient-is-peak +
 *      decay-to-silence, and kick/bass phase alignment on a shared beat (the low end must not cancel).
 *   2. groove invariants + effect-guardrail sweeps — four-on-the-floor timing + an in-range effect never lifts peak > 1.
 *   3. full UI control coverage — every exposed parameter carries a complete ControlSpec (id/label/min/max/default/unit).
 *   4. prototype-vs-real-VST docs — the docs mark this a portable prototype (no deps / no DAW host) and cover the controls.
 * Pure, total, deterministic — the SCORING is fully unit-testable independent of the audio extraction.
 */

export interface AudioVstRubricAnalysis {
	// ── Axis 1: DSP correctness + phase alignment ────────────────────────────────
	/** Every rendered buffer satisfies |sample| ≤ 1 (no clipping past full scale). */
	allBuffersBounded: boolean;
	/** Re-rendering the same settings produced a byte-identical buffer (pure function of settings). */
	renderingDeterministic: boolean;
	/** The kick's onset (transient) is its highest-energy region. */
	kickOnsetIsPeak: boolean;
	/** The kick decays toward silence by the end of the buffer. */
	kickDecaysToSilence: boolean;
	/** |sample offset| between the kick and bass onsets on a SHARED beat (0 = perfectly in phase). Null = not measured. */
	phaseAlignmentOffsetSamples: number | null;
	// ── Axis 2: groove invariants + effect guardrails ────────────────────────────
	/** The four-on-the-floor sequence's step onsets land on the expected ticks at the target BPM. */
	sequenceTimingCorrect: boolean;
	/** Effect-guardrail sweep: of `total` in-declared-range parameter sets, how many kept the peak ≤ 1 (`heldPeak`). */
	effectGuardrailSweep: { total: number; heldPeak: number };
	// ── Axis 3: UI control coverage ──────────────────────────────────────────────
	/** Number of exposed/adjustable parameters. */
	exposedControlCount: number;
	/** Of those, how many carry a COMPLETE ControlSpec (id + label + min + max + default + unit). */
	controlsWithFullSpec: number;
	// ── Axis 4: docs ─────────────────────────────────────────────────────────────
	/** The docs state this is a portable prototype (no dependencies / no real DAW/VST host required). */
	docsDistinguishPrototype: boolean;
	/** The docs describe the exposed controls. */
	docsCoverControls: boolean;
}

export interface AudioVstRubricScore {
	/** Per-axis score in [0,1]. */
	axes: {
		dspCorrectness: number;
		grooveGuardrails: number;
		uiCoverage: number;
		docs: number;
	};
	/** Weighted mean of the axes in [0,1] (DSP + groove carry the most weight — they are the audio-quality core). */
	overall: number;
	/** Human-readable justification: which invariants passed / failed, most-significant first. */
	reasons: string[];
}

/** Phase alignment tolerance: within this many samples of the beat counts as fully in-phase; degrades linearly to 0. */
export const PHASE_ALIGNMENT_TOLERANCE_SAMPLES = 64;

/** Axis weights (sum = 1): the audio-quality axes dominate; docs are the lightest. */
const AXIS_WEIGHTS = { dspCorrectness: 0.4, grooveGuardrails: 0.3, uiCoverage: 0.2, docs: 0.1 } as const;

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function ratio(part: number, whole: number): number {
	return whole <= 0 ? 0 : clamp01(part / whole);
}

/** Score the phase-alignment offset: 0 samples ⇒ 1, ≥ tolerance ⇒ 0, linear between; unmeasured ⇒ 0. */
export function scorePhaseAlignment(offsetSamples: number | null): number {
	if (offsetSamples === null) {
		return 0;
	}
	return clamp01(1 - Math.abs(offsetSamples) / PHASE_ALIGNMENT_TOLERANCE_SAMPLES);
}

export function scoreAudioVstRubric(analysis: AudioVstRubricAnalysis): AudioVstRubricScore {
	const reasons: string[] = [];

	// ── Axis 1: DSP correctness + phase alignment (5 equal-weighted invariants) ──
	const phase = scorePhaseAlignment(analysis.phaseAlignmentOffsetSamples);
	const dspParts = [
		analysis.allBuffersBounded ? 1 : 0,
		analysis.renderingDeterministic ? 1 : 0,
		analysis.kickOnsetIsPeak ? 1 : 0,
		analysis.kickDecaysToSilence ? 1 : 0,
		phase,
	];
	const dspCorrectness = clamp01(dspParts.reduce((sum, part) => sum + part, 0) / dspParts.length);
	if (!analysis.allBuffersBounded)
		reasons.push("Buffers clip past full scale (|sample| > 1) — the bounded invariant fails.");
	if (!analysis.renderingDeterministic)
		reasons.push("Rendering is not a pure function of its settings (non-deterministic).");
	if (!analysis.kickOnsetIsPeak) reasons.push("The kick transient is not its highest-energy region.");
	if (!analysis.kickDecaysToSilence) reasons.push("The kick does not decay toward silence.");
	if (phase < 1)
		reasons.push(
			analysis.phaseAlignmentOffsetSamples === null
				? "Kick/bass phase alignment was not measured."
				: `Kick/bass are ${Math.abs(analysis.phaseAlignmentOffsetSamples)} samples out of phase on a shared beat.`,
		);

	// ── Axis 2: groove invariants + effect guardrails ────────────────────────────
	const guardrail = ratio(analysis.effectGuardrailSweep.heldPeak, analysis.effectGuardrailSweep.total);
	const grooveGuardrails = clamp01(((analysis.sequenceTimingCorrect ? 1 : 0) + guardrail) / 2);
	if (!analysis.sequenceTimingCorrect) reasons.push("The four-on-the-floor sequence timing is off.");
	if (guardrail < 1)
		reasons.push(
			`Effect guardrail broke on ${analysis.effectGuardrailSweep.total - analysis.effectGuardrailSweep.heldPeak}/${analysis.effectGuardrailSweep.total} in-range parameter sets (peak > 1).`,
		);

	// ── Axis 3: UI control coverage ──────────────────────────────────────────────
	const uiCoverage = ratio(analysis.controlsWithFullSpec, analysis.exposedControlCount);
	if (uiCoverage < 1)
		reasons.push(
			`${analysis.exposedControlCount - analysis.controlsWithFullSpec}/${analysis.exposedControlCount} exposed controls lack a complete ControlSpec.`,
		);

	// ── Axis 4: docs ─────────────────────────────────────────────────────────────
	const docs = clamp01(((analysis.docsDistinguishPrototype ? 1 : 0) + (analysis.docsCoverControls ? 1 : 0)) / 2);
	if (!analysis.docsDistinguishPrototype)
		reasons.push("Docs do not mark this a portable prototype (no deps / no DAW host).");
	if (!analysis.docsCoverControls) reasons.push("Docs do not cover the exposed controls.");

	const axes = { dspCorrectness, grooveGuardrails, uiCoverage, docs };
	const weighted =
		axes.dspCorrectness * AXIS_WEIGHTS.dspCorrectness +
		axes.grooveGuardrails * AXIS_WEIGHTS.grooveGuardrails +
		axes.uiCoverage * AXIS_WEIGHTS.uiCoverage +
		axes.docs * AXIS_WEIGHTS.docs;
	// Round to 6 decimals so a score can't carry floating-point noise (e.g. 0.999…9 for an all-1 candidate).
	const overall = clamp01(Math.round(weighted * 1e6) / 1e6);
	return { axes, overall, reasons };
}
