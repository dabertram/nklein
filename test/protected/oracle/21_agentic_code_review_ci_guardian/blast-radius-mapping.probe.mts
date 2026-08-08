/**
 * P20.2 / P23.5 held-out oracle probe — CROSS-ARTIFACT CORRESPONDENCE (project 21).
 *
 * ── A FIFTH INVARIANT FAMILY ──
 * Conservation (18, 04), independence (27), determinism (32) and authorization (02) all live inside one
 * artifact. This one is about two artifacts having to AGREE: diff hunks carry line ranges, symbols carry line
 * ranges, and the guardian's whole value is the correspondence between them. The spec's visible acceptance for
 * that correspondence is a single fully-contained case — a hunk at lines 40–45 against a symbol at 38–50 — and
 * for the blast radius, a 3-node chain. Neither shape can expose an off-by-one at a touching boundary, a mapper
 * that ignores `filePath`, or a reverse-BFS with no visited set.
 *
 * That last one matters most: circular imports are ordinary in real TypeScript, and a chain fixture can never
 * catch a traversal that loops forever on one. A CI guardian that hangs on a cyclic import graph fails exactly
 * when it is most needed.
 *
 * Binds only to the spec's prescribed modules (`src/diff/changed-line-mapper.ts`, `src/diff/dependency-graph.ts`).
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

const moduleAt = async (relativePath: string) => await import(pathToFileURL(join(workspace, relativePath)).href);
const { mapHunksToSymbols } = await moduleAt("src/diff/changed-line-mapper.ts");
const { DependencyGraph } = await moduleAt("src/diff/dependency-graph.ts");

const symbol = (name: string, filePath: string, startLine: number, endLine: number) => ({
	name,
	filePath,
	startLine,
	endLine,
	kind: "function" as const,
});
const hunk = (filePath: string, startLine: number, endLine: number) => ({ filePath, startLine, endLine });

// biome-ignore lint/suspicious/noExplicitAny: the workspace under grade is untyped by construction.
const namesFor = (entry: any): string[] => (entry.affectedSymbols ?? []).map((s: { name: string }) => s.name).sort();

test("a symbol TOUCHING a hunk's boundary counts as affected", () => {
	// The spec's predicate is inclusive at both ends (`startLine <= hunk.endLine && endLine >= hunk.startLine`).
	// The visible fixture is fully CONTAINED (38–50 vs 40–45), which is satisfied by a strict `<`/`>` too — so an
	// off-by-one survives it and then silently drops every symbol whose last line is the hunk's first line. That
	// is the single most common real shape: a one-line change at the top of a function.
	const symbols = [
		symbol("endsAtHunkStart", "src/auth.ts", 10, 20),
		symbol("startsAtHunkEnd", "src/auth.ts", 30, 40),
		symbol("wellClear", "src/auth.ts", 100, 110),
	];
	const [entry] = mapHunksToSymbols([hunk("src/auth.ts", 20, 30)], symbols);
	assert.deepEqual(
		namesFor(entry),
		["endsAtHunkStart", "startsAtHunkEnd"],
		"a symbol touching the hunk boundary was dropped (or a clearly-unrelated one was included)",
	);
});

test("symbols from a DIFFERENT file are never matched, however well the lines overlap", () => {
	// The visible fixture has one file, so a mapper that compares only line ranges passes it — and then attributes
	// a change in one file to a symbol in another, which is a false blast radius on every multi-file diff.
	// The other file's symbol is listed FIRST on purpose: with the correct one first, a mapper that ignores
	// filePath and returns the first overlap gets the right answer by accident, and the probe proves nothing.
	const symbols = [symbol("elsewhere", "src/db/tenants.ts", 38, 50), symbol("here", "src/auth.ts", 38, 50)];
	const [entry] = mapHunksToSymbols([hunk("src/auth.ts", 40, 45)], symbols);
	assert.deepEqual(namesFor(entry), ["here"], "a symbol from another file was attributed to this hunk");
});

test("one hunk spanning several symbols reports ALL of them", () => {
	// The visible acceptance asserts "exactly one entry" with one symbol. A mapper returning the FIRST match
	// satisfies it and then under-reports every refactor-sized hunk — the case where a reviewer most needs the list.
	const symbols = [
		symbol("alpha", "src/auth.ts", 10, 20),
		symbol("beta", "src/auth.ts", 22, 32),
		symbol("gamma", "src/auth.ts", 34, 44),
	];
	const [entry] = mapHunksToSymbols([hunk("src/auth.ts", 15, 40)], symbols);
	assert.deepEqual(namesFor(entry), ["alpha", "beta", "gamma"], "a wide hunk did not report every symbol it covers");
});

test("several hunks each get their own entry, in step with the input", () => {
	// Pairing is per-hunk. An implementation that flattens to a single entry, or that reorders, breaks every
	// caller that zips the result back against its own hunk list.
	const symbols = [symbol("alpha", "src/auth.ts", 10, 20), symbol("beta", "src/auth.ts", 100, 110)];
	const hunks = [hunk("src/auth.ts", 12, 14), hunk("src/auth.ts", 105, 106), hunk("src/auth.ts", 500, 501)];
	const mapped = mapHunksToSymbols(hunks, symbols);
	assert.equal(mapped.length, 3, "one entry per hunk, including hunks that affect nothing");
	assert.deepEqual(namesFor(mapped[0]), ["alpha"]);
	assert.deepEqual(namesFor(mapped[1]), ["beta"]);
	assert.deepEqual(namesFor(mapped[2]), [], "a hunk touching no symbol must yield an EMPTY list, not be dropped");
});

test("blastRadius TERMINATES on a cyclic import graph and still reports the reachable set", () => {
	// THE probe. Circular imports are ordinary in TypeScript; the visible fixture is an acyclic 3-node chain, so a
	// reverse-BFS with no visited set passes it and hangs here — a CI guardian that never returns on the repos
	// most likely to need it. NOTE the shape of the signal: a truly unbounded traversal fails this by TIMEOUT, not
	// by assertion, so this probe cannot be demonstrated against a bad implementation without hanging one. The
	// assertions below cover the milder failure — a traversal that terminates but drops nodes reached only via
	// the cycle.
	const graph = new DependencyGraph();
	graph.addEdge("a.ts", "b.ts");
	graph.addEdge("b.ts", "c.ts");
	graph.addEdge("c.ts", "a.ts"); // the cycle
	graph.addEdge("d.ts", "c.ts");

	const radius = graph.blastRadius(["c.ts"]);
	const reached = new Set<string>(radius);
	for (const file of ["a.ts", "b.ts", "c.ts", "d.ts"]) {
		assert.ok(reached.has(file), `blastRadius from c.ts did not reach ${file} through the cycle`);
	}
});

test("blastRadius over a DIAMOND reports each file once", () => {
	// A shared ancestor reachable by two paths. A set-returning implementation gets this free; one that
	// accumulates into an array and converts late does not, and the chain fixture cannot tell them apart.
	const graph = new DependencyGraph();
	graph.addEdge("app.ts", "left.ts");
	graph.addEdge("app.ts", "right.ts");
	graph.addEdge("left.ts", "core.ts");
	graph.addEdge("right.ts", "core.ts");

	const radius = [...graph.blastRadius(["core.ts"])];
	assert.equal(new Set(radius).size, radius.length, "a file appears twice in the blast radius");
	assert.deepEqual([...radius].sort(), ["app.ts", "core.ts", "left.ts", "right.ts"].sort());
});

test("several changed files union their radii without losing any seed", () => {
	// The visible test seeds ONE file. A traversal that overwrites rather than unions its accumulator returns only
	// the last seed's radius — under-reporting exactly when a PR touches several files, which is most PRs.
	const graph = new DependencyGraph();
	graph.addEdge("a.ts", "b.ts");
	graph.addEdge("x.ts", "y.ts");

	const radius = new Set<string>(graph.blastRadius(["b.ts", "y.ts"]));
	for (const file of ["a.ts", "b.ts", "x.ts", "y.ts"]) {
		assert.ok(radius.has(file), `the union of two seeds lost ${file}`);
	}
});
