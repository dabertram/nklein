import { describe, expect, it } from "vitest";
import {
	classifyFlakeQuarantine,
	type FlakeQuarantineInput,
	type TestFlakeHistory,
} from "../../../src/core/flake-quarantine";
import { prioritizeTestSelection } from "../../../src/core/test-selection-priority";

/** Build a history record; `P`/`F` string is the friendly way to author outcomes (default newest-first). */
function hist(id: string, outcomes: string | boolean[] | undefined): TestFlakeHistory {
	if (outcomes === undefined) {
		return { id };
	}
	if (typeof outcomes === "string") {
		return { id, outcomes: [...outcomes].map((c) => c === "P") };
	}
	return { id, outcomes };
}

function classify(input: Partial<FlakeQuarantineInput> & Pick<FlakeQuarantineInput, "tests">) {
	return classifyFlakeQuarantine(input);
}

/** The single classified test for `id` (convenience). */
function pick(result: ReturnType<typeof classifyFlakeQuarantine>, id: string) {
	const found = result.tests.find((t) => t.id === id);
	if (!found) {
		throw new Error(`no classification for ${id}`);
	}
	return found;
}

describe("classifyFlakeQuarantine — flakeScore (flip-rate) math", () => {
	it("returns a well-formed empty result for no tests", () => {
		const result = classify({ tests: [] });
		expect(result.tests).toEqual([]);
		expect(result.quarantinedIds).toEqual([]);
		expect(result.watchIds).toEqual([]);
		expect(result.flakeScoresById).toEqual({});
		expect(result.counts).toEqual({ total: 0, quarantined: 0, watched: 0, trusted: 0 });
		expect(result.summary).toMatch(/no tests/i);
	});

	it("scores an alternating history at 1.0 (flips every run)", () => {
		// P F P F P F → 5 flips over 5 gaps = 1.0
		const result = classify({ tests: [hist("alt", "PFPFPF")] });
		expect(pick(result, "alt").flakeScore).toBe(1);
		expect(pick(result, "alt").flips).toBe(5);
		expect(pick(result, "alt").samples).toBe(6);
	});

	it("scores an always-fail history at 0 (deterministic, NOT flaky)", () => {
		const result = classify({ tests: [hist("broken", "FFFFF")] });
		const t = pick(result, "broken");
		expect(t.flakeScore).toBe(0);
		expect(t.flips).toBe(0);
		expect(t.recentFailures).toBe(5);
		// A test that fails every run is broken, not flaky — it must be trusted (its red is decisive), not quarantined.
		expect(t.action).toBe("trust");
	});

	it("scores an always-pass history at 0 and trusts it", () => {
		const result = classify({ tests: [hist("green", "PPPPP")] });
		expect(pick(result, "green").flakeScore).toBe(0);
		expect(pick(result, "green").action).toBe("trust");
		expect(pick(result, "green").recentFailures).toBe(0);
	});

	it("scores a single-flip run (PPFF) at ~0.33", () => {
		// P P F F → 1 flip over 3 gaps = 0.333…
		const result = classify({ tests: [hist("onedip", "PPFF")] });
		expect(pick(result, "onedip").flips).toBe(1);
		expect(pick(result, "onedip").flakeScore).toBeCloseTo(1 / 3, 10);
	});

	it("flip COUNT is identical regardless of history order (newest- vs oldest-first)", () => {
		const outcomes = "PPFPF";
		const newest = classify({ tests: [hist("t", outcomes)], historyOrder: "newest-first" });
		const oldest = classify({ tests: [hist("t", outcomes)], historyOrder: "oldest-first" });
		expect(pick(newest, "t").flips).toBe(pick(oldest, "t").flips);
		expect(pick(newest, "t").flakeScore).toBe(pick(oldest, "t").flakeScore);
	});
});

