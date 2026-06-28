import { describe, expect, it } from "vitest";
import { detectLmStudioLogAnomalies, summarizeLmStudioLogAnomalies } from "../../../src/core/lmstudio-log-anomalies";

describe("detectLmStudioLogAnomalies", () => {
	it("returns a clean report for ordinary traffic", () => {
		const result = detectLmStudioLogAnomalies([
			"[INFO] GET /api/v0/models 200 1ms",
			"[INFO] POST /v1/chat/completions 200 1200ms",
			"",
		]);
		expect(result).toEqual({
			catalogHits: 1,
			catalogHammering: false,
			errors: [],
			loadEvents: [],
			slowWarnings: [],
		});
		expect(summarizeLmStudioLogAnomalies(result)).toBe("");
	});

	it("flags catalog hammering above the threshold (the 2026-06-28 incident)", () => {
		const lines = Array.from({ length: 12 }, () => "[INFO] GET /api/v0/models 200 0ms");
		const result = detectLmStudioLogAnomalies(lines, { catalogHitThreshold: 10 });
		expect(result.catalogHits).toBe(12);
		expect(result.catalogHammering).toBe(true);
		expect(summarizeLmStudioLogAnomalies(result)).toContain("catalog hammering (12 hits");
	});

	it("does not flag catalog requests as errors (they're normally 200s)", () => {
		const result = detectLmStudioLogAnomalies(["[INFO] GET /api/v0/models 200 0ms"]);
		expect(result.errors).toEqual([]);
	});

	it("captures non-2xx responses and explicit error lines", () => {
		const result = detectLmStudioLogAnomalies([
			"[ERROR] POST /v1/chat/completions 500 Internal Server Error",
			"[WARN] request failed: ECONNRESET",
			"[INFO] POST /v1/chat/completions 200 ok",
		]);
		expect(result.errors).toHaveLength(2);
		expect(result.errors[0]).toContain("500");
		expect(result.errors[1]).toContain("ECONNRESET");
	});

	it("captures model load / out-of-resources / crash events (the 35B @8bit refusal + deepseek drop)", () => {
		const result = detectLmStudioLogAnomalies([
			"Loading model ornith-1.0-35b-mlx@8bit",
			"Error: insufficient system resources — this would overload your system and cause it to freeze",
			"Model unloaded: deepseek-r1",
			"deepseek-r1 disconnected unexpectedly",
		]);
		expect(result.loadEvents.length).toBeGreaterThanOrEqual(3);
		expect(result.loadEvents.join("\n")).toMatch(/insufficient system resources/);
		expect(summarizeLmStudioLogAnomalies(result)).toContain("load/unload events");
	});

	it("captures slow-prefill / low-throughput warnings", () => {
		const result = detectLmStudioLogAnomalies([
			"[WARN] slow prefill detected for this request",
			"[WARN] low throughput on the current model",
		]);
		expect(result.slowWarnings).toHaveLength(2);
	});

	it("summary caps each class to keep it to one readable line", () => {
		const result = detectLmStudioLogAnomalies(["failed once", "failed twice", "failed thrice", "failed quatro"]);
		const summary = summarizeLmStudioLogAnomalies(result, 2);
		expect(summary).toContain("errors ×4");
		expect(summary).toContain("(+2 more)");
	});
});
