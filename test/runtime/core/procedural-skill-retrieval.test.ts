import { describe, expect, it } from "vitest";
import {
	createProceduralSkill,
	type ProceduralSkill,
	recordProceduralSkillOutcome,
	supersedeProceduralSkill,
} from "../../../src/core/procedural-skill-record";
import {
	deriveProceduralContextTags,
	expandSkillsWithDependencies,
	isRetrievableProceduralSkill,
	matchProceduralSkills,
} from "../../../src/core/procedural-skill-retrieval";

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

describe("deriveProceduralContextTags", () => {
	it("includes the role and significant (≥4-char) task tokens, deduped + lowercased", () => {
		const tags = deriveProceduralContextTags("architect", "Add a CLI migration for the parser");
		expect(tags).toContain("architect");
		expect(tags).toContain("migration");
		expect(tags).toContain("parser");
		expect(tags).not.toContain("a"); // too short
		expect(tags).not.toContain("cli"); // 3 chars, below the ≥4 cutoff
	});

	it("end-to-end: a migration procedure surfaces for a task that mentions migration", () => {
		const proc = createProceduralSkill({
			id: "p1",
			title: "Safe DB migration",
			content: "steps",
			contentHash: "h",
			applicabilityTags: ["migration"],
			provenance: { source: "learned", trust: "trusted", capturedAt: 0 },
			status: "active",
			now: 0,
		});
		const tags = deriveProceduralContextTags("worker", "Run the schema migration on startup");
		expect(matchProceduralSkills([proc], tags).map((m) => m.skill.id)).toEqual(["p1"]);
	});

	it("tolerates a null role / empty text", () => {
		expect(deriveProceduralContextTags(null, "")).toEqual([]);
	});
});

describe("isRetrievableProceduralSkill", () => {
	it("is true only for an active, non-superseded skill", () => {
		expect(isRetrievableProceduralSkill(mk("a", ["x"]))).toBe(true);
		expect(isRetrievableProceduralSkill(mk("a", ["x"], { status: "candidate" }))).toBe(false);
		expect(isRetrievableProceduralSkill(supersedeProceduralSkill(mk("a", ["x"]), "b", 1))).toBe(false);
	});
});
describe("F12.29 dependency-aware expansion", () => {
	const skill = (id: string, over: object = {}) => ({
		id,
		title: id,
		content: "c",
		status: "active" as const,
		applicabilityTags: [],
		version: 1,
		contentHash: "h",
		outcomes: { helped: 0, hurt: 0 },
		supersededBy: null,
		provenance: { source: "learned", trust: "local", capturedAt: 1 },
		updatedAt: 1,
		...over,
	});

	it("renders dependencies first, dedupes, and survives cycles", () => {
		const a = skill("a", { dependsOnSkillIds: ["b"] });
		const b = skill("b", { dependsOnSkillIds: ["a"] }); // cycle
		const c = skill("c", { dependsOnSkillIds: ["b"] });
		const out = expandSkillsWithDependencies([a, c], [a, b, c]);
		expect(out.map((s) => s.id)).toEqual(["b", "a", "c"]);
	});

	it("skips missing and non-retrievable dependencies silently", () => {
		const dep = skill("dep", { status: "quarantined" as const });
		const main = skill("main", { dependsOnSkillIds: ["dep", "ghost"] });
		const out = expandSkillsWithDependencies([main], [main, dep]);
		expect(out.map((s) => s.id)).toEqual(["main"]);
	});
});
