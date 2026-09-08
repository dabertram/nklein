import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const BRIEF = "input/brief.md";
const KINDS = ["contradiction", "ambiguity"];
const OPEN_VALUE = "unspecified";

/**
 * The conflicting pairs are DERIVED from the brief's own constraint tails on every run — this file is a verifier,
 * not an answer key. It names no clause and no pair. Re-implementing these rules is not a shortcut past the work;
 * it IS the work, because the rules say nothing about WHICH clauses share a key.
 */
function deriveBrief(source) {
	const clauses = new Map(); // "C-NN" -> { key, value }
	for (const block of source.split(/\n\s*\n/)) {
		const trimmed = block.trim();
		const heading = /^\*\*(C-\d{2})\*\*/.exec(trimmed);
		if (!heading) continue;
		const tail = /`\[([A-Za-z0-9_.]+)\s*=\s*([^\]]+)\]`/.exec(trimmed);
		if (!tail) continue;
		clauses.set(heading[1], { key: tail[1].trim(), value: tail[2].trim() });
	}

	const byKey = new Map();
	for (const [id, clause] of clauses) {
		if (!byKey.has(clause.key)) byKey.set(clause.key, []);
		byKey.get(clause.key).push(id);
	}

	const conflicts = new Map(); // "C-aa|C-bb" -> kind
	for (const [, ids] of byKey) {
		const sorted = [...ids].sort();
		for (let left = 0; left < sorted.length; left += 1) {
			for (let right = left + 1; right < sorted.length; right += 1) {
				const first = clauses.get(sorted[left]);
				const second = clauses.get(sorted[right]);
				if (first.value === second.value) continue; // two sources agreeing is not a conflict
				const open = first.value === OPEN_VALUE || second.value === OPEN_VALUE;
				conflicts.set(`${sorted[left]}|${sorted[right]}`, open ? "ambiguity" : "contradiction");
			}
		}
	}

	return { clauses, conflicts };
}

const { clauses, conflicts } = deriveBrief(readFileSync(join(root, BRIEF), "utf8"));
const deliverable = JSON.parse(readFileSync(join(root, "spec/conflicts.json"), "utf8"));

function pairKey(ids, label, where) {
	assert.ok(Array.isArray(ids), `${label} must be an array of two clause ids: ${where}`);
	assert.equal(ids.length, 2, `${label} must cite exactly two clauses: ${where}`);
	assert.notEqual(ids[0], ids[1], `${label} cites the same clause twice: ${where}`);
	for (const id of ids) {
		assert.ok(clauses.has(id), `\`${id}\` is not a clause in the brief: ${where}`);
	}
	return [...ids].sort().join("|");
}

test("the deliverable keeps its shape and the brief still parses", () => {
	assert.equal(deliverable.schemaVersion, 1, "schemaVersion must stay 1");
	assert.equal(typeof deliverable.complete, "boolean", "`complete` must be a boolean");
	assert.ok(Array.isArray(deliverable.conflicts), "`conflicts` must be an array");
	assert.ok(Array.isArray(deliverable.assumptions), "`assumptions` must be an array");
	assert.ok(clauses.size > 0, "the clauses must parse — they are the evidence, do not edit the brief");
});

test("every flagged conflict is one the brief actually contains, and is classified correctly", () => {
	const seen = new Set();
	for (const conflict of deliverable.conflicts) {
		const where = JSON.stringify(conflict);
		const key = pairKey(conflict.clauses, "`clauses`", where);
		assert.ok(KINDS.includes(conflict.kind), `kind must be one of ${KINDS.join(", ")}: ${where}`);
		assert.equal(typeof conflict.why, "string", `each conflict needs a \`why\`: ${where}`);
		assert.ok(conflict.why.trim().length >= 12, `\`why\` must actually explain the clash: ${where}`);

		assert.ok(!seen.has(key), `the pair ${key.replace("|", " + ")} is flagged twice`);
		seen.add(key);
		assert.ok(
			conflicts.has(key),
			`${key.replace("|", " and ")} are not in conflict — a false conflict is worse than a missed one: ${where}`,
		);
		assert.equal(
			conflicts.get(key),
			conflict.kind,
			`${key.replace("|", " and ")} do clash, but not as a \`${conflict.kind}\`: ${where}`,
		);
	}
});

test("every recorded assumption resolves a real conflict, once", () => {
	const seen = new Set();
	for (const assumption of deliverable.assumptions) {
		const where = JSON.stringify(assumption);
		const key = pairKey(assumption.conflict, "`conflict`", where);
		assert.ok(
			conflicts.has(key),
			`an assumption must resolve a conflict the brief contains — ${key.replace("|", " and ")} do not clash: ${where}`,
		);
		assert.ok(!seen.has(key), `the pair ${key.replace("|", " + ")} has two assumptions recorded against it`);
		seen.add(key);
		assert.equal(typeof assumption.resolution, "string", `each assumption needs a \`resolution\`: ${where}`);
		assert.ok(
			assumption.resolution.trim().length >= 20,
			`\`resolution\` must state what you are proceeding on, and it is worth twenty characters: ${where}`,
		);
	}
});

test("declaring the hunt complete requires every conflict flagged and every one resolved", () => {
	if (deliverable.complete !== true) return;
	const flagged = new Set(deliverable.conflicts.map((conflict) => [...conflict.clauses].sort().join("|")));
	const resolved = new Set(deliverable.assumptions.map((assumption) => [...assumption.conflict].sort().join("|")));
	const unflagged = [...conflicts.entries()]
		.filter(([key]) => !flagged.has(key))
		.map(([key, kind]) => `${key.replace("|", " + ")} (${kind})`);
	assert.deepEqual(unflagged, [], `\`complete\` is true but these clashes are unflagged:\n  ${unflagged.join("\n  ")}`);
	const unresolved = [...conflicts.keys()]
		.filter((key) => !resolved.has(key))
		.map((key) => key.replace("|", " + "));
	assert.deepEqual(
		unresolved,
		[],
		`\`complete\` is true but these clashes have no recorded assumption:\n  ${unresolved.join("\n  ")}`,
	);
});
