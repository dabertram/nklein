import { describe, expect, it } from "vitest";
import { classifyModelBusy, isModelBusyInListing } from "../../../src/core/wedge-model-classifier";

/**
 * P0.BUSYWEDGE: a model prefilling a 35k prompt could not answer the 1-token liveness probe — that probe queued
 * behind the request it was probing — and the wedge sweep killed a turn that was working. `lms ps` knew it was
 * PROCESSING the whole time. Two sweeps ask this question and must answer it identically.
 */
describe("isModelBusyInListing", () => {
	it("reads processing and generating as busy, case-insensitively and anywhere in the status", () => {
		for (const status of ["PROCESSING", "generating", "Prompt processing (35k)", "busy: GENERATING"]) {
			expect(isModelBusyInListing([{ identifier: "m", status }], "m"), status).toBe(true);
		}
	});

	it("reads an idle, loaded or unknown status as NOT busy", () => {
		for (const status of ["idle", "loaded", "", null, undefined, 42]) {
			expect(isModelBusyInListing([{ identifier: "m", status }], "m"), String(status)).toBe(false);
		}
	});

	it("only answers about the model asked for", () => {
		const listing = [
			{ identifier: "other", status: "processing" },
			{ identifier: "m", status: "idle" },
		];
		expect(isModelBusyInListing(listing, "m")).toBe(false);
		expect(isModelBusyInListing(listing, "other")).toBe(true);
	});

	it("is busy when ANY instance of the identifier is working", () => {
		const listing = [
			{ identifier: "m", status: "idle" },
			{ identifier: "m", status: "generating" },
		];
		expect(isModelBusyInListing(listing, "m")).toBe(true);
	});

	it("is not busy on an empty listing or an empty id — absence of evidence is not evidence of life", () => {
		expect(isModelBusyInListing([], "m")).toBe(false);
		expect(isModelBusyInListing([{ identifier: "m", status: "processing" }], "")).toBe(false);
	});
});

describe("classifyModelBusy", () => {
	it("classifies from the probed listing", async () => {
		await expect(classifyModelBusy("m", async () => [{ identifier: "m", status: "processing" }])).resolves.toBe(true);
	});

	it("treats an unreachable probe as NOT busy, which is the safe direction", async () => {
		// "Busy" suppresses the wedge handling. Claiming it on no evidence would let a genuinely dead model hold a
		// card forever, and an unhandled wedge is worse than one slow turn interrupted.
		await expect(
			classifyModelBusy("m", async () => {
				throw new Error("lms unreachable");
			}),
		).resolves.toBe(false);
	});
});
