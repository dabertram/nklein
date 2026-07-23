import type { NightlyModelIoCost } from "./nightly-cell-cost";
import type { NightlyHermeticEvidence } from "./nightly-hermeticity";
import type {
	NightlyPersistedStateEvidence,
	NightlyPersistedStateFixtureRef,
} from "./nightly-persisted-state-compatibility";
import type { NightlyRecordingEvidence } from "./nightly-recording-evidence";

/**
 * N1 — the nightly-tests MANIFEST and cell model. PURE core.
 *
 * The item's design constraint is the whole point: **"registration = one manifest entry per project, so ADDING
 * coverage is DATA, not new plumbing."** If covering another dev-test project requires editing a runner, coverage
 * stops growing the moment the person who understands the runner is busy. So the manifest is the API, and this
 * module owns enumerating cells from it and aggregating their verdicts.
 *
 * ── TWO NON-NEGOTIABLES INHERITED FROM LIVE EXPERIENCE ──
 *  1. **SEQUENTIAL by default.** Parallel drains of the large scenario sets starve each other's in-scenario
 *     `npm test` steps and FALSE-TIMEOUT — live-hit 2026-07-11 and recorded in the proto-runner
 *     (`scripts/verify-all-simulated-flows.sh`). A nightly suite that reports flaky failures teaches people to
 *     ignore it, which is worse than not having one.
 *  2. **NO SILENT TRUNCATION.** Every skipped or failed cell must be NAMED in the summary. A suite that quietly
 *     drops cells reports green while covering less than it claims — the exact failure mode the mechanism audit
 *     found elsewhere today, and the reason `enabled_but_silent` is a category at all.
 */

export interface NightlyProjectEntry {
	readonly id: string;
	/** Exact dev-test/scenario fixture directory this project executes. */
	readonly fixture: string;
	/** aimock recording set that drains it end-to-end. */
	readonly recordingSet: string;
	/** Invariant pack asserted after the drain. */
	readonly invariantPack: string;
	/** Model profiles this project is exercised against. */
	readonly modelProfiles: readonly string[];
}

export interface NightlyManifest {
	readonly projects: readonly NightlyProjectEntry[];
	/** N9: one immutable prior-release HOME, booted and drained on the current build. */
	readonly persistedStateFixtures?: readonly NightlyPersistedStateEntry[];
}

export interface NightlyPersistedStateEntry extends NightlyProjectEntry {
	readonly persistedStateFixture: NightlyPersistedStateFixtureRef;
}

export interface NightlyCell {
	readonly projectId: string;
	/** Exact dev-test/scenario fixture directory this cell must execute. */
	readonly fixture: string;
	readonly modelProfile: string;
	readonly recordingSet: string;
	readonly invariantPack: string;
	readonly persistedStateFixture?: NightlyPersistedStateFixtureRef;
}

export interface CellFilter {
	readonly project?: string | null;
	readonly model?: string | null;
}

/**
 * Enumerate project × model cells, in manifest order.
 *
 * Deterministic ordering matters: a nightly run that shuffles cells produces summaries that cannot be diffed
 * against yesterday's, which is most of the value of running it nightly.
 */
export function enumerateNightlyCells(manifest: NightlyManifest, filter: CellFilter = {}): NightlyCell[] {
	const cells: NightlyCell[] = [];
	for (const project of manifest.projects) {
		if (filter.project && project.id !== filter.project) {
			continue;
		}
		for (const modelProfile of project.modelProfiles) {
			if (filter.model && modelProfile !== filter.model) {
				continue;
			}
			cells.push({
				projectId: project.id,
				fixture: project.fixture,
				modelProfile,
				recordingSet: project.recordingSet,
				invariantPack: project.invariantPack,
			});
		}
	}
	for (const project of manifest.persistedStateFixtures ?? []) {
		if (filter.project && project.id !== filter.project) continue;
		for (const modelProfile of project.modelProfiles) {
			if (filter.model && modelProfile !== filter.model) continue;
			cells.push({
				projectId: project.id,
				fixture: project.fixture,
				modelProfile,
				recordingSet: project.recordingSet,
				invariantPack: project.invariantPack,
				persistedStateFixture: project.persistedStateFixture,
			});
		}
	}
	return cells;
}

export function nightlyCellName(cell: NightlyCell): string {
	const home = cell.persistedStateFixture ? `@home-${cell.persistedStateFixture.releaseVersion}` : "";
	return `${cell.projectId}×${cell.modelProfile}${home}`;
}

/** Stable persistence/scheduling key. Keep the historical spaced form so existing baselines remain usable. */
export function nightlyCellKey(cell: NightlyCell): string {
	const home = cell.persistedStateFixture ? `@home-${cell.persistedStateFixture.releaseVersion}` : "";
	return `${cell.projectId} × ${cell.modelProfile}${home}`;
}

