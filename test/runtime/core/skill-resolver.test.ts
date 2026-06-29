import { describe, expect, it } from "vitest";
import { resolveActiveSkills } from "../../../src/core/skill-resolver";

describe("resolveActiveSkills", () => {
	it("fully_dynamic: selects skills clearing the relevance threshold, default-role bundle always in", () => {
		const result = resolveActiveSkills({ role: "worker", taskText: "implement the create_card handler" });
		expect(result.dynamicsLevel).toBe("fully_dynamic");
		// worker → code_editing (role match 1.0); the coding keywords don't pull any other skill over 0.6.
		expect(result.skills.map((s) => s.id)).toEqual(["code_editing"]);
		expect(result.fragments).toEqual(["repo_map", "focus_chain", "efficiency_rules"]);
		expect(result.tools).toContain("edit_file");
	});

	it("fully_dynamic: a temporal retrieval task pulls in web_retrieval even without a role", () => {
		const result = resolveActiveSkills({ role: null, taskText: "find the latest release notes for vite online" });
		expect(result.skills.map((s) => s.id)).toContain("web_retrieval");
		expect(result.fragments).toContain("online_retrieval");
		expect(result.fragments).toContain("temporal");
	});

	it("fully_dynamic: a prior failure VARIES the set by adding one untried skill (stuck-task rung)", () => {
		const base = resolveActiveSkills({ role: "worker", taskText: "fix the bug" });
		const varied = resolveActiveSkills({ role: "worker", taskText: "fix the bug", priorFailures: 1 });
		expect(varied.skills.length).toBe(base.skills.length + 1);
		expect(varied.reason).toMatch(/varied for stuck task/);
	});

	it("static levels resolve the role's default bundle with no relevance/failure variation", () => {
		const result = resolveActiveSkills({
			role: "architect",
			taskText: "fix a bug and search online",
			dynamicsLevel: "fully_static",
			priorFailures: 5,
		});
		// architect's default bundle is just `planning`, regardless of the coding/search keywords or the failures.
		expect(result.skills.map((s) => s.id)).toEqual(["planning"]);
		expect(result.reason).toMatch(/static default bundle/);
	});

	it("assigned_skills uses exactly the user's list, ignoring role + relevance", () => {
		const result = resolveActiveSkills({
			role: "worker",
			taskText: "anything at all",
			dynamicsLevel: "assigned_skills",
			assignedSkillIds: ["review", "web_retrieval"],
		});
		expect(result.skills.map((s) => s.id)).toEqual(["review", "web_retrieval"]);
		expect(result.tools).toContain("web_search");
	});

	it("a static level with no role falls back to relevance so the prompt is never skill-less", () => {
		const result = resolveActiveSkills({
			role: null,
			taskText: "implement the parser function",
			dynamicsLevel: "static_skills_auto_model",
		});
		expect(result.skills.map((s) => s.id)).toContain("code_editing");
		expect(result.reason).toMatch(/fell back to relevance/);
	});
});
