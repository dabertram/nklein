import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	fetchLoadedModelDescriptors: vi.fn(async (_baseUrl: string) => [] as Array<Record<string, unknown>>),
	recordSelfObservation: vi.fn(),
}));
vi.mock("../../../src/core/lmstudio-loaded-model-descriptors", () => ({
	fetchLoadedModelDescriptors: mocks.fetchLoadedModelDescriptors,
}));
vi.mock("../../../src/telemetry/self-observation-sink", () => ({
	recordSelfObservation: mocks.recordSelfObservation,
}));

import { buildPromptShellKey } from "../../../src/core/cache-warmth";
import type { ReviewerCapabilityEvidence } from "../../../src/core/reviewer-capability-ranking";
import type { loadReviewerCapabilityEvidence } from "../../../src/nklein-agent/nklein-reviewer-capability-evidence";
import {
	pickDiverseReviewerModel,
	type ReviewerModelSelectionDeps,
} from "../../../src/nklein-agent/nklein-reviewer-model-selection";

const workerLaunch = { providerId: "lmstudio", modelId: "worker-m", baseUrl: "http://127.0.0.1:1234/v1" } as never;

/**
 * P0.REVRANK: an evidence loader that knows the given per-model capabilities and NOTHING about any other model —
 * `null` for an unlisted one, so the tests exercise the real "missing evidence is not a score" path rather than a
 * store read. Every case states its evidence explicitly; none inherits a live ledger.
 */
const evidenceLoader = (
	scores: Record<string, number | { score: number; basis?: ReviewerCapabilityEvidence["basis"]; samples?: number }>,
	enabled = true,
): typeof loadReviewerCapabilityEvidence =>
	(async () => ({
		enabled,
		resolve: (model: { runtimeId: string; modelKey: string }) => {
			const hit = scores[model.runtimeId] ?? scores[model.modelKey];
			if (hit === undefined) {
				return null;
			}
			const entry = typeof hit === "number" ? { score: hit } : hit;
			return {
				score: entry.score,
				basis: entry.basis ?? "observed",
				samples: entry.samples ?? 5,
				detail: `test evidence ${entry.score}`,
			};
		},
	})) as typeof loadReviewerCapabilityEvidence;

/** The pre-evidence baseline: class fit alone orders (the kill-switch shape). */
const noEvidence = evidenceLoader({}, false);

const deps: ReviewerModelSelectionDeps = { lastShellKeyByModel: new Map(), loadCapabilityEvidence: noEvidence };

beforeEach(() => vi.clearAllMocks());

