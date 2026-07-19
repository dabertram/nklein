import { describe, expect, it } from "vitest";
import { deriveSpecInvariants, renderPropertyScaffold } from "../../src/core/spec-invariant-derivation";

describe("spec invariant derivation (F12.93)", () => {
	it("derives the invariant families a spec states", () => {
		const spec = [
			"# Retry cap",
			"The retry count must never exceed 5.",
			"Encoding a payload and decoding it must return the original value.",
			"Applying the normalizer is idempotent.",
			"Results are always returned in ascending order.",
			"The score stays between 0 and 100.",
		].join("\n");
		const kinds = deriveSpecInvariants(spec).map((invariant) => invariant.kind);
		expect(kinds).toContain("never_condition");
		expect(kinds).toContain("round_trip");
		expect(kinds).toContain("idempotent");
		expect(kinds).toContain("ordering");
		expect(kinds).toContain("bounds");
	});

	it("carries the source line as provenance so a human can check the reading", () => {
		const invariants = deriveSpecInvariants("The queue must never drop an acknowledged message.");
		expect(invariants).toHaveLength(1);
		expect(invariants[0]?.sourceLine).toBe("The queue must never drop an acknowledged message.");
		expect(invariants[0]?.statement).toContain("never occurs");
	});

	it("returns nothing for a spec that states no invariants (never invents an oracle)", () => {
		const spec = "# Notes\nAdd a button.\nIt opens the panel.";
		expect(deriveSpecInvariants(spec)).toEqual([]);
		expect(renderPropertyScaffold([])).toBeNull();
	});

	it("takes the most specific reading per line and de-duplicates repeats", () => {
		// "must" would match always_condition, but round-trip is more specific and wins.
		const roundTrip = deriveSpecInvariants("A parsed config must serialize back to the same bytes.");
		expect(roundTrip[0]?.kind).toBe("round_trip");
		const repeated = deriveSpecInvariants(
			["The score stays between 0 and 100.", "The score stays between 0 and 100."].join("\n"),
		);
		expect(repeated).toHaveLength(1);
	});

	it("skips headings and structural noise", () => {
		expect(deriveSpecInvariants("## Always\n---\nshort")).toEqual([]);
	});

	it("renders a scaffold that FAILS until bound (a silently-green scaffold would be worse than none)", () => {
		const invariants = deriveSpecInvariants("The retry count must never exceed 5.");
		const scaffold = renderPropertyScaffold(invariants, "computeRetryCap");
		expect(scaffold).not.toBeNull();
		expect(scaffold).toContain('import fc from "fast-check"');
		expect(scaffold).toContain("never_condition");
		expect(scaffold).toContain("TODO bind computeRetryCap");
		expect(scaffold).toContain("expect(false).toBe(true)");
		// Provenance travels into the scaffold so the reviewer sees WHY the property exists.
		expect(scaffold).toContain("The retry count must never exceed 5.");
	});
});
