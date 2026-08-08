/**
 * P20.2 / P23.5 held-out oracle probe — MERGE-BASE IS THE *MOST RECENT* COMMON ANCESTOR (project 12).
 *
 * ── A TWENTY-SECOND INVARIANT FAMILY: "a" correct answer versus "the" correct answer ──
 * `mergeBase` has a contract — "returns the most-recent common ancestor" — and on a linear or simply-forked
 * history almost any traversal satisfies it, because there is only one common ancestor to find. The distinction
 * between *a* common ancestor and *the most recent* one only appears once a commit has two parents, which is
 * the ordinary shape of any repository that has ever merged.
 *
 * ── THIS PROBE ALSO FAILS THE SPEC'S OWN SUGGESTED ALGORITHM, DELIBERATELY ──
 * The spec's "how to implement" says: collect `ancestors(a)`, then BFS from `b` in level order and return the
 * first hit. That is not the LCA. If `b` reaches an OLD ancestor by a short path and a RECENT one by a long
 * path, level-order BFS reaches the old one first and returns it — a merge base that is too far back, which in
 * a real three-way merge resurfaces changes both sides already agreed on.
 *
 * Grading against the CONTRACT rather than the suggested algorithm is the right call — the contract is the
 * promise the rest of the system consumes — but it is worth stating plainly that a workspace faithfully
 * following the spec's pseudocode will fail this probe. That is a finding about the SPEC, and it is recorded
 * as such rather than hidden inside a red test.
 *
 * Binds only to the spec's prescribed modules (`src/commit-graph.ts`, `src/object-store.ts`).
 * Runs via the HOST's tsx; workspace via NKLEIN_ORACLE_WORKSPACE.
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const workspace = process.env.NKLEIN_ORACLE_WORKSPACE;
if (!workspace) {
	throw new Error("NKLEIN_ORACLE_WORKSPACE is not set — the oracle runner must provide the workspace under grade.");
}

const CANDIDATES = ["src/commit-graph.ts", "src/object-store.ts", "src/git-objects.ts", "src/index.ts"];
const loaded: Record<string, unknown>[] = [];
for (const candidate of CANDIDATES) {
	try {
		loaded.push((await import(pathToFileURL(join(workspace, candidate)).href)) as Record<string, unknown>);
	} catch {
		// Not every candidate exists; the lookup below names what was actually missing.
	}
}
function exported<T>(name: string): T {
	for (const module of loaded) {
		if (typeof module[name] === "function") {
			return module[name] as T;
		}
	}
	throw new Error(`The workspace exports no ${name} — looked in ${CANDIDATES.join(", ")}.`);
}

// biome-ignore lint/suspicious/noExplicitAny: the workspace under grade is untyped by construction.
type Any = any;
const createObjectStore = exported<() => Any>("createObjectStore");
const ancestors = exported<(store: Any, id: string) => Set<string>>("ancestors");
const mergeBase = exported<(store: Any, a: string, b: string) => string | null>("mergeBase");
const isAncestor = exported<(store: Any, candidate: string, of: string) => boolean>("isAncestor");

/**
 * Build a commit graph, returning a name → id map. Commits are stored parents-first so every `put` can
 * reference ids that already exist.
 */
function buildGraph(spec: readonly (readonly [string, readonly string[]])[]) {
	const store = createObjectStore();
	const ids = new Map<string, string>();
	for (const [name, parents] of spec) {
		const id = store.put({
			type: "commit",
			message: name,
			parentIds: parents.map((p) => ids.get(p) as string),
			treeId: "t",
			author: "probe",
			timestamp: 0,
		});
		ids.set(name, id);
	}
	return { store, id: (name: string) => ids.get(name) as string };
}

