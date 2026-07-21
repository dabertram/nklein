/**
 * P18.5 — every shipped threshold declares WHERE ITS NUMBER CAME FROM. PURE core.
 *
 * The motivating case: "compact at 50% of the context window" is repeated widely enough to feel established, and
 * **no published source supports it.** Anthropic's own context-engineering guidance says only to compact when
 * "nearing the context window limit" — with no number at all. So a threshold that looks measured, cites nothing,
 * and is followed anyway is the normal state of affairs rather than an aberration.
 *
 * ── WHY A TYPE AND NOT A CONVENTION ──
 * The failure this prevents is not "we picked a bad number" — it is **"nobody can tell which numbers were
 * measured."** A constant named `COMPACTION_THRESHOLD = 0.5` looks identical whether it came from an experiment
 * on this workload, from a blog post, or from someone's intuition on a Tuesday. Once shipped, all three are
 * equally authoritative to the next reader, and the intuition is the one most likely to be defended, because
 * nobody remembers it was an intuition.
 *
 * So provenance is a REQUIRED field. A threshold cannot be declared without saying which of these it is:
 *  - `measured`      — produced by an experiment on OUR workload; carries the sample size and what was run.
 *  - `operational`   — a deliberate default nobody has measured. Honest, and explicitly not a finding.
 *  - `borrowed`      — taken from a published result on a DIFFERENT workload; carries the source.
 *  - `folklore`      — widely repeated, no traceable source. **Usable, but never presentable as evidence.**
 *
 * ── THE ASYMMETRY: `folklore` IS NOT A BAN ──
 * Folklore numbers are often fine — a widely-repeated default is usually not catastrophic, and refusing to ship
 * without measurement would stop the project. What must not happen is folklore being CITED as though measured.
 * So this core does not gate on provenance; it makes the label travel with the number, and makes an unlabelled
 * threshold impossible to construct. Enforcement by shape, not by review.
 */

export type ThresholdProvenance = "measured" | "operational" | "borrowed" | "folklore";

export interface ThresholdDeclaration {
	readonly id: string;
	readonly value: number;
	readonly provenance: ThresholdProvenance;
	/**
	 * For `measured`: what was run and over how many observations. For `borrowed`: the source. For `operational`
	 * and `folklore`: why this number rather than another. Never optional — an unexplained threshold is the thing
	 * this module exists to prevent, and making the field optional would restore it by default.
	 */
	readonly basis: string;
	/** Observations behind a `measured` value. Meaningless for the other kinds. */
	readonly sampleSize?: number;
}

/** Below this many observations a "measured" claim is a small sample wearing a lab coat. */
export const MIN_MEASURED_SAMPLE = 20;

export type ProvenanceDefect = "measured_without_sample" | "measured_undersampled" | "empty_basis";

export interface ProvenanceAssessment {
	readonly declaration: ThresholdDeclaration;
	readonly defects: readonly ProvenanceDefect[];
	/** True when this threshold may be described as evidence from this workload. */
	readonly citableAsMeasured: boolean;
	/** One line suitable for putting NEXT TO the number wherever it is shown. */
	readonly label: string;
}

/**
 * Assess a declaration.
 *
 * A `measured` claim is checked and can be DOWNGRADED; the other kinds are taken at their word, because they are
 * already admitting they are not evidence. The asymmetry is deliberate: only one of these labels can flatter a
 * number, so only one needs policing.
 */
export function assessThreshold(declaration: ThresholdDeclaration): ProvenanceAssessment {
	const defects: ProvenanceDefect[] = [];

	if (declaration.basis.trim().length === 0) {
		defects.push("empty_basis");
	}
	if (declaration.provenance === "measured") {
		if (declaration.sampleSize === undefined) {
			defects.push("measured_without_sample");
		} else if (declaration.sampleSize < MIN_MEASURED_SAMPLE) {
			defects.push("measured_undersampled");
		}
	}

	const citableAsMeasured = declaration.provenance === "measured" && defects.length === 0;

	const label = ((): string => {
		switch (declaration.provenance) {
			case "measured":
				return citableAsMeasured
					? `${declaration.value} — MEASURED on this workload over ${declaration.sampleSize} observation(s): ${declaration.basis}`
					: `${declaration.value} — claims MEASURED but ${defects.join(", ")}; treat as an operational default until the sample supports the claim`;
			case "operational":
				return `${declaration.value} — OPERATIONAL DEFAULT, not a measurement: ${declaration.basis}`;
			case "borrowed":
				return `${declaration.value} — BORROWED from a different workload, may not transfer: ${declaration.basis}`;
			case "folklore":
				return `${declaration.value} — FOLKLORE: widely repeated with no traceable source (${declaration.basis}). Usable, but must never be presented as evidence.`;
		}
	})();

	return { declaration, defects, citableAsMeasured, label };
}

/**
 * The thresholds this project ships, with their real provenance.
 *
 * Every entry here was previously a bare constant. The first genuine measurement landed for the compaction trigger
 * on 2026-07-22; the remaining entries stay explicitly operational or downgraded until their own evidence exists.
 */
export const SHIPPED_THRESHOLDS: readonly ThresholdDeclaration[] = [
	{
		id: "compaction.context_utilisation",
		value: 0.75,
		provenance: "measured",
		basis: "pre-registered paired context-integrity eval, 2026-07-22: Qwen2.5-Coder-14B recovered all three task-specific contract facts on 20/20 distinct coding-context tasks at measured 50.02%, 75.00%, and 90.14% prompt utilisation, with zero infrastructure errors. This validates 0.75 as a conservative safe trigger on the measured lane; it does not claim that 0.75 is an optimal fleet-wide degradation knee (none appeared through 90.14%).",
		sampleSize: 20,
	},
	{
		id: "codeact.fitness_bar",
		value: 0.62,
		provenance: "operational",
		basis: "chosen so a model must clearly clear the middle of the range; no experiment has located the knee",
	},
	{
		id: "residency.fitness_bar",
		value: 0.55,
		provenance: "operational",
		basis: "residency is cheaper to grant than CodeAct, so the bar sits below CodeAct's; unmeasured",
	},
	{
		id: "cold_load.seconds",
		value: 65,
		provenance: "measured",
		basis: "observed cold-load range 40–90s on this fleet; 65 is the midpoint",
		sampleSize: 0,
	},
	{
		id: "regression.slowdown_ratio",
		value: 3,
		provenance: "operational",
		basis: "3x is large enough to exclude ordinary variance without hiding a real degradation; not derived",
	},
];
