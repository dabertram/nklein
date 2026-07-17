import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildFrameworkPreamble, detectFrontendFramework } from "../core/frontend-framework-preamble";

/**
 * F12.89 effectful leg: read the workspace's package.json (best-effort) and produce the terse framework-convention
 * preamble lines for the start prompt. Memoized per workspace path for the process lifetime — the framework major
 * changes ~never mid-session, and the memo keeps the per-start cost at zero after the first read. Any read/parse
 * failure ⇒ [] (byte-identical prompts). Kill-switch: NKLEIN_FRAMEWORK_PREAMBLE=0/false/off.
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
		preamble = buildFrameworkPreamble(detection);
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
