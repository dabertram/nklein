import { describe, expect, it } from "vitest";
import { getSkillById, skillRelevance } from "../../../src/core/skill-registry";
import { resolveActiveSkills } from "../../../src/core/skill-resolver";

// Regression tests for the skill-resolver bug-hunt (2026-07-05).

const webRetrieval = getSkillById("web_retrieval");
const codeEditing = getSkillById("code_editing");
if (!webRetrieval || !codeEditing) {
	throw new Error("skill fixtures missing");
}

describe("bug #1 — skillRelevance matches keywords on WORD boundaries, not raw substrings", () => {
	it("a short keyword does not over-match inside a larger word", () => {
		// web_retrieval keyword 'search' must NOT hit 'searchindex'; 'online' must NOT hit 'onlinestatus'.
		expect(skillRelevance(webRetrieval, { taskText: "rebuild the searchindex module", role: null })).toBe(0);
		expect(skillRelevance(webRetrieval, { taskText: "fix the onlinestatus enum", role: null })).toBe(0);
	});

	it("still matches a genuine whole-word keyword", () => {
		expect(
			skillRelevance(webRetrieval, { taskText: "search the web for the latest release", role: null }),
		).toBeGreaterThanOrEqual(0.6);
	});
});

describe("bug #2 — role matching is case-insensitive against the free-form LLM suggestedRole", () => {
	it("skillRelevance gives the 1.0 role bundle for a capitalized role", () => {
		expect(skillRelevance(codeEditing, { taskText: "zzz unrelated prose", role: "Worker" })).toBe(1);
	});

	it("resolveActiveSkills at a static level resolves the role bundle for a capitalized role", () => {
		const resolved = resolveActiveSkills({ role: "Architect", taskText: "anything", dynamicsLevel: "fully_static" });
		expect(resolved.skills.some((skill) => skill.id === "planning")).toBe(true);
	});
});
