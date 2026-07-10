import { describe, expect, it } from "vitest";

import { parseDevTestPreset, parseDevTestSweepPresets } from "../../../src/commands/dev-test-preset-parsing";

const ALL_PRESETS = [
	"mid_task",
	"complex_dag",
	"audio_vst",
	"daw_foundation",
	"wide_fanout",
	"deep_chain",
	"mixed_dag",
	"many_small",
] as const;

describe("parseDevTestPreset", () => {
	it("defaults to mid_task when the value is omitted", () => {
		expect(parseDevTestPreset(undefined)).toBe("mid_task");
	});

	it("accepts every recognized preset unchanged", () => {
		for (const preset of ALL_PRESETS) {
			expect(parseDevTestPreset(preset)).toBe(preset);
		}
	});

	it("throws with the list of valid presets on an unrecognized value", () => {
		expect(() => parseDevTestPreset("nope")).toThrow(/Expected one of:/);
		expect(() => parseDevTestPreset("nope")).toThrow(/mid_task/);
		expect(() => parseDevTestPreset("nope")).toThrow(/many_small/);
	});

	it("treats an empty string as invalid (not as the default)", () => {
		expect(() => parseDevTestPreset("")).toThrow(/Expected one of:/);
	});

	it("accepts any dev-test-projects registry id (the lower-20 scenario projects, §13f)", () => {
		expect(parseDevTestPreset("01_clinical_medication_safety_platform")).toBe(
			"01_clinical_medication_safety_platform",
		);
		expect(parseDevTestPreset("20_virtualized_microkernel_operating_system_lab")).toBe(
			"20_virtualized_microkernel_operating_system_lab",
		);
	});

	it("mentions registry ids in the rejection message", () => {
		expect(() => parseDevTestPreset("nope")).toThrow(/registry id/);
	});
});

describe("parseDevTestSweepPresets", () => {
	it("returns the default sweep set for undefined input", () => {
		expect(parseDevTestSweepPresets(undefined)).toEqual(["wide_fanout", "deep_chain", "mixed_dag", "many_small"]);
	});

	it("returns the default sweep set for blank/whitespace input", () => {
		expect(parseDevTestSweepPresets("   ")).toEqual(["wide_fanout", "deep_chain", "mixed_dag", "many_small"]);
	});

	it("returns a fresh array (not a shared reference to the defaults)", () => {
		const first = parseDevTestSweepPresets(undefined);
		const second = parseDevTestSweepPresets(undefined);
		expect(first).not.toBe(second);
	});

	it("splits, trims, and drops blank entries from a comma-separated list", () => {
		expect(parseDevTestSweepPresets(" mid_task , complex_dag ,, deep_chain ")).toEqual([
			"mid_task",
			"complex_dag",
			"deep_chain",
		]);
	});

	it("parses a single preset into a one-element list", () => {
		expect(parseDevTestSweepPresets("audio_vst")).toEqual(["audio_vst"]);
	});

	it("throws when any entry is an unrecognized preset", () => {
		expect(() => parseDevTestSweepPresets("mid_task,bogus")).toThrow(/Expected one of:/);
	});
});
