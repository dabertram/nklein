/**
 * Which test files EXERCISE a source module — the one answer, shared.
 *
 * `scripts/ablate.mts` needed this to pair a module with a test selection; the P20.3b delivery seam needs the
 * same answer to decide whether a card earns an ablation. Two implementations of "which tests exercise this
 * module" is the N17 shape: they would drift, and the day they disagree neither can be trusted — one would call
 * a module unexercised while the other measured it.
 *
 * ── WHY THE CONVENTION IS A CONVENIENCE, NOT A MEASUREMENT ──
 * Pairing `src/<dir>/<name>.ts` with `test/runtime/<dir>/<name>.test.ts` is fast and usually right. Taken as
 * the whole answer it lies: an early sweep reported "144 modules have no matching test" — read by anyone as 144
 * UNTESTED modules — when 6 of the first 8 were tested under a different filename. So a miss falls back to
 * whichever test files actually IMPORT the module, and only a module nothing imports is reported unexercised.
 *
 * IO is INJECTED rather than imported, following the `runGit` pattern used by the git cores: the decision is
 * testable without a filesystem, and the two callers cannot diverge on the rule while sharing the plumbing.
 */

export interface ExercisingTestLookup {
	/** True when the path exists on disk. */
	readonly fileExists: (path: string) => boolean | Promise<boolean>;
	/**
	 * Test files that import `moduleSpecifier` (e.g. `core/foo"`, quote included so a prefix cannot match a
	 * longer sibling name). Returns an empty list when nothing imports it — never throws for "no matches".
	 */
	readonly findImportingTests: (moduleSpecifier: string) => readonly string[] | Promise<readonly string[]>;
}

/** The conventional test path for a source module, or null when the module is not under `src/`. */
export function conventionalTestPath(modulePath: string): string | null {
	if (!modulePath.startsWith("src/") || !modulePath.endsWith(".ts")) {
		return null;
	}
	const withoutPrefix = modulePath.slice("src/".length, -".ts".length);
	return `test/runtime/${withoutPrefix}.test.ts`;
}

/**
 * Resolve the tests that exercise a module: the conventional path when it exists, else every test that imports
 * the module, else an empty list — which is the ONLY honest way to report "nothing exercises this".
 */
export async function resolveExercisingTests(
	modulePath: string,
	lookup: ExercisingTestLookup,
): Promise<readonly string[]> {
	const conventional = conventionalTestPath(modulePath);
	if (conventional !== null && (await lookup.fileExists(conventional))) {
		return [conventional];
	}
	if (conventional === null) {
		return [];
	}
	// The trailing quote is part of the specifier on purpose: without it `core/task-result-branch` would match
	// every importer of `core/task-result-branch-naming`, and the pairing would silently widen.
	const specifier = `${modulePath.slice("src/".length, -".ts".length)}"`;
	const importers = await lookup.findImportingTests(specifier);
	return importers.filter((path) => path.endsWith(".test.ts"));
}
