import { describe, expect, it } from "vitest";
import { MODEL_CAPABILITY_CATALOG } from "../../../src/core/model-capability-catalog-data";
import { parseModelCatalogOverlay } from "../../../src/core/model-catalog-overlay";

/**
 * Data-integrity guard for the SHIPPED model-capability catalog (§5.AB/§5.AL). The catalog is hand-edited data that
 * silently steers model routing — a bad enum value, a duplicate family, or an uppercase regex that can never match the
 * lowercased id would degrade selection with no compile error and no test failure elsewhere. These assertions catch
 * those edit mistakes. The keystone check reuses the SAME schema external overlays must pass (`parseModelCatalogOverlay`),
 * so the built-in data and user overlays are held to one contract.
 */
describe("MODEL_CAPABILITY_CATALOG data integrity", () => {
	it("is non-empty and every entry conforms to the external-overlay schema (one contract for built-in + user data)", () => {
		expect(MODEL_CAPABILITY_CATALOG.length).toBeGreaterThan(0);
		// The overlay schema takes `match` as a regex SOURCE string (compiled with `i` at load); the shipped entries
		// carry a compiled RegExp, so project each back to its source before validating the rest of the shape.
		const asOverlay = {
			models: MODEL_CAPABILITY_CATALOG.map((entry) => ({ ...entry, match: entry.match.source })),
		};
		const result = parseModelCatalogOverlay(asOverlay);
		// Zero skipped entries ⇒ every shipped row satisfies the same enum/shape/positive-sizeGb contract users must.
		expect(result.errors).toEqual([]);
		expect(result.entries).toHaveLength(MODEL_CAPABILITY_CATALOG.length);
	});

	it("has unique family slugs (a duplicate would make one row unreachable / ambiguous in telemetry)", () => {
		const families = MODEL_CAPABILITY_CATALOG.map((entry) => entry.family);
		expect(new Set(families).size).toBe(families.length);
	});

	it("uses lowercase-only regex sources (matched against the lowercased normalized id — uppercase can never hit)", () => {
		const offenders = MODEL_CAPABILITY_CATALOG.filter((entry) => /[A-Z]/.test(entry.match.source)).map(
			(entry) => entry.family,
		);
		expect(offenders).toEqual([]);
	});

	it("carries a non-empty note on every entry (the operator-facing 'why')", () => {
		const blank = MODEL_CAPABILITY_CATALOG.filter((entry) => entry.note.trim().length === 0).map(
			(entry) => entry.family,
		);
		expect(blank).toEqual([]);
	});

	it("cites at least one source for every VERIFIED research-based verdict (no unbacked confident claims)", () => {
		const unbacked = MODEL_CAPABILITY_CATALOG.filter(
			(entry) => entry.verified === true && entry.basis !== "empirical" && entry.sources.length === 0,
		).map((entry) => entry.family);
		expect(unbacked).toEqual([]);
	});

	it("keeps every optional sizeGb strictly positive (a memory-footprint packing input)", () => {
		const bad = MODEL_CAPABILITY_CATALOG.filter((entry) => entry.sizeGb !== undefined && !(entry.sizeGb > 0)).map(
			(entry) => entry.family,
		);
		expect(bad).toEqual([]);
	});
});
