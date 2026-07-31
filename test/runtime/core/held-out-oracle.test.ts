import { globSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	assessOracleIndependence,
	GAP_TREND_POINTS_PER_DECADE,
	type HeldOutProbe,
	measureVisibleHeldOutGap,
	trendGapIncreasePoints,
	worstCaseGapEnvelopePoints,
} from "../../../src/core/held-out-oracle";

/**
 * P20.2 + P23.5 — guards for the protected external oracle.
 *
 * The containment tests deliberately use paths that a `startsWith` check gets WRONG in both directions, because
 * that is the bug this guard exists to not have: a sibling directory sharing a prefix must not be called a leak,
 * and a traversal that resolves back inside the workspace must not be called safe.
 */

const ROOT = "/sandbox/workspace";

function probe(overrides: Partial<HeldOutProbe> = {}): HeldOutProbe {
	return { id: "p1", kind: "fail_to_pass", sourcePath: "/oracles/proj/p1.test.ts", ...overrides };
}

function assess(overrides: Partial<Parameters<typeof assessOracleIndependence>[0]> = {}) {
	return assessOracleIndependence({
		probes: [probe()],
		agentWritableRoots: [ROOT],
		runner: ["/usr/bin/node", "--test", "/oracles/proj/p1.test.ts"],
		projectAcceptanceCommand: "npm test",
		...overrides,
	});
}

describe("assessOracleIndependence — containment", () => {
	it("accepts an oracle held entirely outside every agent-writable root", () => {
		const result = assess();
		expect(result.findings).toEqual([]);
		expect(result.independent).toBe(true);
	});

	it("flags a probe sitting INSIDE the workspace — the agent can edit the file that grades it", () => {
		const result = assess({ probes: [probe({ sourcePath: `${ROOT}/test/hidden.test.ts` })] });
		expect(result.independent).toBe(false);
		expect(result.findings.map((finding) => finding.code)).toContain("probe_reachable_by_agent");
	});

	it("flags a traversal that RESOLVES back inside the workspace", () => {
		// `/sandbox/other/../workspace/p.test.ts` → `/sandbox/workspace/p.test.ts`. A literal prefix comparison
		// says "outside" and accepts it; that is a silent hole, which is the dangerous direction of this bug.
		const result = assess({ probes: [probe({ sourcePath: "/sandbox/other/../workspace/p.test.ts" })] });
		expect(result.independent).toBe(false);
		expect(result.findings[0]?.code).toBe("probe_reachable_by_agent");
	});

	it("does NOT flag a sibling directory that merely shares a prefix", () => {
		// `/sandbox/workspace-oracle` is not inside `/sandbox/workspace`, but `startsWith` says it is. Rejecting
		// this would be safe-but-wrong, and would push an operator to move a correctly-held-out oracle.
		expect(assess({ probes: [probe({ sourcePath: "/sandbox/workspace-oracle/p.test.ts" })] }).independent).toBe(true);
	});

	it("treats a RELATIVE probe path as reachable, because it resolves against the workspace", () => {
		const result = assess({ probes: [probe({ sourcePath: "test/hidden.test.ts" })] });
		expect(result.independent).toBe(false);
		expect(result.findings[0]?.code).toBe("probe_reachable_by_agent");
	});

	it("checks EVERY writable root, not just the first", () => {
		// An extra writable mount is exactly how an oracle that was held out on day one stops being held out.
		const result = assess({
			probes: [probe({ sourcePath: "/scratch/shared/p.test.ts" })],
			agentWritableRoots: [ROOT, "/scratch/shared"],
		});
		expect(result.independent).toBe(false);
	});
});

