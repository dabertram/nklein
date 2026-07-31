import { describe, expect, it } from "vitest";
import { auditLedgerFields, LEDGER_FIELD_REGISTRY } from "../../../src/core/ledger-field-audit";

/**
 * The evidence-substrate audit.
 *
 * The case that justifies this existing as CODE rather than a judgement: `flow` and `ttftMs` are both 0/238 on
 * the live ledger. One is correct (null IS the encoding for `board`, and the consumer reads `flow ?? "board"`),
 * the other is a real defect. **Same number, opposite meanings** — and eyeballing it got `flow` wrong on the
 * first pass. The expectation has to be declared next to the consumer, not inferred from the count.
 */

/** One attempt with only the named fields populated; everything else null. */
function attempt(populated: Record<string, unknown> = {}): Record<string, unknown> {
	const base: Record<string, unknown> = {};
	for (const spec of LEDGER_FIELD_REGISTRY) {
		base[spec.field] = null;
	}
	return { ...base, ...populated };
}

function statusOf(report: ReturnType<typeof auditLedgerFields>, field: string): string | undefined {
	return report.findings.find((finding) => finding.field === field)?.status;
}

describe("auditLedgerFields", () => {
	it("calls an `always` field with no data SILENT — the actionable class", () => {
		const report = auditLedgerFields({ attempts: [attempt(), attempt()] });
		expect(statusOf(report, "ttftMs")).toBe("silent");
		expect(report.summary).toMatch(/SILENT/u);
	});

	it("names the CONSUMER of a silent field, because that is why it matters", () => {
		const report = auditLedgerFields({ attempts: [attempt()] });
		const finding = report.findings.find((entry) => entry.field === "ttftMs");
		expect(finding?.detail).toMatch(/Read by: summarizeModelSpeed/u);
	});

	it("does NOT call a null-encodes-default field silent, at the same zero count", () => {
		// The whole reason this is a tool. `flow` and `ttftMs` are both 0/N; only one is broken.
		const report = auditLedgerFields({ attempts: [attempt(), attempt()] });
		expect(statusOf(report, "flow")).toBe("correctly_empty");
		expect(statusOf(report, "ttftMs")).toBe("silent");
	});

	it("treats an EXCEPTIONAL field's sparseness as health, not as a gap", () => {
		const report = auditLedgerFields({ attempts: [attempt({ salvage: "wall_time_exceeded" }), attempt()] });
		expect(statusOf(report, "salvage")).toBe("sparse_as_expected");
	});

	it("treats a PROVIDER-REPORTED field's emptiness as a fact about the fleet", () => {
		const report = auditLedgerFields({ attempts: [attempt()] });
		expect(statusOf(report, "reasoningTokens")).toBe("correctly_empty");
	});

	it("refuses to judge a FLAG-GATED field when the flag's state is unknown", () => {
		// The mechanism registry's rule, applied to fields: the current process env proves what is on NOW, and
		// these events were written by other processes on other days.
		expect(statusOf(auditLedgerFields({ attempts: [attempt()] }), "surfacedSkillIds")).toBe("unknown_enablement");
	});

	it("calls a flag-gated field correctly_empty once the flag is known to be OFF", () => {
		const report = auditLedgerFields({ attempts: [attempt()], enabledFlags: new Set<string>() });
		expect(statusOf(report, "surfacedSkillIds")).toBe("correctly_empty");
	});

	it("does not alarm on a NEWLY ADDED field that has had no chance to populate", () => {
		// Without this, a field added today is indistinguishable from one broken for months — and the only
		// options are a false alarm or quietly not checking it.
		expect(statusOf(auditLedgerFields({ attempts: [attempt()] }), "transcriptToolCallCount")).toBe(
			"too_new_to_judge",
		);
	});

	it("promotes a newly-added field to healthy the moment it carries data", () => {
		const report = auditLedgerFields({ attempts: [attempt({ transcriptToolCallCount: 4 })] });
		expect(statusOf(report, "transcriptToolCallCount")).toBe("healthy");
	});

	it("distinguishes PARTIAL from healthy and from silent", () => {
		const report = auditLedgerFields({ attempts: [attempt({ endpoint: "http://x" }), attempt()] });
		expect(statusOf(report, "endpoint")).toBe("partial");
	});

	it("counts an EMPTY ARRAY as absent — it is a value's shape around an absence", () => {
		// `surfacedSkillIds: []` means "none surfaced". Counting it as populated would report a flag-gated field
		// as healthy on every single attempt.
		const report = auditLedgerFields({ attempts: [attempt({ surfacedSkillIds: [] })], enabledFlags: new Set() });
		expect(report.findings.find((finding) => finding.field === "surfacedSkillIds")?.populated).toBe(0);
	});

	it("reports an UNDECLARED field only when it is EMPTY", () => {
		// An undeclared field carrying data is not a risk. Listing every one buried the real findings under 27
		// rows of noise — the cries-wolf failure the module's own header warns about.
		const report = auditLedgerFields({
			attempts: [attempt({ somethingNew: null, somethingUsed: "value" })],
		});
		expect(report.findings.map((finding) => finding.field)).toContain("somethingNew");
		expect(report.findings.map((finding) => finding.field)).not.toContain("somethingUsed");
	});

	it("says plainly that an empty ledger proves nothing", () => {
		const report = auditLedgerFields({ attempts: [] });
		expect(report.summary).toMatch(/says nothing about any field/u);
	});
});

describe("the registry itself", () => {
	it("gives every entry a named consumer — a field with no reader is a different problem", () => {
		for (const spec of LEDGER_FIELD_REGISTRY) {
			expect(spec.consumer.length, `${spec.field} has no declared consumer`).toBeGreaterThan(0);
			expect(spec.note.length).toBeGreaterThan(0);
		}
	});

	it("gives every flag-gated entry its flag, or `unknown_enablement` would be unfalsifiable", () => {
		for (const spec of LEDGER_FIELD_REGISTRY.filter((entry) => entry.expectation === "flag_gated")) {
			expect(spec.flag, `${spec.field} is flag-gated but names no flag`).toBeTruthy();
		}
	});

	it("declares no field twice", () => {
		const names = LEDGER_FIELD_REGISTRY.map((spec) => spec.field);
		expect(new Set(names).size).toBe(names.length);
	});
});
