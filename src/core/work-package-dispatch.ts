/**
 * Work-package dispatch classifier + parallel-dispatch planner (todo.md §5.AK — parallel-dispatchable architecture +
 * the work-package discipline).
 *
 * WHAT: pure set/graph logic over **work packages** — the bounded, ownership-scoped units §5.AK decomposes work into so
 * substantial pieces can be fanned out to subagents safely and land cleanly (contributor seam), and so !Klein can hand
 * the same contract to its own small-model workers (product mirror — "small local models need this structure even more").
 * A `WorkPackage` carries the §5.AK Work-Package-Contract bounds: a `writeScope` (path globs it may touch), a
 * `forbiddenScope` (globs it must NOT touch — esp. the Red files + docs), and `dependsOn` (prereq packages).
 *
 * WHY: dispatch throughput here is gated by **merge friction and module ownership**, not by a queue library. Before any
 * fan-out you must decide — deterministically — which packages are safe to run in parallel (disjoint scopes → GREEN),
 * which need lead-pre-assigned insertion points (a shared coarse/barrel-ish path → YELLOW), and which must be serialized
 * to one owner (a shared specific write target, or one package writing into another's forbidden scope → RED). This is
 * exactly the §5.AK "module-ownership map — parallel-write safety classes" applied to a concrete package set, plus the
 * dependency-order resolver that batches packages into safe waves.
 *
 * This is the PURE CORE. The runtime dispatcher (Direction 1) and the decompose-emits-work-package-cards path
 * (Direction 2) consume these verdicts; wiring them into an actual subagent fan-out / the decompose card schema is owed
 * separately. Pure + total: no I/O, no throwing on malformed input — every helper returns a structured result.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One bounded, ownership-scoped unit of work — the §5.AK Work-Package Contract's machine-checkable core. */
export interface WorkPackage {
	/** Stable identifier, unique within a dispatch set. */
	readonly id: string;
	/** Path globs this package is allowed to write (the contract's `Write scope`). */
	readonly writeScope: readonly string[];
	/** Path globs this package must NOT touch (the contract's `Forbidden` — Red files + docs). Optional; defaults to none. */
	readonly forbiddenScope?: readonly string[];
	/** Ids of packages that must land BEFORE this one (the contract's prereq/blocked links). Optional; defaults to none. */
	readonly dependsOn?: readonly string[];
}

/**
 * The §5.AK parallel-write safety class for a pair (or, for a whole set, the worst pairwise class):
 * - `green`  — disjoint scopes, safe to fan out in parallel.
 * - `yellow` — overlap only on a low-signal *coarse* path (a manifest / lockfile / repo-root config / barrel index a
 *   decompose model defensively lists on many packages); parallel is possible but needs lead-pre-assigned insertion
 *   points, not two blind writers.
 * - `red` — a genuine conflict: a shared *specific* write target, or one package's write target falls inside another's
 *   forbidden scope. Serialize to one owner at a time.
 */
export type DispatchConflictClass = "green" | "yellow" | "red";

/** Why a pair got its class — the concrete overlapping paths, so the lead can log/act on the exact culprit. */
export interface PackagePairConflict {
	readonly left: string;
	readonly right: string;
	readonly conflictClass: DispatchConflictClass;
	/** Shared *specific* write paths (the Red edit-conflict signal). Sorted, deduped. */
	readonly sharedSpecificPaths: readonly string[];
	/** Shared *coarse* write paths (the Yellow lead-insertion signal). Sorted, deduped. */
	readonly sharedCoarsePaths: readonly string[];
	/** `"<pkg> writes into <other>'s forbidden scope"` findings (also Red). Human-readable, sorted. */
	readonly forbiddenViolations: readonly string[];
}

/** A single well-formedness violation from {@link validateWorkPackages}. */
export interface WorkPackageValidationError {
	readonly kind: "duplicate_id" | "unknown_dependency" | "dependency_cycle" | "escaping_scope" | "empty_scope";
	readonly message: string;
	/** The offending package id (or the id that closes a cycle). */
	readonly packageId: string;
}