describe("pickDiverseReviewerModel", () => {
	it("returns null when no models are loaded (empty descriptors)", async () => {
		mocks.fetchLoadedModelDescriptors.mockResolvedValueOnce([]);
		expect(await pickDiverseReviewerModel(workerLaunch, "t1", "review", deps)).toBeNull();
	});

	it("returns null when the only loaded model is the worker's own (no reviewer candidate)", async () => {
		mocks.fetchLoadedModelDescriptors.mockResolvedValueOnce([
			{ runtimeId: "worker-m", modelKey: "worker-m", isEmbedding: false },
		]);
		expect(await pickDiverseReviewerModel(workerLaunch, "t1", "review", deps)).toBeNull();
	});

	it("swallows a descriptor-fetch failure and returns null (best-effort, never throws)", async () => {
		mocks.fetchLoadedModelDescriptors.mockRejectedValueOnce(new Error("lmstudio down"));
		await expect(pickDiverseReviewerModel(workerLaunch, "t1", "review", deps)).resolves.toBeNull();
	});

	it("uses the strongest non-worker candidate when the capability margin waives lineage diversity", async () => {
		mocks.fetchLoadedModelDescriptors.mockResolvedValueOnce([
			{
				runtimeId: "qwen/qwen2.5-coder-14b",
				modelKey: "qwen/qwen2.5-coder-14b",
				isEmbedding: false,
				toolUse: false,
				architecture: "qwen2",
			},
			{
				runtimeId: "qwen/qwen3.6-35b-a3b",
				modelKey: "qwen/qwen3.6-35b-a3b",
				isEmbedding: false,
				toolUse: true,
				reasoning: true,
				architecture: "qwen3_5_moe",
			},
			{
				runtimeId: "google/gemma-4-31b-qat",
				modelKey: "google/gemma-4-31b-qat",
				isEmbedding: false,
				toolUse: true,
				reasoning: true,
				architecture: "gemma4",
			},
		]);
		const qwenWorker = {
			providerId: "lmstudio",
			modelId: "qwen/qwen2.5-coder-14b",
			baseUrl: "http://127.0.0.1:1234/v1",
		} as never;

		const pick = await pickDiverseReviewerModel(qwenWorker, "t-margin", "review", deps);

		expect(pick).toEqual({ providerId: "lmstudio", modelId: "qwen/qwen3.6-35b-a3b" });
		expect(mocks.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining("instead of worker self-review"),
				metadata: expect.objectContaining({
					category: "reviewer_auto_diverse_waived",
					reviewer: "qwen/qwen3.6-35b-a3b",
					worker: "qwen/qwen2.5-coder-14b",
				}),
			}),
		);
	});

	it("a WARM shallow diverse model does NOT displace a COLD deep diverse judge (warmth capability-margin-bounded)", async () => {
		// Worker is qwen; two diverse candidates: a DEEP reasoning judge (cold) and a SHALLOW chat model (warm).
		mocks.fetchLoadedModelDescriptors.mockResolvedValueOnce([
			{ runtimeId: "phi-rt", modelKey: "phi-4-reasoning-plus", isEmbedding: false }, // reasoning → high reviewer-fit, COLD
			{ runtimeId: "gemma-rt", modelKey: "gemma-3-12b-it", isEmbedding: false }, // chat → low reviewer-fit, WARM
		]);
		const qwenWorker = {
			providerId: "lmstudio",
			modelId: "qwen3.6-27b",
			baseUrl: "http://127.0.0.1:1234/v1",
		} as never;
		// Make the shallow gemma HOT for the review shell (its ledger is keyed by the candidate's servable id = runtimeId).
		const warmDeps: ReviewerModelSelectionDeps = {
			loadCapabilityEvidence: noEvidence,
			lastShellKeyByModel: new Map([
				[
					"gemma-rt",
					{
						shellKey: buildPromptShellKey({ sessionKind: "review", workspacePath: "", modelId: "gemma-rt" }),
						at: Date.now(),
					},
				],
			]),
		};
		const pick = await pickDiverseReviewerModel(qwenWorker, "t2", "review", warmDeps);
		// Depth wins: the 60-pt reviewer-fit gap exceeds the 10-pt warmth margin, so warmth can't promote the shallow model.
		// (Under the old flat score:50, the margin was inert and the warm shallow model would have been picked.)
		expect(pick?.modelId).toBe("phi-rt");
	});

	it("labels auto-picked escalation workers as escalation workers, not reviewers", async () => {
		mocks.fetchLoadedModelDescriptors.mockResolvedValueOnce([
			{ runtimeId: "worker-m", modelKey: "qwen/qwen3-8b", isEmbedding: false },
			{ runtimeId: "devstral-rt", modelKey: "mistralai/devstral-small-2-2512", isEmbedding: false },
		]);

		const pick = await pickDiverseReviewerModel(workerLaunch, "t3", "worker", deps);

		expect(pick?.modelId).toBe("devstral-rt");
		expect(mocks.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining("Auto-picked lineage-diverse escalation worker devstral-rt"),
				metadata: expect.objectContaining({ category: "escalation_worker_auto_diverse" }),
			}),
		);
	});
});

