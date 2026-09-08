import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const SPEC = "input/specification.md";
const PLAN = "plan/cards.json";
const TESTABILITY = ["testable", "not_testable"];
const MAX_FILES_PER_CARD = 3;

/**
 * The obligation set is DERIVED from the specification on every run — this file is a verifier, not an answer key.
 * It contains no obligation ids, no module paths and no card names.
 * Re-implementing these rules is not a shortcut past the work; it IS the work.
 *
 * An obligation is a list item that begins `- **OBL-NN** — `. Its text is that line's remainder joined with any
 * indented continuation lines that follow it, up to the first blank or unindented line.
 */
function deriveObligations(specSource) {
	const obligations = new Map();
	let current = null;
	for (const line of specSource.split("\n")) {
		const start = /^\s*-\s+\*\*(OBL-\d{2})\*\*\s+—\s*(.*)$/.exec(line);
		if (start) {
			current = start[1];
			assert.ok(!obligations.has(current), `the specification declares ${current} twice`);
			obligations.set(current, start[2].trim());
			continue;
		}
		if (current !== null && /^\s+\S/.test(line)) {
			obligations.set(current, `${obligations.get(current)} ${line.trim()}`.trim());
			continue;
		}
		current = null;
	}
	return obligations;
}

/** The module an obligation's implementation belongs in, written `[module: <path>]` in its text. */
function moduleOf(text) {
	const match = /\[module:\s*([^\]]+)\]/.exec(text);
	return match ? match[1].trim() : null;
}

/** The modules an obligation's implementation consumes, each written `[uses: <path>]` in its text. */
function usesOf(text) {
	return [...text.matchAll(/\[uses:\s*([^\]]+)\]/g)].map((match) => match[1].trim());
}

/** A path is a test path when a directory segment is `test`/`tests`, or its basename carries `.test.`/`.spec.`. */
function isTestPath(path) {
	const segments = path.split("/");
	const base = segments.at(-1) ?? "";
	return (
		segments.slice(0, -1).some((segment) => segment === "test" || segment === "tests") || /\.(test|spec)\./.test(base)
	);
}

/** Depth-first search returning the first cycle as a readable `a -> b -> a` path, or null when the graph is a DAG. */
function findCycle(nodes, edgesFrom) {
	const state = new Map(nodes.map((node) => [node, 0]));
	const stack = [];
	let cycle = null;
	const walk = (node) => {
		if (cycle) return;
		state.set(node, 1);
		stack.push(node);
		for (const next of edgesFrom.get(node) ?? []) {
			if (!state.has(next)) continue;
			if (state.get(next) === 1) {
				cycle = [...stack.slice(stack.indexOf(next)), next].join(" -> ");
				return;
			}
			if (state.get(next) === 0) walk(next);
			if (cycle) return;
		}
		stack.pop();
		state.set(node, 2);
	};
	for (const node of nodes) if (state.get(node) === 0) walk(node);
	return cycle;
}

/**
 * The specification is the input this whole suite grades against, so it is evidence, not workspace: trimming an
 * obligation out of it would make coverage trivially satisfiable. Its content is pinned here.
 */
const SPEC_SHA256 = "28f6d3d9c33048e00d39b9f54fa1e130a213b2d24e341f202ecac9fe11bfc9ce";

const specSource = readFileSync(join(root, SPEC), "utf8");
const obligations = deriveObligations(specSource);
const plan = JSON.parse(readFileSync(join(root, PLAN), "utf8"));

/** Every card that lists the given obligation id, in plan order. */
function cardsCovering(obligationId) {
	return plan.cards.filter((card) => card.coversObligations.includes(obligationId));
}

test("the specification is unmodified", () => {
	const actual = createHash("sha256").update(specSource).digest("hex");
	assert.equal(
		actual,
		SPEC_SHA256,
		`${SPEC} has been modified — it is read-only evidence, not workspace, and the whole suite grades against it`,
	);
});

test("the specification still declares obligations the plan can cover", () => {
	assert.ok(obligations.size > 0, `no \`- **OBL-NN** — \` obligations were found in ${SPEC}`);
});