export type CellOutcome = "passed" | "failed" | "skipped";

export interface CellVerdict {
	readonly cell: NightlyCell;
	readonly outcome: CellOutcome;
	/** Why it failed or was skipped. REQUIRED for anything that is not a pass — a bare "skipped" hides its cause. */
	readonly reason?: string;
	readonly durationMs?: number;
	/** Unmatched aimock requests — the F11.4c invariant is that this is ZERO. */
	readonly unmatchedRequests?: number;
	/**
	 * N7b: the drain's emitted `finalCounts` as raw JSON, or absent when the drain did not emit it (an older
	 * script, or a run that died first). Absent must stay absent — N5 turns "no cards observed" into
	 * `indeterminate`, and defaulting it to an empty board would report a clean drain that never happened.
	 */
	readonly terminalLanesJson?: string | null;
	/** N7c: the cell's isolated HOME, so its self-observation log can be read for fired signals. */
	readonly homePath?: string | null;
	/**
	 * Create-only evidence emitted by the drain after resolving the declared recording set to exact bytes.
	 * Missing evidence is a failed cell at the runner boundary; it must never be synthesized by this summary core.
	 */
	readonly recordingEvidence?: NightlyRecordingEvidence | null;
	/** Exact tokenizer-neutral model request + matched-response byte cost emitted by the aimock journal. */
	readonly modelIoCost?: NightlyModelIoCost | null;
	/** N4 fail-closed receipt proving every declared ambient dependency was fenced or replaced. */
	readonly hermeticEvidence?: NightlyHermeticEvidence | null;
	/** N9: create-only evidence that a prior-release HOME migrated and folded old+current learning state. */
	readonly persistedStateEvidence?: NightlyPersistedStateEvidence | null;
}

export interface NightlySummary {
	readonly total: number;
	readonly passed: number;
	readonly failed: number;
	readonly skipped: number;
	/** Every non-passing cell, NAMED. Never truncated. */
	readonly problems: readonly { readonly cell: string; readonly outcome: CellOutcome; readonly reason: string }[];
	/** Cells that drained but left unmatched aimock requests — a pass that violates F11.4c is not a pass. */
	readonly unmatchedViolations: readonly string[];
	readonly ok: boolean;
	readonly summary: string;
}

/**
 * Aggregate cell verdicts.
 *
 * `ok` requires more than "no failures": a cell that PASSED while leaving unmatched aimock requests violates the
 * F11.4c invariant, which means the recording did not actually cover what the run did. Counting that as a pass
 * would let coverage silently rot while the suite stayed green.
 */
export function summarizeNightlyRun(verdicts: readonly CellVerdict[]): NightlySummary {
	const problems: { cell: string; outcome: CellOutcome; reason: string }[] = [];
	const unmatchedViolations: string[] = [];
	let passed = 0;
	let failed = 0;
	let skipped = 0;

	for (const verdict of verdicts) {
		const name = nightlyCellName(verdict.cell);
		if (verdict.outcome === "passed") {
			passed += 1;
			if ((verdict.unmatchedRequests ?? 0) > 0) {
				unmatchedViolations.push(`${name} (${verdict.unmatchedRequests} unmatched)`);
			}
			continue;
		}
		if (verdict.outcome === "failed") {
			failed += 1;
		} else {
			skipped += 1;
		}
		problems.push({
			cell: name,
			outcome: verdict.outcome,
			reason: verdict.reason ?? "(no reason recorded — a cell that is not a pass MUST say why)",
		});
	}

	const ok = failed === 0 && skipped === 0 && unmatchedViolations.length === 0;
	const parts = [`${verdicts.length} cell(s): ${passed} passed, ${failed} failed, ${skipped} skipped.`];
	if (problems.length > 0) {
		parts.push(`Problems: ${problems.map((p) => `${p.cell} [${p.outcome}] ${p.reason}`).join("; ")}.`);
	}
	if (unmatchedViolations.length > 0) {
		parts.push(
			`⚠️ ${unmatchedViolations.length} cell(s) PASSED but left unmatched aimock requests (${unmatchedViolations.join(", ")}) — the recording did not cover what the run did, so coverage is rotting while the suite stays green. Not counted as ok.`,
		);
	}
	if (verdicts.length === 0) {
		parts.push("No cells ran — an empty nightly run is not a green one.");
	}

	return {
		total: verdicts.length,
		passed,
		failed,
		skipped,
		problems,
		unmatchedViolations,
		ok: ok && verdicts.length > 0,
		summary: parts.join(" "),
	};
}
