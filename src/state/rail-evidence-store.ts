import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths.js";
import type { RailEvidenceReport } from "../core/rail-evidence.js";

/**
 * Reader for the §5.AI dev-test rail evidence harvest — the persisted `rail-*.json` reports the rail/daemon write. The
 * directory + read path live here (shared with the writer so they can't drift); a malformed file is skipped (not fatal)
 * so one bad report never blocks reading the rest. `rootDir` is injectable so tests never touch the real home.
 */

export function resolveRailEvidenceDir(rootDir?: string): string {
	return rootDir ?? join(resolveNkleinRuntimeHomePath(homedir()), "dev-test-rail-evidence");
}

const railLaneEvidenceSchema = z.object({
	label: z.string(),
	workspaceId: z.string(),
	startedOk: z.boolean(),
	startError: z.string().nullable(),
	verdict: z.enum(["delivered", "failed_to_start", "failed", "non_terminal"]),
	cards: z.number(),
	decomposed: z.boolean(),
	wsFrames: z.number(),
	sessionStates: z.record(z.string(), z.string()),
	toolCalls: z.record(z.string(), z.number()),
	totalToolCalls: z.number(),
	narrationLeaks: z.number(),
	hotRepeats: z.number(),
});

const railEvidenceReportSchema = z.object({
	schemaVersion: z.literal(1),
	at: z.string(),
	model: z.string(),
	maxWaitMs: z.number(),
	concurrency: z.number(),
	projectCount: z.number(),
	delivered: z.number(),
	anomalyProjects: z.number(),
	lanes: z.array(railLaneEvidenceSchema),
});

export async function readRailEvidenceReports(options: { rootDir?: string } = {}): Promise<RailEvidenceReport[]> {
	const dir = resolveRailEvidenceDir(options.rootDir);
	let names: string[];
	try {
		names = await readdir(dir);
	} catch {
		return []; // no harvest yet
	}
	const reports: RailEvidenceReport[] = [];
	for (const name of names.sort((left, right) => left.localeCompare(right))) {
		if (!name.endsWith(".json")) {
			continue;
		}
		try {
			const parsed = railEvidenceReportSchema.safeParse(JSON.parse(await readFile(join(dir, name), "utf8")));
			if (parsed.success) {
				reports.push(parsed.data);
			}
		} catch {
			// Skip an unreadable/malformed report; the rest of the harvest is still usable.
		}
	}
	return reports;
}
