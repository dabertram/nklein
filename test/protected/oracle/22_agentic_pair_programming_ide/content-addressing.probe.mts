/**
 * P20.2 / P23.5 held-out oracle probe — CONTENT-ADDRESSING INTEGRITY (project 22).
 *
 * ── AN ELEVENTH INVARIANT FAMILY: when two different things must never look the same ──
 * A workspace hash is the identity the whole staleness mechanism rests on: if two DIFFERENT workspaces can
 * produce the same digest, a context pack silently goes on being trusted after the code under it changed.
 *
 * The spec's visible acceptance for hashing is "the same string always produces the same hash" and "two
 * different strings produce different hashes" — both about `sha256Hex`, and both true of any correct SHA-256
 * call. Nothing there exercises `hashWorkspace`'s own two obligations, which is where the real defects live:
 *
 *  1. **Key-order independence.** The spec says "sort keys". An implementation that forgets to sort passes every
 *     test that builds the same object literal twice, because JS preserves insertion order — and then reports two
 *     digests for one workspace assembled in a different order.
 *  2. **Framing.** The spec's `"path:hash\n"` pairing exists so distinct workspaces cannot collide. Concatenating
 *     path and content without a delimiter makes `{"ab": "c"}` and `{"a": "bc"}` hash identically, and no
 *     single-workspace test can see it.
 *
 * Binds only to the spec's prescribed modules (`src/hash.ts`, `src/context/context-builder.ts`).
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

const CANDIDATES = ["src/hash.ts", "src/context/context-builder.ts", "src/index.ts"];
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

const sha256Hex = exported<(content: string) => string>("sha256Hex");
const hashWorkspace = exported<(files: Record<string, string>) => string>("hashWorkspace");

test("hashWorkspace is INDEPENDENT of key insertion order", () => {
	// The spec says "sort keys". Any test that builds the same literal twice cannot check it, because JS preserves
	// insertion order — so an unsorted implementation looks perfectly deterministic right up until a workspace is
	// assembled from a directory walk in a different order, and every pack is then reported stale.
	const ascending = { "a.ts": "alpha", "b.ts": "beta", "c.ts": "gamma" };
	const descending: Record<string, string> = {};
	for (const key of ["c.ts", "b.ts", "a.ts"]) {
		descending[key] = ascending[key as keyof typeof ascending];
	}
	assert.equal(
		hashWorkspace(descending),
		hashWorkspace(ascending),
		"the same workspace hashed differently depending on key order — hashWorkspace does not sort its keys",
	);
});

test("two DIFFERENT workspaces never collide across the path/content boundary", () => {
	// The framing obligation. Without a delimiter between path and content, {"ab": "c"} and {"a": "bc"} concatenate
	// to the same bytes. This is the failure that makes a stale pack look fresh, and it is invisible to any test
	// that hashes one workspace at a time.
	assert.notEqual(
		hashWorkspace({ ab: "c" }),
		hashWorkspace({ a: "bc" }),
		"two different workspaces produced the same digest — path and content are concatenated without framing",
	);
	assert.notEqual(
		hashWorkspace({ "a.ts": "x", "b.ts": "y" }),
		hashWorkspace({ "a.ts": "xy", "b.ts": "" }),
		"content moved between files did not change the workspace digest",
	);
});

test("adding, removing or emptying a file changes the digest", () => {
	// Totality in the other direction: a digest that ignores empty files, or that hashes only values, reports a
	// changed workspace as unchanged — the exact direction that keeps a stale context pack in use.
	const base = { "a.ts": "alpha", "b.ts": "beta" };
	const digest = hashWorkspace(base);
	assert.notEqual(hashWorkspace({ ...base, "c.ts": "" }), digest, "adding an EMPTY file left the digest unchanged");
	assert.notEqual(hashWorkspace({ "a.ts": "alpha" }), digest, "removing a file left the digest unchanged");
	assert.notEqual(hashWorkspace({ ...base, "b.ts": "" }), digest, "emptying a file left the digest unchanged");
	assert.notEqual(hashWorkspace({}), digest, "an empty workspace hashed like a populated one");
});

test("renaming a file changes the digest even when the contents are identical", () => {
	// A path-blind digest — one that hashes only the concatenated contents — passes every same-content test and
	// treats a rename as a no-op, so a pack that pins the old path stays "fresh" after the file is gone.
	assert.notEqual(
		hashWorkspace({ "old.ts": "same" }),
		hashWorkspace({ "new.ts": "same" }),
		"a rename did not change the workspace digest — paths are not part of the hash",
	);
});

test("hashing is stable across repeated calls and matches sha256Hex's own determinism", () => {
	// Guards a digest built over a consumed stream or a reused hash object, which returns a different value the
	// second time — the same statelessness class as project 24's regex, in a different mechanism.
	const files = { "a.ts": "alpha", "b.ts": "beta" };
	const first = hashWorkspace(files);
	for (let attempt = 0; attempt < 5; attempt += 1) {
		assert.equal(hashWorkspace(files), first, `call ${attempt + 2} produced a different workspace digest`);
	}
	const text = "some content";
	assert.equal(sha256Hex(text), sha256Hex(text), "sha256Hex is not stable across calls");
	assert.match(sha256Hex(text), /^[0-9a-f]{64}$/, "sha256Hex did not return a 64-character lowercase hex digest");
});
