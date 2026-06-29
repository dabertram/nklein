import { describe, expect, it } from "vitest";
import {
	normalizeAgentId,
	normalizeAgentTimeoutMode,
	normalizeAgentTimeoutProfile,
	normalizeBoolean,
	normalizeLostHeartbeatPolicy,
	normalizeMaxConcurrentTasks,
	normalizeMaxConcurrentTasksOverride,
	normalizeNonNegativeInteger,
	normalizePositiveInteger,
	normalizePositiveNumber,
	normalizeSelectedAgentIdOverride,
	normalizeTimeoutMsValue,
} from "../../../src/config/runtime-config-normalizers";

describe("normalizeBoolean", () => {
	it("returns the boolean as-is; otherwise the fallback", () => {
		expect(normalizeBoolean(true, false)).toBe(true);
		expect(normalizeBoolean(false, true)).toBe(false);
		for (const bad of ["true", 1, 0, null, undefined, {}]) {
			expect(normalizeBoolean(bad, true)).toBe(true);
			expect(normalizeBoolean(bad, false)).toBe(false);
		}
	});
});

describe("integer/number normalizers (explicit fallback)", () => {
	it("normalizePositiveInteger keeps a positive int (truncated), else fallback", () => {
		expect(normalizePositiveInteger(5, 9)).toBe(5);
		expect(normalizePositiveInteger(5.9, 9)).toBe(5);
		for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "5", null, undefined]) {
			expect(normalizePositiveInteger(bad, 9)).toBe(9);
		}
	});
	it("normalizeNonNegativeInteger allows 0 but not negatives", () => {
		expect(normalizeNonNegativeInteger(0, 7)).toBe(0);
		expect(normalizeNonNegativeInteger(3.9, 7)).toBe(3);
		expect(normalizeNonNegativeInteger(-1, 7)).toBe(7);
		expect(normalizeNonNegativeInteger(Number.NaN, 7)).toBe(7);
	});
	it("normalizePositiveNumber keeps a positive (non-truncated) number, else fallback", () => {
		expect(normalizePositiveNumber(2.5, 1)).toBe(2.5);
		expect(normalizePositiveNumber(0, 1)).toBe(1);
		expect(normalizePositiveNumber(-0.1, 1)).toBe(1);
		expect(normalizePositiveNumber("2", 1)).toBe(1);
	});
});

describe("concurrency normalizers", () => {
	it("normalizeMaxConcurrentTasks returns a positive default for invalid/non-positive input", () => {
		const def = normalizeMaxConcurrentTasks("nope");
		expect(def).toBeGreaterThan(0);
		expect(normalizeMaxConcurrentTasks(-1)).toBe(def);
		expect(normalizeMaxConcurrentTasks(Number.NaN)).toBe(def);
		expect(normalizeMaxConcurrentTasks(4)).toBe(4);
		expect(normalizeMaxConcurrentTasks(4.9)).toBe(4);
	});
	it("normalizeMaxConcurrentTasksOverride is null for absent/invalid/non-positive, else the truncated int", () => {
		for (const none of [null, undefined, "3", Number.NaN, 0, -2]) {
			expect(normalizeMaxConcurrentTasksOverride(none)).toBeNull();
		}
		expect(normalizeMaxConcurrentTasksOverride(6.7)).toBe(6);
	});
});

describe("timeout normalizers", () => {
	it("normalizeTimeoutMsValue: null→null, finite ≥0 →truncated, negatives/NaN/strings →null", () => {
		expect(normalizeTimeoutMsValue(null)).toBeNull();
		expect(normalizeTimeoutMsValue(0)).toBe(0);
		expect(normalizeTimeoutMsValue(1500.9)).toBe(1500);
		for (const bad of [-1, Number.NaN, "1000", undefined]) {
			expect(normalizeTimeoutMsValue(bad)).toBeNull();
		}
	});
	it("normalizeAgentTimeoutMode passes valid modes, maps legacy very_long→extended, else default", () => {
		for (const mode of ["normal", "long", "extended", "unlimited"] as const) {
			expect(normalizeAgentTimeoutMode(mode)).toBe(mode);
		}
		expect(normalizeAgentTimeoutMode("very_long")).toBe("extended");
		expect(normalizeAgentTimeoutMode("bogus")).toBe(normalizeAgentTimeoutMode(undefined));
	});
	it("normalizeAgentTimeoutProfile passes cloud/local/custom, else a stable default", () => {
		for (const profile of ["cloud", "local", "custom"] as const) {
			expect(normalizeAgentTimeoutProfile(profile)).toBe(profile);
		}
		expect(normalizeAgentTimeoutProfile("bogus")).toBe(normalizeAgentTimeoutProfile(null));
	});
});

describe("agent-id normalizers", () => {
	it("normalizeAgentId keeps nklein and maps unknown/absent to a stable default", () => {
		expect(normalizeAgentId("nklein")).toBe("nklein");
		const def = normalizeAgentId(null);
		expect(normalizeAgentId("bogus")).toBe(def);
		expect(normalizeAgentId(undefined)).toBe(def);
	});
	it("normalizeSelectedAgentIdOverride: null for absent/unknown/default-equal, else the known id", () => {
		expect(normalizeSelectedAgentIdOverride(null)).toBeNull();
		expect(normalizeSelectedAgentIdOverride(undefined)).toBeNull();
		expect(normalizeSelectedAgentIdOverride("bogus")).toBeNull();
		// nklein is the local-only default ⇒ stored as null (no-op override); a different known id is preserved.
		expect(normalizeSelectedAgentIdOverride("nklein")).toBeNull();
		expect(normalizeSelectedAgentIdOverride("codex")).toBe("codex");
	});
});

describe("normalizeLostHeartbeatPolicy", () => {
	it("returns keep_running only for that literal, else a stable default", () => {
		expect(normalizeLostHeartbeatPolicy("keep_running")).toBe("keep_running");
		expect(normalizeLostHeartbeatPolicy("bogus")).toBe(normalizeLostHeartbeatPolicy(undefined));
		expect(normalizeLostHeartbeatPolicy("bogus")).not.toBe("keep_running");
	});
});
