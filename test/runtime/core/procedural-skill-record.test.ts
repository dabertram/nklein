import { describe, expect, it } from "vitest";
import {
	type CreateProceduralSkillInput,
	createProceduralSkill,
	isExecutionValidatedForPromotion,
	proceduralSkillHelpedRate,
	recordProceduralSkillExecutionOutcome,
	recordProceduralSkillOutcome,
	supersedeProceduralSkill,
} from "../../../src/core/procedural-skill-record";

const baseInput: CreateProceduralSkillInput = {
	id: "skill-1",
	title: "Retry with a smaller diff",
	content: "When a patch is rejected, split it and re-apply the smallest hunk first.",
	contentHash: "hash-abc",
	provenance: { source: "learned", trust: "internal", capturedAt: 1000 },
	now: 1000,
};

describe("procedural-skill-record (F4.19)", () => {
	it("creates a version-1 record with zero outcomes and no supersession", () => {
		const skill = createProceduralSkill(baseInput);
		expect(skill).toMatchObject({
			id: "skill-1",
			version: 1,
			status: "candidate",
			supersededBy: null,
			outcomes: { helped: 0, hurt: 0 },
			updatedAt: 1000,
		});
	});

	it("honors an explicit starting status (e.g. quarantined for imports) and copies tags defensively", () => {
		const tags = ["patching", "retry"];
		const skill = createProceduralSkill({ ...baseInput, status: "quarantined", applicabilityTags: tags });
		expect(skill.status).toBe("quarantined");
		expect(skill.applicabilityTags).toEqual(tags);
		expect(skill.applicabilityTags).not.toBe(tags); // defensive copy, not the caller's array
	});

	it("folds helped/hurt outcomes without mutating the input record", () => {
		const skill = createProceduralSkill(baseInput);
		const afterHelped = recordProceduralSkillOutcome(skill, true, 2000);
		const afterHurt = recordProceduralSkillOutcome(afterHelped, false, 3000);
		expect(afterHelped.outcomes).toEqual({ helped: 1, hurt: 0 });
		expect(afterHurt.outcomes).toEqual({ helped: 1, hurt: 1 });
		expect(afterHurt.updatedAt).toBe(3000);
		expect(skill.outcomes).toEqual({ helped: 0, hurt: 0 }); // original untouched (pure)
	});

	it("supersedes a record by deprecating it and pointing at the replacement", () => {
		const skill = createProceduralSkill(baseInput);
		const superseded = supersedeProceduralSkill(skill, "skill-2", 4000);
		expect(superseded.supersededBy).toBe("skill-2");
		expect(superseded.status).toBe("deprecated");
		expect(superseded.updatedAt).toBe(4000);
		expect(skill.supersededBy).toBeNull(); // original untouched
	});

	it("computes helped-rate with a 0.5 neutral prior on no evidence", () => {
		const skill = createProceduralSkill(baseInput);
		expect(proceduralSkillHelpedRate(skill)).toBe(0.5);
		const mixed = recordProceduralSkillOutcome(recordProceduralSkillOutcome(skill, true, 2), false, 3);
		expect(proceduralSkillHelpedRate(mixed)).toBe(0.5); // 1 helped / 2 total
		const helpful = recordProceduralSkillOutcome(recordProceduralSkillOutcome(skill, true, 2), true, 3);
		expect(proceduralSkillHelpedRate(helpful)).toBe(1); // 2 helped / 2 total
	});
});
describe("F12.29 execution-level validation", () => {
	const base = createProceduralSkill({
		id: "s1",
		title: "t",
		content: "steps",
		contentHash: "h",
		provenance: { source: "learned", trust: "local", capturedAt: 1 },
		now: 1,
	});

	it("records validated/refuted execution outcomes additively on legacy records", () => {
		const once = recordProceduralSkillExecutionOutcome(base, true, 5);
		expect(once.execution).toEqual({ validated: 1, refuted: 0 });
		expect(once.updatedAt).toBe(5);
		const twice = recordProceduralSkillExecutionOutcome(once, false, 6);
		expect(twice.execution).toEqual({ validated: 1, refuted: 1 });
		expect(base.execution).toBeUndefined();
	});

	it("promotion gate: unmeasured is NOT validated; validated must outnumber refuted", () => {
		expect(isExecutionValidatedForPromotion(base)).toBe(false);
		const good = recordProceduralSkillExecutionOutcome(base, true, 5);
		expect(isExecutionValidatedForPromotion(good)).toBe(true);
		const tied = recordProceduralSkillExecutionOutcome(good, false, 6);
		expect(isExecutionValidatedForPromotion(tied)).toBe(false);
	});
});