describe("classifyFlakeQuarantine — quarantine / watch / trust decision", () => {
	it("quarantines a coin-flip test (flip-rate ≥ 0.5)", () => {
		const result = classify({ tests: [hist("coin", "PFPFPF")] });
		expect(pick(result, "coin").action).toBe("quarantine");
		expect(result.quarantinedIds).toContain("coin");
		expect(pick(result, "coin").reason).toMatch(/quarantine/);
	});

	it("watches a low-flip-rate test (a flip below the quarantine bar)", () => {
		// PPPPF → 1 flip over 4 gaps = 0.25 (< 0.5 quarantine, ≥ 0 watch)
		const result = classify({ tests: [hist("occasional", "PPPPF")] });
		expect(pick(result, "occasional").action).toBe("watch");
		expect(result.watchIds).toContain("occasional");
	});

	it("trusts a stable test with enough samples", () => {
		const result = classify({ tests: [hist("stable", "PPPPPP")] });
		expect(pick(result, "stable").action).toBe("trust");
		expect(pick(result, "stable").reason).toMatch(/stable/);
	});

	it("respects a custom quarantineFlipRate (raise the bar → the coin-flip stays watch)", () => {
		const result = classify({
			tests: [hist("coin", "PFPFPF")],
			policy: { quarantineFlipRate: 1.01 }, // clamped to 1.0; flip-rate must be ≥ 1.0 → still quarantines at exactly 1.0
		});
		// PFPFPF is exactly 1.0, so even at the clamped-1.0 bar it quarantines; use a sub-1.0 history to show watch.
		expect(pick(result, "coin").action).toBe("quarantine");

		const belowOne = classify({
			tests: [hist("mostly", "PPFPPF")], // P P F P P F → gaps PP=0 PF=1 FP=1 PP=0 PF=1 = 3 flips / 5 = 0.6
			policy: { quarantineFlipRate: 0.7 },
		});
		expect(pick(belowOne, "mostly").flakeScore).toBeCloseTo(0.6, 10);
		expect(pick(belowOne, "mostly").action).toBe("watch");
	});

	it("respects a custom watchFlipRate (any flip below it → trust)", () => {
		// PPPPF = 0.25. With watchFlipRate 0.3, that is below watch → trust.
		const result = classify({
			tests: [hist("occasional", "PPPPF")],
			policy: { watchFlipRate: 0.3 },
		});
		expect(pick(result, "occasional").action).toBe("trust");
	});

	it("clamps watchFlipRate to never exceed quarantineFlipRate", () => {
		// watch asked for 0.9 but quarantine is 0.5 → watch clamped to 0.5, so a 0.5 test quarantines (not watch).
		const result = classify({
			tests: [hist("half", "PFPF")], // 3 flips / 3 = 1.0 → quarantine regardless; use a 0.5 case:
			policy: { watchFlipRate: 0.9, quarantineFlipRate: 0.5 },
		});
		expect(pick(result, "half").action).toBe("quarantine");
		const at50 = classify({
			tests: [hist("exactlyhalf", "PPFPPF")], // 1→2 flips? P P F P P F: gaps PP=0 PF=1 FP=1 PP=0 PF=1 → 3/5 = 0.6
			policy: { watchFlipRate: 0.9, quarantineFlipRate: 0.5 },
		});
		expect(pick(at50, "exactlyhalf").action).toBe("quarantine");
	});
});