/** Result of a full parallel-dispatch plan (validate → dependency waves → parallel sub-groups per wave). */
export interface ParallelDispatchPlan {
	readonly ok: boolean;
	/** Well-formedness violations (empty when `ok`). */
	readonly errors: readonly WorkPackageValidationError[];
	/**
	 * Ordered dependency waves; within each wave, `groups` partitions the packages into parallel-safe sub-groups (no two
	 * package ids in the same group have a Red or Yellow pairwise conflict). Each group can be fanned out at once; groups
	 * within a wave run one-after-another; waves run in order. Empty when `ok` is false.
	 */
	readonly waves: ReadonlyArray<{ readonly groups: readonly (readonly string[])[] }>;
}

// ---------------------------------------------------------------------------
// Scope normalization + coarse-path classification (mirrors task-file-overlap's coarse-vs-specific split, generalized
// from `filesLikelyTouched` basenames to write-scope globs so a repo-root manifest never Red-blocks a wide fan-out).
// ---------------------------------------------------------------------------

/** Normalize a scope glob to a comparison key: trimmed, `./`+leading-`/` stripped, backslashes→`/`, lowercased. */
export function normalizeScopeGlob(glob: string): string {
	return glob
		.trim()
		.replaceAll("\\", "/")
		.replace(/\/+/gu, "/")
		.replace(/^\.\/+/u, "")
		.replace(/^\/+/u, "")
		.replace(/\/+$/u, "")
		.toLowerCase();
}

// Low-signal "coarse" paths a decompose model defensively lists on MANY packages (a dependency manifest, a lockfile, a
// repo-root config, a barrel index) — a shared one of these is not a real edit-conflict signal, so it's Yellow (needs a
// lead insertion point), never Red. Matched by basename. Kept in sync with `task-file-overlap`'s equivalent set.
const COARSE_SCOPE_BASENAMES: ReadonlySet<string> = new Set([
	"package.json",
	"package-lock.json",
	"yarn.lock",
	"pnpm-lock.yaml",
	"tsconfig.json",
	"biome.json",
	".gitignore",
	".npmrc",
	"readme.md",
	"changelog.md",
	"requirements.txt",
	"pyproject.toml",
	"poetry.lock",
	"cargo.toml",
	"cargo.lock",
	"go.mod",
	"go.sum",
	"makefile",
	"dockerfile",
	// Barrel / re-export index files: a shared barrel is a §5.AK Yellow (lead-pre-assigned insertion point), not a Red.
	"index.ts",
	"index.tsx",
	"index.js",
	"mod.ts",
]);

/** True for a low-signal coarse path (manifest / lockfile / repo-root config / barrel index) — Yellow, not Red. */
export function isCoarseScopePath(normalizedGlob: string): boolean {
	const basename = normalizedGlob.split("/").at(-1) ?? normalizedGlob;
	return COARSE_SCOPE_BASENAMES.has(basename) || /^tsconfig\..+\.json$/u.test(basename);
}

/** Does a normalized glob escape its root (a `..` segment)? Such a scope is ill-formed and rejected by validation. */
function scopeEscapesRoot(normalizedGlob: string): boolean {
	return normalizedGlob === ".." || normalizedGlob.startsWith("../") || normalizedGlob.split("/").includes("..");
}

function normalizedScopeSet(scope: readonly string[]): Set<string> {
	const out = new Set<string>();
	for (const glob of scope) {
		const normalized = normalizeScopeGlob(glob);
		if (normalized.length > 0) {
			out.add(normalized);
		}
	}
	return out;
}

/**
 * Whether a write-target glob falls inside a forbidden glob — a directory-prefix containment (not a full glob engine):
 * `a/b` is inside `a` and inside `a/b`, but `ab` is not inside `a`. Both sides are already normalized.
 */
function isWithinForbidden(writeGlob: string, forbiddenGlob: string): boolean {
	return writeGlob === forbiddenGlob || writeGlob.startsWith(`${forbiddenGlob}/`);
}

function sortedIntersection(left: ReadonlySet<string>, right: ReadonlySet<string>): string[] {
	const shared: string[] = [];
	for (const value of left) {
		if (right.has(value)) {
			shared.push(value);
		}
	}
	return shared.sort();
}

