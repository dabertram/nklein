import { describe, expect, it } from "vitest";
import {
	detectVerdictFlips,
	EMPTY_NIGHTLY_QUARANTINE,
	formatQuarantineReport,
	mergeNightlyQuarantine,
	type NightlyQuarantineEntry,
	parseNightlyQuarantineFile,
	serializeNightlyQuarantineFile,
	splitVerdictsByQuarantine,
} from "../../../src/core/nightly-flake-quarantine";

const entry = (cellId: string, over: Partial<NightlyQuarantineEntry> = {}): NightlyQuarantineEntry => ({
	cellId,
	quarantinedAt: "2026-07-23T00:00:00.000Z",
	firstOutcome: "passed",
	secondOutcome: "failed",
	firstReason: null,
	secondReason: "boom",
	note: "n",
	...over,
});

describe("detectVerdictFlips (N13)", () => {
	it("quarantines exactly the pairs whose outcomes differ, in either direction", () => {
		const flips = detectVerdictFlips(
			[
				{
					cellId: "stable-pass",
					first: { outcome: "passed", reason: null },
					second: { outcome: "passed", reason: null },
				},
				{
					cellId: "stable-fail",
					first: { outcome: "failed", reason: "same" },
					second: { outcome: "failed", reason: "same" },
				},
				{
					cellId: "flip-pf",
					first: { outcome: "passed", reason: null },
					second: { outcome: "failed", reason: "late" },
				},
				{
					cellId: "flip-fp",
					first: { outcome: "failed", reason: "early" },
					second: { outcome: "passed", reason: null },
				},
			],
			"2026-07-23T12:00:00.000Z",
		);
		expect(flips.map((flip) => flip.cellId)).toEqual(["flip-pf", "flip-fp"]);
		expect(flips[0]?.quarantinedAt).toBe("2026-07-23T12:00:00.000Z");
		expect(flips[0]?.secondReason).toBe("late");
		expect(flips[1]?.firstReason).toBe("early");
	});

	it("a stable double-fail is NOT a flake — it is a real failure and stays in the gate", () => {
		expect(
			detectVerdictFlips(
				[{ cellId: "c", first: { outcome: "failed", reason: "r" }, second: { outcome: "failed", reason: "r" } }],
				"t",
			),
		).toEqual([]);
	});
});

describe("quarantine persistence", () => {
	it("round-trips through serialize/parse", () => {
		const file = mergeNightlyQuarantine(EMPTY_NIGHTLY_QUARANTINE, [entry("a"), entry("b")]);
		expect(parseNightlyQuarantineFile(serializeNightlyQuarantineFile(file))).toEqual(file);
	});

	it("parses null/blank/corrupt input to the empty file instead of crashing the suite", () => {
		expect(parseNightlyQuarantineFile(null)).toEqual(EMPTY_NIGHTLY_QUARANTINE);
		expect(parseNightlyQuarantineFile("  ")).toEqual(EMPTY_NIGHTLY_QUARANTINE);
		expect(parseNightlyQuarantineFile("{not json")).toEqual(EMPTY_NIGHTLY_QUARANTINE);
		expect(parseNightlyQuarantineFile('{"schemaVersion":2,"entries":[]}')).toEqual(EMPTY_NIGHTLY_QUARANTINE);
		expect(
			parseNightlyQuarantineFile('{"schemaVersion":1,"entries":[{"cellId":""},{"cellId":"ok"}]}').entries,
		).toEqual([{ cellId: "ok" }]);
	});

	it("merge keeps the ORIGINAL entry for an already-quarantined cell (first observation wins)", () => {
		const existing = mergeNightlyQuarantine(EMPTY_NIGHTLY_QUARANTINE, [
			entry("a", { quarantinedAt: "2026-07-01T00:00:00.000Z" }),
		]);
		const merged = mergeNightlyQuarantine(existing, [
			entry("a", { quarantinedAt: "2026-07-23T00:00:00.000Z" }),
			entry("b"),
		]);
		expect(merged.entries.map((each) => each.cellId)).toEqual(["a", "b"]);
		expect(merged.entries[0]?.quarantinedAt).toBe("2026-07-01T00:00:00.000Z");
	});
});

describe("splitVerdictsByQuarantine", () => {
	it("excludes quarantined cells from the gate while keeping them reported", () => {
		const quarantine = mergeNightlyQuarantine(EMPTY_NIGHTLY_QUARANTINE, [entry("flaky-cell")]);
		const verdicts = [{ id: "flaky-cell" }, { id: "solid-cell" }];
		const split = splitVerdictsByQuarantine(verdicts, (verdict) => verdict.id, quarantine);
		expect(split.gated).toEqual([{ id: "solid-cell" }]);
		expect(split.quarantined).toHaveLength(1);
		expect(split.quarantined[0]?.verdict).toEqual({ id: "flaky-cell" });
		expect(split.quarantined[0]?.entry.cellId).toBe("flaky-cell");
	});
});

describe("formatQuarantineReport", () => {
	it("is silent when nothing is quarantined and LOUD when something is", () => {
		expect(formatQuarantineReport({ file: EMPTY_NIGHTLY_QUARANTINE, newlyQuarantined: [] })).toBe("");
		const file = mergeNightlyQuarantine(EMPTY_NIGHTLY_QUARANTINE, [entry("old-cell"), entry("new-cell")]);
		const report = formatQuarantineReport({ file, newlyQuarantined: [entry("new-cell")] });
		expect(report).toContain("EXCLUDED FROM THE GATE");
		expect(report).toContain("new-cell (NEW THIS RUN)");
		expect(report).toContain("old-cell (since 2026-07-23T00:00:00.000Z)");
		expect(report).toContain("delete this entry".length > 0 ? "delete it from nightly-quarantine.json" : "");
		expect(report).toContain("run1=passed, run2=failed (boom)");
	});
});
