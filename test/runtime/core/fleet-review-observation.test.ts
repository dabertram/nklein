import { describe, expect, it } from "vitest";
import {
	evaluateFleetReviewerObservation,
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
				seenModels: new Set(["mistralai/devstral-small-2-2512", "qwen/qwen3-8b"]),
				persistedReviewModels: new Set(),
				workerModel: "mistralai/devstral-small-2-2512",
			}),
		).toMatchObject({ mode: "pinned", observed: true, observedModels: ["qwen/qwen3-8b"] });

		expect(
			evaluateFleetReviewerObservation({
				configuredReviewer: "qwen/qwen3-8b",
				seenModels: new Set(["mistralai/devstral-small-2-2512"]),
				persistedReviewModels: new Set(["qwen/qwen3-8b"]),
				workerModel: "mistralai/devstral-small-2-2512",
			}),
		).toMatchObject({ mode: "pinned", observed: false });
	});

	it("requires auto reviewer mode to produce a persisted non-worker review session", () => {
		expect(
			evaluateFleetReviewerObservation({
				configuredReviewer: "auto",
				seenModels: new Set(["mistralai/devstral-small-2-2512", "qwen/qwen3.6-35b-a3b"]),
				persistedReviewModels: new Set(["qwen/qwen3.6-35b-a3b"]),
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
				seenModels: new Set(["mistralai/devstral-small-2-2512", "qwen/qwen3.6-35b-a3b"]),
				persistedReviewModels: new Set(),
				workerModel: "mistralai/devstral-small-2-2512",
			}),
		).toMatchObject({ mode: "auto", observed: false, observedModels: [] });

		expect(
			evaluateFleetReviewerObservation({
				configuredReviewer: "",
				seenModels: new Set(["mistralai/devstral-small-2-2512"]),
				persistedReviewModels: new Set(["mistralai/devstral-small-2-2512"]),
				workerModel: "mistralai/devstral-small-2-2512",
			}),
		).toMatchObject({
			mode: "auto",
			observed: false,
			observedModels: ["mistralai/devstral-small-2-2512"],
		});
	});
});