describe("assessOracleIndependence — the oracle must be able to say something", () => {
	it("refuses an EMPTY oracle rather than passing it trivially", () => {
		const result = assess({ probes: [] });
		expect(result.findings.map((finding) => finding.code)).toContain("no_probes");
	});

	it("flags an oracle with no fail_to_pass probe", () => {
		const result = assess({ probes: [probe({ kind: "pass_to_pass" })] });
		expect(result.findings.map((finding) => finding.code)).toContain("no_fail_to_pass_probe");
	});

	it("flags duplicate probe ids, because results could not be attributed", () => {
		const result = assess({ probes: [probe(), probe({ sourcePath: "/oracles/proj/other.test.ts" })] });
		expect(result.findings.map((finding) => finding.code)).toContain("duplicate_probe_id");
	});
});

describe("assessOracleIndependence — the runner", () => {
	it("refuses the project's OWN acceptance command", () => {
		const result = assess({ runner: ["npm", "test"], projectAcceptanceCommand: "npm test" });
		expect(result.findings.map((finding) => finding.code)).toContain("runner_is_project_acceptance_command");
	});

	it("refuses a runner that dispatches through an agent-authored file", () => {
		// The BenchJack lesson: holding the probe FILES out is worthless if the agent controls what the runner
		// executes. `npm run oracle` reads the package.json the agent wrote.
		const result = assess({ runner: ["npm", "run", "oracle"], projectAcceptanceCommand: "npm test" });
		expect(result.findings.map((finding) => finding.code)).toContain("runner_dispatches_through_agent_authored_file");
	});

	it("catches a dispatcher invoked by absolute path", () => {
		expect(assess({ runner: ["/usr/local/bin/make", "check"] }).independent).toBe(false);
	});

	it("accepts a direct invocation with an explicit out-of-workspace config", () => {
		expect(assess({ runner: ["/usr/bin/node", "--test", "/oracles/proj/p1.test.ts"] }).independent).toBe(true);
	});
});

describe("assessOracleIndependence — reporting", () => {
	it("reports EVERY finding, so a fix-and-retry cycle does not discover them one run apart", () => {
		const result = assess({
			probes: [probe({ sourcePath: `${ROOT}/a.test.ts`, kind: "pass_to_pass" })],
			runner: ["npm", "test"],
		});
		expect(new Set(result.findings.map((finding) => finding.code))).toEqual(
			new Set([
				"probe_reachable_by_agent",
				"no_fail_to_pass_probe",
				"runner_is_project_acceptance_command",
				"runner_dispatches_through_agent_authored_file",
			]),
		);
	});
});

describe("worstCaseGapEnvelopePoints — refusing to invent precision", () => {
	it("reports the band maxima that were actually measured", () => {
		expect(worstCaseGapEnvelopePoints(5_000)).toBe(21);
		expect(worstCaseGapEnvelopePoints(10_000)).toBe(21);
		expect(worstCaseGapEnvelopePoints(25_000)).toBe(100);
		expect(worstCaseGapEnvelopePoints(400_000)).toBe(100);
	});

	it("returns NULL in the 10K–25K band, where no figure is reported", () => {
		// Interpolating the anchors would imply ~198 pp/decade — seven times the reported trend — because band
		// maxima and an average slope are different statistics. Null is the honest answer.
		expect(worstCaseGapEnvelopePoints(15_000)).toBeNull();
		expect(worstCaseGapEnvelopePoints(10_001)).toBeNull();
		expect(worstCaseGapEnvelopePoints(24_999)).toBeNull();
	});

	it("returns null for a nonsensical size rather than extrapolating", () => {
		expect(worstCaseGapEnvelopePoints(0)).toBeNull();
		expect(worstCaseGapEnvelopePoints(Number.NaN)).toBeNull();
	});
});

describe("trendGapIncreasePoints — a slope with no intercept answers only DIFFERENCES", () => {
	it("gives the reported points per tenfold", () => {
		expect(trendGapIncreasePoints(1_000, 10_000)).toBeCloseTo(GAP_TREND_POINTS_PER_DECADE, 6);
	});

	it("is symmetric under shrinking", () => {
		expect(trendGapIncreasePoints(10_000, 1_000)).toBeCloseTo(-GAP_TREND_POINTS_PER_DECADE, 6);
	});

	it("refuses non-positive sizes", () => {
		expect(() => trendGapIncreasePoints(0, 100)).toThrow(/positive/u);
	});
});

