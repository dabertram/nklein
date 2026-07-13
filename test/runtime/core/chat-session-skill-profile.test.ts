import { describe, expect, it } from "vitest";
import {
	resolveSelectedSkillsApiProfile,
	SELECTABLE_CHAT_SKILL_IDS,
} from "../../../src/core/chat-session-skill-profile";

describe("resolveSelectedSkillsApiProfile", () => {
	it("returns an empty (inert) profile for no selection", () => {
		expect(resolveSelectedSkillsApiProfile([])).toEqual({});
	});

	it("drops unknown skill ids (a user can only ever enable real skills)", () => {
		expect(resolveSelectedSkillsApiProfile(["not_a_skill", "also_fake"])).toEqual({});
	});

	it("resolves a single skill's profile (planning ⇒ reasoning high)", () => {
		expect(resolveSelectedSkillsApiProfile(["planning"])).toEqual({ reasoning: "high" });
	});

	it("resolves web_retrieval ⇒ structured output", () => {
		expect(resolveSelectedSkillsApiProfile(["web_retrieval"])).toEqual({ structuredOutput: true });
	});

	it("merges multiple selected skills (strongest reasoning + OR-any structured), ignoring dupes and unknowns", () => {
		// planning (reasoning high) + web_retrieval (structuredOutput) + code_editing (reasoning inherit, ignored).
		const profile = resolveSelectedSkillsApiProfile([
			"planning",
			"web_retrieval",
			"planning", // dupe collapses
			"ghost", // unknown drops
			"code_editing",
		]);
		expect(profile.reasoning).toBe("high");
		expect(profile.structuredOutput).toBe(true);
	});

	it("SELECTABLE_CHAT_SKILL_IDS lists the real registry skills", () => {
		expect(SELECTABLE_CHAT_SKILL_IDS).toEqual([
			"code_editing",
			"planning",
			"review",
			"web_retrieval",
			"self_awareness",
		]);
	});
});
