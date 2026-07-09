import { describe, expect, it } from "vitest";
import {
	evaluateFleetReviewerObservation,
	extractFleetReviewSessionModelObservation,
	hasModelUsage,
	isAutoReviewerSetting,
	isPromptReviewSessionId,
} from "../../../src/core/fleet-review-observation";

describe("fleet reviewer observation", () => {
	it("treats auto and none as unpinned reviewer settings", () => {
		expect(isAutoReviewerSetting("auto")).toBe(true);
		expect(isAutoReviewerSetting("none")).toBe(true);
		expect(isAutoReviewerSetting("  ")).toBe(true);
		expect(isAutoReviewerSetting("qwen/qwen3-8b")).toBe(false);
	});

	it("detects persisted synthetic review sessions", () => {
		expect(isPromptReviewSessionId("habit-insights-classify-trends__review-123")).toBe(true);
		expect(isPromptReviewSessionId("task-1::review")).toBe(true);
		expect(isPromptReviewSessionId("task-1::merge")).toBe(false);
		expect(isPromptReviewSessionId("task-review-not-synthetic")).toBe(false);
	});

	it("keeps the existing exact-or-contained model usage semantics", () => {
		expect(hasModelUsage(new Set(["qwen/qwen3-8b"]), "qwen/qwen3-8b")).toBe(true);
		expect(hasModelUsage(new Set(["lmstudio:qwen/qwen3-8b"]), "qwen/qwen3-8b")).toBe(true);
		expect(hasModelUsage(new Set(["mistralai/devstral-small-2-2512"]), "qwen/qwen3-8b")).toBe(false);
	});

	it("requires a configured pinned reviewer to be observed", () => {
		expect(
			evaluateFleetReviewerObservation({
				configuredReviewer: "qwen/qwen3-8b",
				reviewSessionModels: new Set(["qwen/qwen3-8b"]),
				workerModel: "mistralai/devstral-small-2-2512",
			}),
		).toMatchObject({ mode: "pinned", observed: true, observedModels: ["qwen/qwen3-8b"] });

		expect(
			evaluateFleetReviewerObservation({
				configuredReviewer: "qwen/qwen3-8b",
				reviewSessionModels: new Set(),
				workerModel: "mistralai/devstral-small-2-2512",
			}),
		).toMatchObject({ mode: "pinned", observed: false });
	});

	it("requires auto reviewer mode to produce a durable non-worker review session", () => {
		expect(
			evaluateFleetReviewerObservation({
				configuredReviewer: "auto",
				reviewSessionModels: new Set(["qwen/qwen3.6-35b-a3b"]),
				workerModel: "mistralai/devstral-small-2-2512",
			}),
		).toMatchObject({
			mode: "auto",
			observed: true,
			observedModels: ["qwen/qwen3.6-35b-a3b"],
		});

		expect(
			evaluateFleetReviewerObservation({
				configuredReviewer: "none",
				reviewSessionModels: new Set(),
				workerModel: "mistralai/devstral-small-2-2512",
			}),
		).toMatchObject({ mode: "auto", observed: false, observedModels: [] });

		expect(
			evaluateFleetReviewerObservation({
				configuredReviewer: "",
				reviewSessionModels: new Set(["mistralai/devstral-small-2-2512"]),
				workerModel: "mistralai/devstral-small-2-2512",
			}),
		).toMatchObject({
			mode: "auto",
			observed: false,
			observedModels: ["mistralai/devstral-small-2-2512"],
		});
	});

	it("extracts settled review-session model observations from self-observation telemetry", () => {
		expect(
			extractFleetReviewSessionModelObservation({
				schemaVersion: 1,
				signal: "custom",
				severity: "warning",
				message: "Second-opinion review session no_verdict for t1 on lmstudio/qwen.",
				taskId: "t1::review",
				modelId: "qwen/qwen3.6-35b-a3b",
				createdAt: 1,
				metadata: {
					category: "second_opinion_review_session",
					outcome: "no_verdict",
					syntheticTaskId: "t1::review",
				},
			}),
		).toEqual({
			taskId: "t1::review",
			modelId: "qwen/qwen3.6-35b-a3b",
			outcome: "no_verdict",
		});

		expect(
			extractFleetReviewSessionModelObservation({
				taskId: "t1::review",
				modelId: "qwen/qwen3.6-35b-a3b",
				metadata: { category: "second_opinion_review_session", outcome: "timeout" },
			}),
		).toBeNull();
		expect(
			extractFleetReviewSessionModelObservation({
				taskId: "t1::spec",
				modelId: "qwen/qwen3.6-35b-a3b",
				metadata: { category: "second_opinion_review_session", outcome: "verdict" },
			}),
		).toBeNull();
	});
});