// ---------------------------------------------------------------------------
// Pairwise conflict classification
// ---------------------------------------------------------------------------

/**
 * Classify the parallel-write safety of one ordered pair. The class is the WORST finding:
 *   - any shared *specific* write path, or any write-into-forbidden violation → `red`;
 *   - else any shared *coarse* write path → `yellow`;
 *   - else → `green`.
 * Forbidden containment is checked in BOTH directions (either package writing into the other's forbidden scope is Red).
 */
export function classifyPackagePairConflict(left: WorkPackage, right: WorkPackage): PackagePairConflict {
	const leftWrite = normalizedScopeSet(left.writeScope);
	const rightWrite = normalizedScopeSet(right.writeScope);
	const leftForbidden = normalizedScopeSet(left.forbiddenScope ?? []);
	const rightForbidden = normalizedScopeSet(right.forbiddenScope ?? []);

	const sharedAll = sortedIntersection(leftWrite, rightWrite);
	const sharedSpecificPaths = sharedAll.filter((path) => !isCoarseScopePath(path));
	const sharedCoarsePaths = sharedAll.filter((path) => isCoarseScopePath(path));

	const forbiddenViolations: string[] = [];
	for (const writeGlob of leftWrite) {
		for (const forbiddenGlob of rightForbidden) {
			if (isWithinForbidden(writeGlob, forbiddenGlob)) {
				forbiddenViolations.push(
					`${left.id} writes "${writeGlob}" inside ${right.id}'s forbidden "${forbiddenGlob}"`,
				);
			}
		}
	}
	for (const writeGlob of rightWrite) {
		for (const forbiddenGlob of leftForbidden) {
			if (isWithinForbidden(writeGlob, forbiddenGlob)) {
				forbiddenViolations.push(
					`${right.id} writes "${writeGlob}" inside ${left.id}'s forbidden "${forbiddenGlob}"`,
				);
			}
		}
	}
	forbiddenViolations.sort();

	let conflictClass: DispatchConflictClass = "green";
	if (sharedSpecificPaths.length > 0 || forbiddenViolations.length > 0) {
		conflictClass = "red";
	} else if (sharedCoarsePaths.length > 0) {
		conflictClass = "yellow";
	}

	return {
		left: left.id,
		right: right.id,
		conflictClass,
		sharedSpecificPaths,
		sharedCoarsePaths,
		forbiddenViolations,
	};
}

/**
 * Every conflicting pair in a package set (each unordered pair once, left→right in input order). Only Yellow/Red pairs
 * are returned — Green (disjoint) pairs are omitted so the caller sees just the constraints on its fan-out.
 */
export function detectWorkPackageConflicts(packages: readonly WorkPackage[]): PackagePairConflict[] {
	const conflicts: PackagePairConflict[] = [];
	for (let i = 0; i < packages.length; i++) {
		const left = packages[i];
		if (left === undefined) {
			continue;
		}
		for (let j = i + 1; j < packages.length; j++) {
			const right = packages[j];
			if (right === undefined) {
				continue;
			}
			const pair = classifyPackagePairConflict(left, right);
			if (pair.conflictClass !== "green") {
				conflicts.push(pair);
			}
		}
	}
	return conflicts;
}

// ---------------------------------------------------------------------------
// Well-formedness validation (all violations collected — never short-circuits; mirrors validateActionPlan)
// ---------------------------------------------------------------------------

/**
 * Validate a package set's structural integrity before any dispatch:
 *   1. ids are unique;
 *   2. every `dependsOn` id refers to a package that exists in the set;
 *   3. the dependency graph is acyclic (iterative DFS cycle detection);
 *   4. no write/forbidden glob escapes its root (a `..` segment);
 *   5. every package declares at least one non-empty write-scope glob (an unbounded package isn't dispatchable).
 * Returns all violations (empty ⇒ well-formed).
 */