describe("classifyFlakeQuarantine — insufficient-history handling", () => {
	it("watches a test with fewer than minSamples outcomes (default watch-on-insufficient)", () => {
		const result = classify({ tests: [hist("fresh", "PF")] }); // 2 samples < default 4
		expect(pick(result, "fresh").action).toBe("watch");
		expect(pick(result, "fresh").flakeScore).toBe(0);
		expect(pick(result, "fresh").reason).toMatch(/sample/);
	});

	it("watches a test with NO history", () => {
		const result = classify({ tests: [hist("brandnew", undefined)] });
		expect(pick(result, "brandnew").action).toBe("watch");
		expect(pick(result, "brandnew").samples).toBe(0);
		expect(pick(result, "brandnew").reason).toMatch(/no run history/i);
	});

	it("trusts insufficient history when watchOnInsufficientHistory is false (optimistic)", () => {
		const result = classify({
			tests: [hist("fresh", "PF"), hist("brandnew", undefined)],
			policy: { watchOnInsufficientHistory: false },
		});
		expect(pick(result, "fresh").action).toBe("trust");
		expect(pick(result, "brandnew").action).toBe("trust");
	});

	it("does not quarantine a short but fully-alternating history below minSamples", () => {
		const result = classify({ tests: [hist("short", "PF")] }); // score would be 1.0 but only 2 < 4 samples
		expect(pick(result, "short").action).toBe("watch"); // guarded by minSamples, NOT quarantined
		expect(pick(result, "short").flakeScore).toBe(0);
	});
});

describe("classifyFlakeQuarantine — windowing", () => {
	it("truncates to the most-recent windowSize outcomes (newest-first ⇒ prefix)", () => {
		// windowSize 4, newest-first: only the first 4 (P F P F = flip-rate 1.0) count; the trailing all-pass are dropped.
		const result = classify({
			tests: [hist("aging", "PFPFPPPPPP")],
			policy: { windowSize: 4, minSamples: 4 },
		});
		expect(pick(result, "aging").samples).toBe(4);
		expect(pick(result, "aging").flakeScore).toBe(1);
		expect(pick(result, "aging").action).toBe("quarantine");
	});

	it("ages OUT a stale flaky streak with oldest-first order (keeps the most-recent suffix)", () => {
		// oldest-first, windowSize 4: keeps the LAST 4 (all pass) — the early PFPF flaky streak ages out → trust.
		const result = classify({
			tests: [hist("settled", "PFPFPPPP")],
			policy: { windowSize: 4, minSamples: 4 },
			historyOrder: "oldest-first",
		});
		expect(pick(result, "settled").samples).toBe(4);
		expect(pick(result, "settled").flips).toBe(0);
		expect(pick(result, "settled").action).toBe("trust");
	});

	it("clamps windowSize up to minSamples when a caller sets it too small", () => {
		// windowSize 2 but minSamples 4 → windowSize clamped to 4; a 6-sample alternating history keeps 4 → quarantine.
		const result = classify({
			tests: [hist("t", "PFPFPF")],
			policy: { windowSize: 2, minSamples: 4 },
		});
		expect(pick(result, "t").samples).toBe(4);
	});
});

describe("classifyFlakeQuarantine — ordering, rollup & dedup", () => {
	it("orders worst-first: quarantine → watch → trust, then by descending flakeScore, then id", () => {
		const result = classify({
			tests: [
				hist("z_trust", "PPPPPP"),
				hist("watch_low", "PPPPPF"), // 1 flip / 5 = 0.2 → watch
				hist("quar_mid", "PFPFPP"), // 3 flips / 5 = 0.6 → quarantine
				hist("quar_high", "PFPFPF"), // 5 flips / 5 = 1.0 → quarantine
				hist("a_trust", "PPPPPP"),
			],
		});
		expect(result.tests.map((t) => t.id)).toEqual([
			"quar_high", // quarantine, score 1.0
			"quar_mid", // quarantine, score 0.6
			"watch_low", // watch
			"a_trust", // trust, score 0, id "a" < "z"
			"z_trust",
		]);
	});

	it("computes counts and the id buckets consistently", () => {
		const result = classify({
			tests: [hist("q", "PFPFPF"), hist("w", "PPPPPF"), hist("t", "PPPPPP")],
		});
		expect(result.counts).toEqual({ total: 3, quarantined: 1, watched: 1, trusted: 1 });
		expect(result.quarantinedIds).toEqual(["q"]);
		expect(result.watchIds).toEqual(["w"]);
		expect(result.summary).toMatch(/1 quarantined, 1 watched, 1 trusted/);
	});

	it("dedups a repeated id last-write-wins", () => {
		const result = classify({
			tests: [hist("dup", "PPPPPP"), hist("dup", "PFPFPF")], // second (flaky) wins
		});
		expect(result.tests).toHaveLength(1);
		expect(pick(result, "dup").action).toBe("quarantine");
		expect(pick(result, "dup").flakeScore).toBe(1);
	});

	it("builds flakeScoresById covering every test exactly once", () => {
		const result = classify({
			tests: [hist("a", "PFPFPF"), hist("b", "PPPPPP"), hist("c", "PPPPPF")],
		});
		expect(Object.keys(result.flakeScoresById).sort()).toEqual(["a", "b", "c"]);
		expect(result.flakeScoresById.a).toBe(1);
		expect(result.flakeScoresById.b).toBe(0);
		expect(result.flakeScoresById.c).toBeCloseTo(0.2, 10);
	});
});

