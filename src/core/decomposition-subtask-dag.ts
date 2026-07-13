/**
 * Decomposition subtask-DAG structural validator (todo §5.B — decomposition quality & the knowledge-expansion loop).
 *
 * WHAT: pure graph logic over a set of **decomposed subtasks** connected by `dependsOn` prerequisite edges — the
 * structural skeleton a decompose step emits before any card runs. It collects EVERY structural defect in one pass —
 * duplicate ids, dangling (unknown) dependencies, self-dependencies, dependency cycles (with the actual node path that
 * closes each), and structurally-disconnected subtasks — plus a small structural summary (roots / sources / weakly-
 * connected component count / max depth) that a re-decompose trigger can read.
 *
 * WHY: the decomposition path already gates two things but leaves a real hole between them. `validateTaskGraphReferences`
 * (in `nklein-agent/decomposition/plan-task-validation.ts`) THROWS on the *first* duplicate/unknown-dependency it meets —
 * so a genuine A→B→A **cycle passes silently** (nothing there detects a back-edge), and an operator only ever sees the
 * first reference error, not all of them. `assessNKleinPlanTaskGraphQuality` (in `nklein-agent/nklein-decomposition-
 * graph-quality.ts`) adds *semantic* coherence heuristics (a test card must depend on the code it verifies, reversed
 * edges, sparsity warnings) but is not a structural DAG check: it never asks "is this even acyclic / connected". A
 * decompose model that emits a mutually-recursive pair, or splits a goal into two disconnected islands, sails past both.
 * This module is that missing structural gate — the exact "subtask-DAG validator (cycle/orphan/dangling-dep detection)"
 * the §5.B backlog calls for, kept PURE and total so "given these subtasks, what is structurally wrong + what does the
 * shape look like" is unit-testable with no runtime, no I/O, no model, and no dependency on the SDK plan-artifact types.
 *
 * Design choices (mirroring the sibling structural validators `action-plan-ir.ts` §5.O and `work-package-dispatch.ts`
 * §5.AK, which each define their own plain input type rather than coupling to a wire schema):
 *   - Inputs are INJECTED plain values: a `DecomposedSubtask` is just `{ id, dependsOn }` (+ an optional `title` used
 *     only to make messages friendlier). An `NKleinPlanTask`, a work-package, or any subtask record maps to it 1:1, so
 *     this core stays in the lower `core` layer with no import from `nklein-agent`.
 *   - NEVER throws + collects ALL defects in one pass (the "no fix-validate-fix cycle" philosophy shared with
 *     `validateActionPlan`): the caller shows every problem at once instead of bouncing the model one error at a time.
 *   - Cycle detection is iterative-DFS colouring (grey/black), like `action-plan-ir.ts`, but reconstructs and reports the
 *     ACTUAL cycle node path (`a → b → a`) from the DFS stack — more actionable than "an edge forms a cycle".
 *   - "Disconnected" and the component count treat edges as **undirected** (weak connectivity): a decompose that produced
 *     two islands of work that share no prerequisite in either direction is a structural smell worth surfacing, distinct
 *     from the direction-aware roots/sources.
 *   - `dependsOn` semantics: `A.dependsOn` lists the subtasks that must finish BEFORE A. So a **source** has no
 *     dependencies (starts first) and a **root** is depended on by nobody (the deliverable finished last). Both are
 *     reported for the re-decompose trigger (e.g. many disjoint roots ⇒ possibly missing an integrating card).
 */

/**
 * The structural essence of one decomposed subtask — the only fields the DAG shape depends on. Injected as a plain
 * value; a richer record (an `NKleinPlanTask`, a work-package) is passed by projecting to this shape.
 */
export interface DecomposedSubtask {
	/** Stable identifier, expected unique within the decomposition. */
	readonly id: string;
	/** Ids of subtasks that must complete BEFORE this one. Optional; treated as `[]` when absent. */
	readonly dependsOn?: readonly string[];
	/** Optional human label, used only to make defect messages friendlier (never affects the verdict). */
	readonly title?: string;
}

