import { describe, expect, it } from "vitest";
import { capabilityPriorForCatalogEntry, deriveCapabilityPrior } from "../../../src/core/capability-prior-from-catalog";
import type { ModelCapabilityEntry } from "../../../src/core/model-capability-catalog";
import { DEFAULT_CAPABILITY_PRIOR } from "../../../src/nklein-agent/nklein-model-registry-scoring";

function entry(overrides: Partial<ModelCapabilityEntry>): ModelCapabilityEntry {
	return {
		family: "test",
		match: /test/u,
		toolUse: "UNKNOWN",
		kind: "unknown",
		note: "",
		sources: [],
		basis: "research",
		...overrides,
	};
}

describe("capabilityPriorForCatalogEntry (§5.AB catalog-seeded prior)", () => {
	it("a TOOL_NATIVE, natively-chaining coder clears the medium band (>= 36) outright", () => {
		const prior = capabilityPriorForCatalogEntry(
			entry({ toolUse: "TOOL_NATIVE", kind: "code", chaining: "native", sizeGb: 9 }),
		);
		// 55 (native verdict) + 5 (native chaining) + 1 (9GB/6) = 61 — well above the 36 medium cliff.
		expect(prior).toBe(61);
		expect(prior).toBeGreaterThanOrEqual(36);
	});

	it("a TOOL_UNSUITABLE reasoning family stays well below the medium band", () => {
		const prior = capabilityPriorForCatalogEntry(entry({ toolUse: "TOOL_UNSUITABLE", kind: "reasoning" }));
		expect(prior).toBe(15);
		expect(prior).toBeLessThan(36);
	});

	it("ranks verdicts monotonically (native > capable > weak > unsuitable)", () => {
		const p = (v: ModelCapabilityEntry["toolUse"]) => capabilityPriorForCatalogEntry(entry({ toolUse: v }));
		expect(p("TOOL_NATIVE")).toBeGreaterThan(p("TOOL_CAPABLE"));
		expect(p("TOOL_CAPABLE")).toBeGreaterThan(p("TOOL_WEAK"));
		expect(p("TOOL_WEAK")).toBeGreaterThan(p("TOOL_UNSUITABLE"));
	});

	it("UNKNOWN verdict defers to the flat default (no opinion)", () => {
		expect(capabilityPriorForCatalogEntry(entry({ toolUse: "UNKNOWN" }))).toBe(DEFAULT_CAPABILITY_PRIOR);
	});

	it("chaining strength nudges the prior; a single-only/failing chainer scores lower than a native one", () => {
		const base = entry({ toolUse: "TOOL_CAPABLE" });
		expect(capabilityPriorForCatalogEntry({ ...base, chaining: "native" })).toBeGreaterThan(
			capabilityPriorForCatalogEntry({ ...base, chaining: "single_only" }),
		);
		expect(capabilityPriorForCatalogEntry({ ...base, chaining: "fails" })).toBe(35); // 45 - 10
	});

	it("size bonus is modest, monotonic, and capped at +8", () => {
		const base = entry({ toolUse: "TOOL_CAPABLE" }); // 45
		expect(capabilityPriorForCatalogEntry({ ...base, sizeGb: 3 })).toBe(45); // 3/6 floor = 0
		expect(capabilityPriorForCatalogEntry({ ...base, sizeGb: 16 })).toBe(47); // +2
		expect(capabilityPriorForCatalogEntry({ ...base, sizeGb: 96 })).toBe(53); // +8 cap (96/6=16 → cap 8)
		expect(capabilityPriorForCatalogEntry({ ...base, sizeGb: -1 })).toBe(45); // invalid → 0
	});

	it("clamps into [0, 100]", () => {
		expect(capabilityPriorForCatalogEntry(entry({ toolUse: "TOOL_UNSUITABLE", chaining: "fails" }))).toBe(5); // 15-10
	});

	it("deriveCapabilityPrior falls back to the flat default for a family unknown to the catalog", () => {
		expect(deriveCapabilityPrior("this-model-does-not-exist-anywhere-xyz")).toBe(DEFAULT_CAPABILITY_PRIOR);
	});
});
