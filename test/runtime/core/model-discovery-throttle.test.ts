import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { modelDiscoveryCacheTtlMs } from "../../../src/core/model-discovery-throttle";

// The throttle reads process.env; snapshot + restore the two knobs it consults so each case is isolated and the
// surrounding test-runner env (which sets VITEST) is left untouched afterwards.
const ENV_KEYS = ["NKLEIN_MODEL_DISCOVERY_CACHE_TTL_MS", "VITEST", "NODE_ENV"] as const;

describe("modelDiscoveryCacheTtlMs", () => {
	let saved: Record<string, string | undefined>;

	beforeEach(() => {
		saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
	});
	afterEach(() => {
		for (const key of ENV_KEYS) {
			if (saved[key] === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = saved[key];
			}
		}
	});

	it("honors a finite non-negative env override, even under the test runner", () => {
		process.env.NKLEIN_MODEL_DISCOVERY_CACHE_TTL_MS = "5000";
		expect(modelDiscoveryCacheTtlMs()).toBe(5000);
	});

	it("treats an explicit 0 override as caching-disabled", () => {
		process.env.NKLEIN_MODEL_DISCOVERY_CACHE_TTL_MS = "0";
		expect(modelDiscoveryCacheTtlMs()).toBe(0);
	});

	it("truncates a fractional override", () => {
		process.env.NKLEIN_MODEL_DISCOVERY_CACHE_TTL_MS = "1500.9";
		expect(modelDiscoveryCacheTtlMs()).toBe(1500);
	});

	it("disables caching under the test runner when there is no valid override", () => {
		delete process.env.NKLEIN_MODEL_DISCOVERY_CACHE_TTL_MS;
		process.env.VITEST = "true";
		expect(modelDiscoveryCacheTtlMs()).toBe(0);
	});

	it("falls back to the 30s default outside the test runner with no override", () => {
		delete process.env.NKLEIN_MODEL_DISCOVERY_CACHE_TTL_MS;
		delete process.env.VITEST;
		delete process.env.NODE_ENV;
		expect(modelDiscoveryCacheTtlMs()).toBe(30_000);
	});

	it("ignores a negative override and falls through (here: test-runner ⇒ 0)", () => {
		process.env.NKLEIN_MODEL_DISCOVERY_CACHE_TTL_MS = "-5";
		process.env.VITEST = "true";
		expect(modelDiscoveryCacheTtlMs()).toBe(0);
	});
});
