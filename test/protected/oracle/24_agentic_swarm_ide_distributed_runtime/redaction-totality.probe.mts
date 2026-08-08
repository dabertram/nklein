/**
 * P20.2 / P23.5 held-out oracle probe — REDACTION TOTALITY and statelessness (project 24).
 *
 * ── AN EIGHTH INVARIANT FAMILY: a guard that must hold for EVERY input, not a typical one ──
 * The previous seven measure what a system computes. This measures what a guard must never let through. A
 * redactor is only worth anything if it is TOTAL: one uncovered host-path shape, or one call that answers
 * differently the second time, and a real path reaches an agent.
 *
 * The spec hands us a genuine trap, and it is the reason this probe is worth holding out. `HOST_PATH_PATTERNS`
 * is a module-level array of `/g` regexes, and the suggested implementation of `containsHostPath` is "test any
 * pattern matches". **A `/g` regex object carries `lastIndex` between calls**, so `pattern.test(x)` on a shared
 * global regex returns true, then false, then true for the SAME string. Every single-call test passes. The
 * scanner that iterates a list of strings — the actual product surface — silently misses every other leak.
 *
 * So the probes call repeatedly, scan lists, and cover each pattern family the spec declares, rather than
 * checking one path once.
 *
 * Binds only to the spec's prescribed modules (`src/sandbox/path-redactor.ts`, `src/sandbox/leak-scanner.ts`).
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

const CANDIDATES = [
	"src/sandbox/path-redactor.ts",
	"src/sandbox/leak-scanner.ts",
	"src/sandbox/redaction.ts",
	"src/index.ts",
];
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

const redactHostPaths = exported<(text: string) => string>("redactHostPaths");
const containsHostPath = exported<(text: string) => boolean>("containsHostPath");
const scanForLeaks = exported<(strings: string[]) => Array<{ index: number; match: string }>>("scanForLeaks");
const assertNoLeaks = exported<(strings: string[]) => void>("assertNoLeaks");

/** One representative of every pattern family the spec declares in HOST_PATH_PATTERNS. */
const HOST_PATHS = [
	"/private/var/folders/ab12/T/nklein-task1/src/app.ts",
	"/var/folders/ab12/T/nklein-task1",
	"/tmp/nklein-task1/out.log",
	"/home/dev/projects/thing/src/main.rs",
	"~/Documents/secret-project/notes.md",
];

test("containsHostPath is STATELESS — the same input answers the same way every time", () => {
	// THE probe. A shared `/g` regex advances `lastIndex` on every `.test()`, so the second call on an identical
	// string returns false. Any single-call test passes; the product surface (a scanner over a list) misses every
	// other leak. Ten repeats, because the alternation is 2-periodic and a 2-call check could still get lucky.
	for (const path of HOST_PATHS) {
		const answers = Array.from({ length: 10 }, () => containsHostPath(path));
		assert.ok(
			answers.every((answer) => answer === true),
			`containsHostPath("${path}") gave ${JSON.stringify(answers)} — the answer depends on how many times it was called (a /g regex keeps lastIndex between calls)`,
		);
	}
});

test("every declared host-path family is detected, not just the one in the example", () => {
	// The spec's own acceptance uses a single `/private/var/folders/...` string. A redactor covering only that
	// shape passes it and leaks Linux paths, `/tmp/nklein-*` paths and `~`-relative paths verbatim.
	for (const path of HOST_PATHS) {
		assert.equal(containsHostPath(path), true, `an undetected host-path family: ${path}`);
	}
});

test("workspace-relative paths pass through untouched, however many times they are checked", () => {
	// The other half of totality: a redactor that flags everything is useless in a different way, and the
	// statelessness bug can also make a SAFE string alternate.
	for (const safe of ["./src/app.ts", "src/lib/util.ts", "../sibling/pkg.json", "no path here at all"]) {
		for (let attempt = 0; attempt < 5; attempt += 1) {
			assert.equal(containsHostPath(safe), false, `a workspace-relative path was flagged: ${safe}`);
		}
		assert.equal(redactHostPaths(safe), safe, `a safe string was rewritten: ${safe}`);
	}
});

test("redaction leaves no fragment of the host path behind", () => {
	// Replacing `cd <hostpath> &&` with `cd . &&` while leaving a second occurrence intact is the classic partial
	// redaction. The output must contain no recognisable host-path fragment at all — asserted by re-running the
	// detector over the REDACTED text, which is the only check that cannot be fooled by a clever substitution.
	const text = `cd /private/var/folders/ab12/T/nklein-task1 && cat /private/var/folders/ab12/T/nklein-task1/out.log`;
	const redacted = redactHostPaths(text);
	assert.equal(containsHostPath(redacted), false, `redaction left a host path behind: ${redacted}`);
	assert.ok(!redacted.includes("/private/var/folders"), `a raw host-path fragment survived: ${redacted}`);
});

test("scanForLeaks reports EVERY leaking string, with correct indices", () => {
	// The list surface, where the statelessness bug shows up as "every other one". Indices matter because the
	// caller uses them to point at the offending output.
	const strings = [
		"clean line",
		HOST_PATHS[0] as string,
		"also clean",
		HOST_PATHS[3] as string,
		HOST_PATHS[2] as string,
	];
	const leaks = scanForLeaks(strings);
	const indices = [...new Set(leaks.map((leak) => leak.index))].sort((a, b) => a - b);
	assert.deepEqual(indices, [1, 3, 4], `scanForLeaks reported indices ${JSON.stringify(indices)}; expected 1, 3 and 4`);
});

test("scanForLeaks finds nothing in a wholly clean list, repeatedly", () => {
	const clean = ["./a.ts", "src/b.ts", "just text", "./c.ts"];
	for (let attempt = 0; attempt < 5; attempt += 1) {
		assert.deepEqual(scanForLeaks(clean), [], "a clean list reported a leak");
	}
});

test("assertNoLeaks throws on a leak and stays silent on a clean list", () => {
	// The spec pins the marker `HOST_PATH_LEAK_DETECTED`, because callers match on it. A guard that throws a
	// differently-worded error is a guard nobody catches.
	assert.throws(
		() => assertNoLeaks(["fine", HOST_PATHS[1] as string]),
		/HOST_PATH_LEAK_DETECTED/,
		"assertNoLeaks did not throw the pinned marker on a leaking list",
	);
	assert.doesNotThrow(() => assertNoLeaks(["./a.ts", "clean"]), "assertNoLeaks threw on a clean list");
});
