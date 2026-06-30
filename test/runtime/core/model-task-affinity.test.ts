import { describe, expect, it } from "vitest";
import {
	affinityTagsForCapabilities,
	affinityTagsForModelKind,
	affinityTagsForSkills,
} from "../../../src/core/model-task-affinity";

describe("affinityTagsForModelKind", () => {
	it("maps work kinds to overlapping tags and non-work kinds to none", () => {
		expect(affinityTagsForModelKind("code")).toEqual(["code", "agentic"]);
		expect(affinityTagsForModelKind("reasoning")).toEqual(["reasoning"]);
		expect(affinityTagsForModelKind("chat")).toEqual(["instruct"]);
		expect(affinityTagsForModelKind("roleplay")).toEqual([]);
		expect(affinityTagsForModelKind("unknown")).toEqual([]);
	});

	it("treats a null/undefined kind as no affinity", () => {
		expect(affinityTagsForModelKind(null)).toEqual([]);
		expect(affinityTagsForModelKind(undefined)).toEqual([]);
	});
});

describe("affinityTagsForSkills", () => {
	it("unions the tags of the active skills, deduped", () => {
		expect(affinityTagsForSkills(["code_editing"])).toEqual(["code", "agentic"]);
		expect(affinityTagsForSkills(["planning"])).toEqual(["reasoning"]);
		// review wants reasoning+code; code_editing adds code+agentic ⇒ deduped union
		expect(new Set(affinityTagsForSkills(["review", "code_editing"]))).toEqual(
			new Set(["reasoning", "code", "agentic"]),
		);
	});

	it("is empty for no skills (⇒ no task-side preference)", () => {
		expect(affinityTagsForSkills([])).toEqual([]);
	});
});

describe("affinityTagsForCapabilities", () => {
	it("derives tags from runtime capability facts; every LLM gets the instruct lane", () => {
		expect(new Set(affinityTagsForCapabilities({ coder: true, toolUse: true }))).toEqual(
			new Set(["code", "agentic", "instruct"]),
		);
		expect(new Set(affinityTagsForCapabilities({ reasoning: true }))).toEqual(new Set(["reasoning", "instruct"]));
		// a plain tool-trained general model → agentic + instruct (no code/reasoning)
		expect(new Set(affinityTagsForCapabilities({ toolUse: true }))).toEqual(new Set(["agentic", "instruct"]));
		// no facts at all → still the generic instruct lane
		expect(affinityTagsForCapabilities({})).toEqual(["instruct"]);
	});
});
