import { globSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	auditFlagCoverage,
	defaultOnKillSwitches,
	FEATURE_FLAG_REGISTRY,
	safeObserveOnlyFlags,
} from "../../src/core/feature-flag-registry";

/**
 * The default-OFF flag registry, and the ratchet that keeps it complete.
 *
 * ── WHY THE COVERAGE TEST IS THE POINT ──
 * F4.8b's finding was not that a flag was mis-classified — it was that the mechanism registry is HAND-MAINTAINED,
 * so *"it can only report on mechanisms someone remembered to add"*. A default-OFF injection site stayed invisible
 * while every audit reported its requirement satisfied. A registry without a completeness ratchet reproduces that
 * failure exactly: it stays green while going stale, because what is missing cannot fail a check that only looks
 * at what is present.
 */

/**
 * Every BOOLEAN-SHAPED `NKLEIN_*` env flag present in the source.
 *
 * ── 🔴 THIS EXTRACTOR WAS WRONG ONCE, AND THE REGISTRY INHERITED THE ERROR ──
 * The first version matched only the `isTruthyEnv` idiom, so the ratchet passed green while **nine
 * behaviour-changing boolean flags were invisible to it** — including `NKLEIN_ALLOW_UNSUITABLE_MODEL`, which
 * disables a model-suitability guard, and `NKLEIN_FITNESS_ROUTING`, a default-ON kill switch for routing. The
 * registry claimed to cover "every default-OFF flag" and covered every flag read ONE WAY.
 *
 * That is precisely the limitation `env-gated-delivery.ts` states about its own checker — *"a flag read another
 * way is invisible to it"* — reproduced by a check written to prevent exactly that class of gap. A completeness
 * ratchet whose extractor is narrower than the thing it audits does not report a smaller number; it reports a
 * clean one.
 *
 * Four idioms are matched: the two helpers, `=== "1"`-style comparisons, and `/^(0|false|off)$/i`-style tests.
 *
 * The `NKLEIN_` prefix is required, and that is also load-bearing: without it the scan matches the literal text
 * `isTruthyEnv(process.env.X)` inside a MESSAGE STRING in `env-gated-delivery.ts` describing this very idiom.
 */
function flagsInSource(): string[] {
	const found = new Set<string>();
	const patterns = [
		/(?:isTruthyEnv|isEnabledByDefaultEnv)\(\s*process\.env\.(NKLEIN_[A-Z0-9_]*)/gu,
		/process\.env\.(NKLEIN_[A-Z0-9_]*)\s*(?:===|!==)\s*"(?:1|0|true|false|on|off|smallest)"/gu,
		/\/\^?\([^)]*(?:0|false|off|1|true|on)[^)]*\)[^/]*\/i?\u002etest\(\s*process\.env\.(NKLEIN_[A-Z0-9_]*)/gu,
	];
	for (const file of globSync("src/**/*.{ts,tsx}")) {
		const text = readFileSync(file, "utf8");
		for (const pattern of patterns) {
			for (const match of text.matchAll(pattern)) {
				found.add(match[1] as string);
			}
		}
	}
	return [...found].sort();
}

describe("flag registry coverage — the F4.8b ratchet", () => {
	it("finds flags in the source at all", () => {
		// A broken extractor yields an empty list, and every assertion below passes by vacuity — the same
		// confident-green failure this registry exists to prevent.
		expect(flagsInSource().length).toBeGreaterThan(30);
	});

	it("SEES the non-helper idioms — the gap that made the first ratchet green while blind", () => {
		// Guarding the guard. If the extractor narrows back to `isTruthyEnv` only, the coverage test above keeps
		// passing while nine behaviour-changing flags go unaudited again. Each of these is read a different way.
		const found = new Set(flagsInSource());
		expect(found.has("NKLEIN_ALLOW_UNSUITABLE_MODEL"), 'read as === "1"').toBe(true);
		expect(found.has("NKLEIN_FITNESS_ROUTING"), "read via a /^(0|false|off)$/i test").toBe(true);
		expect(found.has("NKLEIN_MODEL_SENSITIVE_PRUNE"), 'read as !== "off"').toBe(true);
		expect(found.has("NKLEIN_DURABLE_SCHEDULER"), "read via isEnabledByDefaultEnv").toBe(true);
	});

	it("DECLARES every default-OFF flag present in the source", () => {
		const report = auditFlagCoverage(flagsInSource());
		expect(
			report.undeclared,
			`these flags exist in src/ but are not declared, so no tool can say whether enabling them is safe:\n  ${report.undeclared.join("\n  ")}`,
		).toEqual([]);
	});

	it("does not declare flags that no longer exist in the source", () => {
		// The other direction: a deleted flag left in the registry inflates the "classified" count with a claim
		// about code that is gone.
		const inSource = new Set(flagsInSource());
		const stale = FEATURE_FLAG_REGISTRY.filter((spec) => !inSource.has(spec.flag)).map((spec) => spec.flag);
		expect(stale, `declared but absent from src/: ${stale.join(", ")}`).toEqual([]);
	});
});

