/**
 * F11.2k monorepo-aware task scoping — PURE core.
 *
 * In a multi-package repo a card's real working context is ONE package: its own scripts govern, its own
 * AGENTS.md/CLAUDE.md instructions apply, and edits outside it are usually scope creep. This core derives that
 * scope from the card's likely files + the repo's known package directories: the deepest package containing ALL
 * the files (root ⇒ no note — root is the default context), an honest spans-packages signal when they cross
 * boundaries (a real smell worth telling the worker, not an error), and the instruction files on the path from
 * the root to the package (root first, so the nearest file is read LAST and wins recency). The workspace scan
 * that supplies `packageDirs`/`instructionFiles` lives with the agent layer.
 */

export interface MonorepoTaskScopeInput {
	/** The card's likely-touched files, workspace-relative. */
	readonly taskFiles: readonly string[];
	/** Directories containing a package.json, workspace-relative ("" = the repo root). */
	readonly packageDirs: readonly string[];
	/** All AGENTS.md / CLAUDE.md paths in the repo, workspace-relative. */
	readonly instructionFiles: readonly string[];
}

export interface MonorepoTaskScope {
	/** The single non-root package dir containing every task file; null when root-scoped or spanning. */
	readonly packageDir: string | null;
	/** The distinct packages the files resolve to when they CROSS boundaries; null otherwise. */
	readonly spansPackages: readonly string[] | null;
	/** Instruction files that govern the scope, outermost first (nearest last — recency wins). */
	readonly instructionFilePaths: readonly string[];
	/** Prompt-ready scope note, or null when there is nothing worth saying (root-scoped single-package repo). */
	readonly note: string | null;
}

/** The deepest package dir that is a path prefix of `file` ("" always matches as the root). */
function packageDirForFile(file: string, packageDirs: readonly string[]): string {
	let best = "";
	for (const dir of packageDirs) {
		if (dir !== "" && (file === dir || file.startsWith(`${dir}/`)) && dir.length > best.length) {
			best = dir;
		}
	}
	return best;
}

export function deriveMonorepoTaskScope(input: MonorepoTaskScopeInput): MonorepoTaskScope {
	const files = [...new Set(input.taskFiles.map((file) => file.trim()).filter((file) => file.length > 0))];
	const none: MonorepoTaskScope = { packageDir: null, spansPackages: null, instructionFilePaths: [], note: null };
	if (files.length === 0 || input.packageDirs.length === 0) {
		return none;
	}
	const resolved = [...new Set(files.map((file) => packageDirForFile(file, input.packageDirs)))].sort();
	const instructionFilesFor = (packageDir: string): string[] => {
		const governing = input.instructionFiles.filter((path) => {
			const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
			return dir === "" || packageDir === dir || packageDir.startsWith(`${dir}/`);
		});
		// Outermost first: nearest instructions render LAST, closest to the task text (recency wins).
		return [...governing].sort((left, right) => left.length - right.length);
	};

	if (resolved.length > 1) {
		const spanning = resolved.map((dir) => (dir === "" ? "(root)" : dir));
		return {
			packageDir: null,
			spansPackages: resolved,
			instructionFilePaths: [],
			note: [
				`[Monorepo scope] This card's files SPAN packages: ${spanning.join(", ")}.`,
				"Cross-package changes are usually scope creep for one card — check whether the task really needs all of them; each package has its own scripts and checks.",
			].join("\n"),
		};
	}
	const packageDir = resolved[0] ?? "";
	if (packageDir === "") {
		// Root-scoped: the default context — nothing worth a note.
		return none;
	}
	const instructionFilePaths = instructionFilesFor(packageDir);
	return {
		packageDir,
		spansPackages: null,
		instructionFilePaths,
		note: [
			`[Monorepo scope] Your working package is \`${packageDir}\` — its own package.json scripts govern builds/tests/lint there (root scripts may not cover it).`,
			...(instructionFilePaths.length > 0
				? [
						`Instructions that govern this scope (outermost first): ${instructionFilePaths.join(", ")} — read the nearest one.`,
					]
				: []),
		].join("\n"),
	};
}