export function validateWorkPackages(packages: readonly WorkPackage[]): WorkPackageValidationError[] {
	const errors: WorkPackageValidationError[] = [];

	const idToIndex = new Map<string, number>();
	for (let i = 0; i < packages.length; i++) {
		const pkg = packages[i];
		if (pkg === undefined) {
			continue;
		}
		if (idToIndex.has(pkg.id)) {
			errors.push({ kind: "duplicate_id", message: `duplicate package id: "${pkg.id}"`, packageId: pkg.id });
		} else {
			idToIndex.set(pkg.id, i);
		}
	}

	for (const pkg of packages) {
		// Check 5: non-empty write scope.
		if (normalizedScopeSet(pkg.writeScope).size === 0) {
			errors.push({
				kind: "empty_scope",
				message: `package "${pkg.id}" has an empty write scope`,
				packageId: pkg.id,
			});
		}
		// Check 4: no escaping scope glob (write or forbidden).
		for (const glob of [...pkg.writeScope, ...(pkg.forbiddenScope ?? [])]) {
			const normalized = normalizeScopeGlob(glob);
			if (normalized.length > 0 && scopeEscapesRoot(normalized)) {
				errors.push({
					kind: "escaping_scope",
					message: `package "${pkg.id}" scope glob "${glob}" escapes its root`,
					packageId: pkg.id,
				});
			}
		}
		// Check 2: every dependency id exists.
		for (const depId of pkg.dependsOn ?? []) {
			if (!idToIndex.has(depId)) {
				errors.push({
					kind: "unknown_dependency",
					message: `package "${pkg.id}" dependsOn unknown id: "${depId}"`,
					packageId: pkg.id,
				});
			}
		}
	}

	// Check 3: cycle detection via iterative DFS, following only edges to known packages (unknowns already reported).
	const adjList = new Map<string, string[]>();
	for (const pkg of packages) {
		adjList.set(
			pkg.id,
			(pkg.dependsOn ?? []).filter((depId) => idToIndex.has(depId)),
		);
	}
	// colour: 0 = unvisited, 1 = on the current DFS path (grey), 2 = fully explored (black).
	const colour = new Map<string, 0 | 1 | 2>();
	for (const pkg of packages) {
		colour.set(pkg.id, 0);
	}
	const reportedCycleNode = new Set<string>();
	for (const pkg of packages) {
		if (colour.get(pkg.id) !== 0) {
			continue;
		}
		const stack: Array<[string, number]> = [[pkg.id, 0]];
		colour.set(pkg.id, 1);
		while (stack.length > 0) {
			const top = stack[stack.length - 1];
			if (top === undefined) {
				break;
			}
			const [nodeId, neighbourIdx] = top;
			const neighbours = adjList.get(nodeId) ?? [];
			if (neighbourIdx >= neighbours.length) {
				colour.set(nodeId, 2);
				stack.pop();
				continue;
			}
			top[1] += 1;
			const neighbourId = neighbours[neighbourIdx];
			if (neighbourId === undefined) {
				continue;
			}
			const neighbourColour = colour.get(neighbourId) ?? 0;
			if (neighbourColour === 1) {
				// Back-edge → cycle. Report the node that closes it, once.
				if (!reportedCycleNode.has(nodeId)) {
					reportedCycleNode.add(nodeId);
					errors.push({
						kind: "dependency_cycle",
						message: `dependency cycle detected: package "${nodeId}" → "${neighbourId}" forms a cycle`,
						packageId: nodeId,
					});
				}
			} else if (neighbourColour === 0) {
				colour.set(neighbourId, 1);
				stack.push([neighbourId, 0]);
			}
		}
	}

	return errors;
}

// ---------------------------------------------------------------------------
// Dependency-order resolution (Kahn topological batching into waves)
// ---------------------------------------------------------------------------

/**
 * Resolve packages into ordered dependency **waves** via Kahn's algorithm: wave 0 = packages with no (in-set)
 * dependency; wave N = packages whose dependencies all landed in earlier waves. Within a wave, ids are sorted for a
 * deterministic result. Returns `null` when the graph is not resolvable (a cycle or an unknown dependency) — call
 * {@link validateWorkPackages} first for the specific reason.
 */
