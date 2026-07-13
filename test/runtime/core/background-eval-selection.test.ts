import { describe, expect, it } from "vitest";
import {
	type BackgroundEvalModelCandidate,
	type BackgroundEvalProjectCandidate,
	type BackgroundEvalRecentRun,
	type BackgroundEvalSelectionInput,
	deriveBackgroundEvalModelEvidence,
	selectBackgroundEvalTarget,
} from "../../../src/core/background-eval-selection";

/**
 * F1.32 — the rail's (project, model) target picker: pin-exact-or-nothing, evidence-driven need ranking,
 * deterministic rotation/random, and the capability / resource / recent-coverage gates every mode honors.
 */

const projects: BackgroundEvalProjectCandidate[] = [{ projectId: "proj-a" }, { projectId: "proj-b" }];

function model(overrides: Partial<BackgroundEvalModelCandidate> & { modelId: string }): BackgroundEvalModelCandidate {
	return { capable: true, fitsResources: true, ...overrides };
}

function baseInput(overrides: Partial<BackgroundEvalSelectionInput> = {}): BackgroundEvalSelectionInput {
	return {
		mode: "rotation",
		projects,
		models: [model({ modelId: "m1" }), model({ modelId: "m2" })],
		recentRuns: [],
		recentCoverageWindowMs: 60_000,
		now: 1_000_000,
		...overrides,
	};
}

describe("hard gates", () => {
	it("fails typed on no projects / no capable model / no resource fit", () => {
		expect(selectBackgroundEvalTarget(baseInput({ projects: [] }))).toEqual({ ok: false, reason: "no_projects" });
		expect(selectBackgroundEvalTarget(baseInput({ models: [model({ modelId: "m1", capable: false })] }))).toEqual({
			ok: false,
			reason: "no_capable_model",
		});
		expect(
			selectBackgroundEvalTarget(baseInput({ models: [model({ modelId: "m1", fitsResources: false })] })),
		).toEqual({ ok: false, reason: "no_resource_fit" });
	});

	it("excludes pairs inside the recent-coverage window and fails when everything is covered", () => {
		const recentRuns: BackgroundEvalRecentRun[] = [];
		for (const project of projects) {
			for (const modelId of ["m1", "m2"]) {
				recentRuns.push({ projectId: project.projectId, modelId, at: 990_000 }); // 10s ago, inside 60s window
			}
		}
		expect(selectBackgroundEvalTarget(baseInput({ recentRuns }))).toEqual({
			ok: false,
			reason: "all_recently_covered",
		});
		// The same runs OUTSIDE the window do not block.
		const stale = recentRuns.map((run) => ({ ...run, at: 900_000 }));
		expect(selectBackgroundEvalTarget(baseInput({ recentRuns: stale })).ok).toBe(true);
	});
});

describe("pinned mode", () => {
	it("honors an exact project+model pin", () => {
		const selection = selectBackgroundEvalTarget(
			baseInput({ mode: "pinned", pinnedProjectId: "proj-b", pinnedModelId: "m2" }),
		);
		expect(selection).toEqual({ ok: true, projectId: "proj-b", modelId: "m2", mode: "pinned" });
	});

	it("a pin that is not eligible fails (never substitutes)", () => {
		expect(selectBackgroundEvalTarget(baseInput({ mode: "pinned", pinnedModelId: "unknown-model" }))).toEqual({
			ok: false,
			reason: "pin_unavailable",
		});
		// Pinned model exists but is resource-blocked → still pin_unavailable, not a silent swap.
		expect(
			selectBackgroundEvalTarget(
				baseInput({
					mode: "pinned",
					pinnedModelId: "m2",
					models: [model({ modelId: "m1" }), model({ modelId: "m2", fitsResources: false })],
				}),
			),
		).toEqual({ ok: false, reason: "pin_unavailable" });
	});

	it("with only the project pinned, the model falls through to evidence need", () => {
		const selection = selectBackgroundEvalTarget(
			baseInput({
				mode: "pinned",
				pinnedProjectId: "proj-a",
				models: [
					model({ modelId: "covered", evidence: { topProbePriority: 0, probeCount: 0 } }),
					model({ modelId: "gappy", evidence: { topProbePriority: 0.9, probeCount: 4 } }),
				],
			}),
		);
		expect(selection).toEqual({ ok: true, projectId: "proj-a", modelId: "gappy", mode: "pinned" });
	});
});

