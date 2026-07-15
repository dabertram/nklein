import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths.js";
import type { ProceduralSkill } from "../core/procedural-skill-record.js";

/**
 * F4.19 — durable persistence for the ProceduralSkillBank. A single JSON map keyed by skill id (procedures are UPDATED,
 * not append-only, so a snapshot beats a log). `upsertProceduralSkill` writes one record; `loadProceduralSkills` reads
 * the map; `getCurrentProceduralSkills` returns only records not yet superseded. A missing/corrupt file reads as empty
 * (skip-and-recover, matching the other stores). `rootDir` is injectable so tests never touch the real runtime home.
 */

const proceduralSkillSchema = z.object({
	id: z.string(),
	title: z.string(),
	content: z.string(),
	status: z.enum(["candidate", "quarantined", "active", "deprecated"]),
	applicabilityTags: z.array(z.string()),
	version: z.number().int().positive(),
	contentHash: z.string(),
	outcomes: z.object({ helped: z.number().int().nonnegative(), hurt: z.number().int().nonnegative() }),
	supersededBy: z.string().nullable(),
	provenance: z.object({ source: z.string(), trust: z.string(), capturedAt: z.number() }),
	updatedAt: z.number(),
});
const proceduralSkillMapSchema = z.record(z.string(), proceduralSkillSchema);

function resolvePath(rootDir?: string): string {
	const root = rootDir ?? join(resolveNkleinRuntimeHomePath(homedir()), "procedural-skills");
	return join(root, "skills.json");
}

/** Load the full skill map (id → record). Missing/corrupt ⇒ empty. */
export async function loadProceduralSkills(
	options: { rootDir?: string } = {},
): Promise<Record<string, ProceduralSkill>> {
	const path = resolvePath(options.rootDir);
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch {
		return {};
	}
	try {
		const parsed = proceduralSkillMapSchema.safeParse(JSON.parse(raw));
		return parsed.success ? (parsed.data as Record<string, ProceduralSkill>) : {};
	} catch {
		return {};
	}
}

async function saveProceduralSkills(
	skills: Record<string, ProceduralSkill>,
	options: { rootDir?: string } = {},
): Promise<void> {
	const path = resolvePath(options.rootDir);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(skills, null, 2)}\n`, "utf8");
}

/** Insert or replace one skill record (by id), preserving the rest of the map. */
export async function upsertProceduralSkill(skill: ProceduralSkill, options: { rootDir?: string } = {}): Promise<void> {
	const skills = await loadProceduralSkills(options);
	skills[skill.id] = skill;
	await saveProceduralSkills(skills, options);
}

/** The current (non-superseded) procedures, newest-updated first. */
export async function getCurrentProceduralSkills(options: { rootDir?: string } = {}): Promise<ProceduralSkill[]> {
	const skills = await loadProceduralSkills(options);
	return Object.values(skills)
		.filter((skill) => skill.supersededBy === null)
		.sort((left, right) => right.updatedAt - left.updatedAt);
}