/**
 * The discriminating shape. `b` is a merge commit whose parents are the OLD root `O` and a commit `L` that
 * descends from the RECENT common ancestor `Y`.
 *
 *     O ──── Y ──── a
 *     │      │
 *     │      L
 *     └──────┴──── b        (b's parents: O and L)
 *
 * Common ancestors of `a` and `b` are {O, Y}; the most recent is **Y**, because Y descends from O. A level-order
 * BFS from `b` reaches O at depth 1 and Y only at depth 2, so it answers O.
 */
const CRISS_CROSS = [
	["O", []],
	["Y", ["O"]],
	["a", ["Y"]],
	["L", ["Y"]],
	["b", ["O", "L"]],
] as const;

test("mergeBase returns the MOST RECENT common ancestor, not the first one a traversal reaches", () => {
	// THE probe. Both O and Y are common ancestors, so returning O is not absurd — it is simply too far back,
	// and a three-way merge from it resurfaces changes both branches already share.
	const { store, id } = buildGraph(CRISS_CROSS);
	const base = mergeBase(store, id("a"), id("b"));
	assert.equal(
		base,
		id("Y"),
		`mergeBase returned ${base === id("O") ? "O, the OLDER common ancestor" : String(base)}; Y is common to both and descends from O, so Y is the most recent`,
	);
});

test("mergeBase is symmetric — the answer cannot depend on argument order", () => {
	// Two orderings of one question. An implementation collecting ancestors of the FIRST argument and walking the
	// second is asymmetric by construction, and a fixture that only ever asks one way cannot see it.
	const { store, id } = buildGraph(CRISS_CROSS);
	assert.equal(
		mergeBase(store, id("a"), id("b")),
		mergeBase(store, id("b"), id("a")),
		"mergeBase gave different answers for (a, b) and (b, a)",
	);
});

test("isAncestor agrees with ancestors() for every pair in the graph", () => {
	// Two functions describing one relation — the same dual-definition check as project 05's FSM. The spec even
	// defines one in terms of the other, so any divergence means they drifted apart.
	const { store, id } = buildGraph(CRISS_CROSS);
	const names = ["O", "Y", "a", "L", "b"];
	for (const of of names) {
		const set = ancestors(store, id(of));
		for (const candidate of names) {
			assert.equal(
				isAncestor(store, id(candidate), id(of)),
				set.has(id(candidate)),
				`isAncestor(${candidate}, ${of}) disagrees with ancestors(${of})`,
			);
		}
	}
});

test("ancestors() includes the commit itself and reaches through BOTH parents of a merge", () => {
	// The spec says "including the commit itself". A traversal following only the FIRST parent — the common
	// shortcut — silently loses an entire side of history, and every linear fixture still passes.
	const { store, id } = buildGraph(CRISS_CROSS);
	const set = ancestors(store, id("b"));
	assert.ok(set.has(id("b")), "ancestors() omitted the commit itself");
	assert.ok(set.has(id("O")), "ancestors() lost the first parent");
	assert.ok(set.has(id("L")), "ancestors() lost the SECOND parent of a merge commit");
	assert.ok(set.has(id("Y")), "ancestors() did not reach through the second parent");
});

test("unrelated histories have NO merge base", () => {
	// Two roots. Returning some arbitrary commit here would make a three-way merge against an unrelated base,
	// which is worse than refusing. The spec's return type allows null precisely for this.
	const { store, id } = buildGraph([
		["r1", []],
		["c1", ["r1"]],
		["r2", []],
		["c2", ["r2"]],
	] as const);
	assert.equal(mergeBase(store, id("c1"), id("c2")), null, "two unrelated histories reported a common ancestor");
});

test("a commit is its own merge base with itself, and with its own descendant", () => {
	// Degenerate cases a real fast-forward check depends on: merging a branch into its own ancestor must resolve
	// to that ancestor, not to something further back.
	const { store, id } = buildGraph(CRISS_CROSS);
	assert.equal(mergeBase(store, id("a"), id("a")), id("a"), "a commit is not its own merge base");
	assert.equal(mergeBase(store, id("Y"), id("a")), id("Y"), "an ancestor is not the merge base of its descendant");
});
