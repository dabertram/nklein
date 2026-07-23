import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
	detectNightlyCostRegressions,
	type NightlyModelIoCost,
	parseNightlyModelIoCost,
	summarizeNightlyModelIo,
} from "../../src/core/nightly-cell-cost";

const cost = (override: Partial<NightlyModelIoCost> = {}): NightlyModelIoCost => ({
	modelRequests: 10,
	requestBytes: 100_000,
	responseBytes: 20_000,
	totalBytes: 120_000,
	...override,
});

describe("nightly cell cost", () => {
	it("counts exact model request and matched response bytes while excluding non-chat journal traffic", () => {
		const body = { model: "sim", messages: [{ role: "user", content: "héllo" }] };
		const response = { content: "done" };
		expect(
			summarizeNightlyModelIo([
				{ body, response: { fixture: { response } } },
				{ body: null, response: { fixture: null }, service: "lmstudio" },
			]),
		).toEqual({
			modelRequests: 1,
			requestBytes: Buffer.byteLength(JSON.stringify(body)),
			responseBytes: Buffer.byteLength(JSON.stringify(response)),
			totalBytes: Buffer.byteLength(JSON.stringify(body)) + Buffer.byteLength(JSON.stringify(response)),
		});
	});

	it("keeps an unmatched model request visible with zero matched-response bytes", () => {
		const body = { messages: [] };
		expect(summarizeNightlyModelIo([{ body, response: { fixture: null } }])).toEqual({
			modelRequests: 1,
			requestBytes: Buffer.byteLength(JSON.stringify(body)),
			responseBytes: 0,
			totalBytes: Buffer.byteLength(JSON.stringify(body)),
		});
	});

	it("validates a transported cost receipt and its additive total", () => {
		expect(parseNightlyModelIoCost(JSON.stringify(cost()))).toEqual(cost());
		expect(() => parseNightlyModelIoCost(JSON.stringify(cost({ totalBytes: 119_999 })))).toThrow(
			/totalBytes mismatch/,
		);
		expect(() => parseNightlyModelIoCost(JSON.stringify(cost({ modelRequests: -1 })))).toThrow(/non-negative/);
		expect(() =>
			parseNightlyModelIoCost(
				JSON.stringify({ modelRequests: 0, requestBytes: 0, responseBytes: 0, totalBytes: 0 }),
			),
		).toThrow(/zero is not evidence/);
	});

	it("reports only material request or byte growth and ignores first observations", () => {
		const regressions = detectNightlyCostRegressions([
			{ cellId: "new", baseline: null, current: cost({ totalBytes: 9_000_000 }) },
			{ cellId: "noise", baseline: cost(), current: cost({ modelRequests: 12, totalBytes: 179_999 }) },
			{
				cellId: "grown",
				baseline: cost(),
				current: cost({ modelRequests: 16, requestBytes: 280_000, responseBytes: 20_000, totalBytes: 300_000 }),
			},
		]);
		expect(regressions.map((entry) => entry.metric)).toEqual(["model_requests", "model_io_bytes"]);
		expect(regressions.every((entry) => entry.cellId === "grown")).toBe(true);
	});
});
