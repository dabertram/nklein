import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * The integration verifier (two-service saga edition).
 *
 * The service and the conformance suite ship with the task; your adapter does not. So the grading question is
 * "does the adapter you wrote satisfy the cases you claim", and it is answered by RUNNING them against a fresh
 * service every time.
 *
 * `service/`, `conformance/`, this file and `scripts/run-tests.mjs` are FROZEN — they are the evidence you are
 * graded on, not workspace. The digest check recomputes them on every run. There is no answer key here: the cases
 * describe behaviour, and how to produce it is the work.
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
	...walk(join(root, "service")),
	...walk(join(root, "conformance")),
	join(root, "test", "integration.test.js"),
	join(root, "scripts", "run-tests.mjs"),
]
	.map((file) => toPosix(relative(root, file)))
	.sort();
const recorded = JSON.parse(readFileSync(join(root, "test/frozen.json"), "utf8"));

test("the frozen service and conformance suite are untouched", () => {
	const expected = recorded.frozen ?? {};
	const actual = Object.fromEntries(frozenPaths.map((path) => [path, digestOf(path)]));
	const added = Object.keys(actual).filter((path) => !(path in expected));
	const removed = Object.keys(expected).filter((path) => !(path in actual));
	const changed = Object.keys(expected).filter((path) => path in actual && actual[path] !== expected[path]);
	if (added.length + removed.length + changed.length > 0) {
		assert.fail(
			"the service and the conformance suite are evidence, not workspace — restore them and write the adapter instead.\n" +
				`  changed: ${changed.join(", ") || "none"}\n  added:   ${added.join(", ") || "none"}\n  removed: ${removed.join(", ") || "none"}`,
		);
	}
});

const { cases } = await import(pathToFileURL(join(root, "conformance/cases.mjs")).href);
const caseById = new Map(cases.map((entry) => [entry.id, entry]));
const manifest = JSON.parse(readFileSync(join(root, "integration/manifest.json"), "utf8"));

test("the integration manifest is a valid, minimal artifact", () => {
	assert.equal(manifest.schemaVersion, 1, "integration/manifest.json must keep `schemaVersion: 1`");
	assert.equal(typeof manifest.complete, "boolean", "`complete` must be a boolean");
	assert.ok(Array.isArray(manifest.implemented), "`implemented` must be an array of conformance case ids");
	const unknown = manifest.implemented.filter((id) => !caseById.has(id));
	assert.deepEqual(unknown, [], `unknown case id(s): ${unknown.join(", ")} — the cases are ${[...caseById.keys()].join(", ")}`);
	assert.equal(new Set(manifest.implemented).size, manifest.implemented.length, "`implemented` must not repeat a case id");
});

/**
 * Fresh services and a fresh coordinator per case.
 *
 * `placeOrder` is bound to the two services up front, so a case only has to say what it wants placed and then
 * inspect what the services were left holding. Some cases WRAP `ledger.request` to make one step fail — the
 * coordinator must read the service through the object it was given, not capture the method once at construction.
 */
async function runCase(entry) {
	const { createLedgerService } = await import(pathToFileURL(join(root, "service/ledger-service.mjs")).href);
	const { createFulfilmentService } = await import(pathToFileURL(join(root, "service/fulfilment-service.mjs")).href);
	const adapter = await import(`${pathToFileURL(join(root, "src/adapter.mjs")).href}?case=${entry.id}`);
	assert.equal(
		typeof adapter.createOrderCoordinator,
		"function",
		"src/adapter.mjs must export `createOrderCoordinator({ ledger, fulfilment, sleep })`",
	);
	const ledger = createLedgerService();
	const fulfilment = createFulfilmentService();
	const sleeps = [];
	const coordinator = adapter.createOrderCoordinator({
		ledger,
		fulfilment,
		sleep: async (ms) => {
			sleeps.push(ms);
		},
	});
	await entry.run((order) => coordinator.placeOrder(order), { ledger, fulfilment, sleeps }, assert);
}

// STRICT NOW: a case you list is RUN. Listing one you have not implemented is strictly worse than listing nothing —
// a manifest that overstates the work is the failure this family exists to catch.
test("every conformance case listed in the manifest actually passes", async (t) => {
	for (const id of manifest.implemented) {
		const entry = caseById.get(id);
		if (!entry) continue;
		await t.test(`${entry.id} — ${entry.title}`, async () => {
			await runCase(entry);
		});
	}
});

// COVERAGE LATER: the whole suite is demanded only when you declare the integration complete.
test("a complete adapter satisfies every conformance case", async (t) => {
	if (!manifest.complete) return;
	const missing = cases.filter((entry) => !manifest.implemented.includes(entry.id)).map((entry) => `${entry.id} (${entry.title})`);
	assert.deepEqual(missing, [], `\`complete: true\` but these cases are not listed in \`implemented\`:\n  ${missing.join("\n  ")}\n`);
	for (const entry of cases) {
		await t.test(`${entry.id} — ${entry.title}`, async () => {
			await runCase(entry);
		});
	}
});
