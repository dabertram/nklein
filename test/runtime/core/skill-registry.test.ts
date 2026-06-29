import { describe, expect, it } from "vitest";
import {
	fragmentsForSkills,
	getSkillById,
	SKILL_REGISTRY,
	type Skill,
	skillRelevance,
	toolsForSkills,
} from "../../../src/core/skill-registry";

describe("SKILL_REGISTRY", () => {
	it("every role maps to exactly the expected default skill bundle, with non-empty fragments + tools", () => {
		for (const skill of SKILL_REGISTRY) {
			expect(skill.contextFragments.length).toBeGreaterThan(0);
			expect(skill.tools.length).toBeGreaterThan(0);
			expect(skill.defaultRoles.length).toBeGreaterThan(0);
		}
		// The worker/architect/reviewer/retriever roles each have a default skill.
		const byRole = (role: string) => SKILL_REGISTRY.filter((s) => s.defaultRoles.includes(role)).map((s) => s.id);
		expect(byRole("worker")).toEqual(["code_editing"]);
		expect(byRole("architect")).toEqual(["planning"]);
		expect(byRole("reviewer")).toEqual(["review"]);
		expect(byRole("retriever")).toEqual(["web_retrieval"]);
	});
});

describe("skillRelevance", () => {
	const codeEditing = getSkillById("code_editing") as Skill;
	const webRetrieval = getSkillById("web_retrieval") as Skill;

	it("a default-role match is maximally relevant (1.0), dominating keyword/temporal signals", () => {
		expect(skillRelevance(codeEditing, { role: "worker", taskText: "anything" })).toBe(1);
	});

	it("a task keyword is a soft signal (0.6) when there is no role match", () => {
		expect(skillRelevance(codeEditing, { role: "reviewer", taskText: "implement the parser" })).toBe(0.6);
		// no keyword, wrong role ⇒ not relevant.
		expect(skillRelevance(codeEditing, { role: "reviewer", taskText: "say hello" })).toBe(0);
	});

	it("a temporal/freshness signal lifts a temporally-sensitive skill (0.7)", () => {
		// 'latest release' carries both a keyword AND a temporal marker; the temporal lift (0.7) wins.
		expect(skillRelevance(webRetrieval, { role: null, taskText: "what is the latest release of vite" })).toBe(0.7);
		// a plain coding task does not make web_retrieval relevant.
		expect(skillRelevance(webRetrieval, { role: null, taskText: "rename a variable" })).toBe(0);
	});
});

describe("fragmentsForSkills / toolsForSkills", () => {
	it("unions fragments + tools across skills, deduped and order-preserving", () => {
		const planning = getSkillById("planning") as Skill;
		const review = getSkillById("review") as Skill;
		// planning: [repo_map, refinement_preamble]; review: [focus_chain, efficiency_rules] → union in order.
		expect(fragmentsForSkills([planning, review])).toEqual([
			"repo_map",
			"refinement_preamble",
			"focus_chain",
			"efficiency_rules",
		]);
		// code_editing + planning share read_file/list_dir → deduped.
		const codeEditing = getSkillById("code_editing") as Skill;
		expect(toolsForSkills([codeEditing, planning])).toEqual(["read_file", "list_dir", "edit_file", "run_command"]);
	});

	it("is empty for no skills", () => {
		expect(fragmentsForSkills([])).toEqual([]);
		expect(toolsForSkills([])).toEqual([]);
	});
});
