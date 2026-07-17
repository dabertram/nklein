/**
 * F11.2c k-hop ego-graph localization — PURE core.
 *
 * LocAgent/RepoGraph show that handing a small model the ranked k-hop NEIGHBORHOOD around the symbols a task
 * mentions (declarations, users, imports) lifts file localization to ~86–93% — the model reads the right 5 files
 * instead of grepping the repo. !Klein already parses per-file symbols/identifiers/imports for the repo map; this
 * core walks that data as a graph: seeds (task-mentioned symbol names) → their declaration sites (hop 0) → the
 * files that use them, the declarations they use, and the import neighbors (hop 1) → outward to `k`. Output is a
 * ranked, capped list of file(:line) READ TARGETS with an honest `via` story per hop. Deterministic and pure — the
 * workspace scan that assembles `EgoFileFacts` lives with the tool layer.
 *
 * Reference targets carry `line: null` (the repo-map facts record identifier NAMES, not positions) — the agent
 * escalates to `ast_search references` for exact lines within a localized file. That split is deliberate:
 * ego_graph answers WHERE, ast_search answers exactly-which-line.
 */

export interface EgoFileFacts {
	/** Workspace-relative path. */
	readonly path: string;
	/** Symbols this file DECLARES (name + kind + 1-based line). */
	readonly symbols: ReadonlyArray<{ readonly name: string; readonly kind: string; readonly line: number }>;
	/** Identifier names this file references anywhere in its body. */
	readonly referencedIdentifiers: readonly string[];
	/** Workspace-relative paths of files this file imports (already resolved; unresolvable specifiers omitted). */
	readonly importedPaths: readonly string[];
}

export interface EgoGraphTarget {
	readonly path: string;
	/** Declaration line when the target IS a declaration site; null for file-level targets (referencing/importing files). */
	readonly line: number | null;
	/** The symbol that justifies this target, when one does. */
	readonly symbol: string | null;
	/** BFS distance from the seed set (0 = declares/uses a seed directly). */
	readonly hop: number;
	/** Honest one-phrase edge story: why this file is in the neighborhood. */
	readonly via: string;
}

export interface EgoGraphResult {
	readonly targets: EgoGraphTarget[];
	readonly seedsMatched: string[];
	/** Seeds with no declaration AND no reference anywhere in the scanned set (misspelled / non-TS / dynamic). */
	readonly seedsUnmatched: string[];
	readonly truncated: boolean;
	/**
	 * High-fan-out names the expansion PRUNED (generic locals like `lines`, repo-wide utils): following them
	 * floods the neighborhood with distractors — the ContextBench failure mode. Reported, never silent; seeds are
	 * exempt (the user asked for them, however popular).
	 */
	readonly hubNamesPruned: string[];
}

export interface EgoGraphOptions {
	/** Neighborhood radius in hops. Default 2 (the LocAgent sweet spot); clamped to [1, 3]. */
	readonly k?: number;
	/** Overall target cap — BFS order means the closest neighborhood survives truncation. Default 24. */
	readonly maxTargets?: number;
	/** A non-seed name referenced by (or declared in) more than this many files is a HUB — pruned from expansion. Default 8. */
	readonly hubDegreeCap?: number;
}

const DEFAULT_K = 2;
const DEFAULT_MAX_TARGETS = 24;
const DEFAULT_HUB_DEGREE_CAP = 8;

