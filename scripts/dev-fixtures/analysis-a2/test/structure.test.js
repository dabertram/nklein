import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const INPUT_DIR = "input";
const ENTRY = "index.mjs";
const KINDS = ["import_cycle", "unused_export", "unimported_module"];

function readModules() {
	const modules = new Map(); // "name.mjs" -> source
	for (const entry of readdirSync(join(root, INPUT_DIR), { withFileTypes: true })) {
		if (entry.isFile() && entry.name.endsWith(".mjs")) {
			modules.set(entry.name, readFileSync(join(root, INPUT_DIR, entry.name), "utf8"));
		}
	}
	return modules;
}

/** Named-import edges: `import { a, b } from "./other.mjs";` — the only import form the package uses. */
function readImports(source) {
	const edges = [];
	for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"\.\/([\w.-]+\.mjs)"/g)) {
		const names = match[1]
			.split(",")
			.map((name) => name.trim())
			.filter((name) => name.length > 0);
		edges.push({ target: match[2], names });
	}
	return edges;
}

/** Named exports: `export function f(`, `export const c =`, `export class C`. */
function readExports(source) {
	return [...source.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)].map(
		(match) => match[1],
	);
}

/**
 * Enumerate every ELEMENTARY cycle of the import graph. Each cycle is found exactly once, on the DFS that starts
 * at its alphabetically smallest participant. No cycle is written down anywhere in this file.
 */
function findCycles(graph) {
	const cycles = new Set();
	const path = [];
	const onPath = new Set();
	function walk(start, node) {
		path.push(node);
		onPath.add(node);
		for (const next of graph.get(node) ?? []) {
			if (next === start) {
				cycles.add([...path].sort().join("|"));
				continue;
			}
			if (next > start && !onPath.has(next)) {
				walk(start, next);
			}
		}
		path.pop();
		onPath.delete(node);
	}
	for (const start of [...graph.keys()].sort()) {
		walk(start, start);
	}
	return cycles;
}

/**
 * The truth set is DERIVED from the package on every run — this file is a verifier, not an answer key. It names
 * no module, no cycle and no symbol. Re-implementing these rules is not a shortcut past the work; it IS the work.
 */
function deriveTruth(modules) {
	const graph = new Map();
	const importedNames = new Set(); // "module.mjs#symbol"
	const importedModules = new Set();
	for (const [name, source] of modules) {
		const edges = readImports(source);
		graph.set(
			name,
			edges.map((edge) => edge.target),
		);
		for (const edge of edges) {
			importedModules.add(edge.target);
			for (const imported of edge.names) {
				importedNames.add(`${edge.target}#${imported}`);
			}
		}
	}

	const truth = new Map(); // canonical key -> short why

	for (const cycle of findCycles(graph)) {
		truth.set(`import_cycle:${cycle}`, `these modules import each other in a closed loop`);
	}

	const unimported = [...modules.keys()]
		.filter((name) => name !== ENTRY && !importedModules.has(name))
		.sort();
	for (const name of unimported) {
		truth.set(`unimported_module:${name}`, "no module in the package imports it");
	}

	const skipExportsFor = new Set([ENTRY, ...unimported]);
	for (const [name, source] of modules) {
		if (skipExportsFor.has(name)) continue;
		for (const symbol of readExports(source)) {
			if (!importedNames.has(`${name}#${symbol}`)) {
				truth.set(`unused_export:${name}#${symbol}`, "exported but imported by no other module");
			}
		}
	}

	return truth;
}

const modules = readModules();
const truth = deriveTruth(modules);
const exportsByModule = new Map([...modules].map(([name, source]) => [name, new Set(readExports(source))]));
const deliverable = JSON.parse(readFileSync(join(root, "analysis/structure.json"), "utf8"));

function canonicalKey(finding) {
	if (finding.kind === "import_cycle") {
		return `import_cycle:${[...finding.modules].sort().join("|")}`;
	}
	if (finding.kind === "unused_export") {
		return `unused_export:${finding.module}#${finding.symbol}`;
	}
	return `unimported_module:${finding.module}`;
}

test("the deliverable keeps its shape", () => {
	assert.equal(deliverable.schemaVersion, 1, "schemaVersion must stay 1");
	assert.equal(typeof deliverable.complete, "boolean", "`complete` must be a boolean");
	assert.ok(Array.isArray(deliverable.findings), "`findings` must be an array");
});

test("every recorded finding is well-formed and true of the package", () => {
	const seen = new Set();
	for (const finding of deliverable.findings) {
		const where = JSON.stringify(finding);
		assert.ok(KINDS.includes(finding.kind), `kind must be one of ${KINDS.join(", ")}: ${where}`);
		assert.equal(typeof finding.why, "string", `each finding needs a \`why\`: ${where}`);
		assert.ok(finding.why.trim().length >= 12, `\`why\` must actually explain the finding: ${where}`);

		if (finding.kind === "import_cycle") {
			assert.ok(Array.isArray(finding.modules), `an import_cycle needs a \`modules\` array: ${where}`);
			assert.ok(finding.modules.length >= 2, `a cycle has at least two participants: ${where}`);
			assert.equal(
				new Set(finding.modules).size,
				finding.modules.length,
				`a module may appear only once in \`modules\` — list each participant, not the walk: ${where}`,
			);
			for (const name of finding.modules) {
				assert.ok(modules.has(name), `\`${name}\` is not a module of the package: ${where}`);
			}
		} else {
			assert.ok(modules.has(finding.module), `\`${finding.module}\` is not a module of the package: ${where}`);
			if (finding.kind === "unused_export") {
				assert.ok(
					exportsByModule.get(finding.module).has(finding.symbol),
					`\`${finding.module}\` does not export \`${finding.symbol}\`: ${where}`,
				);
			}
		}

		const key = canonicalKey(finding);
		assert.ok(!seen.has(key), `duplicate finding for ${key}`);
		seen.add(key);
		assert.ok(
			truth.has(key),
			`the package does not support this ${finding.kind} — a wrong finding is worse than a missing one: ${where}`,
		);
	}
});

test("declaring the analysis complete requires covering every structural defect", () => {
	if (deliverable.complete !== true) return;
	const found = new Set(deliverable.findings.map(canonicalKey));
	const missing = [...truth.entries()].filter(([key]) => !found.has(key)).map(([key, why]) => `${key} (${why})`);
	assert.deepEqual(missing, [], `\`complete\` is true but these are unreported:\n  ${missing.join("\n  ")}`);
});
