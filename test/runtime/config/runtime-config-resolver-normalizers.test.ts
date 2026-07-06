import { describe, expect, it } from "vitest";
import {
	normalizeRetrievalEgressEnabled,
	normalizeRetrievalSearchBackendUrl,
} from "../../../src/config/runtime-config-retrieval-resolver";
import {
	normalizeSpeculativeBestOfNEnabled,
	normalizeSpeculativeMaxConcurrentSpecs,
	normalizeSpeculativeMaxSpecsPerRun,
} from "../../../src/config/runtime-config-speculative-resolver";
import { isSelfObservationSeverity } from "../../../src/telemetry/self-observation-sink";

describe("normalizeSpeculativeBestOfNEnabled (§5.V coverage)", () => {
	it("is default-ON: only an explicit false disables it", () => {
		expect(normalizeSpeculativeBestOfNEnabled(false)).toBe(false);
		expect(normalizeSpeculativeBestOfNEnabled(true)).toBe(true);
		expect(normalizeSpeculativeBestOfNEnabled(undefined)).toBe(true);
		expect(normalizeSpeculativeBestOfNEnabled(0)).toBe(true);
	});
});

describe("normalizeSpeculativeMaxConcurrentSpecs (§5.V coverage)", () => {
	it("keeps a valid integer, clamps to the cap (4), and defaults (1) on invalid", () => {
		expect(normalizeSpeculativeMaxConcurrentSpecs(2)).toBe(2);
		expect(normalizeSpeculativeMaxConcurrentSpecs(100)).toBe(4); // cap
		expect(normalizeSpeculativeMaxConcurrentSpecs(0)).toBe(1); // < 1 → default
		expect(normalizeSpeculativeMaxConcurrentSpecs(1.5)).toBe(1); // non-integer → default
		expect(normalizeSpeculativeMaxConcurrentSpecs("x")).toBe(1); // non-number → default
	});
});

describe("normalizeSpeculativeMaxSpecsPerRun (§5.V coverage)", () => {
	it("keeps a valid integer, clamps to the cap (20), and defaults (3) on invalid", () => {
		expect(normalizeSpeculativeMaxSpecsPerRun(5)).toBe(5);
		expect(normalizeSpeculativeMaxSpecsPerRun(100)).toBe(20); // cap
		expect(normalizeSpeculativeMaxSpecsPerRun(0)).toBe(3); // default
		expect(normalizeSpeculativeMaxSpecsPerRun("x")).toBe(3); // default
	});
});

describe("normalizeRetrievalEgressEnabled (§5.V coverage)", () => {
	it("is fail-closed: only a strict boolean true enables egress", () => {
		expect(normalizeRetrievalEgressEnabled(true)).toBe(true);
		expect(normalizeRetrievalEgressEnabled(false)).toBe(false);
		expect(normalizeRetrievalEgressEnabled("true")).toBe(false);
		expect(normalizeRetrievalEgressEnabled(1)).toBe(false);
		expect(normalizeRetrievalEgressEnabled(undefined)).toBe(false);
	});
});

describe("normalizeRetrievalSearchBackendUrl (§5.V coverage)", () => {
	const DEFAULT = normalizeRetrievalSearchBackendUrl(undefined);

	it("trims a real URL and falls back to the default for blank / non-string input", () => {
		expect(normalizeRetrievalSearchBackendUrl("  http://localhost:18888  ")).toBe("http://localhost:18888");
		expect(normalizeRetrievalSearchBackendUrl("")).toBe(DEFAULT);
		expect(normalizeRetrievalSearchBackendUrl("   ")).toBe(DEFAULT);
		expect(normalizeRetrievalSearchBackendUrl(123)).toBe(DEFAULT);
		expect(normalizeRetrievalSearchBackendUrl(null)).toBe(DEFAULT);
	});
});

describe("isSelfObservationSeverity (§5.V coverage)", () => {
	it("accepts the four severity literals and rejects anything else", () => {
		for (const sev of ["debug", "info", "warning", "error"]) {
			expect(isSelfObservationSeverity(sev)).toBe(true);
		}
		expect(isSelfObservationSeverity("critical")).toBe(false);
		expect(isSelfObservationSeverity(undefined)).toBe(false);
		expect(isSelfObservationSeverity(1)).toBe(false);
	});
});
