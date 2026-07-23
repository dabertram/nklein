import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	bindNightlyRecording,
	NightlyRecordingBindingError,
	parseNightlyRecordingEvidence,
	recordingSetIdForFixture,
} from "../../src/core/nightly-recording-evidence";

describe("nightly recording evidence", () => {
	it("binds the declared set and fixture to the exact served bytes", () => {
		const rawScenario = '{"name":"fixture","tracks":[{"turns":[]}]}\n';
		const result = bindNightlyRecording({
			selector: "02",
			resolvedFixture: "02_construction_jobsite_safety_compliance",
			expectedFixture: "02_construction_jobsite_safety_compliance",
			expectedRecordingSet: "sim-02",
			runFile: "perfect-run.json",
			rawScenario,
		});
		expect(result).toEqual({
			setId: "sim-02",
			fixture: "02_construction_jobsite_safety_compliance",
			runFile: "perfect-run.json",
			sha256: createHash("sha256").update(rawScenario).digest("hex"),
		});
	});

	it("fails closed when a selector resolves a different fixture than the manifest claims", () => {
		expect(() =>
			bindNightlyRecording({
				selector: "02",
				resolvedFixture: "02_real",
				expectedFixture: "03_other",
				expectedRecordingSet: "sim-02",
				runFile: "flaky-run.json",
				rawScenario: "{}",
			}),
		).toThrow(NightlyRecordingBindingError);
	});

	it("fails closed when the manifest's recording-set id is decorative or stale", () => {
		expect(() =>
			bindNightlyRecording({
				selector: "02",
				resolvedFixture: "02_real",
				expectedFixture: "02_real",
				expectedRecordingSet: "sim-99",
				runFile: "flaky-run.json",
				rawScenario: "{}",
			}),
		).toThrow(/recording-set mismatch/);
	});

	it("derives stable ids for numeric and named fixtures", () => {
		expect(recordingSetIdForFixture("20_virtualized_microkernel")).toBe("sim-20");
		expect(recordingSetIdForFixture("small-model-smoke")).toBe("sim-small-model-smoke");
	});

	it("revalidates the child receipt at the verdict boundary", () => {
		const sha256 = "a".repeat(64);
		expect(
			parseNightlyRecordingEvidence({
				raw: JSON.stringify({
					setId: "sim-02",
					fixture: "02_construction_jobsite_safety_compliance",
					runFile: "perfect-run.json",
					sha256,
				}),
				expectedFixture: "02_construction_jobsite_safety_compliance",
				expectedRecordingSet: "sim-02",
				expectedRunFile: "perfect-run.json",
			}),
		).toEqual({
			setId: "sim-02",
			fixture: "02_construction_jobsite_safety_compliance",
			runFile: "perfect-run.json",
			sha256,
		});
	});

	it.each([
		["fixture", { fixture: "03_other" }],
		["recording set", { setId: "sim-03" }],
		["run file", { runFile: "flaky-run.json" }],
		["digest", { sha256: "not-a-digest" }],
	])("rejects a stale or malformed %s receipt", (_label, override) => {
		expect(() =>
			parseNightlyRecordingEvidence({
				raw: JSON.stringify({
					setId: "sim-02",
					fixture: "02_construction_jobsite_safety_compliance",
					runFile: "perfect-run.json",
					sha256: "b".repeat(64),
					...override,
				}),
				expectedFixture: "02_construction_jobsite_safety_compliance",
				expectedRecordingSet: "sim-02",
				expectedRunFile: "perfect-run.json",
			}),
		).toThrow(NightlyRecordingBindingError);
	});
});
