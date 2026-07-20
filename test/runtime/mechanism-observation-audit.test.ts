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
		// `§5.X` is as valid an owning reference as `F12.x` — 127 of them are used across todo.md, and §5.O owns
		// the two-phase tool pick. The regex previously accepted only F/P items, which would have forced a
		// §-owned mechanism to be mislabelled to pass. Widened to match the references the backlog actually uses,
		// NOT to accommodate one entry: the point of this ratchet is traceability, and a § ref is traceable.
		for (const entry of MECHANISM_REGISTRY) {
			expect(entry.item, `${entry.category} must name its owning backlog item`).toMatch(/^([FP]\d|§\d)/);
		}
	});

	it("still REJECTS an untraceable item label", () => {
		// Widening the regex must not turn the ratchet off. Without this, "misc" or "" would now pass.
		expect("misc").not.toMatch(/^([FP]\d|§\d)/);
		expect("").not.toMatch(/^([FP]\d|§\d)/);
	});
});

describe("window saturation (live-found 2026-07-20 — it produced a FALSE finding)", () => {
	it("REFUSES to conclude silence when the read window was saturated", () => {
		// The real case: 500 events read, all 500 a single high-frequency category, so every other mechanism
		// counted zero purely because it had been truncated out of the window.
		const result = auditMechanismObservations({
			registry: [flagged],
			countsByCategory: new Map(),
			knownEnabledFlags: new Set(["SOME_FLAG"]),
			windowSaturated: true,
		});
		expect(result.findings[0]?.status).toBe("unknown_enablement");
		expect(result.findings[0]?.note).toContain("truncation artifact");
		expect(result.actionable).toHaveLength(0);
	});

	it("still reports enabled_but_silent when the window was NOT saturated", () => {
		const result = auditMechanismObservations({
			registry: [flagged],
			countsByCategory: new Map(),
			knownEnabledFlags: new Set(["SOME_FLAG"]),
			windowSaturated: false,
		});
		expect(result.findings[0]?.status).toBe("enabled_but_silent");
		expect(result.actionable).toHaveLength(1);
	});

	it("warns in the summary so a saturated run cannot be quoted as clean", () => {
		const result = auditMechanismObservations({
			registry: [flagged],
			countsByCategory: new Map(),
			knownEnabledFlags: new Set(["SOME_FLAG"]),
			windowSaturated: true,
		});
		expect(result.summary).toContain("SATURATED");
		expect(result.summary).toContain("inconclusive");
	});
});

describe("too_new_to_judge — silence before the mechanism existed", () => {
	const LANDED = Date.UTC(2026, 6, 19);
	const entry = {
		category: "review_effort_scaling",
		item: "F12.35",
		observes: "the review depth a card would have been given",
		enabledBy: null,
		expectation: "every_run" as const,
		addedOn: LANDED,
		firesWhen: "second_opinion_review_session",
	};

	it("does NOT accuse a mechanism whose trigger has not run since it landed", () => {
		// The real 2026-07-20 false alarm: 139 review sessions recorded, all of them 07-09→07-17, and the emission
		// site landed 07-19. The audit called it "reachable and still never fired" — a defect verdict against a
		// mechanism that had not yet had a single chance. A report that cries wolf on every new mechanism is one
		// people learn to skip.
		const result = auditMechanismObservations({
			registry: [entry],
			countsByCategory: new Map(),
			newestByCategory: new Map([["second_opinion_review_session", Date.UTC(2026, 6, 17)]]),
			knownEnabledFlags: new Set<string>(),
		});
		expect(result.findings[0]?.status).toBe("too_new_to_judge");
		expect(result.actionable).toHaveLength(0);
	});

	it("DOES accuse it once its trigger has run since it landed — or the check would excuse everything", () => {
		// The other half. Without this the new status would be a blanket amnesty rather than a window check.
		const result = auditMechanismObservations({
			registry: [entry],
			countsByCategory: new Map(),
			newestByCategory: new Map([["second_opinion_review_session", Date.UTC(2026, 6, 20)]]),
			knownEnabledFlags: new Set<string>(),
		});
		expect(result.findings[0]?.status).toBe("enabled_but_silent");
	});

	it("judges against the TRIGGER's window, not unrelated newer telemetry", () => {
		// Wall-clock recency proves nothing: telemetry from some other activity does not mean a review happened.
		const result = auditMechanismObservations({
			registry: [entry],
			countsByCategory: new Map(),
			newestObservationAt: Date.UTC(2026, 6, 20),
			newestByCategory: new Map([["second_opinion_review_session", Date.UTC(2026, 6, 17)]]),
			knownEnabledFlags: new Set<string>(),
		});
		expect(result.findings[0]?.status).toBe("too_new_to_judge");
	});
});

describe("a trigger that has NEVER fired is proof of no chance, not evidence of silence", () => {
	it("does not accuse a mechanism whose trigger category was never observed at all", () => {
		// Exposed by adding sysprompt_level with firesWhen: attempt_started, where the TRIGGER was itself brand
		// new. The first version of the window check required a non-null trigger timestamp, so an unfired trigger
		// skipped the check and fell straight through to an accusation — the audit declaring a mechanism silent
		// using a trigger that proved it could not have run.
		const result = auditMechanismObservations({
			registry: [
				{
					category: "sysprompt_level",
					item: "§5.AQ",
					observes: "which system-prompt level a session started with",
					enabledBy: null,
					expectation: "every_run",
					addedOn: Date.UTC(2026, 6, 20),
					firesWhen: "attempt_started",
				},
			],
			countsByCategory: new Map(),
			// Telemetry exists and is NEWER than addedOn — but contains no attempt_started at all.
			newestObservationAt: Date.UTC(2026, 6, 21),
			newestByCategory: new Map([["something_unrelated", Date.UTC(2026, 6, 21)]]),
			knownEnabledFlags: new Set<string>(),
		});
		expect(result.findings[0]?.status).toBe("too_new_to_judge");
		expect(result.actionable).toHaveLength(0);
	});

	it("STILL accuses once the trigger has fired after the mechanism landed", () => {
		// Guards the amnesty: without this, "trigger never observed" could be widened into "never accuse".
		const result = auditMechanismObservations({
			registry: [
				{
					category: "sysprompt_level",
					item: "§5.AQ",
					observes: "which system-prompt level a session started with",
					enabledBy: null,
					expectation: "every_run",
					addedOn: Date.UTC(2026, 6, 20),
					firesWhen: "attempt_started",
				},
			],
			countsByCategory: new Map(),
			newestByCategory: new Map([["attempt_started", Date.UTC(2026, 6, 21)]]),
			knownEnabledFlags: new Set<string>(),
		});
		expect(result.findings[0]?.status).toBe("enabled_but_silent");
	});
});
