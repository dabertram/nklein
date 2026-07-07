import { afterEach, describe, expect, it } from "vitest";
import {
	assessModelSuitability,
	clearModelCatalogOverlay,
	lookupModelCapability,
	registerModelCatalogOverlay,
} from "../../../src/core/model-capability-catalog";
import { parseModelCatalogOverlay } from "../../../src/core/model-catalog-overlay";

afterEach(() => clearModelCatalogOverlay());

const validEntry = (over: Record<string, unknown> = {}) => ({
	family: "acme-coder-9b",
	match: "acme-coder",
	toolUse: "TOOL_NATIVE",
	kind: "code",
	note: "A user-added model.",
	sources: ["https://example.com/acme"],
	basis: "empirical",
	...over,
});

describe("parseModelCatalogOverlay", () => {
	it("compiles a valid entry (match string → case-insensitive RegExp) with no errors", () => {
		const { entries, errors } = parseModelCatalogOverlay({ models: [validEntry()] });
		expect(errors).toEqual([]);
		expect(entries).toHaveLength(1);
		expect(entries[0].family).toBe("acme-coder-9b");
		expect(entries[0].match).toBeInstanceOf(RegExp);
		expect(entries[0].match.test("acme-coder-9b-instruct")).toBe(true);
		expect(entries[0].match.test("ACME-CODER")).toBe(true); // compiled case-insensitively
	});

	it("applies schema defaults (note/sources/basis) for a minimal entry", () => {
		const { entries, errors } = parseModelCatalogOverlay({
			models: [{ family: "x", match: "x-model", toolUse: "UNKNOWN", kind: "unknown" }],
		});
		expect(errors).toEqual([]);
		expect(entries[0]).toMatchObject({ note: "", sources: [], basis: "research" });
	});

	it("is TOLERANT: skips a schema-invalid entry with a reported error, keeps the valid ones", () => {
		const { entries, errors } = parseModelCatalogOverlay({
			models: [validEntry(), { family: "bad", match: "bad", toolUse: "NOT_A_VERDICT", kind: "code" }],
		});
		expect(entries).toHaveLength(1);
		expect(entries[0].family).toBe("acme-coder-9b");
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatch(/model\[1\] skipped/);
	});

	it("skips an entry whose match is an invalid regex, with a reason", () => {
		const { entries, errors } = parseModelCatalogOverlay({ models: [validEntry({ match: "([unclosed" })] });
		expect(entries).toEqual([]);
		expect(errors[0]).toMatch(/invalid match regex/);
	});

	it("reports a root-shape error when `models` is not an array", () => {
		const { entries, errors } = parseModelCatalogOverlay({ models: "nope" });
		expect(entries).toEqual([]);
		expect(errors[0]).toMatch(/root invalid/);
	});
});

describe("lookupModelCapability + overlay", () => {
	it("consults the overlay FIRST — a user entry OVERRIDES the shipped verdict for the same id", () => {
		// gemma-3 ships as chat/TOOL-weak; a user overlay can re-classify their own tuned variant.
		const before = lookupModelCapability("gemma-3-12b-it");
		expect(before?.kind).toBe("chat"); // shipped
		const { entries } = parseModelCatalogOverlay({
			models: [validEntry({ family: "my-gemma", match: "gemma-3", toolUse: "TOOL_NATIVE", kind: "agentic" })],
		});
		registerModelCatalogOverlay(entries);
		const after = lookupModelCapability("gemma-3-12b-it");
		expect(after?.family).toBe("my-gemma"); // overlay wins
		expect(after?.kind).toBe("agentic");
	});

	it("adds a brand-new model the shipped catalog doesn't know", () => {
		expect(lookupModelCapability("acme-coder-9b")).toBeNull(); // unknown to the shipped catalog
		registerModelCatalogOverlay(parseModelCatalogOverlay({ models: [validEntry()] }).entries);
		expect(lookupModelCapability("acme-coder-9b")?.toolUse).toBe("TOOL_NATIVE");
	});

	it("clearModelCatalogOverlay reverts to the shipped catalog", () => {
		registerModelCatalogOverlay(parseModelCatalogOverlay({ models: [validEntry()] }).entries);
		expect(lookupModelCapability("acme-coder-9b")).not.toBeNull();
		clearModelCatalogOverlay();
		expect(lookupModelCapability("acme-coder-9b")).toBeNull();
	});

	it("★ an overlay entry flows through to the SUITABILITY GATE (the overlay's whole purpose)", () => {
		// DOWNGRADE: a user overlay can gate a shipped model OUT of agentic work by marking it tool-unsuitable.
		registerModelCatalogOverlay(
			parseModelCatalogOverlay({
				models: [
					validEntry({ family: "banned-gemma", match: "gemma-3", toolUse: "TOOL_UNSUITABLE", kind: "chat" }),
				],
			}).entries,
		);
		const downgraded = assessModelSuitability("gemma-3-12b-it");
		expect(downgraded.severity).toBe("reject"); // overlay's TOOL_UNSUITABLE → default policy rejects
		expect(downgraded.allowed).toBe(false);

		// UPGRADE: an overlay verdict for a model unknown to the shipped catalog governs the gate (not the unknown default).
		clearModelCatalogOverlay();
		registerModelCatalogOverlay(parseModelCatalogOverlay({ models: [validEntry()] }).entries); // acme-coder → TOOL_NATIVE
		const upgraded = assessModelSuitability("acme-coder-9b");
		expect(upgraded.allowed).toBe(true);
		expect(upgraded.toolUse).toBe("TOOL_NATIVE");
	});
});
