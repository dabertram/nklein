import { describe, expect, it } from "vitest";
import { extractCapability, searchCapabilities, searchCapabilitiesTiered } from "../../src/core/capability-index";

const SAMPLE = `/**
 * A/B significance gate (F12.41) — PURE decision core.
 *
 * Runs McNemar's exact test over paired outcomes.
 */
export function mcnemarTest() {}
export function decideDefaultFlip() {}
`;

describe("extractCapability", () => {
	it("takes the first substantive docblock sentence as the purpose", () => {
		const entry = extractCapability("ab-significance-gate.ts", SAMPLE);
		expect(entry.purpose).toContain("A/B significance gate");
	});

	it("captures backlog labels so a hit traces back to the deciding item", () => {
		expect(extractCapability("m.ts", SAMPLE).labels).toContain("F12.41");
	});

	it("lists exported functions", () => {
		expect(extractCapability("m.ts", SAMPLE).exports).toEqual(["mcnemarTest", "decideDefaultFlip"]);
	});

	it("reports a missing docblock honestly rather than inventing a purpose", () => {
		expect(extractCapability("m.ts", "export function x() {}").purpose).toBe("(no docblock)");
	});
});

describe("searchCapabilities", () => {
	const entries = [extractCapability("ab-significance-gate.ts", SAMPLE)];

	it("finds a core by a word in its purpose — the F12.28 duplication it would have prevented", () => {
		expect(searchCapabilities(entries, "significance")).toHaveLength(1);
	});

	it("finds a core by an exported symbol name", () => {
		expect(searchCapabilities(entries, "decideDefaultFlip")).toHaveLength(1);
	});

	it("is case-insensitive", () => {
		expect(searchCapabilities(entries, "SIGNIFICANCE")).toHaveLength(1);
	});

	it("returns nothing for an empty query rather than everything", () => {
		expect(searchCapabilities(entries, "  ")).toHaveLength(0);
	});
});

describe("tiered search (the miss that forced it, 2026-07-20)", () => {
	const MODULE = `/**
 * F12.27 tool-role QUANTIZATION FLOOR — PURE core.
 */
export function assessQuantizationFloor() {}

/**
 * Much further down: choose the backend and the speculative-decoding gate.
 */
export interface Levers { speculativeDecoding: boolean }
`;

	it("finds a capability documented BELOW the leading docblock, which purpose-only search misses", () => {
		// The real miss: searching "speculative decoding" returned nothing while inference-lever-planning.ts had
		// implemented exactly that gate ~300 lines down, exposed as an interface FIELD rather than an exported
		// function. The index reads the leading 40 lines and exported function names, so it was structurally blind —
		// and the tool built to PREVENT duplication came one step from causing it.
		const entry = extractCapability("levers.ts", MODULE);
		const tiered = searchCapabilitiesTiered([entry], "speculative");
		expect(tiered.byPurpose).toHaveLength(0);
		expect(tiered.byBody).toHaveLength(1);
	});

	it("keeps the tiers SEPARATE rather than merging them", () => {
		// Merging would flood high-confidence answers with incidental mentions and make the index annoying enough to
		// stop using; dropping the body tier keeps the blind spot. Two honestly-labelled tiers is the only version
		// that is both usable and not lying about coverage.
		const entry = extractCapability("levers.ts", MODULE);
		const tiered = searchCapabilitiesTiered([entry], "quantization");
		expect(tiered.byPurpose).toHaveLength(1);
		expect(tiered.byBody).toHaveLength(0);
	});

	it("is HYPHEN-SENSITIVE — a known literal-search limit, asserted not hidden", () => {
		// The fixture says "speculative-decoding"; searching "speculative decoding" does not match. This is the cost
		// of a deliberately dumb literal search, and it is worth knowing about: it means a NO-MATCH result is even
		// weaker evidence of absence than the CLI already says. Normalising punctuation would fix this case and
		// introduce a fuzzy matcher whose misses are harder to reason about, so the limit is recorded instead.
		const entry = extractCapability("levers.ts", MODULE);
		expect(searchCapabilitiesTiered([entry], "speculative decoding").byBody).toHaveLength(0);
		expect(searchCapabilitiesTiered([entry], "speculative-decoding").byBody).toHaveLength(1);
	});

	it("returns both tiers empty for a genuine absence", () => {
		const entry = extractCapability("levers.ts", MODULE);
		const tiered = searchCapabilitiesTiered([entry], "kubernetes");
		expect(tiered.byPurpose).toHaveLength(0);
		expect(tiered.byBody).toHaveLength(0);
	});
});