test("the plan keeps its shape", () => {
	assert.equal(plan.schemaVersion, 1, "schemaVersion must stay 1");
	assert.equal(typeof plan.complete, "boolean", "`complete` must be a boolean");
	assert.ok(Array.isArray(plan.cards), "`cards` must be an array");
	assert.ok(Array.isArray(plan.dependencies), "`dependencies` must be an array");
});

test("every card is well formed, uniquely identified and correctly sized", () => {
	const ids = new Set();
	for (const card of plan.cards) {
		const where = JSON.stringify(card);
		assert.equal(typeof card.id, "string", `card \`id\` must be a string: ${where}`);
		assert.match(card.id, /^[A-Za-z][A-Za-z0-9_-]{0,39}$/, `card id \`${card.id}\` is not a usable identifier`);
		assert.ok(!ids.has(card.id), `duplicate card id \`${card.id}\``);
		ids.add(card.id);
		assert.equal(typeof card.title, "string", `card \`${card.id}\` needs a string \`title\``);
		assert.ok(card.title.trim().length >= 8, `card \`${card.id}\` needs a title that says what it does`);
		assert.ok(Array.isArray(card.filesLikelyTouched), `card \`${card.id}\` needs \`filesLikelyTouched\``);
		assert.ok(
			card.filesLikelyTouched.length >= 1 && card.filesLikelyTouched.length <= MAX_FILES_PER_CARD,
			`card \`${card.id}\` touches ${card.filesLikelyTouched.length} files; the limit is 1..${MAX_FILES_PER_CARD}`,
		);
		const own = new Set();
		for (const file of card.filesLikelyTouched) {
			assert.equal(typeof file, "string", `card \`${card.id}\` has a non-string file: ${where}`);
			assert.ok(file.trim().length > 0, `card \`${card.id}\` has an empty file path`);
			assert.ok(!file.startsWith("/"), `card \`${card.id}\` names an absolute path \`${file}\``);
			assert.ok(!file.split("/").includes(".."), `card \`${card.id}\` names an escaping path \`${file}\``);
			assert.ok(!own.has(file), `card \`${card.id}\` lists \`${file}\` twice`);
			own.add(file);
		}
		assert.ok(Array.isArray(card.dependsOn), `card \`${card.id}\` needs a \`dependsOn\` array`);
		assert.ok(
			TESTABILITY.includes(card.testability),
			`card \`${card.id}\` has testability \`${card.testability}\`; it must be one of ${TESTABILITY.join(", ")}`,
		);
		assert.ok(Array.isArray(card.coversObligations), `card \`${card.id}\` needs \`coversObligations\``);
		assert.ok(card.coversObligations.length >= 1, `card \`${card.id}\` covers no obligation, so it plans nothing`);
	}
});

test("no two cards claim the same file", () => {
	const owner = new Map();
	for (const card of plan.cards) {
		for (const file of card.filesLikelyTouched) {
			const previous = owner.get(file);
			assert.equal(
				previous,
				undefined,
				`cards \`${previous}\` and \`${card.id}\` both claim \`${file}\` — that is a merge conflict by construction`,
			);
			owner.set(file, card.id);
		}
	}
});

test("dependsOn and coversObligations only name things that exist", () => {
	const ids = new Set(plan.cards.map((card) => card.id));
	for (const card of plan.cards) {
		for (const dependency of card.dependsOn) {
			assert.equal(typeof dependency, "string", `card \`${card.id}\` has a non-string dependency`);
			assert.notEqual(dependency, card.id, `card \`${card.id}\` depends on itself`);
			assert.ok(
				ids.has(dependency),
				`card \`${card.id}\` depends on \`${dependency}\`, which is not a declared card`,
			);
		}
		const seen = new Set();
		for (const obligation of card.coversObligations) {
			assert.equal(typeof obligation, "string", `card \`${card.id}\` has a non-string obligation id`);
			assert.ok(!seen.has(obligation), `card \`${card.id}\` lists \`${obligation}\` twice`);
			seen.add(obligation);
			assert.ok(
				obligations.has(obligation),
				`card \`${card.id}\` claims \`${obligation}\`, which the specification does not declare`,
			);
		}
	}
});