/** The kind of a single structural defect, ordered coarse → fine for stable, predictable messaging. */
export type SubtaskDagDefectKind =
	/** Two subtasks share an id (the graph is ambiguous — later refs are unresolvable). */
	| "duplicate_id"
	/** A `dependsOn` id refers to no subtask in the set (a dangling prerequisite). */
	| "unknown_dependency"
	/** A subtask lists itself in `dependsOn` (a degenerate 1-node cycle — it can never start). */
	| "self_dependency"
	/** A directed cycle among subtasks (they mutually block — none can ever start). */
	| "dependency_cycle"
	/** In a multi-subtask decomposition, a subtask with no edge in EITHER direction (an isolated island). */
	| "disconnected_subtask";

/** One structural problem found by {@link validateSubtaskDag}. Human-readable + machine-actionable. */
export interface SubtaskDagDefect {
	readonly kind: SubtaskDagDefectKind;
	/** A ready-to-surface, single-line explanation naming the offending id(s) + the repair. */
	readonly message: string;
	/** The primary offending subtask id (the id that closes a cycle, the duplicate, the dangling holder, …). */
	readonly subtaskId: string;
	/**
	 * Other ids implicated in this defect: for `dependency_cycle` the full ordered node path that closes the cycle
	 * (e.g. `["a","b","a"]`); for `unknown_dependency` the missing dependency id; empty otherwise.
	 */
	readonly relatedIds: readonly string[];
}

/** The full structural report: the verdict + every defect + the shape summary a re-decompose trigger reads. */
export interface SubtaskDagReport {
	/** True iff no structural defect was found (the DAG is well-formed: unique ids, resolvable deps, acyclic, connected). */
	readonly ok: boolean;
	/** Every structural defect, collected in one pass (never short-circuits). */
	readonly defects: readonly SubtaskDagDefect[];
	/** Number of subtasks (distinct positions, including any duplicate-id entries). */
	readonly subtaskCount: number;
	/** Number of directed dependency edges to KNOWN subtasks (unknown-dep + self-dep edges excluded). */
	readonly dependencyCount: number;
	/** Distinct node paths of each detected cycle (each path repeats its entry id at the end, e.g. `["a","b","a"]`). */
	readonly cycles: readonly (readonly string[])[];
	/** Ids depended on by nobody — the deliverables that finish last (direction-aware). Sorted. */
	readonly rootIds: readonly string[];
	/** Ids with no (known) dependency — the subtasks that can start first (direction-aware). Sorted. */
	readonly sourceIds: readonly string[];
	/** Ids with no edge in either direction, in a multi-subtask graph — the isolated islands. Sorted. */
	readonly disconnectedIds: readonly string[];
	/** Number of weakly-connected components (islands) over the known-edge graph; >1 ⇒ the work split into islands. */
	readonly componentCount: number;
	/** Longest dependency chain length in nodes over the acyclic known-edge graph (0 when empty; 1 for a lone node). */
	readonly maxDepth: number;
}

/** DFS colour used for cycle detection: unvisited / in the current path (grey) / fully explored (black). */
type DfsColour = 0 | 1 | 2;

/** Normalise a subtask's dependency list to a defensive array (absent ⇒ empty). */
function dependenciesOf(subtask: DecomposedSubtask): readonly string[] {
	return subtask.dependsOn ?? [];
}

/** A short "id (\"title\")" label when a title is present, else just the id — for friendlier messages. */
function labelOf(id: string, titleById: ReadonlyMap<string, string | undefined>): string {
	const title = titleById.get(id);
	return title && title.trim().length > 0 ? `${id} ("${title.trim()}")` : id;
}

