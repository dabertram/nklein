import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { lockedFileSystem } from "../fs/locked-file-system";
import { NKLEIN_DEV_TEST_PROJECT_MARKER_PATH } from "../nklein-agent/nklein-dev-test-project";
import { resolveWorkspacePath } from "../state/workspace-state";

export async function isMarkedDevTestWorkspaceEntry(entry: {
	workspaceId: string;
	repoPath: string;
	gitRepositoryCreatedByKanban: boolean;
}): Promise<boolean> {
	if (!entry.gitRepositoryCreatedByKanban) {
		return false;
	}
	try {
		const rawMarker = await readFile(join(entry.repoPath, NKLEIN_DEV_TEST_PROJECT_MARKER_PATH), "utf8");
		const parsed = JSON.parse(rawMarker) as { createdBy?: unknown };
		return parsed.createdBy === "nklein-dev-test";
	} catch {
		return false;
	}
}

export async function resolveGitRootIfAvailable(path: string): Promise<string | null> {
	try {
		return await resolveWorkspacePath(path);
	} catch {
		return null;
	}
}

let kleinSourceRepoPathPromise: Promise<string | null> | undefined;
/**
 * The git root of !Klein's OWN source checkout — resolved from where THIS module's code lives, not the server's cwd.
 * The self-improvement guard ("this is !Klein's own source repository") must identify the repo by where !Klein's code
 * is installed, independent of where the server happens to run. Keying it off `serverCwd` was wrong: in dev (server run
 * from the repo) it would refuse to add ANY project whose path equals the repo, and more subtly it would never let the
 * launch-from-project flow register a project (the `task-command-exit` 4th-case red). Resolving from `import.meta.url`
 * flags the repo only when the repo itself is added (the genuine self-improvement case), and returns null for a packaged
 * (non-git) npm install — nothing to guard. Cached: the install location never changes within a process.
 */
export function resolveKleinSourceRepoPath(): Promise<string | null> {
	if (!kleinSourceRepoPathPromise) {
		kleinSourceRepoPathPromise = resolveGitRootIfAvailable(dirname(fileURLToPath(import.meta.url)));
	}
	return kleinSourceRepoPathPromise;
}

export async function readEvidenceBundleBaseCommit(
	evidenceBundlePath: string | null | undefined,
): Promise<string | null> {
	const bundlePath = evidenceBundlePath?.trim();
	if (!bundlePath) {
		return null;
	}
	try {
		const raw = await readFile(join(bundlePath, "config-snapshot.json"), "utf8");
		const parsed = JSON.parse(raw) as { baseCommit?: unknown };
		const baseCommit = typeof parsed.baseCommit === "string" ? parsed.baseCommit.trim() : "";
		return /^[0-9a-f]{7,40}$/iu.test(baseCommit) ? baseCommit : null;
	} catch {
		return null;
	}
}

export function isJsonRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

export async function listPlanArtifactDirectoryNames(workspacePath: string): Promise<string[]> {
	const plansPath = join(workspacePath, ".nklein", "nklein", "plans");
	const entries = await readdir(plansPath, { withFileTypes: true }).catch(() => []);
	return entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort((left, right) => left.localeCompare(right));
}

export async function updateMigratedArtifactMetadata(input: {
	artifactPath: string;
	parentWorkspaceId: string;
	parentWorkspacePath: string;
	sourceTaskId: string | null;
}): Promise<void> {
	const metadataPath = join(input.artifactPath, "artifact.json");
	const raw = await readFile(metadataPath, "utf8").catch(() => null);
	if (!raw) {
		return;
	}
	const parsed = JSON.parse(raw) as unknown;
	if (!isJsonRecord(parsed)) {
		return;
	}
	const metadata = {
		...parsed,
		workspaceId: input.parentWorkspaceId,
		workspacePath: input.parentWorkspacePath,
		sourceTaskId:
			typeof parsed.sourceTaskId === "string" && parsed.sourceTaskId.trim()
				? parsed.sourceTaskId
				: input.sourceTaskId,
		updatedAt: Date.now(),
	};
	await lockedFileSystem.writeJsonFileAtomic(metadataPath, metadata, { lock: null });
}
