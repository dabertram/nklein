import { describe, expect, it } from "vitest";
import { type DawFoundationRubricAnalysis, scoreDawFoundationRubric } from "../../../src/core/daw-foundation-rubric";

function perfect(): DawFoundationRubricAnalysis {
	return {
		timebaseRoundTripsExact: true,
		tempoMapChangesHandled: true,
		schedulingSampleAccurate: true,
		renderedBuffersBounded: true,
		noNanOrDenormalOutput: true,
		goldenRendersDeterministic: true,
		deviceGoldenCoverage: { total: 6, covered: 6 },
		projectSchemaVersioned: true,
		projectRoundTripsLosslessly: true,
		commandUndoCoverage: { total: 12, undoable: 12 },
		mcpToolSchemaCoverage: { total: 10, withSchema: 10 },
		capabilityRegistryPresent: true,
		acceptanceCommandPassed: true,
		moduleTestCoverage: { total: 8, tested: 8 },
	};
}

describe("scoreDawFoundationRubric (F1.2)", () => {
	it("scores a perfect candidate 1.0 with no reasons", () => {
		const score = scoreDawFoundationRubric(perfect());
		expect(score.overall).toBe(1);
		expect(Object.values(score.axes).every((axis) => axis === 1)).toBe(true);
		expect(score.reasons).toEqual([]);
	});

	it("a broken timebase costs a third of the heaviest axis and surfaces its reason", () => {
		const score = scoreDawFoundationRubric({ ...perfect(), timebaseRoundTripsExact: false });
		expect(score.axes.timebaseEngine).toBeCloseTo(2 / 3, 5);
		expect(score.axes.deviceDsp).toBe(1);
		expect(score.reasons.join(" ")).toMatch(/round-trip/i);
	});

	it("golden-test coverage degrades the DSP axis proportionally", () => {
		const score = scoreDawFoundationRubric({ ...perfect(), deviceGoldenCoverage: { total: 6, covered: 3 } });
		expect(score.axes.deviceDsp).toBeCloseTo((1 + 1 + 1 + 0.5) / 4, 5);
		expect(score.reasons.join(" ")).toMatch(/3\/6 built-in devices lack/);
	});

	it("an unversioned, lossy project model with partial undo coverage collapses the model axis", () => {
		const score = scoreDawFoundationRubric({
			...perfect(),
			projectSchemaVersioned: false,
			projectRoundTripsLosslessly: false,
			commandUndoCoverage: { total: 12, undoable: 6 },
		});
		expect(score.axes.projectModel).toBeCloseTo(0.5 / 3, 5);
		expect(score.reasons.join(" ")).toMatch(/no explicit version/i);
		expect(score.reasons.join(" ")).toMatch(/loses project state/i);
	});

	it("MCP schema gaps and a missing capability registry halve the control-surface axis each", () => {
		const partial = scoreDawFoundationRubric({
			...perfect(),
			mcpToolSchemaCoverage: { total: 10, withSchema: 5 },
		});
		expect(partial.axes.controlSurface).toBeCloseTo(0.75, 5);
		const noRegistry = scoreDawFoundationRubric({ ...perfect(), capabilityRegistryPresent: false });
		expect(noRegistry.axes.controlSurface).toBeCloseTo(0.5, 5);
		expect(noRegistry.reasons.join(" ")).toMatch(/capability registry/i);
	});

	it("a failing acceptance command costs half the discipline axis; empty totals score 0, never NaN", () => {
		const failing = scoreDawFoundationRubric({ ...perfect(), acceptanceCommandPassed: false });
		expect(failing.axes.testDiscipline).toBeCloseTo(0.5, 5);
		const empty = scoreDawFoundationRubric({
			...perfect(),
			deviceGoldenCoverage: { total: 0, covered: 0 },
			commandUndoCoverage: { total: 0, undoable: 0 },
			mcpToolSchemaCoverage: { total: 0, withSchema: 0 },
			moduleTestCoverage: { total: 0, tested: 0 },
		});
		expect(Number.isFinite(empty.overall)).toBe(true);
		// An empty candidate earns nothing on the ratio parts — no devices/commands/tools/tests is not coverage.
		expect(empty.axes.deviceDsp).toBeCloseTo(3 / 4, 5);
		expect(empty.axes.controlSurface).toBeCloseTo(0.5, 5);
	});

	it("weights the axes toward the engine + DSP core", () => {
		const engineOnlyBroken = scoreDawFoundationRubric({
			...perfect(),
			timebaseRoundTripsExact: false,
			tempoMapChangesHandled: false,
			schedulingSampleAccurate: false,
		});
		const disciplineOnlyBroken = scoreDawFoundationRubric({
			...perfect(),
			acceptanceCommandPassed: false,
			moduleTestCoverage: { total: 8, tested: 0 },
		});
		expect(engineOnlyBroken.overall).toBeCloseTo(0.7, 5);
		expect(disciplineOnlyBroken.overall).toBeCloseTo(0.9, 5);
		expect(engineOnlyBroken.overall).toBeLessThan(disciplineOnlyBroken.overall);
	});
});
