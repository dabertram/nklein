import { describe, expect, it } from "vitest";
import { checkSkillSetCompat } from "../../../src/core/skill-compat";
import { getSkillById, type Skill } from "../../../src/core/skill-registry";

/**
 * Build a minimal test `Skill` with the fields the compat checker reads. All inputs are INJECTED (the checker takes the
 * skill array), so tests never depend on the live registry except where they explicitly compose with it.
 */
function skill(id: string, over: Partial<Skill> = {}): Skill {
	return {
		id: id as Skill["id"],
		description: `test ${id}`,
		defaultRoles: [],
		contextFragments: [],
		tools: [],
		keywords: [],
		...over,
	};
}

describe("checkSkillSetCompat", () => {
	it("reports a clean set (no conflicts, no redundancies) for disjoint skills", () => {
		const a = skill("code_editing", { contextFragments: ["repo_map"], tools: ["edit_file"] });
		const b = skill("web_retrieval", { contextFragments: ["online_retrieval"], tools: ["web_search"] });
		const report = checkSkillSetCompat([a, b]);
		expect(report.ok).toBe(true);
		expect(report.conflicts).toEqual([]);
		expect(report.redundancies).toEqual([]);
		expect(report.reason).toMatch(/clean/);
	});

	it("flags reasoning off↔high as a conflict and records the merge forcing high", () => {
		const fast = skill("code_editing", { apiProfile: { reasoning: "off" } });
		const deep = skill("review", { apiProfile: { reasoning: "high" } });
		const report = checkSkillSetCompat([fast, deep]);
		expect(report.ok).toBe(false);
		expect(report.conflicts).toHaveLength(1);
		const conflict = report.conflicts[0];
		expect(conflict.kind).toBe("reasoning_opposed");
		// id-sorted pair: "code_editing" < "review".
		expect(conflict.a).toBe("code_editing");
		expect(conflict.b).toBe("review");
		expect(conflict.mergedTo).toBe("high");
	});

	it("does NOT flag off↔low (mild) as a reasoning conflict — only off↔high counts", () => {
		const off = skill("code_editing", { apiProfile: { reasoning: "off" } });
		const low = skill("planning", { apiProfile: { reasoning: "low" } });
		expect(checkSkillSetCompat([off, low]).conflicts).toEqual([]);
	});

	it("treats `inherit`/absent reasoning as no-opinion — never a conflict", () => {
		const inherit = skill("code_editing", { apiProfile: { reasoning: "inherit" } });
		const high = skill("review", { apiProfile: { reasoning: "high" } });
		const absent = skill("planning", {});
		expect(checkSkillSetCompat([inherit, high]).conflicts).toEqual([]);
		expect(checkSkillSetCompat([absent, high]).conflicts).toEqual([]);
	});

	it("flags structured-output vs. forced-tool-call as opposed output shapes", () => {
		const structured = skill("web_retrieval", { apiProfile: { structuredOutput: true } });
		const forced = skill("code_editing", { apiProfile: { forceToolCall: true } });
		const report = checkSkillSetCompat([structured, forced]);
		expect(report.conflicts).toHaveLength(1);
		expect(report.conflicts[0].kind).toBe("output_shape_opposed");
	});

	it("flags DIVERGENT pinned temperatures and records the lower (most deterministic) merge", () => {
		const cold = skill("review", { apiProfile: { temperature: 0.1 } });
		const warm = skill("planning", { apiProfile: { temperature: 0.7 } });
		const report = checkSkillSetCompat([cold, warm]);
		expect(report.conflicts).toHaveLength(1);
		expect(report.conflicts[0].kind).toBe("temperature_divergent");
		expect(report.conflicts[0].mergedTo).toBe("temperature=0.1");
	});

	it("does NOT flag EQUAL pinned temperatures as divergent", () => {
		const a = skill("review", { apiProfile: { temperature: 0.2 } });
		const b = skill("planning", { apiProfile: { temperature: 0.2 } });
		expect(checkSkillSetCompat([a, b]).conflicts).toEqual([]);
	});

	it("can report MULTIPLE conflict kinds for a single pair", () => {
		const a = skill("code_editing", { apiProfile: { reasoning: "off", temperature: 0.9 } });
		const b = skill("review", { apiProfile: { reasoning: "high", temperature: 0.1 } });
		const report = checkSkillSetCompat([a, b]);
		const kinds = report.conflicts.map((c) => c.kind).sort();
		expect(kinds).toEqual(["reasoning_opposed", "temperature_divergent"]);
	});

	it("flags a fully-subsumed skill as redundant, attributing it to the earlier subsumer", () => {
		const broad = skill("code_editing", {
			contextFragments: ["repo_map", "focus_chain"],
			tools: ["read_file", "edit_file"],
		});
		const narrow = skill("review", { contextFragments: ["focus_chain"], tools: ["read_file"] });
		const report = checkSkillSetCompat([broad, narrow]);
		expect(report.ok).toBe(false);
		expect(report.redundancies).toHaveLength(1);
		expect(report.redundancies[0].redundant).toBe("review");
		expect(report.redundancies[0].subsumedBy).toBe("code_editing");
	});

	it("does NOT flag redundancy when a skill contributes a unique fragment or tool", () => {
		const a = skill("code_editing", { contextFragments: ["repo_map"], tools: ["read_file"] });
		const b = skill("review", { contextFragments: ["focus_chain"], tools: ["read_file"] });
		expect(checkSkillSetCompat([a, b]).redundancies).toEqual([]);
	});

	it("flags identical skills once (the LATER one is redundant), not twice", () => {
		const a = skill("code_editing", { contextFragments: ["repo_map"], tools: ["read_file"] });
		const b = skill("review", { contextFragments: ["repo_map"], tools: ["read_file"] });
		const report = checkSkillSetCompat([a, b]);
		expect(report.redundancies).toHaveLength(1);
		expect(report.redundancies[0].redundant).toBe("review");
		expect(report.redundancies[0].subsumedBy).toBe("code_editing");
	});

	it("dedupes a doubled skill id — no self-conflict or self-redundancy", () => {
		const s = skill("review", {
			contextFragments: ["focus_chain"],
			tools: ["read_file"],
			apiProfile: { reasoning: "high", temperature: 0.2 },
		});
		const report = checkSkillSetCompat([s, s]);
		expect(report.ok).toBe(true);
		expect(report.conflicts).toEqual([]);
		expect(report.redundancies).toEqual([]);
		expect(report.reason).toMatch(/1 skill/);
	});

	it("handles the empty and single-skill sets as trivially clean", () => {
		expect(checkSkillSetCompat([]).ok).toBe(true);
		expect(checkSkillSetCompat([skill("code_editing")]).ok).toBe(true);
	});

	it("composes with the live registry: the shipped bundles are internally clean", () => {
		// The hand-authored §5.AE registry should not ship a self-conflicting/redundant default set.
		const ids = ["code_editing", "planning", "review", "web_retrieval"] as const;
		for (const id of ids) {
			const s = getSkillById(id);
			expect(s).not.toBeNull();
		}
		// A plausible cross-role set the resolver could emit (worker + reviewer) — verify the checker runs over real data.
		const workerReview = [getSkillById("code_editing"), getSkillById("review")].filter((s): s is Skill => s !== null);
		const report = checkSkillSetCompat(workerReview);
		// code_editing = inherit reasoning (no opinion), review = high ⇒ no reasoning conflict.
		expect(report.conflicts).toEqual([]);
		// In the SHIPPED registry review's fragments {focus_chain, efficiency_rules} ⊂ code_editing's and review's tools
		// {read_file, run_command} ⊂ code_editing's — so this real cross-role union has a genuine redundancy the checker
		// surfaces (a useful signal: the reviewer skill adds no CONTEXT/TOOL over the worker bundle; its value is the
		// `high` apiProfile, which lives on a different axis the redundancy test intentionally ignores).
		expect(report.redundancies).toHaveLength(1);
		expect(report.redundancies[0].redundant).toBe("review");
	});
});
