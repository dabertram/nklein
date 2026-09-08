import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * The performance verifier.
 *
 * Performance is a COUNT here, never a duration. Wall time on a shared machine is noise — it depends on what else
 * is running — and a grader that fails when the laptop is busy teaches an agent to distrust the grader. The data is
 * only reachable through an instrumented pull-based source, so a budget is a claim about the algorithm
 * ("it stops when it has the answer") that is either true or false, and is identical on every machine.
 *
 * BEHAVIOUR IS CHECKED ALWAYS, whatever the manifest says. A faster wrong answer is not an optimisation, and this
 * is the only thing standing between "make it cheaper" and "make it return nothing".
 *
 * `harness/`, `conformance/`, this file and `scripts/run-tests.mjs` are FROZEN — evidence, not workspace.
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
	...walk(join(root, "harness")),
	...walk(join(root, "conformance")),
	join(root, "test", "performance.test.js"),
	join(root, "scripts", "run-tests.mjs"),
]
	.map((file) => toPosix(relative(root, file)))
	.sort();
const recorded = JSON.parse(readFileSync(join(root, "test/frozen.json"), "utf8"));

test("the frozen harness and workloads are untouched", () => {
	const expected = recorded.frozen ?? {};
	const actual = Object.fromEntries(frozenPaths.map((path) => [path, digestOf(path)]));
	const added = Object.keys(actual).filter((path) => !(path in expected));
	const removed = Object.keys(expected).filter((path) => !(path in actual));
	const changed = Object.keys(expected).filter((path) => path in actual && actual[path] !== expected[path]);
	if (added.length + removed.length + changed.length > 0) {
		assert.fail(
			"the harness and the workloads are evidence, not workspace — restore them and change src/ instead.\n" +
				`  changed: ${changed.join(", ") || "none"}\n  added:   ${added.join(", ") || "none"}\n  removed: ${removed.join(", ") || "none"}`,
		);
	}
});

const { createSource } = await import(pathToFileURL(join(root, "harness/source.mjs")).href);
const { workloads } = await import(pathToFileURL(join(root, "conformance/workloads.mjs")).href);
const budgets = JSON.parse(readFileSync(join(root, "performance/budgets.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(root, "performance/manifest.json"), "utf8"));
const workloadById = new Map(workloads.map((workload) => [workload.id, workload]));
const budgetById = new Map(budgets.budgets.map((budget) => [budget.id, budget]));

/** Run one workload against a fresh source. Returns what it produced and how far it read. */
async function measure(workload) {
	const module = await import(`${pathToFileURL(join(root, "src/index.mjs")).href}?workload=${workload.id}`);
	const data = workload.build();
	const source = createSource(data.records);
	const actual = await workload.invoke(module, source, data);
	return { actual, expected: workload.expected(data), cost: { pulled: source.pulled(), size: source.size } };
}

/** Every limit a budget states, checked against what the workload actually cost. */
function overBudget(budget, cost) {
	if (typeof budget.limits.maxPulled === "number" && cost.pulled > budget.limits.maxPulled) {
		return [`pulled ${cost.pulled} of ${cost.size} records, budget ${budget.limits.maxPulled}`];
	}
	return [];
}

// BEHAVIOUR, always. An optimisation that changes the answer is not an optimisation.
test("every workload still produces the right answer", async (t) => {
	for (const workload of workloads) {
		await t.test(`${workload.id} — ${workload.title}`, async () => {
			const { actual, expected } = await measure(workload);
			assert.deepEqual(actual, expected);
		});
	}
});

test("the performance manifest is a valid, minimal artifact", () => {
	assert.equal(manifest.schemaVersion, 1, "performance/manifest.json must keep `schemaVersion: 1`");
	assert.equal(typeof manifest.complete, "boolean", "`complete` must be a boolean");
	assert.ok(Array.isArray(manifest.optimised), "`optimised` must be an array of budget ids you have met");
	const unknown = manifest.optimised.filter((id) => !budgetById.has(id));
	assert.deepEqual(unknown, [], `unknown budget id(s): ${unknown.join(", ")} — the budgets are ${[...budgetById.keys()].join(", ")}`);
	assert.equal(new Set(manifest.optimised).size, manifest.optimised.length, "`optimised` must not repeat a budget id");
});

// STRICT NOW: a budget you claim is MEASURED. Claiming one you have not met is strictly worse than claiming none.
test("every budget listed in the manifest is actually met", async (t) => {
	for (const id of manifest.optimised) {
		const budget = budgetById.get(id);
		if (!budget) continue;
		await t.test(`${id} — ${budget.title}`, async () => {
			const workload = workloadById.get(budget.workload);
			assert.ok(workload, `budget ${id} names workload ${budget.workload}, which does not exist`);
			const { actual, expected, cost } = await measure(workload);
			assert.deepEqual(actual, expected, `${id}: the answer changed — a faster wrong answer is not an optimisation`);
			const over = overBudget(budget, cost);
			assert.deepEqual(over, [], `${id} (${budget.title}): ${over.join("; ")}. ${budget.why}`);
		});
	}
});

// COVERAGE LATER: every budget is demanded only when you declare the work complete.
test("a complete optimisation meets every budget", async (t) => {
	if (!manifest.complete) return;
	const missing = budgets.budgets.filter((budget) => !manifest.optimised.includes(budget.id)).map((budget) => `${budget.id} (${budget.title})`);
	assert.deepEqual(missing, [], `\`complete: true\` but these budgets are not listed in \`optimised\`:\n  ${missing.join("\n  ")}\n`);
	for (const budget of budgets.budgets) {
		await t.test(`${budget.id} — ${budget.title}`, async () => {
			const { actual, expected, cost } = await measure(workloadById.get(budget.workload));
			assert.deepEqual(actual, expected);
			const over = overBudget(budget, cost);
			assert.deepEqual(over, [], `${budget.id}: ${over.join("; ")}`);
		});
	}
});
