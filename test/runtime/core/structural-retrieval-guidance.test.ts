import { describe, expect, it } from "vitest";
import {
	buildStructuralRetrievalGuidance,
	isStructuralCodeGraphServer,
	STRUCTURAL_CODE_GRAPH_SERVER_IDS,
} from "../../../src/core/structural-retrieval-guidance";

describe("isStructuralCodeGraphServer", () => {
	it("recognizes codebase-memory and nothing spurious", () => {
		expect(isStructuralCodeGraphServer("codebase-memory")).toBe(true);
		expect(isStructuralCodeGraphServer("sequential-thinking")).toBe(false);
		expect(isStructuralCodeGraphServer("")).toBe(false);
	});

	it("the id set is non-empty (a structural server exists to prefer)", () => {
		expect(STRUCTURAL_CODE_GRAPH_SERVER_IDS.length).toBeGreaterThan(0);
	});
});

describe("buildStructuralRetrievalGuidance", () => {
	it("emits the prefer-the-graph block when a structural server is offered", () => {
		const text = buildStructuralRetrievalGuidance(["codebase-memory"]);
		expect(text).not.toBe("");
		// Names the concrete tools so the model knows what to reach for.
		expect(text).toContain("search_graph");
		expect(text).toContain("trace_path");
		expect(text).toContain("get_code_snippet");
		// States the complete three-modality router instead of treating every query as a graph query.
		expect(text).toContain("search_code");
		expect(text).toContain("search_ast");
		expect(text).toContain("repo_map");
		expect(text).toContain("Callers/callees");
	});

	it("emits the block when the structural server is offered alongside others", () => {
		expect(buildStructuralRetrievalGuidance(["sequential-thinking", "codebase-memory"])).not.toBe("");
	});

	it("emits NOTHING when no structural server is offered (never names an absent tool)", () => {
		expect(buildStructuralRetrievalGuidance([])).toBe("");
		expect(buildStructuralRetrievalGuidance(["sequential-thinking"])).toBe("");
	});
});
