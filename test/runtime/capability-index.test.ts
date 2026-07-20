import { describe, expect, it } from "vitest";
import { extractCapability, searchCapabilities } from "../../src/core/capability-index";

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
