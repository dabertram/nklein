import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const BRIEF = "input/brief.md";
const SUITE = "conformance/suite.mjs";

function normalise(text) {
	return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** The rule ids and their loose prose are DERIVED from the brief. This file names no rule and no expected value. */
function deriveRules(source) {
	const rules = new Map(); // "R-NN" -> normalised prose
	for (const block of source.split(/\n\s*\n/)) {
		const heading = /^\*\*(R-\d{2})\*\*\s+([\s\S]+)$/.exec(block.trim());
		if (heading) rules.set(heading[1], normalise(heading[2]));
	}
	return rules;
}

async function load(relativePath) {
	try {
		return { module: await import(pathToFileURL(join(root, relativePath)).href), error: null };
	} catch (error) {
		return { module: null, error };
	}
}

const briefRules = deriveRules(readFileSync(join(root, BRIEF), "utf8"));
const suiteSource = readFileSync(join(root, SUITE), "utf8");
const suite = await load(SUITE);
const conforming = await load("candidates/conforming/index.mjs");
const nonConforming = await load("candidates/nonconforming/index.mjs");
const deliverable = JSON.parse(readFileSync(join(root, "spec/spec.json"), "utf8"));
const declaredRules = Array.isArray(deliverable.rules) ? deliverable.rules : [];
const declaredIds = new Set(declaredRules.map((rule) => rule?.id).filter((id) => typeof id === "string"));

/** Every export of the oracle, replaced by a function that does nothing. A suite that accepts this checks nothing. */
function buildNullImplementation() {
	const stub = {};
	for (const name of Object.keys(conforming.module)) {
		stub[name] = typeof conforming.module[name] === "function" ? () => undefined : undefined;
	}
	return stub;
}

/** Run the suite against a subject. A throw is a rejection, not a crash — the contract says so. */
function runSuite(subject) {
	try {
		return { threw: false, results: suite.module.checkConformance(subject) };
	} catch (error) {
		return { threw: true, error };
	}
}

/** A suite that would not even import cannot be run; the first test already says so, loudly. */
function suiteIsRunnable() {
	return suite.module !== null && typeof suite.module.checkConformance === "function";
}

function rejects(outcome) {
	if (outcome.threw) return true;
	return Array.isArray(outcome.results) && outcome.results.some((result) => result?.ok === false);
}

test("the fixture loads: both candidates, your suite, and the brief", () => {
	assert.equal(conforming.error, null, `the conforming candidate must import: ${conforming.error}`);
	assert.equal(nonConforming.error, null, `the non-conforming candidate must import: ${nonConforming.error}`);
	assert.equal(suite.error, null, `\`${SUITE}\` must import cleanly: ${suite.error}`);
	assert.equal(typeof suite.module?.checkConformance, "function", `\`${SUITE}\` must export checkConformance()`);
	assert.ok(Array.isArray(suite.module?.RULES), `\`${SUITE}\` must export a RULES array`);
	assert.ok(briefRules.size > 0, "the brief's rules must parse — they are the evidence, do not edit the brief");
});

test("the deliverable keeps its shape, and every rule you state is one the brief names", () => {
	assert.equal(deliverable.schemaVersion, 1, "schemaVersion must stay 1");
	assert.equal(typeof deliverable.complete, "boolean", "`complete` must be a boolean");
	assert.ok(Array.isArray(deliverable.rules), "`rules` must be an array");

	const seen = new Set();
	for (const rule of declaredRules) {
		const where = JSON.stringify(rule);
		assert.ok(briefRules.has(rule?.id), `\`${rule?.id}\` is not a rule the brief names: ${where}`);
		assert.ok(!seen.has(rule.id), `\`${rule.id}\` is stated twice`);
		seen.add(rule.id);
		assert.equal(typeof rule.statement, "string", `each rule needs a \`statement\`: ${where}`);
		assert.ok(
			rule.statement.trim().length >= 30,
			`the statement for ${rule.id} must pin the rule down — thresholds, rounding, order of operations: ${where}`,
		);
		assert.ok(
			!briefRules.get(rule.id).includes(normalise(rule.statement)),
			`the statement for ${rule.id} is the brief's own loose sentence copied across — the brief is what is not precise enough: ${where}`,
		);
	}
});

test("the suite declares only rules you specified, and never diffs against the oracle", () => {
	if (!suiteIsRunnable()) return;
	assert.ok(
		!/from\s+["'][^"']*candidates/.test(suiteSource) && !/import\s*\(\s*["'][^"']*candidates/.test(suiteSource),
		`${SUITE} imports from candidates/ — comparing an implementation against the oracle is a diff, not a conformance suite`,
	);
	const seen = new Set();
	for (const id of suite.module.RULES) {
		assert.equal(typeof id, "string", `RULES must hold rule ids: ${JSON.stringify(id)}`);
		assert.ok(!seen.has(id), `RULES lists \`${id}\` twice`);
		seen.add(id);
		assert.ok(declaredIds.has(id), `the suite checks \`${id}\`, which spec/spec.json does not state`);
	}
});

test("the suite accepts the conforming implementation, and exercises every rule it declares", () => {
	if (!suiteIsRunnable()) return;
	const outcome = runSuite(conforming.module);
	assert.equal(
		outcome.threw,
		false,
		`checkConformance() threw on the CONFORMING implementation — the oracle is correct by definition, so this is a bug in your suite: ${outcome.error}`,
	);
	assert.ok(Array.isArray(outcome.results), "checkConformance() must return an array of { rule, ok, detail }");

	const exercised = new Set();
	for (const result of outcome.results) {
		const where = JSON.stringify(result);
		assert.ok(suite.module.RULES.includes(result?.rule), `a result cites \`${result?.rule}\`, not in RULES: ${where}`);
		assert.equal(typeof result.ok, "boolean", `\`ok\` must be a boolean: ${where}`);
		assert.equal(typeof result.detail, "string", `\`detail\` must say what was observed: ${where}`);
		assert.ok(result.detail.trim().length > 0, `\`detail\` must not be empty: ${where}`);
		assert.notEqual(
			result.ok,
			false,
			`your suite fails the CONFORMING implementation on ${result.rule} — a check the oracle cannot pass is wrong: ${where}`,
		);
		exercised.add(result.rule);
	}
	const unexercised = suite.module.RULES.filter((id) => !exercised.has(id));
	assert.deepEqual(
		unexercised,
		[],
		`RULES declares rules the suite never returns a result for:\n  ${unexercised.join("\n  ")}`,
	);
});

test("declaring the specification complete requires a suite that discriminates", () => {
	if (deliverable.complete !== true || !suiteIsRunnable()) return;

	const unstated = [...briefRules.keys()].filter((id) => !declaredIds.has(id)).sort();
	assert.deepEqual(unstated, [], `\`complete\` is true but these rules are unstated:\n  ${unstated.join("\n  ")}`);

	const unchecked = [...declaredIds].filter((id) => !suite.module.RULES.includes(id)).sort();
	assert.deepEqual(
		unchecked,
		[],
		`\`complete\` is true but the suite checks none of these stated rules:\n  ${unchecked.join("\n  ")}`,
	);

	assert.ok(
		rejects(runSuite(nonConforming.module)),
		"your suite ACCEPTS the non-conforming implementation — it breaks exactly one of the six rules, so a suite that passes it is not discriminating between them",
	);
	assert.ok(
		rejects(runSuite(buildNullImplementation())),
		"your suite ACCEPTS an implementation whose every function returns undefined — a suite that cannot tell the engine from nothing at all checks nothing at all",
	);
});