/**
 * Validate the STRUCTURE of a set of decomposed subtasks connected by `dependsOn` edges.
 *
 * Pure + total: no I/O, never throws on malformed input, and collects EVERY defect in a single pass so the caller can
 * present all of them at once. Also returns the structural shape summary (roots / sources / disconnected islands /
 * component count / max depth) even when defects exist — a re-decompose trigger reads it to decide split/merge/redo.
 *
 * Checks (all collected, never short-circuits):
 *   1. Ids are unique (each id after the first occurrence is a `duplicate_id`).
 *   2. Every `dependsOn` id resolves to a subtask in the set (else `unknown_dependency`).
 *   3. No subtask depends on itself (`self_dependency` — reported distinctly from a multi-node cycle so the repair is
 *      "remove the self-edge", not "break the cycle").
 *   4. The directed dependency graph (over KNOWN, non-self edges) is acyclic (else one `dependency_cycle` per distinct
 *      cycle, each carrying the actual node path).
 *   5. In a multi-subtask decomposition, no subtask is disconnected (no edge in either direction ⇒ `disconnected_subtask`).
 *
 * @param subtasks the decomposed subtasks to check (order is irrelevant; results are deterministic + stably sorted).
 */
export function validateSubtaskDag(subtasks: readonly DecomposedSubtask[]): SubtaskDagReport {
	const defects: SubtaskDagDefect[] = [];

	// ---- Pass 1: identity — unique ids, and the canonical id set (first occurrence wins). ----
	const knownIds = new Set<string>();
	const titleById = new Map<string, string | undefined>();
	for (const subtask of subtasks) {
		if (knownIds.has(subtask.id)) {
			defects.push({
				kind: "duplicate_id",
				message: `Duplicate subtask id "${subtask.id}"; ids must be unique so dependency edges resolve unambiguously.`,
				subtaskId: subtask.id,
				relatedIds: [],
			});
			continue;
		}
		knownIds.add(subtask.id);
		titleById.set(subtask.id, subtask.title);
	}

	// ---- Pass 2: edges — build the known-edge adjacency while reporting unknown-dep + self-dep edges. ----
	// The graph used for cycle/connectivity analysis follows ONLY edges to known, non-self targets. Duplicate-id
	// entries are collapsed onto the first occurrence (they share the id) — so we deduplicate edges per source id and
	// process each canonical id once, in first-seen order, for deterministic output.
	const dependsOnKnown = new Map<string, string[]>(); // source id → deduped known, non-self dependency ids
	const seenSourceIds = new Set<string>();
	const orderedIds: string[] = []; // canonical ids in first-seen order (drives all sorted-independent iteration)
	let dependencyCount = 0;

	for (const subtask of subtasks) {
		if (seenSourceIds.has(subtask.id)) {
			continue; // a duplicate-id entry: its edges belong to the same node, already recorded from the first occurrence
		}
		seenSourceIds.add(subtask.id);
		orderedIds.push(subtask.id);

		const known: string[] = [];
		const seenDep = new Set<string>();
		for (const dependencyId of dependenciesOf(subtask)) {
			if (dependencyId === subtask.id) {
				defects.push({
					kind: "self_dependency",
					message: `Subtask ${labelOf(subtask.id, titleById)} depends on itself; remove the self-edge (a subtask cannot be its own prerequisite).`,
					subtaskId: subtask.id,
					relatedIds: [],
				});
				continue;
			}
			if (!knownIds.has(dependencyId)) {
				defects.push({
					kind: "unknown_dependency",
					message: `Subtask ${labelOf(subtask.id, titleById)} depends on unknown subtask "${dependencyId}"; add that subtask or fix the id.`,
					subtaskId: subtask.id,
					relatedIds: [dependencyId],
				});
				continue;
			}
			if (seenDep.has(dependencyId)) {
				continue; // a repeated edge to the same known dep — count + traverse it once
			}
			seenDep.add(dependencyId);
			known.push(dependencyId);
			dependencyCount += 1;
		}
		dependsOnKnown.set(subtask.id, known);
	}

	// ---- Pass 3: cycle detection (iterative DFS colouring) over the known-edge graph, reconstructing each path. ----
	const cycles = detectCycles(orderedIds, dependsOnKnown);
	for (const path of cycles) {
		// The id that closes the cycle is the repeated endpoint (path[last] === path[first-in-the-loop]); report on it.
		const closingId = path[path.length - 1] ?? "";
		defects.push({
			kind: "dependency_cycle",
			message: `Dependency cycle among subtasks: ${path.join(" → ")}. These block each other and none can start; break the cycle by removing an edge.`,
			subtaskId: closingId,
			relatedIds: path,
		});
	}

	// ---- Direction-aware roots/sources over the known-edge graph. ----
	const hasIncoming = new Set<string>(); // ids some other subtask depends on
	for (const source of orderedIds) {
		for (const dependencyId of dependsOnKnown.get(source) ?? []) {
			hasIncoming.add(dependencyId);
		}
	}
	const sourceIds = orderedIds.filter((id) => (dependsOnKnown.get(id) ?? []).length === 0);
	const rootIds = orderedIds.filter((id) => !hasIncoming.has(id));

	// ---- Weak connectivity: components + disconnected islands over the UNDIRECTED known-edge graph. ----
	const { componentCount, disconnectedIds } = computeWeakConnectivity(orderedIds, dependsOnKnown);
	if (orderedIds.length > 1) {
		for (const id of disconnectedIds) {
			defects.push({
				kind: "disconnected_subtask",
				message: `Subtask ${labelOf(id, titleById)} has no dependency edge in either direction; connect it to the work it needs or that needs it, or confirm it is genuinely standalone.`,
				subtaskId: id,
				relatedIds: [],
			});
		}
	}

	// ---- Longest dependency chain (only meaningful when acyclic; skip when cycles were found). ----
	const maxDepth = cycles.length > 0 ? 0 : longestChainLength(orderedIds, dependsOnKnown);

	return {
		ok: defects.length === 0,
		defects,
		subtaskCount: subtasks.length,
		dependencyCount,
		cycles,
		rootIds: [...rootIds].sort(),
		sourceIds: [...sourceIds].sort(),
		disconnectedIds: orderedIds.length > 1 ? [...disconnectedIds].sort() : [],
		componentCount,
		maxDepth,
	};
}

