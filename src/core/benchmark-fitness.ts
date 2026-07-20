/**
 * P20.9 — which benchmarks are usable BY A LOCAL FLEET. PURE core.
 *
 * Most of the field is unusable here, and for reasons that have nothing to do with benchmark quality. Two filters
 * eliminate most candidates before any judgement about rigour:
 *
 * **1. THE FLOOR EFFECT — the one people skip.** SWE-bench Pro scores Qwen-3 32B at **3.4%**. A benchmark where
 * our models score near zero **provides no gradient to optimise against**: every change reads as noise, an
 * improvement and a regression look identical, and months of work produce a flat line. That makes it useless
 * *for us* while remaining an excellent benchmark — the two claims are compatible, and conflating them is why
 * teams adopt prestigious benchmarks that cannot answer their question.
 *
 * **2. ARCHITECTURE.** SWE-bench-family arm64 images are documented as "best-effort, untested". A benchmark that
 * may not run is not a benchmark; a benchmark that runs *differently* is worse, because it produces numbers.
 *
 * ── CONTAMINATION DOWNGRADES, IT DOES NOT DISQUALIFY ──
 * A contaminated benchmark still ranks two configurations against each other — what it cannot do is support an
 * ABSOLUTE claim. So contamination maps to `a_b_only` rather than `reject`: Aider polyglot is contamination-
 * inflated and still the best daily A/B driver available, because a paired comparison is unaffected by a bias
 * both arms share.
 *
 * ── THE LICENCE HAZARD IS ABOUT OUR CORPUS, NOT OUR SCORES ──
 * SWE-bench Pro's task data is **deliberately GPL-sourced as a legal deterrent against training inclusion**. That
 * is not a scoring concern at all — it is a reason to keep the data out of any corpus this project retains or
 * feeds anywhere. A benchmark can be rejected on grounds that have nothing to do with measurement, and merging
 * that into the score-based verdict would lose the reason.
 */

export type ArchSupport = "native" | "best_effort" | "none";
export type BenchmarkVerdict = "adopt" | "a_b_only" | "reject";

export interface BenchmarkCandidate {
	readonly id: string;
	readonly arm64: ArchSupport;
	/** Best score a model in OUR class achieves, in percent. Null when nobody has run one. */
	readonly smallModelScorePercent: number | null;
	readonly contaminated: boolean;
	/** True when the task data carries a licence that must not enter a retained corpus. */
	readonly licenceHazard?: boolean;
}

/**
 * Below this score a benchmark yields no usable gradient.
 *
 * OPERATIONAL DEFAULT (P18.5), not measured: chosen above SWE-bench Pro's observed 3.4% and below Aider
 * polyglot's ~8%, which is described as "low but rankable". The boundary between those two IS the judgement, and
 * it is a judgement rather than a finding.
 */
export const GRADIENT_FLOOR_PERCENT = 5;

export interface BenchmarkAssessment {
	readonly id: string;
	readonly verdict: BenchmarkVerdict;
	/** Reasons that DISQUALIFY, in the order they were hit. */
	readonly blockers: readonly string[];
	/** Reasons that restrict use without disqualifying. */
	readonly caveats: readonly string[];
	readonly reason: string;
}

/**
 * Assess one benchmark for use on a local fleet.
 *
 * Blockers and caveats stay separate lists because they call for different actions: a blocker means do not run
 * it, a caveat means run it and never quote it absolutely. Collapsing them into one "problems" list would make
 * `a_b_only` indistinguishable from `reject` at a glance, and the useful benchmark would get dropped with the
 * useless one.
 */
export function assessBenchmarkFitness(candidate: BenchmarkCandidate): BenchmarkAssessment {
	const blockers: string[] = [];
	const caveats: string[] = [];

	if (candidate.arm64 === "none") {
		blockers.push("no arm64 support — it cannot run on this fleet at all");
	} else if (candidate.arm64 === "best_effort") {
		caveats.push(
			"arm64 support is best-effort and untested — a benchmark that runs DIFFERENTLY is worse than one that does not run, because it produces numbers",
		);
	}

	const score = candidate.smallModelScorePercent;
	if (score === null) {
		caveats.push(
			"no model in our class has been scored — usability is UNKNOWN rather than established; run it once before trusting it as a driver",
		);
	} else if (score < GRADIENT_FLOOR_PERCENT) {
		blockers.push(
			`models in our class score ${score}%, below the ~${GRADIENT_FLOOR_PERCENT}% gradient floor — every change reads as noise, and an improvement is indistinguishable from a regression. This says nothing against the benchmark; it is unusable FOR US`,
		);
	}

	if (candidate.licenceHazard === true) {
		blockers.push(
			"task data is deliberately licence-encumbered as a deterrent against training inclusion — keep it out of any retained corpus. This is not a measurement objection and does not become one",
		);
	}

	if (candidate.contaminated) {
		caveats.push(
			"contamination-inflated — usable for A/B only, never for absolute claims. A paired comparison is unaffected by a bias BOTH arms share",
		);
	}

	const verdict: BenchmarkVerdict = blockers.length > 0 ? "reject" : candidate.contaminated ? "a_b_only" : "adopt";

	const reason =
		blockers.length > 0
			? `REJECT ${candidate.id}: ${blockers.join("; ")}`
			: caveats.length > 0
				? `${verdict === "a_b_only" ? "A/B ONLY" : "ADOPT"} ${candidate.id}, with caveats: ${caveats.join("; ")}`
				: `ADOPT ${candidate.id}: no blockers, no caveats`;

	return { id: candidate.id, verdict, blockers, caveats, reason };
}

/**
 * The four recommended benchmarks plus the one explicitly skipped, as data.
 *
 * `live_code_bench` is included for a reason worth stating: it is a model-capability CONTROL, not a fourth
 * agentic benchmark. It tells us whether a bad run was **the model or our harness** — which is worth more than
 * another measurement of the two combined, because that is the question every disappointing result raises.
 */
export const BENCHMARK_CANDIDATES: readonly BenchmarkCandidate[] = [
	{ id: "aider_polyglot", arm64: "native", smallModelScorePercent: 8, contaminated: true },
	{ id: "terminal_bench_2_1", arm64: "native", smallModelScorePercent: 15, contaminated: false },
	{ id: "live_code_bench_date_sliced", arm64: "native", smallModelScorePercent: 20, contaminated: false },
	{ id: "swe_bench_live_lite", arm64: "best_effort", smallModelScorePercent: 10, contaminated: false },
	{ id: "swe_bench_pro", arm64: "best_effort", smallModelScorePercent: 3.4, contaminated: false, licenceHazard: true },
];
