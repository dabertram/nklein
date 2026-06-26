import { describe, expect, it } from "vitest";
import {
	devTestProjectConfigSchema,
	listDevTestProjectIds,
	loadDevTestProjectRegistry,
	loadDevTestProjectScenario,
	parseDevTestProjectConfig,
	resolveDevTestProjectsDir,
} from "../../../src/nklein-sdk/dev-test-project-registry";

const VALID_CONFIG_JSON = JSON.stringify({
	id: "01_clinical_medication_safety_platform",
	title: "Clinical Medication Safety and Adherence Platform",
	acceptanceCommand: "npm test",
	agentId: "nklein",
	startInPlanMode: true,
	tier: "1/20",
	tags: ["outpatient medication safety", "drug interaction rules"],
});

describe("dev-test-project-registry config validation", () => {
	it("parses + validates a well-formed project.json", () => {
		const config = parseDevTestProjectConfig(VALID_CONFIG_JSON, "01_clinical_medication_safety_platform");
		expect(config.title).toBe("Clinical Medication Safety and Adherence Platform");
		expect(config.tier).toBe("1/20");
		expect(config.tags).toEqual(["outpatient medication safety", "drug interaction rules"]);
		expect(config.startInPlanMode).toBe(true);
	});

	it("rejects project.json that is not valid JSON", () => {
		expect(() => parseDevTestProjectConfig("{not json", "broken")).toThrow(/not valid JSON/);
	});

	it("rejects a config missing a required field (title)", () => {
		const raw = JSON.stringify({ id: "x", acceptanceCommand: "npm test" });
		expect(() => parseDevTestProjectConfig(raw, "x")).toThrow(/invalid project\.json/);
	});

	it("rejects an unknown field (strict schema)", () => {
		const raw = JSON.stringify({ id: "x", title: "X", acceptanceCommand: "npm test", bogusField: true });
		expect(devTestProjectConfigSchema.safeParse(JSON.parse(raw)).success).toBe(false);
		expect(() => parseDevTestProjectConfig(raw, "x")).toThrow(/invalid project\.json/);
	});

	it("rejects a config whose id does not equal the folder name", () => {
		expect(() => parseDevTestProjectConfig(VALID_CONFIG_JSON, "different-folder")).toThrow(
			/must equal the folder name/,
		);
	});

	it("rejects an empty-string required field", () => {
		const raw = JSON.stringify({ id: "x", title: "", acceptanceCommand: "npm test" });
		expect(() => parseDevTestProjectConfig(raw, "x")).toThrow(/invalid project\.json/);
	});
});

describe("dev-test-project-registry discovery + loading", () => {
	it("discovers the in-repo registry folders (migrated legacy + enhanced specs)", () => {
		const ids = listDevTestProjectIds();
		// Migrated legacy scenarios stay discoverable by their stable ids.
		expect(ids).toContain("small-model-smoke");
		expect(ids).toContain("audio-vst-psytrance");
		expect(ids).toContain("daw-foundation-platform");
		expect(ids).toContain("habit-wide-fanout");
		// The enhanced spec set is integrated as NN_<name> folders.
		expect(ids).toContain("01_clinical_medication_safety_platform");
		expect(ids).toContain("36_dark_factory_dschinn_universal_agent");
		// Sorted by folder name.
		expect([...ids]).toEqual([...ids].sort((left, right) => left.localeCompare(right)));
	});

	it("loads + validates every discoverable project without error", () => {
		const entries = loadDevTestProjectRegistry();
		expect(entries.length).toBe(listDevTestProjectIds().length);
		expect(entries.length).toBeGreaterThanOrEqual(45);
		for (const entry of entries) {
			expect(entry.config.id).toBe(entry.scenario.id);
			expect(entry.scenario.specification.trim().length).toBeGreaterThan(0);
			expect(entry.scenario.prompt.trim().length).toBeGreaterThan(0);
			expect(entry.scenario.acceptanceCommand).toBe("npm test");
			expect(entry.directory.startsWith(resolveDevTestProjectsDir())).toBe(true);
		}
	});

	it("reads specification.md and user-prompt.txt into the scenario for a loaded project", () => {
		const scenario = loadDevTestProjectScenario("01_clinical_medication_safety_platform");
		// specification.md is the spec body the agent reads.
		expect(scenario.specification).toContain("Clinical Medication Safety and Adherence Platform");
		expect(scenario.specification).toContain("Complexity tier: 1/20");
		// user-prompt.txt is the decomposition seed prompt.
		expect(scenario.prompt).toContain("dependency-linked implementation plan");
		expect(scenario.prompt).toContain("Acceptance command: npm test");
	});

	it("preserves the migrated legacy scenario fields byte-for-byte (fixtureTemplate, complexity, specPath)", () => {
		const daw = loadDevTestProjectScenario("daw-foundation-platform");
		expect(daw.templateName).toBe("daw-foundation");
		expect(daw.complexity).toBe(100);
		expect(daw.specificationPath).toBe("scripts/dev-fixtures/daw-foundation-spec.md");

		const audio = loadDevTestProjectScenario("audio-vst-psytrance");
		expect(audio.templateName).toBe("audio-vst-synth");
		expect(audio.prompt).toContain("at least ten dependent implementation cards");
	});
});