/**
 * Detect every distinct directed cycle reachable in the known-edge graph via iterative-DFS colouring, reconstructing
 * the actual node path that closes each cycle from the live DFS stack. Deterministic: nodes are visited in `orderedIds`
 * order and each cycle is reported once (keyed by its normalised rotation).
 */
function detectCycles(orderedIds: readonly string[], adjacency: ReadonlyMap<string, readonly string[]>): string[][] {
	const colour = new Map<string, DfsColour>();
	for (const id of orderedIds) {
		colour.set(id, 0);
	}
	const cycles: string[][] = [];
	const reportedCycleKeys = new Set<string>();

	for (const start of orderedIds) {
		if (colour.get(start) !== 0) {
			continue;
		}
		// Stack entries: [nodeId, nextNeighbourIndex]. A parallel `path` array holds the current grey chain so we can
		// slice out the exact cycle when a back-edge is found.
		const stack: Array<[string, number]> = [[start, 0]];
		const path: string[] = [start];
		colour.set(start, 1);

		while (stack.length > 0) {
			const top = stack[stack.length - 1];
			if (top === undefined) {
				break;
			}
			const [nodeId, neighbourIdx] = top;
			const neighbours = adjacency.get(nodeId) ?? [];

			if (neighbourIdx >= neighbours.length) {
				colour.set(nodeId, 2); // fully explored — black — and pop it off the current path
				stack.pop();
				path.pop();
				continue;
			}
			top[1] += 1; // advance this node's neighbour pointer before recursing

			const neighbourId = neighbours[neighbourIdx];
			if (neighbourId === undefined) {
				continue;
			}
			const neighbourColour = colour.get(neighbourId) ?? 0;
			if (neighbourColour === 1) {
				// Back-edge into the current grey path → a cycle from `neighbourId` … `nodeId` → `neighbourId`.
				const loopStart = path.lastIndexOf(neighbourId);
				if (loopStart >= 0) {
					const loop = [...path.slice(loopStart), neighbourId];
					const key = normaliseCycleKey(loop);
					if (!reportedCycleKeys.has(key)) {
						reportedCycleKeys.add(key);
						cycles.push(loop);
					}
				}
			} else if (neighbourColour === 0) {
				colour.set(neighbourId, 1);
				stack.push([neighbourId, 0]);
				path.push(neighbourId);
			}
			// black (2): already fully explored on a finished path — safe, not a cycle.
		}
	}
	return cycles;
}

