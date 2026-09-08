#!/usr/bin/env node
/**
 * Regenerate `test/frozen.json` for a repair fixture.
 *
 * The repair family ships the behaviour suite that grades the work, so the suite has to be tamper-evident: the
 * fixture's verifier recomputes a content digest of every frozen file on each run and compares it with the map
 * recorded here (grading contract §5). This tool writes that map. It deliberately lives OUTSIDE the fixtures — a
 * fixture is copied into the agent's workspace by folder name, so the agent never receives this file.
 *
 * Run it after INTENTIONALLY editing a frozen file:
 *
 *     node scripts/dev-fixtures/repair-freeze.mjs repair-r1 [repair-r2 ...]
 *     node scripts/dev-fixtures/repair-freeze.mjs --all
 *
 * `frozen` covers scenarios/**, test/repair.test.js and scripts/run-tests.mjs — the files the verifier refuses to
 * see move. `src` records the shipped (still defective) sources, which R5's verifier uses to check that a claimed
 * root cause cites a file the agent actually changed. Neither map says anything about what is wrong or how to fix
 * it; they only pin "this is what shipped".
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const fixturesRoot = dirname(fileURLToPath(import.meta.url));

function walk(dir) {
	if (!existsSync(dir)) return [];
	const found = [];
	const entries = readdirSync(dir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) found.push(...walk(full));
		else if (entry.isFile()) found.push(full);
	}
	return found;
}

const toPosix = (value) => value.split(sep).join("/");
const digestOf = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

function digestMap(root, files) {
	const map = {};
	for (const rel of files.map((file) => toPosix(relative(root, file))).sort()) {
		map[rel] = digestOf(join(root, rel));
	}
	return map;
}

function freeze(fixture) {
	const root = join(fixturesRoot, fixture);
	if (!existsSync(root)) throw new Error(`no such fixture: ${root}`);
	const frozen = digestMap(root, [
		...walk(join(root, "scenarios")),
		join(root, "test", "repair.test.js"),
		join(root, "scripts", "run-tests.mjs"),
	]);
	const src = digestMap(root, walk(join(root, "src")));
	const target = join(root, "test", "frozen.json");
	writeFileSync(target, `${JSON.stringify({ schemaVersion: 1, frozen, src }, null, "\t")}\n`, "utf8");
	console.log(`${fixture}: froze ${Object.keys(frozen).length} files, recorded ${Object.keys(src).length} sources`);
}

const args = process.argv.slice(2);
const fixtures = args.includes("--all")
	? readdirSync(fixturesRoot, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && /^repair-r\d+$/.test(entry.name))
			.map((entry) => entry.name)
			.sort()
	: args;

if (fixtures.length === 0) {
	console.error("usage: node scripts/dev-fixtures/repair-freeze.mjs <fixture...> | --all");
	process.exit(1);
}
for (const fixture of fixtures) freeze(fixture);
