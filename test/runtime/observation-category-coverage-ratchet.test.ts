import { globSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	auditObservationCoverage,
	KNOWN_UNREGISTERED_EMITTERS,
	MECHANISM_REGISTRY,
	OPERATIONAL_OBSERVATION_CATEGORIES,
} from "../../src/core/mechanism-observation-audit";

/**
 * Every observation category EMITTED IN THE SOURCE is registered or declared operational.
 *
 * ── WHY SOURCE AND NOT TELEMETRY ──
 * The live measurement that started this read a developer's `~/.nklein` telemetry. A test cannot: on a fresh
 * checkout there is no telemetry, so it would pass by having nothing to check — the vacuous green this whole
 * exercise has been about. Scanning the SOURCE is environment-independent and catches the actual failure mode:
 * a new `recordSelfObservation` landing with a category nobody registered.
 *
 * ── THE GAP THIS LOCKS SHUT ──
 * Measured 2026-08-01: 39 categories were being recorded and **34 were unregistered**, while 31 registry entries
 * had never fired. `auditMechanismObservations` walks the REGISTRY, a direction that can never find an omission.
 * All 20 firing-but-unregistered mechanisms are now registered (`dev mechanism-registry`: 5-of-45 → 25-of-65,
 * uncovered 0), and this keeps it that way.
 */

/**
 * Categories emitted by an actual `recordSelfObservation(...)` call.
 *
 * ── ⚠️ A BARE `category:` SCAN OVER-MATCHES, AND THE FIRST VERSION DID ──
 * It reported **142 categories with 69 uncovered**, against 39 actually recorded. The extras were `category:`
 * fields on unrelated types — a lint finding's category, a review finding's category — surfacing names like
 * `compile_error`, `lint_error` and `correctness` that are not observation categories at all. A ratchet that
 * demands 69 registrations, most of them fictional, is one someone disables.
 *
 * So the scan walks `recordSelfObservation(` call sites and reads the category out of the call, which is the
 * thing the registry is actually about. Third narrowing of a source scan today, after prose matching
 * `from"`-shaped text and a message string containing `isTruthyEnv(process.env.X)`: **in this codebase a source
 * scan needs positive identification of its target, never a bare field name.**
 */
function categoriesInSource(): string[] {
	const found = new Set<string>();
	for (const file of globSync("src/**/*.{ts,tsx}")) {
		if (file.endsWith("mechanism-observation-audit.ts")) {
			// The declaring file lists every category as a string literal; including it would match the registry
			// against itself and pass unconditionally — the circularity that made the flag-gate audit vacuous.
			continue;
		}
		const text = readFileSync(file, "utf8");
		for (const [index] of [...text.matchAll(/recordSelfObservation\s*\(/gu)].map((m) => [m.index ?? 0])) {
			// One call's worth of text. Generous enough to reach a `metadata` block below the message, tight
			// enough not to swallow the next unrelated object literal.
			const call = text.slice(index, index + 1200);
			const category = /\bcategory:\s*"([a-z][a-z0-9_]*)"/u.exec(call);
			if (category) {
				found.add(category[1] as string);
			}
		}
	}
	return [...found].sort();
}

describe("observation category coverage ratchet", () => {
	it("finds categories in the source at all", () => {
		// A broken extractor yields an empty list and every assertion below passes by vacuity.
		expect(categoriesInSource().length).toBeGreaterThan(20);
	});

	it("excludes the DECLARING file, or the check matches itself", () => {
		const source = readFileSync("src/core/mechanism-observation-audit.ts", "utf8");
		expect(source).toContain("MECHANISM_REGISTRY");
		expect(categoriesInSource()).not.toContain("__never_emitted_sentinel__");
	});

	it("lets NO NEW emitter land unregistered", () => {
		// The baseline freezes today's 45-category debt; anything beyond it is new drift and fails here. That is
		// the ratchet: the door is shut going forward even while the backlog is worked off.
		const baseline = new Set(KNOWN_UNREGISTERED_EMITTERS);
		const report = auditObservationCoverage(categoriesInSource());
		const drift = report.uncovered.filter((category) => !baseline.has(category));
		expect(
			drift,
			`these categories are newly emitted by src/ and neither registered nor declared operational, so no audit can judge whether they fire:\n  ${drift.join("\n  ")}`,
		).toEqual([]);
	});

	it("keeps the debt list HONEST — every entry is still uncovered and still emitted", () => {
		// A baseline that outlives its entries silently exempts categories that were since registered, and would
		// let a genuine regression hide behind a stale name.
		const emitted = new Set(categoriesInSource());
		const uncovered = new Set(auditObservationCoverage(categoriesInSource()).uncovered);
		for (const category of KNOWN_UNREGISTERED_EMITTERS) {
			expect(emitted.has(category), `${category} is on the debt list but no longer emitted — remove it`).toBe(true);
			expect(uncovered.has(category), `${category} is on the debt list but is now covered — remove it`).toBe(true);
		}
	});

	it("keeps the operational list disjoint from the registry", () => {
		const registered = new Set(MECHANISM_REGISTRY.map((entry) => entry.category));
		for (const category of OPERATIONAL_OBSERVATION_CATEGORIES) {
			expect(registered.has(category), `${category} is both registered and declared operational`).toBe(false);
		}
	});
});
