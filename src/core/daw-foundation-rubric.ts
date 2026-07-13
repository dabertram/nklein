/**
 * F1.2 — the SCORING rubric for the DAW-foundation challenge preset (`daw_foundation` →
 * `dev-test-projects/daw-foundation-platform`, spec `scripts/dev-fixtures/daw-foundation-spec.md`). Mirrors the
 * shipped Audio/VST scorer pattern (`audio-vst-rubric.ts`): a harness grows/inspects the candidate built from the
 * timebase seed and distills what it MEASURED into a {@link DawFoundationRubricAnalysis}; this pure function scores
 * it against the spec's machine-checkable invariants (§18 acceptance criteria, §30 quality bar, §31 acceptance
 * command):
 *   1. timebase/engine correctness — tick↔sample conversions round-trip across tempo-map changes and event
 *      scheduling is sample-accurate (spec §16.2/§7: the bedrock every engine sits on).
 *   2. device DSP safety + golden determinism — bounded output, no NaN/denormal leakage, byte-identical golden
 *      re-renders, and golden-test coverage across the built-in devices (spec §30 "Real DSP, not stubs").
 *   3. project model integrity — a versioned schema that save→load round-trips, plus an undoable command model
 *      (spec §16 data model + §30 schema/migration bar).
 *   4. control surface — machine-readable MCP tool schemas and a capability registry (spec §15 + §14A: every
 *      platform difference is a capability entry, never silent feature loss).
 *   5. test discipline — the fixture's acceptance command passes and the modules carry their own tests
 *      (spec §31: honest, tested vertical slices over fake stubs).
 * Pure, total, deterministic — the SCORING is fully unit-testable independent of the candidate extraction.
 */

export interface DawFoundationRubricAnalysis {
	// ── Axis 1: timebase/engine correctness ──────────────────────────────────────
	/** tick→sample→tick round-trips are exact (within one tick) across the probed positions. */
	timebaseRoundTripsExact: boolean;
	/** Conversions stay correct across a tempo-map CHANGE (piecewise segments, not just constant tempo). */
	tempoMapChangesHandled: boolean;
	/** Scheduled events land on the exact expected sample (sample-accurate scheduling). */
	schedulingSampleAccurate: boolean;
	// ── Axis 2: device DSP safety + golden determinism ───────────────────────────
	/** Every probed render satisfies |sample| ≤ 1 (bounded output). */
	renderedBuffersBounded: boolean;
	/** No NaN/Infinity/denormal leakage observed in any probed render. */
	noNanOrDenormalOutput: boolean;
	/** Re-rendering identical settings reproduced byte-identical buffers (golden determinism). */
	goldenRendersDeterministic: boolean;
	/** Of `total` built-in devices discovered, how many carry a passing golden/deterministic test (`covered`). */
	deviceGoldenCoverage: { total: number; covered: number };
	// ── Axis 3: project model integrity ──────────────────────────────────────────
	/** The project schema declares an explicit version (migration-ready per spec §27/§30). */
	projectSchemaVersioned: boolean;
	/** save → load → save round-trips the probed project losslessly. */
	projectRoundTripsLosslessly: boolean;
	/** Of `total` mutating commands discovered, how many are undoable (`undoable`) — spec §15/§16 command model. */
	commandUndoCoverage: { total: number; undoable: number };
	// ── Axis 4: control surface (MCP + capabilities) ─────────────────────────────
	/** Of `total` MCP tools exposed, how many carry a complete machine-readable schema (`withSchema`). */
	mcpToolSchemaCoverage: { total: number; withSchema: number };
	/** A machine-readable capability registry exists (platform differences are entries, not silent loss). */
	capabilityRegistryPresent: boolean;
	// ── Axis 5: test discipline ──────────────────────────────────────────────────
	/** The fixture's acceptance command (`npm test`) completed successfully. */
	acceptanceCommandPassed: boolean;
	/** Of `total` source modules discovered, how many have at least one test exercising them (`tested`). */
	moduleTestCoverage: { total: number; tested: number };
}

export interface DawFoundationRubricScore {
	/** Per-axis score in [0,1]. */
	axes: {
		timebaseEngine: number;
		deviceDsp: number;
		projectModel: number;
		controlSurface: number;
		testDiscipline: number;
	};
	/** Weighted mean of the axes in [0,1] (the engine + DSP axes carry the most weight — they are the DAW core). */
	overall: number;
	/** Human-readable justification: which invariants passed / failed, most-significant first. */
	reasons: string[];
}

/** Axis weights (sum = 1): engine + DSP dominate; discipline is the lightest (necessary, not sufficient). */
const AXIS_WEIGHTS = {
	timebaseEngine: 0.3,
	deviceDsp: 0.25,
	projectModel: 0.2,
	controlSurface: 0.15,
	testDiscipline: 0.1,
} as const;

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function ratio(part: number, whole: number): number {
	return whole <= 0 ? 0 : clamp01(part / whole);
}