export function resolveDispatchWaves(packages: readonly WorkPackage[]): string[][] | null {
	const ids = new Set(packages.map((pkg) => pkg.id));
	if (ids.size !== packages.length) {
		return null; // duplicate ids — not resolvable as a clean graph
	}
	// In-set dependency edges only; an unknown dependency makes the set unresolvable.
	const deps = new Map<string, Set<string>>();
	for (const pkg of packages) {
		const known = new Set<string>();
		for (const depId of pkg.dependsOn ?? []) {
			if (!ids.has(depId)) {
				return null;
			}
			if (depId !== pkg.id) {
				known.add(depId);
			}
		}
		deps.set(pkg.id, known);
	}

	const waves: string[][] = [];
	const placed = new Set<string>();
	while (placed.size < packages.length) {
		const wave: string[] = [];
		for (const pkg of packages) {
			if (placed.has(pkg.id)) {
				continue;
			}
			const remaining = deps.get(pkg.id) ?? new Set<string>();
			let ready = true;
			for (const depId of remaining) {
				if (!placed.has(depId)) {
					ready = false;
					break;
				}
			}
			if (ready) {
				wave.push(pkg.id);
			}
		}
		if (wave.length === 0) {
			return null; // no progress ⇒ a cycle
		}
		wave.sort();
		for (const id of wave) {
			placed.add(id);
		}
		waves.push(wave);
	}
	return waves;
}

// ---------------------------------------------------------------------------
// Full parallel-dispatch plan
// ---------------------------------------------------------------------------

/**
 * Greedily partition one dependency wave into parallel-safe sub-groups: pack ids into the first existing group that has
 * NO Yellow/Red conflict with any current member; otherwise open a new group. Deterministic (ids arrive pre-sorted from
 * the wave; first-fit). Each returned group can be fanned out at once; groups run one-after-another within the wave.
 */
function partitionWaveIntoParallelGroups(
	waveIds: readonly string[],
	byId: ReadonlyMap<string, WorkPackage>,
): string[][] {
	const groups: string[][] = [];
	for (const id of waveIds) {
		const pkg = byId.get(id);
		if (pkg === undefined) {
			continue;
		}
		let placed = false;
		for (const group of groups) {
			const conflicts = group.some((memberId) => {
				const member = byId.get(memberId);
				return member !== undefined && classifyPackagePairConflict(pkg, member).conflictClass !== "green";
			});
			if (!conflicts) {
				group.push(id);
				placed = true;
				break;
			}
		}
		if (!placed) {
			groups.push([id]);
		}
	}
	return groups;
}

/**
 * The full §5.AK dispatch plan for a package set: validate well-formedness, resolve dependency waves, then split each
 * wave into parallel-safe groups (no two ids in a group have a Yellow/Red write-scope conflict). On any validation
 * error, returns `{ ok: false, errors, waves: [] }` — nothing is dispatched from an ill-formed set.
 */
export function planParallelDispatch(packages: readonly WorkPackage[]): ParallelDispatchPlan {
	const errors = validateWorkPackages(packages);
	if (errors.length > 0) {
		return { ok: false, errors, waves: [] };
	}
	const orderedWaves = resolveDispatchWaves(packages);
	if (orderedWaves === null) {
		// validateWorkPackages passed but the graph is unresolvable — surface a defensive cycle error rather than throw.
		return {
			ok: false,
			errors: [{ kind: "dependency_cycle", message: "dependency graph is not resolvable (cycle)", packageId: "" }],
			waves: [],
		};
	}
	const byId = new Map<string, WorkPackage>(packages.map((pkg) => [pkg.id, pkg]));
	const waves = orderedWaves.map((waveIds) => ({ groups: partitionWaveIntoParallelGroups(waveIds, byId) }));
	return { ok: true, errors: [], waves };
}

/**
 * The worst pairwise conflict class across a whole set (the headline "how parallel is this batch"): `red` if any pair is
 * Red, else `yellow` if any is Yellow, else `green` (fully disjoint — safe blind fan-out).
 */
export function worstConflictClass(packages: readonly WorkPackage[]): DispatchConflictClass {
	let worst: DispatchConflictClass = "green";
	for (const pair of detectWorkPackageConflicts(packages)) {
		if (pair.conflictClass === "red") {
			return "red";
		}
		if (pair.conflictClass === "yellow") {
			worst = "yellow";
		}
	}
	return worst;
}
