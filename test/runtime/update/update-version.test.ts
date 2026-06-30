import { describe, expect, it } from "vitest";

import { compareVersions, getNpmTag, isNightlyVersion } from "../../../src/update/update-version";

describe("isNightlyVersion", () => {
	it("detects -nightly. builds and nothing else", () => {
		expect(isNightlyVersion("1.2.3-nightly.5")).toBe(true);
		expect(isNightlyVersion("1.2.3")).toBe(false);
		expect(isNightlyVersion("1.2.3-rc.1")).toBe(false);
	});
});

describe("getNpmTag", () => {
	it("maps nightly builds to the nightly tag, everything else to latest", () => {
		expect(getNpmTag("1.2.3-nightly.5")).toBe("nightly");
		expect(getNpmTag("1.2.3")).toBe("latest");
		expect(getNpmTag("1.2.3-rc.1")).toBe("latest");
	});
});

describe("compareVersions", () => {
	it("returns 0 for equal versions", () => {
		expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
	});

	it("compares the numeric core left-to-right", () => {
		expect(compareVersions("1.2.4", "1.2.3")).toBe(1);
		expect(compareVersions("1.2.3", "1.3.0")).toBe(-1);
		expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
	});

	it("treats missing core components as zero (1.2 == 1.2.0)", () => {
		expect(compareVersions("1.2", "1.2.0")).toBe(0);
		expect(compareVersions("1.2.1", "1.2")).toBe(1);
	});

	it("ranks a release above an otherwise-equal prerelease", () => {
		expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBe(1);
		expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBe(-1);
	});

	it("compares numeric prerelease identifiers numerically", () => {
		expect(compareVersions("1.0.0-nightly.12", "1.0.0-nightly.2")).toBe(1);
	});

	it("ranks a numeric prerelease identifier below an alphanumeric one", () => {
		expect(compareVersions("1.0.0-1", "1.0.0-alpha")).toBe(-1);
		expect(compareVersions("1.0.0-alpha", "1.0.0-1")).toBe(1);
	});

	it("ranks a shorter prerelease prefix below a longer one", () => {
		expect(compareVersions("1.0.0-rc", "1.0.0-rc.1")).toBe(-1);
	});

	it("compares alphanumeric prerelease identifiers lexically", () => {
		expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBe(-1);
	});

	it("ignores build metadata", () => {
		expect(compareVersions("1.0.0+build.1", "1.0.0+build.2")).toBe(0);
	});
});