export function scoreDawFoundationRubric(analysis: DawFoundationRubricAnalysis): DawFoundationRubricScore {
	const reasons: string[] = [];

	// ── Axis 1: timebase/engine correctness (3 equal-weighted invariants) ────────
	const engineParts = [
		analysis.timebaseRoundTripsExact ? 1 : 0,
		analysis.tempoMapChangesHandled ? 1 : 0,
		analysis.schedulingSampleAccurate ? 1 : 0,
	];
	const timebaseEngine = clamp01(engineParts.reduce((sum, part) => sum + part, 0) / engineParts.length);
	if (!analysis.timebaseRoundTripsExact)
		reasons.push("Tick↔sample conversions do not round-trip exactly — the timebase bedrock is off.");
	if (!analysis.tempoMapChangesHandled)
		reasons.push("Conversions break across a tempo-map change (only constant tempo works).");
	if (!analysis.schedulingSampleAccurate)
		reasons.push("Scheduled events miss their exact sample positions (not sample-accurate).");

	// ── Axis 2: device DSP safety + golden determinism ───────────────────────────
	const goldenCoverage = ratio(analysis.deviceGoldenCoverage.covered, analysis.deviceGoldenCoverage.total);
	const dspParts = [
		analysis.renderedBuffersBounded ? 1 : 0,
		analysis.noNanOrDenormalOutput ? 1 : 0,
		analysis.goldenRendersDeterministic ? 1 : 0,
		goldenCoverage,
	];
	const deviceDsp = clamp01(dspParts.reduce((sum, part) => sum + part, 0) / dspParts.length);
	if (!analysis.renderedBuffersBounded)
		reasons.push("Rendered buffers clip past full scale (|sample| > 1) — the bounded invariant fails.");
	if (!analysis.noNanOrDenormalOutput) reasons.push("Renders leak NaN/Infinity/denormals into the output.");
	if (!analysis.goldenRendersDeterministic)
		reasons.push("Golden re-renders are not byte-identical (rendering is not deterministic).");
	if (goldenCoverage < 1)
		reasons.push(
			`${analysis.deviceGoldenCoverage.total - analysis.deviceGoldenCoverage.covered}/${analysis.deviceGoldenCoverage.total} built-in devices lack a passing golden/deterministic test.`,
		);

	// ── Axis 3: project model integrity ──────────────────────────────────────────
	const undoCoverage = ratio(analysis.commandUndoCoverage.undoable, analysis.commandUndoCoverage.total);
	const modelParts = [
		analysis.projectSchemaVersioned ? 1 : 0,
		analysis.projectRoundTripsLosslessly ? 1 : 0,
		undoCoverage,
	];
	const projectModel = clamp01(modelParts.reduce((sum, part) => sum + part, 0) / modelParts.length);
	if (!analysis.projectSchemaVersioned)
		reasons.push("The project schema carries no explicit version — migrations have nothing to key on.");
	if (!analysis.projectRoundTripsLosslessly) reasons.push("save → load → save loses project state.");
	if (undoCoverage < 1)
		reasons.push(
			`${analysis.commandUndoCoverage.total - analysis.commandUndoCoverage.undoable}/${analysis.commandUndoCoverage.total} mutating commands are not undoable.`,
		);

	// ── Axis 4: control surface (MCP + capabilities) ─────────────────────────────
	const mcpCoverage = ratio(analysis.mcpToolSchemaCoverage.withSchema, analysis.mcpToolSchemaCoverage.total);
	const controlSurface = clamp01((mcpCoverage + (analysis.capabilityRegistryPresent ? 1 : 0)) / 2);
	if (mcpCoverage < 1)
		reasons.push(
			`${analysis.mcpToolSchemaCoverage.total - analysis.mcpToolSchemaCoverage.withSchema}/${analysis.mcpToolSchemaCoverage.total} MCP tools lack a complete machine-readable schema.`,
		);
	if (!analysis.capabilityRegistryPresent)
		reasons.push("No machine-readable capability registry — platform differences would be silent feature loss.");

	// ── Axis 5: test discipline ──────────────────────────────────────────────────
	const testCoverage = ratio(analysis.moduleTestCoverage.tested, analysis.moduleTestCoverage.total);
	const testDiscipline = clamp01(((analysis.acceptanceCommandPassed ? 1 : 0) + testCoverage) / 2);
	if (!analysis.acceptanceCommandPassed) reasons.push("The acceptance command (`npm test`) does not pass.");
	if (testCoverage < 1)
		reasons.push(
			`${analysis.moduleTestCoverage.total - analysis.moduleTestCoverage.tested}/${analysis.moduleTestCoverage.total} source modules have no test exercising them.`,
		);

	const axes = { timebaseEngine, deviceDsp, projectModel, controlSurface, testDiscipline };
	const weighted =
		axes.timebaseEngine * AXIS_WEIGHTS.timebaseEngine +
		axes.deviceDsp * AXIS_WEIGHTS.deviceDsp +
		axes.projectModel * AXIS_WEIGHTS.projectModel +
		axes.controlSurface * AXIS_WEIGHTS.controlSurface +
		axes.testDiscipline * AXIS_WEIGHTS.testDiscipline;
	// Round to 6 decimals so a score can't carry floating-point noise (e.g. 0.999…9 for an all-1 candidate).
	const overall = clamp01(Math.round(weighted * 1e6) / 1e6);
	return { axes, overall, reasons };
}
