import { describe, expect, it } from "vitest";
import { gpuUsableBytes, recommendWiredLimit } from "../../src/core/apple-silicon-vram";
import { selectDeviceForModelLoad } from "../../src/core/device-load-routing";

const GB = 1024 * 1024 * 1024;

describe("gpuUsableBytes", () => {
	it("applies the ~75% default cap on Apple Silicon", () => {
		const result = gpuUsableBytes({ totalRamBytes: 64 * GB, appleSilicon: true });
		expect(result.usableBytes).toBe(Math.floor(64 * GB * 0.75));
		expect(result.raised).toBe(false);
		expect(result.unreachableBytes).toBeGreaterThan(15 * GB);
	});

	it("does NOT invent a cap on non-Apple-Silicon devices", () => {
		const result = gpuUsableBytes({ totalRamBytes: 64 * GB, appleSilicon: false });
		expect(result.usableBytes).toBe(64 * GB);
		expect(result.unreachableBytes).toBe(0);
	});

	it("honours a raised wired limit", () => {
		const result = gpuUsableBytes({
			totalRamBytes: 64 * GB,
			wiredLimitMb: 56 * 1024,
			appleSilicon: true,
		});
		expect(result.usableBytes).toBe(56 * GB);
		expect(result.raised).toBe(true);
		expect(result.reason).toContain("reclaimed");
	});

	it("treats a 0 wired limit as macOS's use-the-default sentinel, not a zero ceiling", () => {
		const result = gpuUsableBytes({ totalRamBytes: 64 * GB, wiredLimitMb: 0, appleSilicon: true });
		expect(result.usableBytes).toBe(Math.floor(64 * GB * 0.75));
		expect(result.raised).toBe(false);
	});

	it("clamps a limit set above physical memory rather than reporting fantasy headroom", () => {
		const result = gpuUsableBytes({
			totalRamBytes: 32 * GB,
			wiredLimitMb: 128 * 1024,
			appleSilicon: true,
		});
		expect(result.usableBytes).toBe(32 * GB);
	});

	it("says so when an explicit limit sits BELOW the default cap and is costing headroom", () => {
		const result = gpuUsableBytes({
			totalRamBytes: 64 * GB,
			wiredLimitMb: 32 * 1024,
			appleSilicon: true,
		});
		expect(result.raised).toBe(false);
		expect(result.reason).toContain("costing headroom");
	});
});

describe("recommendWiredLimit", () => {
	it("recommends a raise on a large Mac, leaving the OS its 16 GB reserve", () => {
		const recommendation = recommendWiredLimit({ totalRamBytes: 128 * GB, appleSilicon: true });
		expect(recommendation.recommendedMb).toBe(Math.floor(((128 - 16) * GB) / (1024 * 1024)));
		expect(recommendation.reclaimedBytes).toBeGreaterThan(0);
		expect(recommendation.command).toBe(`sudo sysctl iogpu.wired_limit_mb=${recommendation.recommendedMb}`);
	});

	it("ABSTAINS on a 16 GB Mac, where the raise would lower the ceiling", () => {
		// 16 GB - 8 GB OS reserve = 8 GB, below the 12 GB default cap. Recommending it would be harmful.
		const recommendation = recommendWiredLimit({ totalRamBytes: 16 * GB, appleSilicon: true });
		expect(recommendation.recommendedMb).toBeNull();
		expect(recommendation.command).toBeNull();
		expect(recommendation.reason).toContain("LOWER the ceiling");
	});

	it("abstains entirely off Apple Silicon", () => {
		const recommendation = recommendWiredLimit({ totalRamBytes: 128 * GB, appleSilicon: false });
		expect(recommendation.recommendedMb).toBeNull();
		expect(recommendation.command).toBeNull();
	});

	it("does not re-recommend a limit that is already raised past the target", () => {
		const recommendation = recommendWiredLimit({
			totalRamBytes: 128 * GB,
			wiredLimitMb: 120 * 1024,
			appleSilicon: true,
		});
		expect(recommendation.recommendedMb).toBeNull();
	});

	it("never emits a command that !Klein would run itself — it is advisory text for a human", () => {
		const recommendation = recommendWiredLimit({ totalRamBytes: 128 * GB, appleSilicon: true });
		expect(recommendation.reason).toContain("does not change system settings");
	});

	it("is total on junk input", () => {
		expect(() => recommendWiredLimit({ totalRamBytes: Number.NaN, appleSilicon: true })).not.toThrow();
	});
});

