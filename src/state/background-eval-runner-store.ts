import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths.js";
import type { BackgroundEvalLease } from "../core/background-eval-runner.js";

/**
 * Durable checkpoint for the §5.AI background-eval runner's in-flight leases — the "survives restart" half of
 * `createBackgroundEvalRunner`. The lease set is a snapshot (not an append log), so it's a single JSON file overwritten
 * each tick; a missing or corrupt file reads as an empty set (skip-and-recover, matching the JSONL stores' philosophy).
 * `rootDir` is injectable so tests never touch the real runtime home.
 */

const backgroundEvalLeaseSchema = z.object({
	runId: z.string(),
	project: z.string(),
	workspaceId: z.string().nullable(),
	startedAt: z.number(),
	deadlineAt: z.number(),
});
const backgroundEvalLeasesFileSchema = z.array(backgroundEvalLeaseSchema);

function resolveLeasesPath(rootDir?: string): string {
	const root = rootDir ?? join(resolveNkleinRuntimeHomePath(homedir()), "background-eval-runner");
	return join(root, "leases.json");
}

export async function saveBackgroundEvalRunnerLeases(
	leases: readonly BackgroundEvalLease[],
	options: { rootDir?: string } = {},
): Promise<void> {
	const path = resolveLeasesPath(options.rootDir);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(leases, null, 2)}\n`, "utf8");
}

export async function loadBackgroundEvalRunnerLeases(
	options: { rootDir?: string } = {},
): Promise<BackgroundEvalLease[]> {
	const path = resolveLeasesPath(options.rootDir);
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch {
		return []; // no checkpoint yet (first run)
	}
	try {
		const parsed = backgroundEvalLeasesFileSchema.safeParse(JSON.parse(raw));
		return parsed.success ? parsed.data : [];
	} catch {
		return []; // corrupt checkpoint — recover as empty rather than crash the runner
	}
}