describe("pickDiverseReviewerModel — capability ranks the candidates (P0.REVRANK)", () => {
	const descriptors = [
		{ runtimeId: "ornith-local-9b", modelKey: "ornith/ornith-1.0-9b", isEmbedding: false },
		{ runtimeId: "dirk-27b", modelKey: "publisher/dirk-27b", isEmbedding: false },
	];

	it("the live regression: the STRONGER model wins even when the weaker one has the better class fit", async () => {
		mocks.fetchLoadedModelDescriptors.mockResolvedValueOnce(descriptors);
		const pick = await pickDiverseReviewerModel(workerLaunch, "t-rank", "review", {
			lastShellKeyByModel: new Map(),
			loadCapabilityEvidence: evidenceLoader({ "ornith-local-9b": 55, "dirk-27b": 78 }),
		});
		expect(pick?.modelId).toBe("dirk-27b");
		expect(mocks.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: expect.objectContaining({
					category: "reviewer_capability_ranking",
					role: "reviewer",
					evidenceEnabled: true,
					rankable: 2,
					unrankable: 0,
					ranked: expect.arrayContaining([
						expect.objectContaining({ modelKey: "dirk-27b", score: 78, scoreBasis: "capability" }),
					]),
				}),
			}),
		);
	});

	it("without evidence the class-fit order stands (the kill switch is byte-compatible)", async () => {
		mocks.fetchLoadedModelDescriptors.mockResolvedValueOnce(descriptors);
		const pick = await pickDiverseReviewerModel(workerLaunch, "t-killswitch", "review", {
			lastShellKeyByModel: new Map(),
			loadCapabilityEvidence: noEvidence,
		});
		// Both are uncatalogued ⇒ equal class fit ⇒ the stable tie-break, not a made-up capability.
		// The tie is on the publisher-qualified modelKey ("ornith/ornith-1.0-9b" < "publisher/dirk-27b"), NOT on the
		// runtime id — which is what the base branch ties on too (`nklein-reviewer-candidate-selection.ts`), so the
		// kill switch really does restore the old order here.
		expect(pick?.modelId).toBe("ornith-local-9b");
		expect(mocks.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining("class fit only — capability evidence disabled"),
				metadata: expect.objectContaining({ rankable: 0, unrankable: 2 }),
			}),
		);
	});

	it("never promotes an UNRANKABLE model over one with evidence, however good its class fit", async () => {
		mocks.fetchLoadedModelDescriptors.mockResolvedValueOnce([
			{ runtimeId: "phi-rt", modelKey: "phi-4-reasoning-plus", isEmbedding: false }, // reasoning ⇒ top class fit
			{ runtimeId: "measured-rt", modelKey: "publisher/measured", isEmbedding: false },
		]);
		const pick = await pickDiverseReviewerModel(workerLaunch, "t-unrankable", "review", {
			lastShellKeyByModel: new Map(),
			loadCapabilityEvidence: evidenceLoader({ "measured-rt": 21 }), // weak, but MEASURED
		});
		expect(pick?.modelId).toBe("measured-rt");
	});

	it("stamps the pick's capability + basis on the pick observation", async () => {
		mocks.fetchLoadedModelDescriptors.mockResolvedValueOnce([
			{ runtimeId: "devstral-rt", modelKey: "mistralai/devstral-small-2-2512", isEmbedding: false },
		]);
		await pickDiverseReviewerModel(
			{ providerId: "lmstudio", modelId: "qwen-worker", baseUrl: "http://127.0.0.1:1234/v1" } as never,
			"t-meta",
			"review",
			{
				lastShellKeyByModel: new Map(),
				loadCapabilityEvidence: evidenceLoader({ "devstral-rt": { score: 64, basis: "prior", samples: 0 } }),
			},
		);
		expect(mocks.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: expect.objectContaining({
					reviewer: "devstral-rt",
					reviewerCapability: 64,
					reviewerCapabilityBasis: "prior",
					reviewerCapabilitySamples: 0,
				}),
			}),
		);
	});
});

