import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createProceduralSkill,
	recordProceduralSkillOutcome,
	supersedeProceduralSkill,
} from "../../../src/core/procedural-skill-record";
import {
	getCurrentProceduralSkills,
	loadProceduralSkills,
	upsertProceduralSkill,
} from "../../../src/state/procedural-skill-store";

describe("procedural-skill-store (F4.19)", () => {
	let rootDir: string;
	beforeEach(async () => {
		rootDir = await mkdtemp(join(tmpdir(), "procedural-skill-store-"));
	});
	afterEach(async () => {
		await rm(rootDir, { recursive: true, force: true });
	});

	const skill = (id: string) =>
		createProceduralSkill({
			id,
			title: `Skill ${id}`,
			content: "do the thing",
			contentHash: `hash-${id}`,
			provenance: { source: "learned", trust: "medium", capturedAt: 1000 },
			now: 1000,
		});

	it("upserts + reloads a record round-trip", async () => {
		await upsertProceduralSkill(skill("a"), { rootDir });
		const loaded = await loadProceduralSkills({ rootDir });
		expect(loaded.a?.version).toBe(1);
		expect(loaded.a?.outcomes).toEqual({ helped: 0, hurt: 0 });
	});

	it("records outcomes and reflects the helped/hurt tally on reload", async () => {
		let s = skill("b");
		s = recordProceduralSkillOutcome(s, true, 2000);
		s = recordProceduralSkillOutcome(s, false, 3000);
		await upsertProceduralSkill(s, { rootDir });
		expect((await loadProceduralSkills({ rootDir })).b?.outcomes).toEqual({ helped: 1, hurt: 1 });
	});

	it("getCurrentProceduralSkills excludes superseded records", async () => {
		await upsertProceduralSkill(supersedeProceduralSkill(skill("old"), "new", 4000), { rootDir });
		await upsertProceduralSkill(skill("new"), { rootDir });
		const current = await getCurrentProceduralSkills({ rootDir });
		expect(current.map((s) => s.id)).toEqual(["new"]);
	});

	it("a missing store reads as empty", async () => {
		expect(await loadProceduralSkills({ rootDir })).toEqual({});
		expect(await getCurrentProceduralSkills({ rootDir })).toEqual([]);
	});
});