test("the dependencies edge list agrees exactly with the cards' dependsOn", () => {
	const ids = new Set(plan.cards.map((card) => card.id));
	const implied = new Set();
	for (const card of plan.cards) for (const dependency of card.dependsOn) implied.add(`${card.id} -> ${dependency}`);
	const declared = new Set();
	for (const edge of plan.dependencies) {
		const where = JSON.stringify(edge);
		assert.ok(edge && typeof edge === "object", `each dependency must be an object: ${where}`);
		assert.ok(ids.has(edge.from), `dependency \`from\` names \`${edge.from}\`, which is not a declared card: ${where}`);
		assert.ok(ids.has(edge.to), `dependency \`to\` names \`${edge.to}\`, which is not a declared card: ${where}`);
		declared.add(`${edge.from} -> ${edge.to}`);
	}
	const missing = [...implied].filter((edge) => !declared.has(edge));
	const extra = [...declared].filter((edge) => !implied.has(edge));
	assert.deepEqual(missing, [], `these dependsOn edges are absent from \`dependencies\`: ${missing.join(", ")}`);
	assert.deepEqual(extra, [], `these \`dependencies\` edges no card declares in dependsOn: ${extra.join(", ")}`);
});

test("the dependency graph is acyclic", () => {
	const nodes = plan.cards.map((card) => card.id);
	const edgesFrom = new Map(plan.cards.map((card) => [card.id, card.dependsOn]));
	const cycle = findCycle(nodes, edgesFrom);
	assert.equal(cycle, null, `the plan's dependencies contain a cycle: ${cycle}`);
});

test("testability is honest about whether the card touches a test file", () => {
	for (const card of plan.cards) {
		const tests = card.filesLikelyTouched.filter(isTestPath);
		if (tests.length > 0) {
			assert.equal(
				card.testability,
				"testable",
				`card \`${card.id}\` touches ${tests.join(", ")} but calls itself \`${card.testability}\``,
			);
			continue;
		}
		assert.equal(
			card.testability,
			"not_testable",
			`card \`${card.id}\` touches no test file yet calls itself \`testable\` — the test-driven gate will park it`,
		);
	}
});

test("every obligation is planned into the module the specification assigns it", () => {
	for (const [id, text] of obligations) {
		const module = moduleOf(text);
		if (module === null) continue;
		const covering = cardsCovering(id);
		if (covering.length === 0) continue;
		const anchored = covering.filter((card) => card.filesLikelyTouched.includes(module));
		assert.ok(
			anchored.length > 0,
			`${id} belongs in \`${module}\`, but no card covering it touches that file (covered by: ${covering
				.map((card) => card.id)
				.join(", ")})`,
		);
	}
});

test("a card reaches the card that builds every module its obligations use", () => {
	const builderOf = new Map();
	for (const card of plan.cards) for (const file of card.filesLikelyTouched) builderOf.set(file, card);
	const dependsOn = new Map(plan.cards.map((card) => [card.id, card.dependsOn]));
	const reaches = (from, target) => {
		const seen = new Set([from]);
		const queue = [...(dependsOn.get(from) ?? [])];
		while (queue.length > 0) {
			const next = queue.shift();
			if (next === target) return true;
			if (seen.has(next)) continue;
			seen.add(next);
			queue.push(...(dependsOn.get(next) ?? []));
		}
		return false;
	};
	for (const [id, text] of obligations) {
		for (const used of usesOf(text)) {
			const builder = builderOf.get(used);
			if (builder === undefined) continue;
			for (const consumer of cardsCovering(id)) {
				if (consumer.id === builder.id) continue;
				assert.ok(
					reaches(consumer.id, builder.id),
					`card \`${consumer.id}\` covers ${id}, whose implementation uses \`${used}\`, but never reaches \`${builder.id}\` (the card that builds it) through dependsOn — that is the missing dependency edge a card's imports require`,
				);
			}
		}
	}
});

test("declaring the plan complete requires covering every obligation", () => {
	if (plan.complete !== true) return;
	const covered = new Set(plan.cards.flatMap((card) => card.coversObligations));
	const missing = [...obligations.keys()].filter((id) => !covered.has(id));
	assert.deepEqual(missing, [], `\`complete\` is true but no card covers: ${missing.join(", ")}`);
});
