import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * The repair verifier.
 *
 * This file and everything under `scenarios/` are FROZEN — they are the evidence this task is graded on, not
 * workspace. The digest check below recomputes their content on every run; if any of it moves, the suite fails and
 * says so. Repair `src/`.
 *
 * There are no expected values written down here: the scenario set, its ids and its assertions are all read from
 * `scenarios/` at run time. This is a harness, not an answer key.
 */

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function walk(dir) {
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
const digestOf = (file) => createHash("sha256").update(readFileSync(join(root, file))).digest("hex");

const frozenPaths = [
	...walk(join(root, "scenarios")),
	join(root, "test", "repair.test.js"),
	join(root, "scripts", "run-tests.mjs"),
]
	.map((file) => toPosix(relative(root, file)))
	.sort();

const recorded = JSON.parse(readFileSync(join(root, "test/frozen.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(root, "repair/manifest.json"), "utf8"));

const scenarios = [];
for (const file of walk(join(root, "scenarios")).filter((file) => file.endsWith(".scenarios.mjs"))) {
	const module = await import(pathToFileURL(file).href);
	for (const scenario of module.scenarios ?? []) {
		scenarios.push({ ...scenario, source: toPosix(relative(root, file)) });
	}
}
const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));

test("the frozen scenario suite is untouched", () => {
	const expected = recorded.frozen ?? {};
	const actual = Object.fromEntries(frozenPaths.map((path) => [path, digestOf(path)]));
	const added = Object.keys(actual).filter((path) => !(path in expected));
	const removed = Object.keys(expected).filter((path) => !(path in actual));
	const changed = Object.keys(expected).filter((path) => path in actual && actual[path] !== expected[path]);
	if (added.length + removed.length + changed.length > 0) {
		assert.fail(
			"the frozen suite is evidence, not workspace — restore it and repair src/ instead.\n" +
				`  changed: ${changed.join(", ") || "none"}\n` +
				`  added:   ${added.join(", ") || "none"}\n` +
				`  removed: ${removed.join(", ") || "none"}`,
		);
	}
});

test("the scenario suite is well formed", () => {
	assert.ok(scenarios.length > 0, "no scenarios were loaded from scenarios/*.scenarios.mjs");
	const ids = new Set();
	for (const scenario of scenarios) {
		assert.equal(typeof scenario.id, "string", `a scenario in ${scenario.source} has no string id`);
		assert.ok(!ids.has(scenario.id), `two scenarios share the id \`${scenario.id}\``);
		ids.add(scenario.id);
		assert.equal(typeof scenario.title, "string", `scenario \`${scenario.id}\` has no title`);
		assert.equal(typeof scenario.check, "function", `scenario \`${scenario.id}\` has no check()`);
	}
});

test("the repair manifest keeps its shape", () => {
	assert.equal(manifest.schemaVersion, 1, "schemaVersion must stay 1");
	assert.equal(typeof manifest.complete, "boolean", "`complete` must be a boolean");
	assert.ok(Array.isArray(manifest.repaired), "`repaired` must be an array of scenario ids");
	assert.equal(typeof manifest.rootCause, "string", "`rootCause` must be a string (empty until you can name it)");
});

/**
 * The root cause is prose, so it cannot be graded for correctness offline. What CAN be checked is that it is a real
 * claim rather than a label: it has to cite a source file that exists and that you actually changed, name something
 * declared in that file, and say more than the path does.
 */
test("a recorded root cause is specific and cites a file you changed", () => {
	const rootCause = String(manifest.rootCause ?? "").trim();
	if (manifest.complete === true) {
		assert.ok(rootCause.length > 0, "`complete` is true, so `rootCause` must name the one cause behind both regressions");
	}
	if (rootCause.length === 0) return;

	assert.ok(
		rootCause.length >= 80,
		`\`rootCause\` is ${rootCause.length} characters — explain the shared cause and its consequence, do not label it`,
	);

	const cited = [...new Set([...rootCause.matchAll(/\bsrc\/[\w./-]+\.mjs\b/g)].map((match) => match[0]))];
	assert.ok(cited.length > 0, "`rootCause` must cite the file the shared cause lives in, as a path like `src/<file>.mjs`");

	const missing = cited.filter((path) => !existsSync(join(root, path)));
	assert.deepEqual(missing, [], `\`rootCause\` cites files that do not exist: ${missing.join(", ")}`);

	const baseline = recorded.src ?? {};
	const changed = cited.filter((path) => !(path in baseline) || digestOf(path) !== baseline[path]);
	assert.ok(
		changed.length > 0,
		`\`rootCause\` cites ${cited.join(", ")}, unchanged from the tree you were given — cite the file you actually repaired`,
	);

	const declared = new Set();
	for (const path of changed) {
		const source = readFileSync(join(root, path), "utf8");
		for (const match of source.matchAll(/\b(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) {
			declared.add(match[1]);
		}
	}
	const words = rootCause.match(/[A-Za-z_$][\w$]*/g) ?? [];
	assert.ok(
		[...declared].some((name) => words.includes(name)),
		`\`rootCause\` must name what was wrong — none of ${changed.join(", ")}'s declarations (${[...declared].join(", ")}) appear in it`,
	);

	const prose = words.filter((word) => !cited.some((path) => path.includes(word)));
	assert.ok(prose.length >= 15, "`rootCause` must be an explanation, not a file path with a label attached");
});

test("every scenario listed as repaired really passes", async () => {
	const seen = new Set();
	const known = [...byId.keys()].sort();
	for (const id of manifest.repaired) {
		assert.equal(typeof id, "string", `\`repaired\` must contain scenario ids, got: ${JSON.stringify(id)}`);
		assert.ok(!seen.has(id), `\`${id}\` is listed twice in \`repaired\``);
		seen.add(id);
		assert.ok(byId.has(id), `unknown scenario id \`${id}\` — this fixture defines:\n  ${known.join("\n  ")}`);
	}

	const failures = [];
	for (const id of manifest.repaired) {
		const scenario = byId.get(id);
		try {
			await scenario.check();
		} catch (error) {
			failures.push(`${id} — ${scenario.title}\n      ${String(error?.message ?? error).split("\n").join("\n      ")}`);
		}
	}
	if (failures.length > 0) {
		assert.fail(
			`listed as repaired but still failing — claiming a scenario you have not fixed is worse than omitting it:\n  ${failures.join("\n  ")}`,
		);
	}
});

test("declaring the repair complete requires every scenario", () => {
	if (manifest.complete !== true) return;
	const claimed = new Set(manifest.repaired);
	const missing = scenarios.filter((scenario) => !claimed.has(scenario.id)).map((s) => `${s.id} — ${s.title}`);
	if (missing.length > 0) {
		assert.fail(`\`complete\` is true but these scenarios are not repaired:\n  ${missing.join("\n  ")}`);
	}
});
