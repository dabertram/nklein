import { describe, expect, it } from "vitest";
import {
	distillProceduralSkill,
	extractCompletedSteps,
	type ProcedureDistillationInput,
} from "../../../src/core/procedural-skill-distillation";

const base: ProcedureDistillationInput = {
	taskId: "task-1",
	taskTitle: "Add email/password login",
	taskObjective: "Implement login with validation",
	focusChain: "Focus chain (3/3 done):\n- [x] Write the auth handler\n- [x] Add input validation\n- [x] Write tests",
	succeeded: true,
	role: "coder",
	now: 1000,
};

describe("extractCompletedSteps", () => {
	it("pulls only the completed [x] steps, in order, trimmed", () => {
		expect(extractCompletedSteps("- [x] first\n- [ ] pending\n- [x] second")).toEqual(["first", "second"]);
	});

	it("de-duplicates and ignores empty / non-checkbox lines", () => {
		expect(extractCompletedSteps("Focus chain:\n- [x] a\n- [x] a\n- [x] ")).toEqual(["a"]);
	});

	it("returns [] for empty or all-pending chains", () => {
		expect(extractCompletedSteps("")).toEqual([]);
		expect(extractCompletedSteps("- [ ] not done\n- [ ] also not")).toEqual([]);
	});
});

describe("distillProceduralSkill", () => {
	it("distills a successful task's completed steps into a candidate procedure", () => {
		const skill = distillProceduralSkill(base);
		expect(skill).not.toBeNull();
		expect(skill?.status).toBe("candidate"); // NOT active — must be promoted before it is surfaced
		expect(skill?.title).toBe("Add email/password login");
		expect(skill?.content).toBe("1. Write the auth handler\n2. Add input validation\n3. Write tests");
		expect(skill?.applicabilityTags).toContain("coder"); // role folds into tags
		expect(skill?.applicabilityTags).toContain("login"); // task-text token
		expect(skill?.provenance.source).toBe("learned:task-1");
	});

	it("returns null for a FAILED task (never distill failure)", () => {
		expect(distillProceduralSkill({ ...base, succeeded: false })).toBeNull();
	});

	it("returns null when the completed plan is too thin (< 2 steps)", () => {
		expect(distillProceduralSkill({ ...base, focusChain: "- [x] only one step" })).toBeNull();
	});

	it("is idempotent per (task, content): same result ⇒ same id + hash", () => {
		const a = distillProceduralSkill(base);
		const b = distillProceduralSkill({ ...base, now: 9999 }); // time differs, content same
		expect(a?.id).toBe(b?.id);
		expect(a?.contentHash).toBe(b?.contentHash);
	});

	it("different completed steps ⇒ a different content hash", () => {
		const other = distillProceduralSkill({
			...base,
			focusChain: "- [x] Different step one\n- [x] Different step two",
		});
		expect(other?.contentHash).not.toBe(distillProceduralSkill(base)?.contentHash);
	});
});