describe("classifyFlakeQuarantine — input robustness (clamps)", () => {
	it("clamps a non-finite / negative quarantineFlipRate to a usable bound", () => {
		const result = classify({
			tests: [hist("coin", "PFPFPF")],
			policy: { quarantineFlipRate: Number.NaN }, // → default 0.5
		});
		expect(pick(result, "coin").action).toBe("quarantine");
	});

	it("clamps minSamples up to at least 2", () => {
		// minSamples 0 → clamped to 2; a 2-sample alternating history (flip-rate 1.0) can now quarantine.
		const result = classify({
			tests: [hist("two", "PF")],
			policy: { minSamples: 0 },
		});
		expect(pick(result, "two").samples).toBe(2);
		expect(pick(result, "two").action).toBe("quarantine");
	});

	it("treats a fractional windowSize by flooring it", () => {
		const result = classify({
			tests: [hist("t", "PFPFPFPF")],
			policy: { windowSize: 4.9, minSamples: 4 },
		});
		expect(pick(result, "t").samples).toBe(4);
	});
});

describe("classifyFlakeQuarantine — composes with test-selection-priority", () => {
	it("feeds flakeScoresById as each candidate's flakeScore to deprioritize flaky tests", () => {
		const flake = classify({
			tests: [
				hist("flaky", "PFPFPF"), // score 1.0
				hist("solid", "PPPPPP"), // score 0
			],
		});

		// Both tests touch the same changed file (equal impact); the flake score is the only differentiator.
		const order = prioritizeTestSelection({
			changedFiles: [{ path: "src/core/mod.ts" }],
			tests: [
				{ id: "flaky", files: ["src/core/mod.ts"], flakeScore: flake.flakeScoresById.flaky },
				{ id: "solid", files: ["src/core/mod.ts"], flakeScore: flake.flakeScoresById.solid },
			],
		});

		// The solid test outranks the flaky one purely because the produced flakeScore penalised the flaky one.
		expect(order.ordered.map((t) => t.id)).toEqual(["solid", "flaky"]);
		expect(order.ordered.find((t) => t.id === "flaky")?.signals.flaky).toBe(true);
		expect(order.ordered.find((t) => t.id === "solid")?.signals.flaky).toBe(false);
	});

	it("quarantinedIds can be excluded from the prioritized run set", () => {
		const flake = classify({ tests: [hist("q", "PFPFPF"), hist("keep", "PPPPPP")] });
		const runnable = [
			{ id: "q", files: ["src/core/mod.ts"] },
			{ id: "keep", files: ["src/core/mod.ts"] },
		].filter((t) => !flake.quarantinedIds.includes(t.id));

		const order = prioritizeTestSelection({ changedFiles: [{ path: "src/core/mod.ts" }], tests: runnable });
		expect(order.ordered.map((t) => t.id)).toEqual(["keep"]);
	});
});
