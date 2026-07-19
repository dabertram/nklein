import { describe, expect, it } from "vitest";
import {
	applyLicenseDeclarations,
	parseLicenseDeclarations,
	renderProvenanceNote,
	resolveDeclaredLicense,
} from "../../src/core/model-license-declaration";

describe("parseLicenseDeclarations", () => {
	it("parses key=license pairs", () => {
		const map = parseLicenseDeclarations("qwen3-14b=apache-2.0, gemma-3-12b=gemma");
		expect(map.get("qwen3-14b")?.license).toBe("apache-2.0");
		expect(map.get("gemma-3-12b")?.license).toBe("gemma");
	});

	it("marks every parsed declaration as OPERATOR provenance, never verified", () => {
		const map = parseLicenseDeclarations("qwen3-14b=apache-2.0");
		expect(map.get("qwen3-14b")?.provenance).toBe("operator");
	});

	it("carries an optional operator note", () => {
		const map = parseLicenseDeclarations("llama-3.1-8b=llama3.1;checked the model card 2026-07-20");
		expect(map.get("llama-3.1-8b")?.note).toBe("checked the model card 2026-07-20");
	});

	it("SKIPS malformed entries instead of throwing — a typo must not take down a runtime", () => {
		const map = parseLicenseDeclarations("good=apache-2.0, garbage, =nolicense, nokey=, another=mit");
		expect(map.get("good")?.license).toBe("apache-2.0");
		expect(map.get("another")?.license).toBe("mit");
		expect(map.size).toBe(2);
	});

	it("returns an empty map for empty/absent config", () => {
		expect(parseLicenseDeclarations(null).size).toBe(0);
		expect(parseLicenseDeclarations("").size).toBe(0);
		expect(parseLicenseDeclarations("   ").size).toBe(0);
	});
});

describe("resolveDeclaredLicense", () => {
	it("matches a prefix pattern across quantized variants of one model", () => {
		const map = parseLicenseDeclarations("qwen3-14b-*=apache-2.0");
		expect(resolveDeclaredLicense("qwen3-14b-q4_k_m", map)?.license).toBe("apache-2.0");
		expect(resolveDeclaredLicense("qwen3-14b-mlx@8bit", map)?.license).toBe("apache-2.0");
	});

	it("prefers an exact match over a prefix match", () => {
		const map = parseLicenseDeclarations("qwen3-*=apache-2.0, qwen3-14b-special=custom-eula");
		expect(resolveDeclaredLicense("qwen3-14b-special", map)?.license).toBe("custom-eula");
	});

	it("prefers the LONGEST matching prefix", () => {
		const map = parseLicenseDeclarations("qwen*=broad, qwen3-14b*=narrow");
		expect(resolveDeclaredLicense("qwen3-14b-q4", map)?.license).toBe("narrow");
	});

	it("returns null when nothing matches — never a guess", () => {
		const map = parseLicenseDeclarations("qwen3-*=apache-2.0");
		expect(resolveDeclaredLicense("mistral-7b", map)).toBeNull();
	});
});

describe("applyLicenseDeclarations", () => {
	it("leaves an undeclared model as unknown rather than inferring from its name", () => {
		// "llama" in the name is NOT evidence of the Llama license — inferring it would be fabricated compliance data.
		const facts = applyLicenseDeclarations([{ modelKey: "llama-3.1-8b-instruct" }], new Map());
		expect(facts[0]?.license).toBeNull();
		expect(facts[0]?.provenance).toBe("unknown");
	});

	it("attaches declared licenses with operator provenance", () => {
		const map = parseLicenseDeclarations("qwen3-*=apache-2.0");
		const facts = applyLicenseDeclarations([{ modelKey: "qwen3-14b-q4" }], map);
		expect(facts[0]?.license).toBe("apache-2.0");
		expect(facts[0]?.provenance).toBe("operator");
	});

	it("preserves version and hash provenance anchors", () => {
		const facts = applyLicenseDeclarations([{ modelKey: "m", version: "1.2", hash: "abc" }], new Map());
		expect(facts[0]?.version).toBe("1.2");
		expect(facts[0]?.hash).toBe("abc");
	});
});

describe("renderProvenanceNote", () => {
	it("says plainly that operator-declared is NOT verification", () => {
		const note = renderProvenanceNote([
			{ modelKey: "a", license: "apache-2.0", provenance: "operator" },
			{ modelKey: "b", license: "mit", provenance: "operator" },
		]);
		expect(note).toContain("OPERATOR-DECLARED");
		expect(note).toContain("NOT a verification");
	});

	it("says plainly that unknown is not permission", () => {
		const note = renderProvenanceNote([{ modelKey: "a", license: null, provenance: "unknown" }]);
		expect(note).toContain("Unknown is not permission");
	});

	it("reports both classes when both are present", () => {
		const note = renderProvenanceNote([
			{ modelKey: "a", license: "mit", provenance: "operator" },
			{ modelKey: "b", license: null, provenance: "unknown" },
		]);
		expect(note).toContain("OPERATOR-DECLARED");
		expect(note).toContain("unknown");
	});
});
