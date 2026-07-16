import { describe, expect, it } from "vitest";
import {
	explainTaintProvenance,
	isTrustedAnchorLevel,
	recordTaintProvenance,
	type TaintProvenanceEntry,
	taintProvenanceEntry,
	trustLevelForLabel,
	untrustedTaintSources,
	worstTrustLevel,
} from "../../../src/core/taint-provenance";

describe("trustLevelForLabel", () => {
	it("grades every label into its trust level", () => {
		expect(trustLevelForLabel("user_trusted")).toBe("operator");
		expect(trustLevelForLabel("runtime_policy")).toBe("runtime");
		expect(trustLevelForLabel("repo_instruction")).toBe("workspace");
		expect(trustLevelForLabel("private_repo")).toBe("workspace");
		expect(trustLevelForLabel("web")).toBe("untrusted");
		expect(trustLevelForLabel("mcp")).toBe("untrusted");
		expect(trustLevelForLabel("secret_like")).toBe("untrusted");
	});

	it("marks only operator/runtime as trusted anchors", () => {
		expect(isTrustedAnchorLevel("operator")).toBe(true);
		expect(isTrustedAnchorLevel("runtime")).toBe(true);
		expect(isTrustedAnchorLevel("workspace")).toBe(false);
		expect(isTrustedAnchorLevel("untrusted")).toBe(false);
	});
});

describe("taintProvenanceEntry", () => {
	it("derives the trust level and defaults a blank source", () => {
		expect(taintProvenanceEntry("web", "https://evil.example")).toEqual({
			label: "web",
			source: "https://evil.example",
			trust: "untrusted",
		});
		expect(taintProvenanceEntry("web", "   ").source).toBe("unknown source");
	});
});

describe("recordTaintProvenance", () => {
	const web = taintProvenanceEntry("web", "https://a.example");
	const repo = taintProvenanceEntry("repo_instruction", "src/README.md");

	it("accumulates and de-duplicates by (label, source)", () => {
		let ledger: TaintProvenanceEntry[] = [];
		ledger = recordTaintProvenance(ledger, [web]);
		ledger = recordTaintProvenance(ledger, [web, repo]); // web is a dup
		expect(ledger).toEqual([web, repo]);
	});

	it("keeps the same source under a different label as a distinct fact", () => {
		const webSecret = taintProvenanceEntry("secret_like", "https://a.example");
		const ledger = recordTaintProvenance([web], [webSecret]);
		expect(ledger).toHaveLength(2);
	});
});

describe("untrustedTaintSources", () => {
	it("lists distinct untrusted sources, excluding trusted anchors, order-stable", () => {
		const ledger = [
			taintProvenanceEntry("web", "https://a.example"),
			taintProvenanceEntry("mcp", "issues__get_issue"),
			taintProvenanceEntry("user_trusted", "operator"), // trusted anchor — excluded
			taintProvenanceEntry("web", "https://a.example"), // dup source
			taintProvenanceEntry("repo_instruction", "AGENTS.md"), // untrusted-to-influence, included
		];
		expect(untrustedTaintSources(ledger)).toEqual(["https://a.example", "issues__get_issue", "AGENTS.md"]);
	});

	it("returns [] when only trusted anchors are present", () => {
		expect(untrustedTaintSources([taintProvenanceEntry("user_trusted", "operator")])).toEqual([]);
	});
});

describe("worstTrustLevel", () => {
	it("returns the lowest trust level present", () => {
		expect(
			worstTrustLevel([taintProvenanceEntry("user_trusted", "op"), taintProvenanceEntry("web", "https://x")]),
		).toBe("untrusted");
		expect(worstTrustLevel([taintProvenanceEntry("repo_instruction", "R")])).toBe("workspace");
	});

	it("is operator (nothing to distrust) for an empty ledger", () => {
		expect(worstTrustLevel([])).toBe("operator");
	});
});

describe("explainTaintProvenance", () => {
	it("names the untrusted sources, capping at 3 with a +more note", () => {
		const ledger = ["a", "b", "c", "d"].map((s) => taintProvenanceEntry("web", `https://${s}.example`));
		const explained = explainTaintProvenance(ledger);
		expect(explained).toContain("https://a.example");
		expect(explained).toContain("https://c.example");
		expect(explained).not.toContain("https://d.example");
		expect(explained).toContain("+1 more");
	});

	it("is null when there is no untrusted provenance", () => {
		expect(explainTaintProvenance([taintProvenanceEntry("runtime_policy", "policy")])).toBeNull();
		expect(explainTaintProvenance([])).toBeNull();
	});
});
