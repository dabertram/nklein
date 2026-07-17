import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildFrameworkPreamble, detectFrontendFramework } from "../core/frontend-framework-preamble";
import { buildRepoFactSheet } from "../core/repo-fact-sheet";

/**
 * F12.89 + F12.23 effectful leg: read the workspace's package.json (best-effort) once and produce BOTH
 * workspace-stable start-prompt blocks — the terse framework-convention preamble (F12.89) and the repo bootstrap
 * fact-sheet (F12.23: the commands/entry/layout facts a small model otherwise burns its first turns rediscovering).
 * Memoized per workspace path for the process lifetime — both change ~never mid-session, and the memo keeps the
 * per-start cost at zero after the first read. Any read/parse failure ⇒ [] (byte-identical prompts).
 * Kill-switch: NKLEIN_FRAMEWORK_PREAMBLE=0/false/off (covers both blocks — they share the channel).
 */
const preambleByWorkspace = new Map<string, readonly string[]>();

export async function readWorkspaceFrameworkPreamble(
	workspacePath: string | null | undefined,
): Promise<readonly string[]> {
	if (/^(0|false|off)$/i.test(process.env.NKLEIN_FRAMEWORK_PREAMBLE ?? "")) {
		return [];
	}
	const cwd = workspacePath?.trim();
	if (!cwd) {
		return [];
	}
	const cached = preambleByWorkspace.get(cwd);
	if (cached) {
		return cached;
	}
	let preamble: readonly string[] = [];
	try {
		const raw = await readFile(join(cwd, "package.json"), "utf8");
		const parsed = JSON.parse(raw) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};
		const detection = detectFrontendFramework({ ...(parsed.devDependencies ?? {}), ...(parsed.dependencies ?? {}) });
		// F12.23: the fact-sheet reuses the same manifest read; top-level dirs are one readdir (best-effort).
		const topLevelDirs = await readdir(cwd, { withFileTypes: true })
			.then((entries) =>
				entries
					.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules")
					.map((entry) => entry.name),
			)
			.catch(() => [] as string[]);
		const factSheet = buildRepoFactSheet({ packageJsonText: raw, topLevelDirs });
		preamble = [...buildFrameworkPreamble(detection), ...(factSheet.rendered ? [factSheet.rendered] : [])];
	} catch {
		preamble = [];
	}
	preambleByWorkspace.set(cwd, preamble);
	return preamble;
}

/** Test/maintenance hook: clear the per-workspace memo. */
export function clearFrameworkPreambleCache(): void {
	preambleByWorkspace.clear();
}
