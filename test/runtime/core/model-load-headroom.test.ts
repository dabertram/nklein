import { describe, expect, it } from "vitest";
import { decideModelLoad, parseModelSizeBytes, sumResidentBytes } from "../../../src/core/model-load-headroom";

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
