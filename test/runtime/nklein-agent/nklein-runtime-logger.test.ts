import { describe, expect, it } from "vitest";
import { logLevelPasses, logSeverityFor, normalizeLogLevel } from "../../../src/nklein-agent/nklein-runtime-logger";

describe("normalizeLogLevel", () => {
	it("accepts the four valid levels (case-insensitive, trimmed)", () => {
		expect(normalizeLogLevel("debug")).toBe("debug");
		expect(normalizeLogLevel("  WARN ")).toBe("warn");
		expect(normalizeLogLevel("Error")).toBe("error");
	});

	it("falls back to info for anything unrecognized or absent", () => {
		expect(normalizeLogLevel(undefined)).toBe("info");
		expect(normalizeLogLevel("")).toBe("info");
		expect(normalizeLogLevel("verbose")).toBe("info");
	});
});

describe("logLevelPasses", () => {
	it("passes a message at or above the threshold, suppresses below it", () => {
		// min = warn ⇒ debug/info suppressed, warn/error pass.
		expect(logLevelPasses("debug", "warn")).toBe(false);
		expect(logLevelPasses("info", "warn")).toBe(false);
		expect(logLevelPasses("warn", "warn")).toBe(true);
		expect(logLevelPasses("error", "warn")).toBe(true);
	});

	it("passes everything at the debug threshold", () => {
		for (const level of ["debug", "info", "warn", "error"] as const) {
			expect(logLevelPasses(level, "debug")).toBe(true);
		}
	});
});

describe("logSeverityFor", () => {
	it("maps a warn severity to warn, everything else to info", () => {
		expect(logSeverityFor({ severity: "warn" })).toBe("warn");
		expect(logSeverityFor({ severity: "info" })).toBe("info");
		expect(logSeverityFor({ other: 1 })).toBe("info");
		expect(logSeverityFor(undefined)).toBe("info");
	});
});
