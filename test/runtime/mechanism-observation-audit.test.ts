import { describe, expect, it } from "vitest";
import {
	auditMechanismObservations,
	MECHANISM_REGISTRY,
	type MechanismEntry,
} from "../../src/core/mechanism-observation-audit";

const flagged: MechanismEntry = {
	category: "cat",
	item: "F1.1",
	observes: "a thing",
	enabledBy: "SOME_FLAG",
	expectation: "every_run",
};

describe("auditMechanismObservations", () => {
	it("reports a firing mechanism as healthy", () => {
		const result = auditMechanismObservations({
			registry: [flagged],
			countsByCategory: new Map([["cat", 12]]),
			knownEnabledFlags: new Set(["SOME_FLAG"]),
		});
		expect(result.findings[0]?.status).toBe("healthy");
		expect(result.actionable).toHaveLength(0);
	});

	it("does NOT blame a mechanism whose flag was never enabled — zero is correct there", () => {
		const result = auditMechanismObservations({
			registry: [flagged],
			countsByCategory: new Map(),
			knownEnabledFlags: new Set(),
		});
		expect(result.findings[0]?.status).toBe("never_enabled");
		expect(result.actionable).toHaveLength(0);
		expect(result.findings[0]?.note).toContain("CORRECT result");
	});

	it("FLAGS the real smell: enabled, expected every run, and silent", () => {
		const result = auditMechanismObservations({
			registry: [flagged],
			countsByCategory: new Map(),
			knownEnabledFlags: new Set(["SOME_FLAG"]),
		});
		expect(result.findings[0]?.status).toBe("enabled_but_silent");
		expect(result.actionable).toHaveLength(1);
		expect(result.findings[0]?.note).toContain("reachable and still never fired");
	});

	it("treats silence from an EXCEPTIONAL mechanism as possible health, not a defect", () => {
		const result = auditMechanismObservations({
			registry: [{ ...flagged, expectation: "exceptional" }],
			countsByCategory: new Map(),
			knownEnabledFlags: new Set(["SOME_FLAG"]),
		});
		expect(result.findings[0]?.status).toBe("silent_but_exceptional");
		expect(result.actionable).toHaveLength(0);
		expect(result.findings[0]?.note).toContain("evidence of HEALTH");
	});

	it("returns UNKNOWN rather than an accusation when flag history is unavailable", () => {
		const result = auditMechanismObservations({
			registry: [flagged],
			countsByCategory: new Map(),
			// knownEnabledFlags omitted entirely — we cannot prove the flag's history.
		});
		expect(result.findings[0]?.status).toBe("unknown_enablement");
		expect(result.findings[0]?.note).toContain("inconclusive, not a defect");
	});

	it("treats an always-on mechanism as enabled without needing a flag", () => {
		const result = auditMechanismObservations({
			registry: [{ ...flagged, enabledBy: null }],
			countsByCategory: new Map(),
			knownEnabledFlags: new Set(),
		});
		expect(result.findings[0]?.status).toBe("enabled_but_silent");
	});

	it("summarises without overstating when nothing is actionable", () => {
		const result = auditMechanismObservations({
			registry: [{ ...flagged, expectation: "exceptional" }],
			countsByCategory: new Map(),
			knownEnabledFlags: new Set(["SOME_FLAG"]),
		});
		expect(result.summary).toContain("No enabled-but-silent mechanisms");
	});
});

describe("MECHANISM_REGISTRY", () => {
	it("covers the mechanisms shipped record-only in Phase 12", () => {
		const categories = MECHANISM_REGISTRY.map((entry) => entry.category);
		for (const expected of [
			"quant_floor_breach",
			"language_floor_breach",
			"mcp_tool_surface_drift",
			"drift_critic_flagged",
			"tool_catalog_gate_observation",
			"history_blind_corrector_override",
		]) {
			expect(categories).toContain(expected);
		}
	});

	it("marks breach-style mechanisms as exceptional so healthy silence is not misread", () => {
		const breach = MECHANISM_REGISTRY.find((entry) => entry.category === "quant_floor_breach");
		expect(breach?.expectation).toBe("exceptional");
	});

	it("every entry names the backlog item that owns it", () => {
		for (const entry of MECHANISM_REGISTRY) {
			expect(entry.item).toMatch(/^[FP]\d/);
		}
	});
});
