import { describe, expect, it } from "vitest";
import {
	assessBenchmarkFitness,
	BENCHMARK_CANDIDATES,
	type BenchmarkCandidate,
	GRADIENT_FLOOR_PERCENT,
} from "../../src/core/benchmark-fitness";

function candidate(overrides: Partial<BenchmarkCandidate> = {}): BenchmarkCandidate {
	return { id: "b", arm64: "native", smallModelScorePercent: 20, contaminated: false, ...overrides };
}

describe("assessBenchmarkFitness", () => {
	it("adopts a clean, runnable, rankable benchmark", () => {
		expect(assessBenchmarkFitness(candidate()).verdict).toBe("adopt");
	});

	it("REJECTS on the floor effect — and says it is not a criticism of the benchmark", () => {
		// A benchmark our models score ~0% on gives no gradient: improvement and regression look identical.
		const result = assessBenchmarkFitness(candidate({ smallModelScorePercent: 3.4 }));
		expect(result.verdict).toBe("reject");
		expect(result.reason).toContain("unusable FOR US");
	});

	it("adopts just above the gradient floor — 'low but rankable' is still usable", () => {
		const result = assessBenchmarkFitness(candidate({ smallModelScorePercent: GRADIENT_FLOOR_PERCENT + 1 }));
		expect(result.verdict).toBe("adopt");
	});

	it("DOWNGRADES contamination to a_b_only rather than rejecting it", () => {
		// A paired comparison is unaffected by a bias both arms share, so a contaminated benchmark still ranks two
		// configurations — it just cannot support an absolute claim.
		const result = assessBenchmarkFitness(candidate({ contaminated: true }));
		expect(result.verdict).toBe("a_b_only");
		expect(result.caveats.join(" ")).toContain("BOTH arms share");
	});

	it("rejects outright when arm64 is unsupported", () => {
		expect(assessBenchmarkFitness(candidate({ arm64: "none" })).verdict).toBe("reject");
	});

	it("treats best-effort arm64 as a caveat, and says why that is dangerous", () => {
		// A benchmark that runs DIFFERENTLY is worse than one that does not run, because it produces numbers.
		const result = assessBenchmarkFitness(candidate({ arm64: "best_effort" }));
		expect(result.verdict).toBe("adopt");
		expect(result.caveats.join(" ")).toContain("produces numbers");
	});

	it("rejects a licence hazard WITHOUT dressing it as a measurement objection", () => {
		const result = assessBenchmarkFitness(candidate({ licenceHazard: true }));
		expect(result.verdict).toBe("reject");
		expect(result.blockers.join(" ")).toContain("not a measurement objection");
	});

	it("treats an UNSCORED benchmark as unknown, not as unusable", () => {
		// Nobody has run a model in our class. That is absence of evidence, not a floor effect.
		const result = assessBenchmarkFitness(candidate({ smallModelScorePercent: null }));
		expect(result.verdict).toBe("adopt");
		expect(result.caveats.join(" ")).toContain("UNKNOWN");
	});

	it("keeps blockers and caveats SEPARATE — they call for different actions", () => {
		const result = assessBenchmarkFitness(
			candidate({ smallModelScorePercent: 1, contaminated: true, arm64: "best_effort" }),
		);
		expect(result.blockers.length).toBeGreaterThan(0);
		expect(result.caveats.length).toBeGreaterThan(0);
		expect(result.verdict).toBe("reject");
	});
});

describe("BENCHMARK_CANDIDATES", () => {
	it("reproduces P20.9's recommendations", () => {
		const byId = new Map(BENCHMARK_CANDIDATES.map((c) => [c.id, assessBenchmarkFitness(c)]));
		expect(byId.get("aider_polyglot")?.verdict).toBe("a_b_only");
		expect(byId.get("terminal_bench_2_1")?.verdict).toBe("adopt");
		expect(byId.get("live_code_bench_date_sliced")?.verdict).toBe("adopt");
		expect(byId.get("swe_bench_live_lite")?.verdict).toBe("adopt");
	});

	it("rejects SWE-bench Pro for BOTH of its independent reasons", () => {
		// Either alone would disqualify it; recording both means removing one does not silently readmit it.
		const pro = assessBenchmarkFitness(BENCHMARK_CANDIDATES.find((c) => c.id === "swe_bench_pro")!);
		expect(pro.verdict).toBe("reject");
		expect(pro.blockers).toHaveLength(2);
	});
});
