/**
 * F11.2k workspace scan for monorepo task scoping: find every package.json directory and every
 * AGENTS.md/CLAUDE.md in the workspace (bounded depth, node_modules/.git/dist skipped), memoized per workspace —
 * one walk serves every card start. The derivation over these facts is the pure core (`monorepo-task-scope`).
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";

export interface MonorepoScanFacts {
	/** Directories containing a package.json, workspace-relative ("" = root). */
	readonly packageDirs: readonly string[];
	/** All AGENTS.md / CLAUDE.md paths, workspace-relative. */
	readonly instructionFiles: readonly string[];
}

const SCAN_MAX_DEPTH = 4;
const SKIPPED_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".git", ".nklein"]);
const INSTRUCTION_FILE_NAMES = new Set(["AGENTS.md", "CLAUDE.md"]);

const factsByWorkspace = new Map<string, MonorepoScanFacts>();

async function walk(
	root: string,
	relativeDir: string,
	depth: number,
	packageDirs: string[],
	instructionFiles: string[],
): Promise<void> {
	const entries = await readdir(join(root, relativeDir), { withFileTypes: true }).catch(() => []);
	const subDirs: string[] = [];
	for (const entry of entries) {
		const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
		if (entry.isFile()) {
			if (entry.name === "package.json") {
				packageDirs.push(relativeDir);
			} else if (INSTRUCTION_FILE_NAMES.has(entry.name)) {
				instructionFiles.push(relativePath);
			}
		} else if (entry.isDirectory() && !entry.name.startsWith(".") && !SKIPPED_DIRS.has(entry.name)) {
			subDirs.push(relativePath);
		}
	}
	if (depth < SCAN_MAX_DEPTH) {
		for (const subDir of subDirs) {
			await walk(root, subDir, depth + 1, packageDirs, instructionFiles);
		}
	}
}

/** Scan (memoized per workspace). Best-effort: unreadable trees yield empty facts, never an error. */
export async function scanMonorepoFacts(workspacePath: string): Promise<MonorepoScanFacts> {
	const cached = factsByWorkspace.get(workspacePath);
	if (cached) {
		return cached;
	}
	const packageDirs: string[] = [];
	const instructionFiles: string[] = [];
	await walk(workspacePath, "", 0, packageDirs, instructionFiles).catch(() => undefined);
	const facts: MonorepoScanFacts = { packageDirs, instructionFiles };
	factsByWorkspace.set(workspacePath, facts);
	return facts;
}

/** Test/maintenance hook: clear the per-workspace memo. */
export function clearMonorepoScanMemo(): void {
	factsByWorkspace.clear();
}