describe("F12.75 wire — device-load routing honours the GPU-wireable ceiling", () => {
	const model48Gb = 48 * GB;

	it("routes AWAY from a Mac whose physical RAM fits but whose GPU ceiling does not", () => {
		const withoutCeiling = selectDeviceForModelLoad({
			candidateSizeBytes: model48Gb,
			candidates: [{ deviceName: "m4mini", totalRamBytes: 128 * GB, residentSizeBytes: 0 }],
			reserveFraction: 0,
		});
		const withCeiling = selectDeviceForModelLoad({
			candidateSizeBytes: model48Gb,
			candidates: [
				{
					deviceName: "m4mini",
					totalRamBytes: 128 * GB,
					residentSizeBytes: 40 * GB,
					gpuUsableBytes: gpuUsableBytes({ totalRamBytes: 128 * GB, appleSilicon: true }).usableBytes,
				},
			],
			reserveFraction: 0,
		});
		expect(withoutCeiling.fits).toBe(true);
		// 96 GB wireable - 40 GB resident = 56 GB free, so 48 GB still fits; the point is the denominator changed.
		expect(withCeiling.fits).toBe(true);

		// Push resident usage past the GPU ceiling but not past physical RAM: only the ceiling-aware call refuses.
		const overCeiling = selectDeviceForModelLoad({
			candidateSizeBytes: model48Gb,
			candidates: [
				{
					deviceName: "m4mini",
					totalRamBytes: 128 * GB,
					residentSizeBytes: 60 * GB,
					gpuUsableBytes: gpuUsableBytes({ totalRamBytes: 128 * GB, appleSilicon: true }).usableBytes,
				},
			],
			reserveFraction: 0,
		});
		const overCeilingIgnored = selectDeviceForModelLoad({
			candidateSizeBytes: model48Gb,
			candidates: [{ deviceName: "m4mini", totalRamBytes: 128 * GB, residentSizeBytes: 60 * GB }],
			reserveFraction: 0,
		});
		expect(overCeilingIgnored.fits).toBe(true);
		expect(overCeiling.fits).toBe(false);
	});

	it("is byte-identical when the ceiling is absent — remote devices we cannot probe are unaffected", () => {
		// Omitting the field must equal setting it to the full total, which is what the old code effectively did.
		const omitted = selectDeviceForModelLoad({
			candidateSizeBytes: 16 * GB,
			candidates: [{ deviceName: "remote", totalRamBytes: 64 * GB, residentSizeBytes: 8 * GB }],
		});
		const explicitFullTotal = selectDeviceForModelLoad({
			candidateSizeBytes: 16 * GB,
			candidates: [
				{ deviceName: "remote", totalRamBytes: 64 * GB, residentSizeBytes: 8 * GB, gpuUsableBytes: 64 * GB },
			],
		});
		expect(omitted.fits).toBe(true);
		expect(omitted).toEqual(explicitFullTotal);
	});

	it("does NOT stack the ceiling with the reserve fraction", () => {
		// 128 GB Mac, 96 GB wireable, 0.25 reserve => 72 GB spendable. Stacking would give ~54 GB and wrongly refuse.
		const decision = selectDeviceForModelLoad({
			candidateSizeBytes: 70 * GB,
			candidates: [
				{
					deviceName: "mac",
					totalRamBytes: 128 * GB,
					residentSizeBytes: 0,
					gpuUsableBytes: 96 * GB,
				},
			],
			reserveFraction: 0.25,
		});
		expect(decision.fits).toBe(true);
	});
});