export function buildSymbolEgoGraph(
	seeds: readonly string[],
	files: readonly EgoFileFacts[],
	options: EgoGraphOptions = {},
): EgoGraphResult {
	const k = Math.max(1, Math.min(3, Math.trunc(options.k ?? DEFAULT_K)));
	const maxTargets = Math.max(1, Math.trunc(options.maxTargets ?? DEFAULT_MAX_TARGETS));
	const hubDegreeCap = Math.max(1, Math.trunc(options.hubDegreeCap ?? DEFAULT_HUB_DEGREE_CAP));

	// Indexes over the fact set. Sorted iteration everywhere keeps the walk deterministic regardless of input order.
	const sortedFiles = [...files].sort((left, right) => left.path.localeCompare(right.path));
	const factsByPath = new Map(sortedFiles.map((file) => [file.path, file]));
	const declarationsByName = new Map<string, Array<{ path: string; line: number; kind: string }>>();
	const referencingPathsByName = new Map<string, string[]>();
	const importerPathsByPath = new Map<string, string[]>();
	for (const file of sortedFiles) {
		for (const symbol of file.symbols) {
			const existing = declarationsByName.get(symbol.name) ?? [];
			existing.push({ path: file.path, line: symbol.line, kind: symbol.kind });
			declarationsByName.set(symbol.name, existing);
		}
		for (const name of new Set(file.referencedIdentifiers)) {
			const existing = referencingPathsByName.get(name) ?? [];
			existing.push(file.path);
			referencingPathsByName.set(name, existing);
		}
		for (const imported of file.importedPaths) {
			const existing = importerPathsByPath.get(imported) ?? [];
			existing.push(file.path);
			importerPathsByPath.set(imported, existing);
		}
	}

	const targets: EgoGraphTarget[] = [];
	const seenTargetKeys = new Set<string>();
	const fileHop = new Map<string, number>();
	let truncated = false;
	const addTarget = (target: EgoGraphTarget): void => {
		if (targets.length >= maxTargets) {
			truncated = true;
			return;
		}
		const key = `${target.path}::${target.symbol ?? ""}::${target.line ?? ""}`;
		if (seenTargetKeys.has(key)) {
			return;
		}
		seenTargetKeys.add(key);
		targets.push(target);
	};
	const enterFile = (path: string, hop: number): boolean => {
		const known = fileHop.get(path);
		if (known !== undefined && known <= hop) {
			return false;
		}
		fileHop.set(path, hop);
		return true;
	};
	// Hub prune (LocAgent): a NON-SEED name fanning past the degree cap (referenced by, or declared in, more files
	// than the cap) is infrastructure or a generic local — following it floods the neighborhood with distractors.
	const seedNames = new Set(seeds.map((seed) => seed.trim()).filter((seed) => seed.length > 0));
	const hubNamesPruned = new Set<string>();
	const isHubName = (name: string): boolean => {
		if (seedNames.has(name)) {
			return false;
		}
		const fanOut = referencingPathsByName.get(name)?.length ?? 0;
		const declarationCount = declarationsByName.get(name)?.length ?? 0;
		if (fanOut > hubDegreeCap || declarationCount > hubDegreeCap) {
			hubNamesPruned.add(name);
			return true;
		}
		return false;
	};

	// Hop 0: the seeds' own declaration sites; a declared-nowhere seed still localizes via its referencing files.
	const seedsMatched: string[] = [];
	const seedsUnmatched: string[] = [];
	let frontier: string[] = [];
	const uniqueSeeds = [...new Set(seeds.map((seed) => seed.trim()).filter((seed) => seed.length > 0))];
	for (const seed of uniqueSeeds) {
		const declarations = declarationsByName.get(seed) ?? [];
		const referencingPaths = (referencingPathsByName.get(seed) ?? []).filter(
			(path) => !declarations.some((declaration) => declaration.path === path),
		);
		if (declarations.length === 0 && referencingPaths.length === 0) {
			seedsUnmatched.push(seed);
			continue;
		}
		seedsMatched.push(seed);
		for (const declaration of declarations) {
			addTarget({ path: declaration.path, line: declaration.line, symbol: seed, hop: 0, via: `declares ${seed}` });
			if (enterFile(declaration.path, 0)) {
				frontier.push(declaration.path);
			}
		}
		if (declarations.length === 0) {
			for (const path of referencingPaths) {
				addTarget({
					path,
					line: null,
					symbol: seed,
					hop: 0,
					via: `references ${seed} (declared outside the scan)`,
				});
				if (enterFile(path, 0)) {
					frontier.push(path);
				}
			}
		}
	}

	// BFS outward: each frontier file contributes (a) files referencing its declarations, (b) the declaration
	// sites of identifiers it uses, (c) its import neighbors both directions. Targets stream in BFS order, so the
	// cap keeps the CLOSEST neighborhood.
	for (let hop = 1; hop <= k && frontier.length > 0 && targets.length < maxTargets; hop += 1) {
		const nextFrontier: string[] = [];
		for (const path of frontier) {
			const facts = factsByPath.get(path);
			if (!facts) {
				continue;
			}
			for (const symbol of facts.symbols) {
				if (isHubName(symbol.name)) {
					continue;
				}
				for (const referencingPath of referencingPathsByName.get(symbol.name) ?? []) {
					if (referencingPath === path) {
						continue;
					}
					addTarget({
						path: referencingPath,
						line: null,
						symbol: symbol.name,
						hop,
						via: `references ${symbol.name} (declared in ${path})`,
					});
					if (enterFile(referencingPath, hop)) {
						nextFrontier.push(referencingPath);
					}
				}
			}
			for (const name of new Set(facts.referencedIdentifiers)) {
				if (isHubName(name)) {
					continue;
				}
				for (const declaration of declarationsByName.get(name) ?? []) {
					if (declaration.path === path) {
						continue;
					}
					addTarget({
						path: declaration.path,
						line: declaration.line,
						symbol: name,
						hop,
						via: `declares ${name} (used by ${path})`,
					});
					if (enterFile(declaration.path, hop)) {
						nextFrontier.push(declaration.path);
					}
				}
			}
			for (const imported of facts.importedPaths) {
				addTarget({ path: imported, line: null, symbol: null, hop, via: `imported by ${path}` });
				if (enterFile(imported, hop)) {
					nextFrontier.push(imported);
				}
			}
			for (const importer of importerPathsByPath.get(path) ?? []) {
				addTarget({ path: importer, line: null, symbol: null, hop, via: `imports ${path}` });
				if (enterFile(importer, hop)) {
					nextFrontier.push(importer);
				}
			}
		}
		frontier = nextFrontier;
	}

	return { targets, seedsMatched, seedsUnmatched, truncated, hubNamesPruned: [...hubNamesPruned].sort() };
}
