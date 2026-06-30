import { describe, expect, it } from "vitest";

import {
	normalizeOptionalString,
	normalizeRole,
	normalizeToolName,
} from "../../../src/telemetry/telemetry-normalizers";

describe("telemetry normalizeOptionalString", () => {
	it("trims to a non-empty string, else null", () => {
		expect(normalizeOptionalString("  hi  ")).toBe("hi");
		expect(normalizeOptionalString("")).toBeNull();
		expect(normalizeOptionalString("   ")).toBeNull();
		expect(normalizeOptionalString(null)).toBeNull();
		expect(normalizeOptionalString(undefined)).toBeNull();
	});
});

describe("telemetry normalizeRole", () => {
	it("accepts the three roles case-insensitively, else null", () => {
		expect(normalizeRole("architect")).toBe("architect");
		expect(normalizeRole("  Worker ")).toBe("worker");
		expect(normalizeRole("REVIEWER")).toBe("reviewer");
		expect(normalizeRole("orchestrator")).toBeNull();
		expect(normalizeRole(null)).toBeNull();
	});
});

describe("telemetry normalizeToolName", () => {
	it("lowercases and underscore-normalizes", () => {
		expect(normalizeToolName("Read_Files")).toBe("read_files");
		expect(normalizeToolName("  find-files!! ")).toBe("find_files");
		expect(normalizeToolName("a.b.c")).toBe("a_b_c");
		expect(normalizeToolName("__x__")).toBe("x");
	});
});
