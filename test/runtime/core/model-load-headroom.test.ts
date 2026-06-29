import { describe, expect, it } from "vitest";
import type { LlmfitModel } from "../../../src/core/llmfit-adapter";
import {
	decideModelLoad,
	parseModelSizeBytes,
	refineLoadDecisionWithLlmfit,
	sumResidentBytes,
} from "../../../src/core/model-load-headroom";

const GiB = 1024 ** 3;

describe("parseModelSizeBytes", () => {
	it("parses human sizes (GB/MB, with or without a space)", () => {
		expect(parseModelSizeBytes("4.37 GB")).toBe(Math.round(4.37 * GiB));
		expect(parseModelSizeBytes("146.15 MB")).toBe(Math.round(146.15 * 1024 ** 2));
		expect(parseModelSizeBytes("2.18GB")).toBe(Math.round(2.18 * GiB));
	});
	it("returns null for junk", () => {
		expect(parseModelSizeBytes("n/a")).toBeNull();
		expect(parseModelSizeBytes("")).toBeNull();
	});
});

describe("sumResidentBytes", () => {
	it("sums parseable sizes and skips junk", () => {
		expect(sumResidentBytes(["1 GB", "2 GB", "n/a"])).toBe(3 * GiB);
	});
});

describe("decideModelLoad", () => {
	const totalRamBytes = 128 * GiB;

	it("allows a load that leaves ≥ the reserve free", () => {
		const d = decideModelLoad({ candidateSizeBytes: 6 * GiB, residentSizeBytes: 50 * GiB, totalRamBytes });
		expect(d.allow).toBe(true); // 56 resident → 72 free > 32 (25% of 128)
	});

	it("REFUSES a load that would breach the freeze-avoidance reserve", () => {
		// 100 resident + 20 candidate = 120 → 8 free < 32 reserve.
		const d = decideModelLoad({ candidateSizeBytes: 20 * GiB, residentSizeBytes: 100 * GiB, totalRamBytes });
		expect(d.allow).toBe(false);
		expect(d.reason).toMatch(/reserve|freeze/i);
	});

	it("honors an explicit maxResidentBytes budget", () => {
		const d = decideModelLoad({
			candidateSizeBytes: 6 * GiB,
			residentSizeBytes: 50 * GiB,
			totalRamBytes,
			maxResidentBytes: 52 * GiB, // 56 > 52 → refuse even though RAM reserve is fine
		});
		expect(d.allow).toBe(false);
		expect(d.reason).toMatch(/budget/i);
	});

	it("refuses when RAM or candidate size is unknown (can't prove headroom)", () => {
		expect(decideModelLoad({ candidateSizeBytes: 6 * GiB, residentSizeBytes: 0, totalRamBytes: 0 }).allow).toBe(
			false,
		);
		expect(decideModelLoad({ candidateSizeBytes: 0, residentSizeBytes: 0, totalRamBytes }).allow).toBe(false);
	});

	it("a custom reserveFraction tightens/loosens the gate", () => {
		// 60 resident + 10 candidate = 70 → 58 free. With a 50% reserve (64) → refuse; with 25% (32) → allow.
		const base = { candidateSizeBytes: 10 * GiB, residentSizeBytes: 60 * GiB, totalRamBytes };
		expect(decideModelLoad({ ...base, reserveFraction: 0.5 }).allow).toBe(false);
		expect(decideModelLoad({ ...base, reserveFraction: 0.25 }).allow).toBe(true);
	});
});

describe("refineLoadDecisionWithLlmfit", () => {
	const GiB2 = 1024 ** 3;
	const totalRam = 128 * GiB2;
	const allow = decideModelLoad({
		candidateSizeBytes: 6 * GiB2,
		residentSizeBytes: 10 * GiB2,
		totalRamBytes: totalRam,
	});
	const deny = decideModelLoad({
		candidateSizeBytes: 200 * GiB2,
		residentSizeBytes: 10 * GiB2,
		totalRamBytes: totalRam,
	});
	const model = (over: Partial<LlmfitModel>): LlmfitModel => ({
		name: "m",
		bestQuant: null,
		fitLevel: null,
		memoryRequiredGb: null,
		memoryAvailableGb: null,
		estimatedTps: null,
		isMoe: false,
		moeOffloadedGb: null,
		installed: false,
		contextLength: null,
		effectiveContextLength: null,
		capabilityIds: [],
		license: null,
		...over,
	});

	it("a RAM-headroom DENY is final — llmfit cannot override it", () => {
		expect(deny.allow).toBe(false);
		expect(refineLoadDecisionWithLlmfit(deny, model({ fitLevel: "Perfect" })).allow).toBe(false);
	});

	it("headroom-allow + llmfit Perfect/Good ⇒ allow, noting llmfit", () => {
		const r = refineLoadDecisionWithLlmfit(allow, model({ fitLevel: "Good", memoryRequiredGb: 5 }));
		expect(r.allow).toBe(true);
		expect(r.reason).toContain("llmfit: Good");
	});

	it("headroom-allow + llmfit Marginal/Too Tight ⇒ REFUSE (tighter estimate)", () => {
		expect(refineLoadDecisionWithLlmfit(allow, model({ fitLevel: "Too Tight" })).allow).toBe(false);
		expect(refineLoadDecisionWithLlmfit(allow, model({ fitLevel: "Marginal" })).allow).toBe(false);
	});

	it("no llmfit data ⇒ the headroom verdict stands", () => {
		expect(refineLoadDecisionWithLlmfit(allow, null)).toEqual(allow);
	});
});
