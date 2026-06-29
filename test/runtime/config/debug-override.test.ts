import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isDebugOverrideEnvEnabled } from "../../../src/config/debug-override";

const ENV_KEYS = ["NKLEIN_DEBUG", "KANBAN_DEBUG", "KANBAN_DEBUG_MODE", "DEBUG_MODE", "debug_mode"] as const;

describe("isDebugOverrideEnvEnabled", () => {
	let saved: Record<string, string | undefined>;
	beforeEach(() => {
		saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
		for (const k of ENV_KEYS) delete process.env[k];
	});
	afterEach(() => {
		for (const k of ENV_KEYS) {
			if (saved[k] === undefined) delete process.env[k];
			else process.env[k] = saved[k];
		}
	});

	it("is false when no debug env var is set", () => {
		expect(isDebugOverrideEnvEnabled()).toBe(false);
	});

	it("treats 1/true/yes/on (any case, trimmed) as enabled", () => {
		for (const truthy of ["1", "true", "TRUE", " yes ", "On"]) {
			process.env.NKLEIN_DEBUG = truthy;
			expect(isDebugOverrideEnvEnabled()).toBe(true);
		}
	});

	it("treats other values as disabled", () => {
		for (const falsy of ["0", "false", "", "nope", "2"]) {
			process.env.NKLEIN_DEBUG = falsy;
			expect(isDebugOverrideEnvEnabled()).toBe(false);
		}
	});

	it("falls back through the legacy env vars in precedence order", () => {
		process.env.DEBUG_MODE = "true";
		expect(isDebugOverrideEnvEnabled()).toBe(true);
		// An earlier var in the chain set to a falsy-but-defined value wins (?? stops at the first defined value).
		process.env.NKLEIN_DEBUG = "0";
		expect(isDebugOverrideEnvEnabled()).toBe(false);
	});
});
