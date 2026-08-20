import { describe, expect, it } from "vitest";
import { assessDevTestProjectComplexity } from "../../../src/core/dev-test-project-complexity";
import { compareRuns, computeRunMetrics, type RunMetricsInput } from "../../../src/core/run-comparison-metrics";

function metrics(overrides: Partial<RunMetricsInput> = {}) {
	return computeRunMetrics({
		runId: "run-a",
		projectId: "bed-cli-parser",
		complexityScore: 20,
		termination: "settled",
		wallClockCapMinutes: 50,
		durationSeconds: 600,
		modelsByRole: { worker: "qwen3.8-27b-mlx", reviewer: "qwen3.8-27b-mlx" },
		cardsCreated: 1,
		sessions: 3,
		toolCalls: 40,
		toolErrors: 4,
		cardsCompleted: 1,
		cardsMergedVerified: 1,
		oraclePassed: null,
		oracleTotal: null,
		...overrides,
	});
}

describe("assessDevTestProjectComplexity", () => {
	it("separates a four-file scenario from a 25,000-word master challenge", () => {
		const small = assessDevTestProjectComplexity({
			specification: "# Build a parser\n\nImplement parseArgs and resolveConfig with tests.",
			prompt: "Build src/arg-parser.ts and src/config-merge.ts. Run node --test.",
			prescribedModuleCount: 2,
			probeCount: 0,
		});
		const master = assessDevTestProjectComplexity({
			specification: `# Master\n\n${"section body words ".repeat(9000)}\n\n${Array.from({ length: 30 }, (_, i) => `## S${i}\n\ndetail`).join("\n\n")}`,
			prompt: "Read all of specification.md before planning.",
			prescribedModuleCount: 6,
			probeCount: 3,
			startsInPlanMode: true,
		});
		expect(small.band).toBe("small");
		expect(master.band).toBe("master");
		expect(master.score).toBeGreaterThan(small.score);
		// The shape that distinguishes them is READING per unit of gradeable surface, not raw size alone.
		expect(master.wordsPerPrescribedModule ?? 0).toBeGreaterThan(small.wordsPerPrescribedModule ?? 0);
		expect(master.reasons.join(" ")).toContain("retrieval");
	});

	it("counts a heading-less spec instead of scoring it as empty", () => {
		// The section indexer counts words UNDER HEADINGS; a prose spec with no `#` returned 0 words, which
		// would have scored a real ask as trivially small (measured on the bed's own cli-parser scenario).
		const prose = assessDevTestProjectComplexity({
			specification: "Build a subcommand parser with config precedence. ".repeat(60),
			prompt: "do it",
		});
		expect(prose.specWords).toBeGreaterThan(100);
	});

	it("is monotone: no input can lower the score", () => {
		const base = { specification: "# S\n\nshort", prompt: "do it" };
		const plain = assessDevTestProjectComplexity(base);
		const richer = assessDevTestProjectComplexity({
			...base,
			prescribedModuleCount: 6,
			probeCount: 3,
			startsInPlanMode: true,
		});
		expect(richer.score).toBeGreaterThanOrEqual(plain.score);
	});
});

describe("computeRunMetrics", () => {
	it("flags completed-but-unmerged rather than counting it as delivery", () => {
		// The exact shape this campaign shipped a fix for: a card can reach Completed with its change
		// stranded off the branch, and the board state alone cannot tell you.
		const result = metrics({ cardsCompleted: 3, cardsMergedVerified: 1 });
		expect(result.completedButUnverified).toBe(2);
		expect(result.notes.join(" ")).toContain("not evidence that the change landed");
	});

	it("marks an interrupted run's counts as floors", () => {
		const result = metrics({ termination: "wall_clock", durationSeconds: 3000 });
		expect(result.interrupted).toBe(true);
		expect(result.notes.join(" ")).toContain("FLOOR");
	});

	it("says UNMEASURED when no oracle exists, rather than implying a pass", () => {
		expect(metrics({ oracleTotal: null }).notes.join(" ")).toContain("UNMEASURED, not passing");
	});

	it("normalises delivery by complexity so projects of different size can be compared", () => {
		const easy = metrics({ complexityScore: 20, cardsMergedVerified: 2 });
		const hard = metrics({ complexityScore: 80, cardsMergedVerified: 2 });
		expect(easy.verifiedDeliveryPerComplexity).toBeGreaterThan(hard.verifiedDeliveryPerComplexity as number);
	});
});

describe("compareRuns", () => {
	it("REFUSES to compare runs whose fleets differ", () => {
		// A model change explains a delivery gap at least as well as any product change.
		const comparison = compareRuns(
			metrics(),
			metrics({ runId: "run-b", modelsByRole: { worker: "qwen/qwen3.6-35b-a3b", reviewer: "qwen3.8-27b-mlx" } }),
		);
		expect(comparison.verdict).toBe("not_comparable");
		expect(comparison.deltas).toBeNull();
		expect(comparison.reasons.join(" ")).toContain("fleet change explains a delivery gap");
	});

	it("allows a same-fleet comparison but keeps the caveats attached", () => {
		const comparison = compareRuns(metrics(), metrics({ runId: "run-b", termination: "stalled" }));
		expect(comparison.verdict).toBe("comparable_with_caveats");
		expect(comparison.reasons.join(" ")).toContain("floors");
		expect(comparison.deltas?.cardsMergedVerified).toBe(0);
	});

	it("compares cleanly when nothing differs", () => {
		const comparison = compareRuns(metrics(), metrics({ runId: "run-b", cardsMergedVerified: 3 }));
		expect(comparison.verdict).toBe("comparable");
		expect(comparison.deltas?.cardsMergedVerified).toBe(2);
	});
});