describe("evidence mode", () => {
	it("picks the model with the greatest coverage need, then its least-recently-covered project", () => {
		const selection = selectBackgroundEvalTarget(
			baseInput({
				mode: "evidence",
				models: [
					model({ modelId: "fresh", evidence: { topProbePriority: 0.2, probeCount: 1 } }),
					model({ modelId: "needy", evidence: { topProbePriority: 0.8, probeCount: 2 } }),
				],
				// needy ran proj-a more recently than proj-b (both outside the window) → proj-b is the LRU pick.
				recentRuns: [
					{ projectId: "proj-a", modelId: "needy", at: 500_000 },
					{ projectId: "proj-b", modelId: "needy", at: 100_000 },
				],
			}),
		);
		expect(selection).toEqual({ ok: true, projectId: "proj-b", modelId: "needy", mode: "evidence" });
	});

	it("equal top priority breaks by probe count", () => {
		const selection = selectBackgroundEvalTarget(
			baseInput({
				mode: "evidence",
				models: [
					model({ modelId: "few", evidence: { topProbePriority: 0.6, probeCount: 1 } }),
					model({ modelId: "many", evidence: { topProbePriority: 0.6, probeCount: 5 } }),
				],
			}),
		);
		expect(selection).toMatchObject({ ok: true, modelId: "many" });
	});
});

describe("rotation mode", () => {
	it("is pair-level LRU: never-run pairs first, then the longest-ago pair", () => {
		const first = selectBackgroundEvalTarget(baseInput({ mode: "rotation" }));
		expect(first).toEqual({ ok: true, projectId: "proj-a", modelId: "m1", mode: "rotation" }); // stable order

		const afterAll = selectBackgroundEvalTarget(
			baseInput({
				mode: "rotation",
				recentRuns: [
					{ projectId: "proj-a", modelId: "m1", at: 400_000 },
					{ projectId: "proj-a", modelId: "m2", at: 300_000 },
					{ projectId: "proj-b", modelId: "m1", at: 200_000 },
					{ projectId: "proj-b", modelId: "m2", at: 100_000 }, // oldest → next up
				],
			}),
		);
		expect(afterAll).toEqual({ ok: true, projectId: "proj-b", modelId: "m2", mode: "rotation" });
	});
});

describe("random mode", () => {
	it("is deterministic for a given seed and varies across seeds", () => {
		const seedZero = selectBackgroundEvalTarget(baseInput({ mode: "random", randomSeed: 0 }));
		expect(seedZero).toEqual(selectBackgroundEvalTarget(baseInput({ mode: "random", randomSeed: 0 })));
		const picks = new Set(
			[0, 1, 2, 3, 4, 5, 6, 7].map((seed) => {
				const selection = selectBackgroundEvalTarget(baseInput({ mode: "random", randomSeed: seed }));
				if (!selection.ok) {
					throw new Error("expected a pick");
				}
				return `${selection.projectId} ${selection.modelId}`;
			}),
		);
		expect(picks.size).toBeGreaterThan(1); // not stuck on one pair across seeds
	});
});

describe("deriveBackgroundEvalModelEvidence", () => {
	it("folds a probe plan to (top priority, count) and an empty plan to zero need", () => {
		expect(
			deriveBackgroundEvalModelEvidence([
				{ role: "worker", tier: "easy", coverage: "unmeasured", priority: 0.75 },
				{ role: "reviewer", tier: "easy", coverage: "stale", priority: 0.3 },
			]),
		).toEqual({ topProbePriority: 0.75, probeCount: 2 });
		expect(deriveBackgroundEvalModelEvidence([])).toEqual({ topProbePriority: 0, probeCount: 0 });
	});
});