describe("the registry's own invariants", () => {
	it("declares no flag twice", () => {
		const names = FEATURE_FLAG_REGISTRY.map((spec) => spec.flag);
		expect(new Set(names).size).toBe(names.length);
	});

	it("cites a gate site for every entry, so a classification is checkable rather than trusted", () => {
		for (const spec of FEATURE_FLAG_REGISTRY) {
			expect(spec.gate.length, `${spec.flag} cites no gate site`).toBeGreaterThan(0);
		}
	});

	it("makes every UNCLASSIFIED entry say what was ambiguous", () => {
		// Otherwise `unclassified` degrades into "nobody got round to it" and stops being informative.
		for (const spec of FEATURE_FLAG_REGISTRY.filter((entry) => entry.mode === "unclassified")) {
			expect(spec.note, `${spec.flag} is unclassified without saying why`).toBeTruthy();
		}
	});
});

describe("defaultOnKillSwitches", () => {
	it("exposes the lane (c) set, and none of them is in the lane (b) safe set", () => {
		// A flag must not fall between the two lanes, and must never be in both.
		const kill = new Set(defaultOnKillSwitches());
		expect(kill.size).toBeGreaterThan(0);
		for (const flag of safeObserveOnlyFlags()) {
			expect(kill.has(flag), `${flag} is both a safe opt-in and a kill switch`).toBe(false);
		}
	});
});

describe("safeObserveOnlyFlags", () => {
	it("EXCLUDES unclassified flags by construction", () => {
		// The load-bearing property. A flag nobody has read must never reach a lane that turns it on, and the
		// exclusion has to be structural rather than a reviewer remembering.
		const safe = new Set(safeObserveOnlyFlags());
		for (const spec of FEATURE_FLAG_REGISTRY.filter((entry) => entry.mode !== "observe_only")) {
			expect(safe.has(spec.flag), `${spec.flag} is ${spec.mode} but appears in the safe set`).toBe(false);
		}
	});

	it("returns only observe-only flags, and at least one", () => {
		const safe = safeObserveOnlyFlags();
		expect(safe.length).toBeGreaterThan(0);
		for (const flag of safe) {
			expect(FEATURE_FLAG_REGISTRY.find((spec) => spec.flag === flag)?.mode).toBe("observe_only");
		}
	});

	it("is stable in order, so a lane definition does not churn", () => {
		expect(safeObserveOnlyFlags()).toEqual([...safeObserveOnlyFlags()].sort());
	});
});

describe("auditFlagCoverage", () => {
	it("reports the mode split and what lane (b) may actually enable", () => {
		const report = auditFlagCoverage(flagsInSource());
		expect(report.total).toBe(FEATURE_FLAG_REGISTRY.length);
		expect(report.summary).toMatch(/ENFORCING/u);
		expect(report.summary).toMatch(/the rest change what the product does for a card/u);
	});

	it("surfaces an undeclared flag rather than ignoring it", () => {
		const report = auditFlagCoverage([...flagsInSource(), "NKLEIN_BRAND_NEW_FLAG"]);
		expect(report.undeclared).toEqual(["NKLEIN_BRAND_NEW_FLAG"]);
	});

	it("shows ENFORCING outnumbering observe-only — the finding that reframes lane (b)", () => {
		// N11's lane (b) is worded "all safe opt-ins ON (the dark flags shipped observe-first)". Reading every
		// gate site showed the population is mostly the opposite, so the lane is a deliberate behaviour-changing
		// configuration rather than a harmless one. If this ever inverts, the lane's premise has changed and the
		// item should be re-read, not this test relaxed.
		const report = auditFlagCoverage(flagsInSource());
		expect(report.byMode.enforcing).toBeGreaterThan(report.byMode.observe_only * 3);
	});
});
