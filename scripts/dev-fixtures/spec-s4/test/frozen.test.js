import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The evidence and the verifier are FROZEN.
 *
 * Without this the family is gameable in two ways, and both are quiet. The verifier DERIVES its truth from the
 * files under `input/` on every run, so deleting a defect from the evidence shrinks the truth set and lets a
 * short, easy answer pass as complete. And the verifier itself ships with the task, so weakening its rules is a
 * one-line edit that turns every check green.
 *
 * So: `input/`, `candidates/` (the conformance oracle and the candidate it must reject), every file under `test/`
 * and `scripts/run-tests.mjs` have their content digests recorded in `test/frozen.json` and recomputed here on every
 * run. This file is in its own frozen set, so editing the guard changes the guard's digest and the guard fails.
 *
 * Your deliverable is the artifact you were asked to write. Everything else is evidence, not workspace.
 */

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function walk(dir) {
	const found = [];
	for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) found.push(...walk(full));
		else if (entry.isFile()) found.push(full);
	}
	return found;
}

const toPosix = (value) => value.split(sep).join("/");
const digestOf = (file) => createHash("sha256").update(readFileSync(join(root, file))).digest("hex");

const frozenPaths = [
	...walk(join(root, "input")),
	...walk(join(root, "candidates")),
	...walk(join(root, "test")),
	join(root, "scripts", "run-tests.mjs"),
]
	.map((file) => toPosix(relative(root, file)))
	.filter((path) => path !== "test/frozen.json")
	.sort();

test("the evidence and the verifier are untouched", () => {
	const expected = JSON.parse(readFileSync(join(root, "test/frozen.json"), "utf8")).frozen ?? {};
	const actual = Object.fromEntries(frozenPaths.map((path) => [path, digestOf(path)]));
	const added = Object.keys(actual).filter((path) => !(path in expected));
	const removed = Object.keys(expected).filter((path) => !(path in actual));
	const changed = Object.keys(expected).filter((path) => path in actual && actual[path] !== expected[path]);
	if (added.length + removed.length + changed.length > 0) {
		assert.fail(
			"the evidence and the verifier are not workspace — restore them and record your findings in the deliverable instead.\n" +
				`  changed: ${changed.join(", ") || "none"}\n  added:   ${added.join(", ") || "none"}\n  removed: ${removed.join(", ") || "none"}`,
		);
	}
});