/**
 * A rotation-invariant key for a cycle path (which repeats its entry id at the end), so the same cycle discovered from
 * different DFS entry points is reported once. Rotates the id-list (dropping the duplicated tail) to start at its
 * lexicographically smallest id.
 */
function normaliseCycleKey(loop: readonly string[]): string {
	const nodes = loop.slice(0, -1); // drop the repeated closing id
	if (nodes.length === 0) {
		return "";
	}
	let minIndex = 0;
	for (let i = 1; i < nodes.length; i += 1) {
		const candidate = nodes[i];
		const current = nodes[minIndex];
		if (candidate !== undefined && current !== undefined && candidate < current) {
			minIndex = i;
		}
	}
	const rotated = [...nodes.slice(minIndex), ...nodes.slice(0, minIndex)];
	return rotated.join("\u0000");
}

/**
 * Weak-connectivity analysis over the UNDIRECTED known-edge graph via union-find: how many components (islands) the
 * subtasks form, and — in a multi-subtask graph — which ids sit alone with no edge in either direction.
 */
function computeWeakConnectivity(
	orderedIds: readonly string[],
	adjacency: ReadonlyMap<string, readonly string[]>,
): { componentCount: number; disconnectedIds: string[] } {
	const parent = new Map<string, string>();
	for (const id of orderedIds) {
		parent.set(id, id);
	}
	const find = (id: string): string => {
		let root = id;
		while (parent.get(root) !== root) {
			const next = parent.get(root);
			if (next === undefined) {
				break;
			}
			root = next;
		}
		// Path-compress for near-constant amortised cost.
		let node = id;
		while (parent.get(node) !== root) {
			const next = parent.get(node);
			if (next === undefined) {
				break;
			}
			parent.set(node, root);
			node = next;
		}
		return root;
	};
	const union = (a: string, b: string): void => {
		const rootA = find(a);
		const rootB = find(b);
		if (rootA !== rootB) {
			parent.set(rootA, rootB);
		}
	};

	const hasEdge = new Set<string>();
	for (const source of orderedIds) {
		for (const target of adjacency.get(source) ?? []) {
			union(source, target); // undirected: an edge in either direction connects both
			hasEdge.add(source);
			hasEdge.add(target);
		}
	}

	const roots = new Set<string>();
	for (const id of orderedIds) {
		roots.add(find(id));
	}
	const disconnectedIds = orderedIds.filter((id) => !hasEdge.has(id));
	return { componentCount: roots.size, disconnectedIds };
}

/**
 * The longest dependency chain length in nodes over the (assumed acyclic) known-edge graph, via memoised DFS. Returns 0
 * for an empty set and 1 for a set of lone nodes. Only called when no cycle was found (so recursion always terminates).
 */
function longestChainLength(orderedIds: readonly string[], adjacency: ReadonlyMap<string, readonly string[]>): number {
	const memo = new Map<string, number>();
	const depthFrom = (id: string): number => {
		const cached = memo.get(id);
		if (cached !== undefined) {
			return cached;
		}
		let best = 1;
		for (const target of adjacency.get(id) ?? []) {
			best = Math.max(best, 1 + depthFrom(target));
		}
		memo.set(id, best);
		return best;
	};
	let max = 0;
	for (const id of orderedIds) {
		max = Math.max(max, depthFrom(id));
	}
	return max;
}
