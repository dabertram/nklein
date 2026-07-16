import { describe, expect, it } from "vitest";
import {
	createProceduralSkill,
	type ProceduralSkill,
	recordProceduralSkillOutcome,
	supersedeProceduralSkill,
} from "../../../src/core/procedural-skill-record";
import { isRetrievableProceduralSkill, matchProceduralSkills } from "../../../src/core/procedural-skill-retrieval";

const mk = (
	id: string,
	tags: string[],
	opts: { status?: ProceduralSkill["status"]; title?: string } = {},
): ProceduralSkill =>
	createProceduralSkill({
		id,
		title: opts.title ?? id,
		content: "steps",
		contentHash: `h-${id}`,
		applicabilityTags: tags,
		provenance: { source: "learned", trust: "trusted", capturedAt: 0 },
		status: opts.status ?? "active",
		now: 0,
	});

describe("matchProceduralSkills (F4.19 retrieval)", () => {
	it("returns active skills sharing a tag, ranked by overlap then helped-rate", () => {
		const skills = [
			mk("a", ["cli", "parsing"]), // overlap 2
			mk("b", ["cli"]), // overlap 1
			mk("c", ["unrelated"]), // overlap 0 → excluded
		];
		const matches = matchProceduralSkills(skills, ["cli", "parsing"]);
		expect(matches.map((m) => m.skill.id)).toEqual(["a", "b"]);
		expect(matches[0]?.overlap).toBe(2);
	});

	it("excludes non-active statuses and superseded records (only validated, current skills are surfaced)", () => {
		const superseded = supersedeProceduralSkill(mk("old", ["cli"]), "new", 1);
		const skills = [
			mk("candidate", ["cli"], { status: "candidate" }),
			mk("quarantined", ["cli"], { status: "quarantined" }),
			mk("deprecated", ["cli"], { status: "deprecated" }),
			superseded, // status deprecated + supersededBy set
			mk("active", ["cli"]),
		];
		expect(matchProceduralSkills(skills, ["cli"]).map((m) => m.skill.id)).toEqual(["active"]);
	});

	it("breaks an overlap tie by learned helped-rate", () => {
		let helpful = mk("helpful", ["cli"], { title: "z-helpful" }); // title sorts last, so only helped-rate can lift it
		helpful = recordProceduralSkillOutcome(recordProceduralSkillOutcome(helpful, true, 1), true, 2); // rate 1.0
		const neutral = mk("neutral", ["cli"], { title: "a-neutral" }); // rate 0.5 (no evidence)
		const matches = matchProceduralSkills([neutral, helpful], ["cli"]);
		expect(matches.map((m) => m.skill.id)).toEqual(["helpful", "neutral"]);
	});

	it("honors minOverlap and the result limit", () => {
		const skills = [mk("a", ["x", "y"]), mk("b", ["x"]), mk("c", ["x"]), mk("d", ["x"])];
		expect(matchProceduralSkills(skills, ["x", "y"], { minOverlap: 2 }).map((m) => m.skill.id)).toEqual(["a"]);
		expect(matchProceduralSkills(skills, ["x", "y"], { limit: 2 })).toHaveLength(2);
	});

	it("returns [] when no context tags are given (nothing to match on)", () => {
		expect(matchProceduralSkills([mk("a", ["cli"])], [])).toEqual([]);
		expect(matchProceduralSkills([mk("a", ["cli"])], ["   "])).toEqual([]);
	});

	it("matches case-insensitively", () => {
		expect(matchProceduralSkills([mk("a", ["CLI"])], ["cli"]).map((m) => m.skill.id)).toEqual(["a"]);
	});
});

describe("isRetrievableProceduralSkill", () => {
	it("is true only for an active, non-superseded skill", () => {
		expect(isRetrievableProceduralSkill(mk("a", ["x"]))).toBe(true);
		expect(isRetrievableProceduralSkill(mk("a", ["x"], { status: "candidate" }))).toBe(false);
		expect(isRetrievableProceduralSkill(supersedeProceduralSkill(mk("a", ["x"]), "b", 1))).toBe(false);
	});
});
