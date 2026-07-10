import { describe, expect, it } from "vitest";

import { isEnabledByDefaultEnv, isTruthyEnv, resolveDefaultOnFlag } from "../../../src/core/env-flag";

describe("isTruthyEnv", () => {
	it("is false for undefined / empty", () => {
		expect(isTruthyEnv(undefined)).toBe(false);
		expect(isTruthyEnv("")).toBe(false);
	});

	it("accepts the canonical truthy tokens (case-insensitive, trimmed)", () => {
		for (const v of ["1", "true", "TRUE", "yes", "Yes", "on", "ON", "  true  ", " 1 "]) {
			expect(isTruthyEnv(v)).toBe(true);
		}
	});

	it("is false for anything else", () => {
		for (const v of ["0", "false", "no", "off", "2", "truthy", "enable", "y"]) {
			expect(isTruthyEnv(v)).toBe(false);
		}
	});
});

describe("isEnabledByDefaultEnv", () => {
	it("is ON when unset or empty (default-on)", () => {
		expect(isEnabledByDefaultEnv(undefined)).toBe(true);
		expect(isEnabledByDefaultEnv("")).toBe(true);
		expect(isEnabledByDefaultEnv("   ")).toBe(true);
	});

	it("is OFF only for explicit disable tokens (case-insensitive, trimmed)", () => {
		for (const v of ["0", "false", "FALSE", "no", "No", "off", "OFF", "  0  ", " false "]) {
			expect(isEnabledByDefaultEnv(v)).toBe(false);
		}
	});

	it("is ON for any other value (incl. the truthy tokens and junk)", () => {
		for (const v of ["1", "true", "yes", "on", "enabled", "whatever"]) {
			expect(isEnabledByDefaultEnv(v)).toBe(true);
		}
	});
});

describe("resolveDefaultOnFlag (§5.BB config||env for default-ON flags)", () => {
	it("defers to the config bit when the env var is unset or blank", () => {
		for (const env of [undefined, "", "   "]) {
			expect(resolveDefaultOnFlag(true, env)).toBe(true);
			expect(resolveDefaultOnFlag(false, env)).toBe(false);
		}
	});

	it("lets an explicit env disable win over a config-on (the script escape hatch keeps working)", () => {
		for (const env of ["0", "false", "no", "off", " OFF "]) {
			expect(resolveDefaultOnFlag(true, env)).toBe(false);
		}
	});

	it("lets an explicit env enable win over a config-off (the harness override keeps working)", () => {
		for (const env of ["1", "true", "yes", "on"]) {
			expect(resolveDefaultOnFlag(false, env)).toBe(true);
		}
	});
});