describe("measureVisibleHeldOutGap", () => {
	it("reports an unfalsifiable visible score as exactly that", () => {
		const gap = measureVisibleHeldOutGap({ visibleScore: 100, heldOutScore: null, linesOfCode: 5_000 });
		expect(gap.verdict).toBe("no_held_out_measurement");
		expect(gap.gapPoints).toBeNull();
		expect(gap.reason).toMatch(/unfalsifiable/u);
	});

	it("names the memorization signature (97 visible / 0 held-out)", () => {
		const gap = measureVisibleHeldOutGap({ visibleScore: 97, heldOutScore: 0, linesOfCode: 5_000 });
		expect(gap.verdict).toBe("memorized_visible_suite");
		expect(gap.reason).toMatch(/FEATURE ISOLATION/u);
	});

	it("does NOT call a merely-bad run memorization", () => {
		// 30/0 is a failing agent, which is a different and unalarming fact.
		expect(measureVisibleHeldOutGap({ visibleScore: 30, heldOutScore: 0, linesOfCode: 5_000 }).verdict).toBe(
			"gap_exceeds_worst_case_envelope",
		);
	});

	it("blames the VISIBLE suite when held-out scores higher", () => {
		const gap = measureVisibleHeldOutGap({ visibleScore: 40, heldOutScore: 70, linesOfCode: 5_000 });
		expect(gap.verdict).toBe("held_out_exceeds_visible");
		expect(gap.gapPoints).toBe(-30);
	});

	it("flags a gap above the envelope for the size", () => {
		const gap = measureVisibleHeldOutGap({ visibleScore: 90, heldOutScore: 60, linesOfCode: 5_000 });
		expect(gap.verdict).toBe("gap_exceeds_worst_case_envelope");
		expect(gap.gapPoints).toBe(30);
	});

	it("records but does NOT judge a gap in the unreported size band", () => {
		const gap = measureVisibleHeldOutGap({ visibleScore: 90, heldOutScore: 40, linesOfCode: 15_000 });
		expect(gap.verdict).toBe("envelope_unknown_for_size");
		expect(gap.gapPoints).toBe(50);
		expect(gap.worstCaseEnvelopePoints).toBeNull();
	});

	it("says an in-envelope gap is still NOT a pass", () => {
		const gap = measureVisibleHeldOutGap({ visibleScore: 90, heldOutScore: 80, linesOfCode: 5_000 });
		expect(gap.verdict).toBe("gap_within_worst_case_envelope");
		expect(gap.reason).toMatch(/NOT a pass/u);
	});

	it("cannot judge a gap without a size", () => {
		expect(measureVisibleHeldOutGap({ visibleScore: 90, heldOutScore: 40, linesOfCode: null }).verdict).toBe(
			"envelope_unknown_for_size",
		);
	});
});

describe("against the REAL dev-test projects — P23.5's claim, measured", () => {
	it("shows every project's acceptance command is refused as an oracle runner", () => {
		// P23.5 asserts "`npm test` is not an independent oracle". This turns that from a judgement into a count:
		// every one of the projects grades itself with a command that dispatches through a file the agent wrote.
		const manifests = globSync("dev-test-projects/*/project.json");
		expect(manifests.length).toBeGreaterThan(40);

		const refused = manifests.filter((path) => {
			const command = (JSON.parse(readFileSync(path, "utf8")) as { acceptanceCommand: string }).acceptanceCommand;
			return !assessOracleIndependence({
				probes: [probe()],
				agentWritableRoots: [ROOT],
				runner: command.split(/\s+/u),
				projectAcceptanceCommand: command,
			}).independent;
		});
		expect(refused.length).toBe(manifests.length);
	});
});