describe("pickDiverseReviewerModel — an escalation must be PROVEN stronger (P0.REVRANK)", () => {
	const escalationDescriptors = [
		{ runtimeId: "worker-m", modelKey: "publisher/worker-27b", isEmbedding: false },
		{ runtimeId: "other-rt", modelKey: "publisher/other", isEmbedding: false },
	];
	const escalationDeps = (loadCapabilityEvidence: typeof noEvidence): ReviewerModelSelectionDeps => ({
		lastShellKeyByModel: new Map(),
		requireStrictlyStrongerThanWorker: true,
		loadCapabilityEvidence,
	});

	it("REFUSES the 9B takeover: a weaker model is not an escalation", async () => {
		mocks.fetchLoadedModelDescriptors.mockResolvedValueOnce(escalationDescriptors);
		const pick = await pickDiverseReviewerModel(
			workerLaunch,
			"t-esc",
			"worker",
			escalationDeps(evidenceLoader({ "worker-m": 78, "publisher/worker-27b": 78, "other-rt": 55 })),
		);
		expect(pick).toBeNull();
		expect(mocks.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				severity: "warning",
				message: expect.stringContaining("escalation refused"),
				metadata: expect.objectContaining({
					category: "escalation_not_stronger_refused",
					baselineCapability: 78,
					verdicts: [{ modelKey: "other-rt", verdict: "not_stronger" }],
				}),
			}),
		);
	});

	it("REFUSES when the worker's own capability is unknown — nothing beats an unknown baseline", async () => {
		mocks.fetchLoadedModelDescriptors.mockResolvedValueOnce(escalationDescriptors);
		const pick = await pickDiverseReviewerModel(
			workerLaunch,
			"t-esc-unknown-baseline",
			"worker",
			escalationDeps(evidenceLoader({ "other-rt": 95 })),
		);
		expect(pick).toBeNull();
		expect(mocks.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: expect.objectContaining({
					category: "escalation_not_stronger_refused",
					baselineCapability: null,
					verdicts: [{ modelKey: "other-rt", verdict: "baseline_unknown" }],
				}),
			}),
		);
	});

	it("REFUSES when the candidate has no evidence — an unknown is never assumed stronger", async () => {
		mocks.fetchLoadedModelDescriptors.mockResolvedValueOnce(escalationDescriptors);
		const pick = await pickDiverseReviewerModel(
			workerLaunch,
			"t-esc-unknown-candidate",
			"worker",
			escalationDeps(evidenceLoader({ "worker-m": 40, "publisher/worker-27b": 40 })),
		);
		expect(pick).toBeNull();
		expect(mocks.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: expect.objectContaining({
					category: "escalation_not_stronger_refused",
					verdicts: [{ modelKey: "other-rt", verdict: "no_evidence" }],
				}),
			}),
		);
	});

	it("PROCEEDS when a candidate is strictly stronger on evidence", async () => {
		mocks.fetchLoadedModelDescriptors.mockResolvedValueOnce(escalationDescriptors);
		const pick = await pickDiverseReviewerModel(
			workerLaunch,
			"t-esc-ok",
			"worker",
			escalationDeps(evidenceLoader({ "worker-m": 55, "publisher/worker-27b": 55, "other-rt": 82 })),
		);
		expect(pick).toEqual({ providerId: "lmstudio", modelId: "other-rt" });
		expect(mocks.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining("strictly-stronger-than-worker gate: 1 qualified"),
				metadata: expect.objectContaining({ category: "reviewer_capability_ranking", role: "worker" }),
			}),
		);
	});

	it("a plain (non-escalation) reviewer pick is NOT gated by the strictly-stronger rule", async () => {
		mocks.fetchLoadedModelDescriptors.mockResolvedValueOnce(escalationDescriptors);
		const pick = await pickDiverseReviewerModel(workerLaunch, "t-review-ungated", "review", {
			lastShellKeyByModel: new Map(),
			loadCapabilityEvidence: evidenceLoader({ "worker-m": 78, "publisher/worker-27b": 78, "other-rt": 55 }),
		});
		expect(pick?.modelId).toBe("other-rt");
	});
});
