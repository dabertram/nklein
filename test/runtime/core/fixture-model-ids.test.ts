import { describe, expect, it } from "vitest";

import { FIXTURE_MODEL_IDS, isFixtureModelId } from "../../../src/core/fixture-model-ids.js";

describe("isFixtureModelId", () => {
	it("flags the exact reported fixture ids (todo 10979)", () => {
		expect(isFixtureModelId("huge-advertised-model")).toBe(true);
		expect(isFixtureModelId("local-model")).toBe(true);
		expect(isFixtureModelId("small-local-model")).toBe(true);
	});

	it("flags every curated fixture id, case-insensitively and trimmed", () => {
		for (const id of FIXTURE_MODEL_IDS) {
			expect(isFixtureModelId(id.toUpperCase())).toBe(true);
			expect(isFixtureModelId(`  ${id}  `)).toBe(true);
		}
	});

	it("flags unambiguous mock-/dummy-/*-fixture markers", () => {
		expect(isFixtureModelId("mock-coder-7b")).toBe(true);
		expect(isFixtureModelId("dummy-reasoner")).toBe(true);
		expect(isFixtureModelId("qwen-fixture")).toBe(true);
		expect(isFixtureModelId("provider:mock-x")).toBe(true);
	});

	it("never hides a real published model id", () => {
		expect(isFixtureModelId("qwen/qwen2.5-coder-14b")).toBe(false);
		expect(isFixtureModelId("qwopus3.5-9b-coder-mtp")).toBe(false);
		expect(isFixtureModelId("devstral-small-2505")).toBe(false);
		expect(isFixtureModelId("gpt-oss-120b")).toBe(false);
		// A real model that merely CONTAINS "local" is not a fixture.
		expect(isFixtureModelId("localllama-3-8b")).toBe(false);
	});

	it("returns false for empty / nullish", () => {
		expect(isFixtureModelId("")).toBe(false);
		expect(isFixtureModelId("   ")).toBe(false);
		expect(isFixtureModelId(null)).toBe(false);
		expect(isFixtureModelId(undefined)).toBe(false);
	});
});
