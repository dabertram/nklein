import { describe, expect, it } from "vitest";
import { redactForFieldReport } from "../../src/core/field-report-redaction";

/**
 * The acceptance for a redactor is ADVERSARIAL by necessity: unit-testing it on inputs derived from its own
 * regexes only proves the regexes match themselves. These fixtures seed secrets into realistic report prose and
 * assert NONE survive.
 */
const SEEDED = {
	projectName: "AcmeLedger",
	authorName: "Dana Okonkwo",
	homePath: "/Users/dana/GIT/AcmeLedger/src/billing/invoice.ts",
	linuxPath: "/home/dana/work/AcmeLedger/config.yaml",
	deepPath: "/var/lib/acme/secrets/prod.key",
	url: "https://internal.acme.corp/runbooks/billing?token=abc123",
	email: "dana.okonkwo@acme.corp",
	apiKey: "sk-proj-9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c",
	ghToken: "ghp_ABCdefGHIjklMNOpqrSTUvwxYZ0123456789",
	jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
};

const REPORT_PROSE = `
The agent working on ${SEEDED.projectName} repeatedly re-read ${SEEDED.homePath} without editing it.
A config load from ${SEEDED.linuxPath} failed, and the runbook at ${SEEDED.url} was fetched by ${SEEDED.authorName}.
Credentials appeared in the trace: ${SEEDED.apiKey} and ${SEEDED.ghToken}, plus a session ${SEEDED.jwt}.
Contact for this workspace was ${SEEDED.email}. A key path ${SEEDED.deepPath} was also touched.
Later the agent re-read ${SEEDED.homePath} a second time, and then ${SEEDED.homePath} a third time.
`;

describe("redactForFieldReport — adversarial acceptance", () => {
	const result = redactForFieldReport(REPORT_PROSE, {
		customTerms: [SEEDED.projectName, SEEDED.authorName],
	});

	it("leaks NONE of the seeded secrets", () => {
		for (const [label, secret] of Object.entries(SEEDED)) {
			expect(result.text, `${label} survived redaction`).not.toContain(secret);
		}
	});

	it("leaks no fragment of a credential either", () => {
		// A partial key is still a leak; assert the distinctive prefixes are gone too.
		for (const fragment of ["sk-proj", "ghp_", "eyJhbGci"]) {
			expect(result.text).not.toContain(fragment);
		}
	});

	it("preserves the PATTERN — the same file maps to the same placeholder every time", () => {
		// The report's whole value is 'the agent re-read the same file 3x'. That is only legible if the three
		// references collapse to ONE stable placeholder rather than three anonymous blanks.
		const thrice = result.hits.filter((hit) => hit.occurrences === 3);
		expect(thrice.length, "the thrice-referenced path should be one placeholder with 3 occurrences").toBeGreaterThan(
			0,
		);
		// And the redacted prose must still show the repetition.
		const placeholder = thrice[0]?.placeholder ?? "";
		expect(result.text.split(placeholder).length - 1).toBe(3);
	});

	it("still reads as a report rather than a wall of redactions", () => {
		expect(result.text).toContain("repeatedly re-read");
		expect(result.text).toContain("without editing it");
	});

	it("reports WHAT was redacted so the user can judge sufficiency", () => {
		expect(result.hits.length).toBeGreaterThanOrEqual(7);
		expect(result.summary).toContain("STABLE placeholder");
	});
});

describe("redactForFieldReport — honesty about its own limits", () => {
	it("does NOT claim clean text when nothing matched", () => {
		const result = redactForFieldReport("The agent stalled after three edits.");
		expect(result.hits).toHaveLength(0);
		expect(result.summary).toContain("NOT proof the text is clean");
	});

	it("refuses a dangerously short custom term rather than shredding the text", () => {
		const result = redactForFieldReport("a cat sat on a mat", { customTerms: ["a"] });
		expect(result.text).toBe("a cat sat on a mat");
	});

	it("matches custom terms case-insensitively", () => {
		const result = redactForFieldReport("acmeledger and ACMELEDGER and AcmeLedger", {
			customTerms: ["AcmeLedger"],
		});
		expect(result.text).not.toMatch(/acmeledger/i);
	});

	it("is deterministic — the same input yields the same placeholders", () => {
		const a = redactForFieldReport(REPORT_PROSE, { customTerms: [SEEDED.projectName] });
		const b = redactForFieldReport(REPORT_PROSE, { customTerms: [SEEDED.projectName] });
		expect(a.text).toBe(b.text);
	});
});

describe("placeholder collision regression (found by the adversarial acceptance)", () => {
	it("gives DIFFERENT paths different placeholders even when they share a label", () => {
		// abs_path and home_path both render as PATH. Keying the counter by KIND made both start at 1, so two
		// distinct files became <PATH_1> — a report would then describe a repetition that never happened.
		const result = redactForFieldReport("read /Users/dana/a/b/c.ts then read /var/lib/acme/secrets/prod.key");
		const placeholders = result.hits.map((hit) => hit.placeholder);
		expect(new Set(placeholders).size).toBe(placeholders.length);
		expect(result.text).toContain("<PATH_1>");
		expect(result.text).toContain("<PATH_2>");
	});
});
